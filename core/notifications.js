// CORE — notificações nativas compartilhadas.
(() => {
  "use strict";
  async function create({ title, message, iconUrl = "icon128.png", priority = 2, clearAfterMs = 8000 }) {
    try {
      const permission = await chrome.notifications.getPermissionLevel();
      if (permission !== "granted") {
        globalThis.BoxCore?.logger?.warn("CORE", "Notificações indisponíveis:", permission);
        return false;
      }
      const notificationId = await chrome.notifications.create(undefined, {
        type: "basic", iconUrl: chrome.runtime.getURL(iconUrl), title, message, priority
      });
      if (Number.isFinite(clearAfterMs) && clearAfterMs > 0) {
        setTimeout(() => {
          chrome.notifications.clear(notificationId).catch(error => {
            globalThis.BoxCore?.logger?.warn?.("CORE", "Falha ao limpar notificação:", error);
          });
        }, clearAfterMs);
      }
      return true;
    } catch (error) {
      globalThis.BoxCore?.logger?.error?.("CORE", "Falha ao criar notificação:", error);
      return false;
    }
  }
  globalThis.BoxCore = globalThis.BoxCore || {};
  globalThis.BoxCore.notifications = Object.freeze({ create });
})();
