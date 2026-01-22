/**
 * Roam Block Reconciler
 *
 * A library for efficiently syncing data from external sources (like Todoist)
 * to Roam blocks. Only creates, updates, or deletes blocks when necessary.
 *
 * @example
 * ```typescript
 * import { BlockReconciler, createRoamApiAdapter } from "./reconciler";
 *
 * const reconciler = new BlockReconciler<Task>({
 *   extractId: (task) => String(task.id),
 *   buildBlock: (task) => ({ text: task.content, children: [] }),
 *   extractIdFromBlock: (node) => extractIdFromText(node.text),
 *   options: {
 *     preserveWhen: (node) => hasCompletedStatus(node),
 *   }
 * }, createRoamApiAdapter());
 *
 * const stats = await reconciler.reconcile(pageUid, tasks);
 * console.log(`Skipped: ${stats.skipped}, Updated: ${stats.updated}`);
 * ```
 */

// Types
export type {
  BlockPayload,
  RoamNode,
  ReconcilerConfig,
  ReconcilerOptions,
  SyncStats,
  ChildReconcilerConfig,
} from "./types";

// Roam API Adapter
export type { RoamApiAdapter } from "./roam-api-adapter";
export { createRoamApiAdapter } from "./roam-api-adapter";

// Block Reconciler
export { BlockReconciler } from "./block-reconciler";

// Children Reconciler
export { ChildrenReconciler, type ChildSyncStats } from "./children-reconciler";
