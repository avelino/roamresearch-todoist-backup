## [2.0.1](https://github.com/avelino/roamresearch-todoist-backup/compare/v2.0.0...v2.0.1) (2025-12-13)


### Bug Fixes

* **constants:** change topbar icon from "folder-open" to "tick-circle" ([c00d099](https://github.com/avelino/roamresearch-todoist-backup/commit/c00d0998790fd0ebcbb89c6a15520fff1c3fad20))

# [2.0.0](https://github.com/avelino/roamresearch-todoist-backup/compare/v1.0.3...v2.0.0) (2025-12-06)

## [1.0.3](https://github.com/avelino/roamresearch-todoist-backup/compare/v1.0.2...v1.0.3) (2025-12-06)


### Bug Fixes

* convertInlineTodoistLabels supports email, label, and wiki link edge cases ([edf99b4](https://github.com/avelino/roamresearch-todoist-backup/commit/edf99b4fa740a196103bf647d89fb744da16920a))

## [1.0.2](https://github.com/avelino/roamresearch-todoist-backup/compare/v1.0.1...v1.0.2) (2025-11-28)


### Bug Fixes

* prevent sync from blocking typing in Roam by yielding to browser main thread during block creation ([5314769](https://github.com/avelino/roamresearch-todoist-backup/commit/5314769b12e37677f724e6a2de6d50edbcb0fadd))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

* **Person page links** - Todoist labels starting with `@` (e.g., `@Pato`) are now converted to Roam wiki links (e.g., `[[@Pato]]`) for linking to person pages; inline `@@name` in task titles also converts to wiki links
* **Hierarchical label links** - Todoist labels containing `/` (e.g., `buser/team/bx`) are now converted to Roam wiki links (e.g., `[[buser/team/bx]]`) preserving namespace hierarchy

### Fixed

* **Task title date always shows due date** - the date in the task title now always displays when the task was scheduled (due date), not when it was completed; the original due date is preserved from existing blocks even after Todoist clears it on completion; completed date is stored separately in `todoist-completed::` property for tracking
* **Sync blocking typing in Roam** - implemented cooperative scheduling with `yieldToMain()` that periodically yields control back to the browser during sync operations, allowing users to continue typing without interruption
* Rate limit exceeded error during sync with many tasks - increased mutation delay from 50ms to 100ms and added proper delays in recursive block creation
* Tasks dated "today" being recorded as yesterday due to timezone handling - ISO dates (YYYY-MM-DD) are now interpreted as local time instead of UTC

## [0.1.0] - 2025-11-27

### Added

* Initial release of Roam Todoist Backup extension
* Sync active and completed tasks from Todoist to Roam Research
* Dedicated page per task: `{pagePrefix}/{todoist-id}`
* Task properties stored as child blocks (id, due, status, labels, description)
* Optional comment sync with nested block structure
* Automatic sync scheduling with configurable interval
* Manual sync via command palette ("Todoist: Sync backup") and topbar button
* Title exclusion patterns (regex) to skip specific tasks
* Customizable status aliases (◼️ active, ✅ completed, ❌ deleted)
* Development mode with mock data when debug logs enabled
* Settings panel integration via Roam Depot
* Fallback config page (`roam/js/todoist-backup`) for legacy support
* Date formatting following Roam daily note pattern (`MMMM Do, YYYY`)
* Inline Todoist label conversion (`@label` → `#label`)
* Preserve completed tasks history during sync
* Respect Roam API rate limits (50ms mutation delay)

### Technical

* TypeScript with strict mode
* Vite bundler producing single `extension.js`
* ESLint with TypeScript support
* Modular architecture: `main.ts`, `todoist.ts`, `blocks.ts`, `settings.ts`, `scheduler.ts`, `ui.ts`, `logger.ts`, `constants.ts`
* Todoist REST API v2 and Sync API v9 integration
* Cursor-based pagination for REST endpoints
* Offset-based pagination for Sync API completed items

[Unreleased]: https://github.com/avelino/roamresearch-todoist-backup/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/avelino/roamresearch-todoist-backup/releases/tag/v0.1.0
