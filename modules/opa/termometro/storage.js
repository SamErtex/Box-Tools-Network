(() => {
  "use strict";
  const T = window.BoxOpaTermometro;
  if (!T) throw new Error("[OPA Termômetro] Configuração não carregada para storage.");

  const KEY = "boxOpaTermometroHumorCache";
  const CACHE_CHANGED_MESSAGE = "BOX_OPA_TERMOMETRO_CACHE_CHANGED";
  const MAX_CACHE_BYTES = 4 * 1024 * 1024;
  const MAX_CACHE_RECORDS = 100;
  const MAX_MESSAGE_CHARS = 5000;
  let dados = {};
  let carregado = false;
  let promessaCarga = null;
  let timerSalvar = null;

  function apiDisponivel() {
    try { return typeof chrome !== "undefined" && !!chrome.storage?.local; }
    catch (_) { return false; }
  }
  function contextoValido() {
    try { return typeof chrome !== "undefined" && !!chrome.runtime?.id; }
    catch (_) { return false; }
  }
  function ttlMs() { return Math.max(1, Number(T.CONFIG.HUMOR_CACHE_HORAS || 24)) * 3600000; }
  function expiraEm(valor) {
    const ts = Number(valor?.ts);
    if (!Number.isFinite(ts) || ts <= 0) return 0;
    const expira = Number(valor?.expiresAt);
    return Number.isFinite(expira) && expira > 0 ? expira : ts + ttlMs();
  }
  function serializarDetalhes(resultado) {
    const janela = Math.max(1, Number(T.CONFIG.HUMOR_JANELA || 7));
    if (!Array.isArray(resultado?.detalhes)) return [];
    return resultado.detalhes.slice(-janela).map(item => ({
      texto: String(item?.texto ?? "").slice(0, MAX_MESSAGE_CHARS),
      score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null,
      mapeada: !!item?.mapeada,
      sinais: Array.isArray(item?.sinais) ? item.sinais.slice(0, 20).map(s => String(s).slice(0, 250)) : []
    }));
  }
  function tamanhoBytes() {
    try { return new TextEncoder().encode(JSON.stringify(dados)).length; }
    catch (_) { return JSON.stringify(dados).length * 2; }
  }
  function limparExpirados() {
    const agora = Date.now();
    let alterou = false;
    for (const [id, valor] of Object.entries(dados)) {
      if (!valor || expiraEm(valor) <= agora) {
        delete dados[id];
        alterou = true;
      }
    }
    return alterou;
  }
  function limitarCache() {
    let alterou = false;
    const maisAntigos = () => Object.entries(dados)
      .sort((a, b) => Number(a[1]?.ts || 0) - Number(b[1]?.ts || 0));
    while (Object.keys(dados).length > MAX_CACHE_RECORDS || tamanhoBytes() > MAX_CACHE_BYTES) {
      const primeiro = maisAntigos()[0];
      if (!primeiro) break;
      delete dados[primeiro[0]];
      alterou = true;
    }
    return alterou;
  }
  function avisarAgendador() {
    if (!contextoValido() || typeof chrome.runtime.sendMessage !== "function") return;
    try {
      chrome.runtime.sendMessage({ type: CACHE_CHANGED_MESSAGE }, () => {
        const erro = chrome.runtime?.lastError;
        if (erro && !/receiving end does not exist/i.test(erro.message || "")) {
          console.warn("[OPA Termômetro] Não foi possível atualizar o agendamento de expiração:", erro.message);
        }
      });
    } catch (erro) {
      console.warn("[OPA Termômetro] Falha ao notificar o service worker:", erro);
    }
  }
  function salvar() {
    if (!apiDisponivel()) return;
    clearTimeout(timerSalvar);
    timerSalvar = setTimeout(() => {
      if (!contextoValido()) return;
      try {
        chrome.storage.local.set({ [KEY]: dados }, () => {
          const erro = chrome.runtime?.lastError;
          if (erro) {
            console.warn("[OPA Termômetro] Não foi possível salvar o cache:", erro.message);
            return;
          }
          avisarAgendador();
        });
      } catch (erro) {
        console.warn("[OPA Termômetro] Falha ao salvar o cache:", erro);
      }
    }, 250);
  }
  function carregar() {
    if (promessaCarga) return promessaCarga;
    promessaCarga = new Promise(resolve => {
      if (!apiDisponivel()) { carregado = true; resolve(false); return; }
      try {
        chrome.storage.local.get(KEY, resultado => {
          const erro = chrome.runtime?.lastError;
          if (erro) console.warn("[OPA Termômetro] Não foi possível ler o cache:", erro.message);
          const bruto = resultado && resultado[KEY];
          dados = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {};
          const alterou = limparExpirados() | limitarCache();
          carregado = true;
          if (alterou) salvar();
          else avisarAgendador();
          resolve(!erro);
        });
      } catch (erro) {
        console.warn("[OPA Termômetro] Falha ao carregar o cache:", erro);
        carregado = true;
        resolve(false);
      }
    });
    return promessaCarga;
  }
  function getHumor(id) {
    if (!id) return null;
    const chave = String(id);
    const valor = dados[chave];
    if (!valor) return null;
    if (expiraEm(valor) <= Date.now()) {
      delete dados[chave];
      salvar();
      return null;
    }
    return valor;
  }
  function limparHumor(id) {
    if (!id) return;
    const chave = String(id);
    if (Object.prototype.hasOwnProperty.call(dados, chave)) {
      delete dados[chave];
      salvar();
    }
  }
  function setHumor(id, resultado) {
    if (!id || !resultado) return;
    limparExpirados();
    const chave = String(id);
    const atual = dados[chave];
    const detalhes = serializarDetalhes(resultado);
    const novoDetalhes = JSON.stringify(detalhes);
    const detalhesAtuais = JSON.stringify(Array.isArray(atual?.detalhes) ? atual.detalhes : []);
    const categoria = String(resultado.categoria || "desconhecido");
    const media = Number(Number(resultado.media || 0).toFixed(2));
    const n = detalhes.length;
    if (atual && atual.categoria === categoria && Number(atual.media) === media &&
        Number(atual.n) === n && detalhesAtuais === novoDetalhes && expiraEm(atual) > Date.now()) {
      return;
    }
    const ts = Date.now();
    dados[chave] = { categoria, media, n, ts, expiresAt: ts + ttlMs(), detalhes };
    limitarCache();
    salvar();
  }
  T.storage = { carregar, getHumor, setHumor, limparHumor, get carregado() { return carregado; } };
})();
