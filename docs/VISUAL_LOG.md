# Visual Feature & Change Log (`VISUAL_LOG.md`)
> **1-Line Summary:** Plain-English, color-coded Obsidian-compatible Mermaid flowcharts explaining how each major flow in Plugin Manager Sidebar operates end to end.

## Feature & Change Flowcharts

### [VISUAL: Single-Plugin-Toggle-And-Verification-Flow] | Aliases: toggle plugin, enable disable, exclusive action
> **1-Line Summary:** How plugin enablement changes are executed exclusively, verified against host state, and safely rolled back if self-targeting.

* **Plain-English Walkthrough:** When the user clicks the toggle switch for a community or core plugin in the sidebar, the manager verifies that it is not attempting to disable itself. It wraps the operation in an `exclusive()` mutex to prevent overlapping mutations. It calls the appropriate host API (`enablePluginAndSave` or `disablePluginAndSave`), verifies that Obsidian's internal `enabledPlugins` set reflected the requested state change, and refreshes the sidebar view while maintaining scroll position.

```mermaid
flowchart TD
    %% Color Definitions (Obsidian & GitHub compatible)
    classDef startNode fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff
    classDef processNode fill:#0f766e,stroke:#115e59,color:#ffffff
    classDef outputNode fill:#15803d,stroke:#14532d,color:#ffffff
    classDef trapNode fill:#b91c1c,stroke:#7f1d1d,color:#ffffff

    Start([User toggles plugin switch in Sidebar View]):::startNode --> SelfCheck{Is target plugin plugin-manager-sidebar?}:::processNode
    SelfCheck -->|Yes - Self Disable| LockTrap[Block action & show Notice: Cannot disable self]:::trapNode
    SelfCheck -->|No| MutexCheck{Is exclusive lock busy?}:::processNode

    MutexCheck -->|Yes| BusyTrap[Reject with Notice: Plugin manager is busy]:::trapNode
    MutexCheck -->|No| AcquireMutex[Acquire exclusive mutex lock]:::processNode

    AcquireMutex --> TypeBranch{Is target a Core or Community plugin?}:::processNode
    TypeBranch -->|Core Plugin| CallCore[app.internalPlugins: setEnabled]:::processNode
    TypeBranch -->|Community Plugin| CallComm[app.plugins: enablePluginAndSave / disablePluginAndSave]:::processNode

    CallCore --> VerifyHost{Did enabled state change in host table?}:::processNode
    CallComm --> VerifyHost

    VerifyHost -->|No| ThrowErr[Throw Error & notify user of failure]:::trapNode
    VerifyHost -->|Yes| ReleaseMutex[Release exclusive lock & trigger refreshViews]:::processNode

    ReleaseMutex --> Done([Sidebar View Refreshed with Preserved Scroll]):::outputNode

    subgraph Legend["Legend (Color Guide)"]
        L1([Blue = Starting User Action / Entry Point]):::startNode
        L2[Teal = Processing & Transformation Step]:::processNode
        L3([Green = Successful Final Outcome]):::outputNode
        L4[Red = Self-Protection / Busy / Error Guard]:::trapNode
    end
```

* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `togglePlugin`, `applyEnabled`, `exclusive`
  * `src/views/plugin-manager-view.ts` -> `addRow`

---

### [VISUAL: Manifest-Override-And-Safety-Flow] | Aliases: manifest editor, overlay settings, non destructive override
> **1-Line Summary:** How plugin name and description edits are saved non-destructively as overrides for official plugins or written to disk for local plugins.

* **Plain-English Walkthrough:** When a user customizes a plugin's title or description, Plugin Manager Sidebar branches based on origin. Official community plugins and core plugins never have their disk files touched (avoiding checksum/update overwrite issues); instead, their customizations are stored inside `data.json` as runtime overrides. Local development plugins have their local `manifest.json` updated on disk with formatted two-space indentation.

```mermaid
flowchart TD
    %% Color Definitions (Obsidian & GitHub compatible)
    classDef startNode fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff
    classDef processNode fill:#0f766e,stroke:#115e59,color:#ffffff
    classDef outputNode fill:#15803d,stroke:#14532d,color:#ffffff
    classDef trapNode fill:#b91c1c,stroke:#7f1d1d,color:#ffffff

    Start([User edits plugin metadata in ManifestEditModal]):::startNode --> OriginCheck{Is plugin local development or official?}:::processNode

    OriginCheck -->|Official / Core| OverridePath[Store metadata in data.json overrides table]:::processNode
    OriginCheck -->|Local Plugin| DiskPath[Read <configDir>/plugins/<id>/manifest.json]:::processNode

    DiskPath --> MergeJson[Merge fields & write indented JSON to disk]:::processNode
    OverridePath --> SaveChain[saveChain: Serialize settings write to data.json]:::processNode

    MergeJson --> UpdateMem[Update in-memory manifest cache]:::processNode
    SaveChain --> UpdateMem

    UpdateMem --> Done([View Re-rendered with Custom Metadata]):::outputNode

    subgraph Legend["Legend (Color Guide)"]
        L1([Blue = Starting User Action / Entry Point]):::startNode
        L2[Teal = Processing & Transformation Step]:::processNode
        L3([Green = Successful Final Outcome]):::outputNode
        L4[Red = Guard Check Node]:::trapNode
    end
```

* **Code Anchors (Grep Targets):**
  * `src/modals/manifest-edit-modal.ts` -> `ManifestEditModal.onOpen`
  * `src/main.ts` -> `saveChain`, `applyOverride`

---

### [VISUAL: Sidebar-Controller-Toggle-And-Deduplication-Flow] | Aliases: sidebar toggle, ribbon state sync, leaf deduplication, SidebarController
> **1-Line Summary:** How SidebarController activates, toggles, deduplicates open leaves, and synchronizes ribbon active styling and ARIA state.

* **Plain-English Walkthrough:** When the user clicks the ribbon toggle icon or executes the toggle command, `SidebarController` checks if any sidebar leaf containing `PluginManagerView` is currently visible and uncollapsed. If visible, it collapses the split dock to tuck the sidebar away and turns off the ribbon active state. If not visible, it calls `activate()`, which finds or creates the leaf, purges any duplicate leaves by detaching them, expands the sidebar split, reveals/focuses the leaf, and updates the ribbon icon with `.is-active` and `aria-pressed="true"`.

```mermaid
flowchart TD
    %% Color Definitions (Obsidian & GitHub compatible)
    classDef startNode fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff
    classDef processNode fill:#0f766e,stroke:#115e59,color:#ffffff
    classDef outputNode fill:#15803d,stroke:#14532d,color:#ffffff
    classDef trapNode fill:#b91c1c,stroke:#7f1d1d,color:#ffffff

    Start([User clicks Ribbon or invokes Toggle Command]):::startNode --> CheckVis{Is PluginManagerView visible & split expanded?}:::processNode

    CheckVis -->|Yes - Visible| CollapseSplit[Collapse split dock or detach unanchored leaf]:::processNode
    CollapseSplit --> SyncOff[syncRibbonState: Remove .is-active & aria-pressed=false]:::processNode
    SyncOff --> CollapsedDone([Sidebar Collapsed & Ribbon Inactive]):::outputNode

    CheckVis -->|No - Hidden/Collapsed| ActivateCall[Call activate: Locate primary leaf]:::processNode
    ActivateCall --> FindLeaves{Leaves of VIEW_TYPE exist in workspace?}:::processNode

    FindLeaves -->|None| CreateLeaf[workspace.getRightLeaf: setViewState VIEW_TYPE]:::processNode
    FindLeaves -->|1 or More| DedupeLeaves[getPrimaryLeaf: Keep visible primary & detach all duplicate leaves]:::trapNode

    CreateLeaf --> ExpandSplit[Ensure parent split dock is expanded]:::processNode
    DedupeLeaves --> ExpandSplit

    ExpandSplit --> FocusLeaf[revealLeaf or setActiveLeaf with focus]:::processNode
    FocusLeaf --> SyncOn[syncRibbonState: Add .is-active & aria-pressed=true]:::processNode
    SyncOn --> ActiveDone([Sidebar Visible & Ribbon Highlighted]):::outputNode

    subgraph Legend["Legend (Color Guide)"]
        L1([Blue = User Trigger / Entry Point]):::startNode
        L2[Teal = Workspace Discovery & Navigation Step]:::processNode
        L3([Green = Successful Final State]):::outputNode
        L4[Red = Leaf Deduplication & Cleanup Guard]:::trapNode
    end
```

* **Code Anchors (Grep Targets):**
  * `src/utils/workspace.ts` -> `SidebarController`, `toggle`, `activate`, `getPrimaryLeaf`, `syncRibbonState`
  * `src/main.ts` -> `toggleView`, `activateView`, `sidebar`

---

### [VISUAL: Plugin-Community-Page-And-Repository-Resolution-Flow] | Aliases: repo resolution, community page, github links, show-plugin
> **1-Line Summary:** How Plugin Manager Sidebar navigates to an official plugin's directory entry or resolves its GitHub repository through a hierarchical cascade.

* **Plain-English Walkthrough:** Clicking the Compass action on an official plugin opens Obsidian's internal directory modal (`obsidian://show-plugin?id=<id>`), or guides the user to settings if restricted mode is enabled. Clicking the GitHub action on any plugin resolves a repository URL through a 4-tier hierarchy: (1) user override URL, (2) official registry repo name, (3) manifest `authorUrl` GitHub matching, and (4) default GitHub owner + slug fallback. The resolved URL opens safely in an external browser tab.

```mermaid
flowchart TD
    %% Color Definitions (Obsidian & GitHub compatible)
    classDef startNode fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff
    classDef processNode fill:#0f766e,stroke:#115e59,color:#ffffff
    classDef outputNode fill:#15803d,stroke:#14532d,color:#ffffff
    classDef trapNode fill:#b91c1c,stroke:#7f1d1d,color:#ffffff

    Start([User clicks Compass or GitHub button in row/menu]):::startNode --> ActionType{Which button was clicked?}:::processNode

    ActionType -->|Compass / Community Page| OfficialCheck{Is plugin official community?}:::processNode
    ActionType -->|GitHub / Repo Link| ResolveRepo[Call resolvePluginRepoUrl]:::processNode

    OfficialCheck -->|Yes| RestrictCheck{Is restricted mode active?}:::processNode
    OfficialCheck -->|No - Local| ResolveRepo

    RestrictCheck -->|Yes - Restricted| RestrictTrap[Show Notice & open Community Plugins settings]:::trapNode
    RestrictCheck -->|No| OpenUri([Open obsidian://show-plugin?id=...]):::outputNode

    ResolveRepo --> OverrideCheck{Custom repoUrl in overrides?}:::processNode
    OverrideCheck -->|Yes| UseOverride[Return sanitized override URL]:::processNode
    OverrideCheck -->|No| RegCheck{Official repo found in registry map?}:::processNode

    RegCheck -->|Yes| UseReg[Return github.com/owner/repo]:::processNode
    RegCheck -->|No| ManifestCheck{Manifest authorUrl is GitHub?}:::processNode

    ManifestCheck -->|Yes| ParseAuthor[Extract owner/repo or owner + slug]:::processNode
    ManifestCheck -->|No| OwnerCheck{defaultGithubOwner set in settings?}:::processNode

    OwnerCheck -->|Yes| UseOwner[Return github.com/defaultOwner/slug]:::processNode
    OwnerCheck -->|No| FallbackAuth{Raw authorUrl exists?}:::processNode

    FallbackAuth -->|Yes| UseAuth[Return sanitized authorUrl]:::processNode
    FallbackAuth -->|No| NoUrlTrap[Show Notice: No repository URL configured]:::trapNode

    UseOverride --> OpenBrowser([window.open URL in external browser]):::outputNode
    UseReg --> OpenBrowser
    ParseAuthor --> OpenBrowser
    UseOwner --> OpenBrowser
    UseAuth --> OpenBrowser

    subgraph Legend["Legend (Color Guide)"]
        L1([Blue = User Trigger / Entry Point]):::startNode
        L2[Teal = URL Resolution & Routing Step]:::processNode
        L3([Green = Successful Navigation Outcome]):::outputNode
        L4[Red = Restricted Mode / Missing Link Guard]:::trapNode
    end
```

* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `openPluginPage`, `openPluginRepo`, `resolvePluginRepoUrl`
  * `src/views/plugin-manager-view.ts` -> `iconButton`, `openMenu`
  * `src/utils/settings.ts` -> `sanitizeGithubOwner`, `sanitizeHttpUrl`

---

### [VISUAL: Modular-Architecture-And-Filter-Pipeline-Flow] | Aliases: modular architecture, HostBridge, UpdateService, applyPluginFilters
> **1-Line Summary:** How user interactions in PluginManagerView flow through the pure filter pipeline and specialized runtime services.

* **Plain-English Walkthrough:** When the sidebar renders or searches, `PluginManagerView` feeds raw inventories through the pure, standalone `applyPluginFilters` pipeline. All mutations and system inquiries route through `PluginManagerSidebar`'s exclusive lock to dedicated sub-services: `HostBridge` guards private Obsidian runtime interfaces, `UpdateService` handles releases and version checks, and `SidebarController` manages workspace docks and leaf lifecycles.

```mermaid
flowchart TD
    %% Color Definitions (Obsidian & GitHub compatible)
    classDef startNode fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff
    classDef processNode fill:#0f766e,stroke:#115e59,color:#ffffff
    classDef outputNode fill:#15803d,stroke:#14532d,color:#ffffff
    classDef trapNode fill:#b91c1c,stroke:#7f1d1d,color:#ffffff

    Start([User interacts with PluginManagerView]):::startNode --> ActionKind{Type of action?}:::processNode

    ActionKind -->|Filter / Search / Sort| FilterCall[Call applyPluginFilters: pure function]:::processNode
    FilterCall --> TokenMatch[Apply text tokens across name, id, author, description]:::processNode
    TokenMatch --> FilterState[Apply state, source, pinned, and scope filters]:::processNode
    FilterState --> RenderOutput([Render grouped/sorted sections in View]):::outputNode

    ActionKind -->|Toggle / Uninstall / HotReload| MutexCheck{Exclusive lock acquired?}:::processNode
    MutexCheck -->|No| BusyTrap[Show Notice: Manager is busy]:::trapNode
    MutexCheck -->|Yes| HostCall[Dispatch to HostBridge adapter]:::processNode

    HostCall --> GuardCheck{Defensive typeof check on host API}:::processNode
    GuardCheck -->|Missing / Unsupported| ThrowErr[Gracefully catch & report notice]:::trapNode
    GuardCheck -->|Supported| ExecuteHost[Invoke Obsidian runtime & verify state]:::processNode
    ExecuteHost --> ViewRefresh([refreshViews: Re-render with preserved scroll]):::outputNode

    ActionKind -->|Update Check / App Release| UpdateCall[Dispatch to UpdateService]:::processNode
    UpdateCall --> UpdateFetch[Fetch community-plugins.json / desktop-releases.json]:::processNode
    UpdateFetch --> UpdateModal([Surface AppUpdateModal or populate update rows]):::outputNode

    subgraph Legend["Legend (Color Guide)"]
        L1([Blue = User Action / Entry Point]):::startNode
        L2[Teal = Pure Pipeline / Service Execution Step]:::processNode
        L3([Green = Successful Render / Action Completion]):::outputNode
        L4[Red = Mutex Busy / Defensive Guard Node]:::trapNode
    end
```

* **Code Anchors (Grep Targets):**
  * `src/views/plugin-filter.ts` -> `applyPluginFilters`
  * `src/services/host-bridge.ts` -> `HostBridge`
  * `src/services/update-service.ts` -> `UpdateService`
  * `src/main.ts` -> `exclusive`, `safe`

---

### [VISUAL: Plugin-Settings-Window-Toggle-Flow] | Aliases: settings toggle flow, close settings, openPluginSettings
> **1-Line Summary:** How HostBridge checks active settings tab state to either close an open settings modal or open the target tab.

* **Plain-English Walkthrough:** When the user clicks the gear settings icon on a plugin row, `HostBridge` queries `SettingApi` to determine whether settings is already open and active on that plugin's tab. If open, it closes the modal/window immediately, providing a quick toggle shortcut. If closed or active on a different tab, it ensures the plugin is enabled and opens the target plugin settings tab directly.

```mermaid
flowchart TD
    %% Color Definitions (Obsidian & GitHub compatible)
    classDef startNode fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff
    classDef processNode fill:#0f766e,stroke:#115e59,color:#ffffff
    classDef outputNode fill:#15803d,stroke:#14532d,color:#ffffff
    classDef trapNode fill:#b91c1c,stroke:#7f1d1d,color:#ffffff

    Start([User clicks Gear Settings icon on plugin row]):::startNode --> SettingAvail{app.setting interface available?}:::processNode

    SettingAvail -->|No| NoApiDone([No action / unsupported]):::trapNode
    SettingAvail -->|Yes| ActiveCheck{isSettingsOpenFor: Active tab matches target plugin?}:::processNode

    ActiveCheck -->|Yes - Open & Matching| CloseCall[setting.close or win.close]:::processNode
    CloseCall --> ClosedDone([Settings Modal Closed]):::outputNode

    ActiveCheck -->|No - Closed or Different Tab| EnabledCheck{Is target plugin enabled?}:::processNode

    EnabledCheck -->|No - Disabled| NoticeTrap[Show Notice: Enable plugin first to access settings]:::trapNode
    EnabledCheck -->|Yes| OpenTab[setting.open and openTabById]:::processNode

    OpenTab --> OpenDone([Settings Modal Opened to Plugin Tab]):::outputNode

    subgraph Legend["Legend (Color Guide)"]
        L1([Blue = User Action / Entry Point]):::startNode
        L2[Teal = Host Query & Navigation Step]:::processNode
        L3([Green = Successful Open or Close State]):::outputNode
        L4[Red = Disabled Guard / Missing Host Guard]:::trapNode
    end
```

* **Code Anchors (Grep Targets):**
  * `src/services/host-bridge.ts` -> `openPluginSettings`, `isSettingsOpenFor`
  * `src/utils/obsidian-internals.ts` -> `SettingApi`
