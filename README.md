# Kanban Web Publisher

An Obsidian plugin that publishes your vault folders as beautiful static websites — with Kanban board rendering, sidebar navigation, and an interactive graph visualizer.

## Features

- **Kanban Board View** — Renders Obsidian Kanban plugin files as interactive boards with a 3-way toggle (Board / List / Markdown)
- **Sidebar File Tree** — Left-panel navigation mirroring your vault folder hierarchy
- **Interactive Graph** — Force-directed node graph showing note connections (panel + full-page view)
- **Obsidian Theme Support** — Inject your installed Obsidian community themes into the published site
- **Dark / Light Mode** — Toggle with a button; preference is persisted
- **Cloud Publishing** — Push directly to GitHub, Gitea/Forgejo, or any S3-compatible store (R2, MinIO, Backblaze) — no local git required
- **Local Git** — Also supports the classic local repo + git push workflow
- **Test Connection** — Verify your publish target credentials from the settings panel
- **Auto-Deploy** — Pair with Vercel, GitHub Pages, or Cloudflare Pages for automatic deployments on every publish

## Installation

### From Release (recommended)

1. Download `kanban-web-publisher.zip` from the [Releases](../../releases) page
2. Extract the zip — you'll get `main.js`, `manifest.json`, and `styles.css`
3. Copy these files into your vault's plugin folder:

**Windows:**
```
<your-vault>\.obsidian\plugins\kanban-web-publisher\
```

**Linux / macOS:**
```
<your-vault>/.obsidian/plugins/kanban-web-publisher/
```

4. Open Obsidian → Settings → Community plugins → Enable **Kanban Web Publisher**

### Manual Build

```bash
git clone https://github.com/1412kauti/kanban-web-publisher.git
cd kanban-web-publisher
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin folder as described above.

## Setup

1. Go to **Settings → Kanban Web Publisher**
2. Set your **Publish folder** (e.g. `MyFolder/Daily`)
3. Choose a **Publish target**:
   - **GitHub** — Enter `owner/repo`, branch, and a personal access token
   - **Gitea / Forgejo** — Same as above, plus your instance's API URL
   - **S3 Compatible** — Enter endpoint, bucket, region, and credentials
   - **Local Git** — Enter a local repo path
4. Click **Test** to verify your connection
5. Optionally select an Obsidian theme to apply to the published site

## Usage

- **Publish**: Click the ☁️ ribbon icon or run `Kanban Web Publisher: Publish to Web` from the command palette
- **Preview**: Run `Kanban Web Publisher: Preview Site Locally` to generate and open the site in your browser

## Deploying to the Web

After publishing to a GitHub repo, connect it to a hosting provider for automatic deployments:

### Vercel
1. Go to [vercel.com](https://vercel.com) → Import your repo
2. Framework Preset: `Other`, Output Directory: `.`, Build Command: empty
3. Deploy

### GitHub Pages
1. Go to repo Settings → Pages → Source: select your branch, folder: `/ (root)`
2. Save — site is live at `https://<user>.github.io/<repo>/`

### Cloudflare Pages
1. Go to [pages.cloudflare.com](https://pages.cloudflare.com) → Connect your repo
2. Build output: `/`, no build command
3. Deploy

## License

MIT
