(() => {
  "use strict";
  const T = window.BoxOpaTermometro;
  const SEL = {
    chat: "[data-customer-service-id]",
    header: '[data-tutorial="chat-header"]',
    messages: '[data-message-id][data-sender-type]',
    cardLista: '[data-tutorial="customer-service-list"] li[itemid]'
  };
  const norm = (value) => (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  function chat() { return document.querySelector(SEL.chat); }
  function getAtendimentoId() {
    return chat()?.getAttribute("data-customer-service-id") || null;
  }
  function getMessageDate(message) {
    const raw = message?.getAttribute("data-message-date");
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  function mensagens() {
    const root = chat();
    if (!root) return [];
    return Array.from(root.querySelectorAll(SEL.messages))
      .map((element, index) => ({ element, index, time: getMessageDate(element)?.getTime() ?? 0 }))
      .sort((a, b) => a.time - b.time || a.index - b.index)
      .map(item => item.element);
  }
  function getMessageText(message) {
    if (!message) return "";
    const clone = message.cloneNode(true);
    let transcript = "";

    clone.querySelectorAll(".bubble-media-min").forEach(player => {
      player.querySelectorAll("p").forEach(paragraph => {
        const text = paragraph.textContent.trim();
        if (!text || /^\d{1,2}:\d{2}(:\d{2})?$/.test(text) || paragraph.classList.contains("absolute")) return;
        transcript += " " + text.replace(/^[“\"']\s*/, "").replace(/\s*[”\"']$/, "");
      });
      player.remove();
    });

    clone.querySelectorAll('[data-quoted-message-id], [data-reply-to], [class*="quote"], [class*="reply"], .bubble-media, a.flex, audio, img, video')
      .forEach(element => element.remove());

    const transcriptBlocks = new Set(clone.querySelectorAll('[id^="transcricao-"]'));
    clone.querySelectorAll("p, div, span").forEach(element => {
      if (/^\s*transcri[cç][aã]o\s*:/i.test(element.textContent) && !element.querySelector("p, div")) {
        transcriptBlocks.add(element);
      }
    });
    transcriptBlocks.forEach(block => {
      const copy = block.cloneNode(true);
      copy.querySelectorAll("a, button").forEach(element => element.remove());
      transcript += " " + copy.textContent
        .replace(/^\s*transcri[cç][aã]o\s*:\s*/i, "")
        .replace(/\.\.\.\s*$/, "");
      block.remove();
    });

    const parts = Array.from(clone.querySelectorAll(".whitespace-pre-wrap"))
      .map(element => element.textContent);
    return (parts.join(" ") + " " + transcript)
      .replace(/\.\.\.\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function getCampoInfo(label) {
    const panel = document.querySelector('[data-tutorial="chat-panel-information"]');
    if (!panel) return null;
    const wanted = norm(label);
    for (const paragraph of panel.querySelectorAll("p")) {
      if (norm(paragraph.textContent) !== wanted) continue;
      const row = paragraph.parentElement;
      const value = row && Array.from(row.children).find(child => child !== paragraph);
      if (value) return value.textContent.replace(/\s+/g, " ").trim();
    }
    return null;
  }
  function getInicioAtendimento() {
    const value = getCampoInfo("Aberto em");
    const match = value && value.match(/(\d{2})\/(\d{2})\/(\d{4})\D+(\d{2}):(\d{2})/);
    return match ? new Date(+match[3], +match[2] - 1, +match[1], +match[4], +match[5]).getTime() - 60000 : null;
  }
  function getSequencia() {
    const start = getInicioAtendimento();
    return mensagens()
      .filter(element => element.getAttribute("data-sender-type") !== "system")
      .filter(element => {
        const date = getMessageDate(element);
        return !start || !date || date.getTime() >= start;
      })
      .map(element => ({
        el: element,
        tipo: element.getAttribute("data-sender-type") === "contact" ? "cliente" : "atendente"
      }));
  }

  // Cartões renderizados na lista lateral do OPA (interface nova).
  function getListCards() {
    return Array.from(document.querySelectorAll(SEL.cardLista));
  }


  T.dom = { SEL, getAtendimentoId, getMessageText, getSequencia, getListCards };
})();
