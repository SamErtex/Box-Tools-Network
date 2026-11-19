// DEV TOOLS - ponte de background original da IXC Dev Tools V3.
// Só responde às mensagens que pertencem ao Dev Tools; outros módulos da
// Box Tools Network precisam receber suas próprias mensagens sem interferência.
new (class {
  constructor() {
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
  }

  handleMessage(message, sender, sendResponse) {
    if (message?.action !== 'getDomain') return false;

    this.getDomain()
      .then((result) => sendResponse(result))
      .catch((error) => {
        BoxCore.logger.error('IXC Dev Tools', 'Não foi possível obter o domínio da aba ativa:', error);
        sendResponse({ status: 'error', message: 'Não foi possível obter o domínio da aba ativa.' });
      });

    return true;
  }

  async getDomain() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.url) throw new Error('A aba ativa não possui URL acessível.');
    return { domain: new URL(tab.url).hostname };
  }
})();
