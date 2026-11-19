// Validador de IP da Box Tools Network.
// Captura conexões somente enquanto o usuário está na tela Validador de IP.
// Conceito de visualização por hostname inspirado no IPvFoo (Paul Marks, Apache-2.0).
"use strict";

const IPVFOO_STORAGE_PREFIX = "boxToolsIpvFoo:tab:";
const IPVFOO_ACTIVE_PREFIX = "boxToolsIpvFoo:active:";
const IPVFOO_MAX_HOSTS = 256;
const IPVFOO_MAX_IPS_PER_HOST = 6;
const IPVFOO_MAX_ACTIVE_TABS = 8;
const IPVFOO_HEARTBEAT_TTL_MS = 7000;
const IPVFOO_REFRESH_TTL_MS = 60000;
const IPVFOO_STATE_WRITE_DELAY_MS = 800;
const IPVFOO_ACTIVE_WRITE_DELAY_MS = 1800;
const ipvfooTabCache = new Map();
const ipvfooActiveTabs = new Map();
const ipvfooWriteQueues = new Map();
const ipvfooStateWriteTimers = new Map();
const ipvfooActiveWriteTimers = new Map();
const ipvfooStateRevision = new Map();
const IPVFOO_FILTER = { urls: ["http://*/*", "https://*/*"] };
let ipvfooActivationLoaded = false;

function ipvfooParseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return {
      host: (url.hostname || url.host || "").toLowerCase(),
      protocol: url.protocol,
      secure: url.protocol === "https:",
      origin: url.origin
    };
  } catch (_) {
    return null;
  }
}

function ipvfooCreatePageState(tabId, rawUrl) {
  const parsed = ipvfooParseUrl(rawUrl);
  const now = Date.now();
  return {
    tabId,
    pageHost: parsed?.host || "",
    pageProtocol: parsed?.protocol || "",
    pageIp: "",
    startedAt: now,
    updatedAt: now,
    totalRequests: 0,
    domains: Object.create(null)
  };
}

function ipvfooStateKey(tabId) {
  return IPVFOO_STORAGE_PREFIX + tabId;
}
function ipvfooActiveKey(tabId) {
  return IPVFOO_ACTIVE_PREFIX + tabId;
}

const ipvfooActivationReady = chrome.storage.session.get(null).then(async all => {
  const now = Date.now();
  const staleKeys = [];
  const validActiveTabs = new Set();
  for (const [key, value] of Object.entries(all || {})) {
    if (!key.startsWith(IPVFOO_ACTIVE_PREFIX)) continue;
    const tabId = Number(key.slice(IPVFOO_ACTIVE_PREFIX.length));
    if (!Number.isInteger(tabId) || tabId < 0 || !value || value.expiresAt <= now) {
      staleKeys.push(key);
      continue;
    }
    validActiveTabs.add(tabId);
    ipvfooActiveTabs.set(tabId, {
      expiresAt: value.expiresAt,
      refreshPending: value.refreshPending === true,
      createdAt: value.createdAt || now,
      lastActivityAt: value.lastActivityAt || now,
      lastPersistAt: now
    });
  }
  // Limpa capturas antigas de versões anteriores que já não têm ativação válida.
  for (const key of Object.keys(all || {})) {
    if (!key.startsWith(IPVFOO_STORAGE_PREFIX)) continue;
    const tabId = Number(key.slice(IPVFOO_STORAGE_PREFIX.length));
    if (!Number.isInteger(tabId) || !validActiveTabs.has(tabId)) staleKeys.push(key);
  }
  if (staleKeys.length) await chrome.storage.session.remove([...new Set(staleKeys)]).catch(() => {});
  ipvfooActivationLoaded = true;
}).catch(error => {
  ipvfooActivationLoaded = true;
  console.warn("[Box Tools IP] Não foi possível restaurar a captura ativa:", error);
});

async function ipvfooSaveActiveNow(tabId) {
  const active = ipvfooActiveTabs.get(tabId);
  if (!active) {
    await chrome.storage.session.remove(ipvfooActiveKey(tabId)).catch(() => {});
    return;
  }
  active.lastPersistAt = Date.now();
  await chrome.storage.session.set({
    [ipvfooActiveKey(tabId)]: {
      expiresAt: active.expiresAt,
      refreshPending: active.refreshPending === true,
      createdAt: active.createdAt,
      lastActivityAt: active.lastActivityAt
    }
  });
}

function ipvfooScheduleActivePersist(tabId, immediate = false) {
  if (immediate) {
    const old = ipvfooActiveWriteTimers.get(tabId);
    if (old) clearTimeout(old);
    ipvfooActiveWriteTimers.delete(tabId);
    void ipvfooSaveActiveNow(tabId).catch(error => console.warn("[Box Tools IP] Falha ao salvar a ativação:", error));
    return;
  }
  if (ipvfooActiveWriteTimers.has(tabId)) return;
  const timer = setTimeout(() => {
    ipvfooActiveWriteTimers.delete(tabId);
    void ipvfooSaveActiveNow(tabId).catch(error => console.warn("[Box Tools IP] Falha ao salvar a ativação:", error));
  }, IPVFOO_ACTIVE_WRITE_DELAY_MS);
  ipvfooActiveWriteTimers.set(tabId, timer);
}

function ipvfooBumpRevision(tabId) {
  ipvfooStateRevision.set(tabId, (ipvfooStateRevision.get(tabId) || 0) + 1);
  const timer = ipvfooStateWriteTimers.get(tabId);
  if (timer) clearTimeout(timer);
  ipvfooStateWriteTimers.delete(tabId);
  return ipvfooStateRevision.get(tabId);
}

function ipvfooSnapshot(state) {
  return JSON.parse(JSON.stringify(state));
}

function ipvfooScheduleStatePersist(tabId, immediate = false) {
  const state = ipvfooTabCache.get(tabId);
  if (!state) return;
  if (!ipvfooActiveTabs.has(tabId)) return;
  const revision = ipvfooStateRevision.get(tabId) || 0;

  const persist = () => {
    const current = ipvfooTabCache.get(tabId);
    if (!current || !ipvfooActiveTabs.has(tabId) || (ipvfooStateRevision.get(tabId) || 0) !== revision) return Promise.resolve();
    let snapshot;
    try { snapshot = ipvfooSnapshot(current); }
    catch (error) { return Promise.reject(error); }
    const previous = ipvfooWriteQueues.get(tabId) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (!ipvfooActiveTabs.has(tabId) || (ipvfooStateRevision.get(tabId) || 0) !== revision) return;
      await chrome.storage.session.set({ [ipvfooStateKey(tabId)]: snapshot });
    });
    ipvfooWriteQueues.set(tabId, next);
    next.finally(() => {
      if (ipvfooWriteQueues.get(tabId) === next) ipvfooWriteQueues.delete(tabId);
    }).catch(error => console.warn("[Box Tools IP] Falha ao salvar captura:", error));
    return next;
  };

  const old = ipvfooStateWriteTimers.get(tabId);
  if (immediate) {
    if (old) clearTimeout(old);
    ipvfooStateWriteTimers.delete(tabId);
    return persist();
  }
  // Uma gravação pendente já cobre todas as novas respostas recebidas antes
  // do prazo; não reinicia o timer a cada requisição.
  if (old) return;
  const timer = setTimeout(() => {
    ipvfooStateWriteTimers.delete(tabId);
    persist();
  }, IPVFOO_STATE_WRITE_DELAY_MS);
  ipvfooStateWriteTimers.set(tabId, timer);
}

async function ipvfooLoad(tabId) {
  if (ipvfooTabCache.has(tabId)) return ipvfooTabCache.get(tabId);
  const key = ipvfooStateKey(tabId);
  try {
    const stored = await chrome.storage.session.get(key);
    const state = stored[key];
    if (state && state.tabId === tabId && state.domains && typeof state.domains === "object") {
      ipvfooTabCache.set(tabId, state);
      return state;
    }
  } catch (error) {
    console.warn("[Box Tools IP] Falha ao recuperar captura de IP:", error);
  }
  return null;
}

async function ipvfooDeactivate(tabId) {
  const activeTimer = ipvfooActiveWriteTimers.get(tabId);
  if (activeTimer) clearTimeout(activeTimer);
  ipvfooActiveWriteTimers.delete(tabId);
  ipvfooActiveTabs.delete(tabId);
  ipvfooBumpRevision(tabId);
  const queue = ipvfooWriteQueues.get(tabId);
  if (queue) await queue.catch(() => {});
  ipvfooWriteQueues.delete(tabId);
  ipvfooTabCache.delete(tabId);
  ipvfooStateRevision.delete(tabId);
  await chrome.storage.session.remove([ipvfooStateKey(tabId), ipvfooActiveKey(tabId)]).catch(() => {});
}

async function ipvfooGetActive(tabId, cleanupExpired = true) {
  await ipvfooActivationReady;
  const active = ipvfooActiveTabs.get(tabId);
  if (!active) return null;
  if (active.expiresAt <= Date.now()) {
    if (cleanupExpired) await ipvfooDeactivate(tabId);
    return null;
  }
  return active;
}

async function ipvfooTouchActive(tabId) {
  const active = await ipvfooGetActive(tabId);
  if (!active) return null;
  active.lastActivityAt = Date.now();
  if (!active.refreshPending) active.expiresAt = Date.now() + IPVFOO_HEARTBEAT_TTL_MS;
  else active.expiresAt = Math.max(active.expiresAt, Date.now() + IPVFOO_REFRESH_TTL_MS);
  if (Date.now() - (active.lastPersistAt || 0) >= IPVFOO_ACTIVE_WRITE_DELAY_MS) ipvfooScheduleActivePersist(tabId);
  return active;
}


async function ipvfooEnforceActiveLimit(exceptTabId) {
  await ipvfooActivationReady;
  // O validador fica ativo somente nas abas onde a tela foi aberta. Limita
  // também sessões simultâneas em várias janelas do Chrome.
  for (const [tabId, active] of [...ipvfooActiveTabs.entries()]) {
    if (active.expiresAt <= Date.now()) await ipvfooDeactivate(tabId);
  }
  while (ipvfooActiveTabs.size >= IPVFOO_MAX_ACTIVE_TABS && !ipvfooActiveTabs.has(exceptTabId)) {
    const oldest = [...ipvfooActiveTabs.entries()]
      .filter(([tabId]) => tabId !== exceptTabId)
      .sort((a, b) => (a[1].lastActivityAt || 0) - (b[1].lastActivityAt || 0))[0];
    if (!oldest) break;
    await ipvfooDeactivate(oldest[0]);
  }
}

async function ipvfooResetState(tabId, url, immediate = false) {
  ipvfooBumpRevision(tabId);
  const state = ipvfooCreatePageState(tabId, url);
  ipvfooTabCache.set(tabId, state);
  if (immediate) await ipvfooScheduleStatePersist(tabId, true);
  else ipvfooScheduleStatePersist(tabId);
  return state;
}

function ipvfooEnsureDomain(state, parsed) {
  let domain = state.domains[parsed.host];
  if (!domain) {
    const keys = Object.keys(state.domains);
    if (keys.length >= IPVFOO_MAX_HOSTS) {
      const candidate = keys
        .filter(host => host !== state.pageHost)
        .sort((a, b) => (state.domains[a].lastSeen || 0) - (state.domains[b].lastSeen || 0))[0];
      if (!candidate) return null;
      delete state.domains[candidate];
    }
    domain = state.domains[parsed.host] = {
      host: parsed.host,
      secure: parsed.secure,
      requests: 0,
      lastType: "",
      lastSeen: Date.now(),
      ips: Object.create(null)
    };
  }
  domain.secure = domain.secure || parsed.secure;
  return domain;
}

async function ipvfooCaptureResponse(details) {
  if (!Number.isInteger(details.tabId) || details.tabId < 0) return;
  const active = await ipvfooGetActive(details.tabId);
  if (!active) return;
  const tabId = details.tabId;
  const parsed = ipvfooParseUrl(details.url);
  if (!parsed) return;

  let state = ipvfooTabCache.get(tabId) || await ipvfooLoad(tabId);
  if (!state) state = await ipvfooResetState(tabId, details.documentUrl || details.initiator || details.url, true);
  // O usuário pode ter saído do validador enquanto o estado era carregado.
  if (!await ipvfooGetActive(tabId) || !ipvfooTabCache.has(tabId)) return;
  const currentState = ipvfooTabCache.get(tabId);
  if (state !== currentState) return;

  if (details.type === "main_frame") {
    state.pageHost = parsed.host;
    state.pageProtocol = parsed.protocol;
    state.pageIp = typeof details.ip === "string" ? details.ip : "";
  }

  const domain = ipvfooEnsureDomain(state, parsed);
  if (!domain) return;
  const now = Number.isFinite(details.timeStamp) ? details.timeStamp : Date.now();
  domain.requests += 1;
  domain.lastType = String(details.type || "outro");
  domain.lastSeen = now;

  const ip = typeof details.ip === "string" ? details.ip.trim() : "";
  if (ip) {
    if (!domain.ips[ip] && Object.keys(domain.ips).length >= IPVFOO_MAX_IPS_PER_HOST) {
      const oldestIp = Object.keys(domain.ips).sort((a, b) => domain.ips[a].lastSeen - domain.ips[b].lastSeen)[0];
      if (oldestIp) delete domain.ips[oldestIp];
    }
    const ipData = domain.ips[ip] || (domain.ips[ip] = { ip, requests: 0, lastSeen: now, type: String(details.type || "outro") });
    ipData.requests += 1;
    ipData.lastSeen = now;
    ipData.type = String(details.type || "outro");
    if (details.type === "main_frame") state.pageIp = ip;
  }

  state.totalRequests += 1;
  state.updatedAt = Date.now();
  ipvfooTabCache.set(tabId, state);
  ipvfooScheduleStatePersist(tabId);
}

async function ipvfooHandleMainFrame(details) {
  if (!Number.isInteger(details.tabId) || details.tabId < 0) return;
  const active = await ipvfooGetActive(details.tabId);
  if (!active) return;
  await ipvfooResetState(details.tabId, details.url, true);
}

chrome.webRequest.onBeforeRequest.addListener(details => {
  // O listener permanece registrado conforme exigido pelo ciclo de vida do MV3,
  // mas quando não há captura ativa retorna sem ler, agregar ou persistir dados.
  if (ipvfooActivationLoaded && !ipvfooActiveTabs.has(details.tabId)) return;
  ipvfooHandleMainFrame(details).catch(error => console.warn("[Box Tools IP] Não foi possível iniciar captura da navegação:", error));
}, IPVFOO_FILTER);

chrome.webRequest.onResponseStarted.addListener(details => {
  if (ipvfooActivationLoaded && !ipvfooActiveTabs.has(details.tabId)) return;
  ipvfooCaptureResponse(details).catch(error => console.warn("[Box Tools IP] Erro ao processar resposta:", error));
}, IPVFOO_FILTER);

chrome.tabs.onRemoved.addListener(tabId => {
  void ipvfooDeactivate(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = Number(message?.tabId);
  if (!message || !String(message.type || "").startsWith("IPVFOO_")) return;

  (async () => {
    await ipvfooActivationReady;
    if (message.type === "IPVFOO_START_CAPTURE") {
      if (!Number.isInteger(tabId) || tabId < 0) {
        sendResponse({ ok: false, error: "Não foi possível identificar a aba atual." });
        return;
      }
      const now = Date.now();
      const existingRawActivation = ipvfooActiveTabs.get(tabId);
      if (existingRawActivation && existingRawActivation.expiresAt <= now) await ipvfooDeactivate(tabId);
      const existingActivation = await ipvfooGetActive(tabId, false);
      const retainedAfterRefresh = Boolean(existingActivation?.refreshPending && existingActivation.expiresAt > now);
      let state = null;
      if (retainedAfterRefresh) state = await ipvfooLoad(tabId);
      if (!state) state = await ipvfooResetState(tabId, message.url || "", true);
      if (!existingActivation || !retainedAfterRefresh) await ipvfooEnforceActiveLimit(tabId);
      const active = retainedAfterRefresh
        ? existingActivation
        : { createdAt: now, refreshPending: false, lastPersistAt: 0 };
      active.refreshPending = false;
      active.expiresAt = now + IPVFOO_HEARTBEAT_TTL_MS;
      active.lastActivityAt = now;
      ipvfooActiveTabs.set(tabId, active);
      await ipvfooSaveActiveNow(tabId);
      await ipvfooScheduleStatePersist(tabId, true);
      sendResponse({ ok: true, data: state, retainedAfterRefresh });
      return;
    }

    if (message.type === "IPVFOO_GET_TAB_DATA") {
      if (!Number.isInteger(tabId) || tabId < 0) {
        sendResponse({ ok: false, error: "Não foi possível identificar a aba atual." });
        return;
      }
      const active = await ipvfooTouchActive(tabId);
      if (!active) {
        sendResponse({ ok: false, error: "A captura está pausada. Abra o Validador de IP para iniciar." });
        return;
      }
      const data = await ipvfooLoad(tabId);
      sendResponse({ ok: true, data });
      return;
    }

    if (message.type === "IPVFOO_STOP_CAPTURE") {
      if (Number.isInteger(tabId) && tabId >= 0) await ipvfooDeactivate(tabId);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "IPVFOO_RESET_CAPTURE_FOR_REFRESH") {
      if (!Number.isInteger(tabId) || tabId < 0) {
        sendResponse({ ok: false, error: "Não foi possível identificar a aba atual." });
        return;
      }
      const now = Date.now();
      if (!ipvfooActiveTabs.has(tabId)) await ipvfooEnforceActiveLimit(tabId);
      const active = ipvfooActiveTabs.get(tabId) || { createdAt: now, lastPersistAt: 0 };
      active.refreshPending = true;
      active.expiresAt = now + IPVFOO_REFRESH_TTL_MS;
      active.lastActivityAt = now;
      ipvfooActiveTabs.set(tabId, active);
      await ipvfooResetState(tabId, message.url || "", true);
      await ipvfooSaveActiveNow(tabId);
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Ação do Validador de IP desconhecida." });
  })().catch(error => {
    console.error("[Box Tools IP] Erro no comando do validador:", error);
    sendResponse({ ok: false, error: "Não foi possível controlar a captura de IP." });
  });
  return true;
});
