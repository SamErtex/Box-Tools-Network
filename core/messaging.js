// CORE — helpers de comunicação entre service worker e abas.
(() => {
  "use strict";
  async function sendToTab(tabId, message) {
    if (!Number.isInteger(tabId) || tabId < 0) return false;
    try { await chrome.tabs.sendMessage(tabId, message); return true; }
    catch (_) { return false; }
  }
  globalThis.BoxCore = globalThis.BoxCore || {};
  globalThis.BoxCore.messaging = Object.freeze({ sendToTab });
})();
