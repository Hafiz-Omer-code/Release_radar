/* global self */
/**
 * Extractor registry.
 *
 * Every extractor implements the same tiny interface:
 *
 *   {
 *     name: string,
 *     match(url: string): boolean,
 *     extract(ctx: { url: string, html?: string, doc?: Document }):
 *       Promise<Partial<TrackedItem>> | Partial<TrackedItem>
 *   }
 *
 * TrackedItem (see README):
 *   { id, title, sourceUrl, nextReleaseTimestamp?, countdownText?,
 *     episodeProgress?: { current, total? }, status, lastChecked }
 *
 * Extractors are tried in registration order. More specific parsers
 * (e.g. youtube.js) should register first; generic/fallback parsers
 * register last. Fields already produced by an earlier (more specific)
 * extractor are never overwritten by a later, more generic one — later
 * extractors only fill in gaps. This file must be loaded before any
 * individual extractor module.
 */
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  root.ReleaseRadar = root.ReleaseRadar || {};

  const registry = [];

  function register(extractor) {
    registry.push(extractor);
  }

  function definedEntries(obj) {
    return Object.fromEntries(
      Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== null)
    );
  }

  /** Run every matching extractor for this URL and merge results (specific wins). */
  async function run(ctx) {
    let merged = {};
    for (const extractor of registry) {
      let matches = false;
      try {
        matches = extractor.match(ctx.url);
      } catch (e) {
        console.warn("[ReleaseRadar] extractor.match threw:", extractor.name, e);
      }
      if (!matches) continue;

      try {
        const partial = await extractor.extract(ctx);
        merged = { ...definedEntries(partial), ...merged };
      } catch (e) {
        console.warn("[ReleaseRadar] extractor.extract threw:", extractor.name, e);
      }
    }
    return merged;
  }

  root.ReleaseRadar.extractors = { register, run, _registry: registry };
})();
