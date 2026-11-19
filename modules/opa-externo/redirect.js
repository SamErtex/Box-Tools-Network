(() => {
  "use strict";

  // Atua exclusivamente na lista de chaves identificada pelo HTML do IXC:
  // .listagemChavesLogins > links com title="Abrir link".
  // A URL/IP varia por cliente; o destino é sempre a origem do link + /adm.php.
  if (window.__BOX_TOOLS_KEY_LINK_REDIRECT_V617__) return;
  window.__BOX_TOOLS_KEY_LINK_REDIRECT_V617__ = true;

  const LINK_SELECTOR = '.listagemChavesLogins a[title="Abrir link"][href]';
  const SOURCE_ATTR = "data-box-tools-source-href";
  const REDIRECTED_ATTR = "data-box-tools-redirected";
  const IPV4_EXACT_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

  function normalizeText(value) {
    return String(value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseHttpUrl(value) {
    try {
      const parsed = new URL(value, document.baseURI);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function linkLabel(anchor) {
    return normalizeText(anchor.textContent || anchor.innerText || "");
  }

  function getSourceHref(anchor) {
    const currentHref = anchor.getAttribute("href") || anchor.href || "";
    const current = parseHttpUrl(currentHref);
    const savedSource = anchor.getAttribute(SOURCE_ATTR);

    // Se o link já foi alterado, recupera a URL de origem salva.
    if (savedSource) {
      const saved = parseHttpUrl(savedSource);
      if (saved && current && current.href === `${saved.origin}/adm.php`) {
        return saved.href;
      }
    }

    const label = linkLabel(anchor);

    // O link de URL base aparece com a URL visível dentro do próprio <a>.
    const visibleUrlMatch = label.match(/^https?:\/\/[^\s<>"']+$/i);
    if (visibleUrlMatch) {
      const visibleUrl = parseHttpUrl(visibleUrlMatch[0]);
      if (visibleUrl) return visibleUrl.href;
    }

    // O link do IP aparece como IPv4 visível; preserve protocolo e porta do href.
    if (IPV4_EXACT_RE.test(label)) {
      if (current && current.hostname === label) return current.href;
      return `http://${label}`;
    }

    // Só é elegível se o href for HTTP(S). O seletor já limita a lista de chaves.
    return current ? current.href : null;
  }

  function destinationFromSource(sourceHref) {
    const source = parseHttpUrl(sourceHref);
    if (!source) return null;
    return `${source.origin}/adm.php`;
  }

  function isTargetLink(anchor) {
    if (!(anchor instanceof HTMLAnchorElement) || !anchor.matches(LINK_SELECTOR)) return false;
    const label = linkLabel(anchor);
    return Boolean(
      /^https?:\/\/[^\s<>"']+$/i.test(label) || IPV4_EXACT_RE.test(label)
    );
  }

  function rewriteLink(anchor) {
    if (!isTargetLink(anchor)) return;

    const sourceHref = getSourceHref(anchor);
    const destination = destinationFromSource(sourceHref);
    if (!sourceHref || !destination) return;

    const current = parseHttpUrl(anchor.getAttribute("href") || anchor.href || "");
    if (current && current.href === destination) {
      if (!anchor.hasAttribute(SOURCE_ATTR)) anchor.setAttribute(SOURCE_ATTR, sourceHref);
      anchor.setAttribute(REDIRECTED_ATTR, "true");
      return;
    }

    // Guarda o endereço original para suportar re-renderizações do widget.
    if (!anchor.hasAttribute(SOURCE_ATTR)) anchor.setAttribute(SOURCE_ATTR, sourceHref);
    anchor.setAttribute(REDIRECTED_ATTR, "true");
    anchor.setAttribute("href", destination);
    console.info("[Box Tools Network] Link de chave redirecionado:", linkLabel(anchor), "→", destination);
  }

  function scanLinks(scope = document) {
    if (!scope) return;
    if (scope instanceof HTMLAnchorElement) {
      if (isTargetLink(scope)) rewriteLink(scope);
      return;
    }

    // Não percorre o documento inteiro nas mutações comuns do chat. Só examina
    // a lista de chaves ou os nós novos que foram inseridos dentro dela.
    if (scope instanceof Element && scope.closest(".listagemChavesLogins")) {
      if (scope.matches(LINK_SELECTOR)) rewriteLink(scope);
      if (scope.querySelectorAll) scope.querySelectorAll(LINK_SELECTOR).forEach(rewriteLink);
      return;
    }

    if (scope.querySelectorAll) scope.querySelectorAll(LINK_SELECTOR).forEach(rewriteLink);
  }

  function attachListObserver(list) {
    if (!(list instanceof Element) || listObservers.has(list)) return;
    scanLinks(list);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLAnchorElement) {
          if (isTargetLink(record.target)) rewriteLink(record.target);
          continue;
        }
        for (const node of record.addedNodes || []) {
          if (node instanceof Element) scanLinks(node);
        }
      }
    });
    observer.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["href", "title"]
    });
    listObservers.set(list, observer);
  }

  function discoverLists(scope = document) {
    if (!scope) return;
    if (scope instanceof Element) {
      if (scope.matches(".listagemChavesLogins")) attachListObserver(scope);
      if (scope.matches(".dialog_panel")) {
        scope.querySelectorAll(".listagemChavesLogins").forEach(attachListObserver);
      } else if (scope.closest(".dialog_panel")) {
        scope.querySelectorAll?.(".listagemChavesLogins").forEach(attachListObserver);
      }
    }
    if (scope.querySelectorAll) scope.querySelectorAll(".listagemChavesLogins").forEach(attachListObserver);
  }

  const listObservers = new Map();
  discoverLists(document);

  // Observador leve apenas descobre quando o painel/lista de chaves aparece ou
  // é substituído. A inspeção de href/title fica no observador local da lista.
  const discoveryObserver = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : null;
      const inDialog = Boolean(target?.closest(".dialog_panel"));
      for (const node of record.addedNodes || []) {
        if (!(node instanceof Element)) continue;
        // Busca descendentes somente quando foi inserido um contêiner plausível
        // de diálogo/lista; mensagens comuns do chat não são varridas.
        if (node.matches(".dialog, .chat, .dialog_panel, .listagemChavesLogins")) {
          discoverLists(node);
        } else if (inDialog) {
          // Dentro do painel, examina apenas o nó adicionado, não toda a caixa.
          discoverLists(node);
          scanLinks(node);
        }
      }
    }
    for (const [list, observer] of listObservers) {
      if (!list.isConnected) {
        observer.disconnect();
        listObservers.delete(list);
      }
    }
  });

  if (document.body) discoveryObserver.observe(document.body, { subtree: true, childList: true });
  else document.addEventListener("DOMContentLoaded", () => {
    discoverLists(document);
    if (document.body) discoveryObserver.observe(document.body, { subtree: true, childList: true });
  }, { once: true });

  // Nova interface Next.js do OPA: a URL e o IP externo são botões React,
  // não links <a>. Intercepta apenas as linhas rotuladas URL/IP externo no
  // painel de detalhes e bloqueia o onClick original antes de copiar/abrir.
  const DETAIL_REDIRECT_GUARD = "__BOX_TOOLS_NEW_OPA_DETAIL_REDIRECT_V700__";
  if (!window[DETAIL_REDIRECT_GUARD]) {
    window[DETAIL_REDIRECT_GUARD] = true;

    function isIPv4(value) {
      return /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(value);
    }

    function isIPv6(value) {
      if (!value || !value.includes(":")) return false;
      try {
        const candidate = value.startsWith("[") ? value : `[${value}]`;
        const parsed = new URL(`http://${candidate}/`);
        return parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]");
      } catch (_) {
        return false;
      }
    }

    function buildUrlDestination(value) {
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        return `${parsed.protocol}//${parsed.host}/adm.php`;
      } catch (_) {
        return null;
      }
    }

    function buildIpDestination(value) {
      const raw = normalizeText(value);
      let parsed;
      try {
        if (/^https?:\/\//i.test(raw)) {
          parsed = new URL(raw);
          const host = parsed.hostname.replace(/^\[|\]$/g, "");
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
          if (!isIPv4(host) && !isIPv6(host)) return null;
          return `${parsed.protocol}//${parsed.host}/adm.php`;
        }

        const hostInput = raw.includes(":") && !raw.startsWith("[") && isIPv6(raw)
          ? `[${raw}]`
          : raw;
        parsed = new URL(`http://${hostInput}`);
        const host = parsed.hostname.replace(/^\[|\]$/g, "");
        if (!isIPv4(host) && !isIPv6(host)) return null;
        return `http://${parsed.host}/adm.php`;
      } catch (_) {
        return null;
      }
    }

    function handleNewDetailClick(event) {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      const button = target?.closest("button");
      if (!button) return;

      const row = button.parentElement;
      if (!(row instanceof HTMLDivElement) || !row.classList.contains("flex") || !row.classList.contains("items-center") || !row.classList.contains("justify-between")) return;

      const labelElement = Array.from(row.children).find(child => child instanceof HTMLParagraphElement);
      const label = normalizeText(labelElement?.textContent || "");
      if (label !== "URL" && label !== "IP externo") return;

      const value = normalizeText(button.querySelector("p")?.textContent || button.textContent || "");
      let destination = null;

      if (label === "URL" && button.classList.contains("group/url")) {
        destination = buildUrlDestination(value);
      } else if (label === "IP externo" && button.classList.contains("group/copy")) {
        destination = buildIpDestination(value);
      }

      if (!destination) return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();

      // window.open permanece dentro do gesto real do usuário e abre uma nova aba.
      window.open(destination, "_blank", "noopener,noreferrer");
    }

    document.addEventListener("click", handleNewDetailClick, true);
  }

})();
