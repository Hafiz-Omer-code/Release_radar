/* global self, browser */
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  root.ReleaseRadar = root.ReleaseRadar || {};

  const ITEMS_KEY = "trackedItems";
  const SETTINGS_KEY = "settings";
  const DEFAULT_SETTINGS = { syncIntervalMinutes: 60, notify: true };

  async function getItems() {
    const result = await browser.storage.local.get(ITEMS_KEY);
    return result[ITEMS_KEY] || [];
  }

  async function setItems(items) {
    await browser.storage.local.set({ [ITEMS_KEY]: items });
    return items;
  }

  /** Insert or update a tracked item by id, returns the new full list. */
  async function upsertItem(item) {
    const items = await getItems();
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...item };
    } else {
      items.push(item);
    }
    await setItems(items);
    return idx >= 0 ? items[idx] : item;
  }

  async function removeItem(id) {
    const items = (await getItems()).filter((i) => i.id !== id);
    await setItems(items);
    return items;
  }

  async function getSettings() {
    const result = await browser.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  }

  async function setSettings(settings) {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    await browser.storage.local.set({ [SETTINGS_KEY]: merged });
    return merged;
  }

  root.ReleaseRadar.storage = {
    getItems,
    setItems,
    upsertItem,
    removeItem,
    getSettings,
    setSettings,
  };
})();
