/**
 * Block payload for creating/updating blocks in Roam.
 */
export type BlockPayload = {
  text: string;
  children?: BlockPayload[];
};

/**
 * Represents a block node in Roam's tree structure.
 */
export interface RoamNode {
  text: string;
  uid: string;
  children?: RoamNode[];
}

/**
 * Configuration for reconciling items with Roam blocks.
 * @template T The type of source items (e.g., TodoistBackupTask).
 */
export interface ReconcilerConfig<T> {
  /**
   * Extracts a unique identifier from the source item.
   * This ID is used to match items with existing blocks.
   */
  extractId: (item: T) => string;

  /**
   * Builds a block payload from the source item.
   */
  buildBlock: (item: T) => BlockPayload;

  /**
   * Extracts the unique identifier from an existing Roam block.
   * Returns undefined if the block doesn't have a recognizable ID.
   */
  extractIdFromBlock: (node: RoamNode) => string | undefined;

  /**
   * Optional configuration options.
   */
  options?: ReconcilerOptions;
}

/**
 * Options for customizing reconciliation behavior.
 */
export interface ReconcilerOptions {
  /**
   * Determines whether a block should be preserved even when
   * its corresponding item was removed from the source.
   * Useful for keeping completed tasks that are no longer in the active list.
   */
  preserveWhen?: (node: RoamNode) => boolean;

  /**
   * Callback invoked during sync to report progress.
   */
  onProgress?: (stats: SyncStats) => void;

  /**
   * Delay in milliseconds between Roam API mutations.
   * Default: 100ms
   */
  mutationDelayMs?: number;

  /**
   * Number of operations to process before yielding to the main thread.
   * Default: 3
   */
  yieldBatchSize?: number;
}

/**
 * Statistics about a sync operation.
 */
export interface SyncStats {
  /** Total number of items processed */
  total: number;
  /** Blocks that were unchanged and skipped */
  skipped: number;
  /** New blocks created */
  created: number;
  /** Existing blocks that were updated */
  updated: number;
  /** Obsolete blocks that were deleted */
  deleted: number;
}

/**
 * Configuration for reconciling child blocks (properties).
 */
export interface ChildReconcilerConfig {
  /**
   * Extracts the property key from block text.
   * For example, extracts "todoist-id" from "todoist-id:: value".
   * Returns undefined if the text is not a property block.
   */
  extractKey: (text: string) => string | undefined;

  /**
   * Identifies special blocks that need different handling.
   * For example, comment wrapper blocks that should be replaced entirely.
   */
  isSpecialBlock?: (text: string) => boolean;

  /**
   * Delay in milliseconds between Roam API mutations.
   * Default: 100ms
   */
  mutationDelayMs?: number;
}
