/* global self */
/**
 * YouTube premiere / upcoming-live-stream extractor.
 *
 * YouTube embeds its player response as inline JSON (`ytInitialPlayerResponse`)
 * in the watch-page HTML. For scheduled premieres/live streams this contains
 * a `liveStreamability.liveStreamabilityRenderer.offlineSlate.scheduledStartTime`
 * (seconds since epoch) and/or a top-level `videoDetails.isLiveContent` flag.
 * We use a targeted regex rather than a full JSON parse of the whole payload
 * since the surrounding document is huge and we only need a couple of fields.
 */
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  root.ReleaseRadar = root.ReleaseRadar || {};

  function match(url) {
    return /(^|\.)youtube\.com\/(watch|live)/i.test(url) || /youtu\.be\//i.test(url);
  }

  function extract({ html }) {
    if (!html) return {};

    let title;
    const titleMeta = html.match(/<meta\s+name="title"\s+content="([^"]+)"/i);
    if (titleMeta) title = decodeHtmlEntities(titleMeta[1]);

    const scheduled = html.match(/"scheduledStartTime":"(\d+)"/);
    if (scheduled) {
      return {
        title,
        nextReleaseTimestamp: parseInt(scheduled[1], 10) * 1000,
        status: "upcoming",
      };
    }

    const isLiveNow = /"isLiveNow":true/.test(html) || /"isLive":true/.test(html);
    if (isLiveNow) {
      return { title, status: "airing" };
    }

    return { title };
  }

  function decodeHtmlEntities(str) {
    return str
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  root.ReleaseRadar.extractors.register({ name: "youtube", match, extract });
})();
