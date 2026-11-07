import { PluginSettingTab, Setting, type App } from "obsidian";
import type PluginManagerSidebar from "./main";
import type { PluginScope, PluginViewMode, SortBy } from "./types";

export class PluginManagerSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: PluginManagerSidebar,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Appearance and behavior").setHeading();

		new Setting(containerEl)
			.setName("Frosted glassmorphism")
			.setDesc(
				"Enable translucent glass panels, subtle border luminance, and Material 3 elevation.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.glassmorphism).onChange(async (value) => {
					this.plugin.settings.glassmorphism = value;
					await this.plugin.saveSettings();
					this.plugin.applyThemePreferences();
				}),
			);

		new Setting(containerEl)
			.setName("Default view mode")
			.setDesc(
				"Choose whether to display plugins grouped by status (enabled/disabled) or by custom groups.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("status", "Status groups (Enabled / Disabled)")
					.addOption("group", "Custom action groups")
					.setValue(this.plugin.settings.view)
					.onChange(async (value) => {
						this.plugin.settings.view = value as PluginViewMode;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName("Default scope")
			.setDesc("Choose which plugins are listed by default when opening the manager.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("community", "Community plugins only")
					.addOption("core", "Core built-in plugins only")
					.addOption("all", "All plugins (community + core)")
					.setValue(this.plugin.settings.scope)
					.onChange(async (value) => {
						this.plugin.settings.scope = value as PluginScope;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName("Default sort order")
			.setDesc("Choose how plugin cards are sorted in lists.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("status", "Enabled first, then alphabetical")
					.addOption("alphabetical", "Pure alphabetical (A-Z)")
					.setValue(this.plugin.settings.sortBy)
					.onChange(async (value) => {
						this.plugin.settings.sortBy = value as SortBy;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-check for updates")
			.setDesc(
				"Automatically check for Obsidian and community plugin updates when loading.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoCheckUpdates).onChange(async (value) => {
					this.plugin.settings.autoCheckUpdates = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
