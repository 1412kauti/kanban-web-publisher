/**
 * main.ts — Kanban Web Publisher plugin entry point.
 */

import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, VaultPublisherSettingTab, type VaultPublisherSettings } from "./settings";
import { generateSite, writeSiteToDir } from "./siteGenerator";
import type { Publisher } from "./publishers/types";
import { GitForgePublisher } from "./publishers/gitForgePublisher";
import { S3Publisher } from "./publishers/s3Publisher";
import { LocalGitPublisher } from "./publishers/localGitPublisher";

export default class VaultPublisherPlugin extends Plugin {
  settings: VaultPublisherSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Ribbon icon
    this.addRibbonIcon("upload-cloud", "Kanban Web Publisher", async () => {
      await this.publishVault();
    });

    // Command: Publish
    this.addCommand({
      id: "publish-vault",
      name: "Publish to Web",
      callback: async () => {
        await this.publishVault();
      },
    });

    // Command: Preview locally
    this.addCommand({
      id: "preview-site-locally",
      name: "Preview Site Locally",
      callback: async () => {
        await this.previewSite();
      },
    });

    // Settings tab
    this.addSettingTab(new VaultPublisherSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Validate only that a publish folder is set (target-specific validation is in each publisher). */
  private validateCommon(): string | null {
    if (!this.settings.publishFolder) {
      return "Publish folder is not configured. Go to Settings → Kanban Web Publisher.";
    }
    return null;
  }

  /** Build the right Publisher for the selected target. */
  createPublisher(): Publisher {
    const s = this.settings;
    switch (s.publishTarget) {
      case "github":
      case "gitea":
        return new GitForgePublisher({
          apiUrl: s.gitApiUrl,
          repo: s.gitRepo,
          branch: s.gitBranch,
          token: s.gitToken,
        });
      case "s3":
        return new S3Publisher({
          endpoint: s.s3Endpoint,
          bucket: s.s3Bucket,
          region: s.s3Region,
          accessKey: s.s3AccessKey,
          secretKey: s.s3SecretKey,
          pathPrefix: s.s3PathPrefix,
        });
      case "local-git":
        return new LocalGitPublisher(s.repoPath);
      default:
        return new GitForgePublisher({
          apiUrl: s.gitApiUrl,
          repo: s.gitRepo,
          branch: s.gitBranch,
          token: s.gitToken,
        });
    }
  }

  async publishVault(): Promise<void> {
    const error = this.validateCommon();
    if (error) {
      new Notice(error, 8000);
      return;
    }

    const target = this.settings.publishTarget;
    new Notice(`🔄 Generating site (target: ${target})...`);

    try {
      const site = await generateSite({
        vault: this.app.vault,
        publishFolder: this.settings.publishFolder,
        siteTitle: this.settings.siteTitle,
        theme: this.settings.theme,
        showGraph: this.settings.showGraph,
        obsidianThemeName: this.settings.obsidianThemeName,
      });

      if (site.fileCount === 0) {
        new Notice("No markdown files found in the publish folder.", 5000);
        return;
      }

      new Notice(`✅ Generated ${site.fileCount} pages. Publishing...`);

      const publisher = this.createPublisher();
      const result = await publisher.publish(site.files, this.settings.commitMessage);

      if (result.success) {
        const urlNote = result.url ? `\n${result.url}` : "";
        new Notice(`🚀 ${result.message}${urlNote}`, 8000);
      } else {
        new Notice(`⚠️ ${result.message}`, 10000);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`❌ Publish failed: ${msg}`, 10000);
      console.error("Kanban Web Publisher error:", err);
    }
  }

  async previewSite(): Promise<void> {
    const error = this.validateCommon();
    if (error) {
      new Notice(error, 8000);
      return;
    }

    new Notice("🔄 Generating preview...");

    try {
      const site = await generateSite({
        vault: this.app.vault,
        publishFolder: this.settings.publishFolder,
        siteTitle: this.settings.siteTitle,
        theme: this.settings.theme,
        showGraph: this.settings.showGraph,
        obsidianThemeName: this.settings.obsidianThemeName,
      });

      if (site.fileCount === 0) {
        new Notice("No markdown files found in the publish folder.", 5000);
        return;
      }

      // Write to temp directory
      const os = require("os") as typeof import("os");
      const path = require("path") as typeof import("path");
      const previewDir = path.join(os.tmpdir(), "kanban-web-publisher-preview");
      writeSiteToDir(site, previewDir);
      new Notice(`✅ Generated ${site.fileCount} pages.`);

      // Open in browser
      const indexPath = path.join(previewDir, "index.html");
      const { exec } = require("child_process") as typeof import("child_process");

      const platform = process.platform;
      const cmd =
        platform === "win32" ? `start "" "${indexPath}"` :
        platform === "darwin" ? `open "${indexPath}"` :
        `xdg-open "${indexPath}"`;

      exec(cmd, (err) => {
        if (err) new Notice(`Could not open browser: ${err.message}`, 5000);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`❌ Preview failed: ${msg}`, 10000);
      console.error("Kanban Web Publisher error:", err);
    }
  }
}
