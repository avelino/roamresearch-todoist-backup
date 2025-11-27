import "./polyfills";

import { writeBlocks } from "./blocks";
import {
  buildLabelMap,
  buildNameMap,
  fetchTaskComments,
  fetchCompletedTasks,
  fetchPaginated,
  mergeBackupTasks,
  TodoistBackupTask,
  TodoistLabel,
  TodoistProject,
  TodoistTask,
  safeText,
  generateMockTasks,
  generateMockCompletedTasks,
  generateMockProjects,
  generateMockLabels,
} from "./todoist";
import {
  initializeSettings,
  readSettings,
  type SettingsHandle,
  type SettingsSnapshot,
} from "./settings";
import { cancelScheduledSync, scheduleAutoSync } from "./scheduler";
import { registerCommand, registerTopbarButton } from "./ui";
import { logError, logInfo, logDebug, setDebugEnabled } from "./logger";

/**
 * Extension API interface provided by Roam Research.
 */
export interface ExtensionAPI {
  settings: {
    get: (key: string) => unknown;
    getAll: () => Record<string, unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    panel?: {
      create: (config: SettingsPanelConfig) => void;
    };
  };
  ui?: {
    commandPalette?: {
      addCommand: (config: { label: string; callback: () => void }) => Promise<void>;
      removeCommand: (config: { label: string }) => Promise<void>;
    };
  };
}

interface SettingsPanelConfig {
  tabTitle: string;
  settings: Array<{
    id: string;
    name: string;
    description: string;
    action: {
      type: string;
      component: React.ComponentType;
    };
  }>;
}

interface OnloadArgs {
  extensionAPI: ExtensionAPI;
}

let syncInProgress = false;
let settingsHandle: SettingsHandle | null = null;
let extensionAPIRef: ExtensionAPI | null = null;
let lastIntervalMs: number | null = null;
let lastToken: string | undefined;
let unregisterCommand: (() => Promise<void>) | null = null;
let removeTopbarButton: (() => void) | null = null;
let initialized = false;

/**
 * Extension onload handler - called by Roam when the extension is loaded.
 */
async function onload(args: OnloadArgs): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    // Wait a bit for Roam API to be fully ready
    await new Promise(resolve => setTimeout(resolve, 100));

    const { extensionAPI } = args;
    extensionAPIRef = extensionAPI;
    settingsHandle = await initializeSettings(extensionAPI);
    refreshSettings();

    unregisterCommand = await registerCommand(extensionAPI, () => syncTodoist("manual"));
    removeTopbarButton = registerTopbarButton(() => syncTodoist("manual"));

    initialized = true;
    logInfo("Todoist Backup extension loaded successfully");
  } catch (error) {
    logError("Extension initialization failed", error);
  }
}

/**
 * Extension onunload handler - called by Roam when the extension is unloaded.
 */
function onunload(): void {
  cancelScheduledSync();
  if (removeTopbarButton) {
    removeTopbarButton();
    removeTopbarButton = null;
  }
  if (unregisterCommand) {
    void unregisterCommand();
    unregisterCommand = null;
  }
  settingsHandle?.dispose();
  settingsHandle = null;
  extensionAPIRef = null;
  lastIntervalMs = null;
  lastToken = undefined;
  initialized = false;
  logInfo("Todoist Backup extension unloaded");
}

/**
 * Default export for Roam extension system.
 */
const extension = {
  onload,
  onunload,
};

export default extension;

function refreshSettings(): SettingsSnapshot {
  if (!extensionAPIRef || !settingsHandle) {
    throw new Error("Settings have not been initialized.");
  }
  const snapshot = readSettings(extensionAPIRef, settingsHandle);
  setDebugEnabled(snapshot.enableDebugLogs);
  maybeRescheduleAutoSync(snapshot);
  return snapshot;
}

function maybeRescheduleAutoSync(snapshot: SettingsSnapshot) {
  const token = snapshot.token;
  if (!token) {
    cancelScheduledSync();
    lastIntervalMs = null;
    lastToken = undefined;
    return;
  }

  if (snapshot.intervalMs === lastIntervalMs && token === lastToken) {
    return;
  }

  scheduleAutoSync(() => syncTodoist("auto"), snapshot.intervalMs);
  lastIntervalMs = snapshot.intervalMs;
  lastToken = token;
}

async function syncTodoist(trigger: "manual" | "auto") {
  if (syncInProgress) {
    if (trigger === "manual") {
      showStatusMessage("Sync is already in progress.", "warning");
    }
    return;
  }

  const settings = refreshSettings();

  // Use mock data when debug logs are enabled (development mode)
  const useMockData = settings.enableDebugLogs;

  if (!useMockData && !settings.token) {
    if (trigger === "manual") {
      showStatusMessage(
        "Please configure your Todoist token in extension settings (Roam Depot → Extension Settings → Todoist Backup).",
        "warning"
      );
    }
    return;
  }

  syncInProgress = true;
  if (trigger === "manual") {
    if (useMockData) {
      showStatusMessage("🧪 [DEV MODE] Syncing with MOCK data...", "info");
    } else {
      showStatusMessage("Syncing Todoist data...", "info");
    }
  }

  try {
    let tasks: TodoistTask[];
    let completedTasks: TodoistBackupTask[];
    let projects: TodoistProject[];
    let labels: TodoistLabel[];

    if (useMockData) {
      // Use mock data for development
      logInfo("🧪 [DEV MODE] Using mock data instead of real Todoist API");
      tasks = generateMockTasks();
      completedTasks = generateMockCompletedTasks();
      projects = generateMockProjects();
      labels = generateMockLabels();
    } else {
      // Fetch real data from Todoist API
      [tasks, completedTasks, projects, labels] = await Promise.all([
        fetchPaginated<TodoistTask>("/tasks", settings.token!),
        fetchCompletedTasks(settings.token!),
        fetchPaginated<TodoistProject>("/projects", settings.token!),
        fetchPaginated<TodoistLabel>("/labels", settings.token!),
      ]);
    }

    const projectMap = buildNameMap(projects);
    const labelMap = buildLabelMap(labels);

    logDebug("fetch_completed", {
      tasks: tasks.length,
      completed: completedTasks.length,
      projects: projects.length,
      labels: labels.length,
    });

    const backupTasks: TodoistBackupTask[] = mergeBackupTasks(tasks, completedTasks);
    const filteredTasks = applyTitleExclusions(backupTasks, settings.excludePatterns);

    if (filteredTasks.length < backupTasks.length) {
      logInfo(`excluded ${backupTasks.length - filteredTasks.length} tasks by pattern`);
    }

    // Skip comments enrichment in mock mode
    const tasksForBlocks = (settings.includeComments && !useMockData && settings.token)
      ? await enrichTasksWithComments(filteredTasks, settings.token)
      : filteredTasks;

    logDebug("write_blocks_start", {
      page: settings.pageName,
      tasks: tasksForBlocks.length,
      includeComments: settings.includeComments,
      mockMode: useMockData,
    });

    await writeBlocks(settings.pageName, tasksForBlocks, projectMap, labelMap, settings.statusAliases);

    if (trigger === "manual") {
      const modeLabel = useMockData ? "🧪 [MOCK] " : "";
      showStatusMessage(`${modeLabel}Backup synced (${tasksForBlocks.length} tasks).`, "success");
    } else {
      logInfo("automatic sync completed");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("failed to sync", error);
    showStatusMessage(`Failed to sync with Todoist: ${message}`, "error");
  } finally {
    syncInProgress = false;
  }
}

async function enrichTasksWithComments(tasks: TodoistBackupTask[], token: string) {
  if (tasks.length === 0) {
    return tasks;
  }

  const commentsMap = await fetchTaskComments(
    tasks.map((task) => task.id),
    token
  );

  return tasks.map((task) => ({
    ...task,
    comments: commentsMap.get(String(task.id)) ?? [],
  }));
}

function applyTitleExclusions(tasks: TodoistBackupTask[], patterns: RegExp[] | undefined) {
  if (!patterns || patterns.length === 0) {
    return tasks;
  }

  return tasks.filter((task) => {
    const title = safeText(task.content);
    if (!title) {
      return true;
    }

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(title)) {
        return false;
      }
    }
    return true;
  });
}

function showStatusMessage(message: string, type: "info" | "warning" | "success" | "error") {
  const roamUI = (window as unknown as { roamAlphaAPI?: { ui?: { mainWindow?: { setStatusMessage?: (options: { message: string; type: string }) => void } } } }).roamAlphaAPI?.ui;
  const setStatus = roamUI?.mainWindow?.setStatusMessage;
  if (typeof setStatus === "function") {
    setStatus({ message, type });
  } else if (type === "error") {
    console.error(message);
  } else {
    console.info(message);
  }
}
