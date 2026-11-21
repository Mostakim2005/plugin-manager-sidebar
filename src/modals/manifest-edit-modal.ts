import { Modal, Notice, type App } from "obsidian";
import type PluginManagerSidebar from "../main";
import type { ManagedPlugin } from "../types";
import { errMsg, logError } from "../utils/format";
import { sanitizeHttpUrl } from "../utils/settings";

export class ManifestEditModal extends Modal {
	constructor(
		app: App,
		private readonly pluginManager: PluginManagerSidebar,
		private readonly target: ManagedPlugin,
		private readonly isLocal: boolean,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("pms-modal-glass", "pms-edit-modal-host");
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pms-edit-modal");

		contentEl.createEl("h2", {
			text: this.isLocal
				? "Edit plugin metadata (permanent)"
				: "Edit plugin display (visual overlay)",
		});

		contentEl
			.createDiv({
				cls: `pms-modal-badge-desc ${this.isLocal ? "is-local-notice" : "is-official-notice"}`,
			})
			.setText(
				this.isLocal
					? "Local/manual plugin: changes directly modify manifest.json on disk."
					: "Official/core plugin: changes are stored non-destructively in data.json.",
			);

		contentEl.createEl("label", { text: "Display name", cls: "pms-modal-label" });
		const nameInput = contentEl.createEl("input", {
			type: "text",
			cls: "pms-modal-input",
			value: this.target.name,
		});

		contentEl.createEl("label", { text: "Author", cls: "pms-modal-label" });
		const authorInput = contentEl.createEl("input", {
			type: "text",
			cls: "pms-modal-input",
			value: this.target.author,
		});

		contentEl.createEl("label", { text: "Description", cls: "pms-modal-label" });
		const descInput = contentEl.createEl("textarea", { cls: "pms-modal-textarea" });
		descInput.value = this.target.description;

		let repoInput: HTMLInputElement | null = null;
		if (this.isLocal) {
			contentEl.createEl("label", {
				text: "Repository URL (optional)",
				cls: "pms-modal-label",
			});
			const savedRepo = this.pluginManager.settings.overrides[this.target.id]?.repoUrl ?? "";
			const fallbackRepo = this.pluginManager.resolvePluginRepoUrl(this.target) ?? "";
			repoInput = contentEl.createEl("input", {
				type: "url",
				cls: "pms-modal-input",
				value: savedRepo,
				placeholder: fallbackRepo || "https://github.com/owner/plugin-id",
			});
		}

		const row = contentEl.createDiv("modal-button-container");

		if (!this.isLocal && this.pluginManager.settings.overrides[this.target.id]) {
			const resetBtn = row.createEl("button", {
				text: "Reset defaults",
				cls: "mod-warning",
			});
			resetBtn.addEventListener("click", () => {
				void (async (): Promise<void> => {
					delete this.pluginManager.settings.overrides[this.target.id];
					await this.pluginManager.saveSettings();
					this.pluginManager.refreshViews();
					new Notice("Restored official details.");
					this.close();
				})();
			});
		}

		const cancel = row.createEl("button", { text: "Cancel" });
		const save = row.createEl("button", { text: "Save changes", cls: "mod-cta" });
		cancel.addEventListener("click", () => this.close());

		save.addEventListener("click", () => {
			void saveChanges();
		});

		const saveChanges = async (): Promise<void> => {
			const newName = nameInput.value.trim() || this.target.id;
			const newAuthor = authorInput.value.trim();
			const newDesc = descInput.value.trim();

			save.disabled = true;
			try {
				if (this.isLocal) {
					const rawRepo = repoInput?.value.trim() ?? "";
					const cleanRepo = sanitizeHttpUrl(rawRepo);
					if (rawRepo && !cleanRepo) {
						new Notice("Enter a valid repository URL.");
						return;
					}
					await this.pluginManager.saveLocalManifest(
						this.target.id,
						newName,
						newAuthor,
						newDesc,
					);
					const existingOverride = this.pluginManager.settings.overrides[this.target.id];
					if (cleanRepo) {
						this.pluginManager.settings.overrides[this.target.id] = {
							...existingOverride,
							repoUrl: cleanRepo,
						};
						await this.pluginManager.saveSettings();
					} else if (existingOverride?.repoUrl) {
						delete existingOverride.repoUrl;
						if (
							!existingOverride.name &&
							!existingOverride.author &&
							!existingOverride.description
						) {
							delete this.pluginManager.settings.overrides[this.target.id];
						}
						await this.pluginManager.saveSettings();
					}
				} else {
					const existingRepo = this.pluginManager.settings.overrides[this.target.id]?.repoUrl;
					this.pluginManager.settings.overrides[this.target.id] = {
						name: newName,
						author: newAuthor,
						description: newDesc,
						...(existingRepo ? { repoUrl: existingRepo } : {}),
					};
					await this.pluginManager.saveSettings();
				}
				this.pluginManager.refreshViews();
				this.close();
			} catch (error) {
				logError("failed saving metadata", error);
				new Notice(`Failed to save: ${errMsg(error)}`);
			} finally {
				save.disabled = false;
			}
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
