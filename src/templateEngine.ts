/**
 * templateEngine.ts — Generates the shared HTML shell, CSS, and client-side JS assets.
 */

import type { ParsedFile, KanbanBoard } from "./parser";
import { escapeHtmlAttr } from "./utils";

// ── File tree types ──────────────────────────────────────────────────────

export interface FileTreeNode {
  name: string;
  path: string;    // relative html path
  isFolder: boolean;
  isKanban: boolean;
  children: FileTreeNode[];
}

// ── Build file tree from parsed files ────────────────────────────────────

export function buildFileTree(files: ParsedFile[]): FileTreeNode {
  const root: FileTreeNode = { name: "root", path: "", isFolder: true, isKanban: false, children: [] };

  for (const f of files) {
    const parts = f.relativePath.replace(/\.md$/i, "").split(/[\\/]/);
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;

      if (isLast) {
        current.children.push({
          name: part,
          path: f.relativePath.replace(/\.md$/i, ".html"),
          isFolder: false,
          isKanban: f.isKanban,
          children: [],
        });
      } else {
        let folder = current.children.find((c) => c.isFolder && c.name === part);
        if (!folder) {
          folder = { name: part, path: "", isFolder: true, isKanban: false, children: [] };
          current.children.push(folder);
        }
        current = folder;
      }
    }
  }

  // Sort: folders first, then alphabetical
  const sortTree = (node: FileTreeNode): void => {
    node.children.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortTree);
  };
  sortTree(root);

  return root;
}

// ── Render file tree to HTML ─────────────────────────────────────────────

export function renderFileTree(node: FileTreeNode, currentPath: string, basePath: string): string {
  if (!node.isFolder) {
    const href = basePath + node.path;
    const active = node.path === currentPath ? ' class="active"' : "";
    const icon = node.isKanban ? "📋" : "📄";
    return `<li${active}><a href="${href}">${icon} ${escapeHtmlContent(node.name)}</a></li>`;
  }

  const children = node.children.map((c) => renderFileTree(c, currentPath, basePath)).join("\n");

  if (node.name === "root") {
    return `<ul class="file-tree">${children}</ul>`;
  }

  return `<li class="folder">
    <details open>
      <summary>📁 ${escapeHtmlContent(node.name)}</summary>
      <ul>${children}</ul>
    </details>
  </li>`;
}

function escapeHtmlContent(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Kanban board HTML (all 3 views embedded, toggled via JS) ─────────────

export function renderKanbanContent(kanban: KanbanBoard, rawMarkdown: string): string {
  // Board view
  const boardCols = kanban.columns
    .map(
      (col) => `
      <div class="kanban-column">
        <div class="kanban-column-header">
          <h3>${escapeHtmlContent(col.title)}</h3>
          <span class="card-count">${col.cards.length}</span>
        </div>
        <div class="kanban-cards">
          ${col.cards
            .map(
              (card) => `
            <div class="kanban-card ${card.checked ? "checked" : ""}">
              <input type="checkbox" disabled ${card.checked ? "checked" : ""}>
              <span>${card.htmlText}</span>
            </div>`
            )
            .join("\n")}
        </div>
      </div>`
    )
    .join("\n");

  // List view
  const listItems = kanban.columns
    .map(
      (col) => `
      <details class="kanban-list-section" open>
        <summary>
          <strong>${escapeHtmlContent(col.title)}</strong>
          <span class="card-count">${col.cards.length}</span>
        </summary>
        <ul class="kanban-list-cards">
          ${col.cards
            .map(
              (card) => `
            <li class="${card.checked ? "checked" : ""}">
              <input type="checkbox" disabled ${card.checked ? "checked" : ""}>
              <span>${card.htmlText}</span>
            </li>`
            )
            .join("\n")}
        </ul>
      </details>`
    )
    .join("\n");

  // Markdown view (escaped raw source)
  const escapedMd = escapeHtmlContent(rawMarkdown);

  return `
    <div class="kanban-view-toggle">
      <button class="view-btn active" data-view="board">Board</button>
      <button class="view-btn" data-view="list">List</button>
      <button class="view-btn" data-view="markdown">Markdown</button>
    </div>
    <div class="kanban-view" data-view-name="board">
      <div class="kanban-board">${boardCols}</div>
    </div>
    <div class="kanban-view" data-view-name="list" style="display:none;">
      <div class="kanban-list">${listItems}</div>
    </div>
    <div class="kanban-view" data-view-name="markdown" style="display:none;">
      <pre class="kanban-raw-md"><code>${escapedMd}</code></pre>
    </div>`;
}

// ── Full page HTML ───────────────────────────────────────────────────────

export function generatePageHtml(opts: {
  title: string;
  siteTitle: string;
  content: string;
  sidebarHtml: string;
  currentPath: string;
  theme: string;
  showGraph: boolean;
  basePath: string;
  hasThemeCSS: boolean;
}): string {
  const themeLink = opts.hasThemeCSS
    ? `<link rel="stylesheet" href="${opts.basePath}assets/obsidian-theme.css">`
    : "";
  return `<!DOCTYPE html>
<html lang="en" data-theme="${opts.theme}" class="theme-${opts.theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtmlContent(opts.title)} — ${escapeHtmlContent(opts.siteTitle)}</title>
  <link rel="stylesheet" href="${opts.basePath}assets/style.css">
  ${themeLink}
</head>
<body>
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <h2>${escapeHtmlContent(opts.siteTitle)}</h2>
        <button class="sidebar-close" id="sidebar-close" aria-label="Close sidebar">✕</button>
      </div>
      <nav class="sidebar-nav">
        ${opts.sidebarHtml}
        ${opts.showGraph ? `<div class="sidebar-graph-link"><a href="${opts.basePath}graph.html">🕸️ Graph View</a></div>` : ""}
      </nav>
    </aside>
    <main class="main-content">
      <header class="topbar">
        <button class="hamburger" id="hamburger" aria-label="Open sidebar">☰</button>
        <h1 class="page-title">${escapeHtmlContent(opts.title)}</h1>
        <div class="topbar-actions">
          <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">🌓</button>
          ${opts.showGraph ? `<a class="graph-page-link" href="${opts.basePath}graph.html" aria-label="Open graph view">🕸️</a>` : ""}
        </div>
      </header>
      <article class="content" id="content">
        ${opts.content}
      </article>
    </main>
    ${opts.showGraph ? `
    <div class="graph-panel" id="graph-panel" style="display:none;">
      <div class="graph-panel-header">
        <span>Graph View</span>
        <button class="graph-panel-close" id="graph-panel-close">✕</button>
      </div>
      <canvas id="graph-canvas"></canvas>
    </div>` : ""}
  </div>
  <script>window.__CURRENT_PATH__ = ${JSON.stringify(opts.currentPath)};</script>
  <script src="${opts.basePath}assets/main.js"></script>
  ${opts.showGraph ? `<script src="${opts.basePath}assets/graph.js"></script>` : ""}
</body>
</html>`;
}

// ── Full-page graph view HTML ────────────────────────────────────────────

export function generateGraphPageHtml(opts: {
  siteTitle: string;
  sidebarHtml: string;
  theme: string;
  hasThemeCSS: boolean;
}): string {
  const themeLink = opts.hasThemeCSS
    ? `<link rel="stylesheet" href="assets/obsidian-theme.css">`
    : "";
  return `<!DOCTYPE html>
<html lang="en" data-theme="${opts.theme}" class="theme-${opts.theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Graph View — ${escapeHtmlContent(opts.siteTitle)}</title>
  <link rel="stylesheet" href="assets/style.css">
  ${themeLink}
  <style>
    .graph-fullpage { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .graph-fullpage .topbar { flex-shrink: 0; }
    .graph-fullpage-canvas { flex: 1; width: 100%; background: var(--bg); }
    .graph-stats { position: absolute; bottom: 16px; left: calc(var(--sidebar-w) + 16px); background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 14px; font-size: 12px; color: var(--text-muted); z-index: 10; }
    .graph-legend { display: flex; gap: 16px; align-items: center; }
    .graph-legend span { display: flex; align-items: center; gap: 4px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .legend-dot.kanban { background: var(--accent); }
    .legend-dot.note { background: var(--text-muted); }
    .legend-dot.current { background: var(--green); }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <h2>${escapeHtmlContent(opts.siteTitle)}</h2>
        <button class="sidebar-close" id="sidebar-close" aria-label="Close sidebar">✕</button>
      </div>
      <nav class="sidebar-nav">
        ${opts.sidebarHtml}
        <div class="sidebar-graph-link"><a href="graph.html" class="active">🕸️ Graph View</a></div>
      </nav>
    </aside>
    <main class="graph-fullpage">
      <header class="topbar">
        <button class="hamburger" id="hamburger" aria-label="Open sidebar">☰</button>
        <h1 class="page-title">Graph View</h1>
        <div class="topbar-actions">
          <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">🌓</button>
        </div>
      </header>
      <canvas id="graph-fullpage-canvas" class="graph-fullpage-canvas"></canvas>
    </main>
    <div class="graph-stats" id="graph-stats"></div>
  </div>
  <script>window.__CURRENT_PATH__ = "graph.html";</script>
  <script src="assets/main.js"></script>
  <script src="assets/graph-full.js"></script>
</body>
</html>`;
}

// ── CSS ──────────────────────────────────────────────────────────────────

export function generateCSS(): string {
  return `/* ═══ Kanban Web Publisher — Generated Styles ═══ */

/* ── Bridge: map Obsidian CSS variables → our layout vars ── */
/* If an Obsidian theme sets --background-primary etc., we pick them up */
:root, [data-theme="dark"] {
  --bg: var(--background-primary, #1e1e2e);
  --bg-secondary: var(--background-secondary, #181825);
  --bg-tertiary: var(--background-primary-alt, #11111b);
  --text: var(--text-normal, #cdd6f4);
  --text-muted: var(--text-muted, #a6adc8);
  --accent: var(--interactive-accent, #89b4fa);
  --accent-hover: var(--interactive-accent-hover, #74c7ec);
  --border: var(--background-modifier-border, #313244);
  --card-bg: var(--background-secondary-alt, #313244);
  --card-hover: var(--background-modifier-hover, #45475a);
  --green: #a6e3a1;
  --red: #f38ba8;
  --yellow: #f9e2af;
  --tag-bg: var(--background-modifier-hover, #45475a);
  --sidebar-w: 280px;
  --topbar-h: 52px;
  --radius: 8px;
  --shadow: 0 2px 8px rgba(0,0,0,.3);
}
[data-theme="light"] {
  --bg: var(--background-primary, #eff1f5);
  --bg-secondary: var(--background-secondary, #e6e9ef);
  --bg-tertiary: var(--background-primary-alt, #dce0e8);
  --text: var(--text-normal, #4c4f69);
  --text-muted: var(--text-muted, #6c6f85);
  --accent: var(--interactive-accent, #1e66f5);
  --accent-hover: var(--interactive-accent-hover, #2a6ef5);
  --border: var(--background-modifier-border, #ccd0da);
  --card-bg: var(--background-secondary-alt, #ffffff);
  --card-hover: var(--background-modifier-hover, #e6e9ef);
  --green: #40a02b;
  --red: #d20f39;
  --yellow: #df8e1d;
  --tag-bg: var(--background-modifier-hover, #dce0e8);
  --sidebar-w: 280px;
  --shadow: 0 2px 8px rgba(0,0,0,.08);
}

* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background: var(--bg); color: var(--text); }

/* ─── Layout ─────────────────────────────── */
.layout { display: flex; height: 100vh; overflow: hidden; }

/* ─── Sidebar ────────────────────────────── */
.sidebar {
  width: var(--sidebar-w); min-width: var(--sidebar-w);
  background: var(--bg-secondary); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; overflow: hidden;
  transition: transform .2s ease;
}
.sidebar-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px; border-bottom: 1px solid var(--border);
}
.sidebar-header h2 { font-size: 15px; font-weight: 600; }
.sidebar-close { display: none; background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; }
.sidebar-nav { overflow-y: auto; flex: 1; padding: 8px 0; }

.file-tree, .file-tree ul { list-style: none; padding-left: 0; }
.file-tree ul { padding-left: 16px; }
.file-tree li a {
  display: block; padding: 6px 16px; color: var(--text-muted); text-decoration: none;
  font-size: 13px; border-radius: 4px; transition: background .15s;
}
.file-tree li a:hover { background: var(--card-hover); color: var(--text); }
.file-tree li.active > a { background: var(--accent); color: #fff; font-weight: 500; }
.file-tree .folder > details > summary {
  padding: 6px 16px; font-size: 13px; cursor: pointer; color: var(--text);
  list-style: none; user-select: none;
}
.file-tree .folder > details > summary::-webkit-details-marker { display: none; }
.file-tree .folder > details > summary::before { content: "▶ "; font-size: 10px; }
.file-tree .folder > details[open] > summary::before { content: "▼ "; }

/* ─── Main content ───────────────────────── */
.main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

.topbar {
  height: var(--topbar-h); display: flex; align-items: center; gap: 12px;
  padding: 0 20px; border-bottom: 1px solid var(--border); background: var(--bg-secondary);
  flex-shrink: 0;
}
.topbar .hamburger { display: none; background: none; border: none; font-size: 20px; color: var(--text); cursor: pointer; }
.page-title { font-size: 17px; font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topbar-actions { display: flex; gap: 8px; }
.topbar-actions button { background: none; border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 16px; color: var(--text); }
.topbar-actions button:hover { background: var(--card-hover); }

.content {
  flex: 1; overflow-y: auto; padding: 28px 36px; max-width: 960px;
}
.content h1, .content h2, .content h3, .content h4, .content h5, .content h6 { margin: 1.2em 0 .5em; }
.content h1 { font-size: 28px; } .content h2 { font-size: 22px; } .content h3 { font-size: 18px; }
.content p { margin: .6em 0; line-height: 1.7; }
.content ul { padding-left: 24px; margin: .5em 0; }
.content li { margin: .3em 0; line-height: 1.6; }
.content blockquote { border-left: 3px solid var(--accent); padding: 8px 16px; margin: 1em 0; color: var(--text-muted); background: var(--bg-secondary); border-radius: 0 var(--radius) var(--radius) 0; }
.content pre { background: var(--bg-tertiary); padding: 16px; border-radius: var(--radius); overflow-x: auto; margin: 1em 0; font-size: 13px; }
.content code { font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace; font-size: 0.9em; }
.content p code, .content li code { background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px; }
.content hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
.content a.wiki-link { color: var(--accent); text-decoration: none; border-bottom: 1px dashed var(--accent); }
.content a.wiki-link:hover { color: var(--accent-hover); border-bottom-style: solid; }
.content .tag { background: var(--tag-bg); color: var(--accent); padding: 2px 8px; border-radius: 12px; font-size: 12px; white-space: nowrap; }
.content .task-item { list-style: none; }
.content .task-item input[type="checkbox"] { margin-right: 6px; }

/* ─── Kanban ─────────────────────────────── */
.kanban-view-toggle {
  display: flex; gap: 0; margin-bottom: 20px; background: var(--bg-secondary);
  border-radius: var(--radius); overflow: hidden; border: 1px solid var(--border);
  width: fit-content;
}
.view-btn {
  padding: 8px 20px; border: none; background: transparent; color: var(--text-muted);
  cursor: pointer; font-size: 13px; font-weight: 500; transition: all .15s;
}
.view-btn:hover { background: var(--card-hover); color: var(--text); }
.view-btn.active { background: var(--accent); color: #fff; }

.kanban-board {
  display: flex; gap: 16px; overflow-x: auto; padding-bottom: 16px;
  align-items: flex-start;
}
.kanban-column {
  min-width: 280px; max-width: 320px; flex-shrink: 0;
  background: var(--bg-secondary); border-radius: var(--radius);
  border: 1px solid var(--border); overflow: hidden;
}
.kanban-column-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  background: var(--bg-tertiary);
}
.kanban-column-header h3 { font-size: 14px; font-weight: 600; }
.card-count {
  background: var(--accent); color: #fff; font-size: 11px; font-weight: 600;
  padding: 2px 8px; border-radius: 12px; min-width: 20px; text-align: center;
}
.kanban-cards { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.kanban-card {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; background: var(--card-bg); border-radius: 6px;
  border: 1px solid var(--border); font-size: 13px; line-height: 1.5;
  transition: background .15s, box-shadow .15s;
}
.kanban-card:hover { background: var(--card-hover); box-shadow: var(--shadow); }
.kanban-card.checked span { text-decoration: line-through; color: var(--text-muted); }
.kanban-card input[type="checkbox"] { margin-top: 3px; flex-shrink: 0; }

/* List view */
.kanban-list { max-width: 700px; }
.kanban-list-section { margin-bottom: 8px; }
.kanban-list-section > summary {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  background: var(--bg-secondary); border-radius: var(--radius);
  border: 1px solid var(--border); cursor: pointer; font-size: 14px;
  list-style: none; user-select: none;
}
.kanban-list-section > summary::-webkit-details-marker { display: none; }
.kanban-list-section > summary .card-count { font-size: 11px; }
.kanban-list-cards {
  list-style: none; padding: 4px 0 4px 20px;
}
.kanban-list-cards li {
  display: flex; align-items: flex-start; gap: 8px; padding: 6px 0;
  font-size: 13px; line-height: 1.5; border-bottom: 1px solid var(--border);
}
.kanban-list-cards li.checked span { text-decoration: line-through; color: var(--text-muted); }
.kanban-list-cards li input[type="checkbox"] { margin-top: 3px; }

/* Markdown raw view */
.kanban-raw-md { max-height: 80vh; overflow: auto; font-size: 13px; line-height: 1.6; }

/* ─── Graph panel ────────────────────────── */
.graph-panel {
  position: fixed; bottom: 20px; right: 20px;
  width: 400px; height: 350px;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow);
  z-index: 100; display: flex; flex-direction: column; overflow: hidden;
  resize: both;
}
.graph-panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 14px; border-bottom: 1px solid var(--border);
  font-size: 13px; font-weight: 600; cursor: move;
}
.graph-panel-close { background: none; border: none; color: var(--text-muted); font-size: 16px; cursor: pointer; }
#graph-canvas { flex: 1; width: 100%; }

/* ─── Sidebar graph link ─────────────── */
.sidebar-graph-link { padding: 8px 0; border-top: 1px solid var(--border); margin-top: 8px; }
.sidebar-graph-link a {
  display: block; padding: 8px 16px; color: var(--text-muted); text-decoration: none;
  font-size: 13px; border-radius: 4px; transition: background .15s;
}
.sidebar-graph-link a:hover { background: var(--card-hover); color: var(--text); }
.sidebar-graph-link a.active { background: var(--accent); color: #fff; font-weight: 500; }

/* ─── Graph page link in topbar ─────── */
.graph-page-link {
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px;
  font-size: 16px; color: var(--text); text-decoration: none; transition: background .15s;
}
.graph-page-link:hover { background: var(--card-hover); }

/* ─── Responsive ───────────────────── */
@media (max-width: 768px) {
  .sidebar {
    position: fixed; top: 0; left: 0; bottom: 0;
    z-index: 200; transform: translateX(-100%);
  }
  .sidebar.open { transform: translateX(0); }
  .sidebar-close { display: block; }
  .topbar .hamburger { display: block; }
  .content { padding: 20px 16px; }
  .graph-panel { width: 90vw; right: 5vw; bottom: 10px; }
  .graph-stats { left: 16px !important; }
}
`;
}

// ── Client-side main.js ──────────────────────────────────────────────────

export function generateMainJS(): string {
  return `// ═══ Kanban Web Publisher — Client JS ═══

// Sidebar toggle (mobile)
const sidebar = document.getElementById('sidebar');
const hamburger = document.getElementById('hamburger');
const sidebarClose = document.getElementById('sidebar-close');

if (hamburger) hamburger.addEventListener('click', () => sidebar.classList.add('open'));
if (sidebarClose) sidebarClose.addEventListener('click', () => sidebar.classList.remove('open'));

// Theme toggle
const themeBtn = document.getElementById('theme-toggle');
if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('vault-theme', next);
  });
  const saved = localStorage.getItem('vault-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
}

// Graph panel toggle
const graphBtn = document.getElementById('graph-toggle');
const graphPanel = document.getElementById('graph-panel');
const graphClose = document.getElementById('graph-panel-close');

if (graphBtn && graphPanel) {
  graphBtn.addEventListener('click', () => {
    const visible = graphPanel.style.display !== 'none';
    graphPanel.style.display = visible ? 'none' : 'flex';
    if (!visible && window.__initGraph) window.__initGraph();
  });
}
if (graphClose && graphPanel) {
  graphClose.addEventListener('click', () => { graphPanel.style.display = 'none'; });
}

// Kanban view toggle
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view');
    const pageKey = 'kanban-view:' + window.__CURRENT_PATH__;

    // Toggle buttons
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Toggle views
    document.querySelectorAll('.kanban-view').forEach(v => {
      v.style.display = v.getAttribute('data-view-name') === view ? 'block' : 'none';
    });

    localStorage.setItem(pageKey, view);
  });
});

// Restore saved kanban view
(function() {
  const saved = localStorage.getItem('kanban-view:' + window.__CURRENT_PATH__);
  if (saved) {
    const btn = document.querySelector('.view-btn[data-view="' + saved + '"]');
    if (btn) btn.click();
  }
})();
`;
}

// ── Graph JS (D3-like force simulation, no dependencies) ─────────────────

export function generateGraphJS(): string {
  return `// ═══ Kanban Web Publisher — Graph Visualizer ═══

(function() {
  const canvas = document.getElementById('graph-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let nodes = [], edges = [], sim = null, animFrame = null;
  let offsetX = 0, offsetY = 0, scale = 1;
  let dragNode = null, hoverNode = null;
  let isDragging = false, lastMouse = {x:0, y:0};
  let width = 0, height = 0;
  let initialized = false;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    width = rect.width;
    height = rect.height - 36; // minus header
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  // Simple force simulation
  function forceSimulation(ns, es) {
    // Initialize positions
    ns.forEach((n, i) => {
      n.x = width/2 + (Math.random() - 0.5) * 200;
      n.y = height/2 + (Math.random() - 0.5) * 200;
      n.vx = 0; n.vy = 0;
    });

    return {
      tick() {
        const alpha = 0.3;
        // Repulsion
        for (let i = 0; i < ns.length; i++) {
          for (let j = i+1; j < ns.length; j++) {
            let dx = ns[j].x - ns[i].x;
            let dy = ns[j].y - ns[i].y;
            let d = Math.sqrt(dx*dx + dy*dy) || 1;
            let force = -300 / (d * d);
            let fx = dx / d * force;
            let fy = dy / d * force;
            ns[i].vx -= fx; ns[i].vy -= fy;
            ns[j].vx += fx; ns[j].vy += fy;
          }
        }
        // Attraction (edges)
        const nodeMap = {};
        ns.forEach(n => nodeMap[n.id] = n);
        es.forEach(e => {
          const s = nodeMap[e.source], t = nodeMap[e.target];
          if (!s || !t) return;
          let dx = t.x - s.x, dy = t.y - s.y;
          let d = Math.sqrt(dx*dx + dy*dy) || 1;
          let force = (d - 80) * 0.01;
          let fx = dx / d * force, fy = dy / d * force;
          s.vx += fx; s.vy += fy;
          t.vx -= fx; t.vy -= fy;
        });
        // Center gravity
        ns.forEach(n => {
          n.vx += (width/2 - n.x) * 0.001;
          n.vy += (height/2 - n.y) * 0.001;
        });
        // Apply velocity
        ns.forEach(n => {
          if (n === dragNode) return;
          n.vx *= 0.85; n.vy *= 0.85;
          n.x += n.vx * alpha;
          n.y += n.vy * alpha;
        });
      }
    };
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const currentPage = window.__CURRENT_PATH__;
    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue('--accent').trim() || '#89b4fa';
    const text = style.getPropertyValue('--text').trim() || '#cdd6f4';
    const muted = style.getPropertyValue('--text-muted').trim() || '#a6adc8';
    const border = style.getPropertyValue('--border').trim() || '#313244';

    // Edges
    edges.forEach(e => {
      const s = nodes.find(n => n.id === e.source);
      const t = nodes.find(n => n.id === e.target);
      if (!s || !t) return;
      const isHighlight = hoverNode && (hoverNode.id === s.id || hoverNode.id === t.id);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isHighlight ? accent : border;
      ctx.lineWidth = isHighlight ? 2 : 1;
      ctx.stroke();
    });

    // Nodes
    nodes.forEach(n => {
      const isCurrent = n.path === currentPage;
      const isHover = hoverNode && hoverNode.id === n.id;
      const isConnected = hoverNode && edges.some(e =>
        (e.source === hoverNode.id && e.target === n.id) ||
        (e.target === hoverNode.id && e.source === n.id)
      );

      let r = n.isKanban ? 7 : 5;
      if (isCurrent) r = 9;

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent ? accent : (isHover || isConnected ? accent : muted);
      ctx.fill();
      if (isCurrent || isHover) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label
      if (isHover || isCurrent || isConnected || nodes.length < 30) {
        ctx.fillStyle = isHover || isCurrent ? text : muted;
        ctx.font = (isHover || isCurrent ? 'bold ' : '') + '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y - r - 5);
      }
    });

    ctx.restore();
    sim.tick();
    animFrame = requestAnimationFrame(draw);
  }

  function screenToWorld(sx, sy) {
    return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
  }

  function findNode(mx, my) {
    const {x, y} = screenToWorld(mx, my);
    for (const n of nodes) {
      const dx = n.x - x, dy = n.y - y;
      if (dx*dx + dy*dy < 144) return n; // radius 12 hit area
    }
    return null;
  }

  canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = findNode(mx, my);
    if (hit) { dragNode = hit; }
    else { isDragging = true; }
    lastMouse = {x: e.clientX, y: e.clientY};
  });

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;

    if (dragNode) {
      const {x, y} = screenToWorld(mx, my);
      dragNode.x = x; dragNode.y = y;
      dragNode.vx = 0; dragNode.vy = 0;
    } else if (isDragging) {
      offsetX += e.clientX - lastMouse.x;
      offsetY += e.clientY - lastMouse.y;
    } else {
      hoverNode = findNode(mx, my);
      canvas.style.cursor = hoverNode ? 'pointer' : 'grab';
    }
    lastMouse = {x: e.clientX, y: e.clientY};
  });

  canvas.addEventListener('mouseup', e => {
    if (dragNode && !isDragging) {
      // check if it was a click (not drag)
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const hit = findNode(mx, my);
      if (hit && hit.path) {
        window.location.href = hit.path;
      }
    }
    dragNode = null;
    isDragging = false;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const zoom = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.max(0.2, Math.min(5, scale * zoom));
    offsetX = mx - (mx - offsetX) * (newScale / scale);
    offsetY = my - (my - offsetY) * (newScale / scale);
    scale = newScale;
  }, {passive: false});

  window.__initGraph = function() {
    if (initialized) return;
    initialized = true;
    resize();

    fetch((window.__BASE_PATH__ || '') + 'graph-data.json')
      .then(r => r.json())
      .then(data => {
        nodes = data.nodes || [];
        edges = data.edges || [];
        sim = forceSimulation(nodes, edges);
        draw();
      })
      .catch(err => console.error('Graph data load failed:', err));

    new ResizeObserver(resize).observe(canvas.parentElement);
  };
})();
`;
}

// ── Full-page graph JS (for graph.html) ──────────────────────────────────

export function generateFullGraphJS(): string {
  return `// ═══ Kanban Web Publisher — Full-Page Graph Visualizer ═══

(function() {
  const canvas = document.getElementById('graph-fullpage-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let nodes = [], edges = [], sim = null, animFrame = null;
  let offsetX = 0, offsetY = 0, scale = 1;
  let dragNode = null, hoverNode = null;
  let isDragging = false, lastMouse = {x:0, y:0};
  let width = 0, height = 0;
  const statsEl = document.getElementById('graph-stats');

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function forceSimulation(ns, es) {
    ns.forEach((n) => {
      n.x = width/2 + (Math.random() - 0.5) * Math.min(width, 600);
      n.y = height/2 + (Math.random() - 0.5) * Math.min(height, 600);
      n.vx = 0; n.vy = 0;
    });
    return {
      tick() {
        const alpha = 0.3;
        for (let i = 0; i < ns.length; i++) {
          for (let j = i+1; j < ns.length; j++) {
            let dx = ns[j].x - ns[i].x;
            let dy = ns[j].y - ns[i].y;
            let d = Math.sqrt(dx*dx + dy*dy) || 1;
            let force = -400 / (d * d);
            let fx = dx / d * force;
            let fy = dy / d * force;
            ns[i].vx -= fx; ns[i].vy -= fy;
            ns[j].vx += fx; ns[j].vy += fy;
          }
        }
        const nodeMap = {};
        ns.forEach(n => nodeMap[n.id] = n);
        es.forEach(e => {
          const s = nodeMap[e.source], t = nodeMap[e.target];
          if (!s || !t) return;
          let dx = t.x - s.x, dy = t.y - s.y;
          let d = Math.sqrt(dx*dx + dy*dy) || 1;
          let force = (d - 120) * 0.008;
          let fx = dx / d * force, fy = dy / d * force;
          s.vx += fx; s.vy += fy;
          t.vx -= fx; t.vy -= fy;
        });
        ns.forEach(n => {
          n.vx += (width/2 - n.x) * 0.0005;
          n.vy += (height/2 - n.y) * 0.0005;
        });
        ns.forEach(n => {
          if (n === dragNode) return;
          n.vx *= 0.85; n.vy *= 0.85;
          n.x += n.vx * alpha;
          n.y += n.vy * alpha;
        });
      }
    };
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue('--accent').trim() || '#89b4fa';
    const text = style.getPropertyValue('--text').trim() || '#cdd6f4';
    const muted = style.getPropertyValue('--text-muted').trim() || '#a6adc8';
    const border = style.getPropertyValue('--border').trim() || '#313244';
    const green = style.getPropertyValue('--green').trim() || '#a6e3a1';

    // Edges
    edges.forEach(e => {
      const s = nodes.find(n => n.id === e.source);
      const t = nodes.find(n => n.id === e.target);
      if (!s || !t) return;
      const isHighlight = hoverNode && (hoverNode.id === s.id || hoverNode.id === t.id);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isHighlight ? accent : border;
      ctx.lineWidth = isHighlight ? 2.5 : 1;
      ctx.globalAlpha = isHighlight ? 1 : 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Nodes
    nodes.forEach(n => {
      const isHover = hoverNode && hoverNode.id === n.id;
      const isConnected = hoverNode && edges.some(e =>
        (e.source === hoverNode.id && e.target === n.id) ||
        (e.target === hoverNode.id && e.source === n.id)
      );

      let r = n.isKanban ? 8 : 6;
      if (isHover) r += 3;

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.isKanban ? accent : (isHover || isConnected ? accent : muted);
      ctx.fill();

      if (isHover) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.stroke();
        // Glow
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Labels — always show on full-page
      const showLabel = isHover || isConnected || nodes.length < 50 || scale > 1.2;
      if (showLabel) {
        const fontSize = Math.max(10, Math.min(14, 12 / scale));
        ctx.fillStyle = isHover ? text : muted;
        ctx.font = (isHover ? 'bold ' : '') + fontSize + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y - r - 6);
      }
    });

    ctx.restore();
    sim.tick();
    animFrame = requestAnimationFrame(draw);
  }

  function screenToWorld(sx, sy) {
    return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
  }

  function findNode(mx, my) {
    const {x, y} = screenToWorld(mx, my);
    for (const n of nodes) {
      const dx = n.x - x, dy = n.y - y;
      if (dx*dx + dy*dy < 196) return n;
    }
    return null;
  }

  function updateStats() {
    if (!statsEl) return;
    const kanbanCount = nodes.filter(n => n.isKanban).length;
    const noteCount = nodes.length - kanbanCount;
    statsEl.innerHTML = '<div class="graph-legend">' +
      '<span><span class="legend-dot kanban"></span> Kanban (' + kanbanCount + ')</span>' +
      '<span><span class="legend-dot note"></span> Notes (' + noteCount + ')</span>' +
      '<span>' + edges.length + ' connections</span>' +
      '</div>';
  }

  canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = findNode(mx, my);
    if (hit) { dragNode = hit; }
    else { isDragging = true; }
    lastMouse = {x: e.clientX, y: e.clientY};
  });

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (dragNode) {
      const {x, y} = screenToWorld(mx, my);
      dragNode.x = x; dragNode.y = y;
      dragNode.vx = 0; dragNode.vy = 0;
    } else if (isDragging) {
      offsetX += e.clientX - lastMouse.x;
      offsetY += e.clientY - lastMouse.y;
    } else {
      hoverNode = findNode(mx, my);
      canvas.style.cursor = hoverNode ? 'pointer' : 'grab';
    }
    lastMouse = {x: e.clientX, y: e.clientY};
  });

  canvas.addEventListener('mouseup', e => {
    if (dragNode && !isDragging) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const hit = findNode(mx, my);
      if (hit && hit.path) {
        window.location.href = hit.path;
      }
    }
    dragNode = null;
    isDragging = false;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const zoom = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.max(0.1, Math.min(8, scale * zoom));
    offsetX = mx - (mx - offsetX) * (newScale / scale);
    offsetY = my - (my - offsetY) * (newScale / scale);
    scale = newScale;
  }, {passive: false});

  // Auto-init on load
  resize();
  fetch('graph-data.json')
    .then(r => r.json())
    .then(data => {
      nodes = data.nodes || [];
      edges = data.edges || [];
      sim = forceSimulation(nodes, edges);
      updateStats();
      draw();
    })
    .catch(err => console.error('Graph data load failed:', err));

  new ResizeObserver(resize).observe(canvas);
})();
`;
}
