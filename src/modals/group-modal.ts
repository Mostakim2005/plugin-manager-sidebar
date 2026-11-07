import { Modal, Notice, type App } from "obsidian";
import type { ManagedPlugin, PluginGroup } from "../types";

type GroupFilter = "all" | "community" | "core" | "official" | "local";

const FILTER_CHIPS: Array<{ id: GroupFilter; label: string }> = [
	{ id: "all", label: "All" },
	{ id: "community", label: "Community" },
	{ id: "core", label: "Core" },
	{ id: "official", label: "Official" },
	{ id: "local", label: "Local" },
];

export class GroupModal extends Modal {
	private readonly selected: Set<string>;
	private filter = "";
	private categoryFilter: GroupFilter = "all";

	constructor(
		app: App,
		private readonly plugins: ManagedPlugin[],
		private readonly group: PluginGroup | null,
		private readonly onSave: (name: string, ids: string[]) => Promise<void>,
		private readonly onDelete: () => void,
	) {
		super(app);
		this.selected = new Set(group ? group.plugins : []);
	}

	onOpen(): void {
		this.modalEl.addClass("pms-modal-glass", "pms-group-modal-host");
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pms-group-modal");
		contentEl.createEl("h2", { text: this.group ? "Edit group" : "New group" });

		contentEl.createEl("label", { text: "Group name", cls: "pms-modal-label" });
		const nameInput = contentEl.createEl("input", {
			type: "text",
			placeholder: "e.g. Study, Themes, Automation",
			cls: "pms-modal-input",
			value: this.group ? this.group.name : "",
		});

		contentEl.createEl("label", { text: "Assign plugins", cls: "pms-modal-label" });
		const search = contentEl.createEl("input", {
			type: "search",
			placeholder: "Filter plugins…",
			cls: "pms-modal-input",
		});

		const catBar = contentEl.createDiv("pms-control-row pms-modal-filter-row");
		const catButtons: HTMLButtonElement[] = [];

		FILTER_CHIPS.forEach((chip) => {
			const btn = catBar.createEl("button", {
				text: chip.label,
				cls: `pms-chip ${this.categoryFilter === chip.id ? "is-active" : ""}`,
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => {
				this.categoryFilter = chip.id;
				catButtons.forEach((button) => button.removeClass("is-active"));
				btn.addClass("is-active");
				renderChecks();
			});
			catButtons.push(btn);
		});

		const counter = contentEl.createDiv("pms-modal-hint");
		const list = contentEl.createDiv("pms-check-list");

		const updateCounter = (): void => {
			counter.setText(`${this.selected.size} plugins selected`);
		};

		const renderChecks = (): void => {
			list.empty();
			const query = this.filter.trim().toLowerCase();

			const items = this.plugins.filter((plugin) => {
				const matchesQuery =
					!query ||
					plugin.name.toLowerCase().includes(query) ||
					plugin.id.toLowerCase().includes(query);
				if (!matchesQuery) return false;

				if (this.categoryFilter === "core") return plugin.isCore;
				if (this.categoryFilter === "community") return !plugin.isCore;
				if (this.categoryFilter === "official") return !plugin.isCore && plugin.isOfficial;
				if (this.categoryFilter === "local") return !plugin.isCore && plugin.isLocal;
				return true;
			});

			if (items.length === 0) {
				list.createDiv({ text: "No matching plugins found.", cls: "pms-empty-text" });
				return;
			}

			for (const plugin of items) {
				const row = list.createEl("label", { cls: "pms-check-row" });
				const box = row.createEl("input", { type: "checkbox" });
				box.checked = this.selected.has(plugin.id);
				row.createSpan({ text: plugin.name });

				if (plugin.isCore) {
					row.createSpan({ text: "Core", cls: "pms-source-badge is-core" });
				} else if (plugin.isLocal) {
					row.createSpan({ text: "Local", cls: "pms-source-badge is-manual" });
				}

				box.addEventListener("change", () => {
					if (box.checked) this.selected.add(plugin.id);
					else this.selected.delete(plugin.id);
					updateCounter();
				});
			}
		};

		search.addEventListener("input", () => {
			this.filter = search.value;
			renderChecks();
		});

		const row = contentEl.createDiv("modal-button-container");
		if (this.group) {
			const del = row.createEl("button", { text: "Delete group", cls: "mod-warning" });
			del.addEventListener("click", () => {
				this.close();
				this.onDelete();
			});
		}
		const cancel = row.createEl("button", { text: "Cancel" });
		const save = row.createEl("button", { text: "Save group", cls: "mod-cta" });
		cancel.addEventListener("click", () => this.close());

		save.addEventListener("click", () => {
			void (async (): Promise<void> => {
				const name = nameInput.value.trim();
				if (!name) {
					new Notice("Please provide a group name.");
					nameInput.focus();
					return;
				}
				await this.onSave(name, [...this.selected]);
				this.close();
			})();
		});

		updateCounter();
		renderChecks();
		window.setTimeout(() => nameInput.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
