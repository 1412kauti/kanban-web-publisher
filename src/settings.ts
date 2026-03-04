/**
 * settings.ts — Plugin settings and settings tab UI.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultPublisherPlugin from "./main";
import type { PublishTarget } from "./publishers/types";

export interface VaultPublisherSettings {
  publishFolder: string;
  siteTitle: string;
  theme: "dark" | "light";
  commitMessage: string;
  showGraph: boolean;
  obsidianThemeName: string;

  // Publish target
  publishTarget: PublishTarget;

  // GitHub / Gitea
  gitApiUrl: string;
  gitRepo: string;
  gitBranch: string;
  gitToken: string;

  // S3-compatible
  s3Endpoint: string;
  s3Bucket: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3PathPrefix: string;

  // Local git (legacy)
  repoPath: string;
}

export const DEFAULT_SETTINGS: VaultPublisherSettings = {
  publishFolder: "",
  siteTitle: "My Vault",
  theme: "dark",
  commitMessage: "Update published vault",
  showGraph: true,
  obsidianThemeName: "",

  publishTarget: "github",

  gitApiUrl: "https://api.github.com",
  gitRepo: "",
  gitBranch: "main",
  gitToken: "",

  s3Endpoint: "",
  s3Bucket: "",
  s3Region: "us-east-1",
  s3AccessKey: "",
  s3SecretKey: "",
  s3PathPrefix: "",

  repoPath: "",
};

export class VaultPublisherSettingTab extends PluginSettingTab {
  plugin: VaultPublisherPlugin;

  constructor(app: App, plugin: VaultPublisherPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Kanban Web Publisher Settings" });

    // ── General ──────────────────────────────────────────────────────────

    new Setting(containerEl)
      .setName("Publish folder")
      .setDesc("The vault folder to publish (e.g. 'Viskefi/Daily'). Leave empty to publish the entire vault.")
      .addText((text) =>
        text
          .setPlaceholder("folder/path")
          .setValue(this.plugin.settings.publishFolder)
          .onChange(async (value) => {
            this.plugin.settings.publishFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Site title")
      .setDesc("Displayed in the sidebar header and page titles.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.siteTitle)
          .onChange(async (value) => {
            this.plugin.settings.siteTitle = value.trim() || "My Vault";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Theme")
      .setDesc("Default theme for the published site.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("dark", "Dark")
          .addOption("light", "Light")
          .setValue(this.plugin.settings.theme)
          .onChange(async (value) => {
            this.plugin.settings.theme = value as "dark" | "light";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show graph view")
      .setDesc("Include an interactive graph visualizer showing note connections.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showGraph).onChange(async (value) => {
          this.plugin.settings.showGraph = value;
          await this.plugin.saveSettings();
        })
      );

    // ── Obsidian theme picker ────────────────────────────────────────────

    const themeSetting = new Setting(containerEl)
      .setName("Obsidian theme")
      .setDesc("Apply an installed Obsidian community theme to the published site.");

    try {
      const fs = require("fs") as typeof import("fs");
      const path = require("path") as typeof import("path");
      const vaultRoot = (this.app.vault.adapter as any).basePath as string;
      const themesDir = path.join(vaultRoot, ".obsidian", "themes");
      let themeNames: string[] = [];
      if (fs.existsSync(themesDir)) {
        themeNames = fs.readdirSync(themesDir).filter((entry: string) => {
          const fullPath = path.join(themesDir, entry);
          return fs.statSync(fullPath).isDirectory() && fs.existsSync(path.join(fullPath, "theme.css"));
        });
      }

      themeSetting.addDropdown((dropdown) => {
        dropdown.addOption("", "None (use defaults)");
        for (const name of themeNames) {
          dropdown.addOption(name, name);
        }
        dropdown.setValue(this.plugin.settings.obsidianThemeName);
        dropdown.onChange(async (value) => {
          this.plugin.settings.obsidianThemeName = value;
          await this.plugin.saveSettings();
        });
      });
    } catch {
      themeSetting.setDesc("Could not read installed themes.");
    }

    // ── Publishing ───────────────────────────────────────────────────────

    containerEl.createEl("h3", { text: "Publishing" });

    const targetSettingsContainer = containerEl.createDiv();

    new Setting(containerEl)
      .setName("Publish target")
      .setDesc("Where to deploy the generated site.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("github", "GitHub")
          .addOption("gitea", "Gitea / Forgejo")
          .addOption("s3", "S3 Compatible (R2, MinIO, …)")
          .addOption("local-git", "Local Git Repo")
          .setValue(this.plugin.settings.publishTarget)
          .onChange(async (value) => {
            this.plugin.settings.publishTarget = value as PublishTarget;
            await this.plugin.saveSettings();
            this.renderTargetSettings(targetSettingsContainer);
          })
      );

    containerEl.appendChild(targetSettingsContainer);
    this.renderTargetSettings(targetSettingsContainer);

    new Setting(containerEl)
      .setName("Commit message")
      .setDesc("Git commit message template (used by GitHub, Gitea, and Local Git).")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.commitMessage)
          .onChange(async (value) => {
            this.plugin.settings.commitMessage = value || "Update published vault";
            await this.plugin.saveSettings();
          })
      );
  }

  // ── Render target-specific fields ────────────────────────────────────

  private renderTargetSettings(container: HTMLElement): void {
    container.empty();
    const target = this.plugin.settings.publishTarget;

    if (target === "github" || target === "gitea") {
      this.renderGitForgeSettings(container, target);
    } else if (target === "s3") {
      this.renderS3Settings(container);
    } else if (target === "local-git") {
      this.renderLocalGitSettings(container);
    }
  }

  private renderGitForgeSettings(container: HTMLElement, target: "github" | "gitea"): void {
    if (target === "gitea") {
      new Setting(container)
        .setName("API base URL")
        .setDesc("Your Gitea/Forgejo instance API URL (e.g. 'https://gitea.example.com/api/v1').")
        .addText((text) =>
          text
            .setPlaceholder("https://gitea.example.com/api/v1")
            .setValue(this.plugin.settings.gitApiUrl)
            .onChange(async (value) => {
              this.plugin.settings.gitApiUrl = value.trim();
              await this.plugin.saveSettings();
            })
        );
    } else {
      this.plugin.settings.gitApiUrl = "https://api.github.com";
    }

    new Setting(container)
      .setName("Repository")
      .setDesc("In 'owner/repo' format (e.g. 'kautilya/vault-site').")
      .addText((text) =>
        text
          .setPlaceholder("owner/repo")
          .setValue(this.plugin.settings.gitRepo)
          .onChange(async (value) => {
            this.plugin.settings.gitRepo = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName("Branch")
      .setDesc("Target branch to publish to.")
      .addText((text) =>
        text
          .setPlaceholder("main")
          .setValue(this.plugin.settings.gitBranch)
          .onChange(async (value) => {
            this.plugin.settings.gitBranch = value.trim() || "main";
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName("Personal access token")
      .setDesc("Token with repo/write permissions. Stored locally in plugin data.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("ghp_... or token")
          .setValue(this.plugin.settings.gitToken)
          .onChange(async (value) => {
            this.plugin.settings.gitToken = value.trim();
            await this.plugin.saveSettings();
          });
      });

    this.addTestConnectionButton(container);
  }

  private renderS3Settings(container: HTMLElement): void {
    new Setting(container)
      .setName("S3 endpoint")
      .setDesc("S3-compatible endpoint URL (e.g. 'https://s3.amazonaws.com', R2/MinIO endpoint).")
      .addText((text) =>
        text
          .setPlaceholder("https://s3.amazonaws.com")
          .setValue(this.plugin.settings.s3Endpoint)
          .onChange(async (value) => {
            this.plugin.settings.s3Endpoint = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName("Bucket")
      .setDesc("S3 bucket name.")
      .addText((text) =>
        text
          .setPlaceholder("my-vault-site")
          .setValue(this.plugin.settings.s3Bucket)
          .onChange(async (value) => {
            this.plugin.settings.s3Bucket = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName("Region")
      .setDesc("AWS region (e.g. 'us-east-1'). For R2/MinIO, use 'auto' or 'us-east-1'.")
      .addText((text) =>
        text
          .setPlaceholder("us-east-1")
          .setValue(this.plugin.settings.s3Region)
          .onChange(async (value) => {
            this.plugin.settings.s3Region = value.trim() || "us-east-1";
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName("Access key ID")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("AKIA...")
          .setValue(this.plugin.settings.s3AccessKey)
          .onChange(async (value) => {
            this.plugin.settings.s3AccessKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(container)
      .setName("Secret access key")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("secret")
          .setValue(this.plugin.settings.s3SecretKey)
          .onChange(async (value) => {
            this.plugin.settings.s3SecretKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(container)
      .setName("Path prefix")
      .setDesc("Optional prefix inside the bucket (e.g. 'sites/vault'). Leave empty for bucket root.")
      .addText((text) =>
        text
          .setPlaceholder("sites/my-vault")
          .setValue(this.plugin.settings.s3PathPrefix)
          .onChange(async (value) => {
            this.plugin.settings.s3PathPrefix = value.trim();
            await this.plugin.saveSettings();
          })
      );

    this.addTestConnectionButton(container);
  }

  private renderLocalGitSettings(container: HTMLElement): void {
    new Setting(container)
      .setName("Local repo path")
      .setDesc("Local filesystem path to a git repository. Files are written here and pushed via git CLI.")
      .addText((text) =>
        text
          .setPlaceholder("C:\\Users\\...\\vault-site")
          .setValue(this.plugin.settings.repoPath)
          .onChange(async (value) => {
            this.plugin.settings.repoPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    this.addTestConnectionButton(container);
  }

  // ── Test connection button ─────────────────────────────────────────────

  private addTestConnectionButton(container: HTMLElement): void {
    const setting = new Setting(container)
      .setName("Test connection")
      .setDesc("Verify that the configured target is reachable.");

    const resultEl = container.createEl("div", { cls: "kwp-test-result" });
    resultEl.style.padding = "4px 16px 12px";
    resultEl.style.fontSize = "13px";
    resultEl.style.display = "none";

    setting.addButton((btn) =>
      btn.setButtonText("Test").onClick(async () => {
        btn.setButtonText("Testing…");
        btn.setDisabled(true);
        resultEl.style.display = "block";
        resultEl.style.color = "";
        resultEl.setText("Connecting…");

        try {
          const publisher = this.plugin.createPublisher();
          const result = await publisher.testConnection();

          if (result.success) {
            resultEl.style.color = "var(--text-success, #a6e3a1)";
            resultEl.setText(`✅ ${result.message}`);
          } else {
            resultEl.style.color = "var(--text-error, #f38ba8)";
            resultEl.setText(`❌ ${result.message}`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          resultEl.style.color = "var(--text-error, #f38ba8)";
          resultEl.setText(`❌ ${msg}`);
        }

        btn.setButtonText("Test");
        btn.setDisabled(false);
      })
    );
  }
}
