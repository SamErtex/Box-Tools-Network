(() => {
  "use strict";
  const T = window.BoxOpaTermometro;
  if (!T || T.__started) return;
  T.__started = true;

  let currentId = null;
  let observer = null;
  let debounce = null;
  let fallback = null;

  function removeIndicator() {
    document.getElementById("box-opa-humor-termometro")?.remove();
  }

  function refresh(origin = "observer") {
    const id = T.dom.getAtendimentoId();
    if (id !== currentId) {
      T.log("Main", `Atendimento alterado: ${currentId || "nenhum"} → ${id || "nenhum"}`);
      currentId = id;
      removeIndicator();
      if (id) T.storage?.limparHumor(id);
    }

    try {
      // Só recalcula quando o DOM já contém mensagens do atendimento.
      // Sem atendimento aberto, render(null) exibe os resultados persistidos nos cartões.
      const mensagensCarregadas = !!id && T.dom.getSequencia().length > 0;
      const result = mensagensCarregadas ? T.humor.analisarAtendimento() : null;
      T.termometro.render(result);
      if (result) {
        T.log("Humor", `${result.emoji} ${result.label} (média ${result.media.toFixed(2)})`, result.detalhes);
      }
    } catch (error) {
      console.error("[OPA Termômetro] Falha ao atualizar o humor:", error);
    }
  }

  function schedule(origin) {
    clearTimeout(debounce);
    debounce = setTimeout(() => refresh(origin), T.CONFIG.DEBOUNCE_MS);
  }

  function isOwnMutation(mutation) {
    if (T.isOwnNode(mutation.target)) return true;
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.length > 0 && nodes.every(node => T.isOwnNode(node));
  }

  function start() {
    if (!document.body || observer) return;
    observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => !isOwnMutation(mutation))) schedule("observer");
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    fallback = setInterval(() => refresh("fallback"), T.CONFIG.FALLBACK_INTERVAL);
    refresh("boot");
    console.info(`[OPA Termômetro] Módulo de humor carregado v${T.VERSION}`);
  }

  async function boot() {
    try {
      await T.storage.carregar();
    } catch (error) {
      console.warn("[OPA Termômetro] Cache indisponível; usando somente a sessão atual:", error);
    }
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  }

  boot();
})();
