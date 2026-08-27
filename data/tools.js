/* ============================================================
   SWPL ToolHub - tool registry
   Edited by admin.html (Publish writes this file back to the
   repo, or download it and commit manually).

   Fields per tool:
     id           unique slug
     name         display name
     tagline      one line shown on the card
     description  longer text shown in the dialog
     icon         icon key from assets/icons.js, or "emoji:X", or "img:URL"
     category     category id from site-config categories
     tags         array of short strings
     platform     "web" | "windows"
     version      optional version string (real data only)
     kind         "embedded" (opens inside this site) | "external"
     openUrl      relative or absolute URL the Open button uses
     downloadUrl  URL for the Download button ("" hides the button)
     repoUrl      optional source/repo link
     featured     highlighted card
     hidden       true removes it from the public page (admin still sees it)
   ============================================================ */
window.SWPL_TOOLS = [
  {
    "id": "layout-editor",
    "name": "Layout Editor",
    "tagline": "Visual grid editor for Android launcher XML layouts.",
    "description": "Drag-and-drop editor for default_application_order.xml and default_workspace.xml: multi-page canvas, folders, widgets, a cart tray for parking items, undo/redo, side-by-side XML diff compare and clean export. Runs entirely in your browser - nothing is uploaded anywhere.",
    "icon": "layout",
    "category": "web",
    "tags": ["XML", "Launcher", "Canvas"],
    "platform": "web",
    "version": "",
    "kind": "embedded",
    "openUrl": "tools/layout-editor/index.html",
    "downloadUrl": "",
    "repoUrl": "",
    "featured": true,
    "hidden": false
  },
  {
    "id": "cf-helper",
    "name": "CF Helper",
    "tagline": "Escape JSON and insert CarrierFeature payloads.",
    "description": "Two workbenches in one tool: a quote escaper that converts JSON into an escaped string, and a CarrierFeature inserter that applies IMS and CP payloads to canonical IDs or carrier groups, with a diff preview before you copy or save the result.",
    "icon": "brackets-curly",
    "category": "web",
    "tags": ["JSON", "CarrierFeature", "IMS"],
    "platform": "web",
    "version": "",
    "kind": "embedded",
    "openUrl": "tools/cf-helper/index.html",
    "downloadUrl": "",
    "repoUrl": "",
    "featured": true,
    "hidden": false
  },
  {
    "id": "image-compressor",
    "name": "Image Compression",
    "tagline": "Compress images without leaving the browser.",
    "description": "Batch-compress PNG, JPEG and WebP with quality and max-width controls, a Squoosh-style before/after compare slider, and ZIP export for the whole batch. Compression runs locally in your browser, so files never leave your machine.",
    "icon": "image-square",
    "category": "web",
    "tags": ["Images", "WebP", "Compare"],
    "platform": "web",
    "version": "",
    "kind": "embedded",
    "openUrl": "tools/image-compressor/index.html",
    "downloadUrl": "",
    "repoUrl": "",
    "featured": true,
    "hidden": false
  },
  {
    "id": "sepy",
    "name": "SEPY",
    "tagline": "Release workflow suite for Samsung software.",
    "description": "WinForms desktop suite for managing software release workflows: Perforce (P4) integration, PLM sync, model configuration comparison, release tracking and build management, all in one place.",
    "icon": "img:assets/app-icons/sepy.png",
    "category": "desktop",
    "tags": [".NET 4.8", "P4"],
    "platform": "windows",
    "version": "",
    "kind": "external",
    "openUrl": "",
    "downloadUrl": "",
    "repoUrl": "",
    "featured": false,
    "hidden": false
  },
  {
    "id": "stm",
    "name": "STM",
    "tagline": "Personal task manager for your Windows desktop.",
    "description": "Tasks, projects, notes, reminders, clipboard history and routines in one dependable workspace. Warm and personal, yet dense and fast - built for running your whole day from the desktop.",
    "icon": "img:assets/app-icons/stm.png",
    "category": "desktop",
    "tags": ["Tasks", "Notes"],
    "platform": "windows",
    "version": "6.8.26",
    "kind": "external",
    "openUrl": "",
    "downloadUrl": "",
    "repoUrl": "",
    "featured": false,
    "hidden": false
  },
  {
    "id": "qb-trigger",
    "name": "QB Trigger",
    "tagline": "Trigger Quick Builds without the web UI.",
    "description": "Create QB requests straight from the desktop: multiple build tabs side by side, CL list sorting, dedupe and validation, P4 verification, R&D Hub form import with filter rules, JSON import/export and scheduled builds.",
    "icon": "img:assets/app-icons/qb-trigger.png",
    "category": "desktop",
    "tags": ["Build", "P4"],
    "platform": "windows",
    "version": "6.9.2",
    "kind": "external",
    "openUrl": "",
    "downloadUrl": "",
    "repoUrl": "",
    "featured": false,
    "hidden": false
  },
  {
    "id": "qb-downloader",
    "name": "QB Downloader",
    "tagline": "Fetch build artifacts by QB ID.",
    "description": "Load the artifact list for a QB ID, pick the files you need and batch-download them to your machine. Ships with auto-update. Requires .NET Desktop Runtime 8 x64 and access to the internal QB system.",
    "icon": "img:assets/app-icons/qb-downloader.png",
    "category": "desktop",
    "tags": ["Artifacts", "QB"],
    "platform": "windows",
    "version": "",
    "kind": "external",
    "openUrl": "",
    "downloadUrl": "",
    "repoUrl": "",
    "featured": false,
    "hidden": false
  },
  {
    "id": "agent-deck",
    "name": "Agent Deck",
    "tagline": "A desk for your coding agents.",
    "description": "Claude Code, Codex and Gemini CLI live in persistent terminal panes grouped by workspace and tab, with live status, RAM badges, hibernate and resume, a floating status badge and a single-file installer. Agents keep running while the window is closed.",
    "icon": "img:assets/app-icons/agent-deck.png",
    "category": "desktop",
    "tags": ["Claude Code", "Terminal"],
    "platform": "windows",
    "version": "6.9.0",
    "kind": "external",
    "openUrl": "",
    "downloadUrl": "",
    "repoUrl": "",
    "featured": false,
    "hidden": false
  },
  {
    "id": "html-editor",
    "name": "HTML Editor",
    "tagline": "Prepare and export Release Notice HTML.",
    "description": "Notice HTML Editor converts release inputs and existing notice HTML into a validated, editable, previewable Release Notice - stable previews, clear validation, and no loss of content or formatting on export.",
    "icon": "img:assets/app-icons/html-editor.png",
    "category": "desktop",
    "tags": ["Release", "HTML"],
    "platform": "windows",
    "version": "",
    "kind": "external",
    "openUrl": "",
    "downloadUrl": "",
    "repoUrl": "",
    "featured": false,
    "hidden": false
  }
];
