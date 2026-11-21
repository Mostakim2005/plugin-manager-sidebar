# Project Operating Instructions (`AGENTS.md`)
> **Notice:** This project inherits user persona, confirmation gates, visual standards, and documentation blueprints from the global master `AGENTS.md`. Do not duplicate those rules here.

## 1. Project Tech Stack & Environment
* **Runtime / Language:** Node.js 18+, TypeScript 5.8 (`strict` + `noUncheckedIndexedAccess`).
* **Framework / Host:** Obsidian plugin API, `minAppVersion` 1.1.0, desktop and mobile (`isDesktopOnly: false`).
* **Build Output:** `main.js` (CommonJS bundle) at the repository root, shipped with `manifest.json` and `styles.css`.
* **Package Manager / Bundler:** npm + esbuild (`esbuild.config.mjs`, entry `src/main.ts`).

## 2. Mandatory Verification & Build Commands
* **Type Check:** `npx tsc -noEmit -skipLibCheck`
* **Lint:** `npm run lint`
* **Build:** `npm run build`
* **Watch / Dev:** `npm run dev`

## 3. Repository Directory Structure & Conventions
* `src/` — modular TypeScript source; one responsibility per file:
  * `main.ts` — lifecycle, host adapters, all plugin actions, view refresh, group editor.
  * `views/plugin-manager-view.ts` — `PluginManagerView`: header controls, stats, sections, rows, row/context menus.
  * `modals/group-modal.ts` — `GroupModal` (name, search, category chips, checkbox selection, delete).
  * `modals/manifest-edit-modal.ts` — `ManifestEditModal` (local manifest edit vs official override).
  * `modals/confirm-modal.ts` — `ConfirmModal` for destructive actions.
  * `modals/app-update-modal.ts` — `AppUpdateModal` for Obsidian releases.
  * `settings-tab.ts` — `PluginManagerSettingTab`.
  * `utils/settings.ts` — `DEFAULT_SETTINGS`, `sanitizeSettings`, v7 migration rules.
  * `utils/workspace.ts` — `SidebarController`: leaf discovery, toggling, deduplication, and ribbon state sync.
  * `utils/format.ts` — constants, sorters, semver, id sanitization, error helpers.
  * `utils/obsidian-internals.ts` — optional types for `app.plugins`, `app.internalPlugins`, `app.setting`, `app.commands`.
  * `types.ts` — settings and inventory contracts.
* `docs/` — Core Markdown documentation suite (`PRODUCT.md`, `ARCHITECTURE.md`, `DECISIONS_AND_TRAPS.md`, `VISUAL_LOG.md`).
* `preview/` — On-demand interactive HTML/CSS/JS visual previews (e.g., `preview/visual-guide.html`), created only upon explicit request.
* `main.js` at the root is a generated build artifact; edit `src/` instead.

## 4. Critical Trap Pointers (1-Line Warnings Only)
* **TRAP 1:** Never disable or uninstall self; maintain locked toggle and mutation guards — see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Self-Disable-Kills-The-View]`.
* **TRAP 2:** Run bulk plugin mutations through `exclusive()` to prevent interleaved calls — see `docs/DECISIONS_AND_TRAPS.md` -> `[DECISION: One-Exclusive-Mutation-At-A-Time]`.
* **TRAP 3:** Never overwrite official or core `manifest.json`; store in overrides table — see `docs/DECISIONS_AND_TRAPS.md` -> `[DECISION: Local-Manifest-Versus-Non-Destructive-Override]`.
* **TRAP 4:** Serialize settings persistence through `saveChain` to prevent race conditions — see `docs/DECISIONS_AND_TRAPS.md` -> `[DECISION: Serialized-Settings-Writes]`.
* **TRAP 5:** Sanitize settings input to block prototype pollution (`__proto__`, `constructor`) — see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Override-Key-Sanitization]`.
* **TRAP 6:** Guard private host internals (`app.plugins`, `app.internalPlugins`) defensively — see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Host-Internals-Are-Optional]`.
