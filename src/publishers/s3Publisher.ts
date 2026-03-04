/**
 * s3Publisher.ts — Publish to any S3-compatible object store.
 *
 * Implements AWS Signature V4 manually using Node's built-in crypto module,
 * so no AWS SDK dependency is needed. Works with:
 *   - AWS S3
 *   - Cloudflare R2
 *   - MinIO
 *   - Backblaze B2 (S3-compatible API)
 *   - Any other S3-compatible endpoint
 */

import { requestUrl } from "obsidian";
import type { Publisher, PublishResult, S3Config } from "./types";

// ── Content-Type mapping ─────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

function contentType(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

// ── SigV4 helpers ────────────────────────────────────────────────────────

function hmacSha256(key: Buffer | string, data: string): Buffer {
  const crypto = require("crypto") as typeof import("crypto");
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string | Buffer): string {
  const crypto = require("crypto") as typeof import("crypto");
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getSignatureKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256("AWS4" + secretKey, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

interface SignedHeaders {
  Authorization: string;
  "x-amz-date": string;
  "x-amz-content-sha256": string;
  [key: string]: string;
}

function signRequest(opts: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | Buffer;
  accessKey: string;
  secretKey: string;
  region: string;
  service?: string;
}): SignedHeaders {
  const { method, url: fullUrl, headers, body, accessKey, secretKey, region, service = "s3" } = opts;
  const parsedUrl = new URL(fullUrl);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256Hex(typeof body === "string" ? Buffer.from(body, "utf-8") : body);

  // Canonical headers (sorted)
  const signedHeadersObj: Record<string, string> = {
    host: parsedUrl.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...headers,
  };

  const sortedKeys = Object.keys(signedHeadersObj).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k.toLowerCase()}:${signedHeadersObj[k]!.trim()}`).join("\n") + "\n";
  const signedHeadersStr = sortedKeys.map((k) => k.toLowerCase()).join(";");

  // Canonical request
  const canonicalRequest = [
    method,
    parsedUrl.pathname,
    parsedUrl.search ? parsedUrl.search.slice(1) : "",
    canonicalHeaders,
    signedHeadersStr,
    payloadHash,
  ].join("\n");

  // String to sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  // Signature
  const signingKey = getSignatureKey(secretKey, dateStamp, region, service);
  const signature = hmacSha256(signingKey, stringToSign).toString("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  return {
    Authorization: authorization,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
}

// ── S3Publisher ──────────────────────────────────────────────────────────

export class S3Publisher implements Publisher {
  constructor(private config: S3Config) {}

  async testConnection(): Promise<PublishResult> {
    const { endpoint, bucket, accessKey, secretKey, region } = this.config;

    if (!endpoint || !bucket || !accessKey || !secretKey) {
      return { success: false, message: "Endpoint, bucket, access key, and secret key are all required." };
    }

    const url = `${endpoint.replace(/\/+$/, "")}/${bucket}?list-type=2&max-keys=1`;

    try {
      const sigHeaders = signRequest({
        method: "GET",
        url,
        headers: {},
        body: "",
        accessKey,
        secretKey,
        region: region || "us-east-1",
      });

      const res = await requestUrl({ url, headers: sigHeaders });
      const text = res.text || "";

      if (text.includes("<ListBucketResult") || text.includes("<Contents>") || text.includes("</ListBucketResult>")) {
        return { success: true, message: `Connected to s3://${bucket} — credentials valid, bucket accessible.` };
      }

      return { success: true, message: `Connected to s3://${bucket} (response received).` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("403") || msg.includes("SignatureDoesNotMatch") || msg.includes("InvalidAccessKeyId")) {
        return { success: false, message: "Authentication failed — check your access key and secret." };
      }
      if (msg.includes("404") || msg.includes("NoSuchBucket")) {
        return { success: false, message: `Bucket "${bucket}" not found at ${endpoint}.` };
      }
      return { success: false, message: `Connection failed: ${msg}` };
    }
  }

  private objectUrl(key: string): string {
    const endpoint = this.config.endpoint.replace(/\/+$/, "");
    const bucket = this.config.bucket;

    // Path-style: endpoint/bucket/key  (works with most S3-compatible stores)
    return `${endpoint}/${bucket}/${key}`;
  }

  private async putObject(key: string, body: string): Promise<void> {
    const url = this.objectUrl(key);
    const ct = contentType(key);
    const bodyBuf = Buffer.from(body, "utf-8");

    const extraHeaders: Record<string, string> = {
      "content-type": ct,
      "content-length": String(bodyBuf.length),
    };

    const sigHeaders = signRequest({
      method: "PUT",
      url,
      headers: extraHeaders,
      body: bodyBuf,
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
      region: this.config.region || "us-east-1",
    });

    await requestUrl({
      url,
      method: "PUT",
      headers: { ...extraHeaders, ...sigHeaders },
      body: body,
    });
  }

  private async listObjects(prefix: string): Promise<string[]> {
    const endpoint = this.config.endpoint.replace(/\/+$/, "");
    const bucket = this.config.bucket;
    const url = `${endpoint}/${bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}`;

    const sigHeaders = signRequest({
      method: "GET",
      url,
      headers: {},
      body: "",
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
      region: this.config.region || "us-east-1",
    });

    try {
      const res = await requestUrl({ url, headers: sigHeaders });
      const text = res.text || "";
      // Parse XML keys from response
      const keys: string[] = [];
      const re = /<Key>([^<]+)<\/Key>/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        keys.push(m[1]!);
      }
      return keys;
    } catch {
      // If list fails (e.g. empty bucket), continue
      return [];
    }
  }

  private async deleteObject(key: string): Promise<void> {
    const url = this.objectUrl(key);

    const sigHeaders = signRequest({
      method: "DELETE",
      url,
      headers: {},
      body: "",
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
      region: this.config.region || "us-east-1",
    });

    try {
      await requestUrl({ url, method: "DELETE", headers: sigHeaders });
    } catch {
      // Ignore delete errors for individual files
    }
  }

  async publish(files: Map<string, string>, _message: string): Promise<PublishResult> {
    const { bucket, accessKey, secretKey, pathPrefix } = this.config;

    if (!bucket || !accessKey || !secretKey) {
      return { success: false, message: "S3 bucket, access key, and secret key are required." };
    }

    const prefix = (pathPrefix || "").replace(/\/+$/, "");

    try {
      // 1. List existing objects to find stale ones
      const existingKeys = await this.listObjects(prefix ? prefix + "/" : "");
      const newKeys = new Set<string>();

      // 2. Upload all files
      let uploaded = 0;
      for (const [filePath, content] of files) {
        const key = prefix ? `${prefix}/${filePath}` : filePath;
        newKeys.add(key);
        await this.putObject(key, content);
        uploaded++;
      }

      // 3. Delete stale objects (exist in bucket but not in new site)
      let deleted = 0;
      for (const existingKey of existingKeys) {
        if (!newKeys.has(existingKey)) {
          await this.deleteObject(existingKey);
          deleted++;
        }
      }

      const endpoint = this.config.endpoint.replace(/\/+$/, "");
      const siteUrl = prefix
        ? `${endpoint}/${bucket}/${prefix}/index.html`
        : `${endpoint}/${bucket}/index.html`;

      return {
        success: true,
        message: `Uploaded ${uploaded} files to s3://${bucket}/${prefix || ""}${deleted > 0 ? ` (removed ${deleted} stale)` : ""}`,
        url: siteUrl,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `S3 error: ${msg}` };
    }
  }
}
