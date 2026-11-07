/** Persisted preferences for the sidebar. Shape is the live `data.json` v7. */
export interface PluginManagerSettings {
	version: number;
	pinned: string[];
	groups: PluginGroup[];
	view: PluginViewMode;
	scope: PluginScope;
	sourceFilter: SourceFilter;
	stateFilter: StateFilter;
	pinnedOnly: boolean;
	updatesOnly: boolean;
	selectedGroup: string;
	sortBy: SortBy;
	glassmorphism: boolean;
	autoCheckUpdates: boolean;
	overrides: Record<string, PluginOverride>;
}

export type PluginViewMode = "status" | "group";
export type PluginScope = "community" | "core" | "all";
export type SourceFilter = "all" | "official" | "local";
export type StateFilter = "all" | "enabled" | "disabled";
export type SortBy = "status" | "alphabetical";

export interface PluginGroup {
	id: string;
	name: string;
	plugins: string[];
}

/** Non-destructive display overrides for official plugins. */
export interface PluginOverride {
	name?: string;
	author?: string;
	description?: string;
}

/** One row in the sidebar, community or core. */
export interface ManagedPlugin {
	id: string;
	name: string;
	description: string;
	version: string;
	author: string;
	enabled: boolean;
	isCore: boolean;
	isLocal: boolean;
	isOfficial: boolean;
}

/** One entry from Obsidian's update table. */
export interface PluginUpdateInfo {
	id: string;
	name: string;
	currentVersion: string;
	newVersion: string;
	repo?: string;
	manifest?: unknown;
}

/** A plugin install record exposed by Obsidian's internal plugin manager. */
export interface PluginUpdateRecord {
	version: string;
	repo?: string;
	manifest?: unknown;
}

export interface PluginManifestLike {
	name?: string;
	description?: string;
	version?: string;
	author?: string;
}
