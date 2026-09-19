/**
 * Minimal cross-browser namespace shim.
 *
 * Firefox exposes a promise-based `browser.*` API natively.
 * Chrome/Chromium (Chrome, Brave, Edge) expose `chrome.*`, which has also
 * been promise-based for the APIs this extension uses (storage, alarms,
 * notifications, tabs, scripting, runtime.sendMessage) since MV3 shipped.
 *
 * This shim just aliases `browser` to `chrome` when `browser` doesn't
 * already exist, so the rest of the codebase can use `browser.*`
 * everywhere without vendor branching.
 *
 * For production use, or if you need full event-listener parity/edge-case
 * coverage, swap this file for Mozilla's official `webextension-polyfill`
 * package (https://github.com/mozilla/webextension-polyfill) — drop its
 * built file in this same path and nothing else needs to change.
 */
if (typeof globalThis.browser === "undefined") {
  globalThis.browser = globalThis.chrome;
}
