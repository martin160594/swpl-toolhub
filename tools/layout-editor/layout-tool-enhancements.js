/* ============================================================
   Layout Tool — Enhancements layer (Pro Max patch)
   Loads AFTER assets/script.js. The host script appends a public
   shim that exposes its `let` bindings as live getters/setters on
   `window` and turns key function bindings into replaceable slots.
   We rely on those getters here.

   Owns:
     - Global undo/redo for canvas state (independent of folder)
     - Keyboard shortcuts layer
     - beforeunload guard for unsaved changes
     - changeMode confirmation when dirty
     - Layout-shrink out-of-bounds detection
     - Show/Hide XML toggle label sync
     - Cart "Clear All" button
     - Canvas search with highlight
     - Multi-select (Shift/Ctrl-click) bulk operations
     - Duplicate-item action in context menu
     - ARIA dialog roles applied to all modals
   ============================================================ */

(function () {
  "use strict";

  // ---------- Utility helpers ----------------------------------
  function safeClone(value) {
    if (value === undefined || value === null) return value;
    try {
      if (typeof window.cloneData === "function") return window.cloneData(value);
    } catch (_) { /* fall through */ }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  }

  function notify(message, type = "info") {
    if (typeof window.showToast === "function") {
      window.showToast(message, type === "info" ? "success" : type);
    } else {
      console.log(`[layout-tool] ${message}`);
    }
  }

  function isModalOpen() {
    return Array.from(document.querySelectorAll(".modal")).some((el) => {
      const display = el.style.display || getComputedStyle(el).display;
      return display && display !== "none";
    });
  }

  function isEditingTextField(target) {
    if (!target) return false;
    const tag = (target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (target.isContentEditable) return true;
    return false;
  }

  // ============================================================
  // 1. Global undo/redo for canvas state
  // ============================================================
  const HISTORY_LIMIT = 60;
  const canvasHistory = { undo: [], redo: [] };
  let originalSetUnsavedChanges = null;
  let suppressHistoryDepth = 0;

  function captureCanvasSnapshot(label) {
    return {
      label: label || "",
      mode: window.currentMode,
      layout: window.currentLayout,
      page: window.currentPage,
      virtualBuffer: safeClone(window.virtualBuffer),
      virtualWorkspaceBuffer: safeClone(window.virtualWorkspaceBuffer),
      cartItems: safeClone(window.cartItems || []),
      customGridLayout: safeClone(window.customGridLayout),
      unsavedChanges: Boolean(window.unsavedChanges),
    };
  }

  function restoreCanvasSnapshot(snapshot) {
    if (!snapshot) return;

    suppressHistoryDepth++;
    try {
      if (snapshot.mode && snapshot.mode !== window.currentMode) {
        window.currentMode = snapshot.mode;
        const ms = document.getElementById("mode-select");
        if (ms) ms.value = snapshot.mode;
      }
      if (snapshot.layout && snapshot.layout !== window.currentLayout) {
        window.currentLayout = snapshot.layout;
        const ls = document.getElementById("layout-select");
        if (ls) ls.value = snapshot.layout;
        if (typeof window.syncLayoutClasses === "function") window.syncLayoutClasses();
        if (typeof window.syncCustomGridPanelVisibility === "function") {
          window.syncCustomGridPanelVisibility();
        }
      }

      window.virtualBuffer = safeClone(snapshot.virtualBuffer);
      window.virtualWorkspaceBuffer = safeClone(snapshot.virtualWorkspaceBuffer);
      window.cartItems = safeClone(snapshot.cartItems || []);
      window.customGridLayout = safeClone(snapshot.customGridLayout);
      window.currentPage = Number(snapshot.page) || 0;

      if (typeof window.syncCartSerialFromEntries === "function") {
        window.syncCartSerialFromEntries(window.cartItems);
      }
      if (typeof window.setUnsavedChanges === "function") {
        // Use the original (pre-patch) setter so this restoration does not
        // produce yet another snapshot.
        (originalSetUnsavedChanges || window.setUnsavedChanges)(
          Boolean(snapshot.unsavedChanges),
        );
      }

      if (typeof window.updateUI === "function") window.updateUI();
      if (typeof window.refreshXMLViewer === "function") window.refreshXMLViewer();
      if (typeof window.renderCartPanel === "function") window.renderCartPanel();
      if (typeof window.schedulePersistCurrentSession === "function") {
        window.schedulePersistCurrentSession();
      }
    } finally {
      suppressHistoryDepth--;
    }
    syncHistoryButtons();
  }

  function undoCanvas() {
    if (!canvasHistory.undo.length) {
      notify("Nothing to undo", "info");
      return;
    }
    const previous = canvasHistory.undo.pop();
    canvasHistory.redo.push(captureCanvasSnapshot("redo-anchor"));
    restoreCanvasSnapshot(previous);
    notify("Undid last change", "success");
  }

  function redoCanvas() {
    if (!canvasHistory.redo.length) {
      notify("Nothing to redo", "info");
      return;
    }
    const next = canvasHistory.redo.pop();
    canvasHistory.undo.push(captureCanvasSnapshot("undo-anchor"));
    restoreCanvasSnapshot(next);
    notify("Redid last change", "success");
  }

  function resetCanvasHistory() {
    canvasHistory.undo.length = 0;
    canvasHistory.redo.length = 0;
    syncHistoryButtons();
  }

  function syncHistoryButtons() {
    const undoBtn = document.getElementById("canvas-undo-btn");
    const redoBtn = document.getElementById("canvas-redo-btn");
    if (undoBtn) undoBtn.disabled = canvasHistory.undo.length === 0;
    if (redoBtn) redoBtn.disabled = canvasHistory.redo.length === 0;
  }

  // Wrap setUnsavedChanges so every dirty mutation captures a pre-state.
  // Strategy: capture the CLEAN snapshot on the rising edge (clean -> dirty).
  // Subsequent dirty -> dirty calls do not snapshot again until a save/reset
  // clears the flag. This matches how Save commits a batch of edits as a
  // single undo step.
  function installSetUnsavedChangesHook() {
    if (typeof window.setUnsavedChanges !== "function") return;
    if (originalSetUnsavedChanges) return;

    originalSetUnsavedChanges = window.setUnsavedChanges;
    window.setUnsavedChanges = function patchedSetUnsavedChanges(isDirty) {
      const wasDirty = Boolean(window.unsavedChanges);
      const becomingDirty = Boolean(isDirty) && !wasDirty;
      if (becomingDirty && suppressHistoryDepth === 0) {
        canvasHistory.undo.push(captureCanvasSnapshot("auto"));
        if (canvasHistory.undo.length > HISTORY_LIMIT) {
          canvasHistory.undo.shift();
        }
        canvasHistory.redo.length = 0;
      }
      originalSetUnsavedChanges(isDirty);
      syncHistoryButtons();
    };
  }

  // Intercept saveChanges & resetLayout to keep the history coherent.
  function wrapSaveAndReset() {
    if (typeof window.saveChanges === "function") {
      const origSave = window.saveChanges;
      window.saveChanges = function patchedSaveChanges() {
        const result = origSave.apply(this, arguments);
        canvasHistory.redo.length = 0;
        syncHistoryButtons();
        return result;
      };
    }
    if (typeof window.resetLayout === "function") {
      const origReset = window.resetLayout;
      window.resetLayout = function patchedResetLayout() {
        if (window.unsavedChanges) {
          canvasHistory.undo.push(captureCanvasSnapshot("pre-reset"));
          if (canvasHistory.undo.length > HISTORY_LIMIT) {
            canvasHistory.undo.shift();
          }
          canvasHistory.redo.length = 0;
        }
        const result = origReset.apply(this, arguments);
        syncHistoryButtons();
        return result;
      };
    }
  }

  // ============================================================
  // 2. beforeunload guard when there are unsaved changes
  // ============================================================
  function installUnloadGuard() {
    window.addEventListener("beforeunload", function (event) {
      const dirty =
        Boolean(window.unsavedChanges) || Boolean(window.xmlEditorDirty);
      if (!dirty) return;
      event.preventDefault();
      event.returnValue =
        "You have unsaved layout changes. Reload anyway?";
      return event.returnValue;
    });
  }

  // ============================================================
  // 3. changeMode confirmation when dirty
  // ============================================================
  function installModeChangeGuard() {
    const modeSelect = document.getElementById("mode-select");
    if (!modeSelect) return;

    let lastConfirmedMode = modeSelect.value;
    modeSelect.addEventListener(
      "change",
      function (event) {
        const next = modeSelect.value;
        const dirty =
          Boolean(window.unsavedChanges) || Boolean(window.xmlEditorDirty);
        if (next === lastConfirmedMode) return;

        if (dirty) {
          const ok = window.confirm(
            "You have unsaved changes in the current mode.\n\n" +
              "Switch mode anyway? Unsaved edits will be reverted to the last saved state.",
          );
          if (!ok) {
            event.stopImmediatePropagation();
            event.preventDefault();
            modeSelect.value = lastConfirmedMode;
            return;
          }
        }

        lastConfirmedMode = next;
        // Switching mode invalidates undo history (different buffer scope).
        resetCanvasHistory();
      },
      true,
    );
  }

  // ============================================================
  // 4. Layout shrink: detect items outside new grid bounds
  // ============================================================
  function installLayoutShrinkGuard() {
    const layoutSelect = document.getElementById("layout-select");
    if (!layoutSelect) return;

    let lastConfirmedLayout = layoutSelect.value;
    layoutSelect.addEventListener(
      "change",
      function (event) {
        const next = layoutSelect.value;
        if (next === lastConfirmedLayout) return;

        const overflowing = countItemsOutsideLayout(next);
        if (overflowing > 0) {
          const ok = window.confirm(
            `Switching to "${next}" will move ${overflowing} item(s) ` +
              `that no longer fit. They will be sent to the Cart.\n\nContinue?`,
          );
          if (!ok) {
            event.stopImmediatePropagation();
            event.preventDefault();
            layoutSelect.value = lastConfirmedLayout;
            return;
          }
          setTimeout(() => parkOverflowingItemsToCart(next), 0);
        }
        lastConfirmedLayout = next;
      },
      true,
    );

    const applyBtn = document.getElementById("apply-custom-grid");
    if (applyBtn) {
      applyBtn.addEventListener("click", function () {
        setTimeout(() => {
          const overflow = countItemsOutsideLayout("custom");
          if (overflow > 0) {
            notify(
              `${overflow} item(s) are outside the new custom grid; sending to Cart.`,
              "warning",
            );
            parkOverflowingItemsToCart(window.currentLayout);
          }
        }, 50);
      });
    }
  }

  function getGridDimsForLayoutKey(key) {
    const presetMap = {
      mobile: { cols: 4, rows: 6 },
      "tablet-8x6": { cols: 8, rows: 6 },
      "fold-6x6": { cols: 6, rows: 6 },
      "tablet-6x8": { cols: 6, rows: 8 },
      "tablet-6x10": { cols: 6, rows: 10 },
    };
    if (key === "custom") {
      const cgl = window.customGridLayout || {};
      const c = Number(cgl.cols) || 4;
      const r = Number(cgl.homeRows) || 6;
      return { cols: c, rows: r };
    }
    return presetMap[key] || presetMap.mobile;
  }

  function countItemsOutsideLayout(layoutKey) {
    if (window.currentMode !== "default-workspace") return 0;
    const { cols, rows } = getGridDimsForLayoutKey(layoutKey);
    const buf = window.virtualWorkspaceBuffer;
    const items = Array.isArray(buf?.home) ? buf.home : [];
    let count = 0;
    items.forEach((item) => {
      if (!item) return;
      const x = Number(item.x) || 0;
      const y = Number(item.y) || 0;
      const sx = Number(item.spanX) || 1;
      const sy = Number(item.spanY) || 1;
      if (x + sx > cols || y + sy > rows) count++;
    });
    return count;
  }

  function parkOverflowingItemsToCart(layoutKey) {
    if (window.currentMode !== "default-workspace") return;
    const { cols, rows } = getGridDimsForLayoutKey(layoutKey);
    const buf = window.virtualWorkspaceBuffer;
    const home = Array.isArray(buf?.home) ? buf.home : null;
    if (!home) return;

    const moved = [];
    for (let i = home.length - 1; i >= 0; i--) {
      const it = home[i];
      if (!it) continue;
      const x = Number(it.x) || 0;
      const y = Number(it.y) || 0;
      const sx = Number(it.spanX) || 1;
      const sy = Number(it.spanY) || 1;
      if (x + sx > cols || y + sy > rows) {
        moved.push(it);
        home.splice(i, 1);
      }
    }
    if (!moved.length) return;

    let cart = window.cartItems;
    if (!Array.isArray(cart)) {
      cart = [];
      window.cartItems = cart;
    }
    moved.forEach((it) => {
      const id = `cart-overflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      cart.push({
        id,
        mode: "default-workspace",
        type: it.type === "appwidget" ? "widget" : it.type || "app",
        payload: safeClone(it),
        addedAt: new Date().toISOString(),
      });
    });

    if (typeof window.syncCartSerialFromEntries === "function") {
      window.syncCartSerialFromEntries(cart);
    }
    if (typeof window.setUnsavedChanges === "function") {
      window.setUnsavedChanges(true);
    }
    if (typeof window.renderCartPanel === "function") window.renderCartPanel();
    if (typeof window.updateUI === "function") window.updateUI();
    notify(`Moved ${moved.length} out-of-bounds item(s) to Cart`, "success");
  }

  // ============================================================
  // 5. Toggle XML button label sync
  // ============================================================
  function installToggleXmlLabelSync() {
    const button = document.getElementById("toggle-xml-btn");
    const panel = document.getElementById("xml-panel");
    if (!button || !panel) return;

    const updateLabel = () => {
      const visible = panel.style.display && panel.style.display !== "none";
      button.textContent = visible ? "Hide XML" : "Show XML";
      button.setAttribute("aria-pressed", visible ? "true" : "false");
      button.setAttribute(
        "aria-label",
        visible ? "Hide XML editor panel" : "Show XML editor panel",
      );
    };

    const observer = new MutationObserver(updateLabel);
    observer.observe(panel, { attributes: true, attributeFilter: ["style"] });
    updateLabel();
  }

  // ============================================================
  // 6. Cart "Clear All"
  // ============================================================
  function installCartBulkActions() {
    const cartPanel = document.getElementById("cart-panel");
    if (!cartPanel) return;

    const heading = cartPanel.querySelector(".tool-section-heading");
    if (!heading) return;
    if (heading.querySelector(".cart-clear-btn")) return;

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.id = "cart-clear-btn";
    clearBtn.className = "cart-clear-btn";
    clearBtn.textContent = "Clear";
    clearBtn.title = "Remove every item from the Cart";
    clearBtn.addEventListener("click", () => {
      const cart = window.cartItems || [];
      if (!cart.length) {
        notify("Cart is already empty", "info");
        return;
      }
      const ok = window.confirm(
        `Clear all ${cart.length} item(s) from the Cart?\n\n` +
          "Tip: you can undo with Ctrl+Z.",
      );
      if (!ok) return;
      if (typeof window.setUnsavedChanges === "function") {
        window.setUnsavedChanges(true);
      }
      window.cartItems = [];
      if (typeof window.renderCartPanel === "function") window.renderCartPanel();
      if (typeof window.schedulePersistCurrentSession === "function") {
        window.schedulePersistCurrentSession();
      }
      notify("Cart cleared", "success");
    });

    heading.appendChild(clearBtn);

    const cartItemsContainer = document.getElementById("cart-items");
    const sync = () => {
      const cart = window.cartItems;
      const empty = !Array.isArray(cart) || cart.length === 0;
      clearBtn.disabled = empty;
    };
    sync();
    if (cartItemsContainer) {
      const obs = new MutationObserver(sync);
      obs.observe(cartItemsContainer, { childList: true });
    }
  }

  // ============================================================
  // 7. Canvas search box
  // ============================================================
  function installCanvasSearch() {
    const cartPanel = document.getElementById("cart-panel");
    if (!cartPanel) return;

    const layoutControls = document.querySelector(".layout-controls");
    if (!layoutControls) return;
    if (document.getElementById("canvas-search-section")) return;

    const section = document.createElement("div");
    section.id = "canvas-search-section";
    section.className = "tool-section";
    section.innerHTML = `
      <p class="tool-section-label">Search</p>
      <div class="canvas-search-wrapper">
        <input
          type="search"
          id="canvas-search-input"
          class="canvas-search-input"
          placeholder="Find by name, package, comment"
          autocomplete="off"
          aria-label="Search items on canvas"
        />
        <button
          type="button"
          id="canvas-search-clear"
          class="canvas-search-clear"
          aria-label="Clear search"
        >&times;</button>
      </div>
    `;

    layoutControls.insertBefore(section, cartPanel);

    const input = section.querySelector("#canvas-search-input");
    const clearBtn = section.querySelector("#canvas-search-clear");
    let debounceHandle = 0;

    input.addEventListener("input", () => {
      clearBtn.classList.toggle("is-visible", Boolean(input.value));
      window.clearTimeout(debounceHandle);
      debounceHandle = window.setTimeout(() => {
        applyCanvasSearch(input.value);
      }, 120);
    });

    clearBtn.addEventListener("click", () => {
      input.value = "";
      clearBtn.classList.remove("is-visible");
      applyCanvasSearch("");
      input.focus();
    });

    // Wrap updateUI so the highlight is re-applied after each render.
    if (typeof window.updateUI === "function") {
      const origUpdateUI = window.updateUI;
      window.updateUI = function patchedUpdateUI() {
        const result = origUpdateUI.apply(this, arguments);
        if (input.value) {
          requestAnimationFrame(() => applyCanvasSearch(input.value));
        }
        // Re-apply multi-select visual classes after DOM rebuild.
        if (selectedSet.size > 0) {
          requestAnimationFrame(() => reapplySelectionClasses());
        }
        return result;
      };
    }

    window.__layoutToolFocusSearch = () => input.focus();
  }

  function applyCanvasSearch(query) {
    const grid = document.getElementById("app-grid");
    if (!grid) return;
    const term = String(query || "").trim().toLowerCase();
    const items = grid.querySelectorAll(".app-item");

    if (!term) {
      items.forEach((el) => {
        el.classList.remove("canvas-search-match", "canvas-search-dimmed");
      });
      return;
    }

    items.forEach((el) => {
      const text = (el.textContent || "").toLowerCase();
      const pkg = (el.dataset?.packageName || "").toLowerCase();
      const cls = (el.dataset?.className || "").toLowerCase();
      const title = (el.dataset?.title || "").toLowerCase();
      const matches =
        text.includes(term) ||
        pkg.includes(term) ||
        cls.includes(term) ||
        title.includes(term);
      el.classList.toggle("canvas-search-match", matches);
      el.classList.toggle("canvas-search-dimmed", !matches);
    });
  }

  // ============================================================
  // 8. Multi-select on canvas (Shift/Ctrl click)
  //
  // Design: we NEVER stopPropagation or preventDefault so that
  // the host's drag-drop, double-click, and context-menu logic
  // continues to work normally. We simply toggle a visual class
  // on Shift/Ctrl-click. Bulk actions read from `selectedSet`.
  // Selection is cleared on: plain click, page change, mode
  // change, drag start, or Esc key.
  // ============================================================
  const selectedSet = new Set();
  let multiSelectEnabled = true;

  function installMultiSelect() {
    const grid = document.getElementById("app-grid");
    if (!grid) return;

    // Use non-capturing click listener — runs AFTER host handlers.
    grid.addEventListener("click", function (event) {
      if (!multiSelectEnabled) return;

      const isModified = event.shiftKey || event.ctrlKey || event.metaKey;

      if (!isModified) {
        // Plain click: clear selection silently (don't interfere with host).
        if (selectedSet.size > 0) {
          clearMultiSelection();
        }
        return;
      }

      const item = event.target.closest("#app-grid > .app-item, #app-grid .app-item");
      if (!item) return;

      // Don't select if user clicked a remove button or other control inside item.
      if (event.target.closest("button, .folder-item-remove")) return;

      const id = computeItemSelectionId(item);
      if (!id) return;

      if (selectedSet.has(id)) {
        selectedSet.delete(id);
        item.classList.remove("is-selected");
      } else {
        selectedSet.add(id);
        item.classList.add("is-selected");
      }
      syncMultiSelectBar();
      // NOTE: we do NOT call stopPropagation or preventDefault here.
      // The host's dblclick/drag handlers will still fire normally.
    });

    // Clear selection when a drag starts (user is moving an item, not selecting).
    grid.addEventListener("dragstart", function () {
      if (selectedSet.size > 0) {
        clearMultiSelection();
      }
    });

    // Clear selection on mode change.
    const modeSelect = document.getElementById("mode-select");
    if (modeSelect) {
      modeSelect.addEventListener("change", () => {
        if (selectedSet.size > 0) clearMultiSelection();
      });
    }
  }

  function computeItemSelectionId(domNode) {
    // Build a unique ID from whatever data attributes are available.
    // Folders may not have packageName/className, so we also use
    // textContent and DOM index as fallback.
    const pkg = domNode.dataset?.packageName || "";
    const cls = domNode.dataset?.className || "";
    const title = domNode.dataset?.title || "";
    const screen = domNode.dataset?.screen || "";
    const text = (domNode.textContent || "").trim().slice(0, 50);

    // If we have meaningful data attributes, use them.
    if (pkg || cls || title) {
      return `${title}::${pkg}::${cls}::${screen}`;
    }

    // Fallback: use text content + DOM index within the grid.
    const grid = document.getElementById("app-grid");
    if (grid) {
      const siblings = Array.from(grid.querySelectorAll(".app-item"));
      const index = siblings.indexOf(domNode);
      return `__idx_${index}::${text}::${screen}`;
    }

    return `__text::${text}::${screen}`;
  }

  function clearMultiSelection() {
    selectedSet.clear();
    document
      .querySelectorAll("#app-grid .app-item.is-selected")
      .forEach((el) => el.classList.remove("is-selected"));
    syncMultiSelectBar();
  }

  /** After a DOM rebuild (updateUI), re-apply .is-selected to matching nodes. */
  function reapplySelectionClasses() {
    if (selectedSet.size === 0) return;
    const grid = document.getElementById("app-grid");
    if (!grid) return;
    grid.querySelectorAll(".app-item").forEach((el) => {
      const id = computeItemSelectionId(el);
      if (id && selectedSet.has(id)) {
        el.classList.add("is-selected");
      }
    });
  }

  function syncMultiSelectBar() {
    let bar = document.getElementById("canvas-multiselect-bar");
    const grid = document.getElementById("app-grid");
    const stage = grid?.closest(".workspace-shell");
    if (!stage) return;

    if (selectedSet.size === 0) {
      if (bar) bar.hidden = true;
      return;
    }

    if (!bar) {
      bar = document.createElement("div");
      bar.id = "canvas-multiselect-bar";
      bar.className = "canvas-multiselect-bar";
      bar.innerHTML = `
        <span class="canvas-multiselect-label"><strong id="canvas-multiselect-count">0</strong> item(s) selected</span>
        <div class="canvas-multiselect-actions">
          <button type="button" id="canvas-multiselect-cart">Send to Cart</button>
          <button type="button" id="canvas-multiselect-clear">Clear</button>
        </div>
      `;
      stage.parentNode.insertBefore(bar, stage);
      bar.querySelector("#canvas-multiselect-cart").addEventListener("click", sendSelectionToCart);
      bar.querySelector("#canvas-multiselect-clear").addEventListener("click", clearMultiSelection);
    }
    bar.hidden = false;
    const counter = bar.querySelector("#canvas-multiselect-count");
    if (counter) counter.textContent = String(selectedSet.size);
  }

  function sendSelectionToCart() {
    if (typeof window.sendItemToCart !== "function") {
      notify("Bulk cart send not supported in this build", "error");
      return;
    }
    // Collect currently-selected DOM nodes (they may have been re-rendered).
    const nodes = document.querySelectorAll("#app-grid .app-item.is-selected");
    if (!nodes.length) {
      notify("No items selected", "info");
      clearMultiSelection();
      return;
    }
    let okCount = 0;
    let failCount = 0;
    // Process in reverse order so index-based removals don't shift.
    const nodeArray = Array.from(nodes).reverse();
    nodeArray.forEach((el) => {
      try {
        window.sendItemToCart(el);
        okCount++;
      } catch (err) {
        failCount++;
      }
    });
    if (okCount > 0) notify(`Sent ${okCount} item(s) to Cart`, "success");
    if (failCount > 0) notify(`${failCount} item(s) could not be sent`, "error");
    clearMultiSelection();
  }

  // ============================================================
  // 9. Duplicate-item action in context menu
  // ============================================================
  function installDuplicateAction() {
    const menu = document.getElementById("context-menu");
    if (!menu) return;
    if (menu.querySelector('[data-action="duplicate"]')) return;

    const editItem = menu.querySelector('[data-action="edit"]');
    const dup = document.createElement("div");
    dup.className = "context-menu-item context-menu-item-duplicate";
    dup.dataset.action = "duplicate";
    dup.textContent = "Duplicate Item";
    if (editItem && editItem.nextSibling) {
      menu.insertBefore(dup, editItem.nextSibling);
    } else {
      menu.appendChild(dup);
    }

    menu.addEventListener("click", function (event) {
      const target = event.target.closest('[data-action="duplicate"]');
      if (!target) return;
      if (target.classList.contains("disabled")) return;
      const node = window.selectedItem;
      if (!node) return;
      try {
        duplicateSelectedItem(node);
      } catch (error) {
        notify(error.message || String(error), "error");
      }
      if (typeof window.hideContextMenu === "function") window.hideContextMenu();
    });

    const observer = new MutationObserver(() => {
      const visible = menu.style.display === "block";
      if (!visible) return;
      const meta = window.selectedItem?.contextMeta || null;
      const canDup = Boolean(
        meta?.canCart ||
          meta?.canEdit ||
          meta?.itemType === "app" ||
          meta?.itemType === "appwidget",
      );
      dup.classList.toggle("disabled", !canDup);
    });
    observer.observe(menu, { attributes: true, attributeFilter: ["style"] });
  }

  function duplicateSelectedItem(node) {
    let cart = window.cartItems;
    if (!Array.isArray(cart)) {
      cart = [];
      window.cartItems = cart;
    }

    if (window.currentMode === "default-workspace") {
      const titleAttr = node.dataset?.title || "";
      const pkg = node.dataset?.packageName || "";
      const cls = node.dataset?.className || "";
      const buf = window.virtualWorkspaceBuffer;
      const home = Array.isArray(buf?.home) ? buf.home : [];
      const source = home.find(
        (it) =>
          it &&
          (it.packageName || "") === pkg &&
          (it.className || "") === cls &&
          (it.title || "") === titleAttr,
      );
      if (!source) {
        throw new Error("Could not find source item in workspace buffer");
      }
      const payload = safeClone(source);
      cart.push({
        id: `cart-dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        mode: "default-workspace",
        type: payload.type === "appwidget" ? "widget" : payload.type || "app",
        payload,
        addedAt: new Date().toISOString(),
      });
    } else {
      const pkg = node.dataset?.packageName || "";
      const cls = node.dataset?.className || "";
      if (!pkg && !cls) {
        throw new Error("Cannot duplicate this item type");
      }
      cart.push({
        id: `cart-dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        mode: "application-order",
        type: "app",
        payload: {
          type: "app",
          packageName: pkg,
          className: cls,
          title: node.dataset?.title || "",
          comment: node.dataset?.comment || "",
        },
        addedAt: new Date().toISOString(),
      });
    }

    if (typeof window.syncCartSerialFromEntries === "function") {
      window.syncCartSerialFromEntries(cart);
    }
    if (typeof window.setUnsavedChanges === "function") {
      window.setUnsavedChanges(true);
    }
    if (typeof window.renderCartPanel === "function") window.renderCartPanel();
    if (typeof window.schedulePersistCurrentSession === "function") {
      window.schedulePersistCurrentSession();
    }
    notify("Duplicated item to Cart. Drag it to the desired slot.", "success");
  }

  // ============================================================
  // 10. ARIA dialog roles for all modals
  // ============================================================
  function installModalAriaRoles() {
    document.querySelectorAll(".modal").forEach((modal) => {
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      const heading = modal.querySelector("h2, h3");
      if (heading) {
        if (!heading.id) heading.id = `${modal.id || "modal"}-title`;
        modal.setAttribute("aria-labelledby", heading.id);
      }
    });
  }

  // ============================================================
  // 11. Keyboard shortcuts layer
  // ============================================================
  function installKeyboardShortcuts() {
    document.addEventListener("keydown", function (event) {
      const inField = isEditingTextField(event.target);
      const cmd = event.ctrlKey || event.metaKey;

      if (event.key === "Escape") {
        if (selectedSet.size > 0 && !isModalOpen()) {
          clearMultiSelection();
          event.preventDefault();
          return;
        }
      }

      if (cmd && !event.shiftKey && !event.altKey) {
        const k = String(event.key).toLowerCase();

        if (k === "s") {
          if (event.target && event.target.id === "xml-content") return;
          event.preventDefault();
          if (!inField && typeof window.saveChanges === "function") {
            window.saveChanges();
          }
          return;
        }

        if (k === "z" && !event.shiftKey) {
          if (inField) return;
          event.preventDefault();
          undoCanvas();
          return;
        }

        if (k === "y") {
          if (inField) return;
          event.preventDefault();
          redoCanvas();
          return;
        }

        if (k === "f") {
          if (typeof window.__layoutToolFocusSearch === "function") {
            event.preventDefault();
            window.__layoutToolFocusSearch();
            return;
          }
        }
      }

      if (cmd && event.shiftKey && String(event.key).toLowerCase() === "s") {
        if (inField) return;
        event.preventDefault();
        if (typeof window.exportXML === "function") window.exportXML();
        return;
      }

      if (cmd && event.shiftKey && String(event.key).toLowerCase() === "z") {
        if (inField) return;
        event.preventDefault();
        redoCanvas();
        return;
      }

      if (
        !cmd &&
        !event.shiftKey &&
        !event.altKey &&
        !inField &&
        !isModalOpen() &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        const btnId = event.key === "ArrowLeft" ? "prev-page-btn" : "next-page-btn";
        const button = document.getElementById(btnId);
        if (button && !button.disabled) {
          event.preventDefault();
          button.click();
        }
      }
    });
  }

  // ============================================================
  // 12. Focus trap for modals
  // ============================================================
  function installFocusTrap() {
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Tab") return;
      const openModal = Array.from(document.querySelectorAll(".modal")).find((el) => {
        const d = el.style.display || getComputedStyle(el).display;
        return d && d !== "none";
      });
      if (!openModal) return;

      const content = openModal.querySelector(".modal-content");
      if (!content) return;

      const focusable = content.querySelectorAll(
        'button:not([disabled]):not([hidden]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first || !content.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !content.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  }

  // ============================================================
  // 13. Compare XML: Swap A ↔ B
  // ============================================================
  function installCompareSwap() {
    const swapBtn = document.getElementById("compare-swap-btn");
    if (!swapBtn) return;

    swapBtn.addEventListener("click", function () {
      // Determine active tab
      const currentTab = document.getElementById("compare-tab-current");
      const customTab = document.getElementById("compare-tab-custom");
      const isCurrent = currentTab && currentTab.classList.contains("is-active");

      let aEl, bEl;
      if (isCurrent) {
        aEl = document.getElementById("compare-source-a-current");
        bEl = document.getElementById("compare-source-b-current");
      } else {
        aEl = document.getElementById("compare-source-a-custom");
        bEl = document.getElementById("compare-source-b-custom");
      }
      if (!aEl || !bEl) return;

      const tmp = aEl.value;
      aEl.value = bEl.value;
      bEl.value = tmp;
      notify("Swapped Source A and Source B", "info");
    });
  }

  // ============================================================
  // 14. Recent files for Load XML (localStorage-backed)
  // ============================================================
  const RECENT_FILES_KEY = "layout-tool.recent-files.v1";
  const MAX_RECENT_FILES = 5;

  function getRecentFiles() {
    try {
      const raw = localStorage.getItem(RECENT_FILES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_FILES) : [];
    } catch (_) {
      return [];
    }
  }

  function saveRecentFile(name, content) {
    try {
      const list = getRecentFiles().filter((f) => f.name !== name);
      list.unshift({
        name,
        date: new Date().toISOString(),
        content: content.slice(0, 500000), // cap at 500KB per entry
      });
      if (list.length > MAX_RECENT_FILES) list.length = MAX_RECENT_FILES;
      localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(list));
    } catch (_) {
      /* quota exceeded — silently skip */
    }
  }

  function installRecentFiles() {
    const fileInput = document.getElementById("xml-file-input");
    if (!fileInput) return;

    // Intercept file load to remember it.
    fileInput.addEventListener("change", function () {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          saveRecentFile(file.name, reader.result);
          renderRecentFilesPanel();
        }
      };
      reader.readAsText(file);
    });

    // Render panel below Load XML button.
    renderRecentFilesPanel();
  }

  function renderRecentFilesPanel() {
    const actionsDiv = document.querySelector(".tool-actions");
    if (!actionsDiv) return;

    let section = document.getElementById("recent-files-section");
    const files = getRecentFiles();

    if (!files.length) {
      if (section) section.remove();
      return;
    }

    if (!section) {
      section = document.createElement("div");
      section.id = "recent-files-section";
      section.className = "recent-files-section";
      // Insert after the tool-actions grid
      actionsDiv.parentNode.insertBefore(section, actionsDiv.nextSibling);
    }

    section.innerHTML = `
      <p class="tool-section-label">Recent Files</p>
      <div class="recent-files-list"></div>
    `;
    const list = section.querySelector(".recent-files-list");
    files.forEach((entry) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "recent-file-item";
      const d = new Date(entry.date);
      const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      item.innerHTML = `
        <span class="recent-file-name">${escapeForHtml(entry.name)}</span>
        <span class="recent-file-date">${dateStr}</span>
      `;
      item.title = `Load "${entry.name}" from recent history`;
      item.addEventListener("click", () => {
        if (typeof window.loadXMLContent === "function") {
          window.loadXMLContent(entry.content, {
            showDetectionToast: true,
            sourceName: entry.name,
          });
          if (typeof window.schedulePersistCurrentSession === "function") {
            window.schedulePersistCurrentSession();
          }
          notify(`Loaded "${entry.name}" from recent files`, "success");
        }
      });
      list.appendChild(item);
    });
  }

  function escapeForHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================================
  // 15. Clear multi-select on page change
  // ============================================================
  function installPageChangeSelectionClear() {
    const prevBtn = document.getElementById("prev-page-btn");
    const nextBtn = document.getElementById("next-page-btn");
    [prevBtn, nextBtn].forEach((btn) => {
      if (!btn) return;
      btn.addEventListener("click", () => {
        if (selectedSet.size > 0) clearMultiSelection();
      });
    });
  }

  // ============================================================
  // 16. Add modal auto-focus first relevant input
  // ============================================================
  function installAddModalAutoFocus() {
    const modal = document.getElementById("add-app-modal");
    if (!modal) return;

    const observer = new MutationObserver(() => {
      if (modal.style.display !== "block") return;
      // Delay slightly so form fields are populated/visible.
      requestAnimationFrame(() => {
        const searchInput = modal.querySelector("#item-search:not([style*='display: none'])");
        const typeSelect = modal.querySelector("#item-type");
        const target = searchInput || typeSelect;
        if (target && !modal.contains(document.activeElement)) {
          target.focus();
        }
      });
    });
    observer.observe(modal, { attributes: true, attributeFilter: ["style"] });
  }

  // ============================================================
  // 17. Compare: Copy diff output
  // ============================================================
  function installCompareCopyDiff() {
    const diffToolbar = document.querySelector(".compare-diff-toolbar-actions");
    if (!diffToolbar) return;
    if (document.getElementById("compare-copy-diff-btn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "compare-copy-diff-btn";
    btn.className = "compare-diff-toolbar-btn";
    btn.textContent = "Copy Diff";
    btn.title = "Copy the diff result as plain text";
    btn.addEventListener("click", async () => {
      const paneA = document.getElementById("diff-pane-a");
      const paneB = document.getElementById("diff-pane-b");
      if (!paneA || !paneB) {
        notify("No diff to copy", "error");
        return;
      }
      const textA = paneA.innerText || "";
      const textB = paneB.innerText || "";
      const output = `--- Source A ---\n${textA}\n\n--- Source B ---\n${textB}`;
      try {
        if (typeof window.copyTextToClipboard === "function") {
          await window.copyTextToClipboard(output);
        } else {
          await navigator.clipboard.writeText(output);
        }
        notify("Diff copied to clipboard", "success");
      } catch (_) {
        notify("Unable to copy diff", "error");
      }
    });
    diffToolbar.appendChild(btn);
  }

  // ============================================================
  // 18. Wiring & init
  // ============================================================
  function init() {
    if (window.__layoutToolEnhancementsInstalled) return;
    window.__layoutToolEnhancementsInstalled = true;

    installSetUnsavedChangesHook();
    wrapSaveAndReset();
    installUnloadGuard();
    installModeChangeGuard();
    installLayoutShrinkGuard();
    installToggleXmlLabelSync();
    installCartBulkActions();
    installCanvasSearch();
    installMultiSelect();
    installDuplicateAction();
    installModalAriaRoles();
    installKeyboardShortcuts();
    installFocusTrap();
    installCompareSwap();
    installRecentFiles();
    installPageChangeSelectionClear();
    installAddModalAutoFocus();
    installCompareCopyDiff();
  }

  // Public API for debugging and tests.
  window.LayoutToolEnhancements = {
    undo: undoCanvas,
    redo: redoCanvas,
    historyDepth: () => ({
      undo: canvasHistory.undo.length,
      redo: canvasHistory.redo.length,
    }),
    resetHistory: resetCanvasHistory,
    captureSnapshot: captureCanvasSnapshot,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 0);
  }
})();
