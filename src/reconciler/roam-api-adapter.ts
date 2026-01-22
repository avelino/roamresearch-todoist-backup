import type { BlockPayload, RoamNode } from "./types";
import {
  getBasicTreeByParentUid,
  createBlock as roamCreateBlock,
  updateBlock as roamUpdateBlock,
  deleteBlock as roamDeleteBlock,
  type RoamBasicNode,
  type InputTextNode,
} from "../settings";

/**
 * Adapter interface for Roam API operations.
 * Abstracts the underlying Roam API to make the reconciler testable.
 */
export interface RoamApiAdapter {
  /**
   * Gets child blocks of a parent block or page.
   */
  getChildren(parentUid: string): RoamNode[];

  /**
   * Creates a new block under a parent.
   * @returns The UID of the created block.
   */
  createBlock(
    parentUid: string,
    block: BlockPayload,
    order?: number | "last"
  ): Promise<string>;

  /**
   * Updates the text of an existing block.
   */
  updateBlock(uid: string, text: string): Promise<void>;

  /**
   * Deletes a block by its UID.
   */
  deleteBlock(uid: string): Promise<void>;
}

/**
 * Converts a RoamBasicNode to the RoamNode interface used by the reconciler.
 */
function toRoamNode(node: RoamBasicNode): RoamNode {
  return {
    text: node.text ?? "",
    uid: node.uid,
    children: node.children?.map(toRoamNode),
  };
}

/**
 * Converts a BlockPayload to the InputTextNode format expected by Roam API.
 */
function toInputNode(payload: BlockPayload): InputTextNode {
  return {
    text: payload.text,
    children: payload.children?.map(toInputNode),
  };
}

/**
 * Creates the default Roam API adapter using roamAlphaAPI.
 */
export function createRoamApiAdapter(): RoamApiAdapter {
  return {
    getChildren(parentUid: string): RoamNode[] {
      const nodes = getBasicTreeByParentUid(parentUid);
      return nodes.map(toRoamNode);
    },

    async createBlock(
      parentUid: string,
      block: BlockPayload,
      order: number | "last" = "last"
    ): Promise<string> {
      const uid = await roamCreateBlock({
        parentUid,
        order,
        node: toInputNode(block),
      });
      return uid;
    },

    async updateBlock(uid: string, text: string): Promise<void> {
      await roamUpdateBlock({ uid, text });
    },

    async deleteBlock(uid: string): Promise<void> {
      await roamDeleteBlock(uid);
    },
  };
}
