import { Modal, type App } from "obsidian";

export class AppUpdateModal extends Modal {
	constructor(
		app: App,
		private readonly currentVersion: string,
		private readonly latestVersion: string,
		private readonly downloadUrl: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("pms-modal-glass", "pms-update-modal");
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pms-google-modal");

		contentEl.createEl("h2", { text: "Obsidian software update available" });

		const badgeWrap = contentEl.createDiv("pms-modal-version-row");
		badgeWrap.createSpan("pms-chip-badge").setText(`Current: v${this.currentVersion}`);
		badgeWrap
			.createSpan("pms-chip-badge is-accent")
			.setText(`Latest: v${this.latestVersion}`);

		contentEl.createEl("p", {
			text: "A new official desktop version of Obsidian is ready to download. Click below to go directly to the Obsidian download page.",
			cls: "pms-modal-desc",
		});

		const row = contentEl.createDiv("modal-button-container");
		const cancel = row.createEl("button", { text: "Later" });
		const download = row.createEl("button", { text: "Download update", cls: "mod-cta" });

		cancel.addEventListener("click", () => this.close());
		download.addEventListener("click", () => {
			window.open(this.downloadUrl);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
