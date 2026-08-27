/* ============================================================
   SWPL ToolHub - embedded tool bridge
   Applies the hub accent + light/dark theme to every embedded
   tool so the whole site feels like one product.

   Load order inside a tool page:
     1. ../../data/site-config.js   (hub config)
     2. this file                   (before the tool's own CSS is fine;
                                     it only sets CSS variables + data-theme)
   ============================================================ */
(function () {
  "use strict";

  var THEME_KEY = "swpl.theme";

  /* accent -> [light fill, light ink, vivid rgb for dark] - keep in
     sync with ACCENT_PRESETS in assets/site.js */
  var ACCENTS = {
    ember:   ["#c2410c", "#9a3412", "251, 146, 60"],
    cobalt:  ["#2563eb", "#1d4ed8", "96, 165, 250"],
    emerald: ["#047857", "#065f46", "52, 211, 153"],
    violet:  ["#7c3aed", "#6d28d9", "167, 139, 250"],
    rose:    ["#be123c", "#9f1239", "251, 113, 133"],
    teal:    ["#0f766e", "#115e59", "45, 212, 191"],
    slate:   ["#334155", "#1e293b", "148, 163, 184"]
  };

  function hexRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, amount) {
    var c = hexRgb(hex);
    var t = amount < 0 ? 0 : 255;
    var p = Math.abs(amount);
    return "#" + c.map(function (v) {
      v = Math.round(v + (t - v) * p);
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  }

  function applyAccent() {
    var cfg = window.SWPL_CONFIG || {};
    var theme = cfg.theme || {};
    var trio = ACCENTS[theme.accentPreset];
    if (!trio) {
      var hex = /^#[0-9a-fA-F]{6}$/.test(theme.accentCustom || "") ? theme.accentCustom : "#c2410c";
      trio = [hex, shade(hex, -0.16), hexRgb(shade(hex, 0.28)).join(", ")];
    }
    var root = document.documentElement;
    root.style.setProperty("--swpl-fill", trio[0]);
    root.style.setProperty("--swpl-ink", trio[1]);
    root.style.setProperty("--swpl-rgb", trio[2]);
  }

  /* ---------- Theme (light / dark) ---------- */
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }

  function resolveTheme() {
    var saved = storedTheme();
    if (saved === "light" || saved === "dark") return saved;
    var cfg = window.SWPL_CONFIG || {};
    var mode = cfg.theme && cfg.theme.defaultMode;
    if (mode === "light" || mode === "dark") return mode;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    var isDark = theme === "dark";
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var val = isDark ? meta.getAttribute("data-dark") : meta.getAttribute("data-light");
      if (val) meta.setAttribute("content", val);
    }
    document.querySelectorAll("[data-swpl-theme-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(isDark));
      btn.title = isDark ? "Switch to light theme" : "Switch to dark theme";
    });
  }

  function bind() {
    document.querySelectorAll("[data-swpl-theme-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
        applyTheme(next);
      });
    });
  }

  applyAccent();
  applyTheme(resolveTheme());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      applyTheme(resolveTheme());
      bind();
    }, { once: true });
  } else {
    bind();
  }

  /* Live-sync with the hub and other tabs */
  window.addEventListener("storage", function (e) {
    if (e.key === THEME_KEY) applyTheme(resolveTheme());
  });
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      if (!storedTheme()) applyTheme(resolveTheme());
    });
  }
})();
