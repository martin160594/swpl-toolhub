/* ============================================================
   SWPL ToolHub - admin console
   Draft-based editing: every change lands in localStorage as a
   draft, previewed live in the iframe (index.html?draft=1).
   Publishing writes data/site-config.js + data/tools.js back to
   the GitHub repo (Contents API) or exports them as files.
   ============================================================ */
(function () {
  "use strict";

  var S = window.SWPL_SHARED;
  var DRAFT_KEY = "swpl.toolhub.draft";
  var TOKEN_KEY = "swpl.toolhub.ghtoken";
  var SESSION_KEY = "swpl.toolhub.admin";
  var DEFAULT_HASH = "ced5b26c6de435f8760c80e9ba29db61254596a1fa23d392da32b7f6b923874a";

  /* ================= Utilities ================= */
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function getPath(obj, path) {
    return path.split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function setPath(obj, path, value) {
    var keys = path.split(".");
    var last = keys.pop();
    var target = keys.reduce(function (o, k) {
      if (typeof o[k] !== "object" || o[k] === null) o[k] = {};
      return o[k];
    }, obj);
    target[last] = value;
  }

  function icon(name) { return window.swplIcon ? window.swplIcon(name) : ""; }

  function toast(message) {
    var old = document.querySelector(".toast");
    if (old) old.remove();
    var node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(function () { node.remove(); }, 2400);
  }

  function slugify(text) {
    return String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "tool";
  }

  function b64utf8(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  /* SHA-256: WebCrypto when available, pure-JS fallback otherwise */
  function sha256Fallback(str) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bytes = Array.from(new TextEncoder().encode(str));
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var i = 7; i >= 0; i--) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var b = 0; b < bytes.length; b += 64) {
      var w = new Array(64);
      for (var t = 0; t < 16; t++) {
        w[t] = (bytes[b + t * 4] << 24) | (bytes[b + t * 4 + 1] << 16) | (bytes[b + t * 4 + 2] << 8) | bytes[b + t * 4 + 3];
      }
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & bb) ^ (a & c) ^ (bb & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
  }

  function sha256Hex(str) {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(function (buf) {
        return Array.from(new Uint8Array(buf)).map(function (b) {
          return b.toString(16).padStart(2, "0");
        }).join("");
      }).catch(function () { return sha256Fallback(str); });
    }
    return Promise.resolve(sha256Fallback(str));
  }

  function hashPassword(pw) { return sha256Hex("swpl::" + pw); }

  /* ================= State ================= */
  var published = {
    config: S.deepMerge(S.DEFAULT_CONFIG, window.SWPL_CONFIG || {}),
    tools: clone(Array.isArray(window.SWPL_TOOLS) ? window.SWPL_TOOLS : [])
  };

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        config: S.deepMerge(S.DEFAULT_CONFIG, parsed.config || {}),
        tools: Array.isArray(parsed.tools) ? parsed.tools : clone(published.tools)
      };
    } catch (e) { return null; }
  }

  var draft = loadDraft() || clone(published);

  function isDirty() {
    return JSON.stringify(draft) !== JSON.stringify(published);
  }

  function passHash() {
    return (draft.config.security && draft.config.security.passHash) ||
      (published.config.security && published.config.security.passHash) ||
      DEFAULT_HASH;
  }

  /* ================= Commit (persist draft + refresh UI) ================= */
  var previewFrame = null;

  function notifyPreview() {
    if (previewFrame && previewFrame.contentWindow) {
      try { previewFrame.contentWindow.postMessage({ type: "swpl-draft-updated" }, "*"); } catch (e) {}
    }
  }

  function updateStatus() {
    var node = document.getElementById("draft-status");
    if (!node) return;
    if (isDirty()) {
      node.textContent = "Draft, not published yet";
      node.className = "draft-status is-dirty";
    } else {
      node.textContent = "In sync with published files";
      node.className = "draft-status is-clean";
    }
  }

  function applyAdminStyle(cfg) {
    var a = S.accentColors(cfg);
    var font = S.FONT_PRESETS[cfg.theme.font] || S.FONT_PRESETS.grotesk;
    var radius = parseInt(cfg.theme.radius, 10);
    if (!(radius >= 0 && radius <= 28)) radius = 14;
    var css =
      ":root{--accent:" + a.light.accent + ";--accent-strong:" + a.light.strong + ";--on-accent:" + a.light.on +
      ";--accent-soft:" + S.rgba(a.light.accent, 0.10) + ";--accent-line:" + S.rgba(a.light.accent, 0.30) +
      ";--ring:" + S.rgba(a.light.accent, 0.40) + ";--accent-glow:" + S.rgba(a.light.accent, 0.15) +
      ";--radius:" + radius + "px;--radius-sm:" + Math.max(4, radius - 5) + "px" +
      ";--font-display:" + font.display + ";--font-body:" + font.body + ";--font-mono:" + font.mono + ";}" +
      'html[data-theme="dark"]{--accent:' + a.dark.accent + ";--accent-strong:" + a.dark.strong + ";--on-accent:" + a.dark.on +
      ";--accent-soft:" + S.rgba(a.dark.accent, 0.13) + ";--accent-line:" + S.rgba(a.dark.accent, 0.34) +
      ";--ring:" + S.rgba(a.dark.accent, 0.45) + ";--accent-glow:" + S.rgba(a.dark.accent, 0.12) + ";}";
    var node = document.getElementById("swpl-dynamic");
    if (!node) {
      node = document.createElement("style");
      node.id = "swpl-dynamic";
      document.head.appendChild(node);
    }
    node.textContent = css;
  }

  function commit() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {
      toast("Could not save draft (storage full?)");
    }
    updateStatus();
    applyAdminStyle(draft.config);
    notifyPreview();
  }

  /* ================= Generated files ================= */
  function genConfigFile(cfg) {
    return "/* SWPL ToolHub - site configuration. Generated by admin.html. */\n" +
      "window.SWPL_CONFIG = " + JSON.stringify(cfg, null, 2) + ";\n";
  }
  function genToolsFile(tools) {
    return "/* SWPL ToolHub - tool registry. Generated by admin.html. */\n" +
      "window.SWPL_TOOLS = " + JSON.stringify(tools, null, 2) + ";\n";
  }

  function downloadFile(name, content, mime) {
    var blob = new Blob([content], { type: mime || "text/javascript" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  /* ================= Confirm dialog ================= */
  function confirmDlg(title, text) {
    return new Promise(function (resolve) {
      var dlg = document.getElementById("confirm-dlg");
      document.getElementById("confirm-title").textContent = title;
      document.getElementById("confirm-text").textContent = text;
      var yes = document.getElementById("confirm-yes");
      var no = document.getElementById("confirm-no");
      function cleanup(result) {
        yes.removeEventListener("click", onYes);
        no.removeEventListener("click", onNo);
        dlg.removeEventListener("close", onClose);
        if (dlg.open) dlg.close();
        resolve(result);
      }
      function onYes() { cleanup(true); }
      function onNo() { cleanup(false); }
      function onClose() { cleanup(false); }
      yes.addEventListener("click", onYes);
      no.addEventListener("click", onNo);
      dlg.addEventListener("close", onClose);
      dlg.showModal();
    });
  }

  /* ================= Gate ================= */
  var failCount = 0;
  var lockUntil = 0;

  function showApp() {
    document.getElementById("gate").hidden = true;
    document.getElementById("admin-app").hidden = false;
    boot();
  }

  function initGate() {
    var form = document.getElementById("gate-form");
    var input = document.getElementById("gate-pass");
    var error = document.getElementById("gate-error");
    var eye = document.getElementById("gate-eye");
    var card = form;

    eye.innerHTML = icon("eye");
    eye.addEventListener("click", function () {
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      eye.innerHTML = icon(show ? "eye-slash" : "eye");
      eye.setAttribute("aria-pressed", String(show));
      input.focus();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (Date.now() < lockUntil) {
        error.hidden = false;
        error.textContent = "Too many attempts. Wait " + Math.ceil((lockUntil - Date.now()) / 1000) + "s and try again.";
        return;
      }
      var pw = input.value;
      hashPassword(pw).then(function (hash) {
        if (hash === passHash()) {
          try { sessionStorage.setItem(SESSION_KEY, hash); } catch (err) {}
          showApp();
        } else {
          failCount++;
          if (failCount >= 5) {
            lockUntil = Date.now() + 15000;
            failCount = 0;
          }
          error.hidden = false;
          error.textContent = "Wrong password.";
          card.classList.remove("is-shaking");
          void card.offsetWidth;
          card.classList.add("is-shaking");
          input.select();
        }
      });
    });

    try {
      if (sessionStorage.getItem(SESSION_KEY) === passHash()) {
        showApp();
        return;
      }
    } catch (e) {}
    input.focus();
  }

  /* ================= Field binder ================= */
  function initBindings() {
    document.querySelectorAll("[data-bind]").forEach(function (input) {
      var path = input.getAttribute("data-bind");
      var type = input.getAttribute("data-type");
      var current = getPath(draft.config, path);

      if (type === "bool") input.checked = !!current;
      else if (current !== undefined && current !== null) input.value = String(current);

      var eventName = (input.tagName === "SELECT" || type === "bool") ? "change" : "input";
      input.addEventListener(eventName, function () {
        var value;
        if (type === "bool") value = input.checked;
        else if (type === "int") value = parseInt(input.value, 10) || 0;
        else value = input.value;
        setPath(draft.config, path, value);
        if (path === "theme.radius") {
          var label = document.getElementById("radius-val");
          if (label) label.textContent = value + "px";
        }
        commit();
      });

      if (path === "theme.radius") {
        var label = document.getElementById("radius-val");
        if (label) label.textContent = (parseInt(input.value, 10) || 14) + "px";
      }
    });
  }

  function refreshBindings() {
    document.querySelectorAll("[data-bind]").forEach(function (input) {
      var current = getPath(draft.config, input.getAttribute("data-bind"));
      if (input.getAttribute("data-type") === "bool") input.checked = !!current;
      else if (current !== undefined && current !== null) input.value = String(current);
    });
    var label = document.getElementById("radius-val");
    if (label) label.textContent = (draft.config.theme.radius || 14) + "px";
    renderAccentRow();
  }

  /* ================= Accent picker ================= */
  function renderAccentRow() {
    var row = document.getElementById("accent-row");
    if (!row) return;
    row.textContent = "";
    Object.keys(S.ACCENT_PRESETS).forEach(function (key) {
      var preset = S.ACCENT_PRESETS[key];
      var b = document.createElement("button");
      b.type = "button";
      b.className = "accent-swatch" + (draft.config.theme.accentPreset === key ? " is-active" : "");
      b.style.background = "linear-gradient(140deg, " + preset.light.accent + ", " + preset.dark.accent + ")";
      b.title = preset.label;
      b.setAttribute("aria-label", "Accent: " + preset.label);
      b.innerHTML = icon("check");
      b.addEventListener("click", function () {
        draft.config.theme.accentPreset = key;
        renderAccentRow();
        commit();
      });
      row.appendChild(b);
    });

    var customInput = document.getElementById("f-accent-custom");
    var customHex = document.getElementById("accent-custom-hex");
    if (customInput) {
      customInput.value = /^#[0-9a-fA-F]{6}$/.test(draft.config.theme.accentCustom || "")
        ? draft.config.theme.accentCustom : "#c2410c";
      if (customHex) customHex.textContent = customInput.value;
    }
  }

  function initAccentCustom() {
    var customInput = document.getElementById("f-accent-custom");
    var customHex = document.getElementById("accent-custom-hex");
    if (!customInput) return;
    customInput.addEventListener("input", function () {
      draft.config.theme.accentPreset = "custom";
      draft.config.theme.accentCustom = customInput.value;
      if (customHex) customHex.textContent = customInput.value;
      renderAccentRow();
      commit();
    });
  }

  /* ================= Panel navigation ================= */
  function initNav() {
    var nav = document.getElementById("admin-nav");
    nav.addEventListener("click", function (e) {
      var btn = e.target.closest(".nav-item");
      if (!btn) return;
      nav.querySelectorAll(".nav-item").forEach(function (n) { n.classList.toggle("is-active", n === btn); });
      var id = btn.getAttribute("data-panel");
      document.querySelectorAll(".panel").forEach(function (p) {
        p.classList.toggle("is-active", p.getAttribute("data-panel-id") === id);
      });
    });
  }

  /* ================= Tools list ================= */
  function toolVisualHtml(tool) {
    var ic = String(tool.icon || "");
    if (ic.indexOf("emoji:") === 0) return "<span>" + escapeHtml(ic.slice(6)) + "</span>";
    if (ic.indexOf("img:") === 0) return '<img src="' + escapeAttr(ic.slice(4)) + '" alt="">';
    if (window.SWPL_ICONS && window.SWPL_ICONS[ic]) return icon(ic);
    return icon("app-window");
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeAttr(str) { return escapeHtml(str); }

  var dragIndex = -1;

  function renderToolList() {
    var list = document.getElementById("tool-list");
    if (!list) return;
    list.textContent = "";

    if (!draft.tools.length) {
      var empty = document.createElement("div");
      empty.className = "list-empty";
      empty.textContent = "No tools yet. Add the first one.";
      list.appendChild(empty);
      return;
    }

    draft.tools.forEach(function (tool, index) {
      var row = document.createElement("div");
      row.className = "tool-row" + (tool.hidden ? " is-hidden-tool" : "");
      row.draggable = true;
      row.dataset.index = String(index);

      row.innerHTML =
        '<span class="drag-handle" title="Drag to reorder">' + icon("rows") + "</span>" +
        '<span class="tool-row-icon">' + toolVisualHtml(tool) + "</span>" +
        '<span class="tool-row-main">' +
        '<span class="tool-row-name">' + escapeHtml(tool.name || tool.id) +
        (tool.kind === "embedded" ? '<span class="badge badge-live">embedded</span>' : "") +
        (tool.featured ? '<span class="badge">featured</span>' : "") +
        (tool.hidden ? '<span class="badge">hidden</span>' : "") +
        "</span>" +
        '<span class="tool-row-sub">' + escapeHtml(tool.tagline || tool.openUrl || tool.downloadUrl || "") + "</span>" +
        "</span>" +
        '<span class="tool-row-actions">' +
        '<button type="button" class="rowbtn" data-act="up" title="Move up">' + icon("caret-up") + "</button>" +
        '<button type="button" class="rowbtn" data-act="down" title="Move down">' + icon("caret-down") + "</button>" +
        '<button type="button" class="rowbtn" data-act="toggle" title="' + (tool.hidden ? "Show on site" : "Hide from site") + '" aria-pressed="' + String(!tool.hidden) + '">' + icon(tool.hidden ? "eye-slash" : "eye") + "</button>" +
        '<button type="button" class="rowbtn" data-act="dup" title="Duplicate">' + icon("copy") + "</button>" +
        '<button type="button" class="rowbtn" data-act="edit" title="Edit">' + icon("pencil-simple") + "</button>" +
        '<button type="button" class="rowbtn rowbtn-danger" data-act="del" title="Delete">' + icon("trash") + "</button>" +
        "</span>";

      row.addEventListener("dragstart", function (e) {
        dragIndex = index;
        row.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", String(index)); } catch (err) {}
      });
      row.addEventListener("dragend", function () {
        dragIndex = -1;
        list.querySelectorAll(".tool-row").forEach(function (r) {
          r.classList.remove("is-dragging", "is-drop-target");
        });
      });
      row.addEventListener("dragover", function (e) {
        if (dragIndex < 0 || dragIndex === index) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        row.classList.add("is-drop-target");
      });
      row.addEventListener("dragleave", function () { row.classList.remove("is-drop-target"); });
      row.addEventListener("drop", function (e) {
        e.preventDefault();
        row.classList.remove("is-drop-target");
        if (dragIndex < 0 || dragIndex === index) return;
        var moved = draft.tools.splice(dragIndex, 1)[0];
        draft.tools.splice(index, 0, moved);
        dragIndex = -1;
        renderToolList();
        commit();
      });

      row.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-act]");
        if (!btn) return;
        var act = btn.getAttribute("data-act");
        if (act === "edit") openToolEditor(index);
        else if (act === "up" && index > 0) {
          var t = draft.tools.splice(index, 1)[0];
          draft.tools.splice(index - 1, 0, t);
          renderToolList(); commit();
        } else if (act === "down" && index < draft.tools.length - 1) {
          var t2 = draft.tools.splice(index, 1)[0];
          draft.tools.splice(index + 1, 0, t2);
          renderToolList(); commit();
        } else if (act === "toggle") {
          tool.hidden = !tool.hidden;
          renderToolList(); commit();
        } else if (act === "dup") {
          var copy = clone(tool);
          copy.id = uniqueId(copy.id + "-copy");
          copy.name = tool.name + " copy";
          draft.tools.splice(index + 1, 0, copy);
          renderToolList(); commit();
        } else if (act === "del") {
          confirmDlg("Delete tool", 'Delete "' + (tool.name || tool.id) + '" from the registry? This only changes the draft until you publish.').then(function (ok) {
            if (!ok) return;
            draft.tools.splice(index, 1);
            renderToolList(); commit();
          });
        }
      });

      list.appendChild(row);
    });
  }

  function uniqueId(base) {
    var id = slugify(base);
    var n = 2;
    var ids = draft.tools.map(function (t) { return t.id; });
    while (ids.indexOf(id) !== -1) id = slugify(base) + "-" + n++;
    return id;
  }

  /* ================= Tool editor ================= */
  var editingIndex = -1;
  var editorIconValue = "app-window";
  var idTouched = false;

  function buildIconGrid() {
    var grid = document.getElementById("t-icon-grid");
    if (!grid || grid.childNodes.length) return;
    Object.keys(window.SWPL_ICONS || {}).sort().forEach(function (name) {
      var b = document.createElement("button");
      b.type = "button";
      b.title = name;
      b.dataset.iconName = name;
      b.innerHTML = icon(name);
      b.addEventListener("click", function () {
        editorIconValue = name;
        syncIconEditor();
      });
      grid.appendChild(b);
    });
  }

  function syncIconEditor() {
    var mode = document.getElementById("t-icon-mode").value;
    var emoji = document.getElementById("t-icon-emoji");
    var img = document.getElementById("t-icon-img");
    var grid = document.getElementById("t-icon-grid");
    var preview = document.getElementById("t-icon-preview");

    emoji.hidden = mode !== "emoji";
    img.hidden = mode !== "img";
    grid.hidden = mode !== "icon";

    var value = currentIconValue();
    if (value.indexOf("emoji:") === 0) preview.innerHTML = "<span>" + escapeHtml(value.slice(6)) + "</span>";
    else if (value.indexOf("img:") === 0 && value.length > 4) preview.innerHTML = '<img src="' + escapeAttr(value.slice(4)) + '" alt="">';
    else preview.innerHTML = icon(value) || icon("app-window");

    if (mode === "icon") {
      grid.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("is-active", b.dataset.iconName === editorIconValue);
      });
    }
  }

  function currentIconValue() {
    var mode = document.getElementById("t-icon-mode").value;
    if (mode === "emoji") {
      var e = document.getElementById("t-icon-emoji").value.trim();
      return e ? "emoji:" + e : "emoji:🧰";
    }
    if (mode === "img") {
      return "img:" + document.getElementById("t-icon-img").value.trim();
    }
    return editorIconValue;
  }

  function fillCategorySelect() {
    var sel = document.getElementById("t-category");
    sel.textContent = "";
    (draft.config.categories || []).forEach(function (cat) {
      var opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.name + " (" + cat.id + ")";
      sel.appendChild(opt);
    });
    var none = document.createElement("option");
    none.value = "";
    none.textContent = "No category";
    sel.appendChild(none);
  }

  function openToolEditor(index) {
    editingIndex = typeof index === "number" ? index : -1;
    var tool = editingIndex >= 0 ? draft.tools[editingIndex] : {
      id: "", name: "", tagline: "", description: "", icon: "app-window",
      category: (draft.config.categories[0] || {}).id || "", tags: [], platform: "web",
      version: "", kind: "embedded", openUrl: "", downloadUrl: "", repoUrl: "",
      featured: false, hidden: false
    };

    document.getElementById("tool-editor-title").textContent = editingIndex >= 0 ? "Edit tool" : "Add tool";
    document.getElementById("t-name").value = tool.name || "";
    document.getElementById("t-id").value = tool.id || "";
    document.getElementById("t-tagline").value = tool.tagline || "";
    document.getElementById("t-desc").value = tool.description || "";
    document.getElementById("t-version").value = tool.version || "";
    document.getElementById("t-open-url").value = tool.openUrl || "";
    document.getElementById("t-download-url").value = tool.downloadUrl || "";
    document.getElementById("t-repo-url").value = tool.repoUrl || "";
    document.getElementById("t-tags").value = (tool.tags || []).join(", ");
    document.getElementById("t-platform").value = tool.platform || "";
    document.getElementById("t-kind").value = tool.kind === "external" ? "external" : "embedded";
    document.getElementById("t-featured").checked = !!tool.featured;
    document.getElementById("t-hidden").checked = !!tool.hidden;
    document.getElementById("tool-editor-error").textContent = "";
    idTouched = editingIndex >= 0;

    fillCategorySelect();
    document.getElementById("t-category").value = tool.category || "";

    buildIconGrid();
    var ic = String(tool.icon || "app-window");
    var mode = ic.indexOf("emoji:") === 0 ? "emoji" : ic.indexOf("img:") === 0 ? "img" : "icon";
    document.getElementById("t-icon-mode").value = mode;
    document.getElementById("t-icon-emoji").value = mode === "emoji" ? ic.slice(6) : "";
    document.getElementById("t-icon-img").value = mode === "img" ? ic.slice(4) : "";
    editorIconValue = mode === "icon" ? ic : "app-window";
    syncIconEditor();

    document.getElementById("tool-editor").showModal();
    document.getElementById("t-name").focus();
  }

  function initToolEditor() {
    var dlg = document.getElementById("tool-editor");
    var form = document.getElementById("tool-editor-form");

    document.getElementById("tool-editor-close").innerHTML = icon("x");
    document.getElementById("tool-editor-close").addEventListener("click", function () { dlg.close(); });
    document.getElementById("tool-editor-cancel").addEventListener("click", function () { dlg.close(); });

    document.getElementById("t-icon-mode").addEventListener("change", syncIconEditor);
    document.getElementById("t-icon-emoji").addEventListener("input", syncIconEditor);
    document.getElementById("t-icon-img").addEventListener("input", syncIconEditor);

    document.getElementById("t-name").addEventListener("input", function () {
      if (!idTouched) document.getElementById("t-id").value = slugify(this.value);
    });
    document.getElementById("t-id").addEventListener("input", function () { idTouched = true; });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var error = document.getElementById("tool-editor-error");
      var name = document.getElementById("t-name").value.trim();
      var id = slugify(document.getElementById("t-id").value.trim());
      if (!name) { error.textContent = "Name is required."; error.className = "gh-status is-err"; return; }
      if (!id) { error.textContent = "Id is required."; error.className = "gh-status is-err"; return; }
      var clash = draft.tools.some(function (t, i) { return t.id === id && i !== editingIndex; });
      if (clash) { error.textContent = 'Id "' + id + '" is already used by another tool.'; error.className = "gh-status is-err"; return; }

      var tool = {
        id: id,
        name: name,
        tagline: document.getElementById("t-tagline").value.trim(),
        description: document.getElementById("t-desc").value.trim(),
        icon: currentIconValue(),
        category: document.getElementById("t-category").value,
        tags: document.getElementById("t-tags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean),
        platform: document.getElementById("t-platform").value,
        version: document.getElementById("t-version").value.trim(),
        kind: document.getElementById("t-kind").value,
        openUrl: document.getElementById("t-open-url").value.trim(),
        downloadUrl: document.getElementById("t-download-url").value.trim(),
        repoUrl: document.getElementById("t-repo-url").value.trim(),
        featured: document.getElementById("t-featured").checked,
        hidden: document.getElementById("t-hidden").checked
      };

      if (editingIndex >= 0) draft.tools[editingIndex] = tool;
      else draft.tools.push(tool);

      dlg.close();
      renderToolList();
      commit();
      toast(editingIndex >= 0 ? "Tool updated" : "Tool added");
    });
  }

  /* ================= Categories ================= */
  function renderCatList() {
    var list = document.getElementById("cat-list");
    if (!list) return;
    list.textContent = "";
    var cats = draft.config.categories || [];

    if (!cats.length) {
      var empty = document.createElement("div");
      empty.className = "list-empty";
      empty.textContent = "No categories. Tools will show without filters.";
      list.appendChild(empty);
      return;
    }

    cats.forEach(function (cat, index) {
      var row = document.createElement("div");
      row.className = "cat-row";

      var idInput = document.createElement("input");
      idInput.className = "cat-id";
      idInput.value = cat.id || "";
      idInput.placeholder = "id";
      idInput.title = "Category id (used by tools)";
      idInput.addEventListener("input", function () { cat.id = idInput.value.trim(); commit(); });

      var nameInput = document.createElement("input");
      nameInput.className = "cat-name";
      nameInput.value = cat.name || "";
      nameInput.placeholder = "Display name";
      nameInput.addEventListener("input", function () { cat.name = nameInput.value; commit(); });

      var iconInput = document.createElement("input");
      iconInput.className = "cat-icon";
      iconInput.value = cat.icon || "";
      iconInput.placeholder = "icon key";
      iconInput.title = "Icon key from the icon library (e.g. browser, desktop)";
      iconInput.setAttribute("list", "icon-keys");
      iconInput.addEventListener("input", function () { cat.icon = iconInput.value.trim(); commit(); });

      var up = document.createElement("button");
      up.type = "button"; up.className = "rowbtn"; up.title = "Move up"; up.innerHTML = icon("caret-up");
      up.addEventListener("click", function () {
        if (index === 0) return;
        cats.splice(index - 1, 0, cats.splice(index, 1)[0]);
        renderCatList(); commit();
      });
      var down = document.createElement("button");
      down.type = "button"; down.className = "rowbtn"; down.title = "Move down"; down.innerHTML = icon("caret-down");
      down.addEventListener("click", function () {
        if (index >= cats.length - 1) return;
        cats.splice(index + 1, 0, cats.splice(index, 1)[0]);
        renderCatList(); commit();
      });
      var del = document.createElement("button");
      del.type = "button"; del.className = "rowbtn rowbtn-danger"; del.title = "Delete"; del.innerHTML = icon("trash");
      del.addEventListener("click", function () {
        confirmDlg("Delete category", 'Delete "' + (cat.name || cat.id) + '"? Tools in it keep their category id and appear under "All".').then(function (ok) {
          if (!ok) return;
          cats.splice(index, 1);
          renderCatList(); commit();
        });
      });

      row.append(idInput, nameInput, iconInput, up, down, del);
      list.appendChild(row);
    });
  }

  function initCategories() {
    var datalist = document.createElement("datalist");
    datalist.id = "icon-keys";
    Object.keys(window.SWPL_ICONS || {}).sort().forEach(function (name) {
      var opt = document.createElement("option");
      opt.value = name;
      datalist.appendChild(opt);
    });
    document.body.appendChild(datalist);

    document.getElementById("btn-add-cat").addEventListener("click", function () {
      draft.config.categories.push({ id: "new-category", name: "New category", icon: "tag-simple" });
      renderCatList();
      commit();
    });
  }

  /* ================= GitHub publish ================= */
  function ghToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function ghHeaders() {
    return {
      "Authorization": "Bearer " + ghToken(),
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }

  function ghStatus(text, kind) {
    var node = document.getElementById("gh-status");
    node.textContent = text;
    node.className = "gh-status" + (kind ? " is-" + kind : "");
  }

  function ghRepoPath() {
    var g = draft.config.github || {};
    return {
      owner: (g.owner || "").trim(),
      repo: (g.repo || "").trim(),
      branch: (g.branch || "main").trim() || "main"
    };
  }

  async function ghPutFile(path, content, message) {
    var g = ghRepoPath();
    var base = "https://api.github.com/repos/" + g.owner + "/" + g.repo + "/contents/" + path;

    var sha = null;
    var getRes = await fetch(base + "?ref=" + encodeURIComponent(g.branch), { headers: ghHeaders() });
    if (getRes.ok) {
      var info = await getRes.json();
      sha = info && info.sha ? info.sha : null;
    } else if (getRes.status !== 404) {
      var errText = await getRes.text().catch(function () { return ""; });
      throw new Error("Read " + path + " failed: HTTP " + getRes.status + (errText ? " " + errText.slice(0, 140) : ""));
    }

    var body = { message: message, content: b64utf8(content), branch: g.branch };
    if (sha) body.sha = sha;

    var putRes = await fetch(base, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders()),
      body: JSON.stringify(body)
    });
    if (!putRes.ok) {
      var putErr = await putRes.json().catch(function () { return {}; });
      throw new Error("Write " + path + " failed: HTTP " + putRes.status + " " + (putErr.message || ""));
    }
    return putRes.json();
  }

  async function publishToGitHub() {
    var g = ghRepoPath();
    if (!g.owner || !g.repo) {
      ghStatus("Fill in owner and repository first.", "err");
      switchToPanel("github");
      return;
    }
    if (!ghToken()) {
      ghStatus("Add a personal access token first. It stays in this browser only.", "err");
      switchToPanel("github");
      return;
    }

    var message = (document.getElementById("f-gh-message").value || "Update ToolHub content").trim();
    var btns = [document.getElementById("btn-gh-publish"), document.getElementById("btn-publish-quick")];
    btns.forEach(function (b) { b.disabled = true; });
    ghStatus("Publishing…\nCommitting data/site-config.js", "busy");

    try {
      await ghPutFile("data/site-config.js", genConfigFile(draft.config), message);
      ghStatus("Publishing…\nCommitting data/tools.js", "busy");
      await ghPutFile("data/tools.js", genToolsFile(draft.tools), message);

      published = clone(draft);
      try { sessionStorage.setItem(SESSION_KEY, passHash()); } catch (e) {}
      updateStatus();
      ghStatus("Published. GitHub Pages usually redeploys in under a minute.", "ok");
      toast("Published to GitHub");
    } catch (err) {
      ghStatus(String(err.message || err), "err");
      switchToPanel("github");
    } finally {
      btns.forEach(function (b) { b.disabled = false; });
    }
  }

  function initGitHub() {
    var tokenInput = document.getElementById("f-gh-token");
    tokenInput.value = ghToken();
    tokenInput.addEventListener("input", function () {
      try { localStorage.setItem(TOKEN_KEY, tokenInput.value.trim()); } catch (e) {}
    });

    var eye = document.getElementById("gh-token-eye");
    eye.innerHTML = icon("eye");
    eye.addEventListener("click", function () {
      var show = tokenInput.type === "password";
      tokenInput.type = show ? "text" : "password";
      eye.innerHTML = icon(show ? "eye-slash" : "eye");
      eye.setAttribute("aria-pressed", String(show));
    });

    document.getElementById("btn-gh-test").addEventListener("click", async function () {
      var g = ghRepoPath();
      if (!g.owner || !g.repo) { ghStatus("Fill in owner and repository first.", "err"); return; }
      if (!ghToken()) { ghStatus("Add a token first.", "err"); return; }
      ghStatus("Checking " + g.owner + "/" + g.repo + "…", "busy");
      try {
        var res = await fetch("https://api.github.com/repos/" + g.owner + "/" + g.repo, { headers: ghHeaders() });
        if (!res.ok) {
          var err = await res.json().catch(function () { return {}; });
          throw new Error("HTTP " + res.status + " " + (err.message || ""));
        }
        var info = await res.json();
        var canPush = info.permissions && info.permissions.push;
        ghStatus(
          "Connected to " + info.full_name + " (default branch " + info.default_branch + ").\n" +
          (canPush ? "Token can push. Ready to publish." : "Warning: this token cannot push to the repo."),
          canPush ? "ok" : "err"
        );
      } catch (err) {
        ghStatus("Connection failed: " + (err.message || err), "err");
      }
    });

    document.getElementById("btn-gh-publish").addEventListener("click", publishToGitHub);
  }

  function switchToPanel(id) {
    var btn = document.querySelector('.nav-item[data-panel="' + id + '"]');
    if (btn) btn.click();
  }

  /* ================= Data panel ================= */
  function initData() {
    document.getElementById("btn-dl-config").addEventListener("click", function () {
      downloadFile("site-config.js", genConfigFile(draft.config));
    });
    document.getElementById("btn-dl-tools").addEventListener("click", function () {
      downloadFile("tools.js", genToolsFile(draft.tools));
    });
    document.getElementById("btn-dl-bundle").addEventListener("click", function () {
      downloadFile("swpl-toolhub-bundle.json", JSON.stringify({
        kind: "swpl-toolhub-bundle", version: 2, config: draft.config, tools: draft.tools
      }, null, 2), "application/json");
    });

    document.getElementById("btn-copy-config").addEventListener("click", function () {
      navigator.clipboard.writeText(genConfigFile(draft.config)).then(function () { toast("site-config.js copied"); });
    });
    document.getElementById("btn-copy-tools").addEventListener("click", function () {
      navigator.clipboard.writeText(genToolsFile(draft.tools)).then(function () { toast("tools.js copied"); });
    });

    var importInput = document.getElementById("import-file");
    document.getElementById("btn-import").addEventListener("click", function () { importInput.click(); });
    importInput.addEventListener("change", function () {
      var file = importInput.files[0];
      importInput.value = "";
      if (!file) return;
      file.text().then(function (text) {
        var parsed;
        try { parsed = JSON.parse(text); } catch (e) { toast("Not valid JSON"); return; }
        if (!parsed || (typeof parsed !== "object")) { toast("Not a ToolHub bundle"); return; }
        var cfg = parsed.config || (parsed.site ? parsed : null);
        var tools = Array.isArray(parsed.tools) ? parsed.tools : null;
        if (!cfg && !tools) { toast("Bundle has no config or tools"); return; }
        confirmDlg("Import bundle", "Replace the current draft with this bundle's content?").then(function (ok) {
          if (!ok) return;
          if (cfg) draft.config = S.deepMerge(S.DEFAULT_CONFIG, cfg);
          if (tools) draft.tools = tools;
          fullRefresh();
          commit();
          toast("Bundle imported into draft");
        });
      });
    });

    document.getElementById("btn-reset-draft").addEventListener("click", function () {
      confirmDlg("Reset draft", "Throw away all draft changes and go back to the published files?").then(function (ok) {
        if (!ok) return;
        draft = clone(published);
        fullRefresh();
        commit();
        reloadPreview();
        toast("Draft reset to published");
      });
    });
  }

  /* ================= Security panel ================= */
  function initSecurity() {
    var status = document.getElementById("pass-status");
    document.getElementById("btn-change-pass").addEventListener("click", function () {
      var current = document.getElementById("f-pass-current").value;
      var next = document.getElementById("f-pass-new").value;
      var next2 = document.getElementById("f-pass-new2").value;
      status.className = "gh-status is-err";
      if (!next || next.length < 4) { status.textContent = "New password needs at least 4 characters."; return; }
      if (next !== next2) { status.textContent = "New passwords do not match."; return; }
      hashPassword(current).then(function (curHash) {
        if (curHash !== passHash()) { status.textContent = "Current password is wrong."; return; }
        hashPassword(next).then(function (newHash) {
          if (!draft.config.security) draft.config.security = {};
          draft.config.security.passHash = newHash;
          try { sessionStorage.setItem(SESSION_KEY, newHash); } catch (e) {}
          commit();
          status.className = "gh-status is-ok";
          status.textContent = "Password updated in the draft. Publish or export for it to reach the live site.";
          document.getElementById("f-pass-current").value = "";
          document.getElementById("f-pass-new").value = "";
          document.getElementById("f-pass-new2").value = "";
        });
      });
    });
  }

  /* ================= Preview pane ================= */
  function reloadPreview() {
    if (!previewFrame) return;
    try { previewFrame.contentWindow.location.reload(); } catch (e) { previewFrame.src = previewFrame.src; }
  }

  function initPreview() {
    previewFrame = document.getElementById("preview-frame");
    var wrap = document.getElementById("preview-wrap");
    var desktop = document.getElementById("pv-desktop");
    var mobile = document.getElementById("pv-mobile");

    desktop.addEventListener("click", function () {
      wrap.classList.remove("is-mobile");
      desktop.classList.add("is-active");
      mobile.classList.remove("is-active");
    });
    mobile.addEventListener("click", function () {
      wrap.classList.add("is-mobile");
      mobile.classList.add("is-active");
      desktop.classList.remove("is-active");
    });

    var open = document.getElementById("pv-open");
    open.innerHTML = icon("arrow-square-out");
    open.addEventListener("click", function () { window.open("index.html?draft=1", "_blank"); });

    var reload = document.getElementById("pv-reload");
    reload.innerHTML = icon("arrows-clockwise");
    reload.addEventListener("click", reloadPreview);
  }

  /* ================= Topbar ================= */
  function initTopbar() {
    document.getElementById("btn-lock").innerHTML = icon("lock-simple");
    document.getElementById("btn-lock").addEventListener("click", function () {
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
      location.reload();
    });

    document.getElementById("btn-discard").addEventListener("click", function () {
      document.getElementById("btn-reset-draft").click();
    });

    document.getElementById("btn-export-quick").addEventListener("click", function () {
      downloadFile("site-config.js", genConfigFile(draft.config));
      setTimeout(function () { downloadFile("tools.js", genToolsFile(draft.tools)); }, 350);
      toast("Both data files downloaded");
    });

    document.getElementById("btn-publish-quick").addEventListener("click", publishToGitHub);
  }

  /* ================= Boot ================= */
  function fullRefresh() {
    refreshBindings();
    renderToolList();
    renderCatList();
    applyAdminStyle(draft.config);
    var tokenInput = document.getElementById("f-gh-token");
    if (tokenInput) tokenInput.value = ghToken();
  }

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;

    initNav();
    initBindings();
    renderAccentRow();
    initAccentCustom();
    renderToolList();
    initToolEditor();
    renderCatList();
    initCategories();
    initGitHub();
    initData();
    initSecurity();
    initPreview();
    initTopbar();

    document.getElementById("btn-add-tool").addEventListener("click", function () { openToolEditor(null); });

    applyAdminStyle(draft.config);
    updateStatus();
    commit();

    window.addEventListener("beforeunload", function () {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
    });
  }

  document.addEventListener("DOMContentLoaded", initGate);
})();
