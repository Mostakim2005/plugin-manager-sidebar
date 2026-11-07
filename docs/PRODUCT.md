# Product Intent & Feature Map (`PRODUCT.md`)
> **1-Line Summary:** The permanent source of truth for what Plugin Manager Sidebar does for the user, independent of how the code is implemented.

## 1. Core Vision & User Experience Intent
* **What This App Does (Plain English):** Replaces a trip through Obsidian's settings with a permanent sidebar that lists every installed and built-in plugin, lets the user switch them on or off in place, pin the important ones, group them by task, see available updates, and rename or re-describe them without editing files.
* **How It Must Feel to Use:** The list appears instantly and never blocks while a toggle is running. Destructive actions always confirm first, failures are contained to a notice plus a console line, and no action can disable or uninstall the manager itself. Every layout and filter choice survives a restart.

## 2. Active Features (Do Not Break)

### [FEATURE: Dual-Scope-Plugin-Inventory] | Aliases: community, core, all, scope chip, installed plugins
> **1-Line Summary:** Lists community plugins, built-in core plugins, or both, from Obsidian's own manifests rather than a cached copy.
* **User Intention (Non-Negotiable):** A plugin enabled or installed elsewhere must appear correctly on the next render, with its real name, version, author, description, and enabled state.
* **Visual / UI Behavior:** A single scope chip cycles Community → Core → All, saved to settings. Core rows show a "Core" badge and no version.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `listPlugins`, `getCorePluginMeta`, `get pm`
  * `src/views/plugin-manager-view.ts` -> `buildList`

### [FEATURE: Status-And-Group-Views] | Aliases: view toggle, groups, ungrouped, group selector
> **1-Line Summary:** The list renders either as Enabled/Disabled sections or as user-defined groups with a group selector and an "Other Plugins" bucket.
* **User Intention (Non-Negotiable):** Grouping is a view, never a mutation: changing views must not enable, disable, or reorder plugins.
* **Visual / UI Behavior:** "View: Status / Groups" chip; in group mode a dropdown lists All Groups, each group, and Ungrouped. Each group section has Enable All, Disable All, and Edit.
* **Code Anchors (Grep Targets):**
  * `src/views/plugin-manager-view.ts` -> `render`, `buildList`, `addSection`
  * `src/main.ts` -> `openGroupEditor`, `bulkGroup`

### [FEATURE: Search-And-Layered-Filters] | Aliases: search box, source filter, state filter, pinned filter, updates filter, reset
> **1-Line Summary:** A debounced search over name, id, description, and author combines with source, state, pinned, and updates filters.
* **User Intention (Non-Negotiable):** The structural controls (scope, view, group) must stay usable regardless of active filters, and Reset must clear every criterion in one click.
* **Visual / UI Behavior:** Row 1 holds scope/view/group; row 2 holds source, state, pinned, sort, updates, and a ✕ Reset chip that only appears when something is filtered.
* **Code Anchors (Grep Targets):**
  * `src/views/plugin-manager-view.ts` -> `render`, `buildList`
  * `src/utils/settings.ts` -> `sanitizeSettings`

### [FEATURE: In-Place-Enable-Disable] | Aliases: toggle switch, enable plugin, disable plugin, core toggle
> **1-Line Summary:** Each row has a switch that enables or disables that plugin through Obsidian's plugin manager, or through the core plugin registry for built-ins.
* **User Intention (Non-Negotiable):** The operation must be verified after it runs, the UI must not freeze, and the manager can never disable itself.
* **Visual / UI Behavior:** Switch with `role="switch"` and `aria-checked`; the manager's own row is locked and says so. A notice confirms every completed toggle.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `togglePlugin`, `applyEnabled`, `toggleCorePlugin`, `exclusive`
  * `src/views/plugin-manager-view.ts` -> `addRow`

### [FEATURE: Pinning] | Aliases: pin, pinned section, unpin
> **1-Line Summary:** Pinned plugins get their own section above the normal list and a filled pin button.
* **User Intention (Non-Negotiable):** A pinned plugin must not be duplicated in the sections below, and pins must persist by id across restarts.
* **Visual / UI Behavior:** "Pinned" section with the same rows; pin icon highlighted; Pinned filter chip narrows the list to pinned plugins only.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `togglePin`
  * `src/views/plugin-manager-view.ts` -> `buildList`

### [FEATURE: Group-Lifecycle] | Aliases: create group, edit group, delete group, assign plugins, bulk toggle
> **1-Line Summary:** Groups bundle plugin ids under a name and can bulk-enable or bulk-disable their members.
* **User Intention (Non-Negotiable):** Deleting a group only removes the classification. Bulk actions must skip the manager itself, tolerate per-plugin failures, and report how many changed.
* **Visual / UI Behavior:** Group dialog with name field, search, category chips (All/Community/Core/Official/Local), checkbox list, live "N plugins selected" counter, and Delete for existing groups. Bulk actions show a notice with the count.
* **Code Anchors (Grep Targets):**
  * `src/modals/group-modal.ts` -> `GroupModal.onOpen`
  * `src/main.ts` -> `bulkGroup`, `openGroupEditor`

### [FEATURE: Plugin-Update-Monitoring] | Aliases: updates available, update all, update single, update count
> **1-Line Summary:** Reads Obsidian's own update table and turns it into an Updates section, a badge count, and one-click update actions.
* **User Intention (Non-Negotiable):** The plugin must not invent its own update source or install flow; it delegates to the host and only reports results.
* **Visual / UI Behavior:** Download-cloud icon in the header (highlighted when updates exist), Updates chip with a count badge, an "Updates Available" section with version diff and Update buttons, and Update All.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `getAvailableUpdates`, `getAvailableUpdatesCount`, `updateSinglePlugin`, `updateAllPlugins`, `checkOfficialUpdates`

### [FEATURE: Obsidian-App-Update-Check] | Aliases: desktop release, app version, download prompt
> **1-Line Summary:** Compares the running Obsidian version with the latest desktop release and offers a download link when outdated.
* **User Intention (Non-Negotiable):** A failed network check must produce a clear notice, never a broken dialog, and the check must not install anything.
* **Visual / UI Behavior:** "Obsidian Software Update Available" modal with current/latest badges and Later / Download Update buttons; an up-to-date notice otherwise.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `checkObsidianSoftwareUpdate`, `getObsidianVersion`
  * `src/modals/app-update-modal.ts` -> `AppUpdateModal`

### [FEATURE: Manifest-Editing-By-Source] | Aliases: display name, author, description, official overlay, local manifest
> **1-Line Summary:** Local plugins are edited directly in `manifest.json`; official and core plugins get a non-destructive override stored in `data.json`.
* **User Intention (Non-Negotiable):** Official plugin files must never be rewritten behind Obsidian's back, and a reset must restore the original values without reinstalling.
* **Visual / UI Behavior:** Edit dialog states which mode is active, prefilled name/author/description fields, "Reset defaults" for overridden official plugins, and a save result notice.
* **Code Anchors (Grep Targets):**
  * `src/modals/manifest-edit-modal.ts` -> `ManifestEditModal.onOpen`
  * `src/main.ts` -> `saveLocalManifest`
  * `src/utils/settings.ts` -> `overrideList`

### [FEATURE: Hot-Reload-Toggle] | Aliases: .hotreload, touch file, hot restart, flame icon
> **1-Line Summary:** Local plugins can get a `.hotreload` marker created or touched to trigger Obsidian's hot-reload tooling.
* **User Intention (Non-Negotiable):** This is a local-development convenience only; it must not appear for official or core plugins and must sanitize the plugin id before touching the filesystem.
* **Visual / UI Behavior:** Flame button on local rows, highlighted when the marker already exists; a notice reports "Added" versus "Touched".
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `scanHotReloadFiles`, `hasHotReloadFile`, `toggleHotReload`

### [FEATURE: Reveal-In-Explorer] | Aliases: open folder, show in folder, system explorer
> **1-Line Summary:** Opens the plugin's folder in the system file browser, using Electron when available and Obsidian's own helpers otherwise.
* **User Intention (Non-Negotiable):** A platform without explorer support must say so instead of silently doing nothing.
* **Visual / UI Behavior:** Folder icon on local rows and in the context menu; falls back to a notice when no host API exists.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `revealInExplorer`

### [FEATURE: Safe-Uninstall] | Aliases: delete plugin, confirm dialog, group cleanup
> **1-Line Summary:** Uninstalling asks for confirmation, deletes the plugin folder, and removes the plugin from pins and groups.
* **User Intention (Non-Negotiable):** Core plugins and the manager itself can never be uninstalled, and stale ids must not linger in settings.
* **Visual / UI Behavior:** Trash item in the context menu, then a warning modal naming the plugin; a notice confirms the folder deletion.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `uninstallPlugin`
  * `src/modals/confirm-modal.ts` -> `ConfirmModal`

### [FEATURE: Settings-And-Community-Shortcuts] | Aliases: plugin settings, gear icon, browse community, restricted mode
> **1-Line Summary:** Each row links to its plugin's settings tab, and the header opens Obsidian's community plugin browser.
* **User Intention (Non-Negotiable):** A plugin with no settings tab or a disabled plugin must get a clear notice instead of a blank settings pane.
* **Visual / UI Behavior:** Gear button per row; compass button in the header; in Restricted Mode the browser action explains the problem and opens the right settings tab.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `openPluginSettings`, `openCommunityBrowser`, `communityEnabled`

### [FEATURE: Persisted-View-State] | Aliases: data.json, glassmorphism, auto update check, remember filters
> **1-Line Summary:** Scope, view, group selection, sort, filters, pins, groups, overrides, and theme preference all persist across restarts.
* **User Intention (Non-Negotiable):** Existing settings must be sanitized on load, never trusted blindly, and every save must be ordered so rapid clicks cannot interleave writes.
* **Visual / UI Behavior:** Glassmorphism body class toggled from settings; the view reopens with the last scope/filter combination.
* **Code Anchors (Grep Targets):**
  * `src/utils/settings.ts` -> `sanitizeSettings`, `DEFAULT_SETTINGS`
  * `src/main.ts` -> `saveSettings`, `applyThemePreferences`
  * `src/settings-tab.ts` -> `PluginManagerSettingTab.display`

### [FEATURE: Error-Containment] | Aliases: safe wrapper, console logging, busy guard
> **1-Line Summary:** Every action runs through `safe()` and long operations through `exclusive()`, so one failure becomes a notice instead of a broken sidebar.
* **User Intention (Non-Negotiable):** A throwing host API must not leave the list unrendered, and a second bulk action must not overlap the first.
* **Visual / UI Behavior:** "Action failed. See console." notice for unexpected failures; "Plugin Manager is busy…" notice when an operation is already running.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `safe`, `exclusive`
  * `src/views/plugin-manager-view.ts` -> `renderList`, `iconButton`

## 3. Explicit Non-Goals
* No custom plugin installer, registry mirror, or download cache.
* No editing of official plugin source or manifests.
* No command or hotkey management; that stays in Obsidian's own settings.
