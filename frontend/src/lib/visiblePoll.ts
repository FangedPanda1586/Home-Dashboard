/** Serial polling: no overlapping requests; refresh immediately on return. */
export function visiblePoll(task: () => Promise<unknown>, delay: number, background = false) {
  let stopped = false;
  let busy = false;
  let timer: number | undefined;
  async function run() {
    if (stopped || busy) return;
    window.clearTimeout(timer);
    if (document.hidden && !background) return;
    busy = true;
    try { await task(); } catch { /* Callers own their error state. */ }
    finally {
      busy = false;
      if (!stopped && (!document.hidden || background)) timer = window.setTimeout(run, delay);
    }
  }
  function visibility() {
    window.clearTimeout(timer);
    if (!document.hidden || background) void run();
  }
  document.addEventListener("visibilitychange", visibility);
  void run();
  return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
}
