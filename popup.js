document.addEventListener('DOMContentLoaded', async () => {
  const homeView = document.getElementById('homeView');
  const ipView = document.getElementById('ipView');
  const validateIp = document.getElementById('validateIp');
  const backHome = document.getElementById('backHome');
  const refreshIp = document.getElementById('refreshIp');
  const devTools = document.getElementById('devTools');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const autoRevealPasswords = document.getElementById('autoRevealPasswords');
  const passwordRevealStatusDot = document.getElementById('passwordRevealStatusDot');
  const passwordRevealStatusText = document.getElementById('passwordRevealStatusText');
  const message = document.getElementById('message');
  const versionElement = document.getElementById('extensionVersion');
  let activeTabId = null;
  let activeTabUrl = '';
  let refreshTimer = null;
  let refreshing = false;
  let refreshInProgress = false;
  let preserveCaptureOnUnload = false;

  if (versionElement) versionElement.textContent = `Box Tools Network v${chrome.runtime.getManifest().version}`;

  const renderDevToolsState = enabled => {
    statusDot.classList.toggle('on', enabled);
    statusText.textContent = enabled ? 'Dev Tools ativado' : 'Dev Tools desativado';
  };
  const stored = await chrome.storage.local.get([
    'opaDevToolsEnabled',
    'boxToolsAutoPasswordReveal'
  ]);
  devTools.checked = stored.opaDevToolsEnabled !== false;
  renderDevToolsState(devTools.checked);

  const renderPasswordRevealState = enabled => {
    passwordRevealStatusDot.classList.toggle('on', enabled);
    passwordRevealStatusText.textContent = enabled
      ? 'Revelação automática ativada'
      : 'Revelação automática desativada';
  };

  // Comportamento padrão compatível com a versão anterior: ativado, a menos que o usuário desligue.
  autoRevealPasswords.checked = stored.boxToolsAutoPasswordReveal !== false;
  renderPasswordRevealState(autoRevealPasswords.checked);
  if (typeof stored.boxToolsAutoPasswordReveal === 'undefined') {
    await chrome.storage.local.set({ boxToolsAutoPasswordReveal: true });
  }

  autoRevealPasswords.addEventListener('change', async () => {
    const enabled = autoRevealPasswords.checked;
    try {
      await chrome.storage.local.set({ boxToolsAutoPasswordReveal: enabled });
      renderPasswordRevealState(enabled);
      message.className = 'message ok';
      message.textContent = enabled
        ? 'Revelação automática de senhas ativada.'
        : 'Revelação automática desativada; campos revelados voltaram a ficar ocultos.';
    } catch (error) {
      autoRevealPasswords.checked = !enabled;
      renderPasswordRevealState(!enabled);
      message.className = 'message error';
      message.textContent = 'Não foi possível salvar a preferência de senhas.';
    }
    setTimeout(() => { message.textContent = ''; message.className = 'message'; }, 2200);
  });

  devTools.addEventListener('change', async () => {
    await chrome.storage.local.set({ opaDevToolsEnabled: devTools.checked });
    renderDevToolsState(devTools.checked);
    message.className = 'message ok';
    message.textContent = devTools.checked ? 'Dev Tools ativado. Recarregando a página…' : 'Dev Tools desativado. Recarregando a página…';
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs?.[0];
      if (Number.isInteger(tab?.id)) chrome.tabs.reload(tab.id);
    });
    setTimeout(() => { message.textContent = ''; message.className = 'message'; }, 1400);
  });

  function family(ip) {
    if (!ip) return '';
    if (ip.includes(':')) return 'IPv6';
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return 'IPv4';
    return 'IP';
  }
  function makeBadge(text, extraClass = '') {
    const span = document.createElement('span');
    span.className = `badge ${extraClass}`.trim();
    span.textContent = text;
    return span;
  }
  function makeIpLine(ipData) {
    const line = document.createElement('div');
    line.className = 'ip-line';
    line.appendChild(makeBadge(family(ipData.ip), family(ipData.ip) === 'IPv4' ? 'v4' : family(ipData.ip) === 'IPv6' ? 'v6' : ''));
    const value = document.createElement('span');
    value.className = 'ip-address';
    value.textContent = ipData.ip;
    line.appendChild(value);
    const requests = document.createElement('span');
    requests.className = 'ip-req';
    requests.textContent = `${ipData.requests || 0} req.`;
    line.appendChild(requests);
    return line;
  }
  function renderIpData(data) {
    const hostFromTab = (() => {
      try { return new URL(activeTabUrl).hostname; } catch (_) { return ''; }
    })();
    const currentHost = data?.pageHost || hostFromTab || 'Página atual';
    document.getElementById('pageHost').textContent = currentHost;
    const protocol = data?.pageProtocol || (() => { try { return new URL(activeTabUrl).protocol; } catch (_) { return ''; } })();
    const protocolBadge = document.getElementById('pageProtocol');
    protocolBadge.textContent = protocol ? protocol.replace(':', '').toUpperCase() : '—';
    protocolBadge.className = `badge ${protocol === 'https:' ? 'secure' : protocol === 'http:' ? 'insecure' : ''}`.trim();

    const pageIp = data?.pageIp || '';
    const pageFamily = document.getElementById('pageFamily');
    pageFamily.textContent = pageIp ? family(pageIp) : 'IP não identificado';
    pageFamily.className = `badge ${family(pageIp) === 'IPv4' ? 'v4' : family(pageIp) === 'IPv6' ? 'v6' : ''}`.trim();
    document.getElementById('pageIp').textContent = pageIp;

    const domains = Object.values(data?.domains || {});
    const ipSet = new Set();
    for (const domain of domains) for (const ip of Object.keys(domain.ips || {})) ipSet.add(ip);
    document.getElementById('statDomains').textContent = String(domains.length);
    document.getElementById('statIps').textContent = String(ipSet.size);
    document.getElementById('statRequests').textContent = String(data?.totalRequests || 0);

    const list = document.getElementById('domainList');
    list.replaceChildren();
    domains.sort((a, b) => {
      if (a.host === currentHost) return -1;
      if (b.host === currentHost) return 1;
      return (b.requests || 0) - (a.requests || 0) || a.host.localeCompare(b.host);
    });
    if (!domains.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nenhuma conexão foi capturada ainda. Clique em ↻ para recarregar a página e registrar as conexões desta navegação.';
      list.appendChild(empty);
    } else {
      for (const domain of domains) {
        const row = document.createElement('article');
        row.className = 'domain-row';
        const head = document.createElement('div');
        head.className = 'domain-head';
        const name = document.createElement('div');
        name.className = 'domain-name';
        name.textContent = domain.host;
        head.appendChild(name);
        const meta = document.createElement('div');
        meta.className = 'domain-meta';
        meta.appendChild(makeBadge(domain.secure ? 'HTTPS' : 'HTTP', domain.secure ? 'secure' : 'insecure'));
        meta.appendChild(makeBadge(`${domain.requests || 0} req.`));
        head.appendChild(meta);
        row.appendChild(head);

        const ipWrap = document.createElement('div');
        ipWrap.className = 'domain-ips';
        const ips = Object.values(domain.ips || {}).sort((a, b) => (b.requests || 0) - (a.requests || 0) || (b.lastSeen || 0) - (a.lastSeen || 0));
        if (ips.length) ips.forEach(ip => ipWrap.appendChild(makeIpLine(ip)));
        else {
          const noIp = document.createElement('div');
          noIp.className = 'ip-line';
          noIp.innerHTML = '<span class="badge">IP</span><span class="ip-address">Endereço não informado pelo navegador</span>';
          ipWrap.appendChild(noIp);
        }
        row.appendChild(ipWrap);
        list.appendChild(row);
      }
    }
    document.getElementById('ipUpdated').textContent = data?.updatedAt ? `Atualizado às ${new Date(data.updatedAt).toLocaleTimeString()}` : '';
    document.getElementById('collectionState').textContent = data ? 'Captura ativa' : 'Aguardando captura';
  }

  async function refreshIpData() {
    if (refreshing || refreshInProgress) return;
    refreshing = true;
    const errorElement = document.getElementById('ipError');
    errorElement.textContent = '';
    try {
      if (!Number.isInteger(activeTabId) || activeTabId < 0) throw new Error('Não foi possível identificar a aba atual.');
      const response = await chrome.runtime.sendMessage({ type: 'IPVFOO_GET_TAB_DATA', tabId: activeTabId });
      if (!response?.ok) throw new Error(response?.error || 'Falha ao consultar os dados de IP.');
      renderIpData(response.data);
    } catch (error) {
      errorElement.textContent = error?.message || 'Não foi possível consultar os IPs desta aba.';
    } finally {
      refreshing = false;
    }
  }

  function startRefreshPolling() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshIpData, 1200);
  }

  validateIp.addEventListener('click', async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs?.[0];
      activeTabId = tab?.id;
      activeTabUrl = tab?.url || '';
      homeView.hidden = true;
      ipView.hidden = false;
      const urlOk = /^https?:\/\//i.test(activeTabUrl);
      refreshIp.disabled = !urlOk;
      if (!urlOk) {
        activeTabId = null;
        document.getElementById('ipError').textContent = 'O validador funciona em páginas HTTP e HTTPS.';
        renderIpData(null);
        return;
      }
      const start = await chrome.runtime.sendMessage({
        type: 'IPVFOO_START_CAPTURE', tabId: activeTabId, url: activeTabUrl
      });
      if (!start?.ok) throw new Error(start?.error || 'Não foi possível iniciar a captura de IPs.');
      renderIpData(start.data);
      document.getElementById('ipError').textContent = start.retainedAfterRefresh
        ? 'Captura retomada após recarregar a página.'
        : 'Captura ativa. Use ↻ para recarregar a página e observar as conexões desta navegação.';
      startRefreshPolling();
      await refreshIpData();
    } catch (error) {
      document.getElementById('ipError').textContent = error?.message || 'Não foi possível abrir o validador.';
    }
  });

  refreshIp.addEventListener('click', async () => {
    if (!Number.isInteger(activeTabId) || activeTabId < 0 || refreshInProgress) return;
    refreshInProgress = true;
    refreshIp.disabled = true;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    document.getElementById('ipError').textContent = 'Recarregando a página para capturar novamente as conexões…';
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'IPVFOO_RESET_CAPTURE_FOR_REFRESH', tabId: activeTabId, url: activeTabUrl
      });
      if (!result?.ok) throw new Error(result?.error || 'Não foi possível reiniciar a captura.');
      // A captura temporária permanece ativa se o Chrome fechar o popup durante o reload.
      preserveCaptureOnUnload = true;
      const reloadPromise = chrome.tabs.reload(activeTabId);
      reloadPromise.then(() => {
        if (!document.documentElement) return;
        preserveCaptureOnUnload = false;
        refreshInProgress = false;
        refreshIp.disabled = false;
        document.getElementById('ipError').textContent = 'Página recarregada. Capturando novas conexões…';
        startRefreshPolling();
        void refreshIpData();
      }).catch(async error => {
        preserveCaptureOnUnload = false;
        refreshInProgress = false;
        refreshIp.disabled = false;
        document.getElementById('ipError').textContent = error?.message || 'Não foi possível recarregar a página.';
        await chrome.runtime.sendMessage({ type: 'IPVFOO_STOP_CAPTURE', tabId: activeTabId }).catch(() => {});
      });
    } catch (error) {
      preserveCaptureOnUnload = false;
      refreshInProgress = false;
      refreshIp.disabled = false;
      document.getElementById('ipError').textContent = error?.message || 'Não foi possível atualizar a captura.';
      startRefreshPolling();
    }
  });

  backHome.addEventListener('click', async () => {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    if (Number.isInteger(activeTabId) && activeTabId >= 0) {
      await chrome.runtime.sendMessage({ type: 'IPVFOO_STOP_CAPTURE', tabId: activeTabId }).catch(() => {});
    }
    preserveCaptureOnUnload = false;
    refreshInProgress = false;
    activeTabId = null;
    ipView.hidden = true;
    homeView.hidden = false;
  });

  window.addEventListener('unload', () => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (Number.isInteger(activeTabId) && activeTabId >= 0 && !preserveCaptureOnUnload) {
      try { chrome.runtime.sendMessage({ type: 'IPVFOO_STOP_CAPTURE', tabId: activeTabId }); } catch (_) {}
    }
  });
});
