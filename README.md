# Release Radar

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4c8bf5?logo=googlechrome&logoColor=white)
![Chrome](https://img.shields.io/badge/Chrome-supported-4285F4?logo=googlechrome&logoColor=white)
![Firefox](https://img.shields.io/badge/Firefox-supported-FF7139?logo=firefoxbrowser&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

Lightweight cross-browser extension to track upcoming anime & episode
release countdowns in real time.

Paste in a URL — an anime episode page, a YouTube premiere/live stream,
a scheduled lecture stream, anything with a detectable schedule — and
Release Radar extracts the release time and shows a live-ticking
countdown card in its popup, no matter which browser you're on.

No build step required: clone it and load it unpacked as-is.

## Repository setup (GitHub)

When creating the GitHub repository, use:

| Field | Value |
|---|---|
| **Name** | `release-radar` |
| **Description / tagline** | Lightweight cross-browser extension to track upcoming anime & episode release countdowns in real time. |
| **Topics** | `manifest-v3` `webextension` `anime-tracker` `countdown-timer` `firefox-addon` `chrome-extension` |
| **License** | MIT (see [LICENSE](LICENSE)) |

## Features

- **Real-time countdown cards** — `DD:HH:MM:SS` countdowns tick live in
  the popup for every tracked item, with a platform tag and an
  episode/premiere progress badge (`Ep 10 / 24`, "Airing now") when
  detected.
- **"+ Track current tab"** — injects the extractor pipeline into the
  page you're already looking at, for sites that block cross-origin
  `fetch()` or only reveal their schedule after client-side JS runs.
- **One-click direct links** — open any tracked item's source page in
  a new tab straight from its card.
- **Smart chronological sorting** — cards are always sorted ascending
  by time remaining, so whatever's airing soonest is pinned to the
  top automatically.
- **Instant filter** — a search box above the list narrows visible
  cards by title or domain as you type, without rebuilding the list.
- **Arrival notifications** — a dedicated `browser.alarms` entry is
  scheduled for each item's exact release time, so you get a native
  notification the moment a countdown hits zero — not just on the
  next periodic sync.

## Installation

**Chrome / Brave / Edge (Chromium)**
1. Go to `chrome://extensions` (or the Brave/Edge equivalent, e.g.
   `edge://extensions`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this project's root folder
   (the one containing `manifest.json`).

**Firefox (temporary add-on, for development)**
1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `manifest.json`
   directly.
3. Note: temporary add-ons unload when Firefox restarts. For a
   persistent local install during development, use `web-ext run`
   from Mozilla's [`web-ext`](https://github.com/mozilla/web-ext) CLI
   instead; for permanent installation, submit the packaged `.zip` to
   [addons.mozilla.org](https://addons.mozilla.org) (AMO).

## Using it

- **Paste a URL** into the popup's input and hit Add. The background
  worker fetches the page and runs it through the extractor pipeline.
- **"Track current tab"** injects the extractor pipeline into the tab
  you're already viewing — use this for CORS-blocked sites or
  client-rendered SPAs.
- **Filter** by typing into the search box; it matches against title
  and domain.
- Cards can be refreshed, opened, or removed individually, and the
  whole list can be refreshed at once from the header's ⟳ button.
- A `browser.alarms` sync job re-checks every tracked item on an
  interval (default 60 min, minimum 15 min — browsers throttle alarms
  below that), **and** each item additionally gets its own one-off
  alarm scheduled for its exact release timestamp, so notifications
  fire immediately rather than waiting for the next sync.

## Build & Packaging

This project has no build step — the files under `src/` are loaded
directly by the browser. "Packaging" just means zipping the project
for distribution or AMO submission.

`manifest.json` must sit at the **root** of the archive, not inside a
wrapping folder — zip from *inside* this directory, not its parent:

```bash
# Bash / macOS / Linux — zip from *inside* the project so dotfiles
# (.gitignore) are included and manifest.json lands at the archive root
cd release-radar && zip -r ../release-radar-extension.zip . -x "*.DS_Store" -x ".git/*"
```

```powershell
# PowerShell / Windows
Compress-Archive -Path release-radar/* -DestinationPath release-radar-extension.zip -Force
```

```bash
# Optional: lint the package the way AMO's automated reviewer will
npx web-ext lint --source-dir=release-radar
```

## Architecture

```
manifest.json
LICENSE
.gitignore
icons/
src/
  background/background.js   — alarms (sync + per-item), storage, message router
  popup/                      — popup UI (HTML/CSS/JS, no framework)
  content/content.js          — on-demand DOM-context extractor (injected, not static)
  extractors/
    index.js                  — registry + merge logic (unified interface)
    utils.js                  — shared regex/JSON-LD/hydration-state helpers
    youtube.js                — site-specific: YouTube premieres/live streams
    genericSpa.js             — JSON-LD + Next.js __NEXT_DATA__ hydration scan
    genericText.js            — last-resort text/DOM heuristics (banners, "Ep n/m")
  lib/
    browser-polyfill-shim.js  — aliases `browser` to `chrome` where needed
    storage.js                — browser.storage.local wrapper
    time.js                   — countdown formatting
    id.js                     — stable per-URL id
```

### `TrackedItem` shape

```ts
interface TrackedItem {
  id: string;
  title: string;
  sourceUrl: string;
  nextReleaseTimestamp?: number;      // epoch ms
  countdownText?: string;
  episodeProgress?: { current: number; total?: number };
  status: 'upcoming' | 'airing' | 'completed';
  lastChecked: number;
}
```

### Extractor interface

Every extractor module registers an object with the same shape:

```js
ReleaseRadar.extractors.register({
  name: "my-site",
  match(url) { return /example\.com\/episode/.test(url); },
  extract({ url, html, doc }) {
    // return a Partial<TrackedItem>
  },
});
```

`extractors/index.js` runs every extractor whose `match(url)` returns
true, in registration order, and merges their results — **fields from
an earlier (more specific) extractor are never overwritten by a later,
more generic one.** That's why `youtube.js` registers before
`genericSpa.js`/`genericText.js`: YouTube's own parsed fields win, and
the generic passes only fill in whatever YouTube's extractor left
blank.

Add a new site-specific parser by dropping a new file in `extractors/`
that follows this interface, then listing it in **three** places (see
"Manifest notes" below).

### Two extraction paths, by design

1. **Background fetch** (`fetchAndExtract` in `background.js`): plain
   `fetch()` of the URL's HTML, run through the extractor pipeline.
   Fast and works without opening a tab, but blocked by some sites'
   CORS policy and can't see anything that only appears after
   client-side JS runs.
2. **On-demand content script** (`content.js`, injected via
   `browser.scripting.executeScript` — never statically registered):
   used for the "Track current tab" button. Runs in the real page with
   a fully hydrated DOM, so it also gets `genericText.js`'s
   `scanDom()` heuristics (e.g. reading which episode row is
   highlighted as "current").

### Scalability features

- **Chronological auto-sort**: the popup re-sorts its in-memory list
  ascending by `nextReleaseTimestamp` (items with no known timestamp
  sort last) every time it re-renders, so the soonest-airing item is
  always at the top with zero manual bookkeeping.
- **Instant client-side filter**: the search box never triggers a
  re-render. `applyFilter()` toggles the `hidden` attribute on the
  already-built `<li>` cards using a `data-search` string precomputed
  once at render time — an O(n) substring check with no DOM churn,
  so it stays snappy however many items are tracked.
- **Per-item scheduled alarms**: rather than relying solely on the
  hourly sync to *eventually* notice a countdown hit zero,
  `scheduleItemAlarm()` creates a dedicated one-off `browser.alarms`
  entry (`release-radar-item:<id>`) timed to the item's exact
  `nextReleaseTimestamp`. Alarms persist across service-worker
  teardown and browser restarts (re-armed via
  `rescheduleAllItemAlarms()` on `onInstalled`/`onStartup`), so
  notifications stay accurate independent of how many items are being
  tracked or how long the sync interval is set to.

### Zero-build tradeoff

Every file here is a classic (non-ES-module) script sharing state via
a single `self.ReleaseRadar` / `window.ReleaseRadar` namespace object,
loaded in a fixed order via `importScripts()` (service worker),
multiple `<script>` tags (popup), or `scripting.executeScript`'s
`files` array (content script). This means the project runs with
**no `npm install`, no bundler, no build step** — just "load unpacked"
and go.

If you outgrow this (e.g. want TypeScript, npm dependencies, or to
stop duplicating the extractor file list in three places), swap in a
bundler (esbuild/webpack/rollup) with real `import`/`export` across
`background.js`, `content.js`, and `popup.js`, and drop in the
official [`webextension-polyfill`](https://github.com/mozilla/webextension-polyfill)
package in place of `browser-polyfill-shim.js` for full event-listener
parity.

### Manifest notes

- `background` declares **both** `service_worker` (Chromium — a real
  worker context, so `background.js` pulls in its dependencies itself
  via a guarded `importScripts()` call) and `scripts` (Firefox MV3 —
  loads `background.js` *and* every dependency it needs, listed
  explicitly, as classic scripts sharing one global). Chromium reads
  `service_worker` and ignores `scripts`; Firefox does the reverse.
  If you add a new file under `lib/` or `extractors/`, list it in
  **three** places: the `importScripts(...)` call in
  `background.js`, the `background.scripts` array in `manifest.json`,
  and `trackCurrentTab()`'s `files` array in `background.js`.
- No `"type": "module"` on `background` — every file here is a
  classic script sharing state via `self.ReleaseRadar`, not a real ES
  module with `import`/`export`. Firefox's `background.scripts`
  loading model (multiple files, shared global, in listed order) works
  with that as-is; a bundler-based rewrite (see "Zero-build tradeoff"
  above) would need `"type": "module"` plus real imports instead.
- `browser_specific_settings.gecko.data_collection_permissions` is
  required by current AMO submissions; `{"required": ["none"]}`
  declares that this extension collects no user data. Update it if
  that ever changes.
- No `default_locale` — this extension doesn't use `chrome.i18n` or
  `_locales/`, so the key is omitted rather than pointing at
  translation files that don't exist.
- `browser_specific_settings.gecko.id` is required for Firefox to
  treat this as a permanent, updatable extension rather than a
  temporary one.
- `host_permissions: ["<all_urls>"]` is required both for background
  `fetch()` against arbitrary tracked sites and for
  `scripting.executeScript` into arbitrary tabs. Narrow this to
  specific origins if you're shipping to a curated set of sites.

## Known limitations (starter-kit scope)

- The YouTube parser relies on regex over the raw watch-page HTML
  (`scheduledStartTime`, `isLiveNow`), which is stable but not an
  official API — YouTube markup changes occasionally and may need a
  regex tweak.
- `genericText.js`'s "which episode is highlighted" heuristic looks
  for `active`/`selected`/`current`/`playing` in a nearby element's
  class name. Sites that indicate the current episode purely via
  color/CSS with no such class name won't be picked up — add a
  site-specific extractor for those instead of fighting the heuristic.
- Per-item alarms fire right at the scheduled timestamp, but browsers
  can delay very-short-notice alarms slightly under system load; the
  hourly sync remains as a backstop for anything that slips through.

## License

MIT — see [LICENSE](LICENSE).

---

# Release notes template — v1.0.0

Use this as the starting point for the GitHub Release description.

## Release Radar v1.0.0

Initial release of Release Radar — a lightweight, cross-browser
Manifest V3 extension for tracking anime episode and video-premiere
countdowns.

### ✨ Features

- Real-time countdown cards (`DD:HH:MM:SS`) for every tracked item
- "+ Track current tab" — extract a schedule from the page you're
  already on, for CORS-blocked or client-rendered sites
- One-click open-source-link and remove actions per card
- Chronological auto-sort — soonest release always pinned to the top
- Instant search/filter by title or domain
- Native desktop notifications the moment a countdown reaches zero,
  via a dedicated per-item `browser.alarms` schedule
- Modular extractor pipeline: a YouTube-specific parser, a generic
  JSON-LD/`__NEXT_DATA__` SPA scanner, and a generic text/DOM
  fallback for plain server-rendered pages

### 🧱 Compatibility

- Manifest V3
- Chrome, Brave, Edge (Chromium — `background.service_worker`)
- Firefox 115+ (`background.scripts`, `browser_specific_settings.gecko`)

### 📦 Installing this release

Download `release-radar-extension.zip` from this release's Assets,
then:

- **Chromium**: `chrome://extensions` → enable Developer mode →
  "Load unpacked" (unzip first, then select the folder).
- **Firefox**: `about:debugging#/runtime/this-firefox` → "Load
  Temporary Add-on…" → select `manifest.json` from the unzipped
  folder — or submit the zip as-is to AMO for a permanent install.

### 📝 Notes

No build step, no dependencies to install — this is the same source
that's in the repository at this tag.

### 🔗 Full changelog

`Initial release` — no prior tag to diff against.
