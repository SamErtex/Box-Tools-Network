(() => {
  "use strict";
  const T = window.BoxOpaTermometro = window.BoxOpaTermometro || {};
  T.VERSION = "7.0.3";
  T.CONFIG = {
    DEBUG: false,
    HUMOR_JANELA: 7,
    HUMOR_PESOS_RECENCIA: [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4],
    HUMOR_LIMIAR_ESTRESSADO: -0.8,
    HUMOR_LIMIAR_SATISFEITO: 0.5,
    HUMOR_LIMIAR_FOGUETE: 1.3,
    HUMOR_FOGUETE_MIN_MSGS: 2,
    HUMOR_GATILHO_ULTIMA: -1.5,
    HUMOR_ESTRESSE_RECENTE_MSGS: 3,
    HUMOR_GATILHO_POSITIVO_ULTIMAS: 2,
    HUMOR_GATILHO_POSITIVO_MIN: 0.7,
    HUMOR_CACHE_HORAS: 24,
    DEBOUNCE_MS: 500,
    FALLBACK_INTERVAL: 3000
  };
  T.log = (scope, ...args) => {
    if (T.CONFIG.DEBUG) console.log(`[OPA Termômetro][${scope}]`, ...args);
  };
  T.isOwnNode = (node) => {
    const element = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(element?.closest?.("[data-box-opa-termometro]"));
  };
  T.percentual = (resultado) => {
    if (!resultado || resultado.categoria === "desconhecido" || resultado.categoria === "encantado") return 100;
    const percentual = ((resultado.media + 2) / 4) * 100;
    const faixa = {
      estressado: [12, 30],
      neutro: [32, 62],
      satisfeito: [68, 92]
    }[resultado.categoria] || [8, 100];
    return Math.max(faixa[0], Math.min(faixa[1], percentual));
  };
})();
