(() => {
  "use strict";

  // Revela visualmente campos de senha conforme a preferência do usuário,
  // exclusivamente nas rotas /adm.php e /app/login.
  if (globalThis.__BOX_TOOLS_AUTO_PASSWORD_REVEAL__) return;
  globalThis.__BOX_TOOLS_AUTO_PASSWORD_REVEAL__ = true;

  const STORAGE_KEY = "boxToolsAutoPasswordReveal";
  let enabled = false;
  let preferenceRevision = 0;

  function isAllowedPath() {
    try {
      // Verifica apenas o caminho, não query string nem fragmento.
      // Aceita as rotas mesmo quando estão sob um prefixo de aplicação.
      const pathname = String(location.pathname || "/");
      return /(?:^|\/)adm\.php(?:\/|$)/i.test(pathname) ||
        /(?:^|\/)app\/login(?:\/|$)/i.test(pathname);
    } catch (_) {
      return false;
    }
  }

  function reveal(input) {
    if (!isAllowedPath() || !enabled || !(input instanceof HTMLInputElement)) return;
    if ((input.getAttribute("type") || "").toLowerCase() !== "password") return;
    try {
      input.dataset.boxToolsPasswordRevealed = "true";
      input.type = "text";
    } catch (error) {
      console.debug("[Box Tools Network] Não foi possível revelar um campo password.", error);
    }
  }

  function conceal(input) {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.boxToolsPasswordRevealed !== "true") return;
    try {
      delete input.dataset.boxToolsPasswordRevealed;
      input.type = "password";
    } catch (error) {
      console.debug("[Box Tools Network] Não foi possível ocultar novamente um campo password.", error);
    }
  }

  function scan(root) {
    if (!root) return;
    if (!isAllowedPath()) {
      concealAll(root);
      return;
    }
    if (!enabled) return;
    if (root instanceof HTMLInputElement) reveal(root);
    if (typeof root.querySelectorAll !== "function") return;
    root.querySelectorAll('input[type="password"]').forEach(reveal);
    root.querySelectorAll("*").forEach(element => {
      if (element.shadowRoot) scan(element.shadowRoot);
    });
  }

  function concealAll(root) {
    if (!root) return;
    if (root instanceof HTMLInputElement) conceal(root);
    if (typeof root.querySelectorAll !== "function") return;
    root.querySelectorAll('input[data-box-tools-password-revealed="true"]').forEach(conceal);
    root.querySelectorAll("*").forEach(element => {
      if (element.shadowRoot) concealAll(element.shadowRoot);
    });
  }

  function refreshForCurrentUrl() {
    if (!isAllowedPath()) concealAll(document);
    else if (enabled) scan(document);
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") {
        if (!isAllowedPath() || !enabled) conceal(record.target);
        else reveal(record.target);
      }
      if (record.type === "childList") {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) scan(node);
        }
      }
    }
  });

  function applyState(nextEnabled) {
    enabled = nextEnabled === true;
    if (enabled && isAllowedPath()) scan(document);
    else concealAll(document);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) return;
    preferenceRevision++;
    applyState(changes[STORAGE_KEY].newValue !== false);
  });

  async function initialize() {
    const revisionAtStart = preferenceRevision;
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      if (revisionAtStart === preferenceRevision) applyState(stored[STORAGE_KEY] !== false);
    } catch (error) {
      applyState(true);
      console.warn("[Box Tools Network] Não foi possível carregar a preferência de senhas.", error);
    }
  }

  function start() {
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["type"]
      });
    }
    window.addEventListener("popstate", refreshForCurrentUrl);
    window.addEventListener("hashchange", refreshForCurrentUrl);
    // Detecta mudanças de URL em aplicações SPA que usam History API.
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      if (typeof original !== "function") continue;
      try {
        history[method] = function(...args) {
          const result = original.apply(this, args);
          queueMicrotask(refreshForCurrentUrl);
          return result;
        };
      } catch (_) {}
    }
    initialize();
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
