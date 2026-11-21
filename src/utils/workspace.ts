import type {
	App,
	WorkspaceLeaf,
	WorkspaceMobileDrawer,
	WorkspaceSidedock,
} from "obsidian";
import { PluginManagerView } from "../views/plugin-manager-view";
import { VIEW_TYPE } from "./format";

type SidebarSplit = WorkspaceSidedock | WorkspaceMobileDrawer;

interface WorkspaceWithReveal {
	revealLeaf?: (leaf: WorkspaceLeaf) => Promise<void> | void;
}

/** Manages Plugin Manager sidebar leaf discovery, toggling, deduplication, and ribbon state. */
export class SidebarController {
	private ribbonEl: HTMLElement | null = null;

	constructor(private readonly app: App) {}

	attachRibbon(ribbonEl: HTMLElement): void {
		this.ribbonEl = ribbonEl;
		this.syncRibbonState();
	}

	getSidebarSplit(leaf: WorkspaceLeaf): SidebarSplit | null {
		const { workspace } = this.app;
		const root = leaf.getRoot();
		if (root === workspace.rightSplit) return workspace.rightSplit;
		if (root === workspace.leftSplit) return workspace.leftSplit;
		return null;
	}

	isLeafVisible(leaf: WorkspaceLeaf): boolean {
		const split = this.getSidebarSplit(leaf);
		if (split?.collapsed) return false;
		if (!(leaf.view instanceof PluginManagerView)) return false;
		return leaf.view.containerEl.isShown();
	}

	isVisible(): boolean {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE)
			.some((leaf) => this.isLeafVisible(leaf));
	}

	syncRibbonState(): void {
		if (!this.ribbonEl) return;
		const active = this.isVisible();
		this.ribbonEl.toggleClass("is-active", active);
		this.ribbonEl.setAttribute("aria-pressed", String(active));
	}

	private getPrimaryLeaf(): WorkspaceLeaf | null {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		if (leaves.length === 0) return null;

		const primary =
			leaves.find((leaf) => this.isLeafVisible(leaf)) ?? leaves[0] ?? null;
		if (!primary) return null;

		for (const leaf of leaves) {
			if (leaf !== primary) leaf.detach();
		}

		return primary;
	}

	async activate(): Promise<void> {
		const { workspace } = this.app;
		let leaf = this.getPrimaryLeaf();

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}

		const split = this.getSidebarSplit(leaf);
		if (split?.collapsed) split.expand();

		const workspaceWithReveal = workspace as unknown as WorkspaceWithReveal;
		if (typeof workspaceWithReveal.revealLeaf === "function") {
			await workspaceWithReveal.revealLeaf(leaf);
		} else {
			workspace.setActiveLeaf(leaf, { focus: true });
		}

		this.syncRibbonState();
	}

	async toggle(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		const visibleLeaf = leaves.find((leaf) => this.isLeafVisible(leaf)) ?? null;

		if (visibleLeaf) {
			const split = this.getSidebarSplit(visibleLeaf);
			if (split) {
				split.collapse();
			} else {
				visibleLeaf.detach();
			}
			this.syncRibbonState();
			return;
		}

		await this.activate();
	}
}
