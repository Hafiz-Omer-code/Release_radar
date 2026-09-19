/* global self */
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  root.ReleaseRadar = root.ReleaseRadar || {};

  /**
   * Format a millisecond duration as DD:HH:MM:SS.
   * Returns all zeros once the duration has elapsed.
   */
  function formatCountdown(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "00:00:00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  /** Short human label, e.g. "in 2h 14m" or "3d 4h". */
  function formatShort(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "now";
    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  root.ReleaseRadar.time = { formatCountdown, formatShort };
})();
