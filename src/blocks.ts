import {
  getBasicTreeByParentUid,
  getPageUidByPageTitle,
  getPageTitlesStartingWithPrefix,
  createPage,
  createBlock,
  updateBlock,
  deleteBlock,
  delay,
  MUTATION_DELAY_MS,
  type RoamBasicNode,
  type InputTextNode,
} from "./settings";

import {
  PLACEHOLDER_CONTENT,
  TODOIST_COMMENT_ID_PROPERTY,
  TODOIST_COMMENTS_PROPERTY,
  TODOIST_COMMENT_POSTED_PROPERTY,
  TODOIST_COMPLETED_PROPERTY,
  TODOIST_DUE_PROPERTY,
  TODOIST_ID_PROPERTY,
  TODOIST_STATUS_PROPERTY,
} from "./constants";
import {
  formatDue,
  formatLabelTag,
  safeLinkText,
  safeText,
  dueTimestamp,
  convertInlineTodoistLabels,
  formatDisplayDate,
  TodoistBackupTask,
  TodoistComment,
} from "./todoist";
import { logDebug } from "./logger";
import type { StatusAliases } from "./settings";

type BlockPayload = {
  text: string;
  children: BlockPayload[];
};

type TaskWithBlock = {
  task: TodoistBackupTask;
  block: BlockPayload;
};

/**
 * Determines the destination page name for a task.
 * Each task lives inside a dedicated page identified by its Todoist id.
 *
 * @param task Todoist task to determine page for.
 * @param pagePrefix Base page name prefix from settings (e.g., "todoist").
 */
export function resolveTaskPageName(task: TodoistBackupTask, pagePrefix: string): string {
  return `${pagePrefix}/${String(task.id)}`;
}

/**
 * Writes tasks to their dedicated Roam pages under the configured prefix.
 *
 * @param pagePrefix Base page name prefix from settings (e.g., "todoist").
 * @param tasks Todoist tasks to serialize.
 * @param projectMap Mapping of project ids to names.
 * @param labelMap Mapping of label ids or names to normalized names.
 * @param statusAliases Custom aliases for task status values.
 */
export async function writeBlocks(
  pagePrefix: string,
  tasks: TodoistBackupTask[],
  projectMap: Map<string, string>,
  labelMap: Map<string, string>,
  statusAliases: StatusAliases
) {
  const tasksByPage = new Map<string, TaskWithBlock[]>();

  for (const task of tasks) {
    const pageName = resolveTaskPageName(task, pagePrefix);
    // Properties are stored as child blocks, followed by comments
    const propertyBlocks = buildPropertyBlocks(task, projectMap, labelMap, statusAliases);
    const commentBlocks = buildCommentBlocks(task);
    const block: BlockPayload = {
      text: blockContent(task, projectMap, labelMap, statusAliases),
      children: [...propertyBlocks, ...commentBlocks],
    };

    if (!tasksByPage.has(pageName)) {
      tasksByPage.set(pageName, []);
    }
    tasksByPage.get(pageName)!.push({ task, block });
  }

  for (const [pageName, tasksWithBlocks] of tasksByPage.entries()) {
    const blocks = tasksWithBlocks.map((t) => t.block);
    await writeBlocksToPage(pageName, blocks);
  }

  await cleanupObsoletePages(pagePrefix, tasksByPage);
}

async function writeBlocksToPage(pageName: string, blocks: BlockPayload[]) {
  // ensurePage/createPage includes its own delay when creating new pages
  const pageUid = await ensurePage(pageName);

  const existingTree = getBasicTreeByParentUid(pageUid);
  const blockMap = buildBlockMap(existingTree);

  // Log existing blocks for debugging
  const existingIds = Array.from(blockMap.keys());
  const existingTexts = existingTree.map(n => ({
    text: n.text?.substring(0, 50) + "...",
    childCount: n.children?.length ?? 0,
    firstChildText: n.children?.[0]?.text?.substring(0, 50) ?? "no children"
  }));

  logDebug("write_blocks_to_page", {
    pageName,
    pageUid,
    existingBlocksCount: existingTree.length,
    blockMapSize: blockMap.size,
    existingIds,
    existingTexts,
    newBlocksCount: blocks.length,
  });

  const seenIds = new Set<string>();
  for (const block of blocks) {
    // Extract todoist-id from child blocks (new structure) or main text (legacy)
    const todoistId = extractTodoistIdFromBlock(block);
    if (!todoistId) {
      continue;
    }
    seenIds.add(todoistId);

    const existing = blockMap.get(todoistId);
    if (existing) {
      // Update main block text if changed
      if (existing.text !== block.text) {
        logDebug("update_existing_block", { todoistId, uid: existing.uid });
        await updateBlock({ uid: existing.uid, text: block.text });
        await delay(MUTATION_DELAY_MS);
      }
      // Sync children (properties + comments)
      await syncChildren(existing.uid, block.children);
    } else {
      logDebug("create_new_block", { todoistId, pageName });
      // createBlock includes its own delays for rate limiting
      await createBlock({
        parentUid: pageUid,
        order: "last",
        node: toInputNode(block),
      });
    }
  }

  await removeObsoleteBlocks(blockMap, seenIds);
  await updatePlaceholderState(pageUid);
}

async function ensurePage(pageName: string): Promise<string> {
  const existingUid = getPageUidByPageTitle(pageName);
  if (existingUid) {
    return existingUid;
  }
  // createPage includes its own delay for rate limiting
  const uid = await createPage({ title: pageName });
  return uid;
}

async function removeObsoleteBlocks(blockMap: Map<string, RoamBasicNode>, seenIds: Set<string>) {
  for (const [todoistId, node] of blockMap.entries()) {
    if (seenIds.has(todoistId)) {
      continue;
    }
    const content = node.text ?? "";
    const status = extractTodoistStatus(content);
    if (status === "completed") {
      continue;
    }
    if (!status && hasCompletedProperty(content)) {
      continue;
    }
    await deleteBlock(node.uid);
    await delay(MUTATION_DELAY_MS);
  }
}

/**
 * Extracts todoist-id from a BlockPayload, checking both main text and children.
 */
function extractTodoistIdFromBlock(block: BlockPayload): string | undefined {
  // First check main text (legacy format)
  let id = extractTodoistId(block.text);
  if (id) return id;

  // Check children (new format: properties as child blocks)
  for (const child of block.children) {
    id = extractTodoistId(child.text);
    if (id) return id;
  }

  return undefined;
}

/**
 * Synchronizes child blocks (properties and comments) for an existing task block.
 * Updates existing properties, creates new ones, and handles comment wrappers.
 */
async function syncChildren(parentUid: string, newChildren: BlockPayload[]) {
  const existingChildren = getBasicTreeByParentUid(parentUid);

  // Build a map of existing property blocks by their property key (e.g., "todoist-id")
  const existingPropsMap = new Map<string, RoamBasicNode>();
  for (const child of existingChildren) {
    const propKey = extractPropertyKey(child.text);
    if (propKey) {
      existingPropsMap.set(propKey, child);
    }
  }

  // Process new children
  for (const newChild of newChildren) {
    const propKey = extractPropertyKey(newChild.text);

    if (propKey) {
      // It's a property block
      const existing = existingPropsMap.get(propKey);
      if (existing) {
        // Update if changed
        if (existing.text !== newChild.text) {
          await updateBlock({ uid: existing.uid, text: newChild.text });
          await delay(MUTATION_DELAY_MS);
        }
        existingPropsMap.delete(propKey); // Mark as processed
      } else {
        // Create new property - createBlock includes its own delays
        await createBlock({
          parentUid,
          order: "last",
          node: toInputNode(newChild),
        });
      }
    } else if (isCommentWrapper(newChild.text)) {
      // It's a comment wrapper - delete old one and recreate
      for (const child of existingChildren) {
        if (isCommentWrapper(child.text)) {
          await deleteBlock(child.uid);
          await delay(MUTATION_DELAY_MS);
        }
      }
      // createBlock includes its own delays
      await createBlock({
        parentUid,
        order: "last",
        node: toInputNode(newChild),
      });
    }
  }
}

/**
 * Extracts the property key from a Roam property line (e.g., "todoist-id" from "todoist-id:: value").
 */
function extractPropertyKey(text: string): string | undefined {
  const match = text.match(/^([\w-]+)::/);
  return match ? match[1] : undefined;
}

async function updatePlaceholderState(pageUid: string) {
  const tree = getBasicTreeByParentUid(pageUid);
  const placeholders = tree.filter((node) => node.text.trim() === PLACEHOLDER_CONTENT);
  for (const placeholder of placeholders) {
    await deleteBlock(placeholder.uid);
    await delay(MUTATION_DELAY_MS);
  }
}

async function cleanupObsoletePages(
  pagePrefix: string,
  currentTasksByPage: Map<string, TaskWithBlock[]>
) {
  const currentTaskIds = new Set<string>();
  for (const tasksWithBlocks of currentTasksByPage.values()) {
    for (const { task } of tasksWithBlocks) {
      currentTaskIds.add(String(task.id));
    }
  }

  const prefix = `${pagePrefix}/`;
  const pageTitles = getPageTitlesStartingWithPrefix(prefix);
  for (const pageTitle of pageTitles) {
    if (currentTasksByPage.has(pageTitle)) {
      continue;
    }
    const pageUid = getPageUidByPageTitle(pageTitle);
    if (!pageUid) {
      continue;
    }

    const tree = getBasicTreeByParentUid(pageUid);
    const blockMap = buildBlockMap(tree);
    for (const [todoistId, node] of blockMap.entries()) {
      if (currentTaskIds.has(todoistId)) {
        continue;
      }
      const content = node.text ?? "";
      const status = extractTodoistStatus(content);
      if (status === "completed") {
        continue;
      }
      if (!status && hasCompletedProperty(content)) {
        continue;
      }
      await deleteBlock(node.uid);
      await delay(MUTATION_DELAY_MS);
    }

    await updatePlaceholderState(pageUid);
  }
}

/**
 * Builds block payloads for a set of Todoist tasks, including comments.
 *
 * @param tasks Tasks returned from Todoist ready for serialization.
 * @param projectMap Mapping of project ids to names.
 * @param labelMap Mapping of label ids or names to normalized names.
 * @param statusAliases Custom aliases for task status values.
 */
export function buildBlocks(
  tasks: TodoistBackupTask[],
  projectMap: Map<string, string>,
  labelMap: Map<string, string>,
  statusAliases: StatusAliases
): BlockPayload[] {
  const sorted = [...tasks].sort((a, b) => {
    const aCompleted = Boolean(a.completed);
    const bCompleted = Boolean(b.completed);
    if (aCompleted !== bCompleted) {
      return aCompleted ? 1 : -1;
    }
    const aTime = dueTimestamp(a.due);
    const bTime = dueTimestamp(b.due);
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return safeText(a.content).localeCompare(safeText(b.content));
  });

  return sorted.map((task) => {
    const propertyBlocks = buildPropertyBlocks(task, projectMap, labelMap, statusAliases);
    const commentBlocks = buildCommentBlocks(task);
    return {
      text: blockContent(task, projectMap, labelMap, statusAliases),
      children: [...propertyBlocks, ...commentBlocks],
    };
  });
}

/**
 * Generates only the title/header text for a task block.
 * Properties are now stored as child blocks, not in the main text.
 *
 * @param task Todoist task with optional completion metadata.
 * @param projectMap Mapping of project ids to names.
 * @param _labelMap Unused, kept for API compatibility.
 * @param _statusAliases Unused, kept for API compatibility.
 */
export function blockContent(
  task: TodoistBackupTask,
  projectMap: Map<string, string>,
  _labelMap: Map<string, string>,
  _statusAliases: StatusAliases
) {
  const dueText = resolvePrimaryDate(task);
  const rawTitle = safeLinkText(safeText(task.content) || "Untitled task");
  const taskTitle = convertInlineTodoistLabels(rawTitle);
  const projectName = projectMap.get(String(task.project_id ?? "")) ?? "Inbox";

  const dateLink = dueText ? `[[${dueText}]]` : "[[No due date]]";

  // Title includes task content and project tag for quick reference
  return `${dateLink} ${taskTitle} #${projectName}`;
}

/**
 * Builds property blocks as children of the main task block.
 * This ensures todoist-id:: is stored in a child block where it can be found.
 */
export function buildPropertyBlocks(
  task: TodoistBackupTask,
  _projectMap: Map<string, string>,
  labelMap: Map<string, string>,
  statusAliases: StatusAliases
): BlockPayload[] {
  const url = task.url ?? `https://todoist.com/showTask?id=${task.id}`;
  const labels = resolveLabels(task, labelMap);

  const properties: BlockPayload[] = [];

  // todoist-id is always first - this is how we identify the block
  properties.push({ text: `todoist-id:: [${task.id}](${url})`, children: [] });

  const duePropertyValue = resolveDuePropertyValue(task);
  if (duePropertyValue) {
    properties.push({ text: `${TODOIST_DUE_PROPERTY}:: ${duePropertyValue}`, children: [] });
  }

  const description = safeText(task.description ?? "");
  if (description) {
    properties.push({ text: `todoist-desc:: ${description}`, children: [] });
  }

  const labelsProperty = labels
    .map((label) => {
      const tag = formatLabelTag(label);
      return tag.startsWith("#") ? tag : `#${tag}`;
    })
    .filter((value) => value.length > 0)
    .join(" ");

  if (labelsProperty) {
    properties.push({ text: `todoist-labels:: ${labelsProperty}`, children: [] });
  }

  if (task.completed) {
    const completedDate = task.completed_date ?? task.completed_at ?? "";
    const formatted = formatCompletedDate(completedDate);
    const completedValue = formatted ? `[[${formatted}]]` : completedDate ? safeLinkText(completedDate) : "";
    if (completedValue) {
      properties.push({ text: `${TODOIST_COMPLETED_PROPERTY}:: ${completedValue}`, children: [] });
    }
  }

  const statusValue = task.status ?? (task.completed ? "completed" : "active");
  const statusAlias = resolveStatusAlias(statusValue, statusAliases);
  properties.push({ text: `${TODOIST_STATUS_PROPERTY}:: ${statusAlias}`, children: [] });

  return properties;
}

function buildCommentBlocks(task: TodoistBackupTask): BlockPayload[] {
  const comments = task.comments ?? [];
  if (comments.length === 0) {
    return [];
  }

  const sorted = [...comments].sort((a, b) => {
    const aTime = commentTimestamp(a.posted_at);
    const bTime = commentTimestamp(b.posted_at);
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return String(a.id).localeCompare(String(b.id));
  });

  const wrapper: BlockPayload = {
    text: buildCommentWrapperContent(sorted.length),
    children: sorted.map((comment) => ({
      text: commentContent(task, comment),
      children: [],
    })),
  };

  return [wrapper];
}

function buildCommentWrapperContent(commentCount: number) {
  return ["comments...", `${TODOIST_COMMENTS_PROPERTY}:: ${commentCount}`].join("\n");
}

function commentContent(task: TodoistBackupTask, comment: TodoistComment) {
  const sanitizedText = safeText(comment.content);
  const formattedText = sanitizedText ? safeLinkText(sanitizedText) : "";
  const url = buildCommentUrl(task, comment);
  const prefix = `[todoist](${url})`;
  const commentLine = formattedText ? `${prefix} ${formattedText}` : prefix;
  const lines = [commentLine, `${TODOIST_COMMENT_ID_PROPERTY}:: ${comment.id}`];
  if (comment.posted_at) {
    const formatted = formatCommentTimestamp(comment.posted_at);
    lines.push(`${TODOIST_COMMENT_POSTED_PROPERTY}:: ${formatted}`);
  }
  return lines.join("\n");
}

function buildCommentUrl(task: TodoistBackupTask, comment: TodoistComment) {
  const taskId = String(comment.task_id ?? task.id);
  return `https://todoist.com/app/task/${taskId}/comment/${comment.id}`;
}

function formatCommentTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return safeText(value);
  }
  return parsed.toISOString();
}

function isCommentWrapper(content: string) {
  return new RegExp(`(?:^|\\n)${TODOIST_COMMENTS_PROPERTY}::`, "m").test(content);
}

function commentTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function resolvePrimaryDate(task: TodoistBackupTask) {
  const dueFormatted = formatDue(task.due);
  if (dueFormatted) {
    return safeLinkText(dueFormatted);
  }
  const fallback = task.fallbackDue ?? "";
  if (fallback) {
    return safeLinkText(fallback);
  }

  if (task.completed) {
    const completedFormatted = formatCompletedDate(task.completed_date ?? task.completed_at ?? "");
    if (completedFormatted) {
      return safeLinkText(completedFormatted);
    }
  }

  return "";
}

function resolveDuePropertyValue(task: TodoistBackupTask) {
  const explicitDue = formatDue(task.due);
  if (explicitDue) {
    return explicitDue;
  }
  return undefined;
}

function formatCompletedDate(value: string | null | undefined) {
  return formatDisplayDate(value);
}

export function extractTodoistId(content: string): string | undefined {
  const match = content.match(new RegExp(`^${TODOIST_ID_PROPERTY}::\\s*(.+)$`, "mi"));
  if (!match) {
    return undefined;
  }

  const rawValue = match[1].trim();

  // Handle markdown link format: [id](url) - extract just the id
  // Support both numeric IDs (123456) and alphanumeric IDs (mock-001)
  const linkMatch = rawValue.match(/^\[([^\]]+)\]\(/);
  if (linkMatch) {
    return linkMatch[1];
  }

  // Handle plain ID (number or alphanumeric)
  const plainMatch = rawValue.match(/^([\w-]+)/);
  if (plainMatch) {
    return plainMatch[1];
  }

  return rawValue;
}

function extractTodoistStatus(content: string): TodoistBackupTask["status"] | undefined {
  const match = content.match(new RegExp(`^${TODOIST_STATUS_PROPERTY}::\\s*(.+)$`, "mi"));
  const value = match ? match[1].trim().toLowerCase() : undefined;
  if (value === "active" || value === "completed" || value === "deleted") {
    return value;
  }
  return undefined;
}

function hasCompletedProperty(content: string) {
  return new RegExp(`^${TODOIST_COMPLETED_PROPERTY}::\\s*(.+)$`, "mi").test(content);
}

export function buildBlockMap(tree: RoamBasicNode[]) {
  const map = new Map<string, RoamBasicNode>();

  for (const node of tree) {
    const text = node.text ?? "";
    let id = extractTodoistId(text);

    // If not found in main block, check children (properties are stored as child blocks)
    if (!id && node.children && node.children.length > 0) {
      for (const child of node.children) {
        const childText = child.text ?? "";
        id = extractTodoistId(childText);
        if (id) {
          break;
        }
      }
    }

    if (id) {
      map.set(id, node);
      logDebug("build_block_map_found", { id, uid: node.uid });
    }
  }
  return map;
}

function resolveLabels(task: TodoistBackupTask, labelMap: Map<string, string>) {
  const values = task.labels ?? task.label_ids ?? [];
  const names: string[] = [];
  for (const value of values ?? []) {
    const key = String(value);
    const name = labelMap.get(key) ?? key;
    const normalized = safeText(name);
    if (normalized && !names.includes(normalized)) {
      names.push(normalized);
    }
  }
  return names;
}

function resolveStatusAlias(status: string, statusAliases: StatusAliases): string {
  switch (status) {
    case "active":
      return statusAliases.active;
    case "completed":
      return statusAliases.completed;
    case "deleted":
      return statusAliases.deleted;
    default:
      return status;
  }
}

function toInputNode(payload: BlockPayload): InputTextNode {
  return {
    text: payload.text,
    children: payload.children.map(toInputNode),
  };
}

