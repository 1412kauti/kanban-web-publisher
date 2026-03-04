/**
 * localGitPublisher.ts — Write to local filesystem + git add/commit/push via CLI.
 * This is the original publishing method, kept as a fallback.
 */

import type { Publisher, PublishResult } from "./types";

function exec(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const { exec: cpExec } = require("child_process") as typeof import("child_process");
    cpExec(cmd, { cwd, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd}\n${stderr || err.message}`));
      else resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

export class LocalGitPublisher implements Publisher {
  constructor(private repoPath: string) {}

  async testConnection(): Promise<PublishResult> {
    const repoPath = this.repoPath;

    if (!repoPath) {
      return { success: false, message: "Local repo path is required." };
    }

    const fs = require("fs") as typeof import("fs");
    if (!fs.existsSync(repoPath)) {
      return { success: false, message: `Path does not exist: ${repoPath}` };
    }

    try {
      await exec("git rev-parse --is-inside-work-tree", repoPath);
    } catch {
      return { success: false, message: `Not a git repository: ${repoPath}` };
    }

    // Check for remote
    try {
      const { stdout } = await exec("git remote -v", repoPath);
      if (!stdout.trim()) {
        return { success: true, message: `Git repo found at ${repoPath}, but no remote configured.` };
      }
      const remoteLine = stdout.split("\n")[0] || "";
      return { success: true, message: `Git repo OK — remote: ${remoteLine.trim()}` };
    } catch {
      return { success: true, message: `Git repo found at ${repoPath} (could not read remotes).` };
    }
  }

  async publish(files: Map<string, string>, message: string): Promise<PublishResult> {
    const repoPath = this.repoPath;

    if (!repoPath) {
      return { success: false, message: "Local repo path is required." };
    }

    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");

    if (!fs.existsSync(repoPath)) {
      return { success: false, message: `Deploy repo path does not exist: ${repoPath}` };
    }

    try {
      // Clean old generated files (except .git)
      const cleanDir = (dir: string): void => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir)) {
          if (entry === ".git" || entry === ".gitignore" || entry === "node_modules") continue;
          const fullPath = path.join(dir, entry);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            cleanDir(fullPath);
            if (fs.readdirSync(fullPath).length === 0) {
              fs.rmdirSync(fullPath);
            }
          } else {
            fs.unlinkSync(fullPath);
          }
        }
      };
      cleanDir(repoPath);

      // Write all files
      for (const [relFilePath, content] of files) {
        const fullPath = path.join(repoPath, relFilePath);
        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, content, "utf-8");
      }

      // Check if it's a git repo
      try {
        await exec("git rev-parse --is-inside-work-tree", repoPath);
      } catch {
        return { success: false, message: `Not a git repository: ${repoPath}\nRun 'git init' in that folder first.` };
      }

      // Stage all changes
      await exec("git add -A", repoPath);

      // Check if there are changes to commit
      const { stdout: status } = await exec("git status --porcelain", repoPath);
      if (!status.trim()) {
        return { success: true, message: "No changes to publish." };
      }

      // Commit
      const safeMsg = message.replace(/"/g, '\\"');
      await exec(`git commit -m "${safeMsg}"`, repoPath);

      // Push
      try {
        await exec("git push", repoPath);
      } catch (pushErr: unknown) {
        const errMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        return {
          success: false,
          message: `Committed locally but push failed:\n${errMsg}\nMake sure you have a remote configured and network access.`,
        };
      }

      return { success: true, message: "Published successfully! Changes pushed to remote." };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Local git error: ${errMsg}` };
    }
  }
}
