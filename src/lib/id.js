/* global self */
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  root.ReleaseRadar = root.ReleaseRadar || {};

  /** Stable, deterministic id for a tracked URL (so re-adding is idempotent). */
  function forUrl(url) {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
    }
    return "item_" + hash.toString(16);
  }

  root.ReleaseRadar.id = { forUrl };
})();
