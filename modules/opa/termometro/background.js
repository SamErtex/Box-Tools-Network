(() => {
  "use strict";
  if (typeof chrome === "undefined" || !chrome.alarms || !chrome.storage?.local) return;

  const KEY = "boxOpaTermometroHumorCache";
  const ALARM = "box-opa-termometro-cache-expiration";
  const CHANGE_MESSAGE = "BOX_OPA_TERMOMETRO_CACHE_CHANGED";
  const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

  function expiry(value) {
    const ts = Number(value?.ts);
    if (!Number.isFinite(ts) || ts <= 0) return 0;
    const explicit = Number(value?.expiresAt);
    return Number.isFinite(explicit) && explicit > 0 ? explicit : ts + DEFAULT_TTL_MS;
  }
  function schedule(nextExpiry) {
    if (!Number.isFinite(nextExpiry)) {
      chrome.alarms.clear(ALARM);
      return;
    }
    // O alarme único é sempre definido para o primeiro registro que vencer.
    // Chrome pode postergar alarmes durante suspensão do equipamento; ao retomar,
    // o evento executa a limpeza atrasada imediatamente.
    const when = Math.max(nextExpiry, Date.now() + 60 * 1000);
    chrome.alarms.clear(ALARM, () => {
      void chrome.runtime?.lastError;
      chrome.alarms.create(ALARM, { when });
    });
  }
  function limparEAgendar() {
    chrome.storage.local.get(KEY, resultado => {
      const erro = chrome.runtime?.lastError;
      if (erro) {
        console.warn("[OPA Termômetro] Falha ao consultar cache para expiração:", erro.message);
        return;
      }
      const bruto = resultado && resultado[KEY];
      const cache = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {};
      const agora = Date.now();
      let removeu = false;
      let proxima = Infinity;
      for (const [id, valor] of Object.entries(cache)) {
        const vence = expiry(valor);
        if (!vence || vence <= agora) {
          delete cache[id];
          removeu = true;
        } else if (vence < proxima) {
          proxima = vence;
        }
      }
      const agendar = () => schedule(Number.isFinite(proxima) ? proxima : NaN);
      if (removeu) {
        chrome.storage.local.set({ [KEY]: cache }, () => {
          const erroGravacao = chrome.runtime?.lastError;
          if (erroGravacao) console.warn("[OPA Termômetro] Falha ao remover registros vencidos:", erroGravacao.message);
          agendar();
        });
      } else {
        agendar();
      }
    });
  }

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm?.name === ALARM) limparEAgendar();
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== CHANGE_MESSAGE) return false;
    limparEAgendar();
    if (typeof sendResponse === "function") sendResponse({ ok: true });
    return false;
  });
  chrome.runtime.onInstalled.addListener(limparEAgendar);
  chrome.runtime.onStartup.addListener(limparEAgendar);

  // Reconstroi o agendamento se o service worker iniciar ou for acordado novamente.
  limparEAgendar();
})();
