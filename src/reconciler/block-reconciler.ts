import type {
  BlockPayload,
  RoamNode,
  ReconcilerConfig,
  SyncStats,
  ChildReconcilerConfig,
} from "./types";
import type { RoamApiAdapter } from "./roam-api-adapter";
import { delay, yieldToMain, MUTATION_DELAY_MS, YIELD_BATCH_SIZE } from "../settings";
import { logDebug } from "../logger";
import { ChildrenReconciler } from "./children-reconciler";

/**
 * Reconciles a list of source items with existing Roam blocks.
 * Only creates, updates, or deletes blocks when necessary.
 */
export class BlockReconciler<T> {
  private readonly mutationDelayMs: number;
  private readonly yieldBatchSize: number;
  private childrenReconciler: ChildrenReconciler | null = null;

  constructor(
    private readonly config: ReconcilerConfig<T>,
    private readonly roamApi: RoamApiAdapter
  ) {
    this.mutationDelayMs = config.options?.mutationDelayMs ?? MUTATION_DELAY_MS;
    this.yieldBatchSize = config.options?.yieldBatchSize ?? YIELD_BATCH_SIZE;
  }

  /**
   * Sets up the children reconciler for syncing child blocks (properties).
   */
  withChildrenReconciler(config: ChildReconcilerConfig): this {
    this.childrenReconciler = new ChildrenReconciler(config, this.roamApi);
    return this;
  }

  /**
   * Reconciles items with existing blocks under a parent.
   *
   * @param parentUid UID of the parent block or page.
   * @param items Source items to reconcile.
   * @returns Statistics about the sync operation.
   */
  async reconcile(parentUid: string, items: T[]): Promise<SyncStats> {
    const stats: SyncStats = {
      total: items.length,
      skipped: 0,
      created: 0,
      updated: 0,
      deleted: 0,
    };

    // Get existing blocks
    const existingNodes = this.roamApi.getChildren(parentUid);
    const existingMap = this.buildExistingMap(existingNodes);

    logDebug("reconciler_start", {
      parentUid,
      itemCount: items.length,
      existingBlockCount: existingNodes.length,
      mappedBlockCount: existingMap.size,
    });

    // Track which IDs we've seen
    const seenIds = new Set<string>();
    let operationCount = 0;

    // Process each item
    for (const item of items) {
      const id = this.config.extractId(item);
      seenIds.add(id);

      const newBlock = this.config.buildBlock(item);
      const existingNode = existingMap.get(id);

      if (existingNode) {
        // Block exists - check if it changed
        const unchanged = this.isUnchanged(existingNode, newBlock);

        if (unchanged) {
          stats.skipped++;
          logDebug("reconciler_skip", { id, reason: "unchanged" });
        } else {
          await this.updateExistingBlock(existingNode, newBlock);
          stats.updated++;
          logDebug("reconciler_update", { id, uid: existingNode.uid });
        }
      } else {
        // Block doesn't exist - create it
        await this.createNewBlock(parentUid, newBlock);
        stats.created++;
        logDebug("reconciler_create", { id });
      }

      operationCount++;
      await this.maybeYieldToMain(operationCount);
      this.config.options?.onProgress?.(stats);
    }

    // Remove obsolete blocks
    stats.deleted = await this.removeObsolete(existingMap, seenIds);

    logDebug("reconciler_complete", { ...stats });
    return stats;
  }

  /**
   * Builds a map of existing blocks by their extracted ID.
   */
  private buildExistingMap(nodes: RoamNode[]): Map<string, RoamNode> {
    const map = new Map<string, RoamNode>();

    for (const node of nodes) {
      const id = this.config.extractIdFromBlock(node);
      if (id) {
        map.set(id, node);
        logDebug("reconciler_map_entry", { id, uid: node.uid });
      }
    }

    return map;
  }

  /**
   * Compares an existing block with a new block payload.
   * Returns true if they are equivalent (no update needed).
   */
  private isUnchanged(existing: RoamNode, newBlock: BlockPayload): boolean {
    // Compare main text
    if (existing.text !== newBlock.text) {
      return false;
    }

    // Compare children count
    const existingChildren = existing.children ?? [];
    const newChildren = newBlock.children ?? [];

    if (existingChildren.length !== newChildren.length) {
      return false;
    }

    // Recursively compare children
    for (let i = 0; i < existingChildren.length; i++) {
      const existingChild = existingChildren[i];
      const newChild = newChildren[i];

      if (!this.isChildUnchanged(existingChild, newChild)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Compares a single child node with a new child payload.
   */
  private isChildUnchanged(existing: RoamNode, newChild: BlockPayload): boolean {
    if (existing.text !== newChild.text) {
      return false;
    }

    const existingChildren = existing.children ?? [];
    const newChildren = newChild.children ?? [];

    if (existingChildren.length !== newChildren.length) {
      return false;
    }

    for (let i = 0; i < existingChildren.length; i++) {
      if (!this.isChildUnchanged(existingChildren[i], newChildren[i])) {
        return false;
      }
    }

    return true;
  }

  /**
   * Updates an existing block and its children.
   */
  private async updateExistingBlock(
    existing: RoamNode,
    newBlock: BlockPayload
  ): Promise<void> {
    // Update main text if changed
    if (existing.text !== newBlock.text) {
      await this.roamApi.updateBlock(existing.uid, newBlock.text);
      await delay(this.mutationDelayMs);
    }

    // Sync children if reconciler is configured
    if (this.childrenReconciler && newBlock.children) {
      await this.childrenReconciler.syncChildren(
        existing.uid,
        existing.children ?? [],
        newBlock.children
      );
    }
  }

  /**
   * Creates a new block with its children.
   */
  private async createNewBlock(
    parentUid: string,
    block: BlockPayload
  ): Promise<void> {
    // createBlock in roam-api-adapter already handles children recursively
    await this.roamApi.createBlock(parentUid, block, "last");
  }

  /**
   * Removes blocks that are no longer in the source list.
   * Respects the preserveWhen option.
   */
  private async removeObsolete(
    existingMap: Map<string, RoamNode>,
    seenIds: Set<string>
  ): Promise<number> {
    let deletedCount = 0;
    let operationCount = 0;

    for (const [id, node] of existingMap.entries()) {
      // Skip if we processed this ID
      if (seenIds.has(id)) {
        continue;
      }

      // Check if block should be preserved
      if (this.config.options?.preserveWhen?.(node)) {
        logDebug("reconciler_preserve", { id, uid: node.uid });
        continue;
      }

      // Delete the block
      await this.roamApi.deleteBlock(node.uid);
      await delay(this.mutationDelayMs);
      deletedCount++;

      logDebug("reconciler_delete", { id, uid: node.uid });

      operationCount++;
      await this.maybeYieldToMain(operationCount);
    }

    return deletedCount;
  }

  /**
   * Yields to the main thread periodically based on the configured batch size.
   */
  private async maybeYieldToMain(count: number): Promise<void> {
    if (count % this.yieldBatchSize === 0) {
      await yieldToMain();
    }
  }
}
