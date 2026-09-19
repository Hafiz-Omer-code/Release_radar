/* global self */
/**
 * Generic SPA / hydration-state extractor.
 *
 * Before falling back to fragile DOM scraping, look for structured data
 * the site already embedded for its own use:
 *   1. Schema.org JSON-LD (<script type="application/ld+json">) —
 *      TVEpisode / Event / VideoObject nodes commonly carry startDate.
 *   2. Next.js hydration payload (#__NEXT_DATA__) — walked recursively
 *      for a key that looks like a release/air/schedule timestamp.
 *
 * This registers with match: () => true so it always runs as a
 * mid-priority fallback; index.js's merge logic ensures a more specific
 * extractor's fields (e.g. youtube.js) always take precedence.
 */
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  root.ReleaseRadar = root.ReleaseRadar || {};
  const { extractJsonAfterMarker, extractJsonLdBlocks, deepFindTimestamp } =
    root.ReleaseRadar.extractorUtils;

  function fromJsonLd(html) {
    const blocks = extractJsonLdBlocks(html);
    for (const item of blocks) {
      const start = item.startDate || item.uploadDate || item.datePublished;
      if (start) {
        const ts = Date.parse(start);
        if (!Number.isNaN(ts)) {
          return { nextReleaseTimestamp: ts, title: item.name };
        }
      }
    }
    return null;
  }

  function fromNextData(html) {
    const nextData = extractJsonAfterMarker(html, "__NEXT_DATA__");
    if (!nextData) return null;
    const ts = deepFindTimestamp(nextData);
    return ts ? { nextReleaseTimestamp: ts } : null;
  }

  function extract({ html }) {
    if (!html) return {};
    return fromJsonLd(html) || fromNextData(html) || {};
  }

  root.ReleaseRadar.extractors.register({ name: "generic-spa", match: () => true, extract });
})();
