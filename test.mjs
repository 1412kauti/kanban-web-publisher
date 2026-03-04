/**
 * test.mjs — Standalone test: parses vault folder and generates site without Obsidian runtime.
 * Usage: node test.mjs
 */

import fs from "fs";
import path from "path";

const VAULT_ROOT = "C:\\Users\\Kautilya\\Documents\\MyStuff";
const PUBLISH_FOLDER = "Viskefi/Daily"; // Test with the daily kanban folder
const OUTPUT_DIR = "C:\\Users\\Kautilya\\Documents\\GitHub\\vault-site";
const SITE_TITLE = "Kautilya's Vault";
const THEME = "dark";
const OBSIDIAN_THEME = "OLED.Black"; // Obsidian community theme to inject

// ── Inline the parser logic (since we can't import TS directly) ──────────

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of (match[1] || "").split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { meta, body: match[2] || "" };
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slugify(name) {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
}

function renderInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(
    /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
    (_, target, display) => {
      const label = display || target;
      const href = slugify(target) + ".html";
      return `<a class="wiki-link" href="${href}">${label}</a>`;
    }
  );
  html = html.replace(/(?<!\w)#([\w-]+)/g, '<span class="tag">#$1</span>');
  return html;
}

const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)??(?:\|([^\]]*))?\]\]/g;
function extractWikiLinks(content) {
  const links = [];
  let m;
  while ((m = WIKI_LINK_RE.exec(content)) !== null) {
    if (m[1]?.trim()) links.push(m[1].trim());
  }
  return [...new Set(links)];
}

function stripKanbanSettings(body) {
  return body.replace(/%%\s*kanban:settings[\s\S]*?%%\s*$/, "").trim();
}

function parseKanban(body) {
  const cleaned = stripKanbanSettings(body);
  const lines = cleaned.split("\n");
  const columns = [];
  let currentColumn = null;
  for (const line of lines) {
    const hm = line.match(/^##\s+(.+)/);
    if (hm) {
      currentColumn = { title: hm[1].trim(), cards: [] };
      columns.push(currentColumn);
      continue;
    }
    const cm = line.match(/^-\s+\[([ xX])\]\s+(.*)/);
    if (cm && currentColumn) {
      const checked = cm[1] !== " ";
      currentColumn.cards.push({ text: cm[2].trim(), checked, htmlText: renderInline(cm[2].trim()) });
    }
  }
  return { columns, rawMarkdown: cleaned };
}

function markdownToHtml(body) {
  const cleaned = stripKanbanSettings(body);
  const lines = cleaned.split("\n");
  const out = [];
  let inCode = false, codeLang = "", codeLines = [], inList = false;
  for (const line of lines) {
    if (line.match(/^```/)) {
      if (!inCode) { if (inList) { out.push("</ul>"); inList = false; } inCode = true; codeLang = line.slice(3).trim(); codeLines = []; }
      else { out.push(`<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`); inCode = false; }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (line.trim() === "") { if (inList) { out.push("</ul>"); inList = false; } continue; }
    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) { if (inList) { out.push("</ul>"); inList = false; } out.push(`<h${hm[1].length} id="${slugify(hm[2])}">${renderInline(hm[2])}</h${hm[1].length}>`); continue; }
    const lm = line.match(/^[-*]\s+(.*)/);
    if (lm) {
      if (!inList) { out.push("<ul>"); inList = true; }
      const cb = lm[1].match(/^\[([ xX])\]\s+(.*)/);
      if (cb) { out.push(`<li class="task-item"><input type="checkbox" disabled ${cb[1] !== " " ? "checked" : ""}> ${renderInline(cb[2])}</li>`); }
      else { out.push(`<li>${renderInline(lm[1])}</li>`); }
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p>${renderInline(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

function parseFile(content, fileName, relativePath) {
  const { meta, body } = parseFrontmatter(content);
  const isKanban = meta["kanban-plugin"] === "board" || meta["kanban-plugin"] === "basic";
  const title = fileName.replace(/\.md$/i, "");
  const outgoingLinks = extractWikiLinks(content);
  if (isKanban) {
    return { title, relativePath, isKanban: true, kanban: parseKanban(body), htmlContent: "", rawMarkdown: content, outgoingLinks };
  }
  return { title, relativePath, isKanban: false, kanban: null, htmlContent: markdownToHtml(body), rawMarkdown: content, outgoingLinks };
}

// ── Import template engine logic (inline since no TS runtime) ────────────
// We load the generated main.js and extract the functions... but that's bundled for Obsidian.
// Instead, let's just inline the template generation here for testing.

function buildFileTree(files) {
  const root = { name: "root", path: "", isFolder: true, isKanban: false, children: [] };
  for (const f of files) {
    const parts = f.relativePath.replace(/\.md$/i, "").split(/[\\/]/);
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      if (isLast) {
        current.children.push({ name: parts[i], path: f.relativePath.replace(/\.md$/i, ".html"), isFolder: false, isKanban: f.isKanban, children: [] });
      } else {
        let folder = current.children.find(c => c.isFolder && c.name === parts[i]);
        if (!folder) { folder = { name: parts[i], path: "", isFolder: true, isKanban: false, children: [] }; current.children.push(folder); }
        current = folder;
      }
    }
  }
  return root;
}

function renderFileTree(node, currentPath, basePath) {
  if (!node.isFolder) {
    const href = basePath + node.path;
    const active = node.path === currentPath ? ' class="active"' : "";
    const icon = node.isKanban ? "📋" : "📄";
    return `<li${active}><a href="${href}">${icon} ${escapeHtml(node.name)}</a></li>`;
  }
  const children = node.children.map(c => renderFileTree(c, currentPath, basePath)).join("\n");
  if (node.name === "root") return `<ul class="file-tree">${children}</ul>`;
  return `<li class="folder"><details open><summary>📁 ${escapeHtml(node.name)}</summary><ul>${children}</ul></details></li>`;
}

// ── Load CSS/JS from the templateEngine (we'll inline the strings) ──────

// Read the main.js bundle and extract the CSS/JS strings... too complex.
// Instead, let's dynamically import. Actually, the simplest way: just call the functions.
// Since our build output is CJS, we can require it:

// Actually let's just generate them inline for the test.

function generateCSS() {
  // Read from the templateEngine source or just use a reference copy
  return fs.existsSync(path.join(OUTPUT_DIR, "assets", "style.css"))
    ? fs.readFileSync(path.join(OUTPUT_DIR, "assets", "style.css"), "utf-8")
    : "/* placeholder */";
}

// ── Walk and generate ────────────────────────────────────────────────────

function walkDir(dir, rootDir) {
  const results = [];
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkDir(full, rootDir));
    } else if (entry.endsWith(".md")) {
      const rel = path.relative(rootDir, full).replace(/\\/g, "/");
      results.push({ fullPath: full, relativePath: rel, fileName: entry });
    }
  }
  return results;
}

// ── Main test ────────────────────────────────────────────────────────────

console.log("=== Vault Publisher Test ===\n");

const publishDir = path.join(VAULT_ROOT, ...PUBLISH_FOLDER.split("/"));
if (!fs.existsSync(publishDir)) {
  console.error(`Publish folder not found: ${publishDir}`);
  process.exit(1);
}

const mdFiles = walkDir(publishDir, publishDir);
console.log(`Found ${mdFiles.length} markdown files in ${PUBLISH_FOLDER}\n`);

const parsedFiles = mdFiles.map(f => {
  const content = fs.readFileSync(f.fullPath, "utf-8");
  return parseFile(content, f.fileName, f.relativePath);
});

// Print parse results
for (const pf of parsedFiles) {
  console.log(`  ${pf.isKanban ? "📋" : "📄"} ${pf.relativePath}`);
  if (pf.isKanban && pf.kanban) {
    for (const col of pf.kanban.columns) {
      console.log(`     └─ ${col.title} (${col.cards.length} cards)`);
    }
  }
  if (pf.outgoingLinks.length > 0) {
    console.log(`     links: ${pf.outgoingLinks.join(", ")}`);
  }
}

// Build graph
const nodeMap = new Map();
parsedFiles.forEach(f => nodeMap.set(f.title.toLowerCase(), f));
const nodes = parsedFiles.map(f => ({ id: f.relativePath, path: f.relativePath.replace(/\.md$/i, ".html"), label: f.title, isKanban: f.isKanban }));
const edges = [];
for (const f of parsedFiles) {
  for (const link of f.outgoingLinks) {
    const target = nodeMap.get(link.toLowerCase());
    if (target && target.relativePath !== f.relativePath) {
      edges.push({ source: f.relativePath, target: target.relativePath });
    }
  }
}

console.log(`\nGraph: ${nodes.length} nodes, ${edges.length} edges\n`);

// Generate kanban board HTML for a sample file
const kanbanFiles = parsedFiles.filter(f => f.isKanban);
if (kanbanFiles.length > 0) {
  const sample = kanbanFiles[0];
  console.log(`\nSample kanban HTML for: ${sample.title}`);
  const kb = sample.kanban;

  // Generate a full standalone HTML to test
  const fileTree = buildFileTree(parsedFiles);
  const sidebarHtml = renderFileTree(fileTree, sample.relativePath.replace(/\.md$/i, ".html"), "");

  // Write the CSS file
  const cssContent = `/* Vault Publisher Styles */
:root, [data-theme="dark"] { --bg:#1e1e2e;--bg-secondary:#181825;--bg-tertiary:#11111b;--text:#cdd6f4;--text-muted:#a6adc8;--accent:#89b4fa;--accent-hover:#74c7ec;--border:#313244;--card-bg:#313244;--card-hover:#45475a;--tag-bg:#45475a;--sidebar-w:280px;--topbar-h:52px;--radius:8px;--shadow:0 2px 8px rgba(0,0,0,.3); }
[data-theme="light"] { --bg:#eff1f5;--bg-secondary:#e6e9ef;--bg-tertiary:#dce0e8;--text:#4c4f69;--text-muted:#6c6f85;--accent:#1e66f5;--accent-hover:#2a6ef5;--border:#ccd0da;--card-bg:#fff;--card-hover:#e6e9ef;--tag-bg:#dce0e8;--shadow:0 2px 8px rgba(0,0,0,.08); }
*{margin:0;padding:0;box-sizing:border-box;}
html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);}
.layout{display:flex;height:100vh;overflow:hidden;}
.sidebar{width:var(--sidebar-w);min-width:var(--sidebar-w);background:var(--bg-secondary);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;}
.sidebar-header{display:flex;justify-content:space-between;align-items:center;padding:16px;border-bottom:1px solid var(--border);}
.sidebar-header h2{font-size:15px;font-weight:600;}
.sidebar-close{display:none;background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;}
.sidebar-nav{overflow-y:auto;flex:1;padding:8px 0;}
.file-tree,.file-tree ul{list-style:none;padding-left:0;}
.file-tree ul{padding-left:16px;}
.file-tree li a{display:block;padding:6px 16px;color:var(--text-muted);text-decoration:none;font-size:13px;border-radius:4px;transition:background .15s;}
.file-tree li a:hover{background:var(--card-hover);color:var(--text);}
.file-tree li.active>a{background:var(--accent);color:#fff;font-weight:500;}
.file-tree .folder>details>summary{padding:6px 16px;font-size:13px;cursor:pointer;color:var(--text);list-style:none;}
.file-tree .folder>details>summary::-webkit-details-marker{display:none;}
.file-tree .folder>details>summary::before{content:"▶ ";font-size:10px;}
.file-tree .folder>details[open]>summary::before{content:"▼ ";}
.main-content{flex:1;display:flex;flex-direction:column;overflow:hidden;}
.topbar{height:var(--topbar-h);display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid var(--border);background:var(--bg-secondary);flex-shrink:0;}
.topbar .hamburger{display:none;background:none;border:none;font-size:20px;color:var(--text);cursor:pointer;}
.page-title{font-size:17px;font-weight:600;flex:1;}
.topbar-actions{display:flex;gap:8px;}
.topbar-actions button{background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:16px;color:var(--text);}
.topbar-actions button:hover{background:var(--card-hover);}
.content{flex:1;overflow-y:auto;padding:28px 36px;max-width:960px;}
.kanban-view-toggle{display:flex;gap:0;margin-bottom:20px;background:var(--bg-secondary);border-radius:var(--radius);overflow:hidden;border:1px solid var(--border);width:fit-content;}
.view-btn{padding:8px 20px;border:none;background:transparent;color:var(--text-muted);cursor:pointer;font-size:13px;font-weight:500;transition:all .15s;}
.view-btn:hover{background:var(--card-hover);color:var(--text);}
.view-btn.active{background:var(--accent);color:#fff;}
.kanban-board{display:flex;gap:16px;overflow-x:auto;padding-bottom:16px;align-items:flex-start;}
.kanban-column{min-width:280px;max-width:320px;flex-shrink:0;background:var(--bg-secondary);border-radius:var(--radius);border:1px solid var(--border);overflow:hidden;}
.kanban-column-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg-tertiary);}
.kanban-column-header h3{font-size:14px;font-weight:600;}
.card-count{background:var(--accent);color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;}
.kanban-cards{padding:8px;display:flex;flex-direction:column;gap:6px;}
.kanban-card{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;background:var(--card-bg);border-radius:6px;border:1px solid var(--border);font-size:13px;line-height:1.5;transition:background .15s,box-shadow .15s;}
.kanban-card:hover{background:var(--card-hover);box-shadow:var(--shadow);}
.kanban-card.checked span{text-decoration:line-through;color:var(--text-muted);}
.kanban-card input[type="checkbox"]{margin-top:3px;flex-shrink:0;}
.kanban-list{max-width:700px;}
.kanban-list-section{margin-bottom:8px;}
.kanban-list-section>summary{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg-secondary);border-radius:var(--radius);border:1px solid var(--border);cursor:pointer;font-size:14px;list-style:none;}
.kanban-list-section>summary::-webkit-details-marker{display:none;}
.kanban-list-cards{list-style:none;padding:4px 0 4px 20px;}
.kanban-list-cards li{display:flex;align-items:flex-start;gap:8px;padding:6px 0;font-size:13px;line-height:1.5;border-bottom:1px solid var(--border);}
.kanban-list-cards li.checked span{text-decoration:line-through;color:var(--text-muted);}
.kanban-raw-md{max-height:80vh;overflow:auto;font-size:13px;line-height:1.6;}
.content a.wiki-link{color:var(--accent);text-decoration:none;border-bottom:1px dashed var(--accent);}
.content .tag{background:var(--tag-bg);color:var(--accent);padding:2px 8px;border-radius:12px;font-size:12px;}
.graph-panel{position:fixed;bottom:20px;right:20px;width:400px;height:350px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);z-index:100;display:flex;flex-direction:column;overflow:hidden;resize:both;}
.graph-panel-header{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-bottom:1px solid var(--border);font-size:13px;font-weight:600;}
.graph-panel-close{background:none;border:none;color:var(--text-muted);font-size:16px;cursor:pointer;}
#graph-canvas{flex:1;width:100%;}
@media(max-width:768px){.sidebar{position:fixed;top:0;left:0;bottom:0;z-index:200;transform:translateX(-100%);}.sidebar.open{transform:translateX(0);}.sidebar-close{display:block;}.topbar .hamburger{display:block;}.content{padding:20px 16px;}}
`;

  // Build the kanban content
  const boardCols = kb.columns.map(col => `
    <div class="kanban-column">
      <div class="kanban-column-header"><h3>${escapeHtml(col.title)}</h3><span class="card-count">${col.cards.length}</span></div>
      <div class="kanban-cards">
        ${col.cards.map(card => `<div class="kanban-card ${card.checked ? "checked" : ""}"><input type="checkbox" disabled ${card.checked ? "checked" : ""}><span>${card.htmlText}</span></div>`).join("\n")}
      </div>
    </div>`).join("\n");

  const listItems = kb.columns.map(col => `
    <details class="kanban-list-section" open>
      <summary><strong>${escapeHtml(col.title)}</strong><span class="card-count">${col.cards.length}</span></summary>
      <ul class="kanban-list-cards">
        ${col.cards.map(card => `<li class="${card.checked ? "checked" : ""}"><input type="checkbox" disabled ${card.checked ? "checked" : ""}><span>${card.htmlText}</span></li>`).join("\n")}
      </ul>
    </details>`).join("\n");

  const kanbanContent = `
    <div class="kanban-view-toggle">
      <button class="view-btn active" data-view="board">Board</button>
      <button class="view-btn" data-view="list">List</button>
      <button class="view-btn" data-view="markdown">Markdown</button>
    </div>
    <div class="kanban-view" data-view-name="board"><div class="kanban-board">${boardCols}</div></div>
    <div class="kanban-view" data-view-name="list" style="display:none;"><div class="kanban-list">${listItems}</div></div>
    <div class="kanban-view" data-view-name="markdown" style="display:none;"><pre class="kanban-raw-md"><code>${escapeHtml(sample.rawMarkdown)}</code></pre></div>`;

  const mainJS = `
const sidebar=document.getElementById('sidebar'),hamburger=document.getElementById('hamburger'),sidebarClose=document.getElementById('sidebar-close');
if(hamburger)hamburger.addEventListener('click',()=>sidebar.classList.add('open'));
if(sidebarClose)sidebarClose.addEventListener('click',()=>sidebar.classList.remove('open'));
const themeBtn=document.getElementById('theme-toggle');
if(themeBtn){themeBtn.addEventListener('click',()=>{const h=document.documentElement;const c=h.getAttribute('data-theme');const n=c==='dark'?'light':'dark';h.setAttribute('data-theme',n);localStorage.setItem('vault-theme',n);});const s=localStorage.getItem('vault-theme');if(s)document.documentElement.setAttribute('data-theme',s);}
document.querySelectorAll('.view-btn').forEach(btn=>{btn.addEventListener('click',()=>{const v=btn.getAttribute('data-view');document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.kanban-view').forEach(el=>{el.style.display=el.getAttribute('data-view-name')===v?'block':'none';});});});
`;

  const graphJS = `(function(){const c=document.getElementById('graph-canvas');if(!c)return;const x=c.getContext('2d');let nodes=[],edges=[],sim,w=0,h=0,offX=0,offY=0,sc=1,hover=null,drag=null,isDrag=false,lm={x:0,y:0},init=false;
function resize(){const r=c.parentElement.getBoundingClientRect();w=r.width;h=r.height-36;c.width=w*devicePixelRatio;c.height=h*devicePixelRatio;c.style.width=w+'px';c.style.height=h+'px';x.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);}
function forceSim(ns,es){ns.forEach(n=>{n.x=w/2+(Math.random()-.5)*200;n.y=h/2+(Math.random()-.5)*200;n.vx=0;n.vy=0;});return{tick(){for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){let dx=ns[j].x-ns[i].x,dy=ns[j].y-ns[i].y,d=Math.sqrt(dx*dx+dy*dy)||1,f=-300/(d*d),fx=dx/d*f,fy=dy/d*f;ns[i].vx-=fx;ns[i].vy-=fy;ns[j].vx+=fx;ns[j].vy+=fy;}const nm={};ns.forEach(n=>nm[n.id]=n);es.forEach(e=>{const s=nm[e.source],t=nm[e.target];if(!s||!t)return;let dx=t.x-s.x,dy=t.y-s.y,d=Math.sqrt(dx*dx+dy*dy)||1,f=(d-80)*.01;s.vx+=dx/d*f;s.vy+=dy/d*f;t.vx-=dx/d*f;t.vy-=dy/d*f;});ns.forEach(n=>{n.vx+=(w/2-n.x)*.001;n.vy+=(h/2-n.y)*.001;});ns.forEach(n=>{if(n===drag)return;n.vx*=.85;n.vy*=.85;n.x+=n.vx*.3;n.y+=n.vy*.3;})}};}
function draw(){x.clearRect(0,0,w,h);x.save();x.translate(offX,offY);x.scale(sc,sc);const cp=window.__CURRENT_PATH__,st=getComputedStyle(document.documentElement),ac=st.getPropertyValue('--accent').trim()||'#89b4fa',tx=st.getPropertyValue('--text').trim()||'#cdd6f4',mu=st.getPropertyValue('--text-muted').trim()||'#a6adc8',bd=st.getPropertyValue('--border').trim()||'#313244';edges.forEach(e=>{const s=nodes.find(n=>n.id===e.source),t=nodes.find(n=>n.id===e.target);if(!s||!t)return;const hl=hover&&(hover.id===s.id||hover.id===t.id);x.beginPath();x.moveTo(s.x,s.y);x.lineTo(t.x,t.y);x.strokeStyle=hl?ac:bd;x.lineWidth=hl?2:1;x.stroke();});nodes.forEach(n=>{const cur=n.path===cp,hv=hover&&hover.id===n.id,con=hover&&edges.some(e=>(e.source===hover.id&&e.target===n.id)||(e.target===hover.id&&e.source===n.id));let r=n.isKanban?7:5;if(cur)r=9;x.beginPath();x.arc(n.x,n.y,r,0,Math.PI*2);x.fillStyle=cur?ac:(hv||con?ac:mu);x.fill();if(cur||hv){x.strokeStyle=ac;x.lineWidth=2;x.stroke();}if(hv||cur||con||nodes.length<30){x.fillStyle=hv||cur?tx:mu;x.font=(hv||cur?'bold ':'')+'11px system-ui';x.textAlign='center';x.fillText(n.label,n.x,n.y-r-5);}});x.restore();sim.tick();requestAnimationFrame(draw);}
function s2w(sx,sy){return{x:(sx-offX)/sc,y:(sy-offY)/sc};}
function findN(mx,my){const{x:px,y:py}=s2w(mx,my);for(const n of nodes){const dx=n.x-px,dy=n.y-py;if(dx*dx+dy*dy<144)return n;}return null;}
c.addEventListener('mousedown',e=>{const r=c.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,hit=findN(mx,my);if(hit)drag=hit;else isDrag=true;lm={x:e.clientX,y:e.clientY};});
c.addEventListener('mousemove',e=>{const r=c.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;if(drag){const{x:px,y:py}=s2w(mx,my);drag.x=px;drag.y=py;drag.vx=0;drag.vy=0;}else if(isDrag){offX+=e.clientX-lm.x;offY+=e.clientY-lm.y;}else{hover=findN(mx,my);c.style.cursor=hover?'pointer':'grab';}lm={x:e.clientX,y:e.clientY};});
c.addEventListener('mouseup',e=>{if(drag&&!isDrag){const r=c.getBoundingClientRect(),hit=findN(e.clientX-r.left,e.clientY-r.top);if(hit&&hit.path)window.location.href=hit.path;}drag=null;isDrag=false;});
c.addEventListener('wheel',e=>{e.preventDefault();const r=c.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,z=e.deltaY<0?1.1:.9,ns=Math.max(.2,Math.min(5,sc*z));offX=mx-(mx-offX)*(ns/sc);offY=my-(my-offY)*(ns/sc);sc=ns;},{passive:false});
const gb=document.getElementById('graph-toggle'),gp=document.getElementById('graph-panel'),gc=document.getElementById('graph-panel-close');
if(gb&&gp)gb.addEventListener('click',()=>{const v=gp.style.display!=='none';gp.style.display=v?'none':'flex';if(!v&&!init){init=true;resize();fetch('graph-data.json').then(r=>r.json()).then(d=>{nodes=d.nodes||[];edges=d.edges||[];sim=forceSim(nodes,edges);draw();}).catch(e=>console.error(e));new ResizeObserver(resize).observe(c.parentElement);}});
if(gc&&gp)gc.addEventListener('click',()=>{gp.style.display='none';});
})();`;

  const fullHtml = `<!DOCTYPE html>
<html lang="en" data-theme="${THEME}">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(sample.title)} — ${escapeHtml(SITE_TITLE)}</title>
  <style>${cssContent}</style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header"><h2>${escapeHtml(SITE_TITLE)}</h2><button class="sidebar-close" id="sidebar-close">✕</button></div>
      <nav class="sidebar-nav">${sidebarHtml}</nav>
    </aside>
    <main class="main-content">
      <header class="topbar">
        <button class="hamburger" id="hamburger">☰</button>
        <h1 class="page-title">${escapeHtml(sample.title)}</h1>
        <div class="topbar-actions">
          <button class="theme-toggle" id="theme-toggle">🌓</button>
          <button class="graph-toggle" id="graph-toggle">🕸️</button>
        </div>
      </header>
      <article class="content" id="content">${kanbanContent}</article>
    </main>
    <div class="graph-panel" id="graph-panel" style="display:none;">
      <div class="graph-panel-header"><span>Graph View</span><button class="graph-panel-close" id="graph-panel-close">✕</button></div>
      <canvas id="graph-canvas"></canvas>
    </div>
  </div>
  <script>window.__CURRENT_PATH__=${JSON.stringify(sample.relativePath.replace(/\.md$/i, ".html"))};</script>
  <script>${mainJS}</script>
  <script>${graphJS}</script>
</body>
</html>`;

  // Write files
  const assetsDir = path.join(OUTPUT_DIR, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  // Write each parsed file as HTML
  for (const pf of parsedFiles) {
    const htmlPath = pf.relativePath.replace(/\.md$/i, ".html");
    const htmlDir = path.join(OUTPUT_DIR, path.dirname(htmlPath));
    fs.mkdirSync(htmlDir, { recursive: true });

    let pageContent;
    if (pf.isKanban && pf.kanban) {
      const pBoardCols = pf.kanban.columns.map(col => `<div class="kanban-column"><div class="kanban-column-header"><h3>${escapeHtml(col.title)}</h3><span class="card-count">${col.cards.length}</span></div><div class="kanban-cards">${col.cards.map(card => `<div class="kanban-card ${card.checked?"checked":""}"><input type="checkbox" disabled ${card.checked?"checked":""}><span>${card.htmlText}</span></div>`).join("")}</div></div>`).join("");
      const pListItems = pf.kanban.columns.map(col => `<details class="kanban-list-section" open><summary><strong>${escapeHtml(col.title)}</strong><span class="card-count">${col.cards.length}</span></summary><ul class="kanban-list-cards">${col.cards.map(card => `<li class="${card.checked?"checked":""}"><input type="checkbox" disabled ${card.checked?"checked":""}><span>${card.htmlText}</span></li>`).join("")}</ul></details>`).join("");
      pageContent = `<div class="kanban-view-toggle"><button class="view-btn active" data-view="board">Board</button><button class="view-btn" data-view="list">List</button><button class="view-btn" data-view="markdown">Markdown</button></div><div class="kanban-view" data-view-name="board"><div class="kanban-board">${pBoardCols}</div></div><div class="kanban-view" data-view-name="list" style="display:none;"><div class="kanban-list">${pListItems}</div></div><div class="kanban-view" data-view-name="markdown" style="display:none;"><pre class="kanban-raw-md"><code>${escapeHtml(pf.rawMarkdown)}</code></pre></div>`;
    } else {
      pageContent = pf.htmlContent;
    }

    const pfSidebar = renderFileTree(fileTree, htmlPath, "");
    const pfHtml = `<!DOCTYPE html><html lang="en" data-theme="${THEME}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(pf.title)} — ${escapeHtml(SITE_TITLE)}</title><style>${cssContent}</style></head><body><div class="layout"><aside class="sidebar" id="sidebar"><div class="sidebar-header"><h2>${escapeHtml(SITE_TITLE)}</h2><button class="sidebar-close" id="sidebar-close">✕</button></div><nav class="sidebar-nav">${pfSidebar}</nav></aside><main class="main-content"><header class="topbar"><button class="hamburger" id="hamburger">☰</button><h1 class="page-title">${escapeHtml(pf.title)}</h1><div class="topbar-actions"><button class="theme-toggle" id="theme-toggle">🌓</button><button class="graph-toggle" id="graph-toggle">🕸️</button></div></header><article class="content">${pageContent}</article></main><div class="graph-panel" id="graph-panel" style="display:none;"><div class="graph-panel-header"><span>Graph View</span><button class="graph-panel-close" id="graph-panel-close">✕</button></div><canvas id="graph-canvas"></canvas></div></div><script>window.__CURRENT_PATH__=${JSON.stringify(htmlPath)};</script><script>${mainJS}</script><script>${graphJS}</script></body></html>`;

    fs.writeFileSync(path.join(OUTPUT_DIR, htmlPath), pfHtml, "utf-8");
  }

  // Write graph data
  fs.writeFileSync(path.join(OUTPUT_DIR, "graph-data.json"), JSON.stringify({ nodes, edges }, null, 2), "utf-8");

  // Load & write Obsidian community theme CSS
  let hasThemeCSS = false;
  const themeCSSPath = path.join(VAULT_ROOT, ".obsidian", "themes", OBSIDIAN_THEME, "theme.css");
  if (fs.existsSync(themeCSSPath)) {
    fs.writeFileSync(path.join(assetsDir, "obsidian-theme.css"), fs.readFileSync(themeCSSPath, "utf-8"), "utf-8");
    hasThemeCSS = true;
    console.log(`  🎨 Loaded theme: ${OBSIDIAN_THEME}`);
  }
  const themeLinkTag = hasThemeCSS ? '<link rel="stylesheet" href="assets/obsidian-theme.css">' : '';

  // Generate full-page graph.html
  const graphSidebar = renderFileTree(fileTree, "graph.html", "");
  const graphFullJS = `(function(){const c=document.getElementById('graph-fullpage-canvas');if(!c)return;const x=c.getContext('2d');let nodes=[],edges=[],sim,w=0,h=0,offX=0,offY=0,sc=1,hover=null,drag=null,isDrag=false,lm={x:0,y:0};const stats=document.getElementById('graph-stats');
function resize(){const r=c.getBoundingClientRect();w=r.width;h=r.height;c.width=w*devicePixelRatio;c.height=h*devicePixelRatio;c.style.width=w+'px';c.style.height=h+'px';x.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);}
function forceSim(ns,es){ns.forEach(n=>{n.x=w/2+(Math.random()-.5)*Math.min(w,600);n.y=h/2+(Math.random()-.5)*Math.min(h,600);n.vx=0;n.vy=0;});return{tick(){for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){let dx=ns[j].x-ns[i].x,dy=ns[j].y-ns[i].y,d=Math.sqrt(dx*dx+dy*dy)||1,f=-400/(d*d);ns[i].vx-=dx/d*f;ns[i].vy-=dy/d*f;ns[j].vx+=dx/d*f;ns[j].vy+=dy/d*f;}const nm={};ns.forEach(n=>nm[n.id]=n);es.forEach(e=>{const s=nm[e.source],t=nm[e.target];if(!s||!t)return;let dx=t.x-s.x,dy=t.y-s.y,d=Math.sqrt(dx*dx+dy*dy)||1,f=(d-120)*.008;s.vx+=dx/d*f;s.vy+=dy/d*f;t.vx-=dx/d*f;t.vy-=dy/d*f;});ns.forEach(n=>{n.vx+=(w/2-n.x)*.0005;n.vy+=(h/2-n.y)*.0005;});ns.forEach(n=>{if(n===drag)return;n.vx*=.85;n.vy*=.85;n.x+=n.vx*.3;n.y+=n.vy*.3;})}}}
function draw(){x.clearRect(0,0,w,h);x.save();x.translate(offX,offY);x.scale(sc,sc);const st=getComputedStyle(document.documentElement),ac=st.getPropertyValue('--accent').trim()||'#89b4fa',tx=st.getPropertyValue('--text').trim()||'#cdd6f4',mu=st.getPropertyValue('--text-muted').trim()||'#a6adc8',bd=st.getPropertyValue('--border').trim()||'#313244';edges.forEach(e=>{const s=nodes.find(n=>n.id===e.source),t=nodes.find(n=>n.id===e.target);if(!s||!t)return;const hl=hover&&(hover.id===s.id||hover.id===t.id);x.beginPath();x.moveTo(s.x,s.y);x.lineTo(t.x,t.y);x.strokeStyle=hl?ac:bd;x.lineWidth=hl?2.5:1;x.globalAlpha=hl?1:.5;x.stroke();x.globalAlpha=1;});nodes.forEach(n=>{const hv=hover&&hover.id===n.id,con=hover&&edges.some(e=>(e.source===hover.id&&e.target===n.id)||(e.target===hover.id&&e.source===n.id));let r=n.isKanban?8:6;if(hv)r+=3;x.beginPath();x.arc(n.x,n.y,r,0,Math.PI*2);x.fillStyle=n.isKanban?ac:(hv||con?ac:mu);x.fill();if(hv){x.strokeStyle=ac;x.lineWidth=2;x.stroke();x.beginPath();x.arc(n.x,n.y,r+4,0,Math.PI*2);x.globalAlpha=.3;x.stroke();x.globalAlpha=1;}const show=hv||con||nodes.length<50||sc>1.2;if(show){x.fillStyle=hv?tx:mu;x.font=(hv?'bold ':'')+'12px system-ui';x.textAlign='center';x.fillText(n.label,n.x,n.y-r-6);}});x.restore();sim.tick();requestAnimationFrame(draw);}
function s2w(sx,sy){return{x:(sx-offX)/sc,y:(sy-offY)/sc};}function findN(mx,my){const{x:px,y:py}=s2w(mx,my);for(const n of nodes){const dx=n.x-px,dy=n.y-py;if(dx*dx+dy*dy<196)return n;}return null;}
function updateStats(){if(!stats)return;const kc=nodes.filter(n=>n.isKanban).length;stats.innerHTML='<div class="graph-legend"><span><span class="legend-dot kanban"></span> Kanban ('+kc+')</span><span><span class="legend-dot note"></span> Notes ('+(nodes.length-kc)+')</span><span>'+edges.length+' connections</span></div>';}
c.addEventListener('mousedown',e=>{const r=c.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,hit=findN(mx,my);if(hit)drag=hit;else isDrag=true;lm={x:e.clientX,y:e.clientY};});
c.addEventListener('mousemove',e=>{const r=c.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;if(drag){const{x:px,y:py}=s2w(mx,my);drag.x=px;drag.y=py;drag.vx=0;drag.vy=0;}else if(isDrag){offX+=e.clientX-lm.x;offY+=e.clientY-lm.y;}else{hover=findN(mx,my);c.style.cursor=hover?'pointer':'grab';}lm={x:e.clientX,y:e.clientY};});
c.addEventListener('mouseup',e=>{if(drag&&!isDrag){const r=c.getBoundingClientRect(),hit=findN(e.clientX-r.left,e.clientY-r.top);if(hit&&hit.path)window.location.href=hit.path;}drag=null;isDrag=false;});
c.addEventListener('wheel',e=>{e.preventDefault();const r=c.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,z=e.deltaY<0?1.1:.9,ns=Math.max(.1,Math.min(8,sc*z));offX=mx-(mx-offX)*(ns/sc);offY=my-(my-offY)*(ns/sc);sc=ns;},{passive:false});
resize();fetch('graph-data.json').then(r=>r.json()).then(d=>{nodes=d.nodes||[];edges=d.edges||[];sim=forceSim(nodes,edges);updateStats();draw();}).catch(e=>console.error(e));new ResizeObserver(resize).observe(c);
})();`;

  const graphPageHtml = `<!DOCTYPE html>
<html lang="en" data-theme="${THEME}" class="theme-${THEME}">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Graph View — ${escapeHtml(SITE_TITLE)}</title>
  <style>${cssContent}</style>
  ${themeLinkTag}
  <style>
    .graph-fullpage{flex:1;display:flex;flex-direction:column;overflow:hidden;}
    .graph-fullpage .topbar{flex-shrink:0;}
    .graph-fullpage-canvas{flex:1;width:100%;background:var(--bg);}
    .graph-stats{position:absolute;bottom:16px;left:calc(var(--sidebar-w) + 16px);background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius);padding:8px 14px;font-size:12px;color:var(--text-muted);z-index:10;}
    .graph-legend{display:flex;gap:16px;align-items:center;}
    .graph-legend span{display:flex;align-items:center;gap:4px;}
    .legend-dot{width:10px;height:10px;border-radius:50%;display:inline-block;}
    .legend-dot.kanban{background:var(--accent);}
    .legend-dot.note{background:var(--text-muted);}
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header"><h2>${escapeHtml(SITE_TITLE)}</h2><button class="sidebar-close" id="sidebar-close">✕</button></div>
      <nav class="sidebar-nav">${graphSidebar}</nav>
    </aside>
    <main class="graph-fullpage">
      <header class="topbar">
        <button class="hamburger" id="hamburger">☰</button>
        <h1 class="page-title">Graph View</h1>
        <div class="topbar-actions"><button class="theme-toggle" id="theme-toggle">🌓</button></div>
      </header>
      <canvas id="graph-fullpage-canvas" class="graph-fullpage-canvas"></canvas>
    </main>
    <div class="graph-stats" id="graph-stats"></div>
  </div>
  <script>window.__CURRENT_PATH__="graph.html";</script>
  <script>${mainJS}</script>
  <script>${graphFullJS}</script>
</body>
</html>`;

  fs.writeFileSync(path.join(OUTPUT_DIR, "graph.html"), graphPageHtml, "utf-8");

  // Write index.html (redirect to first file)
  const firstHtml = parsedFiles[0].relativePath.replace(/\.md$/i, ".html");
  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=${firstHtml}"><title>${SITE_TITLE}</title></head><body>Redirecting...</body></html>`, "utf-8");

  // Write vercel.json
  fs.writeFileSync(path.join(OUTPUT_DIR, "vercel.json"), JSON.stringify({ cleanUrls: true, trailingSlash: false }, null, 2), "utf-8");

  console.log(`\n✅ Site generated to ${OUTPUT_DIR}`);
  console.log(`   ${parsedFiles.length} pages + graph.html + graph-data.json + index.html`);
  if (hasThemeCSS) console.log(`   🎨 Theme: ${OBSIDIAN_THEME}`);
  console.log(`\n   Open: ${path.join(OUTPUT_DIR, "index.html")}`);
  console.log(`   Graph: ${path.join(OUTPUT_DIR, "graph.html")}`);
}
