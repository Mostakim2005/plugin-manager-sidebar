"use strict";

const obsidian = require("obsidian");
const { Plugin, ItemView, Modal, Menu, Notice, setIcon, requestUrl, PluginSettingTab, Setting } = obsidian;

const TAG = "[Plugin Manager Sidebar]";
const VIEW_TYPE = "plugin-manager-view";
const COMMUNITY_REGISTRY_URL =
  "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";
const DESKTOP_RELEASES_URL =
  "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json";
const OBSIDIAN_DOWNLOAD_URL = "https://obsidian.md/download";

const log = (...args) => console.log(TAG, ...args);
const logError = (context, err, extra) => {
  if (extra !== undefined) console.error(TAG, context, err, extra);
  else console.error(TAG, context, err);
};
const errMsg = (e) => (e instanceof Error ? e.message : String(e));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const unique = (arr) => [...new Set(arr)];

const sanitizePluginId = (id) => {
  if (typeof id !== "string") return "";
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
};

const byEnabledThenName = (a, b) => {
  if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
};

const byName = (a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

const newId = () =>
  "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const compareSemver = (a, b) => {
  if (!a || !b) return 0;
  const pa = a.replace(/^[^\d]*/, "").split(".").map(Number);
  const pb = b.replace(/^[^\d]*/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
};

/* ------------------------------------------------------------------ */
/* Settings & Persistence                                              */
/* ------------------------------------------------------------------ */

function sanitizeSettings(raw) {
  const out = {
    version: 7,
    pinned: [],
    groups: [],
    view: "status",          // "status" | "group"
    scope: "community",      // "community" | "core" | "all"
    sourceFilter: "all",     // "all" | "official" | "local"
    stateFilter: "all",      // "all" | "enabled" | "disabled"
    pinnedOnly: false,
    updatesOnly: false,
    selectedGroup: "all",    // "all" | group.id | "_ungrouped"
    sortBy: "status",        // "status" | "alphabetical"
    glassmorphism: true,
    autoCheckUpdates: true,
    overrides: {}
  };
  if (!raw || typeof raw !== "object") return out;

  if (Array.isArray(raw.pinned)) {
    out.pinned = unique(raw.pinned.filter((s) => typeof s === "string" && /^[a-zA-Z0-9_-]+$/.test(s)));
  }
  if (raw.view === "group") out.view = "group";
  if (["community", "core", "all"].includes(raw.scope)) {
    out.scope = raw.scope;
  }
  if (["all", "official", "local"].includes(raw.sourceFilter)) {
    out.sourceFilter = raw.sourceFilter;
  }
  if (["all", "enabled", "disabled"].includes(raw.stateFilter)) {
    out.stateFilter = raw.stateFilter;
  }
  if (typeof raw.pinnedOnly === "boolean") out.pinnedOnly = raw.pinnedOnly;
  if (typeof raw.updatesOnly === "boolean") out.updatesOnly = raw.updatesOnly;
  if (typeof raw.selectedGroup === "string") out.selectedGroup = raw.selectedGroup;
  if (["status", "alphabetical"].includes(raw.sortBy)) out.sortBy = raw.sortBy;
  if (typeof raw.glassmorphism === "boolean") out.glassmorphism = raw.glassmorphism;
  if (typeof raw.autoCheckUpdates === "boolean") out.autoCheckUpdates = raw.autoCheckUpdates;

  if (raw.overrides && typeof raw.overrides === "object" && !Array.isArray(raw.overrides)) {
    const cleanOverrides = {};
    for (const [key, val] of Object.entries(raw.overrides)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      const safeKey = sanitizePluginId(key);
      if (safeKey && val && typeof val === "object") {
        cleanOverrides[safeKey] = {
          name: typeof val.name === "string" ? val.name.slice(0, 100) : undefined,
          author: typeof val.author === "string" ? val.author.slice(0, 100) : undefined,
          description: typeof val.description === "string" ? val.description.slice(0, 500) : undefined
        };
      }
    }
    out.overrides = cleanOverrides;
  }

  if (Array.isArray(raw.groups)) {
    const seen = new Set();
    for (const g of raw.groups) {
      if (!g || typeof g !== "object") continue;
      const name = typeof g.name === "string" ? g.name.trim() : "";
      if (!name) continue;
      let id = typeof g.id === "string" && g.id ? g.id : newId();
      while (seen.has(id)) id = newId();
      seen.add(id);
      out.groups.push({
        id,
        name,
        plugins: Array.isArray(g.plugins)
          ? unique(g.plugins.filter((s) => typeof s === "string" && /^[a-zA-Z0-9_-]+$/.test(s)))
          : [],
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Modals                                                             */
/* ------------------------------------------------------------------ */

class ConfirmModal extends Modal {
  constructor(app, title, message, confirmText, onConfirm) {
    super(app);
    this.titleText = title;
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.modalEl.addClass("pms-modal-glass", "pms-confirm-modal");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.titleText });
    contentEl.createEl("p", { text: this.message });
    const row = contentEl.createDiv("modal-button-container");
    const cancel = row.createEl("button", { text: "Cancel" });
    const ok = row.createEl("button", { text: this.confirmText, cls: "mod-warning" });
    cancel.addEventListener("click", () => this.close());
    ok.addEventListener("click", () => {
      this.close();
      try {
        const r = this.onConfirm();
        if (r && typeof r.catch === "function") r.catch((e) => logError("confirm action failed", e));
      } catch (e) {
        logError("confirm action failed", e);
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class AppUpdateModal extends Modal {
  constructor(app, currentVersion, latestVersion, downloadUrl) {
    super(app);
    this.currentVersion = currentVersion;
    this.latestVersion = latestVersion;
    this.downloadUrl = downloadUrl;
  }

  onOpen() {
    this.modalEl.addClass("pms-modal-glass", "pms-update-modal");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pms-google-modal");

    contentEl.createEl("h2", { text: "Obsidian Software Update Available" });

    const badgeWrap = contentEl.createDiv("pms-modal-version-row");
    const curBadge = badgeWrap.createSpan("pms-chip-badge");
    curBadge.setText(`Current: v${this.currentVersion}`);
    const newBadge = badgeWrap.createSpan("pms-chip-badge is-accent");
    newBadge.setText(`Latest: v${this.latestVersion}`);

    contentEl.createEl("p", {
      text: "A new official desktop version of Obsidian is ready to download. Click below to go directly to the Obsidian download page.",
      cls: "pms-modal-desc"
    });

    const row = contentEl.createDiv("modal-button-container");
    const cancel = row.createEl("button", { text: "Later" });
    const download = row.createEl("button", { text: "Download Update", cls: "mod-cta" });

    cancel.addEventListener("click", () => this.close());
    download.addEventListener("click", () => {
      window.open(this.downloadUrl);
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ManifestEditModal extends Modal {
  constructor(app, pluginManager, targetPlugin, isLocal) {
    super(app);
    this.pmPlugin = pluginManager;
    this.target = targetPlugin;
    this.isLocal = isLocal;
  }

  onOpen() {
    this.modalEl.addClass("pms-modal-glass", "pms-edit-modal-host");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pms-edit-modal");

    contentEl.createEl("h2", {
      text: this.isLocal ? "Edit Plugin Metadata (Permanent)" : "Edit Plugin Display (Visual Overlay)"
    });

    const noticeEl = contentEl.createDiv({
      cls: `pms-modal-badge-desc ${this.isLocal ? "is-local-notice" : "is-official-notice"}`
    });
    noticeEl.setText(
      this.isLocal
        ? "Local/Manual plugin: Changes directly modify manifest.json on disk."
        : "Official/Core plugin: Changes are stored non-destructively in data.json."
    );

    contentEl.createEl("label", { text: "Display Name", cls: "pms-modal-label" });
    const nameInput = contentEl.createEl("input", {
      type: "text",
      cls: "pms-modal-input",
      value: this.target.name || ""
    });

    contentEl.createEl("label", { text: "Author", cls: "pms-modal-label" });
    const authorInput = contentEl.createEl("input", {
      type: "text",
      cls: "pms-modal-input",
      value: this.target.author || ""
    });

    contentEl.createEl("label", { text: "Description", cls: "pms-modal-label" });
    const descInput = contentEl.createEl("textarea", {
      cls: "pms-modal-textarea"
    });
    descInput.value = this.target.description || "";

    const row = contentEl.createDiv("modal-button-container");

    if (!this.isLocal && this.pmPlugin.settings.overrides[this.target.id]) {
      const resetBtn = row.createEl("button", { text: "Reset Defaults", cls: "mod-warning" });
      resetBtn.addEventListener("click", async () => {
        delete this.pmPlugin.settings.overrides[this.target.id];
        await this.pmPlugin.saveSettings();
        this.pmPlugin.refreshViews();
        new Notice("Restored official details.");
        this.close();
      });
    }

    const cancel = row.createEl("button", { text: "Cancel" });
    const save = row.createEl("button", { text: "Save Changes", cls: "mod-cta" });
    cancel.addEventListener("click", () => this.close());

    save.addEventListener("click", async () => {
      const newName = nameInput.value.trim() || this.target.id;
      const newAuthor = authorInput.value.trim();
      const newDesc = descInput.value.trim();

      save.disabled = true;
      try {
        if (this.isLocal) {
          await this.pmPlugin.saveLocalManifest(this.target.id, newName, newAuthor, newDesc);
        } else {
          this.pmPlugin.settings.overrides[this.target.id] = {
            name: newName,
            author: newAuthor,
            description: newDesc
          };
          await this.pmPlugin.saveSettings();
        }
        this.pmPlugin.refreshViews();
        this.close();
      } catch (e) {
        logError("failed saving metadata", e);
        new Notice(`Failed to save: ${errMsg(e)}`);
      } finally {
        save.disabled = false;
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class GroupModal extends Modal {
  constructor(app, plugins, group, onSave, onDelete) {
    super(app);
    this.plugins = plugins;
    this.group = group;
    this.onSave = onSave;
    this.onDelete = onDelete;
    this.selected = new Set(group ? group.plugins : []);
    this.filter = "";
    this.categoryFilter = "all";
  }

  onOpen() {
    this.modalEl.addClass("pms-modal-glass", "pms-group-modal-host");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pms-group-modal");
    contentEl.createEl("h2", { text: this.group ? "Edit Group" : "New Group" });

    contentEl.createEl("label", { text: "Group name", cls: "pms-modal-label" });
    const nameInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "e.g. Study, Themes, Automation",
      cls: "pms-modal-input",
      value: this.group ? this.group.name : ""
    });

    contentEl.createEl("label", { text: "Assign plugins", cls: "pms-modal-label" });
    const search = contentEl.createEl("input", {
      type: "search",
      placeholder: "Filter plugins…",
      cls: "pms-modal-input"
    });

    const catBar = contentEl.createDiv("pms-control-row pms-modal-filter-row");
    const chips = [
      { id: "all", label: "All" },
      { id: "community", label: "Community" },
      { id: "core", label: "Core" },
      { id: "official", label: "Official" },
      { id: "local", label: "Local" }
    ];

    const catButtons = [];
    chips.forEach((c) => {
      const btn = catBar.createEl("button", {
        text: c.label,
        cls: `pms-chip ${this.categoryFilter === c.id ? "is-active" : ""}`,
        attr: { type: "button" }
      });
      btn.addEventListener("click", () => {
        this.categoryFilter = c.id;
        catButtons.forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        renderChecks();
      });
      catButtons.push(btn);
    });

    const counter = contentEl.createDiv("pms-modal-hint");
    const list = contentEl.createDiv("pms-check-list");

    const updateCounter = () => {
      counter.setText(`${this.selected.size} plugins selected`);
    };

    const renderChecks = () => {
      list.empty();
      const q = this.filter.trim().toLowerCase();

      const items = this.plugins.filter((p) => {
        const matchesQuery =
          !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
        if (!matchesQuery) return false;

        if (this.categoryFilter === "core") return p.isCore;
        if (this.categoryFilter === "community") return !p.isCore;
        if (this.categoryFilter === "official") return !p.isCore && p.isOfficial;
        if (this.categoryFilter === "local") return !p.isCore && p.isLocal;
        return true;
      });

      if (items.length === 0) {
        list.createDiv({ text: "No matching plugins found.", cls: "pms-empty-text" });
        return;
      }

      for (const p of items) {
        const row = list.createEl("label", { cls: "pms-check-row" });
        const box = row.createEl("input", { type: "checkbox" });
        box.checked = this.selected.has(p.id);
        row.createSpan({ text: p.name });

        if (p.isCore) {
          row.createSpan({ text: "Core", cls: "pms-source-badge is-core" });
        } else if (p.isLocal) {
          row.createSpan({ text: "Local", cls: "pms-source-badge is-manual" });
        }

        box.addEventListener("change", () => {
          if (box.checked) this.selected.add(p.id);
          else this.selected.delete(p.id);
          updateCounter();
        });
      }
    };

    search.addEventListener("input", () => {
      this.filter = search.value;
      renderChecks();
    });

    const row = contentEl.createDiv("modal-button-container");
    if (this.group) {
      const del = row.createEl("button", { text: "Delete Group", cls: "mod-warning" });
      del.addEventListener("click", () => {
        this.close();
        this.onDelete();
      });
    }
    const cancel = row.createEl("button", { text: "Cancel" });
    const save = row.createEl("button", { text: "Save Group", cls: "mod-cta" });
    cancel.addEventListener("click", () => this.close());

    save.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        new Notice("Please provide a group name.");
        nameInput.focus();
        return;
      }
      await this.onSave(name, [...this.selected]);
      this.close();
    });

    updateCounter();
    renderChecks();
    window.setTimeout(() => nameInput.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ------------------------------------------------------------------ */
/* Sidebar View Component                                             */
/* ------------------------------------------------------------------ */

class PluginManagerView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.query = "";
    this.bodyEl = null;
    this.searchTimeout = null;
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Plugin Manager";
  }
  getIcon() {
    return "blocks";
  }

  async onOpen() {
    this.render();
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.leaf) this.renderList();
      })
    );
    this.registerDomEvent(window, "focus", () => this.renderList());
  }

  async onClose() {
    if (this.searchTimeout) {
      window.clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }
    this.contentEl.empty();
  }

  render() {
    const root = this.contentEl;
    const scrollTop = root.scrollTop;
    root.empty();
    root.addClass("pms-view");

    const header = root.createDiv("pms-header");

    // Top Bar: Search & Actions
    const top = header.createDiv("pms-top");
    const searchWrap = top.createDiv("pms-search-wrap");
    const input = searchWrap.createEl("input", {
      type: "search",
      placeholder: "Search plugins…",
      cls: "pms-search-input",
      attr: { "aria-label": "Search installed and core plugins" }
    });
    input.value = this.query;
    input.addEventListener("input", () => {
      this.query = input.value;
      if (this.searchTimeout) window.clearTimeout(this.searchTimeout);
      this.searchTimeout = window.setTimeout(() => {
        this.renderList();
      }, 150);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        input.value = "";
        this.query = "";
        if (this.searchTimeout) window.clearTimeout(this.searchTimeout);
        this.renderList();
      }
    });

    const topActions = top.createDiv("pms-top-actions");
    const updateCount = this.plugin.getAvailableUpdatesCount();

    // 1. Direct Store Browse
    this.iconButton(topActions, "compass", "Browse community plugins", () =>
      this.plugin.openCommunityBrowser()
    );

    // 2. Obsidian App Update Checker
    this.iconButton(topActions, "arrow-up-circle", "Check Obsidian software updates", () =>
      this.plugin.checkObsidianSoftwareUpdate()
    );

    // 3. Community Plugin Updates Checker
    const updateCheckBtn = this.iconButton(
      topActions,
      "download-cloud",
      updateCount > 0 ? `${updateCount} updates available!` : "Check for plugin updates",
      () => this.plugin.checkOfficialUpdates()
    );
    if (updateCount > 0) updateCheckBtn.addClass("is-update-highlight");

    // 4. Create Group
    if (this.plugin.settings.view === "group") {
      this.iconButton(topActions, "plus", "Create new group", () =>
        this.plugin.openGroupEditor(null)
      );
    }

    // 5. Refresh
    this.iconButton(topActions, "refresh-cw", "Refresh list", async () => {
      await this.plugin.fetchOfficialRegistry();
      this.renderList();
    });

    const s = this.plugin.settings;

    // =========================================================================
    // Dedicated Row 1: Scope & Structure Controls (Never affected by filters)
    // =========================================================================
    const structureRow = header.createDiv("pms-control-row pms-structure-row");

    // 1. Scope 3-Way Cycle Chip: Community -> Core -> All -> Community
    const scopeLabels = {
      community: "Scope: Community",
      core: "Scope: Core",
      all: "Scope: All"
    };
    const scopeOrder = ["community", "core", "all"];
    const scopeBtn = structureRow.createEl("button", {
      cls: `pms-chip ${s.scope !== "community" ? "is-active" : ""}`,
      attr: { type: "button", title: "Click to cycle: Community → Core → All" }
    });
    scopeBtn.createSpan({ text: scopeLabels[s.scope] || "Scope: Community" });
    scopeBtn.addEventListener("click", () => {
      const idx = scopeOrder.indexOf(s.scope);
      s.scope = scopeOrder[(idx + 1) % scopeOrder.length];
      void this.plugin.saveSettings();
      this.render();
    });

    // 2. View Mode Binary Toggle Chip: Status <-> Groups
    const viewBtn = structureRow.createEl("button", {
      cls: `pms-chip ${s.view === "group" ? "is-active" : ""}`,
      attr: { type: "button", title: "Click to toggle: Status ↔ Groups" }
    });
    viewBtn.createSpan({ text: s.view === "group" ? "View: Groups" : "View: Status" });
    viewBtn.addEventListener("click", () => {
      s.view = s.view === "status" ? "group" : "status";
      void this.plugin.saveSettings();
      this.render();
    });

    // 3. Group Dropdown Selector (Anchored on Row 1 when View is "Groups")
    if (s.view === "group") {
      const groupSelect = structureRow.createEl("select", {
        cls: "pms-group-select",
        attr: { title: "Filter by group" }
      });

      const optAll = groupSelect.createEl("option", { text: "All Groups", value: "all" });
      if (s.selectedGroup === "all") optAll.selected = true;

      for (const g of s.groups) {
        const opt = groupSelect.createEl("option", { text: g.name, value: g.id });
        if (s.selectedGroup === g.id) opt.selected = true;
      }

      const optUngrouped = groupSelect.createEl("option", {
        text: "Ungrouped",
        value: "_ungrouped"
      });
      if (s.selectedGroup === "_ungrouped") optUngrouped.selected = true;

      groupSelect.addEventListener("change", () => {
        s.selectedGroup = groupSelect.value;
        void this.plugin.saveSettings();
        this.renderList();
      });
    }

    // =========================================================================
    // Dedicated Row 2: Filter & State Criteria (Anchored independently)
    // =========================================================================
    const criteriaRow = header.createDiv("pms-control-row pms-criteria-row");

    // 4. Source 3-Way Cycle Chip: All -> Official -> Local -> All (Hidden for Core)
    if (s.scope !== "core") {
      const sourceOrder = ["all", "official", "local"];
      const sourceLabels = {
        all: "Source: All",
        official: "Source: Official",
        local: "Source: Local"
      };
      let sourceCls = "pms-chip";
      if (s.sourceFilter === "official") sourceCls += " is-source-official";
      else if (s.sourceFilter === "local") sourceCls += " is-source-local";

      const sourceBtn = criteriaRow.createEl("button", {
        cls: sourceCls,
        attr: { type: "button", title: "Click to cycle: All Sources → Official → Local" }
      });
      sourceBtn.createSpan({ text: sourceLabels[s.sourceFilter] || "Source: All" });
      sourceBtn.addEventListener("click", () => {
        const idx = sourceOrder.indexOf(s.sourceFilter);
        s.sourceFilter = sourceOrder[(idx + 1) % sourceOrder.length];
        void this.plugin.saveSettings();
        this.render();
      });
    }

    // 5. State 3-Way Cycle Chip: All -> Enabled -> Disabled -> All
    const stateOrder = ["all", "enabled", "disabled"];
    const stateLabels = {
      all: "State: All",
      enabled: "State: Enabled",
      disabled: "State: Disabled"
    };
    let stateCls = "pms-chip";
    if (s.stateFilter === "enabled") stateCls += " is-active";
    else if (s.stateFilter === "disabled") stateCls += " is-state-disabled";

    const stateBtn = criteriaRow.createEl("button", {
      cls: stateCls,
      attr: { type: "button", title: "Click to cycle: All States → Enabled → Disabled" }
    });
    stateBtn.createSpan({ text: stateLabels[s.stateFilter] || "State: All" });
    stateBtn.addEventListener("click", () => {
      const idx = stateOrder.indexOf(s.stateFilter);
      s.stateFilter = stateOrder[(idx + 1) % stateOrder.length];
      void this.plugin.saveSettings();
      this.render();
    });

    // 6. Pinned Toggle Chip
    const pinnedBtn = criteriaRow.createEl("button", {
      cls: `pms-chip ${s.pinnedOnly ? "is-active" : ""}`,
      attr: { type: "button", title: "Click to toggle pinned filter" }
    });
    pinnedBtn.createSpan({ text: "Pinned" });
    pinnedBtn.addEventListener("click", () => {
      s.pinnedOnly = !s.pinnedOnly;
      void this.plugin.saveSettings();
      this.render();
    });

    // 7. Sort Order Toggle Chip: Status <-> A-Z
    const sortBtn = criteriaRow.createEl("button", {
      cls: `pms-chip ${s.sortBy === "alphabetical" ? "is-active" : ""}`,
      attr: { type: "button", title: "Click to cycle sort: Status (Enabled first) ↔ Alphabetical (A-Z)" }
    });
    sortBtn.createSpan({ text: s.sortBy === "alphabetical" ? "Sort: A-Z" : "Sort: Status" });
    sortBtn.addEventListener("click", () => {
      s.sortBy = s.sortBy === "alphabetical" ? "status" : "alphabetical";
      void this.plugin.saveSettings();
      this.render();
    });

    // 7. Updates Toggle Chip (Hidden for Core)
    if (s.scope !== "core") {
      const updateBtn = criteriaRow.createEl("button", {
        cls: `pms-chip ${s.updatesOnly ? "is-active" : ""}`,
        attr: { type: "button", title: "Click to toggle updates filter" }
      });
      updateBtn.createSpan({ text: "Updates" });
      if (updateCount > 0) {
        updateBtn.createSpan({ text: String(updateCount), cls: "pms-chip-badge" });
        updateBtn.addClass("is-update-chip");
      }
      updateBtn.addEventListener("click", () => {
        s.updatesOnly = !s.updatesOnly;
        void this.plugin.saveSettings();
        this.render();
      });
    }

    // 8. Reset Filters Chip (Anchored at end of Row 2 if any filter is active)
    const isFiltered =
      (s.scope !== "core" && s.sourceFilter !== "all") ||
      s.stateFilter !== "all" ||
      s.pinnedOnly ||
      s.updatesOnly;

    if (isFiltered) {
      const resetBtn = criteriaRow.createEl("button", {
        cls: "pms-chip pms-chip-reset",
        attr: { type: "button", title: "Reset all active filters" }
      });
      resetBtn.createSpan({ text: "✕ Reset" });
      resetBtn.addEventListener("click", () => {
        s.sourceFilter = "all";
        s.stateFilter = "all";
        s.pinnedOnly = false;
        s.updatesOnly = false;
        void this.plugin.saveSettings();
        this.render();
      });
    }

    this.bodyEl = root.createDiv("pms-body");
    this.renderList();
    root.scrollTop = scrollTop;
  }

  iconButton(parent, icon, label, cb) {
    const b = parent.createEl("button", {
      cls: "clickable-icon pms-icon-btn",
      attr: { "aria-label": label, title: label, type: "button" }
    });
    setIcon(b, icon);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      this.plugin.safe(() => cb(e), label);
    });
    return b;
  }

  renderList() {
    if (!this.bodyEl) return;
    const scroller = this.contentEl;
    const scrollTop = scroller.scrollTop;
    this.bodyEl.empty();

    try {
      this.buildList();
    } catch (e) {
      logError("could not draw plugin list", e);
      this.bodyEl.createDiv({
        text: "Could not draw the list. Details logged to console.",
        cls: "pms-empty-text"
      });
    }
    scroller.scrollTop = scrollTop;
  }

  buildList() {
    const body = this.bodyEl;
    const s = this.plugin.settings;
    const all = this.plugin.listPlugins(s.scope);

    if (s.scope !== "core" && !this.plugin.communityEnabled()) {
      body.createDiv({
        text: "Restricted Mode is active. Community plugins are currently disabled in Obsidian settings.",
        cls: "pms-banner"
      });
    }

    if (all.length === 0) {
      body.createDiv({ text: "No plugins found in this view.", cls: "pms-empty" });
      return;
    }

    const updates = this.plugin.getAvailableUpdates();
    const updateCount = updates.length;

    // Quick Statistics Bar
    const enabledCount = all.filter((p) => p.enabled).length;
    const disabledCount = all.length - enabledCount;
    const statsBar = body.createDiv("pms-stats-bar");
    statsBar.createSpan({ text: `Total: ${all.length}`, cls: "pms-stat-pill" });
    statsBar.createSpan({ text: `Active: ${enabledCount}`, cls: "pms-stat-pill is-active" });
    statsBar.createSpan({ text: `Inactive: ${disabledCount}`, cls: "pms-stat-pill is-inactive" });
    if (updateCount > 0) {
      statsBar.createSpan({ text: `Updates: ${updateCount}`, cls: "pms-stat-pill is-update" });
    }

    // Updates Available Section
    if (
      s.scope !== "core" &&
      updateCount > 0 &&
      (!s.stateFilter || s.stateFilter === "all" || s.stateFilter === "enabled") &&
      (!s.sourceFilter || s.sourceFilter === "all" || s.sourceFilter === "official")
    ) {
      const upSec = body.createDiv("pms-section pms-updates-section");
      const upHead = upSec.createDiv("pms-section-header");
      const upLeft = upHead.createDiv("pms-section-left");
      upLeft.createSpan({ text: "Updates Available", cls: "pms-section-title" });
      upLeft.createSpan({ text: String(updateCount), cls: "pms-section-count is-accent" });

      const upRight = upHead.createDiv("pms-section-actions");
      const upAllBtn = upRight.createEl("button", {
        text: "Update All",
        cls: "mod-cta pms-mini-btn",
        attr: { type: "button" }
      });
      upAllBtn.addEventListener("click", () => this.plugin.updateAllPlugins());

      const upList = upSec.createDiv("pms-section-list");
      for (const item of updates) {
        this.addUpdateRow(upList, item);
      }
    }

    // Filter Pipeline
    const q = this.query.trim().toLowerCase();
    const byId = new Map(all.map((p) => [p.id, p]));
    const sortFn = s.sortBy === "alphabetical" ? byName : byEnabledThenName;

    const filtered = all.filter((p) => {
      // 1. Text Search
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q);
      if (!matchesSearch) return false;

      // 2. Source Filter
      if (s.sourceFilter === "official" && (p.isCore || !p.isOfficial)) return false;
      if (s.sourceFilter === "local" && (p.isCore || !p.isLocal)) return false;

      // 3. State Filter
      if (s.stateFilter === "enabled" && !p.enabled) return false;
      if (s.stateFilter === "disabled" && p.enabled) return false;

      // 4. Pinned Filter
      if (s.pinnedOnly && !s.pinned.includes(p.id)) return false;

      // 5. Updates Filter
      if (s.updatesOnly && (!this.plugin.pm?.updates?.[p.id] || p.isCore)) return false;

      return true;
    }).sort(sortFn);

    const pinnedSet = new Set(s.pinned);
    const pinned = s.pinned
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((p) => filtered.includes(p))
      .sort(sortFn);

    let shown = 0;

    // Pinned section
    if (pinned.length && !s.pinnedOnly) {
      this.addSection("Pinned", pinned);
      shown += pinned.length;
    }

    if (s.view === "group") {
      const grouped = new Set();
      const selGroup = s.selectedGroup || "all";

      for (const g of s.groups) {
        for (const id of g.plugins) grouped.add(id);

        if (selGroup !== "all" && selGroup !== g.id) continue;

        const members = g.plugins
          .map((id) => byId.get(id))
          .filter(Boolean)
          .filter((p) => filtered.includes(p))
          .sort(sortFn);

        if (members.length > 0) {
          this.addSection(g.name, members, { group: g, total: members.length });
          shown += members.length;
        }
      }

      if (selGroup === "all" || selGroup === "_ungrouped") {
        const ungrouped = filtered
          .filter((p) => !grouped.has(p.id) && (s.pinnedOnly || !pinnedSet.has(p.id)))
          .sort(sortFn);

        if (ungrouped.length) {
          this.addSection("Other Plugins", ungrouped);
          shown += ungrouped.length;
        }
      }
    } else {
      const rest = filtered.filter((p) => s.pinnedOnly || !pinnedSet.has(p.id));
      if (s.sortBy === "alphabetical" && s.stateFilter === "all") {
        if (rest.length) this.addSection("All Plugins (A-Z)", rest);
        shown += rest.length;
      } else {
        const on = rest.filter((p) => p.enabled);
        const off = rest.filter((p) => !p.enabled);

        if (on.length) this.addSection("Enabled", on);
        if (off.length) this.addSection("Disabled", off);
        shown += rest.length;
      }
    }

    if (shown === 0 && updateCount === 0) {
      body.createDiv({ text: "No matching plugins found.", cls: "pms-empty" });
    }
  }

  addSection(title, plugins, opts) {
    const section = this.bodyEl.createDiv("pms-section");
    const head = section.createDiv("pms-section-header");
    const left = head.createDiv("pms-section-left");
    left.createSpan({ text: title, cls: "pms-section-title" });
    left.createSpan({
      text: String(opts && opts.total !== undefined ? opts.total : plugins.length),
      cls: "pms-section-count"
    });

    if (opts && opts.group) {
      const g = opts.group;
      const right = head.createDiv("pms-section-actions");
      const mk = (text, label, cb) => {
        const b = right.createEl("button", {
          text,
          cls: "pms-mini-btn",
          attr: { type: "button", "aria-label": label }
        });
        b.addEventListener("click", () => this.plugin.safe(cb, label));
      };
      mk("Enable All", `Enable all in "${g.name}"`, () => this.plugin.bulkGroup(g, true));
      mk("Disable All", `Disable all in "${g.name}"`, () => this.plugin.bulkGroup(g, false));
      this.iconButton(right, "pencil", "Edit group", () => this.plugin.openGroupEditor(g));
    }

    const list = section.createDiv("pms-section-list");
    for (const p of plugins) this.addRow(list, p);
  }

  addUpdateRow(parent, item) {
    const row = parent.createDiv("pms-item pms-update-item");
    const line = row.createDiv("pms-line1");

    const info = line.createDiv("pms-name-wrap");
    info.createSpan({ text: item.name, cls: "pms-name" });
    const versionDiff = info.createSpan({ cls: "pms-version-diff" });
    versionDiff.setText(`v${item.currentVersion} → v${item.newVersion}`);

    const act = line.createDiv("pms-row-actions");
    const updateBtn = act.createEl("button", {
      text: "Update",
      cls: "pms-mini-btn mod-cta"
    });
    updateBtn.addEventListener("click", () => this.plugin.updateSinglePlugin(item.id));
  }

  addRow(parent, p) {
    const plugin = this.plugin;
    const isSelf = p.id === plugin.manifest.id;
    const isPinned = plugin.settings.pinned.includes(p.id);

    const row = parent.createDiv("pms-item" + (p.enabled ? "" : " is-disabled"));
    row.dataset.pluginId = p.id;
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.openMenu(p, e);
    });

    const line1 = row.createDiv("pms-line1");
    const nameWrap = line1.createDiv("pms-name-wrap");
    nameWrap.createEl("span", { text: p.name, cls: "pms-name" });
    if (isSelf) nameWrap.createSpan({ text: "Self", cls: "pms-tag" });

    const line1Right = line1.createDiv("pms-line1-right");

    if (p.isCore) {
      line1Right.createSpan({ text: "Core", cls: "pms-source-badge is-core" });
    } else if (plugin.registryLoaded) {
      line1Right.createSpan({
        text: p.isLocal ? "Local" : "Official",
        cls: "pms-source-badge " + (p.isLocal ? "is-manual" : "is-official")
      });
    }

    const toggle = line1Right.createDiv({
      cls: "pms-toggle" + (p.enabled ? " is-enabled" : ""),
      attr: {
        role: "switch",
        "aria-checked": String(p.enabled),
        "aria-label": `${p.enabled ? "Disable" : "Enable"} ${p.name}`,
        tabindex: isSelf ? "-1" : "0",
        title: isSelf ? "Cannot disable manager from itself" : p.enabled ? "Disable" : "Enable"
      }
    });
    if (isSelf) toggle.addClass("is-locked");

    const doToggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isSelf) {
        new Notice("Plugin Manager cannot disable itself from this view.");
        return;
      }
      plugin.safe(() => plugin.togglePlugin(p), "toggle");
    };
    toggle.addEventListener("click", doToggle);
    toggle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") doToggle(e);
    });

    const meta = row.createDiv("pms-meta");
    meta.createSpan({ text: p.id, cls: "pms-id" });
    if (p.version) meta.createSpan({ text: `v${p.version}`, cls: "pms-version" });
    if (p.author) meta.createSpan({ text: `by ${p.author}`, cls: "pms-author" });

    if (p.description) {
      row.createDiv({ text: p.description, cls: "pms-desc" });
    }

    const acts = row.createDiv("pms-row-actions");

    if (p.isLocal && !p.isCore) {
      const hotBtn = this.iconButton(acts, "flame", "Hot Restart (.hotreload)", () =>
        plugin.toggleHotReload(p)
      );
      if (plugin.hasHotReloadFile(p.id)) hotBtn.addClass("is-hotreload-active");

      this.iconButton(acts, "folder", "Reveal in file explorer", () =>
        plugin.revealInExplorer(p.id)
      );
    }

    this.iconButton(acts, "file-pen-line", "Edit display name & description", () =>
      new ManifestEditModal(this.app, plugin, p, p.isLocal && !p.isCore).open()
    );

    const pin = this.iconButton(acts, "pin", isPinned ? "Unpin" : "Pin", () =>
      plugin.togglePin(p.id)
    );
    if (isPinned) pin.addClass("is-pinned");

    this.iconButton(acts, "settings", "Plugin settings", () =>
      plugin.openPluginSettings(p)
    );
    this.iconButton(acts, "more-horizontal", "More actions", (e) =>
      this.openMenu(p, e)
    );
  }

  openMenu(p, evt) {
    const plugin = this.plugin;
    const isSelf = p.id === plugin.manifest.id;
    const isPinned = plugin.settings.pinned.includes(p.id);
    const menu = new Menu();

    if (!isSelf) {
      menu.addItem((i) =>
        i
          .setTitle(p.enabled ? "Disable" : "Enable")
          .setIcon(p.enabled ? "toggle-left" : "toggle-right")
          .onClick(() => plugin.safe(() => plugin.togglePlugin(p), "toggle"))
      );
    }
    menu.addItem((i) =>
      i
        .setTitle(isPinned ? "Unpin" : "Pin")
        .setIcon("pin")
        .onClick(() => plugin.safe(() => plugin.togglePin(p.id), "pin"))
    );
    menu.addItem((i) =>
      i
        .setTitle("Edit display name")
        .setIcon("file-pen-line")
        .onClick(() => new ManifestEditModal(this.app, plugin, p, p.isLocal && !p.isCore).open())
    );

    if (p.isLocal && !p.isCore) {
      menu.addItem((i) =>
        i
          .setTitle("Reveal in Explorer")
          .setIcon("folder")
          .onClick(() => plugin.revealInExplorer(p.id))
      );
      menu.addItem((i) =>
        i
          .setTitle("Touch / Add .hotreload")
          .setIcon("flame")
          .onClick(() => plugin.toggleHotReload(p))
      );
    }

    menu.addItem((i) =>
      i
        .setTitle("Open settings")
        .setIcon("settings")
        .onClick(() => plugin.safe(() => plugin.openPluginSettings(p), "open settings"))
    );

    if (!isSelf && !p.isCore) {
      menu.addSeparator();
      menu.addItem((i) => {
        i.setTitle("Uninstall").setIcon("trash-2");
        if (typeof i.setWarning === "function") i.setWarning(true);
        i.onClick(() =>
          new ConfirmModal(
            plugin.app,
            `Uninstall "${p.name}"?`,
            "This will delete the plugin folder from your vault.",
            "Uninstall",
            () => plugin.uninstallPlugin(p)
          ).open()
        );
      });
    }
    menu.showAtMouseEvent(evt);
  }
}

/* ------------------------------------------------------------------ */
/* Settings Tab Component                                             */
/* ------------------------------------------------------------------ */

class PluginManagerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Plugin Manager Sidebar Settings" });

    new Setting(containerEl)
      .setName("Frosted Glassmorphism")
      .setDesc("Enable translucent glass panels, subtle border luminance, and Material 3 elevation.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.glassmorphism)
          .onChange(async (value) => {
            this.plugin.settings.glassmorphism = value;
            await this.plugin.saveSettings();
            this.plugin.applyThemePreferences();
          })
      );

    new Setting(containerEl)
      .setName("Default View Mode")
      .setDesc("Choose whether to display plugins grouped by status (Enabled/Disabled) or by custom groups.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("status", "Status Groups (Enabled / Disabled)")
          .addOption("group", "Custom Action Groups")
          .setValue(this.plugin.settings.view)
          .onChange(async (value) => {
            this.plugin.settings.view = value;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("Default Scope")
      .setDesc("Choose which plugins are listed by default when opening the manager.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("community", "Community Plugins Only")
          .addOption("core", "Core Built-in Plugins Only")
          .addOption("all", "All Plugins (Community + Core)")
          .setValue(this.plugin.settings.scope)
          .onChange(async (value) => {
            this.plugin.settings.scope = value;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("Default Sort Order")
      .setDesc("Choose how plugin cards are sorted in lists.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("status", "Enabled first, then Alphabetical")
          .addOption("alphabetical", "Pure Alphabetical (A-Z)")
          .setValue(this.plugin.settings.sortBy || "status")
          .onChange(async (value) => {
            this.plugin.settings.sortBy = value;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("Auto-check for Updates")
      .setDesc("Automatically check for Obsidian and community plugin updates when loading.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoCheckUpdates)
          .onChange(async (value) => {
            this.plugin.settings.autoCheckUpdates = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

/* ------------------------------------------------------------------ */
/* Plugin Entry Point                                                 */
/* ------------------------------------------------------------------ */

class PluginManagerSidebar extends Plugin {
  async onload() {
    this.settings = sanitizeSettings(null);
    this.busy = false;
    this.saveChain = Promise.resolve();
    this.officialIds = new Set();
    this.registryLoaded = false;
    this.hotReloadCache = new Set();

    try {
      this.settings = sanitizeSettings(await this.loadData());
    } catch (e) {
      logError("could not read saved settings", e);
    }

    this.applyThemePreferences();
    this.addSettingTab(new PluginManagerSettingTab(this.app, this));

    this.registerView(VIEW_TYPE, (leaf) => new PluginManagerView(leaf, this));
    this.addRibbonIcon("blocks", "Open Plugin Manager", () => {
      this.safe(() => this.activateView(), "open sidebar");
    });
    this.addCommand({
      id: "open-plugin-manager",
      name: "Open sidebar",
      callback: () => this.safe(() => this.activateView(), "open sidebar")
    });

    await this.fetchOfficialRegistry();
    await this.scanHotReloadFiles();
    if (this.settings.autoCheckUpdates) {
      this.checkOfficialUpdates();
    }

    log(`loaded v${this.manifest.version}`);
  }

  onunload() {
    document.body.removeClass("pms-glassmorphic");
    log("unloaded");
  }

  applyThemePreferences() {
    if (this.settings.glassmorphism) {
      document.body.addClass("pms-glassmorphic");
    } else {
      document.body.removeClass("pms-glassmorphic");
    }
  }

  safe(fn, context) {
    try {
      const r = fn();
      if (r && typeof r.catch === "function") {
        r.catch((e) => {
          logError(`error in "${context}"`, e);
          new Notice("Action failed. See console.");
        });
      }
    } catch (e) {
      logError(`error in "${context}"`, e);
      new Notice("Action failed. See console.");
    }
  }

  saveSettings() {
    this.saveChain = this.saveChain
      .then(() => this.saveData(this.settings))
      .catch((e) => logError("saving settings failed", e));
    return this.saveChain;
  }

  get pm() {
    return this.app.plugins;
  }

  communityEnabled() {
    const pm = this.pm;
    if (!pm) return false;
    return typeof pm.isEnabled === "function" ? !!pm.isEnabled() : true;
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof PluginManagerView) leaf.view.render();
    }
  }

  getObsidianVersion() {
    try {
      if (typeof window !== "undefined" && window.process && window.process.versions && window.process.versions.obsidian) {
        return window.process.versions.obsidian;
      }
    } catch (e) {}
    return obsidian.apiVersion || "1.0.0";
  }

  /* ---------- List Plugins (Core + Community) ---------- */

  getCorePluginMeta(id, pluginObj) {
    const manifest = pluginObj?.manifest || pluginObj?.instance?.manifest || {};
    const name =
      manifest.name ||
      pluginObj?.name ||
      pluginObj?.instance?.name ||
      id
        .split("-")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
    const description =
      manifest.description ||
      pluginObj?.description ||
      pluginObj?.instance?.description ||
      "Obsidian built-in core plugin";
    return { name, description };
  }

  listPlugins(scope = "all") {
    const results = [];
    const overrides = this.settings.overrides || {};

    if (scope === "community" || scope === "all") {
      const pm = this.pm;
      if (pm && pm.manifests) {
        const enabled = pm.enabledPlugins instanceof Set ? pm.enabledPlugins : new Set();
        for (const [id, m] of Object.entries(pm.manifests)) {
          const o = overrides[id] || {};
          const isOfficial = this.officialIds.has(id);
          results.push({
            id,
            name: o.name || (m && m.name) || id,
            description: o.description !== undefined ? o.description : ((m && m.description) || ""),
            version: (m && m.version) || "",
            author: o.author !== undefined ? o.author : ((m && m.author) || ""),
            enabled: enabled.has(id),
            isCore: false,
            isLocal: !isOfficial,
            isOfficial: isOfficial
          });
        }
      }
    }

    if (scope === "core" || scope === "all") {
      const internal = this.app.internalPlugins;
      if (internal && internal.plugins) {
        for (const [id, cp] of Object.entries(internal.plugins)) {
          const meta = this.getCorePluginMeta(id, cp);
          const o = overrides[id] || {};
          results.push({
            id,
            name: o.name || meta.name,
            description: o.description !== undefined ? o.description : meta.description,
            version: "",
            author: "Obsidian",
            enabled: !!cp.enabled,
            isCore: true,
            isLocal: false,
            isOfficial: false
          });
        }
      }
    }

    return results;
  }

  /* ---------- Hot Reload Handling ---------- */

  async scanHotReloadFiles() {
    try {
      for (const id of Object.keys(this.pm?.manifests || {})) {
        const path = `${this.app.vault.configDir}/plugins/${id}/.hotreload`;
        if (await this.app.vault.adapter.exists(path)) {
          this.hotReloadCache.add(id);
        }
      }
    } catch (e) {
      logError("error scanning .hotreload files", e);
    }
  }

  hasHotReloadFile(id) {
    return this.hotReloadCache.has(id);
  }

  async toggleHotReload(p) {
    const safeId = sanitizePluginId(p.id);
    if (!safeId) throw new Error("Invalid plugin ID");
    const path = `${this.app.vault.configDir}/plugins/${safeId}/.hotreload`;
    try {
      const exists = await this.app.vault.adapter.exists(path);
      if (!exists) {
        await this.app.vault.adapter.write(path, "");
        this.hotReloadCache.add(safeId);
        new Notice(`Added .hotreload to "${p.name}".`);
      } else {
        await this.app.vault.adapter.write(path, String(Date.now()));
        new Notice(`Touched .hotreload for "${p.name}". Reload triggered.`);
      }
      this.refreshViews();
    } catch (e) {
      logError("hot restart failed", e);
      new Notice(`Hot restart failed: ${errMsg(e)}`);
    }
  }

  /* ---------- Reveal in Explorer ---------- */

  revealInExplorer(id) {
    const safeId = sanitizePluginId(id);
    if (!safeId) return;
    try {
      const electron = require("electron");
      const path = require("path");
      const basePath = this.app.vault.adapter.basePath;
      if (basePath && electron?.shell?.openPath) {
        const full = path.join(basePath, this.app.vault.configDir, "plugins", safeId);
        electron.shell.openPath(full);
        return;
      }
    } catch (e) {}

    const rel = `${this.app.vault.configDir}/plugins/${safeId}`;
    if (typeof this.app.openWithDefaultApp === "function") {
      this.app.openWithDefaultApp(rel);
    } else if (typeof this.app.showInFolder === "function") {
      this.app.showInFolder(rel);
    } else {
      new Notice("System explorer not supported on this platform.");
    }
  }

  /* ---------- Manifest Modification on Disk ---------- */

  async saveLocalManifest(id, name, author, description) {
    const safeId = sanitizePluginId(id);
    if (!safeId) throw new Error("Invalid plugin ID");
    const manifestPath = `${this.app.vault.configDir}/plugins/${safeId}/manifest.json`;
    let rawObj = {};
    try {
      const text = await this.app.vault.adapter.read(manifestPath);
      rawObj = JSON.parse(text);
    } catch (e) {
      rawObj = this.pm?.manifests?.[safeId] || {};
    }

    rawObj.name = name;
    rawObj.author = author;
    rawObj.description = description;

    await this.app.vault.adapter.write(manifestPath, JSON.stringify(rawObj, null, 2));

    if (this.pm?.manifests && this.pm.manifests[safeId]) {
      Object.assign(this.pm.manifests[safeId], { name, author, description });
    }
    new Notice(`Updated manifest.json for "${name}".`);
  }

  /* ---------- Obsidian App Update Checker ---------- */

  async checkObsidianSoftwareUpdate() {
    new Notice("Checking for Obsidian software updates…");
    let latestVersion = null;

    try {
      const res = await requestUrl({ url: DESKTOP_RELEASES_URL, method: "GET" });
      if (res.status === 200 && res.json) {
        const data = res.json;
        if (typeof data.latestVersion === "string") {
          latestVersion = data.latestVersion;
        } else if (typeof data === "object") {
          const versions = Object.keys(data).filter((v) => /^\d+\.\d+\.\d+/.test(v));
          if (versions.length > 0) latestVersion = versions[versions.length - 1];
        }
      }
    } catch (e) {
      logError("error fetching desktop-releases.json", e);
    }

    if (!latestVersion) {
      try {
        const res = await requestUrl({
          url: "https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest",
          method: "GET"
        });
        if (res.status === 200 && res.json) {
          latestVersion = (res.json.tag_name || "").replace(/^v/, "");
        }
      } catch (e) {
        logError("error querying github api", e);
      }
    }

    const currentVersion = this.getObsidianVersion();
    if (!latestVersion) {
      new Notice("Could not check Obsidian updates. Please check network connection.");
      return;
    }

    const isOutdated = compareSemver(latestVersion, currentVersion) > 0;
    if (isOutdated) {
      new AppUpdateModal(this.app, currentVersion, latestVersion, OBSIDIAN_DOWNLOAD_URL).open();
    } else {
      new Notice(`Obsidian is up to date! (v${currentVersion})`);
    }
  }

  /* ---------- Community Plugins Store Browser ---------- */

  openCommunityBrowser() {
    if (!this.communityEnabled()) {
      new Notice("Restricted Mode is active. Enable community plugins in settings first.");
      if (this.app.setting) {
        this.app.setting.open();
        this.app.setting.openTabById("community-plugins");
      }
      return;
    }

    const commands = this.app.commands?.commands || {};
    const browseCmd = Object.values(commands).find(
      (c) =>
        c.id.includes("community-plugins") &&
        (c.id.includes("browse") || c.name.toLowerCase().includes("browse"))
    );
    if (browseCmd) {
      this.app.commands.executeCommandById(browseCmd.id);
      return;
    }

    if (this.app.setting) {
      this.app.setting.open();
      this.app.setting.openTabById("community-plugins");
      window.setTimeout(() => {
        const tab = this.app.setting.activeTab;
        if (tab?.containerEl) {
          const btns = Array.from(tab.containerEl.querySelectorAll("button"));
          const browseBtn = btns.find(
            (b) => b.textContent && b.textContent.toLowerCase().includes("browse")
          );
          if (browseBtn) browseBtn.click();
        }
      }, 70);
    }
  }

  /* ---------- Community Plugin Update Checking ---------- */

  async fetchOfficialRegistry() {
    try {
      const res = await requestUrl({ url: COMMUNITY_REGISTRY_URL, method: "GET" });
      if (res.status === 200 && Array.isArray(res.json)) {
        this.officialIds = new Set(res.json.map((x) => x.id));
        this.registryLoaded = true;
      }
    } catch (e) {
      logError("offline or unable to fetch registry", e);
    }
  }

  async checkOfficialUpdates() {
    if (!this.communityEnabled()) return;
    try {
      if (typeof this.pm?.checkForUpdates === "function") {
        await this.pm.checkForUpdates();
        this.refreshViews();
        const count = this.getAvailableUpdatesCount();
        if (count > 0) new Notice(`${count} plugin updates available!`);
      }
    } catch (e) {
      logError("checking updates failed", e);
    }
  }

  getAvailableUpdates() {
    const updatesObj = this.pm?.updates || {};
    const manifests = this.pm?.manifests || {};
    const result = [];

    for (const [id, up] of Object.entries(updatesObj)) {
      const m = manifests[id];
      result.push({
        id,
        name: m?.name || id,
        currentVersion: m?.version || "0.0.0",
        newVersion: up.version,
        repo: up.repo,
        manifest: up.manifest
      });
    }
    return result;
  }

  getAvailableUpdatesCount() {
    return Object.keys(this.pm?.updates || {}).length;
  }

  async updateSinglePlugin(id) {
    const up = this.pm?.updates?.[id];
    if (!up) return;

    await this.exclusive(`update "${id}"`, async () => {
      new Notice(`Updating ${id} to v${up.version}…`);
      await this.pm.installPlugin(up.repo, up.version, up.manifest);
      delete this.pm.updates[id];
      new Notice(`Updated ${id} successfully!`);
    });
  }

  async updateAllPlugins() {
    const updates = this.getAvailableUpdates();
    if (updates.length === 0) {
      new Notice("All plugins are up to date.");
      return;
    }

    await this.exclusive("update all plugins", async () => {
      let count = 0;
      for (const item of updates) {
        try {
          await this.pm.installPlugin(item.repo, item.newVersion, item.manifest);
          delete this.pm.updates[item.id];
          count++;
        } catch (e) {
          logError(`failed updating ${item.id}`, e);
        }
        await sleep(40);
      }
      new Notice(`Updated ${count} plugins.`);
    });
  }

  /* ---------- Core State Actions ---------- */

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0] || null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    if (typeof workspace.revealLeaf === "function") await workspace.revealLeaf(leaf);
    else workspace.setActiveLeaf(leaf, { focus: true });
  }

  async exclusive(label, fn) {
    if (this.busy) {
      new Notice("Plugin Manager is busy processing previous action.");
      return;
    }
    this.busy = true;
    try {
      await fn();
    } catch (e) {
      logError(`FAILED: ${label}`, e);
      new Notice(`Plugin Manager: ${errMsg(e)}`, 6000);
    } finally {
      this.busy = false;
      this.refreshViews();
    }
  }

  async applyEnabled(id, want) {
    const pm = this.pm;
    if (!pm || !pm.enabledPlugins) throw new Error("Plugin manager core is unavailable.");
    const isOn = () => pm.enabledPlugins.has(id);
    if (isOn() === want) return;
    if (!pm.manifests || !pm.manifests[id]) throw new Error(`Plugin "${id}" not found.`);

    if (want) {
      if (typeof pm.enablePluginAndSave === "function") {
        await pm.enablePluginAndSave(id);
      } else if (typeof pm.enablePlugin === "function") {
        await pm.enablePlugin(id);
        if (typeof pm.saveConfig === "function") await pm.saveConfig();
      }
    } else {
      if (typeof pm.disablePluginAndSave === "function") {
        await pm.disablePluginAndSave(id);
      } else if (typeof pm.disablePlugin === "function") {
        await pm.disablePlugin(id);
        if (typeof pm.saveConfig === "function") await pm.saveConfig();
      }
    }

    if (isOn() !== want) {
      throw new Error(want ? `"${id}" failed to load.` : `"${id}" did not stop.`);
    }
  }

  async toggleCorePlugin(id, want) {
    const internal = this.app.internalPlugins;
    if (!internal) throw new Error("Obsidian core plugin manager unavailable.");
    const p = internal.getPluginById ? internal.getPluginById(id) : internal.plugins?.[id];
    if (!p) throw new Error(`Core plugin "${id}" not found.`);

    if (want) {
      if (typeof p.setEnabled === "function") await p.setEnabled(true);
      else if (typeof p.enable === "function") await p.enable();
      else p.enabled = true;
    } else {
      if (typeof p.setEnabled === "function") await p.setEnabled(false);
      else if (typeof p.disable === "function") await p.disable();
      else p.enabled = false;
    }
  }

  togglePlugin(p) {
    const want = !p.enabled;
    const label = `${want ? "enable" : "disable"} "${p.name}"`;
    return this.exclusive(label, async () => {
      if (p.isCore) {
        await this.toggleCorePlugin(p.id, want);
      } else {
        await this.applyEnabled(p.id, want);
      }
      new Notice(`${p.name} ${want ? "enabled" : "disabled"}.`);
    });
  }

  bulkGroup(group, want) {
    const selfId = this.manifest.id;
    const all = this.listPlugins("all");
    const byId = new Map(all.map((p) => [p.id, p]));

    const todo = group.plugins
      .filter((id) => id !== selfId)
      .map((id) => byId.get(id))
      .filter((p) => p && p.enabled !== want);

    if (todo.length === 0) {
      new Notice(`All plugins in "${group.name}" already ${want ? "enabled" : "disabled"}.`);
      return Promise.resolve();
    }

    return this.exclusive(`${want ? "enable" : "disable"} group "${group.name}"`, async () => {
      let ok = 0;
      for (const p of todo) {
        try {
          if (p.isCore) {
            await this.toggleCorePlugin(p.id, want);
          } else {
            await this.applyEnabled(p.id, want);
          }
          ok++;
        } catch (e) {
          logError(`could not toggle "${p.id}" in group`, e);
        }
        await sleep(60);
      }
      new Notice(`${want ? "Enabled" : "Disabled"} ${ok} plugins in "${group.name}".`);
    });
  }

  uninstallPlugin(p) {
    return this.exclusive(`uninstall "${p.name}"`, async () => {
      if (p.isCore) throw new Error("Cannot uninstall built-in core plugins.");
      const pm = this.pm;
      if (p.id === this.manifest.id) throw new Error("Cannot uninstall self.");
      await pm.uninstallPlugin(p.id);
      this.settings.pinned = this.settings.pinned.filter((id) => id !== p.id);
      for (const g of this.settings.groups) g.plugins = g.plugins.filter((id) => id !== p.id);
      await this.saveSettings();
      new Notice(`"${p.name}" uninstalled.`);
    });
  }

  openPluginSettings(p) {
    const setting = this.app.setting;
    if (!setting) return;
    try {
      if (!p.enabled) {
        new Notice(`Enable "${p.name}" first to access settings.`);
        return;
      }

      if (p.isCore) {
        const coreTabId = p.id;
        const exists = setting.settingTabs?.some((t) => t.id === coreTabId) ||
                       setting.pluginTabs?.some((t) => t.id === coreTabId);
        if (typeof setting.open === "function") setting.open();
        if (exists && typeof setting.openTabById === "function") {
          setting.openTabById(coreTabId);
        } else {
          new Notice(`"${p.name}" does not have configurable settings.`);
        }
        return;
      }

      if (typeof setting.open === "function") setting.open();
      if (typeof setting.openTabById === "function") {
        const found = setting.settingTabs?.some((t) => t.id === p.id) ||
                      setting.pluginTabs?.some((t) => t.id === p.id);
        if (found) {
          setting.openTabById(p.id);
        } else {
          new Notice(`"${p.name}" has no registered settings tab.`);
        }
      }
    } catch (e) {
      logError(`could not open settings for "${p.id}"`, e);
    }
  }

  togglePin(id) {
    const pinned = this.settings.pinned;
    const idx = pinned.indexOf(id);
    if (idx >= 0) pinned.splice(idx, 1);
    else pinned.push(id);
    void this.saveSettings();
    this.refreshViews();
  }

  openGroupEditor(group) {
    const selfId = this.manifest.id;
    const choices = this.listPlugins("all")
      .filter((p) => p.id !== selfId)
      .sort(byName);

    new GroupModal(
      this.app,
      choices,
      group,
      async (name, ids) => {
        if (group) {
          group.name = name;
          const installed = new Set(choices.map((c) => c.id));
          const missing = group.plugins.filter((id) => !installed.has(id));
          group.plugins = unique([...ids, ...missing]);
        } else {
          this.settings.groups.push({ id: newId(), name, plugins: unique(ids) });
        }
        await this.saveSettings();
        this.refreshViews();
      },
      () => {
        if (!group) return;
        new ConfirmModal(
          this.app,
          `Delete "${group.name}"?`,
          "Removes group classification only. Plugins will not be uninstalled.",
          "Delete Group",
          async () => {
            this.settings.groups = this.settings.groups.filter((g) => g.id !== group.id);
            await this.saveSettings();
            this.refreshViews();
          }
        ).open();
      }
    ).open();
  }
}

module.exports = PluginManagerSidebar;