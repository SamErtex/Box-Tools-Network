(() => {
  "use strict";

  const VERSION = chrome.runtime.getManifest().version;
  const FRAME_TAG = window.top === window.self ? "top" : "iframe";
  const STORAGE_KEY = "opaAutoSettingsV3";
  const BUTTON_ID = "opa-auto-toggle";
  const PANEL_ID = "opa-auto-panel";
  const MENU_BUTTON_ID = "opa-auto-menu";
  const UI_CONTAINER_ID = "opa-auto-container";
  const CHECK_INTERVAL = 3000;
  const ASSUMPTION_COOLDOWN = 3000;
  const ASSUMPTION_CONFIRMATION_TIMEOUT = 20 * 1000;
  let debugEnabled = false;
  const DEFAULT_DEPARTMENT = "SUP - Suporte Redes - IXC Provedor";
  const SERVER_DEPARTMENT = "SUP - Instalação e Manutenção de Servidor - IXC Provedor";
  const IMP_DEPARTMENT_ID = "69dd1a025f580676013acf7c";
  const IMP_DEPARTMENT_NAME = "IMP - Aplicativos e Servidores IXC Provedor";
  const ACS_DEPARTMENT_ID = "62fceed199272a70d32a5994";
  const ACS_DEPARTMENT_NAME = "ACS - Suporte - IXC ACS";
  const ALL_DEPARTMENTS = "__ALL__";
  const DEPARTMENT_GROUPS = {
    SUPPORT: "SUPORTE_REDES",
    SERVERS: "SERVIDORES",
    ALL: ALL_DEPARTMENTS
  };

  let enabled = false;
  let processing = false;
  let queue = [];
  let selectedDepartment = DEPARTMENT_GROUPS.SUPPORT;
  let waitFiveMinutes = false;
  let bridgeInjected = false;
  let observer = null;
  let uiUpdateFrame = null;
  let pendingAssumptionId = null;
  let nextResponsibleAttemptAt = 0;
  let queueRefreshPending = false;
  const waitingCustomerProtocols = new Map();
  let extensionAlive = true;
  let queueTimerObserver = null;
  let queueTimerInterval = null;
  let queueTimerUpdatePending = false;

  const log = (message, details) => {
    if (!debugEnabled) return;
    const text = String(message || "");
    const isError = /falha|erro|timeout|bloquead|abortad/i.test(text);
    const isSuccess = /confirmad|assumid|ativad|sucesso/i.test(text);
    const color = isError ? "#dc2626" : isSuccess ? "#15803d" : "#7c3aed";
    console.log(`%c OPA AUTO v${VERSION} %c ${FRAME_TAG.toUpperCase()} %c ${text}`,
      "background:#312e81;color:#fff;font-weight:700;padding:2px 6px;border-radius:3px",
      "background:#ede9fe;color:#4c1d95;font-weight:700;padding:2px 6px;border-radius:3px",
      `color:${color};font-weight:600`, ...(details === undefined ? [] : [details]));
  };

  function extensionIsAlive() {
    if (!extensionAlive) return false;
    try {
      if (!chrome.runtime?.id) {
        extensionAlive = false;
        return false;
      }
      return true;
    } catch (_) {
      extensionAlive = false;
      return false;
    }
  }

  function safeStorageSet(value) {
    if (!extensionIsAlive()) return Promise.resolve();
    return chrome.storage.local.set(value).catch((e) => {
      if (!String(e?.message || e).toLowerCase().includes("context invalidated")) {
        console.warn(`[OPA Auto v${VERSION}] Falha ao salvar estado:`, e);
      }
    });
  }

  function safeStorageGet(key) {
    if (!extensionIsAlive()) return Promise.resolve({});
    return chrome.storage.local.get(key).catch((e) => {
      if (!String(e?.message || e).toLowerCase().includes("context invalidated")) {
        console.warn(`[OPA Auto v${VERSION}] Falha ao ler estado:`, e);
      }
      return {};
    });
  }

  function safeSendMessage(message) {
    if (!extensionIsAlive()) return;
    try {
      chrome.runtime.sendMessage(message, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
      extensionAlive = false;
    }
  }

  const norm = (s) => (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "")
    .toUpperCase();

  function injectPageBridge() {
    if (window.top !== window.self || bridgeInjected || !extensionIsAlive()) return;
    bridgeInjected = true;

    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("modules/opa/page-bridge.js");
      script.onload = () => script.remove();
      script.onerror = () => { bridgeInjected = false; };
      (document.head || document.documentElement).appendChild(script);
    } catch (_) {
      bridgeInjected = false;
    }
  }

  function postBridge(action, data = {}) {
    window.postMessage({
      type: "OPA_AUTO_BRIDGE",
      action,
      ...data
    }, window.location.origin);
  }

  function showNotificationToast(title, message, variant = "default") {
    if (window.top !== window.self || !document.body) return;
    let toast = document.getElementById("opa-notification-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "opa-notification-toast";
      toast.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:360px;padding:12px 14px;border-radius:10px;background:#1f2937;color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.28);font:13px Arial,sans-serif;line-height:1.4;opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease;pointer-events:none;";
      document.body.appendChild(toast);
    }
    toast.style.background = variant === "error" ? "#b91c1c" : "#1f2937";
    toast.style.borderLeft = variant === "error" ? "4px solid #fecaca" : "none";
    toast.innerHTML = `<strong style="display:block;margin-bottom:4px;">${String(title || "OPA Auto Atendimento").replace(/[<>]/g, "")}</strong><span>${String(message || "").replace(/[<>]/g, "")}</span>`;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
    clearTimeout(window.__opaToastTimer);
    window.__opaToastTimer = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
    }, 7000);
  }

  if (window.top === window.self && extensionIsAlive()) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "OPA_SHOW_NOTIFICATION") {
        showNotificationToast(message.title, message.message);
      }
    });
  }

  function formatQueueElapsed(startedAt, now = Date.now()) {
    const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
    if (elapsedSeconds < 60) return `${elapsedSeconds} ${elapsedSeconds === 1 ? "segundo" : "segundos"}`;

    const minutes = Math.floor(elapsedSeconds / 60);
    if (minutes < 60) return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) {
      return remainingMinutes
        ? `${hours}h ${remainingMinutes}min`
        : `${hours} ${hours === 1 ? "hora" : "horas"}`;
    }

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours
      ? `${days}d ${remainingHours}h`
      : `${days} ${days === 1 ? "dia" : "dias"}`;
  }

  function getQueueTimerNodes() {
    const timePattern = /^\d+\s+(?:segundos?|minutos?|horas?|d|h)(?:\s+\d+\s*(?:min|h))?$/i;
    return Array.from(document.querySelectorAll("p"))
      .filter(node => timePattern.test((node.textContent || "").trim()));
  }

  function updateQueueTimeLabels() {
    if (window.top !== window.self || !queue.length) return;

    // A lista visual e o snapshot Socket.IO são ordenados pelo mesmo retorno.
    // Só aplica quando há correspondência de quantidade, evitando alterar timers
    // de outras áreas ou associar um atendimento ao registro errado.
    const timerNodes = getQueueTimerNodes();
    if (timerNodes.length !== queue.length) return;

    const now = Date.now();
    queue.forEach((item, index) => {
      const timestamp = Date.parse(item?.filaDesde || "");
      if (!Number.isFinite(timestamp)) return;

      const node = timerNodes[index];
      if (!node || !node.isConnected) return;

      const correctValue = formatQueueElapsed(timestamp, now);
      if ((node.textContent || "").trim() !== correctValue) {
        node.textContent = correctValue;
      }
      node.title = "Tempo nesta fila";
      node.dataset.opaQueueTimer = "true";
    });
  }

  function scheduleQueueTimeUpdate() {
    if (queueTimerUpdatePending) return;
    queueTimerUpdatePending = true;
    requestAnimationFrame(() => {
      queueTimerUpdatePending = false;
      updateQueueTimeLabels();
    });
  }

  function startQueueTimeUpdater() {
    if (queueTimerObserver || !document.body) return;

    queueTimerObserver = new MutationObserver(scheduleQueueTimeUpdate);
    queueTimerObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true
    });

    queueTimerInterval = setInterval(updateQueueTimeLabels, 1000);
    scheduleQueueTimeUpdate();
  }

  function handleBridgeMessage(event) {
    if (window.top !== window.self) return;
    if (event.source !== window || event.origin !== window.location.origin) return;

    const data = event.data;
    if (!data || data.type !== "OPA_AUTO_BRIDGE") return;

    if (data.action === "DEBUG_STATE") {
      debugEnabled = data.enabled === true;
      console.info(`[OPA Auto v${VERSION}] Debug ${debugEnabled ? "ATIVADO" : "DESATIVADO"}.`);
      return;
    }

    if (data.action === "FILA_ATUALIZADA") {
      queue = Array.isArray(data.queue) ? data.queue : [];
      queueRefreshPending = false;
      logQueueEligibilityDiagnostics();
      log("Snapshot da fila recebido e marcado como carregado.", {
        total: queue.length,
        elegiveis: queue.filter(isEligibleItem).length,
        enabled,
        processing
      });
      scheduleQueueTimeUpdate();
      updateDepartmentOptions();
      updatePanelInfo();
      if (enabled && !processing) void tryAssumeFromQueue();
      return;
    }

    if (data.action === "ATENDIMENTO_ASSUMIDO" && data.record?.id) {
      const assumedByOPA = data.record.assumedByOPA !== false && data.record.source !== "manual";
      const protocolo = data.record.protocolo || data.record.id;

      // Todos os atendimentos confirmados passam pelos mesmos processos abaixo.
      // A origem controla somente a interface/estado do AUTO: assunção manual não
      // liga, desliga nem reativa o botão, nem interrompe uma assunção automática em curso.
      if (assumedByOPA) {
        processing = false;
        pendingAssumptionId = null;

        if (!waitFiveMinutes) {
          // AUTO normal é de uso único: desliga assim que o servidor confirma
          // a assunção. Só o modo Responsável pela fila continua em execução.
          enabled = false;
          nextResponsibleAttemptAt = 0;
          void saveState();
          setButtonState();
          log("AUTO desativado após assunção confirmada no modo normal.", {
            id: data.record.id,
            modoResponsavel: false
          });
        } else {
          // No modo Responsável pela fila, aguarda a fila estabilizar antes
          // de buscar o próximo atendimento. Nenhuma tentativa ocorre com o
          // snapshot antigo enquanto a nova lista não chega.
          queueRefreshPending = true;
          nextResponsibleAttemptAt = Date.now() + ASSUMPTION_COOLDOWN;
          void saveState();
          setButtonState();
          log("Assunção confirmada; modo Responsável permanece ativo por 3 segundos de pausa.", {
            id: data.record.id,
            nextAttemptAt: new Date(nextResponsibleAttemptAt).toISOString()
          });
          setTimeout(() => {
            if (!enabled) return;
            log("Pausa concluída; solicitando atualização da fila ao IXC.");
            postBridge("REQUEST_QUEUE_REFRESH");
          }, ASSUMPTION_COOLDOWN);
        }
      }

      const assumidoMessage = !assumedByOPA
        ? `Atendimento ${protocolo} assumido manualmente com sucesso.`
        : (waitFiveMinutes
          ? `Responsável pela fila: atendimento ${protocolo} assumido com sucesso.`
          : `Atendimento ${protocolo} assumido com sucesso.`);
      showNotificationToast("OPA Auto Atendimento", assumidoMessage);

      // O processamento de fundo é comum às duas origens: notificação nativa,
      // monitoramento dos 5 minutos e acompanhamento de interação/transferência.
      safeSendMessage({ type: "ATENDIMENTO_ASSUMIDO", record: data.record });
      waitingCustomerProtocols.set(data.record.id, protocolo);
      postBridge("MARCAR_AGUARDANDO_CLIENTE", { id: data.record.id, protocolo });
      updatePanelInfo(`${assumedByOPA ? "Assumido" : "Assumido manualmente"}: ${protocolo}`);
      return;
    }

    if (data.action === "AGUARDANDO_CLIENTE_OK" && data.id) {
      const protocolo = waitingCustomerProtocols.get(data.id) || data.protocolo || data.id;
      waitingCustomerProtocols.delete(data.id);
      showNotificationToast(
        "OPA Auto Atendimento",
        `Atendimento ${protocolo} marcado como \"Aguardando resposta do cliente\".`
      );
      return;
    }

    if (data.action === "AGUARDANDO_CLIENTE_ERRO" && data.id) {
      const protocolo = waitingCustomerProtocols.get(data.id) || data.protocolo || data.id;
      waitingCustomerProtocols.delete(data.id);
      showNotificationToast(
        "OPA Auto Atendimento",
        `Não foi possível marcar o atendimento ${protocolo} como \"Aguardando resposta do cliente\" após 4 tentativas.`,
        "error"
      );
      return;
    }

    if (data.action === "ATENDENTE_COMUNICOU" && data.record?.id) {
      safeSendMessage({ type: "ATENDENTE_COMUNICOU", record: data.record });
      return;
    }

    if (data.action === "ASSUMIR_RESULTADO" && data.id) {
      log("Resultado da solicitação de assunção recebido.", {
        id: data.id,
        ok: data.ok,
        reason: data.reason || "",
        processing
      });
      if (!data.ok && (!pendingAssumptionId || pendingAssumptionId === data.id)) {
        processing = false;
        pendingAssumptionId = null;
        queueRefreshPending = enabled;
        log("Assunção não confirmada; aguardando uma nova lista antes de tentar novamente.", {
          id: data.id,
          reason: data.reason || ""
        });
        if (enabled) postBridge("REQUEST_QUEUE_REFRESH");
      }
      return;
    }
  }

  async function loadState() {
    const result = await safeStorageGet(STORAGE_KEY);
    const settings = result[STORAGE_KEY] || {};
    enabled = settings.enabled === true;
    selectedDepartment = settings.department || DEPARTMENT_GROUPS.SUPPORT;
    waitFiveMinutes = settings.waitFiveMinutes === true;
    nextResponsibleAttemptAt = Number(settings.nextResponsibleAttemptAt) || 0;
  }

  async function saveState() {
    await safeStorageSet({
      [STORAGE_KEY]: {
        enabled,
        department: selectedDepartment,
        waitFiveMinutes,
        nextResponsibleAttemptAt
      }
    });
  }

  let shadowRoot = null;

  const UI_CSS = `
    :host { all: initial; display:block!important; width:36px!important; height:42px!important; min-width:36px!important; max-width:36px!important; flex:0 0 42px!important; }
    .wrap { position:relative; display:flex; width:36px; height:42px; align-items:center; justify-content:center; font-family:Arial,sans-serif; pointer-events:auto; }
    #auto { display:flex!important; align-items:center!important; justify-content:center!important; width:32px!important; height:36px!important; min-width:32px!important; max-width:32px!important; min-height:36px!important; max-height:36px!important; margin:0!important; padding:0!important; border:0!important; border-radius:9px!important; cursor:pointer!important; background:transparent!important; color:#9ca3af!important; transition:background .15s ease,color .15s ease!important; }
    #auto:hover { background:rgba(148,163,184,.16)!important; }
    #auto .bolt { width:21px!important; height:25px!important; display:block!important; color:#9ca3af!important; transition:color .15s ease,filter .15s ease!important; }
    #auto.on .bolt { color:#22c55e!important; filter:drop-shadow(0 0 4px rgba(34,197,94,.28)); }
    #auto svg { width:100%; height:100%; display:block; fill:currentColor; }
    #auto:focus-visible,#menu:focus-visible { outline:2px solid #60a5fa!important; outline-offset:2px!important; }
    #menu { position:absolute!important; right:-1px!important; bottom:-1px!important; display:flex!important; align-items:center!important; justify-content:center!important; width:13px!important; height:13px!important; min-width:13px!important; max-width:13px!important; min-height:13px!important; max-height:13px!important; margin:0!important; padding:0!important; border:1px solid #374151!important; border-radius:50%!important; cursor:pointer!important; color:#e5e7eb!important; background:#374151!important; font:700 8px/11px Arial,sans-serif!important; }
    #panel { position:fixed; left:48px; top:8px; width:min(300px,calc(100vw - 56px)); max-height:calc(100vh - 16px); overflow:auto; margin:0; padding:13px; box-sizing:border-box; background:#202632; color:#f3f4f6; border:1px solid #374151; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.38); font:12px Arial,sans-serif; z-index:2147483647; }
    #panel[hidden] { display:none!important; }
    .title { font-weight:700; margin-bottom:10px; color:#f9fafb; font-size:13px; }
    .label { display:block; margin-bottom:5px; font-weight:600; color:#d1d5db; }
    select { width:100%; box-sizing:border-box; padding:8px; border:1px solid #4b5563; border-radius:7px; background:#111827; color:#f3f4f6; font-size:12px; }
    .checkrow { display:flex; align-items:flex-start; gap:7px; margin-top:11px; line-height:1.4; cursor:pointer; color:#e5e7eb; }
    .checkrow input { margin:2px 0 0; width:14px; height:14px; cursor:pointer; accent-color:#22c55e; }
    .checkrow span { flex:1; }
    .info { margin-top:9px; color:#9ca3af; }
    .panel-footer { display:flex; justify-content:flex-end; margin-top:9px; }
    #reportError { position:relative; width:22px; height:22px; padding:0; border:0; background:transparent; color:#f87171; cursor:pointer; font:700 18px/22px Arial,sans-serif; border-radius:5px; }
    #reportError:hover { background:#450a0a; }
    #reportError::after { content:"reportar erro"; position:absolute; right:0; bottom:28px; display:none; white-space:nowrap; padding:5px 7px; border-radius:5px; background:#111827; color:#fff; font:11px Arial,sans-serif; box-shadow:0 4px 12px rgba(0,0,0,.2); }
    #reportError:hover::after { display:block; }
  `;

  function ui() {
    if (!shadowRoot) return {};
    return {
      host: document.getElementById("opa-auto-host"),
      button: shadowRoot.getElementById("auto"),
      menu: shadowRoot.getElementById("menu"),
      panel: shadowRoot.getElementById("panel"),
      select: shadowRoot.getElementById("department"),
      waitBox: shadowRoot.getElementById("waitFiveMinutes"),
      info: shadowRoot.getElementById("info"),
      reportError: shadowRoot.getElementById("reportError")
    };
  }

  function findN2Button() {
    return document.querySelector(
      '[data-sidebar="content"] button.ixc-button.n2-sidebar-docked'
    );
  }

  function setButtonState() {
    const { button } = ui();
    if (!button) return;
    button.classList.toggle("on", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "AUTO ativo" : "AUTO inativo");
    button.title = enabled ? "AUTO ativo — clique para desativar" : "AUTO inativo — clique para ativar";
  }

  function positionPanel() {
    const { button, panel } = ui();
    if (!button || !panel || panel.hidden) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(300, Math.max(220, window.innerWidth - 56));
    const height = Math.min(panel.scrollHeight || 320, window.innerHeight - 16);
    const left = Math.max(8, Math.min(rect.right + 8, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(rect.top + rect.height / 2 - height / 2, window.innerHeight - height - 8));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  function scheduleUiUpdate() {
    if (uiUpdateFrame !== null) return;
    uiUpdateFrame = requestAnimationFrame(() => {
      uiUpdateFrame = null;
      createUi();
    });
  }

  function createUi() {
    if (window.top !== window.self || !document.body) return false;

    const n2Button = findN2Button();
    if (!n2Button) return false;

    let host = document.getElementById("opa-auto-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "opa-auto-host";
      host.style.cssText = "all:initial!important;display:flex!important;align-items:center!important;justify-content:center!important;width:36px!important;min-width:36px!important;max-width:36px!important;height:42px!important;min-height:42px!important;max-height:42px!important;flex:0 0 42px!important;margin:4px auto 0!important;position:relative!important;z-index:30!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;";
      n2Button.insertAdjacentElement("afterend", host);
      shadowRoot = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = UI_CSS;
      shadowRoot.appendChild(style);

      const wrap = document.createElement("div");
      wrap.className = "wrap";
      wrap.innerHTML = `<button id="auto" type="button" aria-label="AUTO inativo" aria-pressed="false"><span class="bolt" aria-hidden="true"><svg viewBox="0 0 24 28" focusable="false"><path d="M14.1 1.5 3.8 15.2c-.4.5 0 1.2.6 1.2h6.1l-1.1 9.1c-.1.8.9 1.1 1.3.5l10-14c.4-.5 0-1.2-.6-1.2h-6.2l1.4-8.6c.1-.8-.8-1.2-1.2-.7Z"/></svg></span></button><button id="menu" type="button" aria-label="Configurar AUTO" aria-expanded="false" title="Configurar AUTO">⌄</button><div id="panel" hidden><div class="title">OPA AUTO</div><label class="label" for="department">Departamento</label><select id="department"><option value="SUPORTE_REDES">SUP - Suporte Redes + IXC Hub</option><option value="SERVIDORES">SUP - Instalação e Manutenção de Servidor - IXC Provedor</option><option value="69dd1a025f580676013acf7c">IMP - Aplicativos e Servidores IXC Provedor</option><option value="62fceed199272a70d32a5994">ACS - Suporte - IXC ACS</option><option value="__ALL__">Todos os departamentos</option></select><label class="checkrow" for="waitFiveMinutes"><input id="waitFiveMinutes" type="checkbox"><span>Responsável pela fila — assumir após 5 minutos</span></label><div id="info" class="info">Fila: 0 | Departamento: 0</div><div class="panel-footer"><button id="reportError" type="button" aria-label="reportar erro" title="reportar erro">⚠</button></div></div>`;
      shadowRoot.appendChild(wrap);

      const parts = ui();
      parts.button.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        enabled = !enabled;
        log("Botão AUTO acionado.", {
          enabled,
          fila: queue.length,
          elegiveis: queue.filter(isEligibleItem).length,
          waitFiveMinutes,
          processing
        });
        setButtonState();
        await saveState();
        if (enabled) {
          // Não tenta assumir usando um snapshot antigo. Aguarda uma resposta
          // nova do department:list após pedir a atualização nativa ao IXC.
          queueRefreshPending = true;
          log("AUTO ativado: aguardando atualização nova da fila.");
          postBridge("REQUEST_QUEUE_REFRESH");
        } else {
          queueRefreshPending = false;
        }
      });
      parts.menu.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        parts.panel.hidden = !parts.panel.hidden;
        parts.menu.textContent = parts.panel.hidden ? "⌄" : "⌃";
        parts.menu.setAttribute("aria-expanded", String(!parts.panel.hidden));
        if (!parts.panel.hidden) requestAnimationFrame(positionPanel);
      });
      parts.reportError.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        safeSendMessage({ type: "OPEN_REPORT" });
      });
      parts.select.addEventListener("change", async () => {
        selectedDepartment = parts.select.value;
        await saveState();
        updatePanelInfo();
        if (enabled && !processing) void tryAssumeFromQueue();
      });
      parts.waitBox.addEventListener("change", async () => {
        waitFiveMinutes = parts.waitBox.checked;
        if (!waitFiveMinutes) nextResponsibleAttemptAt = 0;
        await saveState();
        updatePanelInfo();
        if (enabled && !processing) void tryAssumeFromQueue();
      });
    } else {
      if (!shadowRoot) shadowRoot = host.shadowRoot;
      // React pode recriar o grupo N2; mantém o botão como irmão imediatamente abaixo dele.
      if (host.parentElement !== n2Button.parentElement || host.previousElementSibling !== n2Button) {
        n2Button.insertAdjacentElement("afterend", host);
      }
    }

    const { select, waitBox } = ui();
    if (select) select.value = selectedDepartment;
    if (waitBox) waitBox.checked = waitFiveMinutes;
    setButtonState();
    updatePanelInfo();
    positionPanel();
    return true;
  }

  function updateDepartmentOptions() { const {select}=ui(); if(select) select.value=selectedDepartment; }

  function updatePanelInfo(extra = "") {
    const { info } = ui();
    if (!info) return;
    const valid = queue.filter(isEligibleItem).length;
    info.textContent = extra || `Fila: ${queue.length} | Elegíveis: ${valid}${waitFiveMinutes ? " | Responsável: 5 min" : ""}`;
  }

  function isQueueStatusEligible(item) {
    return waitFiveMinutes
      ? norm(item?.status) === "AG"
      : (!item?.status || norm(item.status) === "AG");
  }

  // Espelha exatamente os critérios atuais, sem alterar a elegibilidade.
  function getEligibilityDiagnostic(item, index) {
    const checks = {
      possuiId: Boolean(item?.id),
      statusAceito: isQueueStatusEligible(item),
      departamentoCompativel: matchesDepartment(item),
      tempoMinimoAtendido: !waitFiveMinutes || isFiveMinutesOld(item)
    };
    const reasons = Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);

    return {
      indice: index,
      id: item?.id || "",
      protocolo: item?.protocolo || "",
      statusRecebido: item?.status,
      departamento: item?.departamento,
      departamentoId: item?.departamentoId,
      idAtendente: item?.idAtendente,
      canal: item?.canal,
      filaDesde: item?.filaDesde,
      checks,
      elegivelPelaRegraAtual: reasons.length === 0,
      motivosDeRejeicao: reasons,
      registroCompleto: item
    };
  }

  function logQueueEligibilityDiagnostics() {
    if (!debugEnabled) return;
    const diagnostics = queue.map((item, index) => getEligibilityDiagnostic(item, index));
    console.groupCollapsed(
      `%c OPA ELEGIBILIDADE %c ${diagnostics.filter(item => item.elegivelPelaRegraAtual).length}/${diagnostics.length} elegível(is)`,
      "background:#312e81;color:#fff;font-weight:700;padding:2px 6px;border-radius:3px",
      "color:#6d28d9;font-weight:700"
    );
    console.log("Configuração utilizada:", {
      departamentoSelecionado: selectedDepartment,
      modoResponsavelCincoMinutos: waitFiveMinutes,
      totalNaFila: queue.length
    });
    console.table(diagnostics.map(({ registroCompleto, checks, ...summary }) => ({
      indice: summary.indice,
      id: summary.id,
      protocolo: summary.protocolo,
      status: summary.statusRecebido,
      departamento: summary.departamento,
      departamentoId: summary.departamentoId,
      idAtendente: summary.idAtendente,
      canal: summary.canal,
      possuiId: checks.possuiId,
      statusAceito: checks.statusAceito,
      departamentoCompativel: checks.departamentoCompativel,
      tempoMinimoAtendido: checks.tempoMinimoAtendido,
      elegivel: summary.elegivelPelaRegraAtual,
      motivo: summary.motivosDeRejeicao.join(", ") || "—"
    })));
    console.log("Análise detalhada de cada registro:");
    console.dir(diagnostics, { depth: null });
    console.groupEnd();
  }

  function isEligibleItem(item) {
    return Boolean(
      item?.id &&
      isQueueStatusEligible(item) &&
      matchesDepartment(item) &&
      (!waitFiveMinutes || isFiveMinutesOld(item))
    );
  }

  function matchesDepartment(item) {
    const name = norm(item?.departamento);
    const departmentId = String(item?.departamentoId || "").trim();
    if (selectedDepartment === DEPARTMENT_GROUPS.ALL) return true;
    if (selectedDepartment === DEPARTMENT_GROUPS.SERVERS) return name === norm(SERVER_DEPARTMENT);
    if (selectedDepartment === DEPARTMENT_GROUPS.SUPPORT) {
      return [norm(DEFAULT_DEPARTMENT), norm("SUP - Suporte IXC HUB")].includes(name);
    }
    if (selectedDepartment === IMP_DEPARTMENT_ID) {
      return departmentId === IMP_DEPARTMENT_ID || name === norm(IMP_DEPARTMENT_NAME);
    }
    if (selectedDepartment === ACS_DEPARTMENT_ID) {
      return departmentId === ACS_DEPARTMENT_ID || name === norm(ACS_DEPARTMENT_NAME);
    }
    return name === norm(selectedDepartment);
  }

  function getQueueEntryTimestamp(item) {
    const ts = Date.parse(item?.filaDesde || "");
    return Number.isFinite(ts) ? ts : NaN;
  }

  function isFiveMinutesOld(item) {
    const ts = getQueueEntryTimestamp(item);
    return Number.isFinite(ts) && (Date.now() - ts >= 5 * 60 * 1000);
  }

  function findCandidate() {
    const candidates = queue.filter(isEligibleItem);

    if (!candidates.length) return null;

    if (!waitFiveMinutes) return candidates[0];

    candidates.sort((a, b) => {
      const ta = getQueueEntryTimestamp(a);
      const tb = getQueueEntryTimestamp(b);
      if (!Number.isFinite(ta)) return 1;
      if (!Number.isFinite(tb)) return -1;
      return ta - tb;
    });

    return candidates[0];
  }

  async function tryAssumeFromQueue() {
    if (queueRefreshPending) return;
    if (!enabled || processing || !queue.length) {
      log("Tentativa ignorada.", {
        enabled, processing, queueLength: queue.length
      });
      return;
    }
    if (Date.now() < nextResponsibleAttemptAt) {
      log("Tentativa aguardando a pausa de 3 segundos após a última confirmação.", {
        nextAttemptAt: new Date(nextResponsibleAttemptAt).toISOString()
      });
      return;
    }

    const candidate = findCandidate();
    if (!candidate) {
      log("Nenhum candidato elegível encontrado nesta verificação.", {
        fila: queue.length,
        elegiveis: queue.filter(isEligibleItem).length,
        departamento: selectedDepartment,
        waitFiveMinutes
      });
      return;
    }

    processing = true;
    pendingAssumptionId = candidate.id;
    const requestedAt = Date.now();
    log("Enviando solicitação de assunção ao page-bridge.", {
      id: candidate.id,
      protocolo: candidate.protocolo,
      canal: candidate.canal,
      requestedAt: new Date(requestedAt).toISOString()
    });
    postBridge("ASSUMIR_ATENDIMENTO", {
      id: candidate.id,
      canal: candidate.canal,
      requestedAt
    });

    setTimeout(() => {
      if (processing && pendingAssumptionId === candidate.id) {
        log("Timeout no content.js aguardando confirmação da assunção.", {
          id: candidate.id,
          elapsedMs: Date.now() - requestedAt
        });
        processing = false;
        pendingAssumptionId = null;
        queueRefreshPending = enabled;
        if (enabled) postBridge("REQUEST_QUEUE_REFRESH");
      }
    }, ASSUMPTION_CONFIRMATION_TIMEOUT);
  }

  function startUiWatcher() {
    if (observer) {
      try { observer.disconnect(); } catch (_) {}
    }

    // Observa a montagem/recriação da navegação lateral, não mutações de chat.
    observer = new MutationObserver(records => {
      let relevant = false;
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : null;
        if (target?.closest('[data-sidebar="content"]')) {
          relevant = true;
          break;
        }
        for (const node of record.addedNodes || []) {
          if (!(node instanceof Element)) continue;
          if (
            node.matches('[data-sidebar="content"], [data-sidebar="group"], button.ixc-button.n2-sidebar-docked, #opa-auto-host') ||
            node.querySelector?.('[data-sidebar="content"] button.ixc-button.n2-sidebar-docked')
          ) {
            relevant = true;
            break;
          }
        }
        if (relevant) break;
      }
      if (relevant) scheduleUiUpdate();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", positionPanel, { passive: true });
    createUi();
  }

  async function restoreMonitors() {
    if (!extensionIsAlive()) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_MONITORES" });
      postBridge("RESTORE_MONITORS", { monitors: response?.monitors || {} });
    } catch (_) {}
  }

  async function init() {
    if (window.top !== window.self) return;

    window.addEventListener("message", handleBridgeMessage);
    await loadState();
    // page-bridge.js é instalado no MAIN world em document_start para capturar
    // o primeiro handshake e as respostas Socket.IO da nova interface.
    postBridge("OPA_CONTENT_READY");
    injectPageBridge();
    startUiWatcher();
    startQueueTimeUpdater();

    setTimeout(() => {
      injectPageBridge();
      void restoreMonitors();
    }, 500);

    // Os 3 segundos são exclusivamente uma verificação da fila em memória.
    // Nenhuma requisição ou emissão Socket.IO é realizada por este intervalo.
    setInterval(() => {
      if (!extensionIsAlive()) return;
      if (enabled && !processing) void tryAssumeFromQueue();
    }, CHECK_INTERVAL);
  }

  init();
})();
