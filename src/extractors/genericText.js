/* global self, document */
/**
 * Generic text/DOM fallback extractor — the last resort when a site has no
 * structured data at all (plain server-rendered HTML with a human-readable
 * "next episode" banner, like many anime-tracker sites).
 *
 * Two code paths:
 *   - extract({html}): strips tags from raw fetched HTML and regex-matches
 *     common banner/progress phrasing. Used by the background fetch path.
 *   - scanDom(document): walks the *live* DOM (used only when injected into
 *     a real tab via the content script) so it can also read highlighted/
 *     active list items for "which episode is current" heuristics that
 *     plain text can't express.
 */
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  root.ReleaseRadar = root.ReleaseRadar || {};
  const { parsePredictedBanner, parseEpisodeProgress } = root.ReleaseRadar.extractorUtils;

  function extract({ html }) {
    if (!html) return {};
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    return {
      nextReleaseTimestamp: parsePredictedBanner(text),
      episodeProgress: parseEpisodeProgress(text),
    };
  }

  /**
   * DOM-only heuristic scan, only meaningful when a real `document` is
   * available (i.e. running inside content.js in an actual tab).
   */
  function scanDom(doc) {
    if (!doc || !doc.querySelectorAll) return {};

    const leafNodes = Array.from(doc.querySelectorAll("*")).filter(
      (el) => el.children.length === 0
    );

    let nextReleaseTimestamp;
    const bannerEl = leafNodes.find((el) =>
      /predicted to (arrive|air)/i.test(el.textContent || "")
    );
    if (bannerEl) nextReleaseTimestamp = parsePredictedBanner(bannerEl.textContent);

    let episodeProgress;
    const episodeRows = leafNodes.filter((el) =>
      /^Episode\s+\d+/i.test((el.textContent || "").trim())
    );
    if (episodeRows.length) {
      const numbers = episodeRows
        .map((el) => parseInt((el.textContent.match(/\d+/) || [])[0], 10))
        .filter((n) => !Number.isNaN(n));
      const total = numbers.length ? Math.max(...numbers) : undefined;

      // Heuristic: the "current" row is the one whose ancestor row carries an
      // active/selected/current/playing-looking class. Falls back to episode 1.
      const highlighted = episodeRows.find((el) => {
        const row = el.closest("li,tr,div,a") || el;
        return /active|selected|current|playing/i.test(row.className || "");
      });
      const current = highlighted
        ? parseInt((highlighted.textContent.match(/\d+/) || [])[0], 10)
        : numbers[0];

      if (total || current) episodeProgress = { current: current || 1, total };
    }

    return { nextReleaseTimestamp, episodeProgress };
  }

  root.ReleaseRadar.extractors.register({ name: "generic-text", match: () => true, extract });
  root.ReleaseRadar.extractors.scanDom = scanDom;
})();
