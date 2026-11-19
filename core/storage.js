// CORE — acesso uniforme ao chrome.storage.
(() => {
  "use strict";
  const getArea = (area = "local") => {
    const storageArea = chrome.storage?.[area];
    if (!storageArea) throw new Error(`Área chrome.storage indisponível: ${area}`);
    return storageArea;
  };
  const storage = Object.freeze({
    get: (key, area = "local") => getArea(area).get(key),
    set: (values, area = "local") => getArea(area).set(values),
    remove: (keys, area = "local") => getArea(area).remove(keys),
    clear: (area = "local") => getArea(area).clear()
  });
  globalThis.BoxCore = globalThis.BoxCore || {};
  globalThis.BoxCore.storage = storage;
})();
