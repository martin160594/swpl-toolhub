# SWPL ToolHub

A static launchpad for SWPL tools, built for GitHub Pages. Web tools run embedded right in the site; desktop apps get description dialogs with download links.

## Structure

```
index.html              Public hub: tool cards, search, category filter, dialogs
admin.html              Admin console (password-gated, client-side)
data/site-config.js     Site settings: identity, theme, layout, categories
data/tools.js           Tool registry
assets/                 Hub styles/scripts, icon registry, embedded-tool bridge
tools/layout-editor/    Embedded: visual launcher XML editor
tools/cf-helper/        Embedded: JSON quote escaper + CarrierFeature inserter
tools/image-compressor/ Embedded: fully client-side image compressor
downloads/              Optional: drop release zips here and link them from tools
```

## Editing content

Open `admin.html` and unlock it. Every change lands in a local draft (localStorage) with a live preview. To make it public, either:

1. **Publish from the admin** - GitHub panel: fill owner/repo/branch, paste a personal access token (Contents read+write). Publish commits `data/site-config.js` and `data/tools.js` directly; Pages redeploys automatically. The token never leaves your browser.
2. **Export files** - Data panel (or the Export button): download both data files, replace them in `data/`, commit and push.

Everything is editable: identity and copy, accent color, fonts, radius, density, card style, dark/light default, columns, badges, tags, categories, custom CSS, and the full tool registry (add/edit/reorder/hide/delete, icons from the built-in library, emoji, or image URLs).

## Notes

- Light/dark theme is shared across the hub and every embedded tool (`swpl.theme` in localStorage; system preference by default).
- The admin password gate is client-side only. It keeps the console out of casual reach, but everything in this repo is readable by anyone with repo access, so keep secrets out of the content.
- Deep links: `index.html#t=<tool-id>` opens that tool's dialog directly.

## Local development

Any static server works:

```bash
python -m http.server 8080
```

Then open http://localhost:8080/.
