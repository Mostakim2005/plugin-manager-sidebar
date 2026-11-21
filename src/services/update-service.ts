import { Notice, apiVersion, requestUrl, type App } from "obsidian";
import { AppUpdateModal } from "../modals/app-update-modal";
import type { PluginUpdateInfo } from "../types";
import {
	COMMUNITY_REGISTRY_URL,
	DESKTOP_RELEASES_URL,
	OBSIDIAN_DOWNLOAD_URL,
	compareSemver,
	isRecord,
	logError,
} from "../utils/format";
import type { HostBridge } from "./host-bridge";

interface WindowWithProcess {
	process?: { versions?: { obsidian?: string } };
}

/** Handles community registry lookups, Obsidian release checks, and plugin update queries. */
export class UpdateService {
	officialIds = new Set<string>();
	officialRepos = new Map<string, string>();
	registryLoaded = false;

	constructor(
		private readonly app: App,
		private readonly host: HostBridge,
	) {}

	getObsidianVersion(): string {
		const custom = (window as unknown as WindowWithProcess).process?.versions?.obsidian;
		if (custom) return custom;
		return apiVersion || "1.0.0";
	}

	async fetchOfficialRegistry(): Promise<void> {
		try {
			const res = await requestUrl({ url: COMMUNITY_REGISTRY_URL, method: "GET" });
			if (res.status === 200 && Array.isArray(res.json)) {
				const entries = res.json as Array<Record<string, unknown>>;
				const ids = new Set<string>();
				const repos = new Map<string, string>();
				for (const entry of entries) {
					if (typeof entry.id !== "string") continue;
					ids.add(entry.id);
					if (typeof entry.repo === "string" && /^[^/]+\/[^/]+$/.test(entry.repo.trim())) {
						repos.set(entry.id, entry.repo.trim());
					}
				}
				this.officialIds = ids;
				this.officialRepos = repos;
				this.registryLoaded = true;
			}
		} catch (error) {
			logError("offline or unable to fetch registry", error);
		}
	}

	async checkObsidianSoftwareUpdate(): Promise<void> {
		new Notice("Checking for Obsidian software updates…");
		let latestVersion: string | null = null;

		try {
			const res = await requestUrl({ url: DESKTOP_RELEASES_URL, method: "GET" });
			const data: unknown = res.json;
			if (res.status === 200 && isRecord(data)) {
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
				const data: unknown = res.json;
				if (res.status === 200 && isRecord(data) && typeof data.tag_name === "string") {
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

	async checkOfficialUpdates(onRefreshed: () => void): Promise<void> {
		if (!this.host.communityEnabled()) return;
		try {
			if (typeof this.host.pm?.checkForUpdates === "function") {
				await this.host.pm.checkForUpdates();
				onRefreshed();
				const count = this.getAvailableUpdatesCount();
				if (count > 0) new Notice(`${count} plugin updates available!`);
			}
		} catch (error) {
			logError("checking updates failed", error);
		}
	}

	getAvailableUpdates(): PluginUpdateInfo[] {
		const updates = this.host.pm?.updates ?? {};
		const manifests = this.host.pm?.manifests ?? {};
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
		return Object.keys(this.host.pm?.updates ?? {}).length;
	}

	getUpdatesRecord(id: string): boolean {
		return Boolean(this.host.pm?.updates?.[id]);
	}
}
