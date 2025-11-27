type SyncHandler = () => Promise<void>;

let scheduledSync: number | null = null;

/**
 * Calculates interval settings and schedules the next automatic sync run.
 *
 * @param handler Callback invoked when the scheduled sync fires.
 * @param intervalMs Interval in milliseconds between runs.
 */
export function scheduleAutoSync(handler: SyncHandler, intervalMs: number | undefined) {
  if (!intervalMs || !Number.isFinite(intervalMs)) {
    cancelScheduledSync();
    return;
  }
  cancelScheduledSync();
  scheduledSync = window.setTimeout(async () => {
    scheduledSync = null;
    await handler();
    scheduleAutoSync(handler, intervalMs);
  }, intervalMs);
}

/**
 * Clears the pending sync timeout when present.
 */
export function cancelScheduledSync() {
  if (scheduledSync !== null) {
    clearTimeout(scheduledSync);
    scheduledSync = null;
  }
}
