/* global browser, document, location, ReleaseRadar */
/**
 * On-demand content script.
 *
 * This is NOT statically registered in manifest.json's content_scripts —
 * it (plus the lib/extractor files it depends on) is injected on demand via
 * browser.scripting.executeScript() only when the user clicks "Track this
 * tab" in the popup. That keeps the extension from touching every page a
 * person visits, while still giving extractors access to the live,
 * fully-hydrated DOM (useful for SPAs and for reading which list item is
 * visually "active", which a raw fetch() of the HTML can't see).
 *
 * By the time this file runs, browser-polyfill-shim.js, extractors/index.js,
 * extractors/utils.js, and all extractors/*.js have already been injected
 * (see background.js's trackCurrentTab), so `ReleaseRadar.extractors` is
 * ready to use here.
 */
(async () => {
  try {
    const html = document.documentElement.outerHTML;
    const fetched = await ReleaseRadar.extractors.run({ url: location.href, html, doc: document });
    const domHints = ReleaseRadar.extractors.scanDom(document);

    // Live DOM hints win over anything parsed from the static HTML snapshot.
    const merged = { ...fetched, ...Object.fromEntries(
      Object.entries(domHints).filter(([, v]) => v !== undefined)
    ) };

    if (!merged.title) merged.title = document.title;

    await browser.runtime.sendMessage({
      type: "PAGE_EXTRACTED",
      url: location.href,
      data: merged,
    });
  } catch (err) {
    console.error("[ReleaseRadar] content extraction failed:", err);
  }
})();
