// Unified API v1 (current as of Feb 10, 2026)
// Old REST v2/v9 and Sync v9 were shut down on Feb 10, 2026
export const TODOIST_REST_API_BASE = "https://api.todoist.com/api/v1";
// Sync API was deprecated - using unified API for all operations
export const TODOIST_SYNC_API_BASE = "https://api.todoist.com/api/v1";
export const DEFAULT_PAGE_NAME = "todoist";
export const TODOIST_ID_PROPERTY = "todoist-id";
export const TODOIST_COMPLETED_PROPERTY = "todoist-completed";
export const TODOIST_STATUS_PROPERTY = "todoist-status";
export const TODOIST_DUE_PROPERTY = "todoist-due";
export const TODOIST_COMMENTS_PROPERTY = "todoist-comments";
export const TODOIST_COMMENT_ID_PROPERTY = "todoist-comment-id";
export const TODOIST_COMMENT_POSTED_PROPERTY = "todoist-comment-posted";
export const PLACEHOLDER_CONTENT = "No tasks found.";
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const DEFAULT_STATUS_ALIAS_ACTIVE = "◼️";
export const DEFAULT_STATUS_ALIAS_COMPLETED = "✅";
export const DEFAULT_STATUS_ALIAS_DELETED = "❌";
export const CONFIG_PAGE_TITLE = "roam/js/todoist-backup";
export const COMMAND_LABEL = "Todoist: Sync backup";
export const TOPBAR_BUTTON_ID = "roam-todoist-backup-button";
export const TOPBAR_ICON_NAME = "tick-circle";
