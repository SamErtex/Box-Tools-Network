(() => {
  const APP_ID = 'app-container';
  const ENABLED_KEY = 'opaDevToolsEnabled';

  function getApp() {
    return document.getElementById(APP_ID);
  }

  function showDisabled() {
    const app = getApp();
    if (!app) return;
    app.innerHTML = `
      <div id="opa-devtools-disabled" style="
        box-sizing:border-box;
        min-height:100vh;
        padding:32px;
        display:flex;
        align-items:center;
        justify-content:center;
        font-family:Arial,Helvetica,sans-serif;
        background:#f6f7f9;
        color:#20252b;
      ">
        <div style="
          width:min(520px,100%);
          padding:28px;
          border:1px solid #d9dee5;
          border-radius:14px;
          background:#fff;
          box-shadow:0 6px 24px rgba(0,0,0,.08);
          text-align:center;
        ">
          <div style="font-size:18px;font-weight:700;margin-bottom:10px;">IXC Dev Tools desativado</div>
          <div style="font-size:14px;line-height:1.5;color:#59636e;">
            Ative o Dev Tools no popup da extensão <b>Box Tools Network</b> e abra novamente este painel.
          </div>
        </div>
      </div>`;
  }

  function showLoading() {
    const app = getApp();
    if (!app) return;
    app.innerHTML = '<div style="font:14px Arial;padding:20px;color:#59636e">Carregando IXC Dev Tools...</div>';
  }

  function loadOriginalPanel() {
    if (document.getElementById('opa-original-panel-bundle')) return;
    const script = document.createElement('script');
    script.id = 'opa-original-panel-bundle';
    script.src = chrome.runtime.getURL('panel.bundle.js');
    script.onerror = () => {
      const app = getApp();
      if (app) app.innerHTML = '<div style="font:14px Arial;padding:20px;color:#b42318">Não foi possível carregar o painel original do IXC Dev Tools.</div>';
    };
    document.head.appendChild(script);
  }

  async function init() {
    showLoading();
    try {
      const state = await chrome.storage.local.get(ENABLED_KEY);
      if (state[ENABLED_KEY] === false) {
        showDisabled();
        return;
      }
      loadOriginalPanel();
    } catch (error) {
      console.error('[OPA Dev Tools] Falha ao verificar o estado:', error);
      showDisabled();
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[ENABLED_KEY]) return;
    const enabled = changes[ENABLED_KEY].newValue !== false;
    if (enabled) {
      window.location.reload();
    } else {
      showDisabled();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
