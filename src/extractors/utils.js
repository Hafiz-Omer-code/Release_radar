/* global self */
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  root.ReleaseRadar = root.ReleaseRadar || {};

  /** Extract a balanced-brace JSON object that follows a marker string in raw HTML. */
  function extractJsonAfterMarker(html, marker) {
    const idx = html.indexOf(marker);
    if (idx === -1) return null;
    const start = html.indexOf("{", idx);
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const jsonStr = html.slice(start, i + 1);
          try {
            return JSON.parse(jsonStr);
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  /** Parse every <script type="application/ld+json"> block in raw HTML. */
  function extractJsonLdBlocks(html) {
    const blocks = [];
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      try {
        const data = JSON.parse(m[1]);
        blocks.push(...(Array.isArray(data) ? data : [data]));
      } catch {
        // ignore malformed JSON-LD
      }
    }
    return blocks;
  }

  /** Coerce a value that *might* represent a timestamp (epoch s/ms or ISO string) to epoch ms. */
  function coerceTimestamp(value) {
    if (typeof value === "number") {
      if (value > 1e12) return value; // already ms
      if (value > 1e9) return value * 1000; // seconds
      return undefined;
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return undefined;
  }

  /** Recursively search a hydration-state object for a plausible release/air timestamp. */
  function deepFindTimestamp(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return undefined;
    for (const [key, value] of Object.entries(obj)) {
      if (/release|air|start|schedule|next|premiere|publish/i.test(key)) {
        const ts = coerceTimestamp(value);
        if (ts) return ts;
      }
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        const ts = deepFindTimestamp(value, depth + 1);
        if (ts) return ts;
      }
    }
    return undefined;
  }

  /** Convert "3:00 PM" -> "15:00". */
  function to24Hour(timeStr) {
    const m = timeStr.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (!m) return "00:00";
    let [, h, min, ap] = m;
    h = parseInt(h, 10);
    if (/pm/i.test(ap) && h !== 12) h += 12;
    if (/am/i.test(ap) && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${min}`;
  }

  /**
   * Parse banners like:
   *   "The next episode is predicted to arrive on 2026/09/20 03:00 PM GMT"
   * Returns epoch ms, or undefined.
   */
  function parsePredictedBanner(text) {
    const re =
      /predicted to (?:arrive|air)(?:\s+on)?\s+([0-9]{4}\/[0-9]{2}\/[0-9]{2})\s+([0-9]{1,2}:[0-9]{2}\s*[AP]M)\s*([A-Z]{2,5})?/i;
    const m = text.match(re);
    if (!m) return undefined;
    const [, datePart, timePart, tz] = m;
    const isoDate = datePart.replace(/\//g, "-");
    const time24 = to24Hour(timePart);
    const suffix = tz && tz.toUpperCase() === "GMT" ? "Z" : "";
    const ts = Date.parse(`${isoDate}T${time24}:00${suffix}`);
    return Number.isNaN(ts) ? undefined : ts;
  }

  /** Parse "Ep 10 / 24", "Episode 3/12", "1-12 episodes" style progress markers. */
  function parseEpisodeProgress(text) {
    let m = text.match(/Ep(?:isode)?\.?\s*(\d+)\s*\/\s*(\d+)/i);
    if (m) return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) };
    m = text.match(/(\d+)\s*-\s*(\d+)\s*episodes?/i);
    if (m) return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) };
    return undefined;
  }

  root.ReleaseRadar.extractorUtils = {
    extractJsonAfterMarker,
    extractJsonLdBlocks,
    coerceTimestamp,
    deepFindTimestamp,
    parsePredictedBanner,
    parseEpisodeProgress,
  };
})();
