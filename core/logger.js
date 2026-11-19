// CORE — logger padronizado para os módulos da extensão.
(() => {
  "use strict";
  const levels = ["debug", "info", "warn", "error"];
  const logger = {};
  for (const level of levels) {
    logger[level] = (scope, ...args) => {
      const prefix = `[${String(scope || "CORE").toUpperCase()}]`;
      console[level](prefix, ...args);
    };
  }
  globalThis.BoxCore = globalThis.BoxCore || {};
  globalThis.BoxCore.logger = Object.freeze(logger);
})();
