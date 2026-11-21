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
