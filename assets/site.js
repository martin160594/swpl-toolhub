/* ============================================================
   SWPL ToolHub - hub renderer
   Reads window.SWPL_CONFIG + window.SWPL_TOOLS (data/*.js),
   optionally overridden by the admin draft when ?draft=1.
   ============================================================ */
(function () {
  "use strict";

  var THEME_KEY = "swpl.theme";
  var DRAFT_KEY = "swpl.toolhub.draft";

  /* ---------- Presets (shared with admin.js) ---------- */
  var ACCENT_PRESETS = {
    ember:   { label: "Ember",   light: { accent: "#c2410c", strong: "#9a3412", on: "#ffffff" }, dark: { accent: "#fb923c", strong: "#fdba74", on: "#221004" } },
    cobalt:  { label: "Cobalt",  light: { accent: "#2563eb", strong: "#1d4ed8", on: "#ffffff" }, dark: { accent: "#60a5fa", strong: "#93c5fd", on: "#0a1a33" } },
    emerald: { label: "Emerald", light: { accent: "#047857", strong: "#065f46", on: "#ffffff" }, dark: { accent: "#34d399", strong: "#6ee7b7", on: "#032b1f" } },
    violet:  { label: "Violet",  light: { accent: "#7c3aed", strong: "#6d28d9", on: "#ffffff" }, dark: { accent: "#a78bfa", strong: "#c4b5fd", on: "#1c1133" } },
    rose:    { label: "Rose",    light: { accent: "#be123c", strong: "#9f1239", on: "#ffffff" }, dark: { accent: "#fb7185", strong: "#fda4af", on: "#33060f" } },
    teal:    { label: "Teal",    light: { accent: "#0f766e", strong: "#115e59", on: "#ffffff" }, dark: { accent: "#2dd4bf", strong: "#5eead4", on: "#042f2a" } },
    slate:   { label: "Slate",   light: { accent: "#334155", strong: "#1e293b", on: "#ffffff" }, dark: { accent: "#94a3b8", strong: "#cbd5e1", on: "#0f172a" } }
  };

  var FONT_PRESETS = {
    grotesk: {
      label: "Space Grotesk + Geist",
      gf: "family=Space+Grotesk:wght@500;700&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600",
      display: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif",
      body: "'Geist', 'Segoe UI', system-ui, sans-serif",
      mono: "'Geist Mono', 'Cascadia Code', Consolas, ui-monospace, monospace"
    },
    outfit: {
      label: "Outfit + Inter Tight",
      gf: "family=Outfit:wght@500;600;700&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600",
      display: "'Outfit', 'Segoe UI', system-ui, sans-serif",
      body: "'Inter Tight', 'Segoe UI', system-ui, sans-serif",
      mono: "'JetBrains Mono', 'Cascadia Code', Consolas, ui-monospace, monospace"
    },
    plex: {
      label: "IBM Plex",
      gf: "family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600",
      display: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
      body: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
      mono: "'IBM Plex Mono', 'Cascadia Code', Consolas, ui-monospace, monospace"
    },
    system: {
      label: "System UI",
      gf: "",
      display: "system-ui, 'Segoe UI', sans-serif",
      body: "system-ui, 'Segoe UI', sans-serif",
      mono: "ui-monospace, 'Cascadia Code', Consolas, monospace"
    }
  };

  var DEFAULT_CONFIG = {
    site: {
      title: "SWPL ToolHub", tagline: "", description: "", logoText: "SWPL", logoAccent: "ToolHub",
      footerText: "", showHero: true, showSearch: true, showCategories: true, showFooter: true, showAdminLink: true
    },
    theme: {
      defaultMode: "system", accentPreset: "ember", accentCustom: "#c2410c", radius: 14,
      font: "grotesk", density: "comfortable", cardStyle: "elevated", heroStyle: "aurora",
      bgPattern: true, animations: true, customCSS: ""
    },
    layout: { columns: "auto", groupByCategory: false, showTags: true, showBadges: true, showVersions: true, sort: "manual" },
    categories: [],
    github: { owner: "", repo: "", branch: "main" },
    security: { passHash: "" }
  };

  /* ---------- Utilities ---------- */
  function deepMerge(base, patch) {
    if (patch === null || patch === undefined) return base;
    if (Array.isArray(base) || Array.isArray(patch)) return patch !== undefined ? patch : base;
    if (typeof base !== "object" || typeof patch !== "object") return patch !== undefined ? patch : base;
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(patch).forEach(function (k) {
      out[k] = (typeof base[k] === "object" && base[k] !== null && !Array.isArray(base[k]))
        ? deepMerge(base[k], patch[k])
        : patch[k];
    });
    return out;
  }

  function readDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  var isDraftView = /(^|[?&])draft=1(&|$)/.test(location.search);

  function currentData() {
    var cfg = deepMerge(DEFAULT_CONFIG, window.SWPL_CONFIG || {});
    var tools = Array.isArray(window.SWPL_TOOLS) ? window.SWPL_TOOLS.slice() : [];
    if (isDraftView) {
      var draft = readDraft();
      if (draft) {
        if (draft.config) cfg = deepMerge(cfg, draft.config);
        if (Array.isArray(draft.tools)) tools = draft.tools.slice();
      }
    }
    return { config: cfg, tools: tools };
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null && text !== "") node.textContent = text;
    return node;
  }

  function iconNode(name, cls) {
    var wrap = document.createElement("span");
    wrap.innerHTML = window.swplIcon ? window.swplIcon(name, cls) : "";
    return wrap.firstChild || document.createTextNode("");
  }

  function toolVisual(tool) {
    var icon = String(tool.icon || "");
    if (icon.indexOf("emoji:") === 0) {
      return el("span", "tool-emoji", icon.slice(6));
    }
    if (icon.indexOf("img:") === 0) {
      var img = document.createElement("img");
      img.src = icon.slice(4);
      img.alt = "";
      img.loading = "lazy";
      return img;
    }
    if (window.SWPL_ICONS && window.SWPL_ICONS[icon]) return iconNode(icon);
    return iconNode("app-window");
  }

  function toast(message) {
    var old = document.querySelector(".toast");
    if (old) old.remove();
    var node = el("div", "toast", message);
    document.body.appendChild(node);
    setTimeout(function () { node.remove(); }, 2200);
  }

  /* ---------- Theme (light / dark) ---------- */
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }

  function resolveTheme(cfg) {
    var saved = storedTheme();
    if (saved === "light" || saved === "dark") return saved;
    var mode = cfg.theme.defaultMode;
    if (mode === "light" || mode === "dark") return mode;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0e0e10" : "#f6f6f7");
  }

  /* ---------- Config application ---------- */
  function accentColors(cfg) {
    var preset = ACCENT_PRESETS[cfg.theme.accentPreset];
    if (preset) return preset;
    var hex = /^#[0-9a-fA-F]{6}$/.test(cfg.theme.accentCustom || "") ? cfg.theme.accentCustom : "#c2410c";
    var on = luminance(hex) > 0.45 ? "#1a1408" : "#ffffff";
    return {
      light: { accent: hex, strong: shade(hex, -0.16), on: on },
      dark: { accent: shade(hex, 0.28), strong: shade(hex, 0.44), on: luminance(shade(hex, 0.28)) > 0.45 ? "#1a1408" : "#ffffff" }
    };
  }

  function hexRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbHex(r, g, b) {
    return "#" + [r, g, b].map(function (v) {
      v = Math.max(0, Math.min(255, Math.round(v)));
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  }
  function shade(hex, amount) {
    var c = hexRgb(hex);
    var t = amount < 0 ? 0 : 255;
    var p = Math.abs(amount);
    return rgbHex(c[0] + (t - c[0]) * p, c[1] + (t - c[1]) * p, c[2] + (t - c[2]) * p);
  }
  function luminance(hex) {
    var c = hexRgb(hex);
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  }
  function rgba(hex, a) {
    var c = hexRgb(hex);
    return "rgba(" + c[0] + ", " + c[1] + ", " + c[2] + ", " + a + ")";
  }

  function applyDynamicStyle(cfg) {
    var a = accentColors(cfg);
    var font = FONT_PRESETS[cfg.theme.font] || FONT_PRESETS.grotesk;
    var radius = parseInt(cfg.theme.radius, 10);
    if (!(radius >= 0 && radius <= 28)) radius = 14;

    var css =
      ":root{" +
      "--accent:" + a.light.accent + ";--accent-strong:" + a.light.strong + ";--on-accent:" + a.light.on + ";" +
      "--accent-soft:" + rgba(a.light.accent, 0.10) + ";--accent-line:" + rgba(a.light.accent, 0.30) + ";" +
      "--ring:" + rgba(a.light.accent, 0.40) + ";--accent-glow:" + rgba(a.light.accent, 0.15) + ";" +
      "--radius:" + radius + "px;--radius-sm:" + Math.max(4, radius - 5) + "px;" +
      "--font-display:" + font.display + ";--font-body:" + font.body + ";--font-mono:" + font.mono + ";}" +
      'html[data-theme="dark"]{' +
      "--accent:" + a.dark.accent + ";--accent-strong:" + a.dark.strong + ";--on-accent:" + a.dark.on + ";" +
      "--accent-soft:" + rgba(a.dark.accent, 0.13) + ";--accent-line:" + rgba(a.dark.accent, 0.34) + ";" +
      "--ring:" + rgba(a.dark.accent, 0.45) + ";--accent-glow:" + rgba(a.dark.accent, 0.12) + ";}";

    var styleNode = document.getElementById("swpl-dynamic");
    if (!styleNode) {
      styleNode = document.createElement("style");
      styleNode.id = "swpl-dynamic";
      document.head.appendChild(styleNode);
    }
    styleNode.textContent = css;

    var customNode = document.getElementById("swpl-custom-css");
    if (!customNode) {
      customNode = document.createElement("style");
      customNode.id = "swpl-custom-css";
      document.head.appendChild(customNode);
    }
    customNode.textContent = cfg.theme.customCSS || "";

    var gfLink = document.getElementById("swpl-fonts");
    var href = font.gf ? "https://fonts.googleapis.com/css2?" + font.gf + "&display=swap" : "";
    if (href) {
      if (!gfLink) {
        gfLink = document.createElement("link");
        gfLink.id = "swpl-fonts";
        gfLink.rel = "stylesheet";
        document.head.appendChild(gfLink);
      }
      if (gfLink.getAttribute("href") !== href) gfLink.setAttribute("href", href);
    } else if (gfLink) {
      gfLink.remove();
    }
  }

  function applyChrome(cfg) {
    var s = cfg.site;
    var isAdmin = document.body.classList.contains("admin-body");
    if (!isAdmin) document.title = s.title || "SWPL ToolHub";
    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", s.description || s.tagline || "");

    var body = document.body;
    body.dataset.hero = s.showHero ? "on" : "off";
    body.dataset.search = s.showSearch ? "on" : "off";
    body.dataset.cats = s.showCategories ? "on" : "off";
    body.dataset.footer = s.showFooter ? "on" : "off";
    body.dataset.cols = String(cfg.layout.columns || "auto");
    body.dataset.density = cfg.theme.density === "compact" ? "compact" : "comfortable";
    body.dataset.cardStyle = cfg.theme.cardStyle || "elevated";
    body.dataset.heroStyle = cfg.theme.heroStyle || "aurora";
    body.dataset.pattern = cfg.theme.bgPattern ? "on" : "off";
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    body.dataset.anim = cfg.theme.animations && !reduce ? "on" : "off";

    var logo = document.getElementById("brand-word");
    if (logo) {
      logo.textContent = "";
      logo.appendChild(document.createTextNode((s.logoText || "") + (s.logoText ? " " : "")));
      var em = el("em", null, s.logoAccent || "");
      logo.appendChild(em);
    }

    var heroTitle = document.getElementById("hero-title");
    if (heroTitle) {
      heroTitle.textContent = s.title || "";
      var tile = el("span", "hero-tile");
      tile.setAttribute("aria-hidden", "true");
      heroTitle.appendChild(tile);
    }
    var heroTagline = document.getElementById("hero-tagline");
    if (heroTagline) {
      heroTagline.textContent = s.tagline || "";
      heroTagline.hidden = !s.tagline;
    }

    var footText = document.getElementById("footer-text");
    if (footText) footText.textContent = s.footerText || "";
    var adminLinks = document.querySelectorAll("[data-admin-link]");
    adminLinks.forEach(function (n) { n.hidden = !s.showAdminLink; });
  }

  /* ---------- Rendering ---------- */
  var state = { query: "", category: "all" };
  var lastFocusedCard = null;

  function visibleTools(data) {
    var tools = data.tools.filter(function (t) { return !t.hidden; });
    if (data.config.layout.sort === "name") {
      tools.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    }
    return tools;
  }

  function matches(tool, query) {
    if (!query) return true;
    var q = query.toLowerCase();
    var hay = [tool.name, tool.tagline, tool.description, (tool.tags || []).join(" "), tool.category]
      .join(" ").toLowerCase();
    return q.split(/\s+/).every(function (part) { return hay.indexOf(part) !== -1; });
  }

  function renderChips(data) {
    var wrap = document.getElementById("chips");
    if (!wrap) return;
    wrap.textContent = "";
    var tools = visibleTools(data);

    function chip(id, label, icon, count) {
      var b = el("button", "chip" + (state.category === id ? " is-active" : ""));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", state.category === id ? "true" : "false");
      if (icon) b.appendChild(iconNode(icon));
      b.appendChild(el("span", null, label));
      b.appendChild(el("span", "chip-count", String(count)));
      b.addEventListener("click", function () {
        state.category = id;
        renderChips(data);
        renderGrid(data);
      });
      return b;
    }

    wrap.appendChild(chip("all", "All", null, tools.length));
    (data.config.categories || []).forEach(function (cat) {
      var count = tools.filter(function (t) { return t.category === cat.id; }).length;
      if (count > 0) wrap.appendChild(chip(cat.id, cat.name, cat.icon, count));
    });
  }

  function badgeNode(cls, icon, label) {
    var b = el("span", "badge " + cls);
    if (icon) b.appendChild(iconNode(icon));
    b.appendChild(el("span", null, label));
    return b;
  }

  /* Ghost mark: the tool's own icon, oversized, as the card's signature.
     Skipped for image icons (a giant photo would fight the layout). */
  function ghostNode(tool, cls) {
    var icon = String(tool.icon || "");
    if (icon.indexOf("img:") === 0) return null;
    var ghost = el("span", cls);
    ghost.setAttribute("aria-hidden", "true");
    ghost.appendChild(toolVisual(tool));
    return ghost;
  }

  function metaNodes(tool, cfg, tagLimit) {
    var nodes = [];
    if (cfg.layout.showBadges) {
      if (tool.platform === "web") nodes.push(badgeNode("badge-live", "globe-simple", "Runs in browser"));
      else if (tool.platform === "windows") nodes.push(badgeNode("", "desktop", "Windows"));
    }
    if (cfg.layout.showVersions && tool.version) {
      nodes.push(el("span", "badge-version", "v" + String(tool.version).replace(/^v/i, "")));
    }
    if (cfg.layout.showTags && Array.isArray(tool.tags)) {
      tool.tags.slice(0, tagLimit).forEach(function (tag) {
        nodes.push(el("span", "tagchip", tag));
      });
    }
    return nodes;
  }

  function lpCard(tool, cfg, data, index) {
    var card = el("button", "lp-card");
    card.type = "button";
    card.style.setProperty("--i", String(index));
    card.setAttribute("aria-haspopup", "dialog");
    card.dataset.toolId = tool.id;

    var ghost = ghostNode(tool, "lp-ghost");
    if (ghost) card.appendChild(ghost);

    var top = el("div", "lp-top");
    var iconWrap = el("span", "lp-icon");
    iconWrap.appendChild(toolVisual(tool));
    top.appendChild(iconWrap);

    var heading = el("span", "lp-heading");
    heading.appendChild(el("span", "lp-name", tool.name || tool.id));
    if (tool.tagline) heading.appendChild(el("span", "lp-tagline", tool.tagline));
    top.appendChild(heading);

    var arrow = el("span", "lp-arrow");
    arrow.appendChild(iconNode("arrow-up-right"));
    top.appendChild(arrow);
    card.appendChild(top);

    var meta = el("span", "lp-meta");
    metaNodes(tool, cfg, 3).forEach(function (n) { meta.appendChild(n); });
    if (meta.childNodes.length) card.appendChild(meta);

    card.addEventListener("click", function () {
      lastFocusedCard = card;
      openDialog(tool, data);
    });
    return card;
  }

  function regRow(tool, cfg, data) {
    var row = el("button", "reg-row");
    row.type = "button";
    row.setAttribute("aria-haspopup", "dialog");
    row.dataset.toolId = tool.id;

    var iconWrap = el("span", "reg-icon");
    iconWrap.appendChild(toolVisual(tool));
    row.appendChild(iconWrap);

    var main = el("span", "reg-main");
    main.appendChild(el("span", "reg-name", tool.name || tool.id));
    if (tool.tagline) main.appendChild(el("span", "reg-tagline", tool.tagline));
    row.appendChild(main);

    var side = el("span", "reg-side");
    if (cfg.layout.showTags && Array.isArray(tool.tags)) {
      tool.tags.slice(0, 2).forEach(function (tag) {
        side.appendChild(el("span", "tagchip", tag));
      });
    }
    if (cfg.layout.showVersions && tool.version) {
      side.appendChild(el("span", "badge-version", "v" + String(tool.version).replace(/^v/i, "")));
    }
    if (cfg.layout.showBadges) {
      if (tool.platform === "web") side.appendChild(badgeNode("badge-live", "globe-simple", "Runs in browser"));
      else if (tool.platform === "windows") side.appendChild(badgeNode("", "desktop", "Windows"));
    }
    var chevron = el("span", "reg-chevron");
    chevron.appendChild(iconNode("arrow-up-right"));
    side.appendChild(chevron);
    row.appendChild(side);

    row.addEventListener("click", function () {
      lastFocusedCard = row;
      openDialog(tool, data);
    });
    return row;
  }

  function renderGrid(data) {
    var grid = document.getElementById("tool-grid");
    var empty = document.getElementById("empty-state");
    if (!grid) return;
    grid.textContent = "";

    var cfg = data.config;
    var tools = visibleTools(data).filter(function (t) {
      if (state.category !== "all" && t.category !== state.category) return false;
      return matches(t, state.query);
    });

    if (!tools.length) {
      empty.hidden = false;
      grid.hidden = true;
      return;
    }
    empty.hidden = true;
    grid.hidden = false;

    var featured = tools.filter(function (t) { return t.featured; });
    var rest = tools.filter(function (t) { return !t.featured; });
    var cardIndex = 0;
    var blockIndex = 0;

    function addLaunchpad(list) {
      if (!list.length) return;
      var lp = el("div", "launchpad");
      list.forEach(function (tool) {
        lp.appendChild(lpCard(tool, cfg, data, cardIndex++));
      });
      grid.appendChild(lp);
    }

    function addRegistry(list) {
      if (!list.length) return;
      var reg = el("div", "registry");
      reg.style.setProperty("--i", String(blockIndex++));
      list.forEach(function (tool) {
        reg.appendChild(regRow(tool, cfg, data));
      });
      grid.appendChild(reg);
    }

    function addGroupTitle(cat, count) {
      var title = el("h2", "group-title");
      title.style.setProperty("--i", String(blockIndex));
      if (cat.icon) title.appendChild(iconNode(cat.icon));
      title.appendChild(el("span", null, cat.name));
      title.appendChild(el("span", "group-count", String(count)));
      grid.appendChild(title);
    }

    addLaunchpad(featured);

    if (cfg.layout.groupByCategory && cfg.categories.length) {
      cfg.categories.forEach(function (cat) {
        var inCat = rest.filter(function (t) { return t.category === cat.id; });
        if (!inCat.length) return;
        addGroupTitle(cat, inCat.length);
        addRegistry(inCat);
      });
      var uncategorised = rest.filter(function (t) {
        return !cfg.categories.some(function (c) { return c.id === t.category; });
      });
      addRegistry(uncategorised);
    } else {
      addRegistry(rest);
    }
  }

  /* Cursor spotlight on launchpad cards: one delegated listener,
     rAF-throttled, writes --mx/--my consumed by the border gradient. */
  function bindSpotlight() {
    var grid = document.getElementById("tool-grid");
    if (!grid) return;
    var last = 0;
    grid.addEventListener("pointermove", function (e) {
      var card = e.target.closest ? e.target.closest(".lp-card") : null;
      if (!card) return;
      var now = (window.performance || Date).now();
      if (now - last < 16) return;
      last = now;
      var rect = card.getBoundingClientRect();
      if (!rect.width) return;
      card.style.setProperty("--mx", ((e.clientX - rect.left) / rect.width * 100).toFixed(1) + "%");
      card.style.setProperty("--my", ((e.clientY - rect.top) / rect.height * 100).toFixed(1) + "%");
    });
  }

  /* ---------- Dialog ---------- */
  var currentDialogCleanup = null;

  function closeToolDialog() {
    var dlg = document.getElementById("tool-dialog");
    if (dlg && dlg.open) dlg.close();
    if (currentDialogCleanup) currentDialogCleanup();
  }

  function bindDialogShell() {
    var dlg = document.getElementById("tool-dialog");
    if (!dlg) return;
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) closeToolDialog();
    });
    // Native close event (Esc, form method=dialog). Some embedded browsers
    // swallow it, so explicit close paths also run the cleanup directly.
    dlg.addEventListener("close", function () {
      if (currentDialogCleanup) currentDialogCleanup();
    });
    dlg.addEventListener("cancel", function () {
      setTimeout(function () { if (currentDialogCleanup) currentDialogCleanup(); }, 0);
    });
    dlg.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        setTimeout(function () { if (currentDialogCleanup) currentDialogCleanup(); }, 0);
      }
    });
  }

  function openDialog(tool, data) {
    var dlg = document.getElementById("tool-dialog");
    if (!dlg) return;
    var cfg = data.config;

    dlg.textContent = "";
    var inner = el("div", "dlg-inner");

    var dlgGhost = ghostNode(tool, "dlg-ghost");
    if (dlgGhost) inner.appendChild(dlgGhost);

    var head = el("div", "dlg-head");
    var icon = el("span", "dlg-icon");
    icon.appendChild(toolVisual(tool));
    head.appendChild(icon);

    var headingWrap = el("div", "dlg-heading");
    var title = el("h2", "dlg-title", tool.name || tool.id);
    title.id = "dlg-title";
    headingWrap.appendChild(title);

    var meta = el("p", "dlg-meta");
    var cat = (cfg.categories || []).find(function (c) { return c.id === tool.category; });
    if (tool.platform === "web") meta.appendChild(badgeNode("badge-live", "globe-simple", "Runs in browser"));
    else if (tool.platform === "windows") meta.appendChild(badgeNode("", "desktop", "Windows"));
    if (cat) meta.appendChild(el("span", null, cat.name));
    if (tool.version) meta.appendChild(el("span", "badge-version", "v" + String(tool.version).replace(/^v/i, "")));
    headingWrap.appendChild(meta);
    head.appendChild(headingWrap);

    var close = el("button", "dlg-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.appendChild(iconNode("x"));
    close.addEventListener("click", closeToolDialog);
    head.appendChild(close);
    inner.appendChild(head);

    if (tool.description || tool.tagline) {
      inner.appendChild(el("p", "dlg-desc", tool.description || tool.tagline));
    }

    if (cfg.layout.showTags && Array.isArray(tool.tags) && tool.tags.length) {
      var tags = el("div", "dlg-tags");
      tool.tags.forEach(function (t) { tags.appendChild(el("span", "tagchip", t)); });
      inner.appendChild(tags);
    }

    var actions = el("div", "dlg-actions");
    var openUrl = String(tool.openUrl || "").trim();
    var downloadUrl = String(tool.downloadUrl || "").trim();
    var repoUrl = String(tool.repoUrl || "").trim();

    if (openUrl) {
      var openBtn = document.createElement("a");
      openBtn.className = "btn btn-primary";
      openBtn.href = openUrl;
      if (tool.kind !== "embedded") {
        openBtn.target = "_blank";
        openBtn.rel = "noopener";
      }
      openBtn.appendChild(iconNode("arrow-square-out"));
      openBtn.appendChild(el("span", null, tool.kind === "embedded" ? "Open tool" : "Open link"));
      actions.appendChild(openBtn);
    }

    if (downloadUrl) {
      var dlBtn = document.createElement("a");
      dlBtn.className = "btn " + (openUrl ? "btn-secondary" : "btn-primary");
      dlBtn.href = downloadUrl;
      dlBtn.target = "_blank";
      dlBtn.rel = "noopener";
      dlBtn.appendChild(iconNode("download-simple"));
      dlBtn.appendChild(el("span", null, "Download"));
      actions.appendChild(dlBtn);
    }

    if (repoUrl) {
      var repoBtn = document.createElement("a");
      repoBtn.className = "btn btn-ghost";
      repoBtn.href = repoUrl;
      repoBtn.target = "_blank";
      repoBtn.rel = "noopener";
      repoBtn.appendChild(iconNode("github-logo"));
      repoBtn.appendChild(el("span", null, "Source"));
      actions.appendChild(repoBtn);
    }

    var copyBtn = el("button", "btn btn-ghost");
    copyBtn.type = "button";
    copyBtn.appendChild(iconNode("link-simple"));
    copyBtn.appendChild(el("span", null, "Copy link"));
    copyBtn.addEventListener("click", function () {
      var url = new URL(location.pathname + "#t=" + encodeURIComponent(tool.id), location.href).href;
      navigator.clipboard.writeText(url).then(function () {
        toast("Link copied");
      }, function () {
        toast("Copy failed");
      });
    });
    actions.appendChild(copyBtn);
    inner.appendChild(actions);

    if (!downloadUrl && tool.kind !== "embedded") {
      inner.appendChild(el("p", "dlg-note", "No download link yet. Add one in the Admin console."));
    }

    dlg.appendChild(inner);
    dlg.setAttribute("aria-labelledby", "dlg-title");

    currentDialogCleanup = function () {
      currentDialogCleanup = null;
      if (location.hash.indexOf("#t=") === 0) {
        history.replaceState(null, "", location.pathname + location.search);
      }
      if (lastFocusedCard && document.contains(lastFocusedCard)) lastFocusedCard.focus();
    };

    if (!dlg.open) dlg.showModal();
    history.replaceState(null, "", location.pathname + location.search + "#t=" + encodeURIComponent(tool.id));
  }

  /* ---------- Bindings ---------- */
  function bindSearch(getData) {
    var box = document.getElementById("search-box");
    var input = document.getElementById("search-input");
    var clear = document.getElementById("search-clear");
    if (!input) return;

    function sync() {
      state.query = input.value.trim();
      box.classList.toggle("has-value", !!state.query);
      renderGrid(getData());
    }
    input.addEventListener("input", sync);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && input.value) {
        input.value = "";
        sync();
        e.stopPropagation();
      }
    });
    if (clear) clear.addEventListener("click", function () {
      input.value = "";
      sync();
      input.focus();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      var dlg = document.getElementById("tool-dialog");
      if (dlg && dlg.open) return;
      e.preventDefault();
      input.focus();
      input.select();
    });

    var resetBtn = document.getElementById("empty-reset");
    if (resetBtn) resetBtn.addEventListener("click", function () {
      input.value = "";
      state.query = "";
      state.category = "all";
      box.classList.remove("has-value");
      var data = getData();
      renderChips(data);
      renderGrid(data);
    });
  }

  function bindThemeToggle(getData) {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
      applyTheme(next);
    });
  }

  function openFromHash(data) {
    var match = location.hash.match(/^#t=(.+)$/);
    if (!match) return;
    var id = decodeURIComponent(match[1]);
    var tool = data.tools.find(function (t) { return t.id === id && !t.hidden; });
    if (tool) openDialog(tool, data);
  }

  /* ---------- Boot ---------- */
  function renderAll() {
    var data = currentData();
    applyDynamicStyle(data.config);
    applyChrome(data.config);
    renderChips(data);
    renderGrid(data);
    return data;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var data = renderAll();
    applyTheme(resolveTheme(data.config));

    bindDialogShell();
    bindSpotlight();
    bindSearch(function () { return currentData(); });
    bindThemeToggle();
    openFromHash(data);

    window.addEventListener("hashchange", function () {
      var dlg = document.getElementById("tool-dialog");
      if (dlg && dlg.open) return;
      openFromHash(currentData());
    });

    if (isDraftView) {
      window.addEventListener("storage", function (e) {
        if (e.key === DRAFT_KEY || e.key === null) renderAll();
      });
      window.addEventListener("message", function (e) {
        if (e.data && e.data.type === "swpl-draft-updated") renderAll();
      });
    }

    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
        if (!storedTheme()) applyTheme(resolveTheme(currentData().config));
      });
    }
  });

  /* Shared exports for admin.js */
  window.SWPL_SHARED = {
    ACCENT_PRESETS: ACCENT_PRESETS,
    FONT_PRESETS: FONT_PRESETS,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    deepMerge: deepMerge,
    accentColors: accentColors,
    rgba: rgba,
    shade: shade
  };
})();
