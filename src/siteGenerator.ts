/**
 * siteGenerator.ts — Walks a vault folder, parses all .md files, generates a static site.
 */

import { Vault, TFile, TFolder, TAbstractFile, normalizePath } from "obsidian";
import { parseFile, buildGraphData, type ParsedFile, type GraphData } from "./parser";
import {
  buildFileTree,
  renderFileTree,
  renderKanbanContent,
  generatePageHtml,
  generateGraphPageHtml,
  generateCSS,
  generateMainJS,
  generateGraphJS,
  generateFullGraphJS,
} from "./templateEngine";

export interface SiteGeneratorOptions {
  vault: Vault;
  publishFolder: string;  // relative folder path in vault
  siteTitle: string;
  theme: string;          // "dark" | "light"
  showGraph: boolean;
  obsidianThemeName: string; // name of Obsidian community theme (folder name under .obsidian/themes/)
}

export interface GeneratedSite {
  files: Map<string, string>; // relativePath -> content
  fileCount: number;
}

// ── Walk vault folder ────────────────────────────────────────────────────

function getMarkdownFiles(vault: Vault, folderPath: string): TFile[] {
  const folder = vault.getAbstractFileByPath(normalizePath(folderPath));
  if (!folder || !(folder instanceof TFolder)) return [];

  const files: TFile[] = [];
  const walk = (f: TAbstractFile): void => {
    if (f instanceof TFile && f.extension === "md") {
      // Skip hidden/trash files
      if (!f.path.includes("/.trash/") && !f.path.includes("\\.trash\\")) {
        files.push(f);
      }
    }
    if (f instanceof TFolder) {
      f.children.forEach(walk);
    }
  };
  walk(folder);
  return files;
}

// ── Compute relative path from publish root ──────────────────────────────

function relPath(filePath: string, rootFolder: string): string {
  const norm = filePath.replace(/\\/g, "/");
  const rootNorm = rootFolder.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  if (norm.startsWith(rootNorm)) return norm.slice(rootNorm.length);
  return norm;
}

// ── Compute base path (../ depth) for a given file ───────────────────────

function computeBasePath(relativePath: string): string {
  const depth = (relativePath.match(/\//g) || []).length;
  if (depth === 0) return "";
  return "../".repeat(depth);
}

// ── Generate the full site ───────────────────────────────────────────────

export async function generateSite(opts: SiteGeneratorOptions): Promise<GeneratedSite> {
  const { vault, publishFolder, siteTitle, theme, showGraph, obsidianThemeName } = opts;
  const mdFiles = getMarkdownFiles(vault, publishFolder);
  const output = new Map<string, string>();

  // Load Obsidian community theme CSS if configured
  let hasThemeCSS = false;
  if (obsidianThemeName) {
    try {
      const fs = require("fs") as typeof import("fs");
      const path = require("path") as typeof import("path");
      // vault.adapter.basePath gives the vault root on disk
      const vaultRoot = (vault.adapter as any).basePath as string;
      const themeCSSPath = path.join(vaultRoot, ".obsidian", "themes", obsidianThemeName, "theme.css");
      if (fs.existsSync(themeCSSPath)) {
        const themeCSS = fs.readFileSync(themeCSSPath, "utf-8");
        output.set("assets/obsidian-theme.css", themeCSS);
        hasThemeCSS = true;
      }
    } catch (e) {
      console.warn("Failed to load Obsidian theme CSS:", e);
    }
  }

  // 1. Parse all files
  const parsedFiles: ParsedFile[] = [];
  for (const file of mdFiles) {
    const content = await vault.cachedRead(file);
    const rel = relPath(file.path, publishFolder);
    const parsed = parseFile(content, file.name, rel);
    parsedFiles.push(parsed);
  }

  // 2. Build file tree and graph data
  const fileTree = buildFileTree(parsedFiles);
  const graphData = buildGraphData(parsedFiles);

  // 3. Generate HTML for each file
  for (const pf of parsedFiles) {
    const htmlPath = pf.relativePath.replace(/\.md$/i, ".html");
    const basePath = computeBasePath(htmlPath);
    const sidebarHtml = renderFileTree(fileTree, htmlPath, basePath);

    let content: string;
    if (pf.isKanban && pf.kanban) {
      content = renderKanbanContent(pf.kanban, pf.rawMarkdown);
    } else {
      content = pf.htmlContent;
    }

    const pageHtml = generatePageHtml({
      title: pf.title,
      siteTitle,
      content,
      sidebarHtml,
      currentPath: htmlPath,
      theme,
      showGraph,
      basePath,
      hasThemeCSS,
    });

    output.set(htmlPath, pageHtml);
  }

  // 4. Generate index.html (redirect to first file or listing)
  if (parsedFiles.length > 0 && !output.has("index.html")) {
    const first = parsedFiles[0]!;
    const firstHtml = first.relativePath.replace(/\.md$/i, ".html");
    output.set("index.html", `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=${firstHtml}"><title>${siteTitle}</title></head>
<body><p>Redirecting to <a href="${firstHtml}">${first.title}</a>...</p></body>
</html>`);
  }

  // 5. Generate assets
  output.set("assets/style.css", generateCSS());
  output.set("assets/main.js", generateMainJS());
  if (showGraph) {
    output.set("assets/graph.js", generateGraphJS());
    output.set("assets/graph-full.js", generateFullGraphJS());
    output.set("graph-data.json", JSON.stringify(graphData, null, 2));

    // Generate full-page graph.html
    const graphSidebarHtml = renderFileTree(fileTree, "graph.html", "");
    output.set("graph.html", generateGraphPageHtml({
      siteTitle,
      sidebarHtml: graphSidebarHtml,
      theme,
      hasThemeCSS,
    }));
  }

  // 6. Vercel config
  output.set("vercel.json", JSON.stringify({
    cleanUrls: true,
    trailingSlash: false,
  }, null, 2));

  return { files: output, fileCount: parsedFiles.length };
}

// ── Write generated site to a local directory (for preview) ──────────────

export function writeSiteToDir(site: GeneratedSite, outDir: string): void {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");

  fs.mkdirSync(outDir, { recursive: true });

  // Clean old files
  const cleanDir = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      if (entry === ".git" || entry === ".gitignore") continue;
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        cleanDir(fullPath);
        if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath);
      } else {
        fs.unlinkSync(fullPath);
      }
    }
  };
  cleanDir(outDir);

  for (const [relFilePath, content] of site.files) {
    const fullPath = path.join(outDir, relFilePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
  }
}
