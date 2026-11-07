# Plugin Manager Sidebar

> [!NOTE]
> **Live Plug-and-Play Runtime Available:** The `runtime/` directory contains the production-tested JavaScript bundle (`main.js`, `manifest.json`, `styles.css`) that runs in the live Obsidian vault. Copy those three files into `<Vault>/.obsidian/plugins/plugin-manager-sidebar/` for immediate use. The TypeScript source in `src/` is a full behavioral port of that bundle.

A permanent sidebar for every installed and built-in plugin: search, enable, disable, pin, group, update, rename, reveal, and uninstall without digging through settings.

## Documentation

| File | What it answers |
| --- | --- |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | What the plugin must do, feature by feature, with code anchors. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Mermaid system map, settings shape, filter pipeline, host bridges, verification commands, extension recipes. |
| [`docs/DECISIONS_AND_TRAPS.md`](docs/DECISIONS_AND_TRAPS.md) | Why each non-obvious mechanism exists and what must never be changed. |
| [`docs/VISUAL_GUIDE.html`](docs/VISUAL_GUIDE.html) | Self-contained browser dashboard of intent, architecture, decisions and landmines. |
| [`AGENTS.md`](AGENTS.md) | Repository-specific build commands, layout and traps. |

## Source layout

- `src/types.ts` — `PluginManagerSettings`, `ManagedPlugin`, `PluginGroup`, `PluginUpdateInfo`
- `src/utils/settings.ts` — `DEFAULT_SETTINGS`, `sanitizeSettings` (v7 shape, enum and id validation, prototype-key guard)
- `src/utils/format.ts` — view type, registry URLs, sorters, `compareSemver`, `sanitizePluginId`, `errMsg`, `sleep`
- `src/utils/obsidian-internals.ts` — optional types for `app.plugins`, `app.internalPlugins`, `app.setting`, `app.commands`
- `src/views/plugin-manager-view.ts` — `PluginManagerView` (two-row controls, stats, updates, pinned, status/group sections, rows, menus)
- `src/modals/group-modal.ts` — `GroupModal` (name, search, category chips, checkbox list, delete)
- `src/modals/manifest-edit-modal.ts` — `ManifestEditModal` (local manifest edit vs official overlay)
- `src/modals/confirm-modal.ts` — `ConfirmModal`
- `src/modals/app-update-modal.ts` — `AppUpdateModal`
- `src/settings-tab.ts` — `PluginManagerSettingTab`
- `src/main.ts` — plugin entry, host adapters, toggles, groups, updates, uninstall, settings shortcuts
- `src/async.ts` — `voidAsync` for async DOM listeners

## Parity checklist

- [x] Entry, ribbon, command, settings tab, glassmorphism body class, unload cleanup
- [x] Community/core/all inventory from live manifests with enabled state
- [x] Scope / view / group structural row independent of filters
- [x] Debounced search over name, id, description, author
- [x] Source, state, pinned, updates filters plus sort and reset chip
- [x] Status sections (Enabled/Disabled) and group sections (plus Other Plugins)
- [x] Stats bar and updates section with version diffs
- [x] Verified enable/disable for community and core plugins with self-lock
- [x] Pin/unpin with dedicated Pinned section and no duplication
- [x] Group create/edit/delete, preserved missing members, bulk enable/disable with per-plugin error isolation
- [x] Update check, update single, update all via Obsidian's install API
- [x] Obsidian app update check with desktop release feed and GitHub fallback
- [x] Metadata editing: local manifest write, official/core overlay, reset defaults
- [x] `.hotreload` create/touch with cache and error reporting
- [x] Reveal in explorer with Electron and host fallbacks
- [x] Safe uninstall with confirmation and pin/group cleanup
- [x] Plugin settings shortcut and community browser (Restricted Mode aware)
- [x] Console logging for errors, notices for user-facing failures
- [x] Data compatibility: v7 `data.json` shape
- [x] `styles.css` — live styles copied verbatim

## Develop

```bash
npm install
npm run dev     # esbuild watch
npm run build   # tsc --noEmit + production bundle -> main.js
npm run lint
```

Manual install: copy `main.js`, `manifest.json`, `styles.css` to `<Vault>/.obsidian/plugins/plugin-manager-sidebar/`.

## License

Code: PolyForm Noncommercial 1.0.0 (see `LICENSE`). Docs: CC BY-NC 4.0. Copyright © Mostakim2005. Source-available: free non-commercial use with credit, no commercial use.
