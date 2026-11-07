import { Modal, type App } from "obsidian";
import { logError } from "../utils/format";

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly titleText: string,
		private readonly message: string,
		private readonly confirmText: string,
		private readonly onConfirm: () => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("pms-modal-glass", "pms-confirm-modal");
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.titleText });
		contentEl.createEl("p", { text: this.message });

		const row = contentEl.createDiv("modal-button-container");
		const cancel = row.createEl("button", { text: "Cancel" });
		const ok = row.createEl("button", { text: this.confirmText, cls: "mod-warning" });

		cancel.addEventListener("click", () => this.close());
		ok.addEventListener("click", () => {
			this.close();
			try {
				const result = this.onConfirm();
				if (result instanceof Promise) {
					result.catch((error: unknown) => logError("confirm action failed", error));
				}
			} catch (error) {
				logError("confirm action failed", error);
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
