/* global browser, ReleaseRadar, document */
(function () {
  const listEl = document.getElementById("item-list");
  const addForm = document.getElementById("add-form");
  const urlInput = document.getElementById("url-input");
  const trackTabBtn = document.getElementById("track-tab-btn");
  const refreshAllBtn = document.getElementById("refresh-all-btn");
  const searchInput = document.getElementById("search-input");
  const emptyState = document.getElementById("empty-state");
  const noMatchState = document.getElementById("no-match-state");
  const statusText = document.getElementById("status-text");

  let items = [];
  let tickHandle = null;

  async function init() {
    items = (await browser.runtime.sendMessage({ type: "GET_ITEMS" })) || [];
    render();
    startTicking();

    addForm.addEventListener("submit", onAdd);
    trackTabBtn.addEventListener("click", onTrackTab);
    refreshAllBtn.addEventListener("click", onRefreshAll);
    searchInput.addEventListener("input", () => applyFilter());
  }

  async function onAdd(event) {
    event.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    setBusy(true, "Fetching…");
    try {
      const item = await browser.runtime.sendMessage({ type: "ADD_ITEM_FROM_URL", url });
      upsertLocal(item);
      urlInput.value = "";
    } catch (err) {
      setStatus(`Couldn't add that URL: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  async function onTrackTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    setBusy(true, "Scanning page…");
    try {
      await browser.runtime.sendMessage({ type: "TRACK_CURRENT_TAB", tabId: tab.id });
      // The content script posts its result asynchronously; give it a beat.
      setTimeout(refreshFromStorage, 500);
    } catch (err) {
      setStatus(`Couldn't scan this tab: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  async function onRefreshAll() {
    setBusy(true, "Refreshing…");
    try {
      items = (await browser.runtime.sendMessage({ type: "REFRESH_ALL" })) || [];
      render();
    } finally {
      setBusy(false);
    }
  }

  async function refreshFromStorage() {
    items = (await browser.runtime.sendMessage({ type: "GET_ITEMS" })) || [];
    render();
  }

  function upsertLocal(item) {
    if (!item) return;
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx >= 0) items[idx] = item;
    else items.push(item);
    render();
  }

  function setBusy(busy, message) {
    document.body.classList.toggle("busy", busy);
    if (message) setStatus(message);
    else if (!busy) setStatus("");
  }

  function setStatus(text) {
    statusText.textContent = text || "";
  }

  function render() {
    listEl.replaceChildren();
    emptyState.hidden = items.length > 0;

    const sorted = [...items].sort((a, b) => {
      const ta = a.nextReleaseTimestamp ?? Infinity;
      const tb = b.nextReleaseTimestamp ?? Infinity;
      return ta - tb;
    });

    for (const item of sorted) {
      listEl.appendChild(renderCard(item));
    }

    // Re-apply whatever's currently typed in the search box to the freshly
    // built cards — this only toggles `hidden`, it never rebuilds the DOM.
    applyFilter();
  }

  /**
   * Instant filter: hides/shows already-rendered <li> cards by keyword or
   * domain match. Deliberately does NOT call render() — no DOM rebuild, just
   * toggling `hidden` on existing nodes, so it stays fast even with a lot of
   * tracked items and doesn't disturb ticking countdowns mid-filter.
   */
  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    let anyVisible = false;

    for (const card of listEl.children) {
      const matches = !query || (card.dataset.search || "").includes(query);
      card.hidden = !matches;
      if (matches) anyVisible = true;
    }

    noMatchState.hidden = !(items.length > 0 && query && !anyVisible);
  }

  /** Tiny safe-DOM helper: no innerHTML anywhere, all text goes through textContent. */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "className") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "title") node.title = value;
      else if (key.startsWith("data-")) node.dataset[key.slice(5)] = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) {
      if (child) node.append(child);
    }
    return node;
  }

  function renderCard(item) {
    const progressLabel = item.episodeProgress
      ? `Ep ${item.episodeProgress.current}${
          item.episodeProgress.total ? " / " + item.episodeProgress.total : ""
        }`
      : item.status === "airing"
      ? "Airing now"
      : "";

    const titleEl = el("div", { className: "card-title", title: item.title, text: item.title });

    const metaEl = el("div", { className: "card-meta" }, [
      el("span", { className: "platform-tag", text: hostnameOf(item.sourceUrl) }),
      progressLabel ? el("span", { className: "progress-badge", text: progressLabel }) : null,
    ]);

    const countdownEl = el("div", {
      className: "countdown",
      "data-ts": item.nextReleaseTimestamp || "",
      text: countdownLabel(item),
    });

    const cardMain = el("div", { className: "card-main" }, [titleEl, metaEl, countdownEl]);

    const refreshBtn = el("button", { className: "icon-btn refresh-btn", title: "Refresh", text: "⟳" });
    const openBtn = el("button", { className: "icon-btn open-btn", title: "Open source", text: "↗" });
    const deleteBtn = el("button", { className: "icon-btn delete-btn", title: "Remove", text: "✕" });
    const cardActions = el("div", { className: "card-actions" }, [refreshBtn, openBtn, deleteBtn]);

    const card = el("li", { className: `card status-${item.status}`, "data-id": item.id }, [
      cardMain,
      cardActions,
    ]);
    // Precomputed, lowercased haystack for the instant filter — computed once
    // at render time so filtering itself stays a cheap substring check.
    card.dataset.search = `${item.title} ${hostnameOf(item.sourceUrl)}`.toLowerCase();

    refreshBtn.addEventListener("click", async () => {
      setBusy(true, "Refreshing…");
      try {
        const updated = await browser.runtime.sendMessage({ type: "REFRESH_ITEM", id: item.id });
        if (updated) upsertLocal(updated);
      } finally {
        setBusy(false);
      }
    });

    openBtn.addEventListener("click", () => {
      browser.tabs.create({ url: item.sourceUrl });
    });

    deleteBtn.addEventListener("click", async () => {
      items = (await browser.runtime.sendMessage({ type: "DELETE_ITEM", id: item.id })) || [];
      render();
    });

    return card;
  }

  function countdownLabel(item) {
    if (!item.nextReleaseTimestamp) {
      return item.status === "airing" ? "Airing now" : "No schedule found";
    }
    return ReleaseRadar.time.formatCountdown(item.nextReleaseTimestamp - Date.now());
  }

  function startTicking() {
    clearInterval(tickHandle);
    tickHandle = setInterval(() => {
      document.querySelectorAll(".countdown[data-ts]").forEach((el) => {
        const ts = Number(el.dataset.ts);
        if (!ts) return;
        const diff = ts - Date.now();
        el.textContent = ReleaseRadar.time.formatCountdown(diff);
        if (diff <= 0) {
          el.closest(".card")?.classList.remove("status-upcoming");
          el.closest(".card")?.classList.add("status-airing");
        }
      });
    }, 1000);
  }

  function hostnameOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
