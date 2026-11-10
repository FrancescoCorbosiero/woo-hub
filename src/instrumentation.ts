/**
 * Next.js instrumentation hook — runs once when the server boots.
 * Reads the Automatic sync settings now and every minute (every process: the
 * scheduler follows them, and the shop's time zone is among them), starts the
 * in-app sync scheduler (no-op in dev unless SCHEDULER=on) and, with
 * HEAP_WATCH=on, prints the heap into this console beside the request log so
 * a run that grows it can be read off the same output.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { watchAutomation } = await import("@/server/automation/settings");
    watchAutomation();
    const { startScheduler } = await import("@/server/scheduler");
    startScheduler();
    const { startHeapWatch } = await import("@/server/debug/heap-watch");
    startHeapWatch();
  }
}
