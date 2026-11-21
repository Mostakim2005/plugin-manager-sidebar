import { Notice, type App } from "obsidian";
import type {
	ManagedPlugin,
	PluginManifestLike,
	PluginOverride,
	PluginScope,
} from "../types";
import { errMsg, isRecord, logError, sanitizePluginId } from "../utils/format";
import type {
	AppWithInternals,
	CommandLike,
	CorePluginInstance,
	ElectronShellApi,
	PluginManagerApi,
	SettingApi,
} from "../utils/obsidian-internals";

interface WindowWithNode {
	require?: (id: string) => unknown;
}

interface ElectronPathApi {
	join: (...parts: string[]) => string;
}

/** Encapsulates all optional Obsidian host-internal APIs and vault plugin file operations. */
export class HostBridge {
	private hotReloadCache = new Set<string>();

	constructor(private readonly app: App) {}

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

	ensureCommunityEnabled(): boolean {
		if (this.communityEnabled()) return true;
		new Notice("Restricted mode is active. Enable community plugins in settings first.");
		this.internals.setting?.open?.();
		this.internals.setting?.openTabById?.("community-plugins");
		return false;
	}

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

	listPlugins(
		scope: PluginScope,
		overrides: Record<string, PluginOverride>,
		officialIds: ReadonlySet<string>,
	): ManagedPlugin[] {
		const results: ManagedPlugin[] = [];

		if (scope === "community" || scope === "all") {
			const pm = this.pm;
			if (pm?.manifests) {
				const enabled =
					pm.enabledPlugins instanceof Set ? pm.enabledPlugins : new Set<string>();
				for (const [id, manifest] of Object.entries(pm.manifests)) {
					const override = overrides[id] ?? {};
					const isOfficial = officialIds.has(id);
					results.push({
						id,
						name: override.name ?? manifest.name ?? id,
						description:
							override.description !== undefined
								? override.description
								: (manifest.description ?? ""),
						version: manifest.version ?? "",
						author:
							override.author !== undefined ? override.author : (manifest.author ?? ""),
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
						author: override.author !== undefined ? override.author : "Obsidian",
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

	async setPluginEnabled(plugin: ManagedPlugin, want: boolean): Promise<void> {
		if (plugin.isCore) {
			await this.toggleCorePlugin(plugin.id, want);
		} else {
			await this.applyEnabled(plugin.id, want);
		}
	}

	async scanHotReloadFiles(): Promise<void> {
		const found = new Set<string>();
		try {
			for (const id of Object.keys(this.pm?.manifests ?? {})) {
				const path = `${this.app.vault.configDir}/plugins/${id}/.hotreload`;
				if (await this.app.vault.adapter.exists(path)) {
					found.add(id);
				}
			}
			this.hotReloadCache = found;
		} catch (error) {
			logError("error scanning .hotreload files", error);
		}
	}

	hasHotReloadFile(id: string): boolean {
		return this.hotReloadCache.has(id);
	}

	async toggleHotReload(plugin: ManagedPlugin): Promise<boolean> {
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
			return true;
		} catch (error) {
			logError("hot restart failed", error);
			new Notice(`Hot restart failed: ${errMsg(error)}`);
			return false;
		}
	}

	revealInExplorer(id: string): void {
		const safeId = sanitizePluginId(id);
		if (!safeId) return;

		const nodeRequire = (window as unknown as WindowWithNode).require;
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
			const parsed: unknown = JSON.parse(await this.app.vault.adapter.read(manifestPath));
			if (isRecord(parsed)) raw = parsed;
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

	openCommunityBrowser(): void {
		const setting = this.internals.setting;
		if (!this.ensureCommunityEnabled()) return;

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

	private isSettingsOpenFor(setting: SettingApi, pluginId: string): boolean {
		const activeId =
			setting.activeTab?.id ?? setting.activeTab?.plugin?.manifest?.id;
		if (activeId !== pluginId) return false;

		if (typeof setting.isOpen === "boolean") return setting.isOpen;

		const el = setting.modalEl ?? setting.containerEl ?? setting.activeTab?.containerEl;
		if (el) {
			const winClosed = el.ownerDocument?.defaultView?.closed ?? false;
			return !winClosed && el.isConnected && el.isShown();
		}

		return Boolean(setting.win && !setting.win.closed);
	}

	openPluginSettings(plugin: ManagedPlugin): void {
		const setting = this.internals.setting;
		if (!setting) return;
		try {
			if (this.isSettingsOpenFor(setting, plugin.id)) {
				if (typeof setting.close === "function") {
					setting.close();
				} else {
					setting.win?.close?.();
				}
				return;
			}

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
}
