import { ItemView, Menu, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import type PluginManagerSidebar from "../main";
import { ConfirmModal } from "../modals/confirm-modal";
import { ManifestEditModal } from "../modals/manifest-edit-modal";
import type {
	ManagedPlugin,
	PluginGroup,
	PluginScope,
	PluginUpdateInfo,
	SourceFilter,
	StateFilter,
} from "../types";
import { VIEW_TYPE, byEnabledThenName, byName, logError } from "../utils/format";

const SCOPE_ORDER: PluginScope[] = ["community", "core", "all"];
const SCOPE_LABELS: Record<PluginScope, string> = {
	community: "Scope: Community",
	core: "Scope: Core",
	all: "Scope: All",
};
const SOURCE_ORDER: SourceFilter[] = ["all", "official", "local"];
const SOURCE_LABELS: Record<SourceFilter, string> = {
	all: "Source: All",
	official: "Source: Official",
	local: "Source: Local",
};
const STATE_ORDER: StateFilter[] = ["all", "enabled", "disabled"];
const STATE_LABELS: Record<StateFilter, string> = {
	all: "State: All",
	enabled: "State: Enabled",
	disabled: "State: Disabled",
};

export class PluginManagerView extends ItemView {
	private query = "";
	private bodyEl: HTMLElement | null = null;
	private searchTimeout: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: PluginManagerSidebar,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Plugin Manager";
	}

	getIcon(): string {
		return "blocks";
	}

	async onOpen(): Promise<void> {
		this.render();
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf === this.leaf) this.renderList();
			}),
		);
		this.registerDomEvent(window, "focus", () => this.renderList());
	}

	async onClose(): Promise<void> {
		if (this.searchTimeout !== null) {
			window.clearTimeout(this.searchTimeout);
			this.searchTimeout = null;
		}
		this.contentEl.empty();
	}

	render(): void {
		const root = this.contentEl;
		const scrollTop = root.scrollTop;
		root.empty();
		root.addClass("pms-view");

		const header = root.createDiv("pms-header");
		const top = header.createDiv("pms-top");
		const searchWrap = top.createDiv("pms-search-wrap");
		const input = searchWrap.createEl("input", {
			type: "search",
			placeholder: "Search plugins…",
			cls: "pms-search-input",
			attr: { "aria-label": "Search installed and core plugins" },
		});
		input.value = this.query;
		input.addEventListener("input", () => {
			this.query = input.value;
			if (this.searchTimeout !== null) window.clearTimeout(this.searchTimeout);
			this.searchTimeout = window.setTimeout(() => {
				this.renderList();
			}, 150);
		});
		input.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				input.value = "";
				this.query = "";
				if (this.searchTimeout !== null) window.clearTimeout(this.searchTimeout);
				this.renderList();
			}
		});

		const topActions = top.createDiv("pms-top-actions");
		const updateCount = this.plugin.getAvailableUpdatesCount();

		this.iconButton(topActions, "compass", "Browse community plugins", () =>
			this.plugin.openCommunityBrowser(),
		);
		this.iconButton(topActions, "arrow-up-circle", "Check Obsidian software updates", () =>
			void this.plugin.checkObsidianSoftwareUpdate(),
		);

		const updateCheckBtn = this.iconButton(
			topActions,
			"download-cloud",
			updateCount > 0 ? `${updateCount} updates available!` : "Check for plugin updates",
			() => void this.plugin.checkOfficialUpdates(),
		);
		if (updateCount > 0) updateCheckBtn.addClass("is-update-highlight");

		if (this.plugin.settings.view === "group") {
			this.iconButton(topActions, "plus", "Create new group", () =>
				this.plugin.openGroupEditor(null),
			);
		}

		this.iconButton(topActions, "refresh-cw", "Refresh list", () => {
			void (async (): Promise<void> => {
				await this.plugin.fetchOfficialRegistry();
				this.renderList();
			})();
		});

		const settings = this.plugin.settings;

		const structureRow = header.createDiv("pms-control-row pms-structure-row");

		const scopeBtn = structureRow.createEl("button", {
			cls: `pms-chip ${settings.scope !== "community" ? "is-active" : ""}`,
			attr: { type: "button", title: "Click to cycle: Community → Core → All" },
		});
		scopeBtn.createSpan({ text: SCOPE_LABELS[settings.scope] });
		scopeBtn.addEventListener("click", () => {
			const index = SCOPE_ORDER.indexOf(settings.scope);
			settings.scope = SCOPE_ORDER[(index + 1) % SCOPE_ORDER.length] ?? "community";
			void this.plugin.saveSettings();
			this.render();
		});

		const viewBtn = structureRow.createEl("button", {
			cls: `pms-chip ${settings.view === "group" ? "is-active" : ""}`,
			attr: { type: "button", title: "Click to toggle: Status ↔ Groups" },
		});
		viewBtn.createSpan({
			text: settings.view === "group" ? "View: Groups" : "View: Status",
		});
		viewBtn.addEventListener("click", () => {
			settings.view = settings.view === "status" ? "group" : "status";
			void this.plugin.saveSettings();
			this.render();
		});

		if (settings.view === "group") {
			const groupSelect = structureRow.createEl("select", {
				cls: "pms-group-select",
				attr: { title: "Filter by group" },
			});

			const option = (label: string, value: string): HTMLOptionElement => {
				const opt = groupSelect.createEl("option");
				opt.value = value;
				opt.text = label;
				return opt;
			};
			const allOption = option("All Groups", "all");
			if (settings.selectedGroup === "all") allOption.selected = true;
			for (const group of settings.groups) {
				const opt = option(group.name, group.id);
				if (settings.selectedGroup === group.id) opt.selected = true;
			}
			const ungrouped = option("Ungrouped", "_ungrouped");
			if (settings.selectedGroup === "_ungrouped") ungrouped.selected = true;

			groupSelect.addEventListener("change", () => {
				settings.selectedGroup = groupSelect.value;
				void this.plugin.saveSettings();
				this.renderList();
			});
		}

		const criteriaRow = header.createDiv("pms-control-row pms-criteria-row");

		if (settings.scope !== "core") {
			let sourceCls = "pms-chip";
			if (settings.sourceFilter === "official") sourceCls += " is-source-official";
			else if (settings.sourceFilter === "local") sourceCls += " is-source-local";

			const sourceBtn = criteriaRow.createEl("button", {
				cls: sourceCls,
				attr: { type: "button", title: "Click to cycle: All Sources → Official → Local" },
			});
			sourceBtn.createSpan({ text: SOURCE_LABELS[settings.sourceFilter] });
			sourceBtn.addEventListener("click", () => {
				const index = SOURCE_ORDER.indexOf(settings.sourceFilter);
				settings.sourceFilter =
					SOURCE_ORDER[(index + 1) % SOURCE_ORDER.length] ?? "all";
				void this.plugin.saveSettings();
				this.render();
			});
		}

		let stateCls = "pms-chip";
		if (settings.stateFilter === "enabled") stateCls += " is-active";
		else if (settings.stateFilter === "disabled") stateCls += " is-state-disabled";

		const stateBtn = criteriaRow.createEl("button", {
			cls: stateCls,
			attr: { type: "button", title: "Click to cycle: All States → Enabled → Disabled" },
		});
		stateBtn.createSpan({ text: STATE_LABELS[settings.stateFilter] });
		stateBtn.addEventListener("click", () => {
			const index = STATE_ORDER.indexOf(settings.stateFilter);
			settings.stateFilter = STATE_ORDER[(index + 1) % STATE_ORDER.length] ?? "all";
			void this.plugin.saveSettings();
			this.render();
		});

		const pinnedBtn = criteriaRow.createEl("button", {
			cls: `pms-chip ${settings.pinnedOnly ? "is-active" : ""}`,
			attr: { type: "button", title: "Click to toggle pinned filter" },
		});
		pinnedBtn.createSpan({ text: "Pinned" });
		pinnedBtn.addEventListener("click", () => {
			settings.pinnedOnly = !settings.pinnedOnly;
			void this.plugin.saveSettings();
			this.render();
		});

		const sortBtn = criteriaRow.createEl("button", {
			cls: `pms-chip ${settings.sortBy === "alphabetical" ? "is-active" : ""}`,
			attr: {
				type: "button",
				title: "Click to cycle sort: Status (Enabled first) ↔ Alphabetical (A-Z)",
			},
		});
		sortBtn.createSpan({
			text: settings.sortBy === "alphabetical" ? "Sort: A-Z" : "Sort: Status",
		});
		sortBtn.addEventListener("click", () => {
			settings.sortBy = settings.sortBy === "alphabetical" ? "status" : "alphabetical";
			void this.plugin.saveSettings();
			this.render();
		});

		if (settings.scope !== "core") {
			const updateBtn = criteriaRow.createEl("button", {
				cls: `pms-chip ${settings.updatesOnly ? "is-active" : ""}`,
				attr: { type: "button", title: "Click to toggle updates filter" },
			});
			updateBtn.createSpan({ text: "Updates" });
			if (updateCount > 0) {
				updateBtn.createSpan({ text: String(updateCount), cls: "pms-chip-badge" });
				updateBtn.addClass("is-update-chip");
			}
			updateBtn.addEventListener("click", () => {
				settings.updatesOnly = !settings.updatesOnly;
				void this.plugin.saveSettings();
				this.render();
			});
		}

		const isFiltered =
			(settings.scope !== "core" && settings.sourceFilter !== "all") ||
			settings.stateFilter !== "all" ||
			settings.pinnedOnly ||
			settings.updatesOnly;

		if (isFiltered) {
			const resetBtn = criteriaRow.createEl("button", {
				cls: "pms-chip pms-chip-reset",
				attr: { type: "button", title: "Reset all active filters" },
			});
			resetBtn.createSpan({ text: "✕ Reset" });
			resetBtn.addEventListener("click", () => {
				settings.sourceFilter = "all";
				settings.stateFilter = "all";
				settings.pinnedOnly = false;
				settings.updatesOnly = false;
				void this.plugin.saveSettings();
				this.render();
			});
		}

		this.bodyEl = root.createDiv("pms-body");
		this.renderList();
		root.scrollTop = scrollTop;
	}

	iconButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		callback: (event: MouseEvent) => void,
	): HTMLButtonElement {
		const button = parent.createEl("button", {
			cls: "clickable-icon pms-icon-btn",
			attr: { "aria-label": label, title: label, type: "button" },
		});
		setIcon(button, icon);
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			this.plugin.safe(() => callback(event), label);
		});
		return button;
	}

	renderList(): void {
		if (!this.bodyEl) return;
		const scroller = this.contentEl;
		const scrollTop = scroller.scrollTop;
		this.bodyEl.empty();

		try {
			this.buildList();
		} catch (error) {
			logError("could not draw plugin list", error);
			this.bodyEl.createDiv({
				text: "Could not draw the list. Details logged to console.",
				cls: "pms-empty-text",
			});
		}
		scroller.scrollTop = scrollTop;
	}

	private buildList(): void {
		const body = this.bodyEl;
		if (!body) return;
		const settings = this.plugin.settings;
		const all = this.plugin.listPlugins(settings.scope);

		if (settings.scope !== "core" && !this.plugin.communityEnabled()) {
			body.createDiv({
				text: "Restricted Mode is active. Community plugins are currently disabled in Obsidian settings.",
				cls: "pms-banner",
			});
		}

		if (all.length === 0) {
			body.createDiv({ text: "No plugins found in this view.", cls: "pms-empty" });
			return;
		}

		const updates = this.plugin.getAvailableUpdates();
		const updateCount = updates.length;

		const enabledCount = all.filter((plugin) => plugin.enabled).length;
		const disabledCount = all.length - enabledCount;
		const statsBar = body.createDiv("pms-stats-bar");
		statsBar.createSpan({ text: `Total: ${all.length}`, cls: "pms-stat-pill" });
		statsBar.createSpan({
			text: `Active: ${enabledCount}`,
			cls: "pms-stat-pill is-active",
		});
		statsBar.createSpan({
			text: `Inactive: ${disabledCount}`,
			cls: "pms-stat-pill is-inactive",
		});
		if (updateCount > 0) {
			statsBar.createSpan({
				text: `Updates: ${updateCount}`,
				cls: "pms-stat-pill is-update",
			});
		}

		if (
			settings.scope !== "core" &&
			updateCount > 0 &&
			(!settings.stateFilter ||
				settings.stateFilter === "all" ||
				settings.stateFilter === "enabled") &&
			(!settings.sourceFilter ||
				settings.sourceFilter === "all" ||
				settings.sourceFilter === "official")
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
				attr: { type: "button" },
			});
			upAllBtn.addEventListener("click", () => void this.plugin.updateAllPlugins());

			const upList = upSec.createDiv("pms-section-list");
			for (const item of updates) {
				this.addUpdateRow(upList, item);
			}
		}

		const query = this.query.trim().toLowerCase();
		const byId = new Map(all.map((plugin) => [plugin.id, plugin]));
		const sortFn = settings.sortBy === "alphabetical" ? byName : byEnabledThenName;

		const filtered = all
			.filter((plugin) => {
				const matchesSearch =
					!query ||
					plugin.name.toLowerCase().includes(query) ||
					plugin.id.toLowerCase().includes(query) ||
					plugin.description.toLowerCase().includes(query) ||
					plugin.author.toLowerCase().includes(query);
				if (!matchesSearch) return false;

				if (settings.sourceFilter === "official" && (plugin.isCore || !plugin.isOfficial)) {
					return false;
				}
				if (settings.sourceFilter === "local" && (plugin.isCore || !plugin.isLocal)) {
					return false;
				}
				if (settings.stateFilter === "enabled" && !plugin.enabled) return false;
				if (settings.stateFilter === "disabled" && plugin.enabled) return false;
				if (settings.pinnedOnly && !settings.pinned.includes(plugin.id)) return false;
				if (
					settings.updatesOnly &&
					(!this.plugin.getUpdatesRecord(plugin.id) || plugin.isCore)
				) {
					return false;
				}
				return true;
			})
			.sort(sortFn);

		const pinnedSet = new Set(settings.pinned);
		const pinned = settings.pinned
			.map((id) => byId.get(id))
			.filter((plugin): plugin is ManagedPlugin => plugin !== undefined)
			.filter((plugin) => filtered.includes(plugin))
			.sort(sortFn);

		let shown = 0;

		if (pinned.length > 0 && !settings.pinnedOnly) {
			this.addSection("Pinned", pinned);
			shown += pinned.length;
		}

		if (settings.view === "group") {
			const grouped = new Set<string>();
			const selected = settings.selectedGroup || "all";

			for (const group of settings.groups) {
				for (const id of group.plugins) grouped.add(id);

				if (selected !== "all" && selected !== group.id) continue;

				const members = group.plugins
					.map((id) => byId.get(id))
					.filter((plugin): plugin is ManagedPlugin => plugin !== undefined)
					.filter((plugin) => filtered.includes(plugin))
					.sort(sortFn);

				if (members.length > 0) {
					this.addSection(group.name, members, {
						group,
						total: members.length,
					});
					shown += members.length;
				}
			}

			if (selected === "all" || selected === "_ungrouped") {
				const ungrouped = filtered
					.filter(
						(plugin) =>
							!grouped.has(plugin.id) &&
							(settings.pinnedOnly || !pinnedSet.has(plugin.id)),
					)
					.sort(sortFn);

				if (ungrouped.length > 0) {
					this.addSection("Other Plugins", ungrouped);
					shown += ungrouped.length;
				}
			}
		} else {
			const rest = filtered.filter(
				(plugin) => settings.pinnedOnly || !pinnedSet.has(plugin.id),
			);
			if (settings.sortBy === "alphabetical" && settings.stateFilter === "all") {
				if (rest.length > 0) this.addSection("All Plugins (A-Z)", rest);
				shown += rest.length;
			} else {
				const enabled = rest.filter((plugin) => plugin.enabled);
				const disabled = rest.filter((plugin) => !plugin.enabled);

				if (enabled.length > 0) this.addSection("Enabled", enabled);
				if (disabled.length > 0) this.addSection("Disabled", disabled);
				shown += rest.length;
			}
		}

		if (shown === 0 && updateCount === 0) {
			body.createDiv({ text: "No matching plugins found.", cls: "pms-empty" });
		}
	}

	private addSection(
		title: string,
		plugins: ManagedPlugin[],
		options?: { group?: PluginGroup; total?: number },
	): void {
		const body = this.bodyEl;
		if (!body) return;
		const section = body.createDiv("pms-section");
		const head = section.createDiv("pms-section-header");
		const left = head.createDiv("pms-section-left");
		left.createSpan({ text: title, cls: "pms-section-title" });
		left.createSpan({
			text: String(options?.total ?? plugins.length),
			cls: "pms-section-count",
		});

		if (options?.group) {
			const group = options.group;
			const right = head.createDiv("pms-section-actions");
			const mini = (text: string, label: string, callback: () => void): void => {
				const button = right.createEl("button", {
					text,
					cls: "pms-mini-btn",
					attr: { type: "button", "aria-label": label },
				});
				button.addEventListener("click", () =>
					this.plugin.safe(callback, label),
				);
			};
			mini("Enable All", `Enable all in "${group.name}"`, () =>
				void this.plugin.bulkGroup(group, true),
			);
			mini("Disable All", `Disable all in "${group.name}"`, () =>
				void this.plugin.bulkGroup(group, false),
			);
			this.iconButton(right, "pencil", "Edit group", () =>
				this.plugin.openGroupEditor(group),
			);
		}

		const list = section.createDiv("pms-section-list");
		for (const plugin of plugins) this.addRow(list, plugin);
	}

	private addUpdateRow(parent: HTMLElement, item: PluginUpdateInfo): void {
		const row = parent.createDiv("pms-item pms-update-item");
		const line = row.createDiv("pms-line1");

		const info = line.createDiv("pms-name-wrap");
		info.createSpan({ text: item.name, cls: "pms-name" });
		info
			.createSpan({ cls: "pms-version-diff" })
			.setText(`v${item.currentVersion} → v${item.newVersion}`);

		const actions = line.createDiv("pms-row-actions");
		const updateBtn = actions.createEl("button", {
			text: "Update",
			cls: "pms-mini-btn mod-cta",
		});
		updateBtn.addEventListener("click", () => void this.plugin.updateSinglePlugin(item.id));
	}

	private addRow(parent: HTMLElement, plugin: ManagedPlugin): void {
		const manager = this.plugin;
		const isSelf = plugin.id === manager.manifest.id;
		const isPinned = manager.settings.pinned.includes(plugin.id);

		const row = parent.createDiv("pms-item" + (plugin.enabled ? "" : " is-disabled"));
		row.dataset.pluginId = plugin.id;
		row.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			this.openMenu(plugin, event);
		});

		const line1 = row.createDiv("pms-line1");
		const nameWrap = line1.createDiv("pms-name-wrap");			nameWrap.createSpan({ text: plugin.name, cls: "pms-name" });
		if (isSelf) nameWrap.createSpan({ text: "Self", cls: "pms-tag" });

		const line1Right = line1.createDiv("pms-line1-right");

		if (plugin.isCore) {
			line1Right.createSpan({ text: "Core", cls: "pms-source-badge is-core" });
		} else if (manager.registryLoaded) {
			line1Right.createSpan({
				text: plugin.isLocal ? "Local" : "Official",
				cls: "pms-source-badge " + (plugin.isLocal ? "is-manual" : "is-official"),
			});
		}

		const toggle = line1Right.createDiv({
			cls: "pms-toggle" + (plugin.enabled ? " is-enabled" : ""),
			attr: {
				role: "switch",
				"aria-checked": String(plugin.enabled),
				"aria-label": `${plugin.enabled ? "Disable" : "Enable"} ${plugin.name}`,
				tabindex: isSelf ? "-1" : "0",
				title: isSelf
					? "Cannot disable manager from itself"
					: plugin.enabled
						? "Disable"
						: "Enable",
			},
		});
		if (isSelf) toggle.addClass("is-locked");

		const doToggle = (event: Event): void => {
			event.preventDefault();
			event.stopPropagation();
			if (isSelf) {
				new Notice("Plugin Manager cannot disable itself from this view.");
				return;
			}
			manager.safe(() => manager.togglePlugin(plugin), "toggle");
		};
		toggle.addEventListener("click", doToggle);
		toggle.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") doToggle(event);
		});

		const meta = row.createDiv("pms-meta");
		meta.createSpan({ text: plugin.id, cls: "pms-id" });
		if (plugin.version) {
			meta.createSpan({ text: `v${plugin.version}`, cls: "pms-version" });
		}
		if (plugin.author) {
			meta.createSpan({ text: `by ${plugin.author}`, cls: "pms-author" });
		}

		if (plugin.description) {
			row.createDiv({ text: plugin.description, cls: "pms-desc" });
		}

		const actions = row.createDiv("pms-row-actions");

		if (plugin.isLocal && !plugin.isCore) {
			const hotBtn = this.iconButton(actions, "flame", "Hot Restart (.hotreload)", () =>
				manager.safe(() => manager.toggleHotReload(plugin), "hot reload"),
			);
			if (manager.hasHotReloadFile(plugin.id)) hotBtn.addClass("is-hotreload-active");

			this.iconButton(actions, "folder", "Reveal in file explorer", () =>
				manager.revealInExplorer(plugin.id),
			);
		}

		this.iconButton(actions, "file-pen-line", "Edit display name & description", () =>
			new ManifestEditModal(
				this.app,
				manager,
				plugin,
				plugin.isLocal && !plugin.isCore,
			).open(),
		);

		const pin = this.iconButton(actions, "pin", isPinned ? "Unpin" : "Pin", () =>
			manager.togglePin(plugin.id),
		);
		if (isPinned) pin.addClass("is-pinned");

		this.iconButton(actions, "settings", "Plugin settings", () =>
			manager.openPluginSettings(plugin),
		);
		this.iconButton(actions, "more-horizontal", "More actions", (event) =>
			this.openMenu(plugin, event),
		);
	}

	private openMenu(plugin: ManagedPlugin, event: MouseEvent): void {
		const manager = this.plugin;
		const isSelf = plugin.id === manager.manifest.id;
		const isPinned = manager.settings.pinned.includes(plugin.id);
		const menu = new Menu();

		if (!isSelf) {
			menu.addItem((item) =>
				item
					.setTitle(plugin.enabled ? "Disable" : "Enable")
					.setIcon(plugin.enabled ? "toggle-left" : "toggle-right")
					.onClick(() => manager.safe(() => manager.togglePlugin(plugin), "toggle")),
			);
		}
		menu.addItem((item) =>
			item
				.setTitle(isPinned ? "Unpin" : "Pin")
				.setIcon("pin")
				.onClick(() => manager.safe(() => manager.togglePin(plugin.id), "pin")),
		);
		menu.addItem((item) =>
			item
				.setTitle("Edit display name")
				.setIcon("file-pen-line")
				.onClick(() =>
					new ManifestEditModal(
						this.app,
						manager,
						plugin,
						plugin.isLocal && !plugin.isCore,
					).open(),
				),
		);

		if (plugin.isLocal && !plugin.isCore) {
			menu.addItem((item) =>
				item
					.setTitle("Reveal in Explorer")
					.setIcon("folder")
					.onClick(() => manager.revealInExplorer(plugin.id)),
			);
			menu.addItem((item) =>
				item
					.setTitle("Touch / Add .hotreload")
					.setIcon("flame")
					.onClick(() =>
						manager.safe(() => manager.toggleHotReload(plugin), "hot reload"),
					),
			);
		}

		menu.addItem((item) =>
			item
				.setTitle("Open settings")
				.setIcon("settings")
				.onClick(() => manager.safe(() => manager.openPluginSettings(plugin), "open settings")),
		);

		if (!isSelf && !plugin.isCore) {
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle("Uninstall").setIcon("trash-2");
				if (typeof item.setWarning === "function") item.setWarning(true);
				item.onClick(() =>
					new ConfirmModal(
						manager.app,
						`Uninstall "${plugin.name}"?`,
						"This will delete the plugin folder from your vault.",
						"Uninstall",
						() => manager.uninstallPlugin(plugin),
					).open(),
				);
			});
		}
		menu.showAtMouseEvent(event);
	}
}
