// Use React from window to avoid version conflicts with Roam's React
const getReact = () => (window as unknown as { React: typeof import("react") }).React;

import {
  CONFIG_PAGE_TITLE,
  DEFAULT_PAGE_NAME,
  DEFAULT_STATUS_ALIAS_ACTIVE,
  DEFAULT_STATUS_ALIAS_COMPLETED,
  DEFAULT_STATUS_ALIAS_DELETED,
} from "./constants";
import { logWarn } from "./logger";
import type { ExtensionAPI } from "./main";

/**
 * Roam basic node type for tree traversal.
 */
interface RoamBasicNode {
  text: string;
  uid: string;
  children?: RoamBasicNode[];
}

/**
 * Input node for creating blocks.
 */
interface InputTextNode {
  text: string;
  children?: InputTextNode[];
}

/**
 * Gets the Roam Alpha API from window.
 */
function getRoamAPI() {
  return (window as unknown as { roamAlphaAPI?: RoamAlphaAPI }).roamAlphaAPI;
}

interface RoamAlphaAPI {
  q?: (query: string, ...args: unknown[]) => unknown[][];
  data?: {
    pull?: (selector: string, eid: string) => unknown;
  };
  util?: {
    generateUID?: () => string;
  };
  createPage?: (config: { page: { title: string; uid?: string } }) => Promise<void>;
  createBlock?: (config: { location: { "parent-uid": string; order: number | "last" }; block: { string: string; uid?: string } }) => Promise<void>;
}

/**
 * Gets tree by parent UID using Roam API.
 * Returns direct children blocks of the parent.
 */
function getBasicTreeByParentUid(parentUid: string): RoamBasicNode[] {
  const api = getRoamAPI() as unknown as {
    q?: (query: string) => unknown[][];
    pull?: (selector: string, uid: string) => unknown;
  };

  if (!api) return [];

  // Use q API which works better for both pages and blocks
  if (api.q) {
    // Query to get children of a page or block by UID
    const result = api.q(
      `[:find ?string ?uid ?order
        :where
        [?parent :block/uid "${parentUid}"]
        [?parent :block/children ?child]
        [?child :block/string ?string]
        [?child :block/uid ?uid]
        [?child :block/order ?order]]`
    );

    if (result && result.length > 0) {
      // Now get the full tree for each child including their children
      const nodes: RoamBasicNode[] = [];
      for (const row of result) {
        const [text, uid, order] = row as [string, string, number];
        // Get children of this block recursively
        const children = getBasicTreeByParentUid(uid);
        nodes.push({
          text: text ?? "",
          uid: uid ?? "",
          children,
          order,
        } as RoamBasicNode & { order: number });
      }

      return nodes.sort((a, b) => {
        const orderA = (a as RoamBasicNode & { order?: number }).order ?? 0;
        const orderB = (b as RoamBasicNode & { order?: number }).order ?? 0;
        return orderA - orderB;
      });
    }
  }

  return [];
}

/**
 * Gets page UID by title using Roam API.
 */
function getPageUidByPageTitle(title: string): string | undefined {
  const api = getRoamAPI();
  if (!api?.q) return undefined;

  const result = api.q(
    `[:find ?uid :where [?p :node/title "${title}"] [?p :block/uid ?uid]]`
  );

  return result?.[0]?.[0] as string | undefined;
}

/**
 * Gets page titles starting with prefix.
 */
function getPageTitlesStartingWithPrefix(prefix: string): string[] {
  const api = getRoamAPI();
  if (!api?.q) return [];

  const result = api.q(
    `[:find ?title :where [?p :node/title ?title] [(clojure.string/starts-with? ?title "${prefix}")]]`
  );

  return (result || []).map((row) => row[0] as string);
}

/**
 * Creates a page using Roam API.
 * Includes delay after page creation and between initial blocks.
 */
async function createPage(config: { title: string; tree?: InputTextNode[] }): Promise<string> {
  const api = getRoamAPI();
  const uid = api?.util?.generateUID?.() ?? generateUID();

  if (api?.createPage) {
    await api.createPage({ page: { title: config.title, uid } });
    // Delay after page creation
    await delay(MUTATION_DELAY_MS);

    if (config.tree && config.tree.length > 0) {
      for (let i = 0; i < config.tree.length; i++) {
        await createBlockRecursive(uid, config.tree[i], i);
      }
    }
  }

  return uid;
}

/**
 * Creates a block using Roam API.
 * Includes delay after the main block creation; child blocks have their own delays.
 */
async function createBlock(config: { parentUid: string; order: number | "last"; node: InputTextNode }): Promise<string> {
  const api = getRoamAPI();
  const uid = api?.util?.generateUID?.() ?? generateUID();

  if (api?.createBlock) {
    await api.createBlock({
      location: { "parent-uid": config.parentUid, order: config.order },
      block: { string: config.node.text, uid },
    });
    // Delay after main block creation
    await delay(MUTATION_DELAY_MS);

    if (config.node.children && config.node.children.length > 0) {
      for (let i = 0; i < config.node.children.length; i++) {
        await createBlockRecursive(uid, config.node.children[i], i);
      }
    }
  }

  return uid;
}

async function createBlockRecursive(parentUid: string, node: InputTextNode, order: number): Promise<void> {
  const api = getRoamAPI();
  const uid = api?.util?.generateUID?.() ?? generateUID();

  if (api?.createBlock) {
    await api.createBlock({
      location: { "parent-uid": parentUid, order },
      block: { string: node.text, uid },
    });
    // Delay after each mutation to respect rate limits
    await delay(MUTATION_DELAY_MS);

    if (node.children && node.children.length > 0) {
      for (let i = 0; i < node.children.length; i++) {
        await createBlockRecursive(uid, node.children[i], i);
      }
    }
  }
}

/**
 * Updates a block using Roam API.
 */
async function updateBlock(config: { uid: string; text: string }): Promise<void> {
  const api = getRoamAPI() as unknown as { updateBlock?: (config: { block: { uid: string; string: string } }) => Promise<void> };
  if (api?.updateBlock) {
    await api.updateBlock({ block: { uid: config.uid, string: config.text } });
  }
}

/**
 * Deletes a block using Roam API.
 */
async function deleteBlock(uid: string): Promise<void> {
  const api = getRoamAPI() as unknown as { deleteBlock?: (config: { block: { uid: string } }) => Promise<void> };
  if (api?.deleteBlock) {
    await api.deleteBlock({ block: { uid } });
  }
}

function generateUID(): string {
  return Math.random().toString(36).substring(2, 11);
}

/**
 * Delays execution for the specified milliseconds.
 * Used for throttling API calls to avoid rate limits.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Throttle delay between Roam API mutations (in ms).
 * Roam allows 1500 mutations per 60000ms = 25 mutations/second = 40ms between mutations.
 * Using 100ms to be safe and account for recursive block creation overhead.
 */
export const MUTATION_DELAY_MS = 100;

/**
 * Creates a flexible regex for matching setting keys.
 */
function toFlexRegex(key: string): RegExp {
  return new RegExp(`^\\s*${key.replace(/([()])/g, "\\$1")}\\s*(#\\.[\\w\\d-]*\\s*)?$`, "i");
}

/**
 * Gets setting value from tree.
 */
function getSettingValueFromTree(config: { tree: RoamBasicNode[]; key: string; defaultValue: string }): string {
  const node = config.tree.find((n) => toFlexRegex(config.key).test(n.text.trim()));
  return node?.children?.[0]?.text?.trim() ?? config.defaultValue;
}

/**
 * Gets setting int from tree.
 */
function getSettingIntFromTree(config: { tree: RoamBasicNode[]; key: string; defaultValue: number }): number {
  const value = getSettingValueFromTree({ tree: config.tree, key: config.key, defaultValue: "" });
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? config.defaultValue : parsed;
}

/**
 * Gets setting values (array) from tree.
 */
function getSettingValuesFromTree(config: { tree: RoamBasicNode[]; key: string; defaultValue: string[] }): string[] {
  const node = config.tree.find((n) => toFlexRegex(config.key).test(n.text.trim()));
  if (!node?.children) return config.defaultValue;
  return node.children.map((c) => c.text.trim());
}

// Export the helpers for use in blocks.ts
export {
  getBasicTreeByParentUid,
  getPageUidByPageTitle,
  getPageTitlesStartingWithPrefix,
  createPage,
  createBlock,
  updateBlock,
  deleteBlock,
  type RoamBasicNode,
  type InputTextNode,
};

export type StatusAliases = {
  active: string;
  completed: string;
  deleted: string;
};

export type SettingsSnapshot = {
  token?: string;
  pageName: string;
  intervalMs: number;
  includeComments: boolean;
  excludePatterns: RegExp[];
  statusAliases: StatusAliases;
  enableDebugLogs: boolean;
};

export type SettingsHandle =
  | {
      mode: "panel";
      dispose: () => void;
    }
  | {
      mode: "page";
      pageUid: string;
      dispose: () => void;
    };

const SETTINGS_KEYS = {
  token: "todoist_token",
  pagePrefix: "page_prefix",
  intervalMinutes: "sync_interval_minutes",
  includeComments: "include_comments",
  excludePatterns: "exclude_title_patterns",
  enableDebugLogs: "enable_debug_logs",
  statusAliasActive: "status_alias_active",
  statusAliasCompleted: "status_alias_completed",
  statusAliasDeleted: "status_alias_deleted",
} as const;

const DEFAULT_SETTINGS: Record<string, unknown> = {
  [SETTINGS_KEYS.token]: "",
  [SETTINGS_KEYS.pagePrefix]: DEFAULT_PAGE_NAME,
  [SETTINGS_KEYS.intervalMinutes]: 5,
  [SETTINGS_KEYS.includeComments]: false,
  [SETTINGS_KEYS.excludePatterns]: "",
  [SETTINGS_KEYS.enableDebugLogs]: false,
  [SETTINGS_KEYS.statusAliasActive]: DEFAULT_STATUS_ALIAS_ACTIVE,
  [SETTINGS_KEYS.statusAliasCompleted]: DEFAULT_STATUS_ALIAS_COMPLETED,
  [SETTINGS_KEYS.statusAliasDeleted]: DEFAULT_STATUS_ALIAS_DELETED,
};

const SETTINGS_TEMPLATE: InputTextNode[] = [
  { text: "Todoist Token", children: [{ text: "" }] },
  { text: "Target Page Prefix", children: [{ text: DEFAULT_PAGE_NAME }] },
  { text: "Sync Interval (minutes)", children: [{ text: "5" }] },
  { text: "Download Comments" },
  { text: "Excluded Task Title Patterns", children: [{ text: "" }] },
  { text: "Enable Debug Logs" },
  { text: "Status Alias: Active", children: [{ text: DEFAULT_STATUS_ALIAS_ACTIVE }] },
  { text: "Status Alias: Completed", children: [{ text: DEFAULT_STATUS_ALIAS_COMPLETED }] },
  { text: "Status Alias: Deleted", children: [{ text: DEFAULT_STATUS_ALIAS_DELETED }] },
];

export async function initializeSettings(
  extensionAPI: ExtensionAPI
): Promise<SettingsHandle> {
  const hasPanel = typeof extensionAPI.settings.panel?.create === "function";
  if (hasPanel) {
    await ensureDefaults(extensionAPI);
    registerSettingsPanel(extensionAPI);
    return { mode: "panel", dispose: () => undefined };
  }

  const pageUid = await ensureSettingsPage();
  return { mode: "page", pageUid, dispose: () => undefined };
}

export function readSettings(
  extensionAPI: ExtensionAPI,
  handle: SettingsHandle
): SettingsSnapshot {
  if (handle.mode === "panel") {
    return readSettingsFromPanel(extensionAPI);
  }
  return readSettingsFromPage(handle.pageUid);
}

function readSettingsFromPanel(
  extensionAPI: ExtensionAPI
): SettingsSnapshot {
  const allSettings = extensionAPI.settings.getAll() ?? {};
  const token = sanitizeToken(getString(allSettings, SETTINGS_KEYS.token));
  const pageName = getString(allSettings, SETTINGS_KEYS.pagePrefix) || DEFAULT_PAGE_NAME;
  const intervalMinutes = Math.max(
    getNumber(allSettings, SETTINGS_KEYS.intervalMinutes, 5),
    1
  );
  const includeComments = getBoolean(
    allSettings,
    SETTINGS_KEYS.includeComments,
    false
  );
  const excludePatterns = compileTitleExcludePatterns(
    getString(allSettings, SETTINGS_KEYS.excludePatterns)
  );
  const enableDebugLogs = getBoolean(
    allSettings,
    SETTINGS_KEYS.enableDebugLogs,
    false
  );
  const statusAliases = readStatusAliases(allSettings);
  return {
    token,
    pageName,
    intervalMs: intervalMinutes * 60 * 1000,
    includeComments,
    excludePatterns,
    statusAliases,
    enableDebugLogs,
  };
}

export function readSettingsFromPage(pageUid: string): SettingsSnapshot {
  const tree = getBasicTreeByParentUid(pageUid);

  const token = sanitizeToken(
    getSettingValueFromTree({
      tree,
      key: "Todoist Token",
      defaultValue: "",
    })
  );

  const pageName =
    getSettingValueFromTree({
      tree,
      key: "Target Page Prefix",
      defaultValue: DEFAULT_PAGE_NAME,
    }).trim() || DEFAULT_PAGE_NAME;

  const intervalMinutes = Math.max(
    getSettingIntFromTree({
      tree,
      key: "Sync Interval",
      defaultValue: 5,
    }),
    1
  );
  const intervalMs = intervalMinutes * 60 * 1000;

  const excludePatterns = compileTitleExcludePatternsFromTree(
    getSettingValuesFromTree({
      tree,
      key: "Excluded Task Title Patterns",
      defaultValue: [],
    })
  );

  const includeComments = hasFlag(tree, "Download Comments");
  const enableDebugLogs = hasFlag(tree, "Enable Debug Logs");
  const statusAliases = readStatusAliasesFromTree(tree);

  return {
    token,
    pageName,
    intervalMs,
    includeComments,
    excludePatterns,
    statusAliases,
    enableDebugLogs,
  };
}

function sanitizeToken(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function compileTitleExcludePatterns(raw: string | undefined): RegExp[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((pattern) => {
      const { source, flags } = extractPattern(pattern);
      try {
        return new RegExp(source, flags);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logWarn("invalid exclude pattern ignored", { pattern, message });
        return null;
      }
    })
    .filter((value): value is RegExp => value !== null);
}

function compileTitleExcludePatternsFromTree(rawPatterns: string[]): RegExp[] {
  return rawPatterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map((pattern) => {
      const { source, flags } = extractPattern(pattern);
      try {
        return new RegExp(source, flags);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logWarn("invalid exclude pattern ignored", { pattern, message });
        return null;
      }
    })
    .filter((value): value is RegExp => value !== null);
}

function extractPattern(input: string) {
  if (input.startsWith("/")) {
    const lastSlash = input.lastIndexOf("/");
    if (lastSlash > 0) {
      const candidateFlags = input.slice(lastSlash + 1);
      if (/^[a-z]*$/i.test(candidateFlags)) {
        const body = input.slice(1, lastSlash);
        if (body.length > 0) {
          return { source: body, flags: candidateFlags };
        }
      }
    }
  }
  return { source: input, flags: "i" };
}

function readStatusAliases(settings: Record<string, unknown>): StatusAliases {
  return {
    active: readAlias(getString(settings, SETTINGS_KEYS.statusAliasActive), DEFAULT_STATUS_ALIAS_ACTIVE),
    completed: readAlias(
      getString(settings, SETTINGS_KEYS.statusAliasCompleted),
      DEFAULT_STATUS_ALIAS_COMPLETED
    ),
    deleted: readAlias(
      getString(settings, SETTINGS_KEYS.statusAliasDeleted),
      DEFAULT_STATUS_ALIAS_DELETED
    ),
  };
}

function readStatusAliasesFromTree(tree: RoamBasicNode[]): StatusAliases {
  return {
    active: readAliasFromTree(tree, "Status Alias: Active", DEFAULT_STATUS_ALIAS_ACTIVE),
    completed: readAliasFromTree(
      tree,
      "Status Alias: Completed",
      DEFAULT_STATUS_ALIAS_COMPLETED
    ),
    deleted: readAliasFromTree(
      tree,
      "Status Alias: Deleted",
      DEFAULT_STATUS_ALIAS_DELETED
    ),
  };
}

function readAlias(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
}

function readAliasFromTree(tree: RoamBasicNode[], key: string, fallback: string): string {
  const value = getSettingValueFromTree({
    tree,
    key,
    defaultValue: fallback,
  }).trim();
  return value || fallback;
}

function getString(settings: Record<string, unknown>, key: string): string | undefined {
  const value = settings[key];
  return typeof value === "string" ? value : undefined;
}

function getNumber(settings: Record<string, unknown>, key: string, fallback: number): number {
  const value = settings[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function getBoolean(settings: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = settings[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return fallback;
}

async function ensureDefaults(extensionAPI: ExtensionAPI) {
  const current = extensionAPI.settings.getAll() ?? {};
  await Promise.all(
    Object.entries(DEFAULT_SETTINGS).map(async ([key, value]) => {
      if (current[key] === undefined) {
        await extensionAPI.settings.set(key, value);
      }
    })
  );
}

function registerSettingsPanel(extensionAPI: ExtensionAPI) {
  const React = getReact();
  const { useState, useEffect } = React;

  const TextInput = (key: string, type: "text" | "number" = "text", placeholder = "") =>
    function TextInputComponent() {
      const getInitial = () => {
        const settings = extensionAPI.settings.getAll() ?? {};
        if (type === "number") {
          return String(
            getNumber(
              settings,
              key,
              Number(DEFAULT_SETTINGS[key]) || 0
            )
          );
        }
        return getString(settings, key) ?? String(DEFAULT_SETTINGS[key] ?? "");
      };
      const [value, setValue] = useState(getInitial());
      useEffect(() => {
        setValue(getInitial());
      }, []);
      return React.createElement("input", {
        type,
        placeholder,
        value,
        style: { width: "100%" },
        onChange: (event: { target: { value: string } }) => {
          const next = event.target.value;
          setValue(next);
          void extensionAPI.settings.set(
            key,
            type === "number" ? Number(next) || Number(DEFAULT_SETTINGS[key]) || 0 : next
          );
        },
      });
    };

  const TextArea = (key: string, placeholder = "") =>
    function TextAreaComponent() {
      const getInitial = () =>
        getString(extensionAPI.settings.getAll() ?? {}, key) ?? String(DEFAULT_SETTINGS[key] ?? "");
      const [value, setValue] = useState(getInitial());
      useEffect(() => {
        setValue(getInitial());
      }, []);
      return React.createElement("textarea", {
        placeholder,
        value,
        style: { width: "100%", minHeight: "6rem" },
        onChange: (event: { target: { value: string } }) => {
          const next = event.target.value;
          setValue(next);
          void extensionAPI.settings.set(key, next);
        },
      });
    };

  const Toggle = (key: string) =>
    function ToggleComponent() {
      const getInitial = () =>
        getBoolean(extensionAPI.settings.getAll() ?? {}, key, Boolean(DEFAULT_SETTINGS[key]));
      const [checked, setChecked] = useState(getInitial());
      useEffect(() => {
        setChecked(getInitial());
      }, []);
      return React.createElement(
        "label",
        { style: { display: "inline-flex", alignItems: "center", gap: "0.5rem" } },
        React.createElement("input", {
          type: "checkbox",
          checked,
          onChange: (event: { target: { checked: boolean } }) => {
            const next = event.target.checked;
            setChecked(next);
            void extensionAPI.settings.set(key, next);
          },
        }),
        checked ? "Enabled" : "Disabled"
      );
    };

  extensionAPI.settings.panel!.create({
    tabTitle: "Todoist Backup",
    settings: [
      {
        id: SETTINGS_KEYS.token,
        name: "Todoist Token",
        description:
          "Personal Todoist token (read-only). Paste the value from Todoist → Settings → Integrations.",
        action: {
          type: "reactComponent",
          component: TextInput(SETTINGS_KEYS.token, "text", "todoist_api_token"),
        },
      },
      {
        id: SETTINGS_KEYS.pagePrefix,
        name: "Target Page Prefix",
        description:
          "Prefix for destination pages in Roam. Each task is saved to `prefix/<todoist-id>`.",
        action: {
          type: "reactComponent",
          component: TextInput(SETTINGS_KEYS.pagePrefix, "text", DEFAULT_PAGE_NAME),
        },
      },
      {
        id: SETTINGS_KEYS.intervalMinutes,
        name: "Sync Interval (minutes)",
        description: "Minutes between automatic syncs (minimum: 1).",
        action: {
          type: "reactComponent",
          component: TextInput(SETTINGS_KEYS.intervalMinutes, "number", "5"),
        },
      },
      {
        id: SETTINGS_KEYS.includeComments,
        name: "Download Comments",
        description: "Download Todoist comments and include them as child blocks.",
        action: {
          type: "reactComponent",
          component: Toggle(SETTINGS_KEYS.includeComments),
        },
      },
      {
        id: SETTINGS_KEYS.excludePatterns,
        name: "Excluded Task Title Patterns",
        description:
          "Regular expressions to exclude tasks by title. Enter one per line (e.g., `/^Chore/`).",
        action: {
          type: "reactComponent",
          component: TextArea(SETTINGS_KEYS.excludePatterns, "/^Example/"),
        },
      },
      {
        id: SETTINGS_KEYS.enableDebugLogs,
        name: "Enable Debug Logs",
        description:
          "Display additional logs in the browser console (useful for debugging).",
        action: {
          type: "reactComponent",
          component: Toggle(SETTINGS_KEYS.enableDebugLogs),
        },
      },
      {
        id: SETTINGS_KEYS.statusAliasActive,
        name: "Status Alias: Active",
        description: "Text or emoji displayed for active tasks (default: ◼️).",
        action: {
          type: "reactComponent",
          component: TextInput(
            SETTINGS_KEYS.statusAliasActive,
            "text",
            DEFAULT_STATUS_ALIAS_ACTIVE
          ),
        },
      },
      {
        id: SETTINGS_KEYS.statusAliasCompleted,
        name: "Status Alias: Completed",
        description: "Text or emoji displayed for completed tasks (default: ✅).",
        action: {
          type: "reactComponent",
          component: TextInput(
            SETTINGS_KEYS.statusAliasCompleted,
            "text",
            DEFAULT_STATUS_ALIAS_COMPLETED
          ),
        },
      },
      {
        id: SETTINGS_KEYS.statusAliasDeleted,
        name: "Status Alias: Deleted",
        description: "Text or emoji displayed for deleted tasks (default: ❌).",
        action: {
          type: "reactComponent",
          component: TextInput(
            SETTINGS_KEYS.statusAliasDeleted,
            "text",
            DEFAULT_STATUS_ALIAS_DELETED
          ),
        },
      },
    ],
  });
}

async function ensureSettingsPage(): Promise<string> {
  let pageUid = getPageUidByPageTitle(CONFIG_PAGE_TITLE);
  if (!pageUid) {
    pageUid = await createPage({
      title: CONFIG_PAGE_TITLE,
      tree: SETTINGS_TEMPLATE,
    });
  } else {
    await ensureSettingsTemplate(pageUid);
  }
  return pageUid;
}

function hasFlag(tree: RoamBasicNode[], key: string): boolean {
  const regex = toFlexRegex(key);
  return tree.some((node) => regex.test(node.text.trim()));
}

async function ensureSettingsTemplate(pageUid: string): Promise<void> {
  const tree = getBasicTreeByParentUid(pageUid);
  const map = new Map<string, RoamBasicNode>();
  for (const node of tree) {
    map.set(node.text.trim().toLowerCase(), node);
  }

  for (const template of SETTINGS_TEMPLATE) {
    const key = template.text.trim().toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      await createBlock({
        parentUid: pageUid,
        order: "last",
        node: template,
      });
      continue;
    }

    if (template.children && template.children.length > 0) {
      const hasChildren = Array.isArray(existing.children) && existing.children.length > 0;
      if (!hasChildren) {
        for (let index = 0; index < template.children.length; index += 1) {
          const child = template.children[index];
          await createBlock({
            parentUid: existing.uid,
            order: index,
            node: child,
          });
        }
      }
    }
  }
}

