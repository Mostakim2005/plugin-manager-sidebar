import type { ManagedPlugin, PluginGroup, PluginManagerSettings } from "../types";
import { byEnabledThenName, byName } from "../utils/format";

export interface PluginSectionBucket {
	title: string;
	plugins: ManagedPlugin[];
	group?: PluginGroup;
	total?: number;
}

export interface FilteredPluginBuckets {
	filtered: ManagedPlugin[];
	sections: PluginSectionBucket[];
	shown: number;
}

/** Pure filter, sort, and section-bucketing pipeline for PluginManagerView. */
export function filterAndBucketPlugins(
	all: ManagedPlugin[],
	settings: PluginManagerSettings,
	rawQuery: string,
	hasUpdate: (id: string) => boolean,
): FilteredPluginBuckets {
	const query = rawQuery.trim().toLowerCase();
	const byId = new Map(all.map((plugin) => [plugin.id, plugin]));
	const pinnedSet = new Set(settings.pinned);
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
			if (settings.pinnedOnly && !pinnedSet.has(plugin.id)) return false;
			if (settings.updatesOnly && (!hasUpdate(plugin.id) || plugin.isCore)) return false;
			return true;
		})
		.sort(sortFn);

	const filteredSet = new Set(filtered);
	const sections: PluginSectionBucket[] = [];
	let shown = 0;

	const pinned = settings.pinned
		.map((id) => byId.get(id))
		.filter((plugin): plugin is ManagedPlugin => plugin !== undefined && filteredSet.has(plugin))
		.sort(sortFn);

	if (pinned.length > 0 && !settings.pinnedOnly) {
		sections.push({ title: "Pinned", plugins: pinned });
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
				.filter(
					(plugin): plugin is ManagedPlugin =>
						plugin !== undefined && filteredSet.has(plugin),
				)
				.sort(sortFn);

			if (members.length > 0) {
				sections.push({
					title: group.name,
					plugins: members,
					group,
					total: members.length,
				});
				shown += members.length;
			}
		}

		if (selected === "all" || selected === "_ungrouped") {
			const ungrouped = filtered.filter(
				(plugin) =>
					!grouped.has(plugin.id) && (settings.pinnedOnly || !pinnedSet.has(plugin.id)),
			);
			if (ungrouped.length > 0) {
				sections.push({ title: "Other Plugins", plugins: ungrouped });
				shown += ungrouped.length;
			}
		}
	} else {
		const rest = filtered.filter(
			(plugin) => settings.pinnedOnly || !pinnedSet.has(plugin.id),
		);
		if (settings.sortBy === "alphabetical" && settings.stateFilter === "all") {
			if (rest.length > 0) {
				sections.push({ title: "All Plugins (A-Z)", plugins: rest });
			}
			shown += rest.length;
		} else {
			const enabled = rest.filter((plugin) => plugin.enabled);
			const disabled = rest.filter((plugin) => !plugin.enabled);
			if (enabled.length > 0) sections.push({ title: "Enabled", plugins: enabled });
			if (disabled.length > 0) sections.push({ title: "Disabled", plugins: disabled });
			shown += rest.length;
		}
	}

	return { filtered, sections, shown };
}
