(() => {
  "use strict";
  const T = window.BoxOpaTermometro;
  if (!T) throw new Error("[OPA Termômetro] Configuração não carregada.");

  T.termometro = (() => {
    const CLS = "box-opa-humor-selo";
    const TOOLTIP = "box-opa-humor-tooltip-lista";
    const POPOVER = "box-opa-humor-mensagens-flutuante";
    let tooltip = null;
    let mensagensPopover = null;
    let atendimentoAtivo = null;
    let resultadoAtivo = null;
    let seloAtivo = null;
    let botaoAjudaAtivo = null;
    let timerEsconder = null;
    let timerEsconderMensagens = null;

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>\"]/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
      }[ch]));
    }
    function obterDetalhes(dados) {
      if (dados?.aoVivo && Array.isArray(dados.resultado?.detalhes)) return dados.resultado.detalhes;
      return Array.isArray(dados?.detalhes) ? dados.detalhes : [];
    }
    function montarListaMensagens(detalhes) {
      if (!detalhes.length) return "<div class=\"box-opa-humor-sem-detalhes\">Mensagens não disponíveis para esta avaliação.</div>";
      const linhas = detalhes.map((item, indice) => {
        const mapeada = !!item.mapeada;
        const score = Number(item.score);
        const nota = mapeada && Number.isFinite(score) ? `${score > 0 ? "+" : ""}${score.toFixed(1)}` : "?";
        const classe = !mapeada ? "q" : score <= -0.8 ? "neg" : score >= 1.3 ? "top" : score >= 0.5 ? "pos" : "neu";
        const texto = String(item.texto || "");
        const sinais = Array.isArray(item.sinais) ? item.sinais.join(" · ") : "";
        return `<li><span class="box-opa-humor-nota box-opa-humor-nota--${classe}">${nota}</span>` +
          `<span class="box-opa-humor-mensagem-texto"><b>${indice + 1}.</b> ${escapeHtml(texto || "[Mensagem sem texto]")}` +
          `${sinais ? `<small>${escapeHtml(sinais)}</small>` : ""}</span></li>`;
      });
      return `<b class="box-opa-humor-mensagens-titulo">Mensagens consideradas (${detalhes.length})</b><ul>${linhas.join("")}</ul>`;
    }
    function montarTooltip(dados, cat) {
      const detalhes = obterDetalhes(dados);
      const temDetalhes = detalhes.length > 0;
      const quantidade = Number(dados.n ?? detalhes.length ?? 0);
      const tituloData = dados.aoVivo ? "Avaliação atual" : dados.ts ? `Medido em ${formatarHora(dados.ts)}` : "Avaliação";
      const media = Number(dados.media || 0).toFixed(2);
      const ajuda = `<button type="button" class="box-opa-humor-ajuda" aria-label="Ver mensagens consideradas" ${temDetalhes ? "" : "disabled"}>?</button>`;
      const instrucoes = temDetalhes ? "Passe o mouse no ? para conferir as mensagens analisadas." :
        "O histórico desta avaliação não está disponível. Abra o atendimento para gerar novamente.";
      return `<div class="box-opa-humor-tooltip-titulo" style="color:${escapeHtml(cat.cor || "#9e9e9e")}">${cat.emoji || "?"} ${escapeHtml(cat.label || "Não analisado")}</div>` +
        `<div class="box-opa-humor-tooltip-data">${escapeHtml(tituloData)} · ${quantidade} mensagens</div>` +
        `<div class="box-opa-humor-tooltip-rodape"><span>Média: ${media} · Termômetro v${escapeHtml(T.VERSION)}</span>${ajuda}</div>` +
        `<div class="box-opa-humor-tooltip-instrucao">${escapeHtml(instrucoes)}</div>`;
    }
    function dadosDoCard(id) {
      if (resultadoAtivo && atendimentoAtivo && String(id) === String(atendimentoAtivo)) {
        return { categoria: resultadoAtivo.categoria, media: Number(resultadoAtivo.media || 0), n: resultadoAtivo.detalhes?.length || 0, aoVivo: true, resultado: resultadoAtivo };
      }
      const salvo = T.storage?.getHumor(id);
      if (salvo) return { ...salvo, aoVivo: false, salvo: true };
      return { categoria: "desconhecido", media: 0, n: 0, aoVivo: false, salvo: false };
    }
    function cancelarEsconder() {
      clearTimeout(timerEsconder);
      timerEsconder = null;
    }
    function cancelarEsconderMensagens() {
      clearTimeout(timerEsconderMensagens);
      timerEsconderMensagens = null;
    }
    function garantirTooltip() {
      if (tooltip && tooltip.isConnected) return tooltip;
      tooltip = document.createElement("div");
      tooltip.id = TOOLTIP;
      tooltip.className = TOOLTIP;
      tooltip.setAttribute("data-box-opa-termometro", "");
      tooltip.style.display = "none";
      tooltip.addEventListener("mouseenter", cancelarEsconder);
      tooltip.addEventListener("mouseleave", agendarEsconder);
      document.body.appendChild(tooltip);
      return tooltip;
    }
    function garantirMensagensPopover() {
      if (mensagensPopover && mensagensPopover.isConnected) return mensagensPopover;
      mensagensPopover = document.createElement("div");
      mensagensPopover.id = POPOVER;
      mensagensPopover.className = POPOVER;
      mensagensPopover.setAttribute("data-box-opa-termometro", "");
      mensagensPopover.style.display = "none";
      mensagensPopover.addEventListener("mouseenter", cancelarEsconderMensagens);
      mensagensPopover.addEventListener("mouseleave", agendarEsconderMensagens);
      document.body.appendChild(mensagensPopover);
      return mensagensPopover;
    }
    function formatarHora(ts) {
      return new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    function posicionarFlutuante(elemento, ancora, preferirDireita = true) {
      const rect = ancora.getBoundingClientRect();
      const gap = 8;
      const width = elemento.offsetWidth;
      let left = preferirDireita ? rect.right + gap : rect.left - width - gap;
      if (left + width > window.innerWidth - 8) left = rect.left - width - gap;
      if (left < 8) left = Math.min(window.innerWidth - width - 8, rect.right + gap);
      left = Math.max(8, left);
      const height = elemento.offsetHeight;
      let top = rect.top - 4;
      if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
      top = Math.max(8, top);
      elemento.style.left = `${left}px`;
      elemento.style.top = `${top}px`;
    }
    function esconderMensagensPopover() {
      if (mensagensPopover) mensagensPopover.style.display = "none";
      botaoAjudaAtivo = null;
    }
    function mostrarMensagensPopover(botao, detalhes) {
      cancelarEsconderMensagens();
      botaoAjudaAtivo = botao;
      const pop = garantirMensagensPopover();
      pop.innerHTML = montarListaMensagens(detalhes);
      pop.style.display = "block";
      posicionarFlutuante(pop, botao, true);
    }
    function agendarEsconderMensagens() {
      cancelarEsconderMensagens();
      timerEsconderMensagens = setTimeout(() => {
        const mouseNoBotao = botaoAjudaAtivo?.matches(":hover") || document.activeElement === botaoAjudaAtivo;
        const mouseNaLista = mensagensPopover?.matches(":hover");
        if (!mouseNoBotao && !mouseNaLista) {
          esconderMensagensPopover();
          const mouseNoSelo = seloAtivo?.matches(":hover");
          const mouseNoTooltip = tooltip?.matches(":hover");
          if (!mouseNoSelo && !mouseNoTooltip) esconderTooltip();
        }
      }, 220);
    }
    function ligarBotaoAjuda(dados) {
      const botao = tooltip?.querySelector(".box-opa-humor-ajuda");
      if (!botao || botao.disabled) return;
      const detalhes = obterDetalhes(dados);
      botao.addEventListener("mouseenter", () => mostrarMensagensPopover(botao, detalhes));
      botao.addEventListener("mouseleave", agendarEsconderMensagens);
      botao.addEventListener("focus", () => mostrarMensagensPopover(botao, detalhes));
      botao.addEventListener("blur", agendarEsconderMensagens);
    }
    function agendarEsconder() {
      cancelarEsconder();
      timerEsconder = setTimeout(() => {
        const mouseNoSelo = seloAtivo?.matches(":hover");
        const mouseNoTooltip = tooltip?.matches(":hover");
        const mouseNaLista = mensagensPopover?.matches(":hover");
        if (!mouseNoSelo && !mouseNoTooltip && !mouseNaLista) esconderTooltip();
      }, 220);
    }
    function mostrarTooltip(event) {
      cancelarEsconder();
      const selo = event.currentTarget;
      seloAtivo = selo;
      const id = selo.dataset.id;
      const dados = dadosDoCard(id);
      const cat = T.humor.CATEGORIAS[dados.categoria] || T.humor.CATEGORIAS.desconhecido;
      const tip = garantirTooltip();
      tip.innerHTML = montarTooltip(dados, cat);
      tip.style.display = "block";
      ligarBotaoAjuda(dados);
      const rect = selo.getBoundingClientRect();
      const width = tip.offsetWidth;
      let left = rect.right + 8;
      if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 8);
      const top = Math.max(8, Math.min(rect.top - 8, window.innerHeight - tip.offsetHeight - 8));
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    }
    function esconderTooltip() {
      esconderMensagensPopover();
      if (tooltip) tooltip.style.display = "none";
      seloAtivo = null;
    }
    function criarSelo() {
      const selo = document.createElement("div");
      selo.className = CLS;
      selo.setAttribute("data-box-opa-termometro", "");
      selo.innerHTML = `<span class="${CLS}__emoji" aria-hidden="true">?</span>` +
        `<span class="${CLS}__barra"><span class="${CLS}__fill"></span></span>`;
      selo.addEventListener("mouseenter", mostrarTooltip);
      selo.addEventListener("mouseleave", agendarEsconder);
      selo.addEventListener("click", event => event.stopPropagation());
      return selo;
    }
    function posicionar(card, selo) {
      const conteudo = card.querySelector("button > div.flex-col") || card.querySelector("button") || card;
      const etiquetas = conteudo.querySelector(":scope > .flex-wrap");
      if (etiquetas) etiquetas.after(selo);
      else conteudo.appendChild(selo);
    }
    function atualizarSelo(card, id) {
      let selo = card.querySelector(`.${CLS}`);
      if (!selo || !selo.isConnected) { selo = criarSelo(); posicionar(card, selo); }
      const dados = dadosDoCard(id);
      const categoria = dados.categoria;
      const cat = T.humor.CATEGORIAS[categoria] || T.humor.CATEGORIAS.desconhecido;
      const media = Number(dados.media || 0);
      const assinatura = `${id}|${categoria}|${media.toFixed(2)}|${dados.aoVivo ? 1 : 0}|${dados.ts || 0}|${dados.n || 0}`;
      if (selo.dataset.assinatura === assinatura) return;
      selo.dataset.assinatura = assinatura;
      selo.dataset.id = String(id);
      selo.dataset.categoria = categoria;
      selo.dataset.atendimentoAtivo = dados.aoVivo ? "true" : "false";
      selo.style.setProperty("--box-opa-humor-cor", cat.cor || "#9e9e9e");
      selo.querySelector(`.${CLS}__emoji`).textContent = cat.emoji || "?";
      selo.querySelector(`.${CLS}__fill`).style.height = `${T.percentual({ categoria, media })}%`;
      selo.setAttribute("aria-label", `Humor do cliente: ${cat.label || "Não analisado"}`);
    }
    function render(resultado) {
      atendimentoAtivo = T.dom.getAtendimentoId();
      resultadoAtivo = atendimentoAtivo && resultado ? resultado : null;
      if (atendimentoAtivo && resultadoAtivo) T.storage?.setHumor(atendimentoAtivo, resultadoAtivo);
      document.querySelectorAll(".box-opa-humor-slot, #box-opa-humor-termometro").forEach(el => el.remove());
      const cards = T.dom.getListCards();
      if (!cards.length) { T.log("Lista", "Nenhum cartão encontrado pelo seletor da lista lateral."); return false; }
      cards.forEach(card => {
        const id = card.getAttribute("itemid");
        if (id) atualizarSelo(card, id);
      });
      return true;
    }
    return { render };
  })();
})();
