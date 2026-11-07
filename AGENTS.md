# Project Operating Instructions (`AGENTS.md`)
> **Notice:** This project inherits user persona, confirmation gates, and documentation blueprints from the global master `AGENTS.md`. Do not duplicate those rules here.

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
  * `utils/format.ts` — constants, sorters, semver, id sanitization, error helpers.
  * `utils/obsidian-internals.ts` — optional types for `app.plugins`, `app.internalPlugins`, `app.setting`, `app.commands`.
  * `types.ts` — settings and inventory contracts.
  * `async.ts` — `voidAsync` wrapper for async DOM listeners.
* `docs/` — `PRODUCT.md`, `ARCHITECTURE.md`, `DECISIONS_AND_TRAPS.md`, `VISUAL_GUIDE.html`.
* `runtime/` — frozen plug-and-play bundle (`main.js`, `manifest.json`, `styles.css`) kept as the emergency fallback. Never regenerate into this folder.
* `main.js` at the root is a generated build artifact; edit `src/` instead.

## 4. Repository-Specific Engineering Traps
* **TRAP 1:** `app.plugins`, `app.internalPlugins`, `app.setting`, and `app.commands` are private and optional. Every access must be guarded; missing internals must degrade, not throw.
* **TRAP 2:** `data.json` is version 7 and is the only persisted state (`pinned`, `groups`, `overrides`, filters, theme). Renaming a key without reading the old one silently resets it.
* **TRAP 3:** Official and core plugins must never have `manifest.json` rewritten. Only `isLocal && !isCore` uses the on-disk path; everything else stores an override.
* **TRAP 4:** The manager must never be able to disable or uninstall itself. Keep the locked switch, the omitted menu items, and the mutation guards.
* **TRAP 5:** Bulk mutations and updates must run through `exclusive()`. Parallel host calls interleave notices and leave half-applied groups.
* **TRAP 6:** `settings` writes are serialized through `saveChain`; do not replace it with a bare `void saveData(...)`.
* **TRAP 7:** Group editing must preserve ids that are not currently installed; replacement loses members permanently.
* **TRAP 8:** `window.require("electron")` is desktop-only and must sit inside a `try`; otherwise use `openWithDefaultApp` or `showInFolder`.
* **TRAP 9:** `.hotreload` writes treat the vault adapter as writable. Always catch and report; mobile and read-only vaults fail here.
* **TRAP 10:** `sanitizeSettings` must stay total (accepts `null`, arrays, wrong types) and must keep the `__proto__` / `constructor` / `prototype` key filter.
* **TRAP 11:** Pinned rows render only in the Pinned section; both view branches rely on the exclusion set to avoid duplicates.
* **TRAP 12:** The update list is `app.plugins.updates`, and installs go through `installPlugin`. Do not add a second registry or downloader.
