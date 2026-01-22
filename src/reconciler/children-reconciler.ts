import type { BlockPayload, RoamNode, ChildReconcilerConfig } from "./types";
import type { RoamApiAdapter } from "./roam-api-adapter";
import { delay, maybeYield, MUTATION_DELAY_MS } from "../settings";
import { logDebug } from "../logger";

/**
 * Statistics about a children sync operation.
 */
export interface ChildSyncStats {
  skipped: number;
  updated: number;
  created: number;
  deleted: number;
}

/**
 * Reconciles child blocks (properties) of a parent block.
 * Updates existing properties, creates new ones, and handles special blocks.
 */
export class ChildrenReconciler {
  private readonly mutationDelayMs: number;

  constructor(
    private readonly config: ChildReconcilerConfig,
    private readonly roamApi: RoamApiAdapter
  ) {
    this.mutationDelayMs = config.mutationDelayMs ?? MUTATION_DELAY_MS;
  }

  /**
   * Synchronizes child blocks of a parent.
   *
   * @param parentUid UID of the parent block.
   * @param existingChildren Current child nodes from Roam.
   * @param newChildren Desired child payloads.
   * @returns Statistics about the sync.
   */
  async syncChildren(
    parentUid: string,
    existingChildren: RoamNode[],
    newChildren: BlockPayload[]
  ): Promise<ChildSyncStats> {
    const stats: ChildSyncStats = {
      skipped: 0,
      updated: 0,
      created: 0,
      deleted: 0,
    };

    // Build map of existing property blocks by key
    const existingPropsMap = new Map<string, RoamNode>();
    const existingSpecialBlocks: RoamNode[] = [];

    for (const child of existingChildren) {
      const key = this.config.extractKey(child.text);
      if (key) {
        existingPropsMap.set(key, child);
      } else if (this.config.isSpecialBlock?.(child.text)) {
        existingSpecialBlocks.push(child);
      }
    }

    logDebug("children_reconciler_start", {
      parentUid,
      existingPropsCount: existingPropsMap.size,
      existingSpecialCount: existingSpecialBlocks.length,
      newChildrenCount: newChildren.length,
    });

    let operationCount = 0;

    // Process new children
    for (const newChild of newChildren) {
      const key = this.config.extractKey(newChild.text);

      if (key) {
        // It's a property block
        const existing = existingPropsMap.get(key);

        if (existing) {
          // Update if changed
          if (existing.text === newChild.text) {
            stats.skipped++;
            logDebug("children_reconciler_skip", { key, reason: "unchanged" });
          } else {
            await this.roamApi.updateBlock(existing.uid, newChild.text);
            await delay(this.mutationDelayMs);
            stats.updated++;
            logDebug("children_reconciler_update", { key, uid: existing.uid });
          }
          existingPropsMap.delete(key); // Mark as processed
        } else {
          // Create new property
          await this.roamApi.createBlock(parentUid, newChild, "last");
          await delay(this.mutationDelayMs);
          stats.created++;
          logDebug("children_reconciler_create", { key });
        }
      } else if (this.config.isSpecialBlock?.(newChild.text)) {
        // It's a special block (e.g., comment wrapper)
        // Delete all existing special blocks and recreate
        for (const specialBlock of existingSpecialBlocks) {
          await this.roamApi.deleteBlock(specialBlock.uid);
          await delay(this.mutationDelayMs);
          stats.deleted++;
          logDebug("children_reconciler_delete_special", { uid: specialBlock.uid });
        }
        existingSpecialBlocks.length = 0; // Clear to avoid re-deleting

        // Create the new special block
        await this.roamApi.createBlock(parentUid, newChild, "last");
        await delay(this.mutationDelayMs);
        stats.created++;
        logDebug("children_reconciler_create_special", { text: newChild.text.substring(0, 30) });
      }

      operationCount++;
      await maybeYield(operationCount);
    }

    // Delete orphaned property blocks that are no longer in the desired state
    for (const [key, orphanBlock] of existingPropsMap) {
      await delay(this.mutationDelayMs);
      await this.roamApi.deleteBlock(orphanBlock.uid);
      stats.deleted++;
      logDebug("children_reconciler_delete_orphan", { key, uid: orphanBlock.uid });

      operationCount++;
      await maybeYield(operationCount);
    }

    logDebug("children_reconciler_complete", { ...stats });
    return stats;
  }
}
