import {
  ISO_DATE_PATTERN,
  TODOIST_REST_API_BASE,
  TODOIST_SYNC_API_BASE,
} from "./constants";
import { logError, logDebug } from "./logger";

export type TodoistId = string | number;

export type TodoistDue = {
  string?: string | null;
  date?: string | null;
  datetime?: string | null;
  timezone?: string | null;
};

export type TodoistTask = {
  id: TodoistId;
  content: string;
  description?: string | null;
  project_id?: TodoistId | null;
  labels?: Array<TodoistId | string>;
  label_ids?: Array<TodoistId>;
  due?: TodoistDue | null;
  url?: string;
};

export type TodoistComment = {
  id: TodoistId;
  task_id: TodoistId;
  content: string;
  posted_at: string | null;
};

type RawTodoistComment = {
  id?: TodoistId | null;
  task_id?: TodoistId | null;
  content?: string | null;
  posted_at?: string | null;
};

export type TodoistCompletedItem = {
  task_id?: TodoistId;
  content?: string;
  description?: string | null;
  project_id?: TodoistId | null;
  labels?: Array<TodoistId | string>;
  label_ids?: Array<TodoistId>;
  completed_at?: string | null;
  completed_date?: string | null;
  task?: Partial<TodoistTask> & { id?: TodoistId };
};

export type TodoistBackupTask = TodoistTask & {
  completed?: boolean;
  completed_at?: string | null;
  completed_date?: string | null;
  status?: "active" | "completed" | "deleted";
  fallbackDue?: string;
  comments?: TodoistComment[];
};

export type TodoistProject = {
  id: TodoistId;
  name: string;
};

export type TodoistLabel = {
  id: TodoistId;
  name: string;
};

export type PaginatedResponse<T> = {
  data?: T[];
  items?: T[];
  tasks?: T[];
  projects?: T[];
  labels?: T[];
  results?: T[];
  next_cursor?: string | null;
};

export type FetchPaginatedOptions = {
  baseUrl?: string;
  searchParams?: Record<string, string | undefined>;
  method?: "GET" | "POST";
  body?: unknown;
};

export type FetchCommentsOptions = {
  retryLimit?: number;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function getOrdinalSuffix(day: number): string {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) {
    return "th";
  }
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function formatHumanDate(date: Date): string {
  const month = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}${getOrdinalSuffix(day)}, ${year}`;
}

/**
 * Safely parses a date string to a Date object, handling ISO date-only strings as local time.
 * Returns null for invalid or missing values.
 *
 * @param value Date string to parse.
 */
export function safeParseDateToLocal(value: string | null | undefined): Date | null {
  if (!value) return null;

  // For ISO date-only strings (YYYY-MM-DD), append T00:00:00 to interpret as local time
  // Without this, JavaScript interprets as UTC which shifts the date in non-UTC timezones
  const dateValue = ISO_DATE_PATTERN.test(value) ? `${value}T00:00:00` : value;
  const parsed = new Date(dateValue);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDisplayDate(value: string | null | undefined): string {
  const date = safeParseDateToLocal(value);
  return date ? formatHumanDate(date) : "";
}

/**
 * Fetches paginated resources from Todoist REST endpoints.
 *
 * @param path API path to fetch.
 * @param token Todoist API token.
 * @param options Additional fetch options such as base url and parameters.
 */
export async function fetchPaginated<T>(
  path: string,
  token: string,
  options: FetchPaginatedOptions = {}
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  const {
    baseUrl = TODOIST_REST_API_BASE,
    searchParams = {},
    method = "GET",
  } = options;

  do {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status} while fetching ${path}`);
    }

    const body = (await response.json()) as PaginatedResponse<T> | T[];
    const pageItems = extractItems(body);
    items.push(...pageItems);
    cursor = getCursor(body);

    logDebug("fetch_paginated_batch", {
      endpoint: path,
      batchSize: pageItems.length,
      total: items.length,
      hasMore: Boolean(cursor),
    });
  } while (cursor);

  return items;
}

/**
 * Fetches and sanitizes comments for the specified Todoist tasks.
 *
 * @param taskIds Identifiers of tasks whose comments will be requested.
 * @param token Todoist API token.
 * @param options Optional retry configuration for transient failures.
 */
export async function fetchTaskComments(
  taskIds: TodoistId[],
  token: string,
  options: FetchCommentsOptions = {}
): Promise<Map<string, TodoistComment[]>> {
  const map = new Map<string, TodoistComment[]>();
  if (taskIds.length === 0) {
    return map;
  }

  const retryLimit = Math.max(0, options.retryLimit ?? 1);
  const idsToFetch = taskIds
    .map((id) => String(id))
    .filter((value, index, self) => self.indexOf(value) === index);
  const queue = [...idsToFetch];
  const attempts = new Map<string, number>();

  logDebug("fetch_comments_start", { taskCount: idsToFetch.length });

  while (queue.length > 0) {
    const taskId = queue.shift();
    if (!taskId) {
      continue;
    }

    try {
      const comments = await fetchPaginated<TodoistComment>("/comments", token, {
        searchParams: {
          task_id: taskId,
        },
        baseUrl: TODOIST_REST_API_BASE,
      });

      const sanitized = comments
        .map((comment) => sanitizeComment(comment, taskId))
        .filter((comment): comment is TodoistComment => Boolean(comment));

      map.set(taskId, sanitized);
    } catch (error) {
      const currentAttempts = attempts.get(taskId) ?? 0;
      const nextAttempts = currentAttempts + 1;
      attempts.set(taskId, nextAttempts);
      if (nextAttempts <= retryLimit) {
        queue.push(taskId);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        logError("failed to fetch comments for task", { taskId, error: message });
      }
    }
  }

  logDebug("fetch_comments_completed", {
    tasksWithComments: map.size,
    totalComments: Array.from(map.values()).reduce((sum, comments) => sum + comments.length, 0),
  });

  return map;
}

/**
 * Extracts data arrays from various Todoist pagination formats.
 */
export function extractItems<T>(body: PaginatedResponse<T> | T[]): T[] {
  if (Array.isArray(body)) {
    return body;
  }

  const candidates: Array<T[] | undefined> = [
    body.data,
    body.items,
    body.tasks,
    body.projects,
    body.labels,
    body.results,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

/**
 * Validates and normalizes a raw comment payload from Todoist.
 */
function sanitizeComment(comment: RawTodoistComment, fallbackTaskId: string): TodoistComment | undefined {
  if (!comment) {
    return undefined;
  }
  const id = comment.id;
  if (id === null || id === undefined) {
    return undefined;
  }
  const taskId = comment.task_id ?? fallbackTaskId;
  if (taskId === null || taskId === undefined) {
    return undefined;
  }
  const content = safeText(comment.content ?? "");
  return {
    id,
    task_id: taskId,
    content,
    posted_at: comment.posted_at ?? null,
  };
}

/**
 * Reads the pagination cursor from Todoist responses when present.
 */
export function getCursor<T>(body: PaginatedResponse<T> | T[]): string | undefined {
  if (Array.isArray(body)) {
    return undefined;
  }

  const value = body.next_cursor;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Builds a map of Todoist ids to names for projects and similar collections.
 */
export function buildNameMap(collection: Array<{ id: TodoistId; name: string }>) {
  const map = new Map<string, string>();
  for (const item of collection) {
    map.set(String(item.id), item.name);
  }
  return map;
}

/**
 * Combines label ids and names into a lookup map for quick resolution.
 */
export function buildLabelMap(labels: TodoistLabel[]) {
  const map = new Map<string, string>();
  for (const label of labels) {
    const name = label.name;
    map.set(String(label.id), name);
    map.set(name, name);
  }
  return map;
}

/**
 * Converts a completed task payload into the shared backup task shape.
 */
export function normalizeCompletedTask(item: TodoistCompletedItem): TodoistBackupTask | undefined {
  const source = item.task ?? {};
  const id = source.id ?? item.task_id;
  if (id === undefined || id === null) {
    return undefined;
  }

  const url = source.url ?? (id ? `https://todoist.com/showTask?id=${id}` : undefined);

  return {
    id,
    content: source.content ?? item.content ?? "",
    description: source.description ?? item.description ?? null,
    project_id: source.project_id ?? item.project_id ?? null,
    labels: source.labels ?? item.labels,
    label_ids: source.label_ids ?? item.label_ids,
    due: source.due ?? null,
    url,
    completed: true,
    completed_at: item.completed_at ?? null,
    completed_date: item.completed_date ?? null,
  };
}

/**
 * Retrieves completed Todoist tasks using the sync API with offset pagination.
 *
 * @param token Todoist API token.
 */
export async function fetchCompletedTasks(token: string): Promise<TodoistBackupTask[]> {
  const allItems: TodoistCompletedItem[] = [];
  const limit = 200;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`${TODOIST_SYNC_API_BASE}/completed/get_all`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status} while fetching completed tasks`);
    }

    const body = (await response.json()) as { items?: TodoistCompletedItem[] };
    const items = body.items ?? [];

    logDebug("fetch_completed_batch", {
      batchSize: items.length,
      offset,
      total: allItems.length + items.length,
    });

    allItems.push(...items);

    if (items.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
  }

  return allItems
    .map((item) => normalizeCompletedTask(item))
    .filter((task): task is TodoistBackupTask => Boolean(task));
}

/**
 * Merges active and completed Todoist tasks into a unified task list.
 */
export function mergeBackupTasks(
  active: TodoistTask[],
  completed: TodoistBackupTask[]
): TodoistBackupTask[] {
  const map = new Map<string, TodoistBackupTask>();

  for (const task of completed) {
    const key = String(task.id);
    map.set(key, {
      ...task,
      status: "completed",
      fallbackDue: formatDue(task.due) || undefined,
    });
  }

  for (const task of active) {
    const key = String(task.id);
    map.set(key, {
      ...task,
      completed: false,
      completed_at: null,
      completed_date: null,
      status: "active",
      fallbackDue: formatDue(task.due) || undefined,
    });
  }

  return [...map.values()];
}

/**
 * Converts due information into a numeric timestamp for sorting.
 */
export function dueTimestamp(due?: TodoistDue | null) {
  if (!due) return Number.POSITIVE_INFINITY;
  const { datetime, date } = due;
  if (datetime) {
    const value = Date.parse(datetime);
    if (Number.isFinite(value)) return value;
  }
  if (date) {
    const value = Date.parse(date);
    if (Number.isFinite(value)) return value;
    const assumed = Date.parse(`${date}T00:00:00Z`);
    if (Number.isFinite(assumed)) return assumed;
  }
  if (due.string) {
    const value = Date.parse(due.string);
    if (Number.isFinite(value)) return value;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Formats Todoist due information into human-readable Roam date format.
 */
export function formatDue(due?: TodoistDue | null) {
  if (!due) return "";

  // Try datetime first (most precise)
  if (due.datetime) {
    const parsed = safeParseDateToLocal(due.datetime);
    if (parsed) return formatHumanDate(parsed);
  }

  // Try date
  if (due.date) {
    const parsed = safeParseDateToLocal(due.date);
    if (parsed) return formatHumanDate(parsed);
  }

  // Try string fallback
  if (due.string) {
    return formatDisplayDate(due.string);
  }

  return "";
}

/**
 * Trims whitespace and normalizes line breaks in free-text inputs.
 */
export function safeText(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").replace(/[\r\n]+/g, " ").trim();
}

/**
 * Returns the matching closing parenthesis for a Markdown link destination.
 *
 * Supports nested parentheses and escaped characters.
 *
 * @param text Full text containing a parenthesis-delimited segment.
 * @param openIndex Index of the opening "(" character.
 */
function findMatchingParen(text: string, openIndex: number): number {
  if (text[openIndex] !== "(") return -1;

  let depth = 0;

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

/**
 * Moves bold markers outside of Roam and Markdown links.
 *
 * Roam does not reliably parse `**` when it appears inside link labels.
 * Normalize:
 * - `[**Label**](url)` -> `**[Label](url)**`
 * - `[[**Page**]]` -> `**[[Page]]**`
 *
 * If the link is already wrapped with outer bold markers (e.g. `**[**Label**](url)**`),
 * this function strips the inner bold markers and preserves the outer ones.
 *
 * @param value Sanitized text potentially containing links.
 */
function normalizeBoldInsideLinks(value: string): string {
  if (!value || !value.includes("**")) {
    return value;
  }

  let result = "";
  let index = 0;

  while (index < value.length) {
    // Roam page links: [[...]]
    if (value.startsWith("[[", index)) {
      const end = value.indexOf("]]", index + 2);
      if (end === -1) {
        result += value.slice(index);
        break;
      }

      const label = value.slice(index + 2, end);
      if (label.startsWith("**") && label.endsWith("**") && label.length >= 4) {
        const inner = label.slice(2, -2).trim();
        if (inner) {
          const hasOuterBold =
            index >= 2 &&
            value.slice(index - 2, index) === "**" &&
            end + 4 <= value.length &&
            value.slice(end + 2, end + 4) === "**";

          result += hasOuterBold ? `[[${inner}]]` : `**[[${inner}]]**`;
          index = end + 2;
          continue;
        }
      }

      result += value.slice(index, end + 2);
      index = end + 2;
      continue;
    }

    // Markdown links: [label](destination)
    if (value[index] === "[" && value[index + 1] !== "[") {
      const closingBracket = value.indexOf("]", index + 1);
      if (closingBracket === -1) {
        result += value.slice(index);
        break;
      }

      let afterBracket = closingBracket + 1;
      while (afterBracket < value.length && /\s/.test(value[afterBracket] ?? "")) {
        afterBracket += 1;
      }

      if (value[afterBracket] !== "(") {
        result += value.slice(index, closingBracket + 1);
        index = closingBracket + 1;
        continue;
      }

      const closingParen = findMatchingParen(value, afterBracket);
      if (closingParen === -1) {
        result += value.slice(index, closingBracket + 1);
        index = closingBracket + 1;
        continue;
      }

      const label = value.slice(index + 1, closingBracket);
      if (!(label.startsWith("**") && label.endsWith("**") && label.length >= 4)) {
        result += value.slice(index, closingParen + 1);
        index = closingParen + 1;
        continue;
      }

      const inner = label.slice(2, -2).trim();
      if (!inner) {
        result += value.slice(index, closingParen + 1);
        index = closingParen + 1;
        continue;
      }

      const linkTail = value.slice(closingBracket + 1, closingParen + 1);
      const hasOuterBold =
        index >= 2 &&
        value.slice(index - 2, index) === "**" &&
        closingParen + 3 <= value.length &&
        value.slice(closingParen + 1, closingParen + 3) === "**";

      const normalizedLink = `[${inner}]${linkTail}`;
      result += hasOuterBold ? normalizedLink : `**${normalizedLink}**`;
      index = closingParen + 1;
      continue;
    }

    result += value[index];
    index += 1;
  }

  return result;
}

/**
 * Sanitizes text while preserving balanced Roam and Markdown link syntax.
 */
export function safeLinkText(value: string | null | undefined) {
  const sanitized = safeText(value);
  if (!sanitized) return "";

  const pieces: string[] = [];
  let index = 0;

  while (index < sanitized.length) {
    const char = sanitized[index];

    if (char === "[") {
      if (sanitized[index + 1] === "[") {
        const closing = sanitized.indexOf("]]", index + 2);
        if (closing !== -1) {
          pieces.push(sanitized.slice(index, closing + 2));
          index = closing + 2;
          continue;
        }
      }

      const closing = sanitized.indexOf("]", index + 1);
      if (closing !== -1) {
        pieces.push(sanitized.slice(index, closing + 1));
        index = closing + 1;
        continue;
      }

      pieces.push(" ");
      index += 1;
      continue;
    }

    if (char === "]") {
      pieces.push(" ");
      index += 1;
      continue;
    }

    pieces.push(char);
    index += 1;
  }

  const normalized = safeText(pieces.join(""));
  return normalizeBoldInsideLinks(normalized);
}

/**
 * Normalizes label names into Roam-friendly tags.
 * - Labels starting with @ become wiki links for person pages (e.g., @Pato -> [[@Pato]]).
 * - Labels containing / become wiki links preserving hierarchy (e.g., buser/team/bx -> [[buser/team/bx]]).
 * - Regular labels become hashtags (e.g., work -> #work).
 */
export function formatLabelTag(label: string) {
  // Labels starting with @ become wiki links (person page references)
  if (label.startsWith("@")) {
    const name = label.slice(1).trim();
    if (!name) return "";
    return `[[@${name}]]`;
  }

  // Labels containing / become wiki links (hierarchical namespaces)
  if (label.includes("/")) {
    const trimmed = label.trim();
    if (!trimmed) return "";
    return `[[${trimmed}]]`;
  }

  const sanitized = label.replace(/[^\w\s-]/g, " ").trim();
  if (!sanitized) return "";
  const dashed = sanitized.replace(/\s+/g, "-");
  return dashed.startsWith("#") ? dashed : `#${dashed}`;
}

/**
 * Converts Todoist inline labels to Roam format.
 * - @@name becomes [[@name]] (person page links)
 * - @label becomes #label (hashtags)
 * Preserves email addresses and other @ mentions that are not labels.
 * Skips conversion inside Roam page links ([[...]]).
 *
 * @param text Text containing potential Todoist inline labels.
 */
export function convertInlineTodoistLabels(text: string): string {
  if (!text) return "";

  const normalizeLabel = (raw: string) => safeText(raw);

  const isDomainLike = (value: string) => /\./.test(value);

  const formatInlineLabel = (label: string) => {
    const normalized = normalizeLabel(label);
    if (!normalized) return "";
    // Skip domain-like mentions (e.g., @example.com) to avoid mangling emails
    if (isDomainLike(normalized) && !normalized.includes("/")) {
      return `@${label}`;
    }
    // Person-style labels (Todoist @@) remain wiki links with leading @ preserved
    if (label.startsWith("@")) {
      const name = normalizeLabel(label.slice(1));
      return name ? `[[@${name}]]` : "";
    }
    // Hierarchical or spaced labels become wiki links to keep the full name intact
    if (normalized.includes("/") || normalized.includes(" ")) {
      return `[[${normalized}]]`;
    }
    // Default: convert to hashtag
    return `#${normalized}`;
  };

  const convertSegment = (segment: string) =>
    segment
      // First convert @@name (person page links)
      .replace(
        /(?<![a-zA-Z0-9[])@@([^\s@]+(?:\s+[^\s@]+)*)/g,
        (_match, label) => formatInlineLabel(`@${label}`)
      )
      // Then convert @label (regular labels and hierarchies)
      .replace(
        /(?<![a-zA-Z0-9[])@([^\s@]+(?:\s+[^\s@]+)*)/g,
        (_match, label) => formatInlineLabel(label)
      );

  let result = "";
  let index = 0;

  while (index < text.length) {
    const linkStart = text.indexOf("[[", index);
    if (linkStart === -1) {
      result += convertSegment(text.slice(index));
      break;
    }

    if (linkStart > index) {
      result += convertSegment(text.slice(index, linkStart));
    }

    const linkEnd = text.indexOf("]]", linkStart + 2);
    if (linkEnd === -1) {
      result += convertSegment(text.slice(linkStart));
      break;
    }

    result += text.slice(linkStart, linkEnd + 2);
    index = linkEnd + 2;
  }

  return result;
}

// ============================================================================
// MOCK DATA FOR DEVELOPMENT (when debug logs are enabled)
// ============================================================================

/**
 * Generates mock Todoist tasks for development/testing.
 * Returns 3 tasks with today's date to avoid breaking the real Roam graph.
 */
export function generateMockTasks(): TodoistTask[] {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  return [
    {
      id: "mock-001",
      content: "[MOCK] Task 1 - Review documentation",
      description: "This is a mock task for testing purposes",
      project_id: "mock-project-1",
      labels: ["mock-label", "testing"],
      due: { date: today, string: "today" },
      url: "https://todoist.com/showTask?id=mock-001",
    },
    {
      id: "mock-002",
      content: "[MOCK] Task 2 - Write unit tests @testing",
      description: "Another mock task with inline label",
      project_id: "mock-project-1",
      labels: ["development"],
      due: { date: today, string: "today" },
      url: "https://todoist.com/showTask?id=mock-002",
    },
    {
      id: "mock-003",
      content: "[MOCK] Task 3 - Deploy to production",
      description: null,
      project_id: "mock-project-2",
      labels: [],
      due: { date: today, string: "today" },
      url: "https://todoist.com/showTask?id=mock-003",
    },
  ];
}

/**
 * Generates mock completed tasks for development/testing.
 */
export function generateMockCompletedTasks(): TodoistBackupTask[] {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  return [
    {
      id: "mock-completed-001",
      content: "[MOCK] Completed task - Setup project",
      description: "This task was completed yesterday",
      project_id: "mock-project-1",
      labels: ["setup"],
      due: { date: yesterday, string: "yesterday" },
      url: "https://todoist.com/showTask?id=mock-completed-001",
      completed: true,
      completed_at: new Date(Date.now() - 86400000).toISOString(),
      completed_date: yesterday,
      status: "completed",
    },
  ];
}

/**
 * Generates mock projects for development/testing.
 */
export function generateMockProjects(): TodoistProject[] {
  return [
    { id: "mock-project-1", name: "MockProject" },
    { id: "mock-project-2", name: "MockDeploy" },
  ];
}

/**
 * Generates mock labels for development/testing.
 */
export function generateMockLabels(): TodoistLabel[] {
  return [
    { id: "mock-label", name: "mock-label" },
    { id: "testing", name: "testing" },
    { id: "development", name: "development" },
    { id: "setup", name: "setup" },
  ];
}
