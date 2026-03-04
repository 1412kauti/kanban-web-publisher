/**
 * types.ts — Shared publisher interface and types.
 */

export type PublishTarget = "github" | "gitea" | "s3" | "local-git";

export interface PublishResult {
  success: boolean;
  message: string;
  /** Optional URL to the deployed site */
  url?: string;
}

export interface Publisher {
  /**
   * Publish a set of files to the target.
   * @param files  Map of relativePath → file content (string)
   * @param message  Commit message (used by git targets, ignored by S3)
   */
  publish(files: Map<string, string>, message: string): Promise<PublishResult>;

  /** Lightweight connectivity check — verifies credentials, endpoint, and access. */
  testConnection(): Promise<PublishResult>;
}

// ── Git forge settings (GitHub / Gitea) ──────────────────────────────────

export interface GitForgeConfig {
  /** API base URL — e.g. "https://api.github.com" or "https://gitea.example.com/api/v1" */
  apiUrl: string;
  /** Repository in "owner/repo" format */
  repo: string;
  /** Target branch (default "main") */
  branch: string;
  /** Personal access token */
  token: string;
}

// ── S3-compatible settings ───────────────────────────────────────────────

export interface S3Config {
  /** Endpoint URL — e.g. "https://s3.amazonaws.com" or R2/MinIO endpoint */
  endpoint: string;
  /** Bucket name */
  bucket: string;
  /** AWS region (default "us-east-1") */
  region: string;
  /** Access key ID */
  accessKey: string;
  /** Secret access key */
  secretKey: string;
  /** Optional path prefix inside the bucket (e.g. "sites/my-vault/") */
  pathPrefix: string;
}
