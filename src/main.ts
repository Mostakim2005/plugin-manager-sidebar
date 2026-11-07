import {
	Notice,
	Plugin,
	apiVersion,
	requestUrl,
	type WorkspaceLeaf,
} from "obsidian";
import { ConfirmModal } from "./modals/confirm-modal";
import { AppUpdateModal } from "./modals/app-update-modal";
import { GroupModal } from "./modals/group-modal";
import { PluginManagerSettingTab } from "./settings-tab";
import type {
	ManagedPlugin,
	PluginGroup,
	PluginManifestLike,
	PluginScope,
	PluginUpdateInfo,
} from "./types";
import {
	COMMUNITY_REGISTRY_URL,
	DESKTOP_RELEASES_URL,
	OBSIDIAN_DOWNLOAD_URL,
	VIEW_TYPE,
	byName,
	compareSemver,
	errMsg,
	logError,
	newGroupId,
	sanitizePluginId,
	sleep,
	unique,
} from "./utils/format";
import type {
	AppWithInternals,
	CommandLike,
	CorePluginInstance,
	ElectronShellApi,
	PluginManagerApi,
} from "./utils/obsidian-internals";
import { sanitizeSettings } from "./utils/settings";
import { PluginManagerView } from "./views/plugin-manager-view";

interface WindowWithProcess {
	process?: { versions?: { obsidian?: string } };
	require?: (id: string) => unknown;
}

interface ElectronPathApi {
	join: (...parts: string[]) => string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export default class PluginManagerSidebar extends Plugin {
	settings = sanitizeSettings(null);
	private busy = false;
	private saveChain: Promise<void> = Promise.resolve();
	private officialIds = new Set<string>();
	registryLoaded = false;
	private hotReloadCache = new Set<string>();

	async onload(): Promise<void> {
		try {
			this.settings = sanitizeSettings(await this.loadData());
		} catch (error) {
			logError("could not read saved settings", error);
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
			callback: () => this.safe(() => this.activateView(), "open sidebar"),
		});

		await this.fetchOfficialRegistry();
		await this.scanHotReloadFiles();
		if (this.settings.autoCheckUpdates) {
			void this.checkOfficialUpdates();
		}

	}

	onunload(): void {
		document.body.removeClass("pms-glassmorphic");
	}

	applyThemePreferences(): void {
		document.body.toggleClass("pms-glassmorphic", this.settings.glassmorphism);
	}

	/** Runs an action and funnels every failure into the console plus a notice. */
	safe(fn: () => unknown, context: string): void {
		try {
			const result = fn();
			if (result instanceof Promise) {
				result.catch((error: unknown) => {
					logError(`error in "${context}"`, error);
					new Notice("Action failed. See console.");
				});
			}
		} catch (error) {
			logError(`error in "${context}"`, error);
			new Notice("Action failed. See console.");
		}
	}

	saveSettings(): Promise<void> {
		this.saveChain = this.saveChain
			.then(() => this.saveData(this.settings))
			.catch((error: unknown) => logError("saving settings failed", error));
		return this.saveChain;
	}

	get pm(): PluginManagerApi | undefined {
		return (this.app as unknown as AppWithInternals).plugins;
	}

	get internals(): AppWithInternals {
		return this.app as unknown as AppWithInternals;
	}

	communityEnabled(): boolean {
		const pm = this.pm;
		if (!pm) return false;
		return typeof pm.isEnabled === "function" ? pm.isEnabled() : true;
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof PluginManagerView) leaf.view.render();
		}
	}

	getObsidianVersion(): string {
		const custom = (window as unknown as WindowWithProcess).process?.versions?.obsidian;
		if (custom) return custom;
		return apiVersion || "1.0.0";
	}

	/* ---------- plugin listing ---------- */

	getCorePluginMeta(id: string, plugin: CorePluginInstance): PluginManifestLike {
		const manifest = plugin.manifest ?? plugin.instance?.manifest ?? {};
		const name =
			manifest.name ??
			plugin.name ??
			plugin.instance?.name ??
			id
				.split("-")
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join(" ");
		const description =
			manifest.description ??
			plugin.description ??
			plugin.instance?.description ??
			"Obsidian built-in core plugin";
		return { name, description };
	}

	listPlugins(scope: PluginScope = "all"): ManagedPlugin[] {
		const results: ManagedPlugin[] = [];
		const overrides = this.settings.overrides ?? {};

		if (scope === "community" || scope === "all") {
			const pm = this.pm;
			if (pm?.manifests) {
				const enabled = pm.enabledPlugins instanceof Set ? pm.enabledPlugins : new Set<string>();
				for (const [id, manifest] of Object.entries(pm.manifests)) {
					const override = overrides[id] ?? {};
					const isOfficial = this.officialIds.has(id);
					results.push({
						id,
						name: override.name ?? manifest.name ?? id,
						description:
							override.description !== undefined
								? override.description
								: (manifest.description ?? ""),
						version: manifest.version ?? "",
						author: override.author !== undefined ? override.author : (manifest.author ?? ""),
						enabled: enabled.has(id),
						isCore: false,
						isLocal: !isOfficial,
						isOfficial,
					});
				}
			}
		}

		if (scope === "core" || scope === "all") {
			const internal = this.internals.internalPlugins;
			if (internal?.plugins) {
				for (const [id, corePlugin] of Object.entries(internal.plugins)) {
					const meta = this.getCorePluginMeta(id, corePlugin);
					const override = overrides[id] ?? {};
					results.push({
						id,
						name: override.name ?? meta.name ?? id,
						description:
							override.description !== undefined
								? override.description
								: (meta.description ?? ""),
						version: "",
						author: "Obsidian",
						enabled: Boolean(corePlugin.enabled),
						isCore: true,
						isLocal: false,
						isOfficial: false,
					});
				}
			}
		}

		return results;
	}

	/* ---------- hot reload ---------- */

	async scanHotReloadFiles(): Promise<void> {
		try {
			for (const id of Object.keys(this.pm?.manifests ?? {})) {
				const path = `${this.app.vault.configDir}/plugins/${id}/.hotreload`;
				if (await this.app.vault.adapter.exists(path)) {
					this.hotReloadCache.add(id);
				}
			}
		} catch (error) {
			logError("error scanning .hotreload files", error);
		}
	}

	hasHotReloadFile(id: string): boolean {
		return this.hotReloadCache.has(id);
	}

	async toggleHotReload(plugin: ManagedPlugin): Promise<void> {
		const id = sanitizePluginId(plugin.id);
		if (!id) throw new Error("Invalid plugin ID");
		const path = `${this.app.vault.configDir}/plugins/${id}/.hotreload`;
		try {
			const exists = await this.app.vault.adapter.exists(path);
			if (!exists) {
				await this.app.vault.adapter.write(path, "");
				this.hotReloadCache.add(id);
				new Notice(`Added .hotreload to "${plugin.name}".`);
			} else {
				await this.app.vault.adapter.write(path, String(Date.now()));
				new Notice(`Touched .hotreload for "${plugin.name}". Reload triggered.`);
			}
			this.refreshViews();
		} catch (error) {
			logError("hot restart failed", error);
			new Notice(`Hot restart failed: ${errMsg(error)}`);
		}
	}

	/* ---------- explorer ---------- */

	revealInExplorer(id: string): void {
		const safeId = sanitizePluginId(id);
		if (!safeId) return;

		const nodeRequire = (window as unknown as WindowWithProcess).require;
		if (nodeRequire) {
			try {
				const electron = nodeRequire("electron") as ElectronShellApi;
				const path = nodeRequire("path") as ElectronPathApi;
				const adapter = this.app.vault.adapter as unknown as { basePath?: string };
				if (adapter.basePath && electron.shell?.openPath) {
					const full = path.join(
						adapter.basePath,
						this.app.vault.configDir,
						"plugins",
						safeId,
					);
					void electron.shell.openPath(full);
					return;
				}
			} catch {
				/* fall through to the supported app helpers */
			}
		}

		const relative = `${this.app.vault.configDir}/plugins/${safeId}`;
		if (typeof this.internals.openWithDefaultApp === "function") {
			this.internals.openWithDefaultApp(relative);
		} else if (typeof this.internals.showInFolder === "function") {
			this.internals.showInFolder(relative);
		} else {
			new Notice("System explorer not supported on this platform.");
		}
	}

	/* ---------- manifest edits ---------- */

	async saveLocalManifest(
		id: string,
		name: string,
		author: string,
		description: string,
	): Promise<void> {
		const safeId = sanitizePluginId(id);
		if (!safeId) throw new Error("Invalid plugin ID");
		const manifestPath = `${this.app.vault.configDir}/plugins/${safeId}/manifest.json`;

		let raw: Record<string, unknown> = {};
		try {
			const parsed = asRecord(JSON.parse(await this.app.vault.adapter.read(manifestPath)));
			if (parsed) raw = parsed;
		} catch {
			const manifest = this.pm?.manifests?.[safeId];
			if (manifest) raw = { ...manifest };
		}

		raw.name = name;
		raw.author = author;
		raw.description = description;

		await this.app.vault.adapter.write(manifestPath, JSON.stringify(raw, null, 2));

		const live = this.pm?.manifests?.[safeId];
		if (live) Object.assign(live, { name, author, description });
		new Notice(`Updated manifest.json for "${name}".`);
	}

	/* ---------- Obsidian app updates ---------- */

	async checkObsidianSoftwareUpdate(): Promise<void> {
		new Notice("Checking for Obsidian software updates…");
		let latestVersion: string | null = null;

		try {
			const res = await requestUrl({ url: DESKTOP_RELEASES_URL, method: "GET" });
			const data = asRecord(res.json);
			if (res.status === 200 && data) {
				if (typeof data.latestVersion === "string") {
					latestVersion = data.latestVersion;
				} else {
					const versions = Object.keys(data).filter((version) =>
						/^\d+\.\d+\.\d+/.test(version),
					);
					if (versions.length > 0) latestVersion = versions[versions.length - 1] ?? null;
				}
			}
		} catch (error) {
			logError("error fetching desktop-releases.json", error);
		}

		if (!latestVersion) {
			try {
				const res = await requestUrl({
					url: "https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest",
					method: "GET",
				});
				const data = asRecord(res.json);
				if (res.status === 200 && data && typeof data.tag_name === "string") {
					latestVersion = data.tag_name.replace(/^v/, "");
				}
			} catch (error) {
				logError("error querying github api", error);
			}
		}

		const currentVersion = this.getObsidianVersion();
		if (!latestVersion) {
			new Notice("Could not check Obsidian updates. Please check network connection.");
			return;
		}

		if (compareSemver(latestVersion, currentVersion) > 0) {
			new AppUpdateModal(
				this.app,
				currentVersion,
				latestVersion,
				OBSIDIAN_DOWNLOAD_URL,
			).open();
		} else {
			new Notice(`Obsidian is up to date! (v${currentVersion})`);
		}
	}

	/* ---------- community browser ---------- */

	openCommunityBrowser(): void {
		const setting = this.internals.setting;
		if (!this.communityEnabled()) {
			new Notice("Restricted Mode is active. Enable community plugins in settings first.");
			setting?.open?.();
			setting?.openTabById?.("community-plugins");
			return;
		}

		const commands = this.internals.commands?.commands ?? {};
		const browseCommand: CommandLike | undefined = Object.values(commands).find(
			(command) =>
				command.id.includes("community-plugins") &&
				(command.id.includes("browse") ||
					command.name.toLowerCase().includes("browse")),
		);
		if (browseCommand) {
			this.internals.commands?.executeCommandById?.(browseCommand.id);
			return;
		}

		if (setting) {
			setting.open?.();
			setting.openTabById?.("community-plugins");
			window.setTimeout(() => {
				const container = setting.activeTab?.containerEl;
				if (!container) return;
				const buttons = Array.from(container.querySelectorAll("button"));
				const browseBtn = buttons.find((button) =>
					button.textContent?.toLowerCase().includes("browse"),
				);
				browseBtn?.click();
			}, 70);
		}
	}

	/* ---------- community updates ---------- */

	async fetchOfficialRegistry(): Promise<void> {
		try {
			const res = await requestUrl({ url: COMMUNITY_REGISTRY_URL, method: "GET" });
			if (res.status === 200 && Array.isArray(res.json)) {
				const entries = res.json as Array<Record<string, unknown>>;
				this.officialIds = new Set(
					entries
						.map((entry) => entry.id)
						.filter((id): id is string => typeof id === "string"),
				);
				this.registryLoaded = true;
			}
		} catch (error) {
			logError("offline or unable to fetch registry", error);
		}
	}

	async checkOfficialUpdates(): Promise<void> {
		if (!this.communityEnabled()) return;
		try {
			if (typeof this.pm?.checkForUpdates === "function") {
				await this.pm.checkForUpdates();
				this.refreshViews();
				const count = this.getAvailableUpdatesCount();
				if (count > 0) new Notice(`${count} plugin updates available!`);
			}
		} catch (error) {
			logError("checking updates failed", error);
		}
	}

	getAvailableUpdates(): PluginUpdateInfo[] {
		const updates = this.pm?.updates ?? {};
		const manifests = this.pm?.manifests ?? {};
		const result: PluginUpdateInfo[] = [];

		for (const [id, update] of Object.entries(updates)) {
			const manifest = manifests[id];
			result.push({
				id,
				name: manifest?.name ?? id,
				currentVersion: manifest?.version ?? "0.0.0",
				newVersion: update.version,
				repo: update.repo,
				manifest: update.manifest,
			});
		}
		return result;
	}

	getAvailableUpdatesCount(): number {
		return Object.keys(this.pm?.updates ?? {}).length;
	}

	/** True when Obsidian itself knows about an update for this plugin. */
	getUpdatesRecord(id: string): boolean {
		return Boolean(this.pm?.updates?.[id]);
	}

	async updateSinglePlugin(id: string): Promise<void> {
		const update = this.pm?.updates?.[id];
		const pm = this.pm;
		if (!update || !pm?.installPlugin) return;

		await this.exclusive(`update "${id}"`, async () => {
			new Notice(`Updating ${id} to v${update.version}…`);
			await pm.installPlugin?.(update.repo ?? "", update.version, update.manifest);
			if (pm.updates) delete pm.updates[id];
			new Notice(`Updated ${id} successfully!`);
		});
	}

	async updateAllPlugins(): Promise<void> {
		const updates = this.getAvailableUpdates();
		const pm = this.pm;
		if (updates.length === 0) {
			new Notice("All plugins are up to date.");
			return;
		}
		if (!pm?.installPlugin) return;

		await this.exclusive("update all plugins", async () => {
			let count = 0;
			for (const item of updates) {
				try {
					await pm.installPlugin?.(item.repo ?? "", item.newVersion, item.manifest);
					if (pm.updates) delete pm.updates[item.id];
					count++;
				} catch (error) {
					logError(`failed updating ${item.id}`, error);
				}
				await sleep(40);
			}
			new Notice(`Updated ${count} plugins.`);
		});
	}

	/* ---------- view ---------- */

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing: WorkspaceLeaf | null =
			workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
		let leaf = existing;

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}

		workspace.setActiveLeaf(leaf, { focus: true });
	}

	async exclusive(label: string, fn: () => Promise<void>): Promise<void> {
		if (this.busy) {
			new Notice("Plugin Manager is busy processing previous action.");
			return;
		}
		this.busy = true;
		try {
			await fn();
		} catch (error) {
			logError(`FAILED: ${label}`, error);
			new Notice(`Plugin Manager: ${errMsg(error)}`, 6000);
		} finally {
			this.busy = false;
			this.refreshViews();
		}
	}

	/* ---------- enable / disable ---------- */

	async applyEnabled(id: string, want: boolean): Promise<void> {
		const pm = this.pm;
		if (!pm?.enabledPlugins) throw new Error("Plugin manager core is unavailable.");
		const isOn = (): boolean => pm.enabledPlugins?.has(id) ?? false;
		if (isOn() === want) return;
		if (!pm.manifests?.[id]) throw new Error(`Plugin "${id}" not found.`);

		if (want) {
			if (typeof pm.enablePluginAndSave === "function") {
				await pm.enablePluginAndSave(id);
			} else if (typeof pm.enablePlugin === "function") {
				await pm.enablePlugin(id);
				if (typeof pm.saveConfig === "function") await pm.saveConfig();
			}
		} else if (typeof pm.disablePluginAndSave === "function") {
			await pm.disablePluginAndSave(id);
		} else if (typeof pm.disablePlugin === "function") {
			await pm.disablePlugin(id);
			if (typeof pm.saveConfig === "function") await pm.saveConfig();
		}

		if (isOn() !== want) {
			throw new Error(want ? `"${id}" failed to load.` : `"${id}" did not stop.`);
		}
	}

	async toggleCorePlugin(id: string, want: boolean): Promise<void> {
		const internal = this.internals.internalPlugins;
		if (!internal) throw new Error("Obsidian core plugin manager unavailable.");
		const corePlugin = internal.getPluginById
			? internal.getPluginById(id)
			: internal.plugins?.[id];
		if (!corePlugin) throw new Error(`Core plugin "${id}" not found.`);

		if (typeof corePlugin.setEnabled === "function") {
			await corePlugin.setEnabled(want);
		} else if (want) {
			if (typeof corePlugin.enable === "function") await corePlugin.enable();
			else corePlugin.enabled = true;
		} else if (typeof corePlugin.disable === "function") {
			await corePlugin.disable();
		} else {
			corePlugin.enabled = false;
		}
	}

	togglePlugin(plugin: ManagedPlugin): Promise<void> {
		const want = !plugin.enabled;
		const label = `${want ? "enable" : "disable"} "${plugin.name}"`;
		return this.exclusive(label, async () => {
			if (plugin.isCore) {
				await this.toggleCorePlugin(plugin.id, want);
			} else {
				await this.applyEnabled(plugin.id, want);
			}
			new Notice(`${plugin.name} ${want ? "enabled" : "disabled"}.`);
		});
	}

	bulkGroup(group: PluginGroup, want: boolean): Promise<void> {
		const selfId = this.manifest.id;
		const all = this.listPlugins("all");
		const byId = new Map(all.map((plugin) => [plugin.id, plugin]));

		const todo = group.plugins
			.filter((id) => id !== selfId)
			.map((id) => byId.get(id))
			.filter((plugin): plugin is ManagedPlugin => plugin !== undefined)
			.filter((plugin) => plugin.enabled !== want);

		if (todo.length === 0) {
			new Notice(
				`All plugins in "${group.name}" already ${want ? "enabled" : "disabled"}.`,
			);
			return Promise.resolve();
		}

		return this.exclusive(
			`${want ? "enable" : "disable"} group "${group.name}"`,
			async () => {
				let ok = 0;
				for (const plugin of todo) {
					try {
						if (plugin.isCore) {
							await this.toggleCorePlugin(plugin.id, want);
						} else {
							await this.applyEnabled(plugin.id, want);
						}
						ok++;
					} catch (error) {
						logError(`could not toggle "${plugin.id}" in group`, error);
					}
					await sleep(60);
				}
				new Notice(
					`${want ? "Enabled" : "Disabled"} ${ok} plugins in "${group.name}".`,
				);
			},
		);
	}

	uninstallPlugin(plugin: ManagedPlugin): Promise<void> {
		return this.exclusive(`uninstall "${plugin.name}"`, async () => {
			if (plugin.isCore) throw new Error("Cannot uninstall built-in core plugins.");
			if (plugin.id === this.manifest.id) throw new Error("Cannot uninstall self.");
			const pm = this.pm;
			if (!pm?.uninstallPlugin) throw new Error("Plugin manager core is unavailable.");
			await pm.uninstallPlugin(plugin.id);

			this.settings.pinned = this.settings.pinned.filter((id) => id !== plugin.id);
			for (const group of this.settings.groups) {
				group.plugins = group.plugins.filter((id) => id !== plugin.id);
			}
			await this.saveSettings();
			new Notice(`"${plugin.name}" uninstalled.`);
		});
	}

	openPluginSettings(plugin: ManagedPlugin): void {
		const setting = this.internals.setting;
		if (!setting) return;
		try {
			if (!plugin.enabled) {
				new Notice(`Enable "${plugin.name}" first to access settings.`);
				return;
			}

			const hasTab = (id: string): boolean =>
				Boolean(
					setting.settingTabs?.some((tab) => tab.id === id) ||
						setting.pluginTabs?.some((tab) => tab.id === id),
				);

			setting.open?.();
			if (plugin.isCore) {
				if (hasTab(plugin.id)) setting.openTabById?.(plugin.id);
				else new Notice(`"${plugin.name}" does not have configurable settings.`);
				return;
			}

			if (hasTab(plugin.id)) setting.openTabById?.(plugin.id);
			else new Notice(`"${plugin.name}" has no registered settings tab.`);
		} catch (error) {
			logError(`could not open settings for "${plugin.id}"`, error);
		}
	}

	togglePin(id: string): void {
		const pinned = this.settings.pinned;
		const index = pinned.indexOf(id);
		if (index >= 0) pinned.splice(index, 1);
		else pinned.push(id);
		void this.saveSettings();
		this.refreshViews();
	}

	openGroupEditor(group: PluginGroup | null): void {
		const selfId = this.manifest.id;
		const choices = this.listPlugins("all")
			.filter((plugin) => plugin.id !== selfId)
			.sort(byName);

		new GroupModal(
			this.app,
			choices,
			group,
			async (name, ids) => {
				if (group) {
					group.name = name;
					const installed = new Set(choices.map((choice) => choice.id));
					const missing = group.plugins.filter((id) => !installed.has(id));
					group.plugins = unique([...ids, ...missing]);
				} else {
					this.settings.groups.push({ id: newGroupId(), name, plugins: unique(ids) });
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
					"Delete group",
					() => {
						void (async (): Promise<void> => {
							this.settings.groups = this.settings.groups.filter(
								(entry) => entry.id !== group.id,
							);
							await this.saveSettings();
							this.refreshViews();
						})();
					},
				).open();
			},
		).open();
	}
}
