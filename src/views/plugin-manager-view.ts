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
import { VIEW_TYPE, logError } from "../utils/format";
import { filterAndBucketPlugins } from "./plugin-filter";

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
	private searchInputEl: HTMLInputElement | null = null;
	private searchClearEl: HTMLButtonElement | null = null;
	private topActionsEl: HTMLElement | null = null;
	private controlsEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private searchTimeout: number | null = null;
	private lastRenderSignature = "";

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
		return "Plugin manager";
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
		this.registerDomEvent(window, "focus", () => {
			if (this.computeSignature() !== this.lastRenderSignature) {
				this.renderList();
			}
		});
	}

	async onClose(): Promise<void> {
		if (this.searchTimeout !== null) {
			window.clearTimeout(this.searchTimeout);
			this.searchTimeout = null;
		}
		this.searchInputEl = null;
		this.searchClearEl = null;
		this.topActionsEl = null;
		this.controlsEl = null;
		this.bodyEl = null;
		this.contentEl.empty();
	}

	render(): void {
		const root = this.contentEl;
		const scrollTop = this.bodyEl?.scrollTop ?? 0;

		if (!this.bodyEl || !this.controlsEl || !this.topActionsEl) {
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
			const clearBtn = searchWrap.createEl("button", {
				cls: "pms-search-clear",
				attr: { type: "button", "aria-label": "Clear search", title: "Clear search" },
			});
			setIcon(clearBtn, "x");
			const syncClear = (): void => {
				clearBtn.toggleClass("is-visible", this.query.length > 0);
			};
			const clearSearch = (): void => {
				input.value = "";
				this.query = "";
				syncClear();
				if (this.searchTimeout !== null) window.clearTimeout(this.searchTimeout);
				this.renderList();
				input.focus();
			};
			clearBtn.addEventListener("click", clearSearch);
			input.value = this.query;
			syncClear();
			input.addEventListener("input", () => {
				this.query = input.value;
				syncClear();
				if (this.searchTimeout !== null) window.clearTimeout(this.searchTimeout);
				this.searchTimeout = window.setTimeout(() => {
					this.renderList();
				}, 150);
			});
			input.addEventListener("keydown", (event) => {
				if (event.key === "Escape") clearSearch();
			});
			this.searchInputEl = input;
			this.searchClearEl = clearBtn;

			this.topActionsEl = top.createDiv("pms-top-actions");
			this.controlsEl = header.createDiv("pms-controls");
			this.bodyEl = root.createDiv("pms-body");
		}

		this.renderTopActions();
		this.renderControlRows();
		this.renderList();
		this.searchClearEl?.toggleClass("is-visible", this.query.length > 0);
		this.bodyEl.scrollTop = scrollTop;
	}

	focusSearch(): void {
		this.searchInputEl?.focus();
		this.searchInputEl?.select();
	}

	private addChip(
		parent: HTMLElement,
		text: string,
		title: string,
		cls: string,
		onClick: () => void,
	): HTMLButtonElement {
		const btn = parent.createEl("button", {
			cls,
			attr: { type: "button", title },
		});
		btn.createSpan({ text });
		btn.addEventListener("click", onClick);
		return btn;
	}

	private updateFilter(mutate: () => void): void {
		mutate();
		void this.plugin.saveSettings();
		this.renderTopActions();
		this.renderControlRows();
		this.renderList();
	}

	private renderTopActions(): void {
		const topActions = this.topActionsEl;
		if (!topActions) return;
		topActions.empty();

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
				await Promise.all([
					this.plugin.fetchOfficialRegistry(),
					this.plugin.scanHotReloadFiles(),
				]);
				this.render();
			})();
		});
	}

	private renderControlRows(): void {
		const controls = this.controlsEl;
		if (!controls) return;
		controls.empty();

		const settings = this.plugin.settings;
		const updateCount = this.plugin.getAvailableUpdatesCount();

		const structureRow = controls.createDiv("pms-control-row pms-structure-row");

		this.addChip(
			structureRow,
			SCOPE_LABELS[settings.scope],
			"Click to cycle: Community → core → all",
			`pms-chip ${settings.scope !== "community" ? "is-active" : ""}`,
			() =>
				this.updateFilter(() => {
					const index = SCOPE_ORDER.indexOf(settings.scope);
					settings.scope = SCOPE_ORDER[(index + 1) % SCOPE_ORDER.length] ?? "community";
				}),
		);

		this.addChip(
			structureRow,
			settings.view === "group" ? "View: Groups" : "View: Status",
			"Click to toggle: Status ↔ groups",
			`pms-chip ${settings.view === "group" ? "is-active" : ""}`,
			() =>
				this.updateFilter(() => {
					settings.view = settings.view === "status" ? "group" : "status";
				}),
		);

		if (settings.view === "group") {
			const validGroup =
				settings.selectedGroup === "all" ||
				settings.selectedGroup === "_ungrouped" ||
				settings.groups.some((group) => group.id === settings.selectedGroup);
			if (!validGroup) settings.selectedGroup = "all";

			const groupSelect = structureRow.createEl("select", {
				cls: "pms-group-select",
				attr: { title: "Filter by group" },
			});
			const addOption = (label: string, value: string): void => {
				const opt = groupSelect.createEl("option");
				opt.value = value;
				opt.text = label;
				if (settings.selectedGroup === value) opt.selected = true;
			};
			addOption("All Groups", "all");
			for (const group of settings.groups) addOption(group.name, group.id);
			addOption("Ungrouped", "_ungrouped");

			groupSelect.addEventListener("change", () => {
				settings.selectedGroup = groupSelect.value;
				void this.plugin.saveSettings();
				this.renderList();
			});
		}

		const criteriaRow = controls.createDiv("pms-control-row pms-criteria-row");

		if (settings.scope !== "core") {
			let sourceCls = "pms-chip";
			if (settings.sourceFilter === "official") sourceCls += " is-source-official";
			else if (settings.sourceFilter === "local") sourceCls += " is-source-local";

			this.addChip(
				criteriaRow,
				SOURCE_LABELS[settings.sourceFilter],
				"Click to cycle: All sources → official → local",
				sourceCls,
				() =>
					this.updateFilter(() => {
						const index = SOURCE_ORDER.indexOf(settings.sourceFilter);
						settings.sourceFilter =
							SOURCE_ORDER[(index + 1) % SOURCE_ORDER.length] ?? "all";
					}),
			);
		}

		let stateCls = "pms-chip";
		if (settings.stateFilter === "enabled") stateCls += " is-active";
		else if (settings.stateFilter === "disabled") stateCls += " is-state-disabled";

		this.addChip(
			criteriaRow,
			STATE_LABELS[settings.stateFilter],
			"Click to cycle: All states → enabled → disabled",
			stateCls,
			() =>
				this.updateFilter(() => {
					const index = STATE_ORDER.indexOf(settings.stateFilter);
					settings.stateFilter =
						STATE_ORDER[(index + 1) % STATE_ORDER.length] ?? "all";
				}),
		);

		this.addChip(
			criteriaRow,
			"Pinned",
			"Click to toggle pinned filter",
			`pms-chip ${settings.pinnedOnly ? "is-active" : ""}`,
			() =>
				this.updateFilter(() => {
					settings.pinnedOnly = !settings.pinnedOnly;
				}),
		);

		this.addChip(
			criteriaRow,
			settings.sortBy === "alphabetical" ? "Sort: A-Z" : "Sort: Status",
			"Click to cycle sort: Status (enabled first) ↔ alphabetical (a-z)",
			`pms-chip ${settings.sortBy === "alphabetical" ? "is-active" : ""}`,
			() =>
				this.updateFilter(() => {
					settings.sortBy = settings.sortBy === "alphabetical" ? "status" : "alphabetical";
				}),
		);

		if (settings.scope !== "core") {
			const updateBtn = this.addChip(
				criteriaRow,
				"Updates",
				"Click to toggle updates filter",
				`pms-chip ${settings.updatesOnly ? "is-active" : ""}`,
				() =>
					this.updateFilter(() => {
						settings.updatesOnly = !settings.updatesOnly;
					}),
			);
			if (updateCount > 0) {
				updateBtn.createSpan({ text: String(updateCount), cls: "pms-chip-badge" });
				updateBtn.addClass("is-update-chip");
			}
		}

		const isFiltered =
			(settings.scope !== "core" && settings.sourceFilter !== "all") ||
			settings.stateFilter !== "all" ||
			settings.pinnedOnly ||
			settings.updatesOnly;

		if (isFiltered) {
			this.addChip(
				criteriaRow,
				"✕ Reset",
				"Reset all active filters",
				"pms-chip pms-chip-reset",
				() =>
					this.updateFilter(() => {
						settings.sourceFilter = "all";
						settings.stateFilter = "all";
						settings.pinnedOnly = false;
						settings.updatesOnly = false;
					}),
			);
		}
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
		const scrollTop = this.bodyEl.scrollTop;
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
		this.bodyEl.scrollTop = scrollTop;
	}

	private buildList(): void {
		const body = this.bodyEl;
		if (!body) return;
		const settings = this.plugin.settings;
		const all = this.plugin.listPlugins(settings.scope);
		this.lastRenderSignature = this.computeSignature(all);

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

		const { sections, shown } = filterAndBucketPlugins(
			all,
			settings,
			this.query,
			(id) => this.plugin.getUpdatesRecord(id),
		);

		const enabledCount = all.filter((plugin) => plugin.enabled).length;
		const disabledCount = all.length - enabledCount;
		const statsBar = body.createDiv("pms-stats-bar");

		const addStatBtn = (
			text: string,
			cls: string,
			title: string,
			onClick: () => void,
		): void => {
			const pill = statsBar.createEl("button", {
				text,
				cls: `pms-stat-pill pms-stat-btn ${cls}`.trim(),
				attr: { type: "button", title },
			});
			pill.addEventListener("click", onClick);
		};

		addStatBtn(`Total: ${all.length}`, "", "Show all states", () =>
			this.updateFilter(() => {
				settings.stateFilter = "all";
				settings.updatesOnly = false;
			}),
		);
		addStatBtn(
			`Active: ${enabledCount}`,
			`is-active ${settings.stateFilter === "enabled" ? "is-selected" : ""}`,
			"Toggle enabled filter",
			() =>
				this.updateFilter(() => {
					settings.stateFilter = settings.stateFilter === "enabled" ? "all" : "enabled";
				}),
		);
		addStatBtn(
			`Inactive: ${disabledCount}`,
			`is-inactive ${settings.stateFilter === "disabled" ? "is-selected" : ""}`,
			"Toggle disabled filter",
			() =>
				this.updateFilter(() => {
					settings.stateFilter = settings.stateFilter === "disabled" ? "all" : "disabled";
				}),
		);
		if (updateCount > 0) {
			addStatBtn(
				`Updates: ${updateCount}`,
				`is-update ${settings.updatesOnly ? "is-selected" : ""}`,
				"Toggle updates filter",
				() =>
					this.updateFilter(() => {
						settings.updatesOnly = !settings.updatesOnly;
					}),
			);
		}
		if (shown < all.length) {
			statsBar.createSpan({
				text: `Showing ${shown} of ${all.length}`,
				cls: "pms-stat-pill pms-stat-showing",
			});
		}

		if (
			settings.scope !== "core" &&
			updateCount > 0 &&
			!this.query.trim() &&
			!settings.pinnedOnly &&
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
				text: "Update all",
				cls: "mod-cta pms-mini-btn",
				attr: { type: "button" },
			});
			upAllBtn.addEventListener("click", () => void this.plugin.updateAllPlugins());

			const upList = upSec.createDiv("pms-section-list");
			for (const item of updates) {
				this.addUpdateRow(upList, item);
			}
		}

		for (const section of sections) {
			this.addSection(
				section.title,
				section.plugins,
				section.group ? { group: section.group, total: section.total } : undefined,
			);
		}

		if (shown === 0) {
			body.createDiv({ text: "No matching plugins found.", cls: "pms-empty" });
		}
	}

	private computeSignature(list?: ManagedPlugin[]): string {
		const items = list ?? this.plugin.listPlugins(this.plugin.settings.scope);
		const updateCount = this.plugin.getAvailableUpdatesCount();
		return `${updateCount}|` + items.map((p) => `${p.id}:${p.enabled ? 1 : 0}:${p.version}:${p.name}`).join(";");
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
		const nameWrap = line1.createDiv("pms-name-wrap");
		nameWrap.createSpan({ text: plugin.name, cls: "pms-name" });
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
				new Notice("Plugin manager cannot disable itself from this view.");
				return;
			}
			manager.safe(() => manager.togglePlugin(plugin), "toggle");
		};
		toggle.addEventListener("click", doToggle);
		toggle.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") doToggle(event);
		});

		const meta = row.createDiv("pms-meta");
		const idEl = meta.createSpan({
			text: plugin.id,
			cls: "pms-id pms-id-copyable",
			attr: { title: "Click to copy plugin ID", role: "button", tabindex: "0" },
		});
		const copyId = (event: Event): void => {
			event.stopPropagation();
			void navigator.clipboard.writeText(plugin.id).then(
				() => new Notice(`Copied "${plugin.id}".`),
				() => new Notice("Could not copy plugin ID."),
			);
		};
		idEl.addEventListener("click", copyId);
		idEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				copyId(event);
			}
		});
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

		if (!plugin.isCore) {
			this.iconButton(
				actions,
				plugin.isOfficial ? "compass" : "github",
				plugin.isOfficial ? "Open community plugin page" : "Open GitHub repository",
				() => manager.safe(() => manager.openPluginPage(plugin), "open plugin page"),
			);
		}

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

		if (!plugin.isCore) {
			menu.addItem((item) =>
				item
					.setTitle(
						plugin.isOfficial
							? "Open community plugin page"
							: "Open GitHub repository",
					)
					.setIcon(plugin.isOfficial ? "compass" : "github")
					.onClick(() =>
						manager.safe(() => manager.openPluginPage(plugin), "open plugin page"),
					),
			);
			if (plugin.isOfficial && manager.resolvePluginRepoUrl(plugin)) {
				menu.addItem((item) =>
					item
						.setTitle("Open GitHub repository")
						.setIcon("github")
						.onClick(() =>
							manager.safe(() => manager.openPluginRepo(plugin), "open repository"),
						),
				);
			}
		}

		if (plugin.isLocal && !plugin.isCore) {
			menu.addItem((item) =>
				item
					.setTitle("Reveal in explorer")
					.setIcon("folder")
					.onClick(() => manager.revealInExplorer(plugin.id)),
			);
			menu.addItem((item) =>
				item
					.setTitle("Touch / add .hotreload")
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
