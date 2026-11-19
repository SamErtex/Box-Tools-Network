// Ponto de entrada do service worker: CORE primeiro, módulos depois.
importScripts(
  'core/logger.js',
  'core/storage.js',
  'core/notifications.js',
  'core/messaging.js',
  'modules/opa/background.js',
  'modules/externo/ixc-dev-tools/background.js',
  'modules/externo/validate-ip/background.js'
);
