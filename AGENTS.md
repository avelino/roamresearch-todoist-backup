Roam Todoist Backup – Agent Guidelines
======================================

Project Snapshot

- Roam Research extension written in strict TypeScript, bundled with Vite (`npx pnpm build`).
- Main entry: `src/main.ts`; supporting modules: `todoist.ts`, `blocks.ts`, `settings.ts`, `scheduler.ts`, `ui.ts`, `logger.ts`, `constants.ts`.
- Exports `{ onload, onunload }` object for Roam Depot compatibility (ES module format).
- Interacts with the Roam runtime via direct `roamAlphaAPI` calls for UI, scheduling, and page mutations; communicates with Todoist REST API v2 and Sync API v9 via HTTPS.
- Configuration is managed via Roam Depot → Extension Settings → "Todoist Backup". Defaults are applied on first load; respect user edits and persist values using `extensionAPI.settings`. Falls back to config page `roam/js/todoist-backup` when settings panel is unavailable.
- Tasks are organized in pages dedicated per task: `{pagePrefix}/{todoist-id}`. Dates displayed follow the Roam daily note pattern (`MMMM Do, YYYY` – e.g., "January 1st, 2025").
- Task properties (id, due, status, labels, description) are stored as child blocks under the main task block for clean organization.

Environment & Tooling

- Package manager: pnpm (`npx pnpm ...`); lockfile `pnpm-lock.yaml`.
- Install deps before running scripts: `npx pnpm install`.
- Build command: `npx pnpm build` (runs `tsc` then `vite build` producing `dist/extension.js`).
- Lint command: `npx pnpm exec eslint ./src --ext .ts`.
- Check command: `npx pnpm check` (runs lint + build in sequence).
- Target Node version matches CI (`actions/setup-node@v3`) using Node 20.8+. Avoid APIs unavailable in that runtime.
- No runtime dependencies; all dev dependencies are for build/lint/release tooling.

Code Structure Rules

- Preserve module boundaries:
  - `todoist.ts`: Todoist DTOs, API helpers, text sanitization utilities, mock data generation.
  - `blocks.ts`: Block composition, page organization, `resolveTaskPageName`, `writeBlocks`, `cleanupObsoletePages`.
  - `settings.ts`: Roam API wrappers (`getBasicTreeByParentUid`, `createPage`, etc.), settings reading/initialization, panel registration.
  - `scheduler.ts`: `scheduleAutoSync`, `cancelScheduledSync` for automatic sync timing.
  - `logger.ts`: Logging helpers (`logInfo`, `logWarn`, `logDebug`, `logError`) with debug flag control.
  - `ui.ts`: UI wiring (command palette, topbar button).
  - `constants.ts`: Runtime constants (API URLs, property names, default values).
- UI wiring (command palette, top bar icons) must remain in `ui.ts`; avoid ad-hoc DOM manipulations elsewhere.
- Reuse logging helpers instead of raw `console.*`. For structured data use `logDebug(operation, data)`.
- Always prefer pure functions returning new data unless Roam APIs mandate mutation.
- Document public functions with concise JSDoc describing purpose and parameters.

Module Details

### main.ts

- Entry point for the extension with `onload` and `onunload` handlers.
- Manages extension lifecycle: settings initialization, command/button registration, auto-sync scheduling.
- Orchestrates sync flow: fetch tasks → filter by exclusion patterns → enrich with comments → write blocks.
- Development mode: when `enable_debug_logs` is true, uses mock data instead of real Todoist API calls.

### todoist.ts

- `fetchPaginated<T>`: Generic cursor-based pagination for REST API endpoints.
- `fetchCompletedTasks`: Offset-based pagination for Sync API completed items.
- `fetchTaskComments`: Retrieves comments per task with retry logic.
- `mergeBackupTasks`: Combines active and completed tasks into unified list.
- Text sanitization: `safeText`, `safeLinkText`, `formatLabelTag`, `convertInlineTodoistLabels`.
- Date formatting: `formatDue`, `formatDisplayDate` producing Roam-style dates (`MMMM Do, YYYY`).
- Mock generators: `generateMockTasks`, `generateMockCompletedTasks`, `generateMockProjects`, `generateMockLabels`.

### blocks.ts

- `resolveTaskPageName`: Returns `{pagePrefix}/{task.id}` as destination page.
- `writeBlocks`: Distributes tasks to their dedicated pages, creates/updates blocks with properties as children.
- `buildPropertyBlocks`: Generates child blocks for task metadata (id, due, status, labels, description).
- `buildCommentBlocks`: Creates wrapper block with nested comment blocks when comments are enabled.
- `cleanupObsoletePages`: Removes tasks from pages when no longer returned by Todoist (preserves completed tasks).
- `buildBlockMap`: Indexes existing blocks by `todoist-id` for efficient updates.

### settings.ts

- Roam API wrappers: `getBasicTreeByParentUid`, `getPageUidByPageTitle`, `createPage`, `createBlock`, `updateBlock`, `deleteBlock`.
- `initializeSettings`: Detects settings panel support; registers panel or creates config page.
- `readSettings`: Returns `SettingsSnapshot` from panel or page-based config.
- Settings keys: `todoist_token`, `page_prefix`, `sync_interval_minutes`, `include_comments`, `exclude_title_patterns`, `enable_debug_logs`, `status_alias_*`.
- `MUTATION_DELAY_MS`: 100ms throttle between Roam mutations (respects 1500/60s rate limit with safety margin).

### scheduler.ts

- `scheduleAutoSync`: Idempotent scheduling with `setTimeout`; cancels previous timer before creating new one.
- `cancelScheduledSync`: Clears pending timer on unload or settings change.

### ui.ts

- `registerCommand`: Adds "Todoist: Sync backup" to command palette via extensionAPI or legacy roamAlphaAPI.
- `registerTopbarButton`: Creates icon button in Roam topbar with `folder-open` icon.

### logger.ts

- `setDebugEnabled`: Toggles debug/info log visibility.
- `logInfo`, `logWarn`: Conditional logging when debug is enabled.
- `logError`: Always visible regardless of debug setting.
- `logDebug`: Structured logging with operation name and data object.

### constants.ts

- API URLs: `TODOIST_REST_API_BASE` (v2), `TODOIST_SYNC_API_BASE` (v9).
- Property names: `todoist-id`, `todoist-status`, `todoist-due`, `todoist-completed`, `todoist-comments`, etc.
- Default values: page name (`todoist`), status aliases (◼️, ✅, ❌).
- UI constants: command label, topbar button ID/icon.

TypeScript & Validation Expectations

- Project compiles with `strict` options; honor null safety and inference.
- Validate all external inputs aggressively:
  - Todoist responses: guard optional fields, normalize IDs to strings, validate dates against `ISO_DATE_PATTERN`, handle pagination (cursor for REST, offset for Sync) defensively.
  - Roam settings: trim strings, coerce numbers, clamp intervals (`>= 1 minute`); reuse `readSettings` to obtain sanitized snapshots.
- Sanitize user-provided text via existing helpers (`safeText`, `safeLinkText`, `formatLabelTag`, `convertInlineTodoistLabels`) before inserting into Roam blocks. `safeLinkText` preserves Roam wiki links / Markdown links; `convertInlineTodoistLabels` transforms Todoist `@label` into Roam hashtags while respecting email addresses and wiki links.
- Prefer `unknown` over `any` for new external payloads; narrow via type guards or validators.
- Handle async errors with try/catch; display actionable messages via `showStatusMessage` and log details with `logError`.

Quality Gates Before Submitting Changes

- Run `npx pnpm install` when dependencies change or in new environments.
- Run `npx pnpm exec eslint ./src --ext .ts`.
- Run `npx pnpm build` to ensure type-checking and bundling succeed.
- Manually test in Roam when behavior changes: manual sync, auto scheduling, block updates/deletions, comment rendering.

Development Conventions

- Avoid new global state beyond existing module-level flags (`syncInProgress`, timer handles). Prefer closures or module-scoped constants.
- Background syncs must not interrupt the user: do not steal focus or scroll position in Roam.
- Use template literals only when interpolation is required; keep strings ASCII.
- Keep network utilities reusable; new Todoist helpers belong in `todoist.ts` and should respect shared pagination behaviour.
- When updating blocks ensure `todoist-id::` remains the canonical identifier; preserve completed tasks (`todoist-status:: ✅`) even when Todoist stops returning them.
- Respect existing status aliases; defaults remain ◼️ (active), ✅ (completed), ❌ (deleted).
- `writeBlocks` must leave user-authored content untouched; only manipulate blocks created by the extension.
- Each task must remain exclusively on the page `{pagePrefix}/{todoist-id}`; if the item is removed from Todoist, the corresponding block must disappear from the page.

Block Structure

Tasks are written with the following structure:

```
[[Date]] Task title #ProjectName
  todoist-id:: [id](url)
  todoist-due:: Date
  todoist-desc:: Description (if present)
  todoist-labels:: #label1 #label2
  todoist-completed:: [[Date]] (if completed)
  todoist-status:: ◼️/✅/❌
  comments... (if include_comments enabled)
    todoist-comments:: count
    [todoist](comment-url) Comment text
      todoist-comment-id:: id
      todoist-comment-posted:: timestamp
```

Error Handling & Logging

- Use logging helpers; never log raw tokens or sensitive data.
- Debug/info logs obey the `enable_debug_logs` flag; errors always surface.
- Structured debug logs should follow `logDebug("operation_name", { key: value })`.
- Distinguish manual vs automatic sync context: surface warnings only for manual triggers, rely on info logs for background jobs.
- Protect against tight retry loops; scheduling must always reapply the configured interval.

Performance & Scheduling

- `scheduleAutoSync` must remain idempotent; cancel existing timers before scheduling new ones.
- Avoid blocking the UI thread; fetch Todoist resources in parallel (`Promise.all`) and keep DOM updates minimal.
- Work on cloned task arrays (`[...tasks]`) to avoid mutating caller-owned data.
- Avoid creating persistent placeholders; if `No tasks found.` blocks remain from previous versions, remove them during sync.
- Respect Roam mutation rate limit: use `MUTATION_DELAY_MS` (100ms) between API calls. Mutation functions (`createBlock`, `createPage`) include their own delays, so callers should not add extra delays after calling them.

Security & Privacy

- Never log or store raw Todoist tokens.
- Only send `Authorization: Bearer` headers when tokens are present; short-circuit otherwise.
- Sanitize errors before logging to avoid leaking sensitive payloads.

Development Mode

When `enable_debug_logs` is enabled, the extension operates in development mode:

- Uses mock data (`generateMock*` functions) instead of real Todoist API calls.
- Displays `🧪 [DEV MODE]` prefix in status messages.
- Useful for testing block structure and UI without affecting real Todoist data.

Settings Reference

| Setting | Key | Default | Description |
|---------|-----|---------|-------------|
| Todoist Token | `todoist_token` | (empty) | Personal API token from Todoist Settings → Integrations |
| Target Page Prefix | `page_prefix` | `todoist` | Prefix for task pages; tasks saved to `prefix/id` |
| Sync Interval | `sync_interval_minutes` | `5` | Minutes between auto-syncs (min: 1) |
| Download Comments | `include_comments` | `false` | Fetch and include task comments |
| Exclude Patterns | `exclude_title_patterns` | (empty) | Regex patterns to skip tasks by title |
| Enable Debug Logs | `enable_debug_logs` | `false` | Show debug logs; enables mock data mode |
| Status: Active | `status_alias_active` | ◼️ | Display value for active tasks |
| Status: Completed | `status_alias_completed` | ✅ | Display value for completed tasks |
| Status: Deleted | `status_alias_deleted` | ❌ | Display value for deleted tasks |

Review Checklist

- [ ] Code respects module boundaries and naming conventions.
- [ ] All new inputs validated, sanitized, and strongly typed.
- [ ] Lint and build commands succeed locally.
- [ ] No stray files committed; unused assets removed.
- [ ] Documentation (README, AGENTS.md, repo rules) updated for behavioural changes.
- [ ] CHANGELOG.md updated with new features, bug fixes, or breaking changes under `[Unreleased]` section.

CHANGELOG Guidelines

- Every pull request with user-facing changes **must** include a CHANGELOG.md entry.
- Add entries under the `[Unreleased]` section using appropriate subsections:
  - `### Added` – new features
  - `### Changed` – changes in existing functionality
  - `### Deprecated` – soon-to-be removed features
  - `### Removed` – removed features
  - `### Fixed` – bug fixes
  - `### Security` – vulnerability fixes
- Keep entries concise and user-focused (what changed, not how).
- Reference issue/PR numbers when applicable (e.g., `(#42)`).
- On release, maintainers move `[Unreleased]` entries to a versioned section.

Maintainers favor maintainability, readability, and defensive programming. When uncertain, add explicit validation, document assumptions, and err on the side of safety.
