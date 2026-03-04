/**
 * gitForgePublisher.ts — Publish to GitHub / Gitea via their Git Data REST API.
 *
 * Flow:
 *   1. Get current branch ref → commit SHA
 *   2. Get that commit's tree SHA
 *   3. Create a blob for every file (base64)
 *   4. Create a new tree with all blobs (replaces entire tree)
 *   5. Create a new commit with the new tree
 *   6. Update the branch ref to point to the new commit
 *
 * Works with GitHub (api.github.com) and Gitea/Forgejo (custom URL) — they share
 * the same API shape for git data endpoints.
 */

import { requestUrl } from "obsidian";
import type { Publisher, PublishResult, GitForgeConfig } from "./types";

export class GitForgePublisher implements Publisher {
  constructor(private config: GitForgeConfig) {}

  async testConnection(): Promise<PublishResult> {
    const { apiUrl, repo, branch, token } = this.config;

    if (!repo || !token) {
      return { success: false, message: "Repository and token are required." };
    }

    const base = apiUrl.replace(/\/+$/, "");
    const repoBase = `${base}/repos/${repo}`;
    const headers: Record<string, string> = {
      Authorization: `token ${token}`,
      Accept: "application/json",
    };

    try {
      // Check repo access + auth
      const repoRes = await requestUrl({ url: repoBase, headers });
      const repoName: string = repoRes.json?.full_name || repo;
      const perms = repoRes.json?.permissions;
      const canPush = perms?.push ?? perms?.admin ?? true;

      if (!canPush) {
        return { success: false, message: `Authenticated, but no push access to ${repoName}.` };
      }

      // Check branch exists
      try {
        await requestUrl({ url: `${repoBase}/git/ref/heads/${branch}`, headers });
      } catch {
        return { success: false, message: `Connected to ${repoName}, but branch "${branch}" not found.` };
      }

      return { success: true, message: `Connected to ${repoName} (branch: ${branch}) — push access confirmed.` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("401") || msg.includes("403")) {
        return { success: false, message: "Authentication failed — check your token." };
      }
      if (msg.includes("404")) {
        return { success: false, message: `Repository "${repo}" not found — check the name and token permissions.` };
      }
      return { success: false, message: `Connection failed: ${msg}` };
    }
  }

  async publish(files: Map<string, string>, message: string): Promise<PublishResult> {
    const { apiUrl, repo, branch, token } = this.config;

    if (!repo || !token) {
      return { success: false, message: "Repository and token are required." };
    }

    const base = apiUrl.replace(/\/+$/, "");
    const repoBase = `${base}/repos/${repo}`;

    const headers: Record<string, string> = {
      Authorization: `token ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    try {
      // ── 1. Get current branch ref ──────────────────────────────────────
      let currentCommitSha: string;
      try {
        const refRes = await requestUrl({
          url: `${repoBase}/git/ref/heads/${branch}`,
          headers,
        });
        currentCommitSha = refRes.json?.object?.sha;
      } catch {
        // Branch might not exist — try to create it from default branch
        return {
          success: false,
          message: `Branch "${branch}" not found in ${repo}. Create it first.`,
        };
      }

      if (!currentCommitSha) {
        return { success: false, message: "Could not read current commit SHA." };
      }

      // ── 2. Get current tree SHA ────────────────────────────────────────
      const commitRes = await requestUrl({
        url: `${repoBase}/git/commits/${currentCommitSha}`,
        headers,
      });
      const _baseTreeSha: string = commitRes.json?.tree?.sha;

      // ── 3. Create blobs for every file ─────────────────────────────────
      const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];

      for (const [filePath, content] of files) {
        const blobRes = await requestUrl({
          url: `${repoBase}/git/blobs`,
          method: "POST",
          headers,
          body: JSON.stringify({
            content: Buffer.from(content, "utf-8").toString("base64"),
            encoding: "base64",
          }),
        });

        treeItems.push({
          path: filePath,
          mode: "100644",
          type: "blob",
          sha: blobRes.json.sha,
        });
      }

      // ── 4. Create new tree (full replacement, not base_tree) ───────────
      const treeRes = await requestUrl({
        url: `${repoBase}/git/trees`,
        method: "POST",
        headers,
        body: JSON.stringify({ tree: treeItems }),
      });
      const newTreeSha: string = treeRes.json.sha;

      // ── 5. Create commit ───────────────────────────────────────────────
      const commitCreateRes = await requestUrl({
        url: `${repoBase}/git/commits`,
        method: "POST",
        headers,
        body: JSON.stringify({
          message,
          tree: newTreeSha,
          parents: [currentCommitSha],
        }),
      });
      const newCommitSha: string = commitCreateRes.json.sha;

      // ── 6. Update branch ref ───────────────────────────────────────────
      await requestUrl({
        url: `${repoBase}/git/refs/heads/${branch}`,
        method: "PATCH",
        headers,
        body: JSON.stringify({ sha: newCommitSha, force: true }),
      });

      // Build a reasonable URL for the user
      const repoUrl = base.includes("api.github.com")
        ? `https://github.com/${repo}`
        : `${new URL(base).origin}/${repo}`;

      return {
        success: true,
        message: `Published ${files.size} files to ${repo}@${branch}`,
        url: repoUrl,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Git API error: ${msg}` };
    }
  }
}
