export function scheduleAlignedRefresh({ intervalMinutes = 5, onRefresh }) {
  if (typeof onRefresh !== "function") {
    throw new Error("onRefresh must be a function");
  }

  const msPerMinute = 60 * 1000;
  const intervalMs = intervalMinutes * msPerMinute;

  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);

    next.setUTCSeconds(0, 0);

    const minutes = next.getUTCMinutes();
    const remainder = minutes % intervalMinutes;

    if (remainder === 0 && now.getUTCSeconds() === 0) {
      next.setUTCMinutes(minutes + intervalMinutes);
    } else {
      next.setUTCMinutes(minutes + (intervalMinutes - remainder));
    }

    const delayMs = next.getTime() - now.getTime();

    setTimeout(async () => {
      try {
        await onRefresh();
      } finally {
        setInterval(onRefresh, intervalMs);
      }
    }, delayMs);
  }

  scheduleNext();
}