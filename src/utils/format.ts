import type { ManagedPlugin } from "../types";

export const TAG = "[Plugin Manager Sidebar]";
export const VIEW_TYPE = "plugin-manager-view";

export const COMMUNITY_REGISTRY_URL =
	"https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";
export const DESKTOP_RELEASES_URL =
	"https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json";
export const OBSIDIAN_DOWNLOAD_URL = "https://obsidian.md/download";

export function logError(context: string, error: unknown, extra?: unknown): void {
	if (extra !== undefined) console.error(TAG, context, error, extra);
	else console.error(TAG, context, error);
}

export function errMsg(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}

export function sanitizePluginId(id: unknown): string {
	if (typeof id !== "string") return "";
	return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function byEnabledThenName(a: ManagedPlugin, b: ManagedPlugin): number {
	if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function byName(a: ManagedPlugin, b: ManagedPlugin): number {
	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function newGroupId(): string {
	return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Compares two loose versions such as "1.10.2" and "v1.9". */
export function compareSemver(a: string, b: string): number {
	if (!a || !b) return 0;
	const pa = a.replace(/^[^\d]*/, "").split(".").map(Number);
	const pb = b.replace(/^[^\d]*/, "").split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const na = pa[i] ?? 0;
		const nb = pb[i] ?? 0;
		if (na > nb) return 1;
		if (na < nb) return -1;
	}
	return 0;
}
