/**
 * parser.ts — Unified markdown + kanban parser with wiki-link graph extraction.
 *
 * Handles:
 * - Detecting kanban files (frontmatter `kanban-plugin: board`)
 * - Parsing kanban boards into columns/cards
 * - Converting regular markdown to HTML
 * - Extracting [[wiki-links]] for the graph visualizer
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface KanbanCard {
  text: string;
  checked: boolean;
  htmlText: string; // text with wiki-links/tags/bold rendered to HTML
}

export interface KanbanColumn {
  title: string;
  cards: KanbanCard[];
  collapsed: boolean;
}

export interface KanbanBoard {
  columns: KanbanColumn[];
  rawMarkdown: string;
}

export interface ParsedFile {
  title: string;          // filename without extension
  relativePath: string;   // relative path from publish root
  isKanban: boolean;
  kanban: KanbanBoard | null;
  htmlContent: string;    // rendered HTML (for regular md files)
  rawMarkdown: string;
  outgoingLinks: string[]; // wiki-link targets (normalized)
}

export interface GraphData {
  nodes: { id: string; path: string; label: string; isKanban: boolean }[];
  edges: { source: string; target: string }[];
}

// ── Frontmatter ──────────────────────────────────────────────────────────

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content };
  }
  const meta: Record<string, string> = {};
  const rawMeta = match[1] ?? "";
  for (const line of rawMeta.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      meta[key] = val;
    }
  }
  return { meta, body: match[2] ?? "" };
}

// ── Wiki-link extraction ─────────────────────────────────────────────────

const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)??(?:\|([^\]]*))?\]\]/g;

export function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = WIKI_LINK_RE.exec(content)) !== null) {
    const target = (m[1] ?? "").trim();
    if (target) links.push(target);
  }
  return [...new Set(links)];
}

// ── Inline markdown rendering ────────────────────────────────────────────

/** Render inline markdown (bold, italic, code, wiki-links, tags) to HTML */
export function renderInline(text: string): string {
  let html = escapeHtml(text);

  // inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // wiki-links  [[target|display]] or [[target]]
  html = html.replace(
    /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
    (_match: string, target: string, display: string | undefined) => {
      const label = display || target;
      const href = slugify(target) + ".html";
      return `<a class="wiki-link" href="${href}">${label}</a>`;
    }
  );

  // tags  #tag-name
  html = html.replace(
    /(?<!\w)#([\w-]+)/g,
    '<span class="tag">#$1</span>'
  );

  // external links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  return html;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");
}

// ── Kanban parser ────────────────────────────────────────────────────────

function stripKanbanSettings(body: string): string {
  // Remove  %% kanban:settings ... %%  block at end of file
  return body.replace(/%%\s*kanban:settings[\s\S]*?%%\s*$/, "").trim();
}

export function parseKanban(body: string): KanbanBoard {
  const cleaned = stripKanbanSettings(body);
  const rawMarkdown = cleaned;
  const lines = cleaned.split("\n");
  const columns: KanbanColumn[] = [];
  let currentColumn: KanbanColumn | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      currentColumn = { title: (headingMatch[1] ?? "").trim(), cards: [], collapsed: false };
      columns.push(currentColumn);
      continue;
    }

    const cardMatch = line.match(/^-\s+\[([ xX])\]\s+(.*)/);
    if (cardMatch && currentColumn) {
      const checked = (cardMatch[1] ?? "") !== " ";
      const text = (cardMatch[2] ?? "").trim();
      currentColumn.cards.push({
        text,
        checked,
        htmlText: renderInline(text),
      });
    }
  }

  return { columns, rawMarkdown };
}

// ── Markdown → HTML ──────────────────────────────────────────────────────

export function markdownToHtml(body: string): string {
  const cleaned = stripKanbanSettings(body);
  const lines = cleaned.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeLines: string[] = [];
  let inList = false;

  for (const line of lines) {
    // fenced code blocks
    if (line.match(/^```/)) {
      if (!inCodeBlock) {
        if (inList) { out.push("</ul>"); inList = false; }
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeLines = [];
      } else {
        out.push(`<pre><code class="language-${escapeHtml(codeBlockLang)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCodeBlock = false;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // blank line
    if (line.trim() === "") {
      if (inList) { out.push("</ul>"); inList = false; }
      continue;
    }

    // headings
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      if (inList) { out.push("</ul>"); inList = false; }
      const level = (hMatch[1] ?? "").length;
      const text = hMatch[2] ?? "";
      const id = slugify(text);
      out.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      continue;
    }

    // unordered list items
    const liMatch = line.match(/^[-*]\s+(.*)/);
    if (liMatch) {
      if (!inList) { out.push("<ul>"); inList = true; }
      const text = liMatch[1] ?? "";
      // checkbox
      const cbMatch = text.match(/^\[([ xX])\]\s+(.*)/);
      if (cbMatch) {
        const checked = (cbMatch[1] ?? "") !== " ";
        const cbText = cbMatch[2] ?? "";
        out.push(`<li class="task-item"><input type="checkbox" disabled ${checked ? "checked" : ""}> ${renderInline(cbText)}</li>`);
      } else {
        out.push(`<li>${renderInline(text)}</li>`);
      }
      continue;
    }

    // blockquote
    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<blockquote>${renderInline(bqMatch[1] ?? "")}</blockquote>`);
      continue;
    }

    // horizontal rule
    if (line.match(/^---+$/)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("<hr>");
      continue;
    }

    // paragraph
    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p>${renderInline(line)}</p>`);
  }

  if (inList) out.push("</ul>");
  if (inCodeBlock) {
    out.push(`<pre><code class="language-${escapeHtml(codeBlockLang)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }

  return out.join("\n");
}

// ── Parse a single file ──────────────────────────────────────────────────

export function parseFile(
  content: string,
  fileName: string,
  relativePath: string
): ParsedFile {
  const { meta, body } = parseFrontmatter(content);
  const isKanban = meta["kanban-plugin"] === "board" || meta["kanban-plugin"] === "basic";
  const title = fileName.replace(/\.md$/i, "");
  const outgoingLinks = extractWikiLinks(content);

  if (isKanban) {
    const kanban = parseKanban(body);
    return {
      title,
      relativePath,
      isKanban: true,
      kanban,
      htmlContent: "", // not used for kanban
      rawMarkdown: content,
      outgoingLinks,
    };
  }

  return {
    title,
    relativePath,
    isKanban: false,
    kanban: null,
    htmlContent: markdownToHtml(body),
    rawMarkdown: content,
    outgoingLinks,
  };
}

// ── Build graph data from parsed files ───────────────────────────────────

export function buildGraphData(files: ParsedFile[]): GraphData {
  const nodeMap = new Map<string, ParsedFile>();
  for (const f of files) {
    nodeMap.set(f.title.toLowerCase(), f);
  }

  const nodes = files.map((f) => ({
    id: f.relativePath,
    path: f.relativePath.replace(/\.md$/i, ".html"),
    label: f.title,
    isKanban: f.isKanban,
  }));

  const edges: GraphData["edges"] = [];
  for (const f of files) {
    for (const link of f.outgoingLinks) {
      const target = nodeMap.get(link.toLowerCase());
      if (target && target.relativePath !== f.relativePath) {
        edges.push({ source: f.relativePath, target: target.relativePath });
      }
    }
  }

  return { nodes, edges };
}
