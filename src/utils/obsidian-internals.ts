/** The Obsidian internals this plugin reads. Everything is optional. */
import type {
	PluginManifestLike,
	PluginUpdateRecord,
} from "../types";

export interface PluginManagerApi {
	manifests?: Record<string, PluginManifestLike>;
	enabledPlugins?: Set<string>;
	updates?: Record<string, PluginUpdateRecord>;
	isEnabled?: () => boolean;
	checkForUpdates?: () => Promise<void>;
	installPlugin?: (repo: string, version: string, manifest: unknown) => Promise<void>;
	uninstallPlugin?: (id: string) => Promise<void>;
	enablePluginAndSave?: (id: string) => Promise<void>;
	disablePluginAndSave?: (id: string) => Promise<void>;
	enablePlugin?: (id: string) => Promise<void>;
	disablePlugin?: (id: string) => Promise<void>;
	saveConfig?: () => Promise<void>;
}

export interface CorePluginInstance {
	enabled?: boolean;
	manifest?: PluginManifestLike;
	name?: string;
	description?: string;
	instance?: { manifest?: PluginManifestLike; name?: string; description?: string };
	setEnabled?: (enabled: boolean) => Promise<void> | void;
	enable?: () => Promise<void> | void;
	disable?: () => Promise<void> | void;
}

export interface InternalPluginsApi {
	plugins?: Record<string, CorePluginInstance>;
	getPluginById?: (id: string) => CorePluginInstance | undefined;
}

export interface SettingsTabLike {
	id: string;
	containerEl?: HTMLElement;
}

export interface SettingApi {
	open?: () => void;
	openTabById?: (id: string) => void;
	settingTabs?: SettingsTabLike[];
	pluginTabs?: SettingsTabLike[];
	activeTab?: { containerEl?: HTMLElement } | null;
}

export interface CommandLike {
	id: string;
	name: string;
}

export interface CommandsApi {
	commands?: Record<string, CommandLike>;
	executeCommandById?: (id: string) => boolean;
}

export interface AppWithInternals {
	plugins?: PluginManagerApi;
	internalPlugins?: InternalPluginsApi;
	setting?: SettingApi;
	commands?: CommandsApi;
	openWithDefaultApp?: (path: string) => void;
	showInFolder?: (path: string) => void;
}

export interface ElectronShellApi {
	shell?: { openPath?: (path: string) => Promise<string> | void };
}

export type NodeRequire = (id: string) => unknown;
