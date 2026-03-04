/**
 * gitPublisher.ts — Git add, commit, push via child_process (desktop only).
 */

export interface GitResult {
  success: boolean;
  message: string;
}

function exec(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const { exec: cpExec } = require("child_process") as typeof import("child_process");
    cpExec(cmd, { cwd, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd}\n${stderr || err.message}`));
      else resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

export async function gitPublish(repoPath: string, commitMessage: string): Promise<GitResult> {
  try {
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
    const safeMsg = commitMessage.replace(/"/g, '\\"');
    await exec(`git commit -m "${safeMsg}"`, repoPath);

    // Push
    try {
      await exec("git push", repoPath);
    } catch (pushErr: unknown) {
      const errMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      // If push fails, commit was still made locally
      return {
        success: false,
        message: `Committed locally but push failed:\n${errMsg}\nMake sure you have a remote configured and network access.`,
      };
    }

    return { success: true, message: "Published successfully! Changes pushed to remote." };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Git error: ${errMsg}` };
  }
}
