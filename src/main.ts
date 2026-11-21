import { Notice, Plugin } from "obsidian";
import { ConfirmModal } from "./modals/confirm-modal";
import { GroupModal } from "./modals/group-modal";
import { HostBridge } from "./services/host-bridge";
import { UpdateService } from "./services/update-service";
import { PluginManagerSettingTab } from "./settings-tab";
import type {
	ManagedPlugin,
	PluginGroup,
	PluginScope,
	PluginUpdateInfo,
} from "./types";
import {
	VIEW_TYPE,
	byName,
	errMsg,
	logError,
	newGroupId,
	sleep,
	unique,
} from "./utils/format";
import type { AppWithInternals, PluginManagerApi } from "./utils/obsidian-internals";
import { sanitizeGithubOwner, sanitizeHttpUrl, sanitizeSettings } from "./utils/settings";
import { SidebarController } from "./utils/workspace";
import { PluginManagerView } from "./views/plugin-manager-view";

export default class PluginManagerSidebar extends Plugin {
	settings = sanitizeSettings(null);
	private busy = false;
	private saveChain: Promise<void> = Promise.resolve();
	private readonly sidebar = new SidebarController(this.app);
	private readonly host = new HostBridge(this.app);
	private readonly updates = new UpdateService(this.app, this.host);

	get registryLoaded(): boolean {
		return this.updates.registryLoaded;
	}

	async onload(): Promise<void> {
		try {
			this.settings = sanitizeSettings(await this.loadData());
		} catch (error) {
			logError("could not read saved settings", error);
		}

		this.applyThemePreferences();
		this.addSettingTab(new PluginManagerSettingTab(this.app, this));

		this.registerView(VIEW_TYPE, (leaf) => new PluginManagerView(leaf, this));
		const ribbonEl = this.addRibbonIcon("blocks", "Toggle plugin manager", () => {
			this.safe(() => this.toggleView(), "toggle sidebar");
		});
		this.sidebar.attachRibbon(ribbonEl);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.sidebar.syncRibbonState()),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.sidebar.syncRibbonState()),
		);
		this.app.workspace.onLayoutReady(() => {
			this.sidebar.syncRibbonState();
		});
		this.addCommand({
			id: "open-plugin-manager",
			name: "Open sidebar",
			callback: () => this.safe(() => this.activateView(), "open sidebar"),
		});
		this.addCommand({
			id: "toggle-plugin-manager",
			name: "Toggle sidebar",
			callback: () => this.safe(() => this.toggleView(), "toggle sidebar"),
		});

		await this.scanHotReloadFiles();
		void this.fetchOfficialRegistry().then(() => {
			this.refreshViews();
			if (this.settings.autoCheckUpdates) {
				void this.checkOfficialUpdates();
			}
		});
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
		return this.host.pm;
	}

	get internals(): AppWithInternals {
		return this.host.internals;
	}

	communityEnabled(): boolean {
		return this.host.communityEnabled();
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof PluginManagerView) leaf.view.render();
		}
	}

	/* ---------- plugin listing & host delegations ---------- */

	listPlugins(scope: PluginScope = "all"): ManagedPlugin[] {
		return this.host.listPlugins(scope, this.settings.overrides ?? {}, this.updates.officialIds);
	}

	scanHotReloadFiles(): Promise<void> {
		return this.host.scanHotReloadFiles();
	}

	hasHotReloadFile(id: string): boolean {
		return this.host.hasHotReloadFile(id);
	}

	async toggleHotReload(plugin: ManagedPlugin): Promise<void> {
		if (await this.host.toggleHotReload(plugin)) {
			this.refreshViews();
		}
	}

	revealInExplorer(id: string): void {
		this.host.revealInExplorer(id);
	}

	saveLocalManifest(
		id: string,
		name: string,
		author: string,
		description: string,
	): Promise<void> {
		return this.host.saveLocalManifest(id, name, author, description);
	}

	openCommunityBrowser(): void {
		this.host.openCommunityBrowser();
	}

	openPluginSettings(plugin: ManagedPlugin): void {
		this.host.openPluginSettings(plugin);
	}

	/* ---------- plugin pages & repositories ---------- */

	private toKebabSlug(value: string): string {
		return value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	resolvePluginRepoUrl(plugin: ManagedPlugin): string | null {
		if (plugin.isCore) return null;

		const customUrl = sanitizeHttpUrl(this.settings.overrides[plugin.id]?.repoUrl);
		if (customUrl) return customUrl;

		if (plugin.isOfficial) {
			const officialRepo = this.updates.officialRepos.get(plugin.id);
			if (officialRepo) return `https://github.com/${officialRepo}`;
		}

		const slug = this.toKebabSlug(plugin.id);
		const manifestAuthorUrl = sanitizeHttpUrl(this.host.pm?.manifests?.[plugin.id]?.authorUrl);
		if (manifestAuthorUrl) {
			try {
				const parsed = new URL(manifestAuthorUrl);
				if (parsed.hostname.toLowerCase() === "github.com") {
					const segments = parsed.pathname.split("/").filter(Boolean);
					if (segments.length >= 2) {
						return `https://github.com/${segments[0]}/${segments[1]}`;
					}
					if (segments.length === 1 && slug) {
						return `https://github.com/${segments[0]}/${slug}`;
					}
				}
			} catch {
				/* fall through to default GitHub owner */
			}
		}

		const defaultOwner = sanitizeGithubOwner(this.settings.defaultGithubOwner);
		if (defaultOwner && slug) {
			return `https://github.com/${defaultOwner}/${slug}`;
		}

		return manifestAuthorUrl ?? null;
	}

	openPluginRepo(plugin: ManagedPlugin): void {
		const url = this.resolvePluginRepoUrl(plugin);
		if (!url) {
			new Notice(`No repository URL configured for "${plugin.name}".`);
			return;
		}
		window.open(url, "_blank", "noopener");
	}

	openPluginPage(plugin: ManagedPlugin): void {
		if (plugin.isCore) return;

		if (plugin.isOfficial) {
			if (!this.host.ensureCommunityEnabled()) return;
			window.open(`obsidian://show-plugin?id=${encodeURIComponent(plugin.id)}`);
			return;
		}

		this.openPluginRepo(plugin);
	}

	/* ---------- updates ---------- */

	checkObsidianSoftwareUpdate(): Promise<void> {
		return this.updates.checkObsidianSoftwareUpdate();
	}

	fetchOfficialRegistry(): Promise<void> {
		return this.updates.fetchOfficialRegistry();
	}

	checkOfficialUpdates(): Promise<void> {
		return this.updates.checkOfficialUpdates(() => this.refreshViews());
	}

	getAvailableUpdates(): PluginUpdateInfo[] {
		return this.updates.getAvailableUpdates();
	}

	getAvailableUpdatesCount(): number {
		return this.updates.getAvailableUpdatesCount();
	}

	getUpdatesRecord(id: string): boolean {
		return this.updates.getUpdatesRecord(id);
	}

	async updateSinglePlugin(id: string): Promise<void> {
		const update = this.host.pm?.updates?.[id];
		const pm = this.host.pm;
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
		const pm = this.host.pm;
		if (updates.length === 0) {
			new Notice("All plugins are up to date.");
			return;
		}
		if (!pm?.installPlugin) return;

		await this.exclusive("update all plugins", async () => {
			let count = 0;
			let failed = 0;
			for (const item of updates) {
				try {
					await pm.installPlugin?.(item.repo ?? "", item.newVersion, item.manifest);
					if (pm.updates) delete pm.updates[item.id];
					count++;
				} catch (error) {
					failed++;
					logError(`failed updating ${item.id}`, error);
				}
				await sleep(40);
			}
			new Notice(
				failed > 0
					? `Updated ${count} plugins (${failed} failed; see console).`
					: `Updated ${count} plugins.`,
			);
		});
	}

	/* ---------- view & concurrency ---------- */

	toggleView(): Promise<void> {
		return this.sidebar.toggle();
	}

	activateView(): Promise<void> {
		return this.sidebar.activate();
	}

	async exclusive(label: string, fn: () => Promise<void>): Promise<void> {
		if (this.busy) {
			new Notice("Plugin manager is busy processing previous action.");
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

	/* ---------- enable / disable / uninstall / groups ---------- */

	togglePlugin(plugin: ManagedPlugin): Promise<void> {
		const want = !plugin.enabled;
		const label = `${want ? "enable" : "disable"} "${plugin.name}"`;
		return this.exclusive(label, async () => {
			await this.host.setPluginEnabled(plugin, want);
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
						await this.host.setPluginEnabled(plugin, want);
						ok++;
					} catch (error) {
						logError(`could not toggle "${plugin.id}" in group`, error);
					}
					await sleep(60);
				}
				const failed = todo.length - ok;
				new Notice(
					failed > 0
						? `${want ? "Enabled" : "Disabled"} ${ok} plugins in "${group.name}" (${failed} failed; see console).`
						: `${want ? "Enabled" : "Disabled"} ${ok} plugins in "${group.name}".`,
				);
			},
		);
	}

	uninstallPlugin(plugin: ManagedPlugin): Promise<void> {
		return this.exclusive(`uninstall "${plugin.name}"`, async () => {
			if (plugin.isCore) throw new Error("Cannot uninstall built-in core plugins.");
			if (plugin.id === this.manifest.id) throw new Error("Cannot uninstall self.");
			const pm = this.host.pm;
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
							if (this.settings.selectedGroup === group.id) {
								this.settings.selectedGroup = "all";
							}
							await this.saveSettings();
							this.refreshViews();
						})();
					},
				).open();
			},
			this.registryLoaded,
		).open();
	}
}
