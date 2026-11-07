import type {
	PluginGroup,
	PluginManagerSettings,
	PluginOverride,
} from "../types";
import { newGroupId, sanitizePluginId, unique } from "./format";

export const SETTINGS_VERSION = 7;

export const DEFAULT_SETTINGS: PluginManagerSettings = {
	version: SETTINGS_VERSION,
	pinned: [],
	groups: [],
	view: "status",
	scope: "community",
	sourceFilter: "all",
	stateFilter: "all",
	pinnedOnly: false,
	updatesOnly: false,
	selectedGroup: "all",
	sortBy: "status",
	glassmorphism: true,
	autoCheckUpdates: true,
	overrides: {},
};

const PLUGIN_ID_RE = /^[a-zA-Z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function groupList(value: unknown): PluginGroup[] {
	if (!Array.isArray(value)) return [];
	const groups: PluginGroup[] = [];
	const seen = new Set<string>();

	for (const raw of value) {
		if (!isRecord(raw)) continue;
		const name = typeof raw.name === "string" ? raw.name.trim() : "";
		if (!name) continue;
		let id = typeof raw.id === "string" && raw.id ? raw.id : newGroupId();
		while (seen.has(id)) id = newGroupId();
		seen.add(id);
		groups.push({
			id,
			name,
			plugins: Array.isArray(raw.plugins)
				? unique(raw.plugins.filter((item): item is string => typeof item === "string" && PLUGIN_ID_RE.test(item)))
				: [],
		});
	}
	return groups;
}

function overrideList(value: unknown): Record<string, PluginOverride> {
	if (!isRecord(value)) return {};
	const overrides: Record<string, PluginOverride> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
		const id = sanitizePluginId(key);
		if (!id || !isRecord(raw)) continue;
		overrides[id] = {
			name: typeof raw.name === "string" ? raw.name.slice(0, 100) : undefined,
			author: typeof raw.author === "string" ? raw.author.slice(0, 100) : undefined,
			description:
				typeof raw.description === "string" ? raw.description.slice(0, 500) : undefined,
		};
	}
	return overrides;
}

/** Coerces any stored value into the live v7 settings shape. */
export function sanitizeSettings(raw: unknown): PluginManagerSettings {
	const out: PluginManagerSettings = { ...DEFAULT_SETTINGS, overrides: {} };
	if (!isRecord(raw)) return out;

	if (Array.isArray(raw.pinned)) {
		out.pinned = unique(
			raw.pinned.filter(
				(item): item is string => typeof item === "string" && PLUGIN_ID_RE.test(item),
			),
		);
	}
	out.groups = groupList(raw.groups);
	out.overrides = overrideList(raw.overrides);

	if (raw.view === "group") out.view = "group";
	if (raw.scope === "community" || raw.scope === "core" || raw.scope === "all") {
		out.scope = raw.scope;
	}
	if (raw.sourceFilter === "all" || raw.sourceFilter === "official" || raw.sourceFilter === "local") {
		out.sourceFilter = raw.sourceFilter;
	}
	if (raw.stateFilter === "all" || raw.stateFilter === "enabled" || raw.stateFilter === "disabled") {
		out.stateFilter = raw.stateFilter;
	}
	if (typeof raw.pinnedOnly === "boolean") out.pinnedOnly = raw.pinnedOnly;
	if (typeof raw.updatesOnly === "boolean") out.updatesOnly = raw.updatesOnly;
	if (typeof raw.selectedGroup === "string") out.selectedGroup = raw.selectedGroup;
	if (raw.sortBy === "status" || raw.sortBy === "alphabetical") {
		out.sortBy = raw.sortBy;
	}
	if (typeof raw.glassmorphism === "boolean") out.glassmorphism = raw.glassmorphism;
	if (typeof raw.autoCheckUpdates === "boolean") out.autoCheckUpdates = raw.autoCheckUpdates;

	out.version = SETTINGS_VERSION;
	return out;
}
