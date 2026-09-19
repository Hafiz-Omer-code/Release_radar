/* global importScripts, browser, self */
/**
 * Background entry point.
 *
 * Chromium (Chrome/Brave/Edge) loads this file as the MV3
 * `background.service_worker`, a true worker context — so it pulls in the
 * shared lib/extractor modules itself via `importScripts()`.
 *
 * Firefox MV3 instead uses `background.scripts`, which lists this file
 * *alongside* its dependencies (see manifest.json) and loads them in order
 * as classic scripts sharing one global scope — much like a background
 * page. `importScripts()` doesn't exist in that context, so it's guarded
 * below and simply skipped there; the manifest's `scripts` array has
 * already done the equivalent loading by the time this file runs.
 */
if (typeof importScripts === "function") {
  importScripts(
    "../lib/browser-polyfill-shim.js",
    "../lib/time.js",
    "../lib/id.js",
    "../lib/storage.js",
    "../extractors/index.js",
    "../extractors/utils.js",
    "../extractors/youtube.js",
    "../extractors/genericSpa.js",
    "../extractors/genericText.js"
  );
}

const ALARM_NAME = "release-radar-sync";
const ITEM_ALARM_PREFIX = "release-radar-item:";
const AIRING_WINDOW_MS = 30 * 60 * 1000; // stays "airing" for 30 min after go-live
const UPCOMING_THRESHOLD_MS = 5 * 60 * 1000; // switches to "airing" 5 min before go-live

// ---------------------------------------------------------------------------
// Alarm lifecycle
// ---------------------------------------------------------------------------

async function setupSyncAlarm() {
  const settings = await ReleaseRadar.storage.getSettings();
  const periodInMinutes = Math.max(15, settings.syncIntervalMinutes || 60);
  await browser.alarms.clear(ALARM_NAME);
  await browser.alarms.create(ALARM_NAME, { periodInMinutes });
}

function itemAlarmName(id) {
  return `${ITEM_ALARM_PREFIX}${id}`;
}

/**
 * Schedule a one-off alarm that fires the instant an item's countdown hits
 * zero, so notifications don't wait on the (much less frequent) periodic
 * sync. Browsers persist alarms across restarts, so this survives the
 * service worker being torn down and even the browser being closed.
 */
async function scheduleItemAlarm(item) {
  const name = itemAlarmName(item.id);
  await browser.alarms.clear(name);
  if (item.nextReleaseTimestamp && item.nextReleaseTimestamp > Date.now()) {
    await browser.alarms.create(name, { when: item.nextReleaseTimestamp });
  }
}

async function clearItemAlarm(id) {
  await browser.alarms.clear(itemAlarmName(id));
}

/** Re-arm per-item alarms for everything in storage (e.g. after a browser restart). */
async function rescheduleAllItemAlarms() {
  const items = await ReleaseRadar.storage.getItems();
  for (const item of items) {
    await scheduleItemAlarm(item);
  }
}

async function initializeAlarms() {
  await setupSyncAlarm();
  await rescheduleAllItemAlarms();
}

browser.runtime.onInstalled.addListener(() => {
  initializeAlarms();
});

if (browser.runtime.onStartup) {
  browser.runtime.onStartup.addListener(() => {
    initializeAlarms();
  });
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    refreshAll();
    return;
  }
  if (alarm.name.startsWith(ITEM_ALARM_PREFIX)) {
    handleItemAlarm(alarm.name.slice(ITEM_ALARM_PREFIX.length));
  }
});

/** Fired by a per-item alarm exactly when that item's countdown reaches zero. */
async function handleItemAlarm(id) {
  // Re-check the source first so the card also picks up new episode/progress
  // info right as it drops, not just the notification.
  const updated = await refreshItem(id);
  if (!updated) return;
  if (updated.status !== "completed") {
    notifyLive(updated);
  }
}

// ---------------------------------------------------------------------------
// Core tracker engine
// ---------------------------------------------------------------------------

function computeStatus(timestamp) {
  if (!timestamp) return "upcoming";
  const diff = timestamp - Date.now();
  if (diff > UPCOMING_THRESHOLD_MS) return "upcoming";
  if (diff > -AIRING_WINDOW_MS) return "airing";
  return "completed";
}

/** Fetch a URL's raw HTML and run it through the extractor pipeline. */
async function fetchAndExtract(url) {
  let html = "";
  try {
    const res = await fetch(url, { credentials: "omit" });
    html = await res.text();
  } catch (err) {
    // Common cause: the site blocks cross-origin fetch/CORS from the
    // extension's fetch context. The popup's "Track this tab" button covers
    // that case by injecting a content script into a real, already-open tab.
    console.warn(`[ReleaseRadar] fetch failed for ${url}:`, err);
  }
  return ReleaseRadar.extractors.run({ url, html });
}

async function addItemFromUrl(url) {
  const extracted = await fetchAndExtract(url);
  const item = {
    id: ReleaseRadar.id.forUrl(url),
    title: extracted.title || url,
    sourceUrl: url,
    nextReleaseTimestamp: extracted.nextReleaseTimestamp,
    countdownText: extracted.countdownText,
    episodeProgress: extracted.episodeProgress,
    status: extracted.status || computeStatus(extracted.nextReleaseTimestamp),
    lastChecked: Date.now(),
  };
  const saved = await ReleaseRadar.storage.upsertItem(item);
  await scheduleItemAlarm(saved);
  return saved;
}

async function refreshItem(id) {
  const items = await ReleaseRadar.storage.getItems();
  const existing = items.find((i) => i.id === id);
  if (!existing) return null;

  const extracted = await fetchAndExtract(existing.sourceUrl);
  const prevTimestamp = existing.nextReleaseTimestamp;
  const nextTimestamp = extracted.nextReleaseTimestamp ?? existing.nextReleaseTimestamp;

  const updated = {
    ...existing,
    title: extracted.title || existing.title,
    nextReleaseTimestamp: nextTimestamp,
    countdownText: extracted.countdownText ?? existing.countdownText,
    episodeProgress: extracted.episodeProgress ?? existing.episodeProgress,
    status: extracted.status || computeStatus(nextTimestamp),
    lastChecked: Date.now(),
  };

  await ReleaseRadar.storage.upsertItem(updated);
  await scheduleItemAlarm(updated);
  maybeNotifyOnTransition(prevTimestamp, updated);
  return updated;
}

async function refreshAll() {
  const items = await ReleaseRadar.storage.getItems();
  for (const item of items) {
    // Sequential on purpose — gentle on rate limits for sites that track many items.
    await refreshItem(item.id);
  }
  return ReleaseRadar.storage.getItems();
}

async function upsertFromPageExtraction(url, data) {
  const item = {
    id: ReleaseRadar.id.forUrl(url),
    title: data.title || url,
    sourceUrl: url,
    nextReleaseTimestamp: data.nextReleaseTimestamp,
    countdownText: data.countdownText,
    episodeProgress: data.episodeProgress,
    status: data.status || computeStatus(data.nextReleaseTimestamp),
    lastChecked: Date.now(),
  };
  const saved = await ReleaseRadar.storage.upsertItem(item);
  await scheduleItemAlarm(saved);
  return saved;
}

async function deleteItem(id) {
  await clearItemAlarm(id);
  return ReleaseRadar.storage.removeItem(id);
}

/** Fire the native "it's live" notification. Reused by both notification paths. */
function notifyLive(item) {
  if (!browser.notifications) return;
  // Using the item's own id as the notification id means a near-simultaneous
  // transition-detected notify (below) and per-item-alarm notify collapse
  // into one, instead of stacking duplicates.
  browser.notifications.create(item.id, {
    type: "basic",
    iconUrl: "../../icons/icon128.png",
    title: "Release Radar",
    message: `${item.title} just went live!`,
  });
}

/** Fallback path: catches a just-passed release time discovered during a periodic sync. */
function maybeNotifyOnTransition(prevTimestamp, item) {
  const now = Date.now();
  const justWentLive =
    prevTimestamp && prevTimestamp > now && item.nextReleaseTimestamp && item.nextReleaseTimestamp <= now;
  if (justWentLive) notifyLive(item);
}

/** Inject the extractor pipeline + content script into an already-open tab. */
async function trackCurrentTab(tabId) {
  await browser.scripting.executeScript({
    target: { tabId },
    files: [
      "src/lib/browser-polyfill-shim.js",
      "src/extractors/index.js",
      "src/extractors/utils.js",
      "src/extractors/youtube.js",
      "src/extractors/genericSpa.js",
      "src/extractors/genericText.js",
      "src/content/content.js",
    ],
  });
  return true;
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "ADD_ITEM_FROM_URL":
      return addItemFromUrl(message.url);
    case "REFRESH_ITEM":
      return refreshItem(message.id);
    case "REFRESH_ALL":
      return refreshAll();
    case "DELETE_ITEM":
      return deleteItem(message.id);
    case "GET_ITEMS":
      return ReleaseRadar.storage.getItems();
    case "GET_SETTINGS":
      return ReleaseRadar.storage.getSettings();
    case "SET_SETTINGS": {
      const settings = await ReleaseRadar.storage.setSettings(message.settings);
      await setupSyncAlarm();
      return settings;
    }
    case "TRACK_CURRENT_TAB":
      return trackCurrentTab(message.tabId);
    case "PAGE_EXTRACTED":
      return upsertFromPageExtraction(sender?.tab?.url || message.url, message.data || {});
    default:
      return undefined;
  }
}

// Explicit sendResponse + `return true` works identically on Chrome and
// Firefox for async listeners, so we don't depend on the full polyfill's
// promise-return convenience here.
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: String(err) }));
  return true;
});
