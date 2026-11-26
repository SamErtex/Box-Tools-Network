const MONITORS_KEY = "opaMonitoredAttendances";
const ALARM_PREFIX = "opa-5min-";
const REPORT_URL = "https://ixcsoftgrupo.slack.com/team/U09V3JZ6Z8E";

async function getMonitors() {
  try {
    const data = await BoxCore.storage.get(MONITORS_KEY);
    const monitors = data[MONITORS_KEY] || {};
    let changed = false;
    // Limpa registros concluídos por versões anteriores, quando uma interação
    // cancelou o alarme mas deixou o objeto persistido.
    for (const [id, monitor] of Object.entries(monitors)) {
      if (!monitor || monitor.communicated === true || monitor.alertSent === true) {
        delete monitors[id];
        changed = true;
        void chrome.alarms.clear(ALARM_PREFIX + id).catch(() => {});
      }
    }
    if (changed) await BoxCore.storage.set({ [MONITORS_KEY]: monitors });
    return monitors;
  } catch (_) {
    return {};
  }
}

async function saveMonitors(monitors) {
  await BoxCore.storage.set({ [MONITORS_KEY]: monitors });
}

async function notify(title, message) {
  return BoxCore.notifications.create({ title, message, iconUrl: "icon128.png", priority: 2, clearAfterMs: 8000 });
}

async function showInTab(tabId, title, message) {
  return BoxCore.messaging.sendToTab(tabId, { type: "OPA_SHOW_NOTIFICATION", title, message });
}

async function addMonitor(record, sender) {
  if (!record?.id) return;

  const monitors = await getMonitors();
  const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
  const monitor = {
    id: record.id,
    protocolo: record.protocolo || record.id,
    idAtendente: record.idAtendente || "",
    departamento: record.departamento || "",
    canal: record.canal || "",
    assumidoEm: record.assumidoEm || Date.now(),
    tabId,
    communicated: false,
    alertSent: false
  };

  monitors[record.id] = monitor;
  await saveMonitors(monitors);

  const alarmName = ALARM_PREFIX + record.id;
  try {
    await chrome.alarms.clear(alarmName);
    await chrome.alarms.create(alarmName, { delayInMinutes: 5 });
  } catch (error) {
    console.error("[OPA Auto] Falha ao agendar alerta de 5 minutos:", error);
  }

  // Ordem restaurada para o comportamento da versão funcional anterior:
  // primeiro garante o alarme de 5 minutos e depois envia a notificação imediata.
  const title = "OPA Auto Atendimento";
  const message = `Atendimento ${monitor.protocolo} assumido com sucesso.`;
  await notify(title, message);
  await showInTab(tabId, title, message);
}

async function markCommunicated(record) {
  if (!record?.id) return;

  const monitors = await getMonitors();
  if (!monitors[record.id]) {
    await chrome.alarms.clear(ALARM_PREFIX + record.id);
    return;
  }

  // A primeira mensagem válida conclui o monitor: cancela o alarme e remove
  // o registro, em vez de mantê-lo até o prazo original de cinco minutos.
  delete monitors[record.id];
  await saveMonitors(monitors);
  await chrome.alarms.clear(ALARM_PREFIX + record.id);
}

async function removeMonitor(id) {
  if (!id) return;
  const monitors = await getMonitors();
  if (!monitors[id]) return;
  delete monitors[id];
  await saveMonitors(monitors);
  await chrome.alarms.clear(ALARM_PREFIX + id);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.type === "ATENDIMENTO_ASSUMIDO") {
    addMonitor(message.record, sender).catch(console.error);
    return;
  }

  if (message.type === "ATENDENTE_COMUNICOU") {
    markCommunicated(message.record).catch(console.error);
    return;
  }

  if (message.type === "ATENDIMENTO_TRANSFERIDO" && message.id) {
    removeMonitor(message.id).catch(console.error);
    return;
  }

  if (message.type === "GET_MONITORES") {
    getMonitors()
      .then(monitors => sendResponse({ monitors }))
      .catch(() => sendResponse({ monitors: {} }));
    return true;
  }

  if (message.type === "OPEN_REPORT") {
    chrome.tabs.create({ url: REPORT_URL }).catch(() => {});
    return;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;

  const id = alarm.name.slice(ALARM_PREFIX.length);
  const monitors = await getMonitors();
  const monitor = monitors[id];

  if (!monitor) return;

  if (monitor.communicated || monitor.alertSent) {
    delete monitors[id];
    await saveMonitors(monitors);
    await chrome.alarms.clear(alarm.name);
    return;
  }

  const title = "OPA Auto Atendimento";
  const message = `O atendimento ${monitor.protocolo} foi assumido há 5 minutos e ainda não possui mensagem do atendente.`;

  monitor.alertSent = true;
  await saveMonitors(monitors);
  await notify(title, message);
  await showInTab(monitor.tabId, title, message);

  delete monitors[id];
  await saveMonitors(monitors);
  await chrome.alarms.clear(alarm.name);
});
