console.log("Welcome to dev mode");

// Debug flag – set to true to enable verbose logging
const DEBUG = false;

// Grid lines toggle state
let showGridLines = true;
let canvasPageMode = "auto";

// Layout configurations
const LAYOUTS_MAIN = {
  mobile: { cols: 4, rows: 6, cellSize: 100, iconSize: 60 },
  "tablet-6x8": { cols: 6, rows: 8, cellSize: 100, iconSize: 60 },
  "tablet-6x10": { cols: 6, rows: 10, cellSize: 100, iconSize: 60 },
  "tablet-8x6": { cols: 8, rows: 6, cellSize: 100, iconSize: 60 },
  "fold-6x6": { cols: 6, rows: 6, cellSize: 100, iconSize: 60 },
};

const LAYOUTS_FOLDER = {
  mobile: { cols: 4, rows: 6, cellSize: 100, iconSize: 60 },
  tablet: { cols: 4, rows: 6, cellSize: 100, iconSize: 60 },
  tablet8: { cols: 5, rows: 6, cellSize: 100, iconSize: 60 },
};

const TABLET_LAYOUT_KEYS = ["tablet-6x8", "tablet-6x10", "tablet-8x6"];
const FOLD_LAYOUT_KEYS = ["fold-6x6"];

function isTabletLayoutKey(layout = currentLayout) {
  return (
    TABLET_LAYOUT_KEYS.includes(layout) || FOLD_LAYOUT_KEYS.includes(layout)
  );
}

const GRID_GAP = 8;
const GRID_FRAME_SIZE = 18;

/**
 * Actual horizontal frame of #app-grid (padding + border), measured live.
 * The grid uses box-sizing: border-box and its width/height are set explicitly,
 * so the reserved frame must match the real CSS padding (16px on desktop, less on
 * narrow breakpoints). Using the hardcoded GRID_FRAME_SIZE (8px padding) made the
 * fixed-width columns overflow the padded box and get clipped by overflow:hidden,
 * cutting the left/right edge items. Padding is uniform on all sides, so the same
 * value applies to both axes. Falls back to GRID_FRAME_SIZE before the grid mounts.
 */
function getGridFrameSize() {
  const grid =
    (typeof appGrid !== "undefined" && appGrid) ||
    document.getElementById("app-grid");
  if (grid) {
    const cs = getComputedStyle(grid);
    const frame =
      parseFloat(cs.paddingLeft) +
      parseFloat(cs.paddingRight) +
      parseFloat(cs.borderLeftWidth) +
      parseFloat(cs.borderRightWidth);
    if (Number.isFinite(frame) && frame > 0) return frame;
  }
  return GRID_FRAME_SIZE;
}

/**
 * Horizontal space consumed between the .device-frame client box and the
 * #app-grid slot: the device-frame padding plus the coordinate ruler's Y-axis
 * column and the axes column-gap. The grid lives in a narrower slot than the
 * full device frame, so this must be reserved or the explicit grid width ends
 * up wider than the slot, max-width:100% clamps the box, and the fixed-px
 * columns overflow and get clipped (worst in two-page mode).
 */
function getCanvasHorizontalReserve(deviceFrame) {
  if (!deviceFrame) return DEVICE_FRAME_GRID_INSET;
  const fcs = getComputedStyle(deviceFrame);
  const framePad =
    (parseFloat(fcs.paddingLeft) || 0) + (parseFloat(fcs.paddingRight) || 0);
  let axisReserve = 0;
  const axes = deviceFrame.querySelector(".layout-canvas-axes");
  if (axes) {
    const colGap = parseFloat(getComputedStyle(axes).columnGap) || 0;
    const corner = axes.querySelector(".canvas-axis-corner");
    const axisY = axes.querySelector(".canvas-axis--y");
    const cornerW = corner ? corner.getBoundingClientRect().width : 0;
    const axisYW = axisY ? axisY.getBoundingClientRect().width : 0;
    // Corner has a fixed 30px CSS width; use it as a floor if not yet laid out.
    const axisColW = Math.max(cornerW, axisYW) || 30;
    axisReserve = axisColW + colGap;
  }
  // +2px guards against sub-pixel rounding pushing the box over the slot.
  return framePad + axisReserve + 2;
}
/** Home / app-order rows ≥ this → dense preview (grid-many-rows). */
const GRID_MANY_ROWS_THRESHOLD = 8;
/** Rows ≥ this → widget hàng 1: chỉ tên, scale chữ theo ô. */
const GRID_TEN_ROWS_THRESHOLD = 10;
/** Preferred minimum cell size for dense grids (e.g. 6×10). */
const GRID_MIN_CELL_SIZE = 26;
/** Hard floor when the frame is too small to fit at GRID_MIN_CELL_SIZE. */
const GRID_ABS_MIN_CELL_SIZE = 14;
const GRID_MAX_CELL_SIZE = 160;
const CANVAS_PAGE_SEPARATOR_SIZE = 18;
const CANVAS_TWO_PAGE_MIN_CELL_SIZE = 52;
/**
 * Reserve space inside .device-frame for #app-grid padding (8×2), border, and rounding error
 * so measured cell size never totals larger than the visible frame.
 */
const DEVICE_FRAME_GRID_INSET = 28;

function getCanvasPageCount(value = canvasVisiblePageCount) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.max(1, Math.min(2, Math.floor(parsed)));
}

function getCanvasGridWidth(cols, cellSize, gap = GRID_GAP, pageCount = 1) {
  const pages = getCanvasPageCount(pageCount);
  const pageColumnsWidth = pages * cols * cellSize;
  const innerColumnGaps = pages * Math.max(0, cols - 1) * gap;
  const pageSeparators =
    Math.max(0, pages - 1) * (CANVAS_PAGE_SEPARATOR_SIZE + 2 * gap);
  return pageColumnsWidth + innerColumnGaps + pageSeparators + getGridFrameSize();
}

/** Pixel width/height of workspace #app-grid (matches renderWorkspaceScreen). */
function getWorkspaceGridOuterPixels(
  cols,
  homeRows,
  cellSize,
  gap = GRID_GAP,
  pageCount = 1,
) {
  const w = getCanvasGridWidth(cols, cellSize, gap, pageCount);
  const h =
    homeRows * cellSize +
    (homeRows + 1) * gap +
    10 +
    cellSize +
    getGridFrameSize();
  return { w, h };
}

/** Pixel width/height of app-order #app-grid (matches renderScreen application-order branch). */
function getAppOrderGridOuterPixels(
  cols,
  slotRows,
  cellSize,
  gap = GRID_GAP,
  pageCount = 1,
) {
  const w = getCanvasGridWidth(cols, cellSize, gap, pageCount);
  const h =
    slotRows * cellSize + Math.max(0, slotRows - 1) * gap + getGridFrameSize();
  return { w, h };
}

/** Shrink cell size so the grid’s outer box never exceeds availW × availH. */
function clampCellSizeToAvailableFrame(
  cellSize,
  cols,
  gap,
  availW,
  availH,
  modeOpts,
) {
  let c = Math.floor(cellSize);
  c = Math.min(GRID_MAX_CELL_SIZE, Math.max(GRID_MIN_CELL_SIZE, c));
  const { workspaceHomeRows, appOrderSlotRows, pageCount = 1 } = modeOpts;

  const outer = () =>
    workspaceHomeRows != null
      ? getWorkspaceGridOuterPixels(cols, workspaceHomeRows, c, gap, pageCount)
      : getAppOrderGridOuterPixels(cols, appOrderSlotRows, c, gap, pageCount);

  let { w, h } = outer();
  const scale = Math.min(
    1,
    availW > 0 ? availW / w : 1,
    availH > 0 ? availH / h : 1,
  );
  if (scale < 1) {
    c = Math.max(GRID_ABS_MIN_CELL_SIZE, Math.floor(c * scale * 0.997));
  }

  ({ w, h } = outer());
  while (c > GRID_ABS_MIN_CELL_SIZE && (w > availW || h > availH)) {
    c -= 1;
    ({ w, h } = outer());
  }

  return c;
}

/** User-defined grid when layout is "custom" */
let customGridLayout = { cols: 4, homeRows: 6 };

function getWorkspaceCols() {
  if (currentLayout === "custom") {
    const c = Number(customGridLayout.cols);
    return Math.max(2, Math.min(12, Number.isFinite(c) ? c : 4));
  }
  if (isTabletLayoutKey()) return LAYOUTS_MAIN[currentLayout].cols;
  return LAYOUTS_MAIN.mobile.cols;
}

function getWorkspaceHomeRows() {
  if (currentLayout === "custom") {
    const r = Number(customGridLayout.homeRows);
    return Math.max(1, Math.min(12, Number.isFinite(r) ? r : 6));
  }
  if (isTabletLayoutKey()) return LAYOUTS_MAIN[currentLayout].rows;
  return LAYOUTS_MAIN.mobile.rows;
}

function getAppOrderSlotRows() {
  if (currentLayout === "custom") return getWorkspaceHomeRows();
  return LAYOUTS_MAIN[currentLayout].rows;
}

function getCurrentGridInfo() {
  return `${getWorkspaceCols()}x${getWorkspaceHomeRows()}`;
}

function getCurrentGridGap(mode = currentMode) {
  const rowCount =
    mode === "default-workspace"
      ? getWorkspaceHomeRows()
      : getAppOrderSlotRows();

  if (rowCount >= GRID_TEN_ROWS_THRESHOLD) {
    return 5;
  }
  if (rowCount >= GRID_MANY_ROWS_THRESHOLD) {
    return 6;
  }
  return GRID_GAP;
}

function shouldUseScrollableCanvas(rowCount) {
  return rowCount >= GRID_MANY_ROWS_THRESHOLD;
}

function getScrollableCanvasTargetCellSize(rowCount) {
  if (rowCount >= GRID_TEN_ROWS_THRESHOLD) {
    return 88;
  }
  if (rowCount >= GRID_MANY_ROWS_THRESHOLD) {
    return 96;
  }
  return GRID_MAX_CELL_SIZE;
}

function getMainCellSize(options = {}) {
  const pageCount = getCanvasPageCount(options.pageCount);
  const gap = getCurrentGridGap();
  const gridPadding = getGridFrameSize(); // real padding + border (measured, border-box)
  const cols = (currentLayout === "custom")
    ? Math.max(2, Math.min(12, Number(customGridLayout.cols) || 4))
    : (isTabletLayoutKey() ? LAYOUTS_MAIN[currentLayout].cols : LAYOUTS_MAIN.mobile.cols);

  const deviceFrame = document.querySelector(".device-frame");
  const frameRect = deviceFrame ? deviceFrame.getBoundingClientRect() : null;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  let availableHeight = frameRect && frameRect.height > 0
    ? frameRect.height
    : viewportHeight - 104;
  let availableWidth = frameRect && frameRect.width > 0
    ? frameRect.width
    : Math.min(window.innerWidth * 0.8, window.innerWidth - 64);

  if (deviceFrame && deviceFrame.clientWidth > 0 && deviceFrame.clientHeight > 0) {
    availableWidth = Math.min(availableWidth, deviceFrame.clientWidth);
    availableHeight = Math.min(availableHeight, deviceFrame.clientHeight);
  }

  availableWidth = Math.max(120, availableWidth - getCanvasHorizontalReserve(deviceFrame));
  availableHeight = Math.max(120, availableHeight - DEVICE_FRAME_GRID_INSET);

  let homeRows;
  let slotRows;
  if (currentMode === "default-workspace") {
    homeRows = getWorkspaceHomeRows();
  } else {
    slotRows = getAppOrderSlotRows();
  }

  const pageSeparators =
    Math.max(0, pageCount - 1) * (CANVAS_PAGE_SEPARATOR_SIZE + 2 * gap);
  const innerColumnGaps = pageCount * Math.max(0, cols - 1) * gap;
  const cellFromWidth =
    (availableWidth - innerColumnGaps - pageSeparators - gridPadding) /
    (cols * pageCount);
  const rowCount = currentMode === "default-workspace" ? homeRows : slotRows;

  if (shouldUseScrollableCanvas(rowCount)) {
    const comfortableCellSize = Math.floor(
      Math.min(cellFromWidth, getScrollableCanvasTargetCellSize(rowCount)),
    );
    return Math.min(
      GRID_MAX_CELL_SIZE,
      Math.max(GRID_MIN_CELL_SIZE, comfortableCellSize),
    );
  }

  let cellFromHeight;
  if (currentMode === "default-workspace") {
    // height = (homeRows+1)*cellSize + (homeRows+1)*gap + 10 + gridPadding
    cellFromHeight = (availableHeight - 10 - (homeRows + 1) * gap - gridPadding) / (homeRows + 1);
  } else {
    cellFromHeight = (availableHeight - (slotRows - 1) * gap - gridPadding) / slotRows;
  }

  let cellSize = Math.floor(Math.min(cellFromHeight, cellFromWidth));
  cellSize = Math.min(GRID_MAX_CELL_SIZE, Math.max(GRID_MIN_CELL_SIZE, cellSize));

  cellSize = clampCellSizeToAvailableFrame(
    cellSize,
    cols,
    gap,
    availableWidth,
    availableHeight,
    currentMode === "default-workspace"
      ? { workspaceHomeRows: homeRows, appOrderSlotRows: null, pageCount }
      : { workspaceHomeRows: null, appOrderSlotRows: slotRows, pageCount },
  );

  return cellSize;
}

function getFolderLayoutConfig() {
  if (currentLayout === "tablet-8x6") return LAYOUTS_FOLDER.tablet8;
  if (isTabletLayoutKey()) return LAYOUTS_FOLDER.tablet;
  return LAYOUTS_FOLDER.mobile;
}

let workspaceGridDnDBound = false;

function bindWorkspaceGridDnDOnce() {
  if (workspaceGridDnDBound || !appGrid) return;
  workspaceGridDnDBound = true;
  appGrid.addEventListener("dragover", handleWorkspaceGridDragOver);
  appGrid.addEventListener("drop", handleWorkspaceGridDrop);
  appGrid.addEventListener("dragleave", handleWorkspaceGridDragLeave);
}

// Global data structures
let xmlData = {
  folders: {},
  xmlHeader: "",
  xmlComment: "",
  xmlComments: [],
  xmlTrailingComments: [],
  rootAttributes: [],
};
let virtualBuffer = {
  folders: {},
  xmlHeader: "",
  xmlComment: "",
  xmlComments: [],
  xmlTrailingComments: [],
  rootAttributes: [],
};
let workspaceData = {
  home: [],
  hotseat: [],
  xmlHeader: "",
  xmlComment: "",
  xmlComments: [],
  xmlTrailingComments: [],
  rootAttributes: [],
}; // For Default Workspace mode
let virtualWorkspaceBuffer = {
  home: [],
  hotseat: [],
  xmlHeader: "",
  xmlComment: "",
  xmlComments: [],
  xmlTrailingComments: [],
  rootAttributes: [],
}; // For Default Workspace mode
let unsavedChanges = false;
let currentLayout = "mobile";
let currentPage = 0;
let canvasVisiblePageCount = 1;
let currentFolderPage = 0;
let allItems = [];
let folderItems = [];
let currentFolder = null;
const FOLDER_HISTORY_LIMIT = 30;
let folderHistory = { undo: [], redo: [] };
let dragSourceItem = null;
let dragTargetItem = null;
/** Pending app-on-folder drop: Application Order or Default Workspace (swap vs merge). */
let pendingFolderDropChoice = null;
let dragGrabOffset = { cellX: 0, cellY: 0 }; // offset in grid cells from widget top-left
let resizeState = null;
let workspaceDropPreviewElement = null;
let workspaceDropPreviewKey = "";
let workspaceStickyPreview = null;
let transparentDragImage = null;
let currentMode = "application-order"; // "application-order" or "default-workspace"
let cartItems = [];
let cartItemSerial = 0;

// Database mapping
let layoutCatalog = { app: [], widget: [] };
let layoutCatalogLookup = new Map();
let addModalContext = null;
const LOCAL_SESSION_STORAGE_KEY = "layout-generator.local-session.v1";
const SERVER_SESSION_ENDPOINT = "/api/session";
const PUBLIC_REQUESTS_ENDPOINT = "/api/request-board";
// Static build (GitHub Pages): there is no backend. Editor sessions persist
// to localStorage only, and the shared request board stays offline.
const STATIC_BUILD = true;
const PUBLIC_REQUEST_APPROVERS_ENDPOINT = "/api/request-board/approvers";
const PUBLIC_REQUEST_ACTIVITY_ENDPOINT = "/api/request-board/activity";
const PUBLIC_REQUEST_DIRECT_WRITE_ENDPOINT = "/api/request-board/direct-write";
const VALID_EDITOR_MODES = new Set([
  "application-order",
  "default-workspace",
]);
const VALID_LAYOUT_PROFILES = new Set([
  "mobile",
  "tablet-6x8",
  "tablet-6x10",
  "tablet-8x6",
  "fold-6x6",
  "custom",
]);
let sessionPersistTimer = null;
let serverSessionPersistTimer = null;
let isRestoringLocalSession = false;
let committedEditorProfiles = {};
let serverSessionSupported = STATIC_BUILD ? false : null;
let serverSessionCache = null;
let serverSessionLoadPromise = null;
const REQUEST_TYPE_LABELS = {
  "update-data-app": "Update",
  "add-new-app": "New App",
  others: "Other",
};
const REQUEST_STATUS_LABELS = {
  open: "Open",
  "in-review": "Review",
  applied: "Done",
  closed: "Closed",
};
const REQUEST_UPDATE_FIELD_LABELS = {
  comment: "Name",
  "package-name": "Package",
  "class-name": "Class",
  "source-path": "Source",
  other: "Other",
};
const APPLYABLE_REQUEST_FIELDS = new Set([
  "comment",
  "package-name",
  "class-name",
  "source-path",
]);
let publicRequestBoardState = {
  items: [],
  approvers: [],
  viewerIp: "",
  viewerName: "",
  viewerRole: "viewer",
  viewerCanApplyRequests: false,
  viewerCanManageApprovers: false,
  activityItems: [],
  activitySummary: {
    uniqueIps: 0,
    hosts: 0,
    approvers: 0,
    viewers: 0,
  },
  activityDate: "",
  activityUpdatedAt: "",
  updatedAt: "",
  isLoading: false,
  isLoadingActivity: false,
  isSubmitting: false,
  isDirectSaving: false,
  isSavingApprover: false,
  submittingReplyRequestId: "",
  applyingRequestId: "",
  openReplyRequestId: "",
  selectedAppKey: "",
  filters: {
    type: "all",
    status: "all",
  },
  activityFilters: {
    query: "",
    time: "all",
  },
  activityErrorMessage: "",
  errorMessage: "",
};

function isValidEditorMode(mode) {
  return VALID_EDITOR_MODES.has(mode);
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCustomGridLayout(grid = {}) {
  const cols = Number(grid.cols);
  const homeRows = Number(grid.homeRows);

  return {
    cols: Math.max(2, Math.min(12, Number.isFinite(cols) ? cols : 4)),
    homeRows: Math.max(1, Math.min(12, Number.isFinite(homeRows) ? homeRows : 6)),
  };
}

function normalizeEditorProfile(profile = {}, fallbackMode = currentMode) {
  const mode = isValidEditorMode(profile.mode) ? profile.mode : fallbackMode;
  let layoutKey = profile.layout === "tablet" ? "tablet-6x8" : profile.layout;
  const layout = VALID_LAYOUT_PROFILES.has(layoutKey) ? layoutKey : "mobile";

  return {
    mode,
    layout,
    customGridLayout: normalizeCustomGridLayout(profile.customGridLayout),
  };
}

function normalizeCartPayloadComment(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function normalizeCartEntry(rawEntry = {}) {
  const rawPayload = rawEntry.payload || rawEntry.item || {};
  const rawType =
    rawEntry.type === "widget" || rawPayload.type === "appwidget"
      ? "widget"
      : "app";
  const payload = {
    type: rawType === "widget" ? "appwidget" : "app",
    packageName: String(rawPayload.packageName || "").trim(),
    className: String(rawPayload.className || "").trim(),
    comment: normalizeCartPayloadComment(rawPayload.comment),
  };

  if (rawPayload.hidden !== undefined) {
    payload.hidden = rawPayload.hidden;
  }

  if (rawType === "widget") {
    payload.spanX = Math.max(1, Number(rawPayload.spanX) || 1);
    payload.spanY = Math.max(1, Number(rawPayload.spanY) || 1);
  }

  return {
    id:
      typeof rawEntry.id === "string" && rawEntry.id.trim()
        ? rawEntry.id.trim()
        : `cart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: isValidEditorMode(rawEntry.mode) ? rawEntry.mode : "default-workspace",
    type: rawType,
    payload,
  };
}

function normalizePersistedCartItems(rawItems = []) {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems
    .map((entry) => normalizeCartEntry(entry))
    .filter((entry) => {
      if (!entry.payload.packageName || !entry.payload.className) {
        return false;
      }
      if (entry.type === "widget") {
        return entry.payload.spanX >= 1 && entry.payload.spanY >= 1;
      }
      return true;
    });
}

function syncCartSerialFromEntries(entries = cartItems) {
  let maxSerial = 0;

  (entries || []).forEach((entry) => {
    const match = String(entry?.id || "").match(/^cart-(\d+)$/);
    if (!match) return;
    maxSerial = Math.max(maxSerial, Number(match[1]) || 0);
  });

  cartItemSerial = Math.max(cartItemSerial, maxSerial);
}

function buildNextCartEntryId() {
  cartItemSerial += 1;
  return `cart-${cartItemSerial}`;
}

function createEditorProfileSnapshot(mode = currentMode) {
  return normalizeEditorProfile({
    mode,
    layout: currentLayout,
    customGridLayout,
  }, mode);
}

function applyEditorProfile(profile) {
  const normalized = normalizeEditorProfile(profile);

  currentMode = normalized.mode;
  currentLayout = normalized.layout;
  customGridLayout = cloneData(normalized.customGridLayout);

  if (modeSelect) {
    modeSelect.value = currentMode;
  }
  if (layoutSelect) {
    layoutSelect.value = currentLayout;
  }

  syncCustomGridInputsFromState();
  syncCustomGridPanelVisibility();
  syncLayoutClasses();
  return normalized;
}

function rememberCommittedProfile(profile = createEditorProfileSnapshot()) {
  const normalized = normalizeEditorProfile(profile);
  committedEditorProfiles[normalized.mode] = cloneData(normalized);
  return normalized;
}

function getCommittedProfile(mode = currentMode) {
  if (committedEditorProfiles[mode]) {
    return cloneData(committedEditorProfiles[mode]);
  }

  if (mode === currentMode) {
    return createEditorProfileSnapshot(mode);
  }

  return normalizeEditorProfile({ mode });
}

function restoreCommittedProfileForMode(mode = currentMode) {
  const profile = committedEditorProfiles[mode];
  if (!profile) return null;
  return applyEditorProfile(profile);
}

function syncDirtyActionButtons() {
  const hasMainPendingChanges = unsavedChanges || xmlEditorDirty;
  if (saveChangesBtn) saveChangesBtn.disabled = !hasMainPendingChanges;
  if (resetLayoutBtn) resetLayoutBtn.disabled = !hasMainPendingChanges;

  const folderVisible =
    Boolean(currentFolder) &&
    Boolean(folderModal) &&
    folderModal.style.display === "block";

  if (folderSaveBtn) folderSaveBtn.disabled = !(unsavedChanges && folderVisible);
  if (folderResetBtn) folderResetBtn.disabled = !(unsavedChanges && folderVisible);
}

function setUnsavedChanges(isDirty) {
  unsavedChanges = Boolean(isDirty);
  syncDirtyActionButtons();
}

function syncXMLPanelChrome() {
  if (saveXmlBtn) {
    saveXmlBtn.disabled = !xmlEditorDirty;
  }

  if (refreshXmlBtn) {
    refreshXmlBtn.textContent = xmlEditorDirty ? "Reset XML" : "Refresh XML";
  }

  if (xmlEditorState) {
    xmlEditorState.textContent = xmlEditorDirty ? "Draft" : "Synced";
    xmlEditorState.classList.toggle("is-dirty", xmlEditorDirty);
    xmlEditorState.classList.toggle("is-synced", !xmlEditorDirty);
  }
}

function setXMLContentValue(text, options = {}) {
  const { markClean = true } = options;
  if (!xmlContent) return;

  isSyncingXMLContent = true;
  xmlContent.value = text;
  isSyncingXMLContent = false;
  xmlEditorLastSyncedText = text;

  if (markClean) {
    xmlEditorDirty = false;
  }

  syncXMLPanelChrome();
  syncDirtyActionButtons();
}

function getXMLPanelText() {
  if (xmlContent && typeof xmlContent.value === "string") {
    return xmlContent.value;
  }

  return getCurrentXMLText();
}

function handleXMLContentInput() {
  if (!xmlContent || isSyncingXMLContent) {
    return;
  }

  xmlEditorDirty = xmlContent.value !== xmlEditorLastSyncedText;
  syncXMLPanelChrome();
  syncDirtyActionButtons();
  syncAppChrome();
}

function handleXMLContentKeydown(event) {
  if (!(event.ctrlKey || event.metaKey)) {
    return;
  }

  if (String(event.key).toLowerCase() !== "s") {
    return;
  }

  event.preventDefault();
  saveXMLEditorChanges();
}

function readLocalSession() {
  try {
    const raw = window.localStorage.getItem(LOCAL_SESSION_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn("Unable to read local editor session:", error);
    return null;
  }
}

function writeLocalSession(session) {
  try {
    window.localStorage.setItem(
      LOCAL_SESSION_STORAGE_KEY,
      JSON.stringify(session),
    );
    return true;
  } catch (error) {
    console.warn("Unable to persist local editor session:", error);
    return false;
  }
}

function getPersistedSessionSnapshot() {
  if (serverSessionCache && typeof serverSessionCache === "object") {
    return cloneData(serverSessionCache);
  }
  return readLocalSession();
}

function rememberResolvedSession(session) {
  if (!session || typeof session !== "object") {
    serverSessionCache = null;
    return null;
  }

  const normalized = cloneData(session);
  serverSessionCache = normalized;
  writeLocalSession(normalized);
  return cloneData(normalized);
}

async function loadServerSession(options = {}) {
  const { force = false } = options;

  if (serverSessionSupported === false && !force) {
    return null;
  }

  if (!force && serverSessionLoadPromise) {
    return serverSessionLoadPromise;
  }

  serverSessionLoadPromise = fetch(SERVER_SESSION_ENDPOINT, {
    cache: "no-store",
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      serverSessionSupported = true;

      if (payload?.session && typeof payload.session === "object") {
        return rememberResolvedSession(payload.session);
      }

      serverSessionCache = null;
      return null;
    })
    .catch((error) => {
      console.warn("Unable to load server session, falling back to local storage:", error);
      serverSessionSupported = false;
      return null;
    })
    .finally(() => {
      serverSessionLoadPromise = null;
    });

  return serverSessionLoadPromise;
}

async function persistSessionToServer(session, options = {}) {
  const { keepalive = false } = options;

  if (!session || typeof session !== "object" || serverSessionSupported === false) {
    return false;
  }

  try {
    const response = await fetch(SERVER_SESSION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session }),
      credentials: "same-origin",
      keepalive,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    await response.json().catch(() => null);
    serverSessionSupported = true;
    serverSessionCache = cloneData(session);
    return true;
  } catch (error) {
    console.warn("Unable to persist session to server, keeping local copy only:", error);
    if (serverSessionSupported === null) {
      serverSessionSupported = false;
    }
    return false;
  }
}

function queueServerSessionPersist(session) {
  if (!session || typeof session !== "object" || serverSessionSupported === false) {
    return;
  }

  clearTimeout(serverSessionPersistTimer);
  serverSessionPersistTimer = window.setTimeout(() => {
    void persistSessionToServer(session);
  }, 250);
}

function persistSessionDuringUnload(session) {
  if (!session || typeof session !== "object" || serverSessionSupported === false) {
    return false;
  }

  const payload = JSON.stringify({ session });
  if (navigator.sendBeacon) {
    try {
      const ok = navigator.sendBeacon(
        SERVER_SESSION_ENDPOINT,
        new Blob([payload], { type: "application/json" }),
      );
      if (ok) {
        serverSessionSupported = true;
        serverSessionCache = cloneData(session);
        return true;
      }
    } catch (error) {
      console.warn("Unable to flush session with sendBeacon:", error);
    }
  }

  void persistSessionToServer(session, { keepalive: true });
  return false;
}

function syncGridLinesToggleFromState() {
  const gridLinesToggle = document.getElementById("grid-lines-toggle");
  if (gridLinesToggle) {
    gridLinesToggle.checked = showGridLines;
  }
}

function getGridInfoFromProfile(profile = createEditorProfileSnapshot()) {
  const normalized = normalizeEditorProfile(profile);

  if (isTabletLayoutKey(normalized.layout)) {
    const cfg = LAYOUTS_MAIN[normalized.layout];
    return `${cfg.cols}x${cfg.rows}`;
  }

  if (normalized.layout === "custom") {
    return `${normalized.customGridLayout.cols}x${normalized.customGridLayout.homeRows}`;
  }

  return `${LAYOUTS_MAIN.mobile.cols}x${LAYOUTS_MAIN.mobile.rows}`;
}

function captureCurrentModeSessionSnapshot() {
  try {
    const workingProfile = createEditorProfileSnapshot(currentMode);
    const savedProfile = getCommittedProfile(currentMode);
    const workingXml = getCurrentXMLText();
    const savedXml = getSavedXMLTextForMode(currentMode, savedProfile);

    return {
      workingXml,
      savedXml,
      unsavedChanges,
      savedProfile,
      workingProfile,
      page: currentPage,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn("Skipping session snapshot because XML could not be generated:", error);
    return null;
  }
}

function persistCurrentSessionNow(options = {}) {
  const { beforeUnload = false } = options;

  if (isRestoringLocalSession || !isValidEditorMode(currentMode)) {
    return;
  }

  const snapshot = captureCurrentModeSessionSnapshot();
  if (!snapshot || !snapshot.workingXml) {
    return;
  }

  const session = getPersistedSessionSnapshot() || { version: 4, modes: {} };
  if (!session.modes || typeof session.modes !== "object") {
    session.modes = {};
  }

  session.version = 4;
  session.currentMode = currentMode;
  session.showGridLines = showGridLines;
  session.canvasPageMode = canvasPageMode;
  session.cartItems = cloneData(cartItems);
  session.cartItemSerial = cartItemSerial;
  session.modes[currentMode] = snapshot;

  const persistedSession = rememberResolvedSession(session);
  if (beforeUnload) {
    persistSessionDuringUnload(persistedSession);
    return;
  }

  queueServerSessionPersist(persistedSession);
}

function schedulePersistCurrentSession() {
  if (isRestoringLocalSession) {
    return;
  }

  clearTimeout(sessionPersistTimer);
  sessionPersistTimer = window.setTimeout(() => {
    persistCurrentSessionNow();
  }, 150);
}

function normalizePersistedModeSession(mode, session) {
  const rawSnapshot = session?.modes?.[mode];
  if (!rawSnapshot || typeof rawSnapshot !== "object") {
    return null;
  }

  const workingXml =
    typeof rawSnapshot.workingXml === "string" && rawSnapshot.workingXml.trim()
      ? rawSnapshot.workingXml
      : (typeof rawSnapshot.xml === "string" && rawSnapshot.xml.trim()
        ? rawSnapshot.xml
        : "");

  if (!workingXml) {
    return null;
  }

  const savedXml =
    typeof rawSnapshot.savedXml === "string" && rawSnapshot.savedXml.trim()
      ? rawSnapshot.savedXml
      : workingXml;

  const workingProfile = normalizeEditorProfile(
    rawSnapshot.workingProfile || detectXMLProfile(workingXml),
    mode,
  );
  const savedProfile = normalizeEditorProfile(
    rawSnapshot.savedProfile || detectXMLProfile(savedXml),
    mode,
  );
  const page = Number(rawSnapshot.page);

  return {
    mode,
    workingXml,
    savedXml,
    unsavedChanges: Boolean(rawSnapshot.unsavedChanges),
    workingProfile,
    savedProfile,
    page: Number.isFinite(page) ? Math.max(0, page) : 0,
  };
}

function restoreSnapshotState(snapshot) {
  if (!snapshot) {
    return false;
  }

  applyEditorProfile(snapshot.workingProfile);
  rememberCommittedProfile(snapshot.savedProfile);

  if (snapshot.mode === "default-workspace") {
    parseWorkspaceXMLData(snapshot.savedXml);
    const savedWorkspaceData = cloneData(workspaceData);

    parseWorkspaceXMLData(snapshot.workingXml);
    const workingWorkspaceData = cloneData(virtualWorkspaceBuffer);

    workspaceData = savedWorkspaceData;
    virtualWorkspaceBuffer = workingWorkspaceData;
  } else {
    parseXMLData(snapshot.savedXml);
    const savedXmlData = cloneData(xmlData);

    parseXMLData(snapshot.workingXml);
    const workingXmlData = cloneData(xmlData);

    xmlData = savedXmlData;
    virtualBuffer = workingXmlData;
  }

  resetEditorStateAfterLoad();
  currentPage = snapshot.page;
  setUnsavedChanges(snapshot.unsavedChanges);
  syncGridLinesToggleFromState();
  updateUI();
  refreshXMLViewer();
  return true;
}

function restoreModeFromLocalSession(mode) {
  const session = getPersistedSessionSnapshot();
  const snapshot = normalizePersistedModeSession(mode, session);

  if (!snapshot) {
    return false;
  }

  if (typeof session.showGridLines === "boolean") {
    showGridLines = session.showGridLines;
  }
  if (session.canvasPageMode) {
    canvasPageMode = normalizeCanvasPageMode(session.canvasPageMode);
    syncCanvasPageModeButtons();
  }

  isRestoringLocalSession = true;
  try {
    return restoreSnapshotState(snapshot);
  } catch (error) {
    console.error("Unable to restore local editor session:", error);
    return false;
  } finally {
    isRestoringLocalSession = false;
  }
}

async function loadInitialXMLData() {
  const remoteSession = await loadServerSession();
  const fallbackLocalSession = readLocalSession();
  const session = remoteSession || fallbackLocalSession;

  if (!remoteSession && fallbackLocalSession && serverSessionSupported !== false) {
    rememberResolvedSession(fallbackLocalSession);
    queueServerSessionPersist(fallbackLocalSession);
  }

  if (typeof session?.showGridLines === "boolean") {
    showGridLines = session.showGridLines;
  }
  if (session?.canvasPageMode) {
    canvasPageMode = normalizeCanvasPageMode(session.canvasPageMode);
  }
  cartItems = normalizePersistedCartItems(session?.cartItems);
  if (Number.isFinite(Number(session?.cartItemSerial))) {
    cartItemSerial = Math.max(cartItemSerial, Number(session.cartItemSerial));
  }
  syncCartSerialFromEntries(cartItems);
  syncGridLinesToggleFromState();
  syncCanvasPageModeButtons();

  if (isValidEditorMode(session?.currentMode)) {
    currentMode = session.currentMode;
    if (modeSelect) {
      modeSelect.value = currentMode;
    }
  }

  if (restoreModeFromLocalSession(currentMode)) {
    return;
  }

  loadXMLData({ preferSavedSession: false });
}

const ICON_PALETTES = {
  sky: {
    soft: "#DCEEFF",
    wash: "#F7FBFF",
    solid: "#3388FF",
    muted: "#9EC8FF",
    stroke: "#12314F",
    shadow: "rgba(51, 136, 255, .28)",
  },
  jade: {
    soft: "#DDF7EC",
    wash: "#F5FFFA",
    solid: "#17B26A",
    muted: "#89D8B4",
    stroke: "#17352E",
    shadow: "rgba(23, 178, 106, .22)",
  },
  amber: {
    soft: "#FFF0C7",
    wash: "#FFFAEE",
    solid: "#F59E0B",
    muted: "#F8C86B",
    stroke: "#4A3311",
    shadow: "rgba(245, 158, 11, .22)",
  },
  coral: {
    soft: "#FFE4D8",
    wash: "#FFF8F3",
    solid: "#F97316",
    muted: "#FDBA8C",
    stroke: "#4C2711",
    shadow: "rgba(249, 115, 22, .22)",
  },
  rose: {
    soft: "#FFE1E7",
    wash: "#FFF6F8",
    solid: "#F43F5E",
    muted: "#F9A8B8",
    stroke: "#4B1E29",
    shadow: "rgba(244, 63, 94, .2)",
  },
  teal: {
    soft: "#DBF5F1",
    wash: "#F3FFFD",
    solid: "#0F9F8A",
    muted: "#87D8CC",
    stroke: "#133B38",
    shadow: "rgba(15, 159, 138, .2)",
  },
  plum: {
    soft: "#F0E7FF",
    wash: "#FBF8FF",
    solid: "#8B5CF6",
    muted: "#C4B5FD",
    stroke: "#31214F",
    shadow: "rgba(139, 92, 246, .18)",
  },
  slate: {
    soft: "#E7EEF7",
    wash: "#F8FAFD",
    solid: "#64748B",
    muted: "#B7C3D5",
    stroke: "#1F2E40",
    shadow: "rgba(100, 116, 139, .18)",
  },
};

const ICON_PALETTE_BY_KEY = {
  assistant: "plum",
  browser: "sky",
  calculator: "slate",
  calendar: "amber",
  camera: "coral",
  clock: "sky",
  cloud: "sky",
  connections: "teal",
  contacts: "jade",
  files: "slate",
  folder: "amber",
  gallery: "rose",
  generic: "slate",
  health: "jade",
  home: "jade",
  mail: "amber",
  maps: "teal",
  message: "teal",
  mic: "coral",
  music: "rose",
  notes: "amber",
  phone: "sky",
  search: "sky",
  security: "rose",
  settings: "slate",
  store: "coral",
  video: "coral",
  wallet: "amber",
  weather: "sky",
  widget: "sky",
};

const ICON_PACKAGE_OVERRIDES = {
  "ai.perplexity.app.android": "assistant",
  "com.android.chrome": "browser",
  "com.android.settings": "settings",
  "com.android.vending": "store",
  "com.google.android.apps.docs": "cloud",
  "com.google.android.apps.googleassistant": "assistant",
  "com.google.android.apps.maps": "maps",
  "com.google.android.apps.messaging": "message",
  "com.google.android.apps.photos": "gallery",
  "com.google.android.apps.tachyon": "message",
  "com.google.android.apps.youtube.music": "music",
  "com.google.android.gm": "mail",
  "com.google.android.googlequicksearchbox": "search",
  "com.google.android.videos": "video",
  "com.google.android.youtube": "video",
  "com.instagram.android": "message",
  "com.microsoft.office.outlook": "mail",
  "com.microsoft.office.officehubrow": "notes",
  "com.microsoft.skydrive": "cloud",
  "com.netflix.mediaclient": "video",
  "com.samsung.android.app.contacts": "contacts",
  "com.samsung.android.app.find": "search",
  "com.samsung.android.app.spage": "home",
  "com.samsung.android.bixby.agent": "assistant",
  "com.samsung.android.calendar": "calendar",
  "com.samsung.android.dialer": "phone",
  "com.samsung.android.galaxy": "store",
  "com.samsung.android.galaxycontinuity": "connections",
  "com.samsung.android.messaging": "message",
  "com.samsung.android.oneconnect": "connections",
  "com.samsung.android.voc": "security",
  "com.samsung.sree": "home",
  "com.sec.android.app.camera": "camera",
  "com.sec.android.app.clockpackage": "clock",
  "com.sec.android.app.myfiles": "files",
  "com.sec.android.app.notes": "notes",
  "com.sec.android.app.popupcalculator": "calculator",
  "com.sec.android.app.samsungapps": "store",
  "com.sec.android.app.sbrowser": "browser",
  "com.sec.android.app.shealth": "health",
  "com.sec.android.daemonapp": "weather",
  "com.sec.android.easyMover": "connections",
  "com.sec.android.gallery3d": "gallery",
  "com.sec.penup": "notes",
  "com.spotify.music": "music",
  "com.vkontakte.android": "message",
  "com.yandex.browser": "browser",
  "com.yandex.searchapp": "search",
  "ru.crptech.mark": "security",
  "ru.dublgis.dgismobile": "maps",
  "ru.litres.android": "notes",
  "ru.mail.mailapp": "mail",
  "ru.mail.search.electroscope": "assistant",
  "ru.ok.android": "message",
  "ru.oneme.app": "message",
  "ru.rostel": "security",
  "ru.rutube.app": "video",
  "ru.vk.store": "store",
  "ru.yandex.disk": "cloud",
  "ru.yandex.yandexmaps": "maps",
  "ru.zen.android": "home",
};

const ICON_CLASS_OVERRIDES = {
  "com.android.calendar.widget.today.TodayWidgetProvider": "calendar",
  "com.samsung.android.app.shealth.tracker.dailyactivity.widget.DaWidgetReceiver":
    "health",
  "com.sec.android.daemonapp.appwidget.WeatherAppWidget2x1": "weather",
  "com.yandex.browser.lite.appwidget.SearchWidgetProvider": "search",
  "org.chromium.chrome.browser.searchwidget.SearchWidgetProvider": "search",
};

const BRAND_LABEL_PREFIXES = [
  ["ai.perplexity.", "Perplexity"],
  ["com.google.", "Google"],
  ["com.microsoft.", "Microsoft"],
  ["com.netflix.", "Netflix"],
  ["com.samsung.", "Samsung"],
  ["com.sec.", "Samsung"],
  ["com.spotify.", "Spotify"],
  ["com.yandex.", "Yandex"],
  ["com.vkontakte.", "VK"],
  ["ru.mail.", "Mail.ru"],
  ["ru.ok.", "OK"],
  ["ru.rutube.", "Rutube"],
  ["ru.vk.", "VK"],
  ["ru.yandex.", "Yandex"],
];

const WIDGET_EYEBROW_BY_KEY = {
  calendar: "Calendar widget",
  health: "Health widget",
  search: "Search widget",
  weather: "Weather widget",
  widget: "Live widget",
};

const PACKAGE_FALLBACK_SKIP_WORDS = new Set([
  "activity",
  "android",
  "app",
  "apps",
  "free",
  "launcher",
  "main",
  "mobile",
  "provider",
]);

function getItemPackageName(item) {
  const data = item && item.data ? item.data : {};
  return data.packageName || data["package name"] || "";
}

function getItemClassName(item) {
  const data = item && item.data ? item.data : {};
  return data.className || data.class_name || "";
}

function getItemComment(item) {
  const data = item && item.data ? item.data : {};
  return data.comment || data.Comment || "";
}

function getLayoutCatalogEntryForItem(item) {
  if (!item) return null;

  const type = item.type === "appwidget" ? "widget" : "app";
  const packageName = getItemPackageName(item);
  const className = getItemClassName(item);

  if (!packageName) {
    return null;
  }

  if (className) {
    const exactMatch = layoutCatalogLookup.get(
      `${type}|${packageName}|${className}`,
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  const samePackageEntries = getLayoutCatalogForType(type).filter(
    (entry) => entry.packageName === packageName,
  );

  if (samePackageEntries.length === 1) {
    return samePackageEntries[0];
  }

  return null;
}

function getDisplayComment(item) {
  const xmlComment = normalizeStoredComment(getItemComment(item));
  if (xmlComment) {
    return xmlComment;
  }

  return normalizeStoredComment(getLayoutCatalogEntryForItem(item)?.comment);
}

function toTitleCasePhrase(value) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (word.toUpperCase() === word && word.length <= 4) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function humanizeIdentifier(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getPackageFallbackLabel(packageName) {
  const segments = String(packageName || "")
    .split(".")
    .filter(Boolean);
  const preferred =
    [...segments]
      .reverse()
      .find((segment) => !PACKAGE_FALLBACK_SKIP_WORDS.has(segment.toLowerCase())) ||
    segments[segments.length - 1] ||
    "App";
  return toTitleCasePhrase(humanizeIdentifier(preferred));
}

function getBrandLabel(packageName) {
  const target = String(packageName || "").toLowerCase();
  const matched = BRAND_LABEL_PREFIXES.find(([prefix]) => target.startsWith(prefix));
  return matched ? matched[1] : "";
}

function sanitizeWidgetDisplayTitle(text) {
  return String(text || "")
    .replace(/^\s*appwidget\s*:\s*/i, "")
    .replace(/\bappwidget\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getWidgetTitleFromComment(item) {
  const comment = humanizeIdentifier(getDisplayComment(item))
    .replace(/^\s*appwidget\s*:\s*/i, "")
    .replace(/\bappwidget\b/gi, "")
    .replace(/\bapp widget\b/gi, "")
    .replace(/\bwidget\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return comment;
}

function getWidgetSemanticKey(item) {
  const descriptor = [
    getItemPackageName(item),
    getItemClassName(item),
    getDisplayComment(item),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/weather|forecast|daemonapp/.test(descriptor)) return "weather";
  if (/calendar|todaywidget/.test(descriptor)) return "calendar";
  if (/search|browser|google|yandex|chrome/.test(descriptor)) return "search";
  if (/health|activity|fit/.test(descriptor)) return "health";
  return "widget";
}

function getWidgetDisplayName(item) {
  const commentTitle = sanitizeWidgetDisplayTitle(getWidgetTitleFromComment(item));
  if (commentTitle) {
    return commentTitle;
  }

  const packageName = getItemPackageName(item);
  const semanticKey = getWidgetSemanticKey(item);
  const semanticLabel = toTitleCasePhrase(semanticKey);
  let result;
  const brand = getBrandLabel(packageName);
  if (brand) {
    result =
      semanticLabel === "Widget"
        ? `${brand} Widget`
        : `${brand} ${semanticLabel}`;
  } else {
    result = semanticLabel;
  }

  return sanitizeWidgetDisplayTitle(result) || "Widget";
}

function getWidgetMetaText(item) {
  const packageName = getItemPackageName(item);
  const title = getWidgetDisplayName(item).toLowerCase();
  const candidates = [
    getDisplayComment(item),
    getBrandLabel(packageName),
  ].filter(Boolean);

  const raw =
    candidates.find((value) => !title.includes(value.toLowerCase())) ||
    "Resizable panel";
  return sanitizeWidgetDisplayTitle(raw) || "Resizable panel";
}

function getWidgetEyebrow(item) {
  const semanticKey = getWidgetSemanticKey(item);
  return WIDGET_EYEBROW_BY_KEY[semanticKey] || "Live widget";
}

function getItemDescriptor(item) {
  const data = item && item.data ? item.data : {};
  const comment = getItemComment(item);
  const title = data.title || "";
  return [
    getItemPackageName(item),
    getItemClassName(item),
    title,
    comment,
    getDisplayName(item),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function resolveUnifiedIconKey(item) {
  if (!item) return "generic";
  if (item.type === "folder") return "folder";

  const packageName = getItemPackageName(item);
  const className = getItemClassName(item);
  if (className && ICON_CLASS_OVERRIDES[className]) {
    return ICON_CLASS_OVERRIDES[className];
  }
  if (packageName && ICON_PACKAGE_OVERRIDES[packageName]) {
    return ICON_PACKAGE_OVERRIDES[packageName];
  }

  const descriptor = getItemDescriptor(item);

  if (item.type === "appwidget") {
    if (/weather|forecast|daemonapp/.test(descriptor)) return "weather";
    if (/calendar|todaywidget/.test(descriptor)) return "calendar";
    if (/search|browser|google|yandex|chrome/.test(descriptor)) return "search";
    if (/health|activity|fit/.test(descriptor)) return "health";
    return "widget";
  }

  if (/dialer|phone|call/.test(descriptor)) return "phone";
  if (/contacts/.test(descriptor)) return "contacts";
  if (/messag|sms|chat|vkontakte|instagram|ok\.android/.test(descriptor)) return "message";
  if (/gmail|outlook|\bmail\b/.test(descriptor)) return "mail";
  if (/calendar/.test(descriptor)) return "calendar";
  if (/clock|alarm/.test(descriptor)) return "clock";
  if (/camera/.test(descriptor)) return "camera";
  if (/gallery|photos|photo/.test(descriptor)) return "gallery";
  if (/maps|navigation|dgis|gis|locator/.test(descriptor)) return "maps";
  if (/browser|chrome|internet/.test(descriptor)) return "browser";
  if (/assistant|perplexity|bixby|marusya|nugu/.test(descriptor)) return "assistant";
  if (/search|find|googlequicksearchbox|yandex/.test(descriptor)) return "search";
  if (/spotify|music/.test(descriptor)) return "music";
  if (/youtube|netflix|rutube|video|movies/.test(descriptor)) return "video";
  if (/vending|store|shop|market|samsungapps|rustore/.test(descriptor)) return "store";
  if (/wallet|pass|pay/.test(descriptor)) return "wallet";
  if (/health|activity|fit/.test(descriptor)) return "health";
  if (/drive|disk|onedrive|cloud/.test(descriptor)) return "cloud";
  if (/voice|record/.test(descriptor)) return "mic";
  if (/notes|note|docs|office|penup/.test(descriptor)) return "notes";
  if (/settings/.test(descriptor)) return "settings";
  if (/myfiles|filemanager|\bfiles\b|\bfile\b/.test(descriptor)) return "files";
  if (/calculator|calc/.test(descriptor)) return "calculator";
  if (/smartthings|oneconnect|wearable|continuity|flow|switch/.test(descriptor)) return "connections";
  if (/security|kaspersky|members|tutor|support/.test(descriptor)) return "security";
  if (/kids|home/.test(descriptor)) return "home";
  return "generic";
}

function getFolderPreviewColors(item) {
  const folderApps = Array.isArray(item && item.data && item.data.apps)
    ? item.data.apps
    : Object.values((item && item.data && item.data.apps) || {});
  const fallback = ["#3388FF", "#FDBA74", "#0F9F8A", "#8B5CF6"];

  const colors = folderApps.slice(0, 4).map((entry) => {
    const previewItem = entry && entry.data ? entry : { type: "app", data: entry };
    const iconKey = resolveUnifiedIconKey(previewItem);
    const paletteKey = ICON_PALETTE_BY_KEY[iconKey] || "sky";
    return (ICON_PALETTES[paletteKey] || ICON_PALETTES.sky).solid;
  });

  return [...colors, ...fallback].slice(0, 4);
}

function buildUnifiedIconSvg(iconKey, item) {
  const folderColors = iconKey === "folder" ? getFolderPreviewColors(item) : [];
  const body = (() => {
    switch (iconKey) {
      case "assistant":
        return `
          <path d="M12 5.3 13.6 9l3.7 1.6-3.7 1.6-1.6 3.7-1.6-3.7L6.7 10.6 10.4 9 12 5.3Z" class="icon-outline" />
          <circle cx="17.5" cy="6.8" r="1.15" class="icon-accent" />
          <circle cx="7.2" cy="17.2" r=".95" class="icon-accent-soft" />
        `;
      case "browser":
        return `
          <circle cx="12" cy="12" r="7.25" class="icon-outline" />
          <path d="M4.9 9.4h14.2M4.9 14.6h14.2" class="icon-outline" />
          <path d="M12 4.8c2.25 2.03 3.55 4.5 3.55 7.2S14.25 17.17 12 19.2c-2.25-2.03-3.55-4.5-3.55-7.2S9.75 6.83 12 4.8Z" class="icon-outline" />
        `;
      case "calculator":
        return `
          <rect x="5.4" y="4.9" width="13.2" height="14.2" rx="3.6" class="icon-outline" />
          <path d="M8.2 8.7h7.6" class="icon-outline" />
          <rect x="8.1" y="11.4" width="2.25" height="2.25" rx=".7" class="icon-accent" />
          <rect x="11.9" y="11.4" width="2.25" height="2.25" rx=".7" class="icon-accent-soft" />
          <rect x="8.1" y="15" width="2.25" height="2.25" rx=".7" class="icon-accent-soft" />
          <rect x="11.9" y="15" width="5.1" height="2.25" rx=".7" class="icon-accent" />
        `;
      case "calendar":
        return `
          <rect x="5" y="6.1" width="14" height="12.1" rx="3.4" class="icon-outline" />
          <path d="M8.4 4.8v3M15.6 4.8v3M5 9.8h14" class="icon-outline" />
          <rect x="8" y="12.1" width="3.1" height="3.1" rx="1" class="icon-accent" />
          <rect x="12.8" y="12.1" width="3.1" height="3.1" rx="1" class="icon-accent-soft" />
        `;
      case "camera":
        return `
          <path d="M8 7.1h2.3l1.05-1.9h3.3l1.05 1.9H16a3.2 3.2 0 0 1 3.2 3.2v4.9A3.2 3.2 0 0 1 16 18.4H8A3.2 3.2 0 0 1 4.8 15.2v-4.9A3.2 3.2 0 0 1 8 7.1Z" class="icon-outline" />
          <circle cx="12" cy="12.6" r="3.2" class="icon-outline" />
          <circle cx="16.6" cy="9.8" r="1.05" class="icon-accent" />
        `;
      case "cloud":
        return `
          <path d="M8.2 17.1h8a3.2 3.2 0 0 0 .35-6.39 4.6 4.6 0 0 0-8.9-.82 3 3 0 0 0 .55 6.01Z" class="icon-outline" />
          <path d="M12 10.7v5M9.8 13.5 12 15.7l2.2-2.2" class="icon-accent-stroke" />
        `;
      case "connections":
        return `
          <circle cx="7.8" cy="12" r="2.1" class="icon-accent" />
          <circle cx="16.2" cy="8" r="2" class="icon-accent-soft" />
          <circle cx="16.4" cy="16.1" r="2.2" class="icon-accent" />
          <path d="M9.8 11 14.2 8.9M9.8 13l4.7 2.4M16.2 10.2v3.5" class="icon-outline" />
        `;
      case "contacts":
        return `
          <circle cx="12" cy="9.2" r="2.9" class="icon-outline" />
          <path d="M6.5 17.1c.95-2.5 3.02-3.85 5.5-3.85s4.55 1.35 5.5 3.85" class="icon-outline" />
          <circle cx="17.6" cy="8.6" r="1.2" class="icon-accent" />
        `;
      case "files":
        return `
          <path d="M8 5.2h5.75l2.95 2.95v9.05A1.8 1.8 0 0 1 14.9 19H8A1.8 1.8 0 0 1 6.2 17.2V7A1.8 1.8 0 0 1 8 5.2Z" class="icon-outline" />
          <path d="M13.75 5.2v3h2.95M8.9 11.9h6.2M8.9 14.8h4.2" class="icon-outline" />
        `;
      case "folder":
        return `
          <path d="M4.1 8.5h4.75l1.65-2.1h6.15a2.05 2.05 0 0 1 2.05 2.05v7.05a2.1 2.1 0 0 1-2.1 2.1H6.2a2.1 2.1 0 0 1-2.1-2.1V8.7c0-.11.09-.2.2-.2Z" class="icon-outline" />
          <rect x="7.1" y="11.1" width="2.45" height="2.45" rx=".82" fill="${folderColors[0]}" />
          <rect x="10.95" y="11.1" width="2.45" height="2.45" rx=".82" fill="${folderColors[1]}" />
          <rect x="7.1" y="14.95" width="2.45" height="2.45" rx=".82" fill="${folderColors[2]}" />
          <rect x="10.95" y="14.95" width="2.45" height="2.45" rx=".82" fill="${folderColors[3]}" />
        `;
      case "gallery":
        return `
          <rect x="5.1" y="6" width="13.8" height="12" rx="3.1" class="icon-outline" />
          <path d="m7.7 15 3.1-3.1 2.3 2.3 2.7-3 2.4 3.8" class="icon-outline" />
          <circle cx="9.1" cy="9.3" r="1.05" class="icon-accent" />
        `;
      case "health":
        return `
          <path d="M12 18 6.35 12.98c-1.8-1.6-2.05-4.35-.57-6.14a4.2 4.2 0 0 1 5.86-.56l.36.31.36-.31a4.2 4.2 0 0 1 5.86.56c1.48 1.79 1.23 4.54-.57 6.14L12 18Z" class="icon-outline" />
          <path d="M8.3 12.2h2.1l1.2-2.2 1.45 3.9 1.05-1.7h1.65" class="icon-accent-stroke" />
        `;
      case "home":
        return `
          <path d="m6.2 10.3 5.8-4.8 5.8 4.8v6.5a1.8 1.8 0 0 1-1.8 1.8h-2.75v-4.2h-2.5v4.2H8a1.8 1.8 0 0 1-1.8-1.8v-6.5Z" class="icon-outline" />
          <path d="M9.6 11.7h4.8" class="icon-accent-stroke" />
        `;
      case "mail":
        return `
          <rect x="4.9" y="7" width="14.2" height="10" rx="2.9" class="icon-outline" />
          <path d="m5.8 8.8 6.2 4.5 6.2-4.5M6.7 15.8l4-3.4M17.3 15.8l-4-3.4" class="icon-outline" />
        `;
      case "maps":
        return `
          <path d="M12 18.9c-3.02-3.76-4.55-6.33-4.55-8.2a4.55 4.55 0 1 1 9.1 0c0 1.87-1.53 4.44-4.55 8.2Z" class="icon-outline" />
          <circle cx="12" cy="10.6" r="1.75" class="icon-accent" />
          <path d="M6.5 18.1c1.55-.95 3.4-1.45 5.5-1.45s3.95.5 5.5 1.45" class="icon-accent-stroke" />
        `;
      case "message":
        return `
          <path d="M6.2 7.1h11.1a2.7 2.7 0 0 1 2.7 2.7v5a2.7 2.7 0 0 1-2.7 2.7h-5.55l-3.95 2.7v-2.7H6.2a2.7 2.7 0 0 1-2.7-2.7v-5a2.7 2.7 0 0 1 2.7-2.7Z" class="icon-outline" />
          <path d="M8.2 11.3h7.6M8.2 14h4.9" class="icon-outline" />
        `;
      case "mic":
        return `
          <path d="M12 5.4a2.9 2.9 0 0 1 2.9 2.9v3.15a2.9 2.9 0 1 1-5.8 0V8.3A2.9 2.9 0 0 1 12 5.4Z" class="icon-outline" />
          <path d="M7.9 10.9a4.1 4.1 0 0 0 8.2 0M12 15v3.3M9 18.3h6" class="icon-outline" />
          <circle cx="15.8" cy="8.1" r="1" class="icon-accent" />
        `;
      case "music":
        return `
          <path d="M14.4 6v8.3a2.15 2.15 0 1 1-1.7-2.1V8.2l4.95-1.4v6.15a2.15 2.15 0 1 1-1.7-2.1V5.4l-1.55.6Z" class="icon-outline" />
          <circle cx="9" cy="14.9" r="1.65" class="icon-accent" />
        `;
      case "notes":
        return `
          <path d="M7.5 5.3h7.3l3.1 3.1v9.1A1.8 1.8 0 0 1 16.1 19.3H7.5a1.8 1.8 0 0 1-1.8-1.8V7.1a1.8 1.8 0 0 1 1.8-1.8Z" class="icon-outline" />
          <path d="M14.8 5.3v3.1h3.1M8.7 11.3h6M8.7 14h4.2" class="icon-outline" />
          <path d="m9.1 17.1 2.65-2.65" class="icon-accent-stroke" />
        `;
      case "phone":
        return `
          <path d="M7.1 5.7c.4-.78 1.3-1.16 2.13-.92l1.65.48c.86.25 1.43 1.04 1.35 1.93l-.17 1.63c-.07.65-.49 1.2-1.1 1.43l-.72.27a11.3 11.3 0 0 0 3.95 3.95l.27-.72c.23-.61.78-1.03 1.43-1.1l1.63-.17c.89-.08 1.68.49 1.93 1.35l.48 1.65c.24.83-.14 1.73-.92 2.13l-1.07.55c-.84.43-1.82.54-2.74.29a15 15 0 0 1-9.1-9.1c-.25-.92-.14-1.9.29-2.74l.55-1.07Z" class="icon-outline" />
        `;
      case "search":
        return `
          <circle cx="11" cy="11" r="4.7" class="icon-outline" />
          <path d="m14.4 14.4 4.1 4.1" class="icon-outline" />
          <circle cx="11" cy="11" r="1.2" class="icon-accent" />
        `;
      case "security":
        return `
          <path d="M12 4.9 17.7 7v4.6c0 3.18-1.94 5.6-5.7 7.25C8.24 17.2 6.3 14.78 6.3 11.6V7l5.7-2.1Z" class="icon-outline" />
          <path d="m9.6 12 1.6 1.6 3.3-3.3" class="icon-accent-stroke" />
        `;
      case "settings":
        return `
          <circle cx="12" cy="12" r="2.9" class="icon-outline" />
          <path d="M12 5.1v1.8M12 17.1v1.8M18.9 12h-1.8M6.9 12H5.1M16.9 7.1l-1.3 1.3M8.4 15.6l-1.3 1.3M16.9 16.9l-1.3-1.3M8.4 8.4 7.1 7.1" class="icon-outline" />
          <circle cx="12" cy="12" r="1.05" class="icon-accent" />
        `;
      case "store":
        return `
          <path d="M7.1 8.5h9.8l-1.1 8.6H8.2L7.1 8.5Z" class="icon-outline" />
          <path d="M8.4 8.5v-.8a3.6 3.6 0 0 1 7.2 0v.8M9.6 12.3h4.8" class="icon-outline" />
          <circle cx="12" cy="15.1" r="1.1" class="icon-accent" />
        `;
      case "video":
        return `
          <rect x="5" y="7" width="14" height="10" rx="3.1" class="icon-outline" />
          <path d="m10.1 10 5 2.5-5 2.5V10Z" class="icon-accent" />
        `;
      case "wallet":
        return `
          <path d="M6.5 8.3H17a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H7.2a2 2 0 0 1-2-2V9.8a1.5 1.5 0 0 1 1.3-1.5Z" class="icon-outline" />
          <path d="M6.9 8.3V7.1a1.8 1.8 0 0 1 1.8-1.8H16" class="icon-outline" />
          <rect x="13.2" y="11" width="4.6" height="3.5" rx="1.3" class="icon-accent" />
          <circle cx="15" cy="12.75" r=".7" fill="var(--icon-stroke)" />
        `;
      case "weather":
        return `
          <circle cx="8.8" cy="9" r="2.2" class="icon-accent" />
          <path d="M8.8 5.3v1.3M5.4 8.7h1.3M11.2 6.4l-.9.9" class="icon-accent-stroke" />
          <path d="M8.6 16.8h8.1a2.8 2.8 0 0 0 .28-5.58 4.15 4.15 0 0 0-8.03-.84 3.02 3.02 0 0 0-.42 6.04H8.6Z" class="icon-outline" />
        `;
      case "widget":
        return `
          <rect x="4.9" y="5.8" width="14.2" height="12.4" rx="3.6" class="icon-outline" />
          <path d="M4.9 10.1h14.2" class="icon-outline" />
          <rect x="7.2" y="12.3" width="3.6" height="3.1" rx="1.05" class="icon-accent" />
          <rect x="12.1" y="12.3" width="4.7" height="3.1" rx="1.05" class="icon-accent-soft" />
          <circle cx="8.4" cy="8" r=".8" class="icon-accent" />
          <circle cx="11.3" cy="8" r=".8" class="icon-accent-soft" />
        `;
      case "clock":
        return `
          <circle cx="12" cy="12" r="7.15" class="icon-outline" />
          <path d="M12 8.2v4.1l2.85 1.8" class="icon-outline" />
          <circle cx="12" cy="12" r="1.05" class="icon-accent" />
        `;
      default:
        return `
          <rect x="5.2" y="5.2" width="13.6" height="13.6" rx="4" class="icon-outline" />
          <rect x="8" y="8" width="2.7" height="2.7" rx=".85" class="icon-accent" />
          <rect x="13.3" y="8" width="2.7" height="2.7" rx=".85" class="icon-accent-soft" />
          <rect x="8" y="13.3" width="2.7" height="2.7" rx=".85" class="icon-accent-soft" />
          <rect x="13.3" y="13.3" width="2.7" height="2.7" rx=".85" class="icon-accent" />
        `;
    }
  })();

  return `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      ${body}
    </svg>
  `;
}

function createUnifiedIcon(item) {
  const iconKey = resolveUnifiedIconKey(item);
  const paletteKey = ICON_PALETTE_BY_KEY[iconKey] || "sky";
  const palette = ICON_PALETTES[paletteKey] || ICON_PALETTES.sky;

  const iconContainer = document.createElement("div");
  iconContainer.className = `app-icon ${item.type}`;
  iconContainer.dataset.iconKey = iconKey;
  iconContainer.style.setProperty("--icon-soft", palette.soft);
  iconContainer.style.setProperty("--icon-wash", palette.wash);
  iconContainer.style.setProperty("--icon-solid", palette.solid);
  iconContainer.style.setProperty("--icon-muted", palette.muted);
  iconContainer.style.setProperty("--icon-stroke", palette.stroke);
  iconContainer.style.setProperty("--icon-shadow", palette.shadow);
  iconContainer.innerHTML = buildUnifiedIconSvg(iconKey, item);
  return iconContainer;
}

function createItemNameLabel(item) {
  const nameLabel = document.createElement("div");
  nameLabel.className = "app-name";
  nameLabel.textContent = getDisplayName(item);
  nameLabel.draggable = false;
  return nameLabel;
}

function createWidgetPreviewSegment(className) {
  const segment = document.createElement("span");
  segment.className = `widget-preview-segment ${className}`;
  return segment;
}

function createWidgetPreview(item) {
  const spanX = Math.max(1, Number(item.data && item.data.spanX) || 1);
  const spanY = Math.max(1, Number(item.data && item.data.spanY) || 1);
  const preview = document.createElement("div");
  preview.className = "widget-preview";

  const topRow = document.createElement("div");
  topRow.className = "widget-preview-row";
  topRow.append(
    createWidgetPreviewSegment("chip"),
    createWidgetPreviewSegment(
      `line ${spanX >= 4 ? "long" : spanX >= 3 ? "medium" : "short"}`,
    ),
  );
  preview.appendChild(topRow);

  const cardsRow = document.createElement("div");
  cardsRow.className = "widget-preview-row cards";
  const cardCount = spanX >= 4 ? 3 : 2;
  for (let index = 0; index < cardCount; index++) {
    cardsRow.appendChild(
      createWidgetPreviewSegment(index === 0 ? "card strong" : "card"),
    );
  }
  preview.appendChild(cardsRow);

  if (spanY > 1) {
    const bottomRow = document.createElement("div");
    bottomRow.className = "widget-preview-row";
    bottomRow.append(
      createWidgetPreviewSegment("line medium"),
      createWidgetPreviewSegment("line short"),
    );
    preview.appendChild(bottomRow);
  }

  return preview;
}

function createWidgetVisuals(item) {
  const shell = document.createElement("div");
  shell.className = "widget-shell";

  const head = document.createElement("div");
  head.className = "widget-head";

  const icon = createUnifiedIcon(item);
  icon.classList.add("widget-symbol");

  const copy = document.createElement("div");
  copy.className = "widget-copy";

  const eyebrow = document.createElement("div");
  eyebrow.className = "widget-eyebrow";
  eyebrow.textContent = getWidgetEyebrow(item);

  const title = createItemNameLabel(item);
  title.classList.add("widget-title");

  const meta = document.createElement("div");
  meta.className = "widget-meta";
  meta.textContent = getWidgetMetaText(item);

  copy.append(eyebrow, title, meta);
  head.append(icon, copy);
  shell.appendChild(head);

  const spanX = Math.max(1, Number(item.data && item.data.spanX) || 1);
  const spanY = Math.max(1, Number(item.data && item.data.spanY) || 1);
  if (spanY > 1 || spanX >= 3) {
    shell.appendChild(createWidgetPreview(item));
  }

  return shell;
}

function createItemBadge(item) {
  if (!item || item.type !== "appwidget") return null;
  const spanX = Math.max(1, Number(item.data && item.data.spanX) || 1);
  const spanY = Math.max(1, Number(item.data && item.data.spanY) || 1);
  const badge = document.createElement("span");
  badge.className = "item-badge widget-grid-badge";
  badge.textContent = `${spanX}\u00D7${spanY}`;
  badge.setAttribute("aria-hidden", "true");
  badge.title = `Grid ${spanX}\u00D7${spanY}`;
  return badge;
}

function appendItemVisuals(appItem, item, options = {}) {
  if (options.compact) {
    appItem.classList.add("compact-card");
  }

  if (item.type === "appwidget") {
    const spanX = Math.max(1, Number(item.data && item.data.spanX) || 1);
    const spanY = Math.max(1, Number(item.data && item.data.spanY) || 1);
    appItem.classList.add(`widget-span-${spanX}x${spanY}`);
    if (spanY === 1) {
      appItem.classList.add("widget-single-row");
    }
    if (spanY === 1 && spanX < 3) {
      appItem.classList.add("widget-previewless");
    }
    appItem.appendChild(createWidgetVisuals(item));
  } else {
    appItem.appendChild(createUnifiedIcon(item));
    appItem.appendChild(createItemNameLabel(item));
  }

  const badge = createItemBadge(item);
  if (badge) {
    appItem.appendChild(badge);
  }
}

// ============================================================
// TOAST NOTIFICATION FUNCTION
// ============================================================

// Show toast notification
function showToast(message, type = "error") {
  const toastContainer = document.getElementById("toast-container");
  if (!toastContainer) {
    console.error("Toast container not found");
    return;
  }

  // Create toast element
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  // Create toast content
  const content = document.createElement("div");
  content.className = "toast-content";
  content.textContent = message;

  // Create close button
  const closeButton = document.createElement("button");
  closeButton.className = "toast-close";
  closeButton.innerHTML = "&times;";
  closeButton.onclick = function () {
    removeToast(toast);
  };

  // Assemble toast
  toast.appendChild(content);
  toast.appendChild(closeButton);

  // Add to container
  toastContainer.appendChild(toast);

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    removeToast(toast);
  }, 4000);
}

// Remove toast with animation
function removeToast(toast) {
  if (!toast || !toast.parentNode) return;

  // Add removing class for fade-out animation
  toast.classList.add("removing");

  // Remove from DOM after animation completes
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

// DOM elements
let appGrid = null;
let xmlContent = null;
let pageInfo = null;
let prevPageBtn = null;
let nextPageBtn = null;
let layoutSelect = null;
let modeSelect = null; // New mode selector
let saveChangesBtn = null;
let resetLayoutBtn = null;
let toggleXmlBtn = null;
let refreshXmlBtn = null;
let saveXmlBtn = null;
let xmlPanel = null;
let xmlEditorState = null;
let folderModal = null;
let folderGrid = null;
let folderTitle = null;
let folderPageInfo = null;
let folderPrevBtn = null;
let folderNextBtn = null;
let folderSaveBtn = null;
let folderAddAppBtn = null;
let folderUndoBtn = null;
let folderRedoBtn = null;
let folderResetBtn = null;
let folderItemCount = null;
let folderCapacityPill = null;
let folderWarningPill = null;
let headerModePill = null;
let headerGridPill = null;
let headerStatePill = null;
let workspaceHeading = null;
let workspaceSubtitle = null;
let metricItems = null;
let metricItemsDetail = null;
let metricPages = null;
let metricPagesDetail = null;
let metricLayout = null;
let metricLayoutDetail = null;
let metricXml = null;
let metricXmlDetail = null;
let sidebarContextTitle = null;
let sidebarContextCopy = null;
let stageTitle = null;
let stagePageBadge = null;
let stageXmlBadge = null;
let deviceGridReadout = null;
let workspacePageStrip = null;
let cartPanel = null;
let cartDropZone = null;
let cartItemsContainer = null;
let cartCountPill = null;
let movePageModal = null;
let movePageMessage = null;
let movePageScreenInput = null;
let xmlEditorDirty = false;
let xmlEditorLastSyncedText = "";
let isSyncingXMLContent = false;

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  Promise.allSettled([
    reloadLayoutCatalog({ silent: true }),
  ])
    .then(([layoutDataResult]) => {
      if (layoutDataResult.status === "fulfilled" && layoutDataResult.value) {
        console.log("Layout catalog loaded successfully");
      } else if (layoutDataResult.status === "rejected") {
        console.error("Error loading layout catalog:", layoutDataResult.reason);
      }
    })
    .finally(() => {
      // Get DOM elements
      appGrid = document.getElementById("app-grid");
      xmlContent = document.getElementById("xml-content");
      pageInfo = document.getElementById("page-info");
      prevPageBtn = document.getElementById("prev-page-btn");
      nextPageBtn = document.getElementById("next-page-btn");
      layoutSelect = document.getElementById("layout-select");
      saveChangesBtn = document.getElementById("save-changes-btn");
      resetLayoutBtn = document.getElementById("reset-layout-btn");
      toggleXmlBtn = document.getElementById("toggle-xml-btn");
      refreshXmlBtn = document.getElementById("refresh-xml-btn");
      saveXmlBtn = document.getElementById("save-xml-btn");
      xmlPanel = document.getElementById("xml-panel");
      xmlEditorState = document.getElementById("xml-editor-state");
      folderModal = document.getElementById("folder-modal");
      folderGrid = document.getElementById("folder-grid");
      folderTitle = document.getElementById("folder-title");
      folderPageInfo = document.getElementById("folder-page-info");
      folderPrevBtn = document.getElementById("folder-prev-btn");
      folderNextBtn = document.getElementById("folder-next-btn");
      folderSaveBtn = document.getElementById("folder-save-btn");
      folderAddAppBtn = document.getElementById("folder-add-app-btn");
      folderUndoBtn = document.getElementById("folder-undo-btn");
      folderRedoBtn = document.getElementById("folder-redo-btn");
      folderResetBtn = document.getElementById("folder-reset-btn");
      folderItemCount = document.getElementById("folder-item-count");
      folderCapacityPill = document.getElementById("folder-capacity-pill");
      folderWarningPill = document.getElementById("folder-warning-pill");
      headerModePill = document.getElementById("header-mode-pill");
      headerGridPill = document.getElementById("header-grid-pill");
      headerStatePill = document.getElementById("header-state-pill");
      workspaceHeading = document.getElementById("workspace-heading");
      workspaceSubtitle = document.getElementById("workspace-subtitle");
      metricItems = document.getElementById("metric-items");
      metricItemsDetail = document.getElementById("metric-items-detail");
      metricPages = document.getElementById("metric-pages");
      metricPagesDetail = document.getElementById("metric-pages-detail");
      metricLayout = document.getElementById("metric-layout");
      metricLayoutDetail = document.getElementById("metric-layout-detail");
      metricXml = document.getElementById("metric-xml");
      metricXmlDetail = document.getElementById("metric-xml-detail");
      sidebarContextTitle = document.getElementById("sidebar-context-title");
      sidebarContextCopy = document.getElementById("sidebar-context-copy");
      stageTitle = document.getElementById("stage-title");
      stagePageBadge = document.getElementById("stage-page-badge");
      stageXmlBadge = document.getElementById("stage-xml-badge");
      deviceGridReadout = document.getElementById("device-grid-readout");
      cartPanel = document.getElementById("cart-panel");
      cartDropZone = document.getElementById("cart-drop-zone");
      cartItemsContainer = document.getElementById("cart-items");
      cartCountPill = document.getElementById("cart-count-pill");
      movePageModal = document.getElementById("move-page-modal");
      movePageMessage = document.getElementById("move-page-message");
      movePageScreenInput = document.getElementById("move-page-screen-input");

      // Set up event listeners
      setupEventListeners();
      updatePublicRequestFormVisibility();
      renderPublicRequestSelectedApp();
      renderPublicRequestBoard();
      void loadPublicRequestBoard({ silent: true });

      // Restore the browser session from the server when available, otherwise use local storage.
      void loadInitialXMLData().catch((error) => {
        console.error("Unable to initialize editor session:", error);
        loadXMLData({ preferSavedSession: false });
      });

      // Note: updateUI() and refreshXMLViewer() are called inside the load/restore flow.
    });
});

// Set up event listeners
function setupEventListeners() {
  if (DEBUG) console.log("Setting up event listeners...");

  // Mode selection
  modeSelect = document.getElementById("mode-select");
  modeSelect.addEventListener("change", changeMode);

  layoutSelect.addEventListener("change", changeLayout);
  const applyCustomBtn = document.getElementById("apply-custom-grid");
  if (applyCustomBtn) {
    applyCustomBtn.addEventListener("click", applyCustomGridLayout);
  }
  syncCustomGridInputsFromState();
  syncCustomGridPanelVisibility();

  // Grid lines toggle
  const gridLinesToggle = document.getElementById("grid-lines-toggle");
  if (gridLinesToggle) {
    gridLinesToggle.addEventListener("change", function () {
      showGridLines = this.checked;
      updateUI();
      schedulePersistCurrentSession();
    });
  }
  bindWorkspaceGridDnDOnce();
  document.querySelectorAll("[data-canvas-page-mode]").forEach((button) => {
    button.addEventListener("click", function () {
      setCanvasPageMode(this.dataset.canvasPageMode || "auto");
    });
  });
  syncCanvasPageModeButtons();

  // Pagination
  if (!prevPageBtn || !nextPageBtn) {
    console.error("ERROR: Pagination buttons not found!");
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", function () {
      prevPage();
    });
    prevPageBtn.addEventListener("dragover", handleWorkspacePaginationButtonDragOver);
    prevPageBtn.addEventListener("dragleave", handleWorkspacePaginationButtonDragLeave);
    prevPageBtn.addEventListener("drop", handleWorkspacePaginationButtonDrop);
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", function () {
      nextPage();
    });
    nextPageBtn.addEventListener("dragover", handleWorkspacePaginationButtonDragOver);
    nextPageBtn.addEventListener("dragleave", handleWorkspacePaginationButtonDragLeave);
    nextPageBtn.addEventListener("drop", handleWorkspacePaginationButtonDrop);
  }

  // Buttons
  document
    .getElementById("load-xml-btn")
    .addEventListener("click", function () {
      document.getElementById("xml-file-input").click();
    });
  document
    .getElementById("paste-xml-btn")
    .addEventListener("click", openPasteXMLModal);
  const layoutGenOpenButton = document.getElementById("layout-gen-open-btn");
  layoutGenOpenButton?.addEventListener("click", openLayoutGenModal);

  document
    .getElementById("xml-file-input")
    .addEventListener("change", handleXMLFileSelect);
  const updateUiBtn = document.getElementById("update-ui-btn");
  if (updateUiBtn) {
    updateUiBtn.addEventListener("click", updateUI);
  }
  saveChangesBtn.addEventListener("click", saveChanges);
  resetLayoutBtn.addEventListener("click", resetLayout);
  document
    .getElementById("export-xml-btn")
    .addEventListener("click", exportXML);
  document
    .getElementById("compare-xml-btn")
    ?.addEventListener("click", openCompareXMLModal);
  const xmlTextBtn = document.getElementById("xml-text-btn");
  if (xmlTextBtn) {
    xmlTextBtn.addEventListener("click", openRawXMLModal);
  }
  toggleXmlBtn.addEventListener("click", toggleXMLViewer);
  refreshXmlBtn.addEventListener("click", function () {
    refreshXMLViewer({ force: true });
    showToast("XML editor reset to the current layout", "success");
  });
  if (saveXmlBtn) {
    saveXmlBtn.addEventListener("click", saveXMLEditorChanges);
  }
  document
    .getElementById("copy-xml-btn")
    .addEventListener("click", copyCurrentXMLToClipboard);
  if (xmlContent) {
    xmlContent.addEventListener("input", handleXMLContentInput);
    xmlContent.addEventListener("keydown", handleXMLContentKeydown);
  }

  // Folder modal
  document.querySelector(".folder-close").addEventListener("click", closeFolderModal);
  window.addEventListener("click", function (event) {
    if (event.target === folderModal) {
      closeFolderModal();
    }
    if (event.target === document.getElementById("paste-xml-modal")) {
      closePasteXMLModal();
    }
    if (event.target === document.getElementById("raw-xml-modal")) {
      closeRawXMLModal();
    }
    if (event.target === document.getElementById("guide-modal")) {
      closeGuideModal();
    }
    if (event.target === document.getElementById("help-modal")) {
      closeHelpModal();
    }
    if (event.target === document.getElementById("request-board-modal")) {
      closeRequestBoardModal();
    }
    if (event.target === document.getElementById("access-control-modal")) {
      closeAccessControlModal();
    }
    if (event.target === document.getElementById("activity-modal")) {
      closeActivityModal();
    }
    if (event.target === document.getElementById("compare-xml-modal")) {
      closeCompareXMLModal();
    }
    if (event.target === document.getElementById("folder-drop-choice-modal")) {
      cancelFolderDropChoice();
    }
    if (event.target === movePageModal) {
      closeMoveToPageModal();
    }
  });
  window.addEventListener("beforeunload", function () {
    persistCurrentSessionNow({ beforeUnload: true });
  });

  // Folder pagination
  folderPrevBtn.addEventListener("click", folderPrevPage);
  folderNextBtn.addEventListener("click", folderNextPage);

  // Folder buttons
  folderSaveBtn.addEventListener("click", saveFolderChanges);
  if (folderAddAppBtn) {
    folderAddAppBtn.addEventListener("click", function () {
      const context = buildCurrentFolderAddContext();
      if (context) {
        openAddAppModal(context);
      }
    });
  }
  folderResetBtn.addEventListener("click", resetFolderLayout);
  folderUndoBtn?.addEventListener("click", undoFolderHistory);
  folderRedoBtn?.addEventListener("click", redoFolderHistory);

  // Add App button
  document
    .getElementById("add-app-btn")
    .addEventListener("click", function () {
      openAddAppModal();
    });
  document
    .querySelector(".add-app-close")
    .addEventListener("click", closeAddAppModal);
  document
    .getElementById("cancel-add-app")
    .addEventListener("click", closeAddAppModal);
  document
    .getElementById("confirm-add-app")
    .addEventListener("click", confirmAddApp);
  document
    .querySelector(".paste-xml-close")
    .addEventListener("click", closePasteXMLModal);
  document
    .getElementById("cancel-paste-xml")
    .addEventListener("click", closePasteXMLModal);
  document
    .getElementById("confirm-paste-xml")
    .addEventListener("click", importPastedXML);
  document
    .getElementById("paste-xml-input")
    .addEventListener("keydown", function (event) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        importPastedXML();
      }
    });
  document
    .querySelector(".raw-xml-close")
    .addEventListener("click", closeRawXMLModal);
  document
    .getElementById("cancel-raw-xml")
    .addEventListener("click", closeRawXMLModal);
  document
    .getElementById("copy-raw-xml")
    .addEventListener("click", copyCurrentXMLToClipboard);

  const guideBtn = document.getElementById("guide-btn");
  if (guideBtn) {
    guideBtn.addEventListener("click", openGuideModal);
  }
  document.querySelector(".guide-modal-close")?.addEventListener("click", closeGuideModal);
  document.getElementById("close-guide-btn")?.addEventListener("click", closeGuideModal);

  const helpBtn = document.getElementById("help-btn");
  if (helpBtn) {
    helpBtn.addEventListener("click", openHelpModal);
  }
  document.querySelector(".help-modal-close")?.addEventListener("click", closeHelpModal);
  document.getElementById("close-help-btn")?.addEventListener("click", closeHelpModal);

  const requestBoardBtn = document.getElementById("request-board-btn");
  if (requestBoardBtn) {
    requestBoardBtn.addEventListener("click", openRequestBoardModal);
  }
  const accessControlBtn = document.getElementById("access-control-btn");
  if (accessControlBtn) {
    accessControlBtn.addEventListener("click", openAccessControlModal);
  }
  const activityBtn = document.getElementById("activity-btn");
  if (activityBtn) {
    activityBtn.addEventListener("click", openActivityModal);
  }
  document.querySelector(".request-board-close")?.addEventListener("click", closeRequestBoardModal);
  document.querySelector(".access-control-modal-close")?.addEventListener("click", closeAccessControlModal);
  document.getElementById("close-access-control-btn")?.addEventListener("click", closeAccessControlModal);
  document.querySelector(".activity-modal-close")?.addEventListener("click", closeActivityModal);
  document.getElementById("close-activity-btn")?.addEventListener("click", closeActivityModal);
  document
    .getElementById("activity-refresh-btn")
    ?.addEventListener("click", function () {
      void loadServerActivity();
    });
  document
    .getElementById("activity-filter-query")
    ?.addEventListener("input", function () {
      publicRequestBoardState.activityFilters.query = this.value;
      renderServerActivity();
    });
  document
    .getElementById("activity-filter-time")
    ?.addEventListener("change", function () {
      publicRequestBoardState.activityFilters.time = this.value;
      renderServerActivity();
    });
  document
    .getElementById("activity-clear-filters-btn")
    ?.addEventListener("click", function () {
      publicRequestBoardState.activityFilters = { query: "", time: "all" };
      renderServerActivity();
    });
  document
    .getElementById("request-board-form")
    ?.addEventListener("submit", handlePublicRequestBoardSubmit);
  document
    .getElementById("request-board-direct-btn")
    ?.addEventListener("click", handleDirectLayoutWriteSubmit);
  document
    .getElementById("request-type")
    ?.addEventListener("change", updatePublicRequestFormVisibility);
  document
    .getElementById("request-update-field")
    ?.addEventListener("change", updatePublicRequestNewValueMeta);
  document
    .getElementById("request-app-search")
    ?.addEventListener("input", function () {
      const selectedApp = getPublicRequestSelectedApp();
      const selectedLabel = selectedApp ? (selectedApp.comment || selectedApp.packageName) : "";
      if (selectedApp && this.value !== selectedLabel) {
        publicRequestBoardState.selectedAppKey = "";
        renderPublicRequestSelectedApp();
        updatePublicRequestNewValueMeta();
      }
      renderPublicRequestAppSearchResults(this.value);
    });
  document
    .getElementById("request-app-search-results")
    ?.addEventListener("click", handlePublicRequestAppSearchClick);
  document
    .getElementById("request-board-refresh-btn")
    ?.addEventListener("click", function () {
      void loadPublicRequestBoard();
    });
  document
    .getElementById("request-approver-form")
    ?.addEventListener("submit", handleRequestApproverSubmit);
  document
    .getElementById("request-approver-list")
    ?.addEventListener("click", handleRequestApproverListClick);
  document
    .getElementById("request-filter-type")
    ?.addEventListener("change", function () {
      publicRequestBoardState.filters.type = this.value;
      renderPublicRequestBoard();
    });
  document
    .getElementById("request-filter-status")
    ?.addEventListener("change", function () {
      publicRequestBoardState.filters.status = this.value;
      renderPublicRequestBoard();
    });
  document
    .getElementById("request-board-list")
    ?.addEventListener("click", handlePublicRequestBoardListClick);
  document
    .getElementById("request-board-list")
    ?.addEventListener("submit", handlePublicRequestBoardListSubmit);

  // Compare XML modal
  document.querySelector(".compare-xml-close")?.addEventListener("click", handleCompareCloseRequest);
  document.getElementById("close-compare-btn")?.addEventListener("click", closeCompareXMLModal);
  document.getElementById("run-compare-btn")?.addEventListener("click", runXMLCompare);
  document.getElementById("compare-diff-focus-btn")?.addEventListener("click", toggleCompareDiffFocusMode);
  initCompareTabSwitching();

  // Type change handler for dynamic field visibility
  document.getElementById("item-type").addEventListener("change", function () {
    updateModalFieldVisibility();
    syncSearchResultsForCurrentType();
  });
  document.getElementById("item-search").addEventListener("input", function () {
    renderLayoutSearchResults(this.value);
  });
  document
    .getElementById("item-search-results")
    .addEventListener("click", handleLayoutSearchResultClick);

  // Context menu handlers
  document.addEventListener("click", hideContextMenu);
  window.addEventListener("resize", hideContextMenu);
  window.addEventListener("scroll", hideContextMenu, true);
  document.addEventListener("contextmenu", (e) => {
    const target = e.target.closest(
      "#app-grid .app-item, #app-grid .grid-cell-placeholder, #folder-grid .app-item, #folder-grid .grid-cell-placeholder",
    );
    if (target) {
      e.preventDefault();
      showContextMenu(e, target);
    }
  });

  document
    .getElementById("context-menu")
    .addEventListener("click", handleContextMenuAction);

  if (cartDropZone) {
    cartDropZone.addEventListener("dragover", handleCartDragOver);
    cartDropZone.addEventListener("dragleave", handleCartDragLeave);
    cartDropZone.addEventListener("drop", handleCartDrop);
  }

  // Confirmation dialog handlers
  document
    .getElementById("confirm-yes")
    .addEventListener("click", confirmRemove);
  document
    .getElementById("confirm-no")
    .addEventListener("click", hideConfirmDialog);

  document
    .getElementById("folder-drop-swap-btn")
    .addEventListener("click", applyPendingFolderDropSwap);
  document
    .getElementById("folder-drop-merge-btn")
    .addEventListener("click", applyPendingFolderDropMerge);
  document
    .getElementById("folder-drop-cancel-btn")
    .addEventListener("click", cancelFolderDropChoice);
  document
    .getElementById("move-page-confirm")
    .addEventListener("click", confirmMoveToPage);
  document
    .getElementById("move-page-cancel")
    .addEventListener("click", closeMoveToPageModal);
  movePageScreenInput?.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmMoveToPage();
    }
  });

  // ESC key handler for resize cancellation and folder-drop modal
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      const folderDropModal = document.getElementById("folder-drop-choice-modal");
      if (
        folderDropModal &&
        folderDropModal.style.display === "block" &&
        pendingFolderDropChoice
      ) {
        cancelFolderDropChoice();
        return;
      }
      if (movePageModal && movePageModal.style.display === "block") {
        closeMoveToPageModal();
        return;
      }
      const guideModal = document.getElementById("guide-modal");
      if (guideModal && guideModal.style.display === "block") {
        closeGuideModal();
        return;
      }
      const helpModal = document.getElementById("help-modal");
      if (helpModal && helpModal.style.display === "block") {
        closeHelpModal();
        return;
      }
      const requestBoardModal = document.getElementById("request-board-modal");
      if (requestBoardModal && requestBoardModal.style.display === "block") {
        closeRequestBoardModal();
        return;
      }
      const accessControlModal = document.getElementById("access-control-modal");
      if (accessControlModal && accessControlModal.style.display === "block") {
        closeAccessControlModal();
        return;
      }
      const activityModal = document.getElementById("activity-modal");
      if (activityModal && activityModal.style.display === "block") {
        closeActivityModal();
        return;
      }
      const compareModal = document.getElementById("compare-xml-modal");
      if (compareModal && compareModal.style.display === "block") {
        if (closeCompareDiffResult()) {
          return;
        }
        closeCompareXMLModal();
        return;
      }
      if (folderModal && folderModal.style.display === "block") {
        closeFolderModal();
        return;
      }
    }
    if (e.key === "Escape" && resizeState) {
      document.removeEventListener("mousemove", handleResize);
      document.removeEventListener("mouseup", endResize);
      resizeState.element.classList.remove("resizing");
      resizeState.element.classList.remove("resize-invalid");
      resizeState.element.setAttribute("draggable", "true");
      resizeState = null;
      updateUI();
      showToast("Resize cancelled", "error");
    }
  });
}

// Variables for Add/Remove functionality
let addAppModal = null;
let contextMenu = null;
let confirmDialog = null;
let selectedItemForRemoval = null;
let selectedItem = null;
let selectedItemForEdit = null;
let selectedItemForMove = null;

function normalizeCatalogSpan(value, fallback = 1) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function initializeLayoutCatalog(rawData) {
  layoutCatalogLookup = new Map();
  layoutCatalog = {
    app: normalizeCatalogEntries(rawData?.Apps || [], "app"),
    widget: normalizeCatalogEntries(rawData?.Widgets || [], "widget"),
  };
}

function normalizeCatalogEntries(entries, type) {
  const deduped = new Map();

  entries.forEach((entry) => {
    const packageName = String(entry?.PackageName || "").trim();
    const className = String(entry?.ClassName || "").trim();
    if (!packageName || !className) return;

    const key = `${type}|${packageName}|${className}`;
    if (deduped.has(key)) return;

    const normalized = {
      key,
      type,
      packageName,
      className,
      comment: String(entry?.Comment || "").trim(),
      sourcePath: String(entry?.SourcePath || "").trim(),
      spanX: normalizeCatalogSpan(entry?.SpanX, 1),
      spanY: normalizeCatalogSpan(entry?.SpanY, 1),
      span: String(entry?.Span || "").trim(),
    };

    deduped.set(key, normalized);
    layoutCatalogLookup.set(key, normalized);
  });

  return Array.from(deduped.values());
}

async function reloadLayoutCatalog(options = {}) {
  const { silent = false } = options;

  try {
    const response = await fetch(`assets/layout_data.json?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Unable to load layout catalog (${response.status})`);
    }

    const rawData = await response.json();
    initializeLayoutCatalog(rawData);

    if (publicRequestBoardState.selectedAppKey && !getPublicRequestSelectedApp()) {
      publicRequestBoardState.selectedAppKey = "";
    }

    renderPublicRequestSelectedApp();
    updatePublicRequestNewValueMeta();
    return true;
  } catch (error) {
    console.error("Error loading layout catalog:", error);
    if (!silent) {
      showToast(error?.message || "Unable to refresh layout catalog", "error");
    }
    return false;
  }
}

function getLayoutCatalogForType(type) {
  if (type === "widget") return layoutCatalog.widget;
  return layoutCatalog.app;
}

function searchLayoutCatalog(query, type) {
  const trimmed = String(query || "").trim().toLowerCase();
  if (!trimmed) return [];

  return getLayoutCatalogForType(type)
    .filter((entry) => {
      const comment = entry.comment.toLowerCase();
      const packageName = entry.packageName.toLowerCase();
      return comment.includes(trimmed) || packageName.includes(trimmed);
    })
    .sort((left, right) => {
      const leftComment = left.comment.toLowerCase();
      const rightComment = right.comment.toLowerCase();
      const leftStarts =
        leftComment.startsWith(trimmed) || left.packageName.toLowerCase().startsWith(trimmed);
      const rightStarts =
        rightComment.startsWith(trimmed) || right.packageName.toLowerCase().startsWith(trimmed);
      if (leftStarts !== rightStarts) {
        return leftStarts ? -1 : 1;
      }
      return (left.comment || left.packageName).localeCompare(
        right.comment || right.packageName,
      );
    })
    .slice(0, 20);
}

function getAddTargetZone() {
  return addModalContext?.zone || "home";
}

function getSelectedCatalogEntry() {
  const results = document.getElementById("item-search-results");
  const selectedKey = results?.dataset.selectedKey || "";
  return layoutCatalogLookup.get(selectedKey) || null;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const DEFAULT_XML_HEADER = "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>";

function getNodeLocalName(node) {
  return node ? node.localName || node.nodeName || "" : "";
}

function parseXMLDocument(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");
  const rootName = getNodeLocalName(xmlDoc.documentElement);
  const parserError =
    rootName === "parsererror"
      ? xmlDoc.documentElement
      : xmlDoc.getElementsByTagName("parsererror")[0];

  if (parserError) {
    throw new Error(
      (parserError.textContent || "Invalid XML content").trim(),
    );
  }

  return xmlDoc;
}

function extractXMLPreamble(xmlString) {
  const normalized = normalizeXMLLineBreaks(String(xmlString || "")).replace(/^\uFEFF/, "");
  let remainder = normalized.trimStart();
  let xmlHeader = "";
  const xmlComments = [];

  const headerMatch = remainder.match(/^<\?xml[\s\S]*?\?>/i);
  if (headerMatch) {
    xmlHeader = headerMatch[0];
    remainder = remainder.slice(headerMatch[0].length);
  }

  while (true) {
    const commentMatch = remainder.match(/^\s*(<!--[\s\S]*?-->)/);
    if (!commentMatch) break;
    xmlComments.push(commentMatch[1]);
    remainder = remainder.slice(commentMatch[0].length);
  }

  return {
    xmlHeader: xmlHeader || DEFAULT_XML_HEADER,
    xmlComment: xmlComments[0] || "",
    xmlComments,
  };
}

function extractXMLBoundaryComments(xmlDoc) {
  const leadingComments = [];
  const trailingComments = [];
  let sawRoot = false;

  Array.from(xmlDoc?.childNodes || []).forEach((node) => {
    if (node === xmlDoc?.documentElement) {
      sawRoot = true;
      return;
    }

    if (node?.nodeType !== Node.COMMENT_NODE) {
      return;
    }

    if (sawRoot) {
      trailingComments.push(node.nodeValue || node.textContent || "");
      return;
    }

    leadingComments.push(node.nodeValue || node.textContent || "");
  });

  return { leadingComments, trailingComments };
}

function getElementAttributes(element) {
  if (!element?.attributes) return [];
  return Array.from(element.attributes).map((attribute) => [
    attribute.name,
    attribute.value,
  ]);
}

function normalizeGridInfo(gridValue) {
  if (typeof gridValue !== "string") return null;

  const match = gridValue.trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return null;

  const cols = parseInt(match[1], 10);
  const rows = parseInt(match[2], 10);
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
    return null;
  }

  return { cols, rows, normalized: `${cols}x${rows}` };
}

function guessGridFromCount(itemCount) {
  if (!Number.isFinite(itemCount) || itemCount <= 0) return null;

  let cols = Math.ceil(Math.sqrt(itemCount));
  let rows = Math.ceil(itemCount / cols);

  if (rows < cols) {
    cols = rows;
    rows = Math.ceil(itemCount / cols);
  }

  return { cols, rows, normalized: `${cols}x${rows}` };
}

function getChildElementsByName(parent, tagName) {
  return Array.from(parent?.children || []).filter(
    (element) => getNodeLocalName(element) === tagName,
  );
}

function getFirstChildElementByName(parent, tagName) {
  return getChildElementsByName(parent, tagName)[0] || null;
}

function detectAppOrderGrid(root) {
  const topLevelItems = Array.from(root?.children || []).filter((element) => {
    const name = getNodeLocalName(element);
    return name === "folder" || name === "favorite";
  });

  const countsByScreen = new Map();
  topLevelItems.forEach((element) => {
    const screen = element.getAttribute("screen") || "0";
    countsByScreen.set(screen, (countsByScreen.get(screen) || 0) + 1);
  });

  const maxItemsPerScreen = Math.max(0, ...countsByScreen.values());
  return guessGridFromCount(maxItemsPerScreen);
}

function detectWorkspaceGrid(root) {
  const home = getFirstChildElementByName(root, "home");
  const hotseat = getFirstChildElementByName(root, "hotseat");
  const homeItems = Array.from(home?.children || []).filter((element) => {
    const name = getNodeLocalName(element);
    return name === "favorite" || name === "folder" || name === "appwidget";
  });

  let cols = 0;
  let rows = 0;

  homeItems.forEach((element) => {
    const x = parseInt(element.getAttribute("x"), 10);
    const y = parseInt(element.getAttribute("y"), 10);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      return;
    }

    const spanX = Math.max(1, parseInt(element.getAttribute("spanX"), 10) || 1);
    const spanY = Math.max(1, parseInt(element.getAttribute("spanY"), 10) || 1);
    cols = Math.max(cols, x + spanX);
    rows = Math.max(rows, y + spanY);
  });

  const hotseatCols = getChildElementsByName(hotseat, "favorite").length;
  cols = Math.max(cols, hotseatCols);

  if (cols > 0 && rows > 0) {
    return { cols, rows, normalized: `${cols}x${rows}` };
  }

  return guessGridFromCount(homeItems.length);
}

function resolveLayoutPreset(cols, rows) {
  if (cols === LAYOUTS_MAIN.mobile.cols && rows === LAYOUTS_MAIN.mobile.rows) {
    return "mobile";
  }
  if (
    cols === LAYOUTS_MAIN["tablet-6x8"].cols &&
    rows === LAYOUTS_MAIN["tablet-6x8"].rows
  ) {
    return "tablet-6x8";
  }
  if (
    cols === LAYOUTS_MAIN["tablet-6x10"].cols &&
    rows === LAYOUTS_MAIN["tablet-6x10"].rows
  ) {
    return "tablet-6x10";
  }
  if (
    cols === LAYOUTS_MAIN["tablet-8x6"].cols &&
    rows === LAYOUTS_MAIN["tablet-8x6"].rows
  ) {
    return "tablet-8x6";
  }
  if (
    cols === LAYOUTS_MAIN["fold-6x6"].cols &&
    rows === LAYOUTS_MAIN["fold-6x6"].rows
  ) {
    return "fold-6x6";
  }
  return "custom";
}

function detectXMLProfile(xmlString) {
  const xmlDoc = parseXMLDocument(xmlString);
  const root = xmlDoc.documentElement;
  const rootName = getNodeLocalName(root);
  const isAppOrder = rootName === "appOrder";
  const mode = isAppOrder ? "application-order" : "default-workspace";

  const gridInfoElement = Array.from(root.getElementsByTagName("*")).find((element) => {
    const name = getNodeLocalName(element);
    return name === "appsGridInfo" || name === "homeGridInfo";
  });

  const declaredGrid = normalizeGridInfo(
    gridInfoElement?.getAttribute("default") || "",
  );
  const inferredGrid = isAppOrder ? detectAppOrderGrid(root) : detectWorkspaceGrid(root);
  let detectedGrid = declaredGrid;

  if (!detectedGrid) {
    detectedGrid = inferredGrid;
  } else if (!isAppOrder && inferredGrid) {
    detectedGrid = {
      cols: Math.max(declaredGrid.cols, inferredGrid.cols),
      rows: Math.max(declaredGrid.rows, inferredGrid.rows),
      normalized: `${Math.max(declaredGrid.cols, inferredGrid.cols)}x${Math.max(
        declaredGrid.rows,
        inferredGrid.rows,
      )}`,
    };
  }

  if (!detectedGrid) {
    detectedGrid = { cols: 4, rows: 6, normalized: "4x6" };
  }

  return {
    mode,
    cols: detectedGrid.cols,
    rows: detectedGrid.rows,
    gridInfo: detectedGrid.normalized,
    layout: resolveLayoutPreset(detectedGrid.cols, detectedGrid.rows),
  };
}

/** Modal panels with explicit width/height; must not get `.modal-content.tablet` (580px). */
const MODAL_CONTENT_SKIP_TABLET_LAYOUT_CLASS = [
  "request-board-modal-content",
  "activity-modal-content",
  "access-control-modal-content",
  "compare-xml-modal-content",
  "guide-modal-content",
  "layout-gen-modal-content",
];

function syncLayoutClasses() {
  const isTablet = isTabletLayoutKey();

  const gridPanel = document.querySelector(".grid-panel");
  if (gridPanel) {
    gridPanel.classList.toggle("tablet", isTablet);
  }

  document.querySelectorAll(".modal-content").forEach((modalContent) => {
    const skipTablet = MODAL_CONTENT_SKIP_TABLET_LAYOUT_CLASS.some((cls) =>
      modalContent.classList.contains(cls),
    );
    if (skipTablet) {
      modalContent.classList.remove("tablet");
      return;
    }
    modalContent.classList.toggle("tablet", isTablet);
  });
}

function applyDetectedProfile(profile) {
  if (!profile) return;

  applyEditorProfile({
    mode: profile.mode,
    layout: profile.layout,
    customGridLayout: {
      cols: profile.cols,
      homeRows: profile.rows,
    },
  });
}

function resetEditorStateAfterLoad() {
  setUnsavedChanges(false);
  xmlEditorDirty = false;
  currentPage = 0;
  currentFolderPage = 0;
  if (folderModal && folderModal.style.display === "block") {
    closeFolderModal();
  } else {
    currentFolder = null;
  }
  syncXMLPanelChrome();
}

function loadXMLContent(xmlString, options = {}) {
  const { showDetectionToast = false, sourceName = "XML" } = options;
  const profile = detectXMLProfile(xmlString);

  applyDetectedProfile(profile);

  if (profile.mode === "default-workspace") {
    parseWorkspaceXMLData(xmlString);
    virtualWorkspaceBuffer = JSON.parse(JSON.stringify(workspaceData));
  } else {
    parseXMLData(xmlString);
    initializeVirtualBuffer();
  }

  resetEditorStateAfterLoad();
  rememberCommittedProfile({
    mode: profile.mode,
    layout: profile.layout,
    customGridLayout: {
      cols: profile.cols,
      homeRows: profile.rows,
    },
  });
  updateUI();
  refreshXMLViewer();
  notifyDuplicateIssuesIfAny(profile.mode);

  if (showDetectionToast) {
    const modeLabel =
      profile.mode === "default-workspace"
        ? "Default Workspace"
        : "Application Order";
    showToast(
      `${sourceName}: detected ${modeLabel} (${profile.gridInfo})`,
      "success",
    );
  }
}

function openLayoutGenModal() {
  window.LayoutGenModalBridge?.open?.();
}

function closeLayoutGenModal() {
  window.LayoutGenModalBridge?.close?.();
}

function parseLayoutGenXmlToCanvas(xmlText) {
  if (!xmlText || !String(xmlText).trim()) {
    showToast("No XML available to import", "error");
    return;
  }

  try {
    loadXMLContent(xmlText, {
      showDetectionToast: true,
      sourceName: "Layout Generator",
    });
    schedulePersistCurrentSession();
    closeLayoutGenModal();
    showToast("Imported XML into the canvas", "success");
  } catch (error) {
    console.error("Failed to import generated XML:", error);
    showToast("Unable to parse generated XML into canvas", "error");
  }
}

// Load XML data
function loadXMLData(options = {}) {
  const { preferSavedSession = true } = options;

  if (preferSavedSession && restoreModeFromLocalSession(currentMode)) {
    return;
  }

  // Determine which XML file to load based on current mode
  const xmlFile =
    currentMode === "default-workspace"
      ? "default_workspace.xml"
      : "default_application_order.xml";

  console.log(`Loading ${xmlFile} for ${currentMode} mode...`);

  // Fetch the appropriate XML file
  fetch(xmlFile)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.text();
    })
    .then((xmlString) => {
      loadXMLContent(xmlString);
      schedulePersistCurrentSession();
      console.log(`${xmlFile} loaded successfully`);
    })
    .catch((error) => {
      console.error(`Error loading ${xmlFile}:`, error);

      // Fall back to hardcoded data if fetch fails
      if (currentMode === "default-workspace") {
        console.log("Falling back to hardcoded workspace data");
        applyDetectedProfile({
          mode: "default-workspace",
          cols: 4,
          rows: 6,
          gridInfo: "4x6",
          layout: "mobile",
        });
        loadWorkspaceData();
      } else {
        console.log("Falling back to hardcoded application order data");
        applyDetectedProfile({
          mode: "application-order",
          cols: 4,
          rows: 6,
          gridInfo: "4x6",
          layout: "mobile",
        });
        loadHardcodedApplicationOrderData();
      }

      resetEditorStateAfterLoad();
      rememberCommittedProfile();
      updateUI();
      refreshXMLViewer();
      schedulePersistCurrentSession();
    });
}

// Load hardcoded application order data (fallback)
function loadHardcodedApplicationOrderData() {
  xmlData = {
    folders: {
      Samsung: {
        title: "Samsung",
        screen: "0",
        apps: {
          "com.samsung.android.oneconnect": {
            screen: "0",
            "package name": "com.samsung.android.oneconnect",
            class_name: "com.samsung.android.oneconnect.ui.SCMainActivity",
            index: 0,
          },
          "com.sec.android.app.voicenote": {
            screen: "1",
            "package name": "com.sec.android.app.voicenote",
            class_name: "com.sec.android.app.voicenote.main.VNMainActivity",
            index: 1,
          },
          "com.samsung.android.app.contacts": {
            screen: "2",
            "package name": "com.samsung.android.app.contacts",
            class_name:
              "com.samsung.android.app.contacts.contactslist.PeopleActivity",
            index: 2,
          },
          "com.sec.penup": {
            screen: "3",
            "package name": "com.sec.penup",
            class_name: "com.sec.penup.ui.SplashActivity",
            index: 3,
          },
          "com.samsung.ecomm.global.gbr": {
            screen: "4",
            "package name": "com.samsung.ecomm.global.gbr",
            class_name: "com.samsung.ecomm.global.shop_app.MainActivity",
            index: 4,
          },
        },
        index: 0,
      },
      Google: {
        title: "Google",
        screen: "0",
        apps: {
          "com.android.chrome": {
            screen: "1",
            "package name": "com.android.chrome",
            class_name: "com.google.android.apps.chrome.Main",
            index: 0,
          },
          "com.google.android.apps.maps": {
            screen: "2",
            "package name": "com.google.android.apps.maps",
            class_name: "com.google.android.maps.MapsActivity",
            index: 1,
          },
          "com.google.android.gm": {
            screen: "3",
            "package name": "com.google.android.gm",
            class_name: "com.google.android.gm.ConversationListActivityGmail",
            index: 2,
          },
        },
        index: 1,
      },
      Microsoft: {
        title: "Microsoft",
        screen: "0",
        apps: {
          "com.microsoft.skydrive": {
            screen: "0",
            "package name": "com.microsoft.skydrive",
            class_name: "com.microsoft.skydrive.MainActivity",
            index: 0,
          },
          "com.microsoft.office.outlook": {
            screen: "1",
            "package name": "com.microsoft.office.outlook",
            class_name: "com.microsoft.office.outlook.MainActivity",
            index: 1,
          },
        },
        index: 2,
      },
      no_folder: {
        title: "no_folder",
        apps: {
          "com.sec.android.app.samsungapps": {
            screen: "0",
            "package name": "com.sec.android.app.samsungapps",
            class_name:
              "com.sec.android.app.samsungapps.SamsungAppsMainActivity",
            index: 0,
          },
          "com.google.android.apps.googleassistant": {
            screen: "0",
            "package name": "com.google.android.apps.googleassistant",
            class_name:
              "com.google.android.apps.googleassistant.AssistantActivity",
            index: 1,
          },
          "com.samsung.android.dialer": {
            screen: "0",
            "package name": "com.samsung.android.dialer",
            class_name: "com.samsung.android.dialer.DialtactsActivity",
            index: 2,
          },
          "com.sec.android.app.sbrowser": {
            screen: "0",
            "package name": "com.sec.android.app.sbrowser",
            class_name: "com.sec.android.app.sbrowser.SBrowserMainActivity",
            index: 3,
          },
        },
        index: 3,
      },
    },
    xmlHeader: DEFAULT_XML_HEADER,
    xmlComment: "Copyright (C) 2016 The Android Open Source Project...",
    xmlComments: ["Copyright (C) 2016 The Android Open Source Project..."],
    xmlTrailingComments: [],
    rootAttributes: [],
  };

  initializeVirtualBuffer();
}

// Parse Default Workspace XML data
function parseWorkspaceXMLData(xmlString) {
  // Clear existing data
  workspaceData = {
    home: [],
    hotseat: [],
    xmlHeader: "",
    xmlComment: "",
    xmlComments: [],
    xmlTrailingComments: [],
    rootAttributes: [],
  };

  try {
    const preamble = extractXMLPreamble(xmlString);
    // Parse XML string
    const xmlDoc = parseXMLDocument(xmlString);
    const boundaryComments = extractXMLBoundaryComments(xmlDoc);

    workspaceData.xmlHeader = preamble.xmlHeader;
    workspaceData.xmlComment = preamble.xmlComment;
    workspaceData.xmlComments = preamble.xmlComments;
    workspaceData.xmlTrailingComments = boundaryComments.trailingComments;

    // Get favorites element
    const favorites = xmlDoc.documentElement;
    workspaceData.rootAttributes = getElementAttributes(favorites);

    // Process home elements
    const homeElements = favorites.getElementsByTagName("home");
    if (homeElements.length > 0) {
      const home = homeElements[0];

      // Process appwidgets
      const appwidgets = home.getElementsByTagName("appwidget");
      for (let i = 0; i < appwidgets.length; i++) {
        const appwidget = appwidgets[i];
        const x = appwidget.getAttribute("x");
        const y = appwidget.getAttribute("y");

        if (x !== null && y !== null) {
          const hidden = readHiddenAttribute(appwidget);
          workspaceData.home.push({
            type: "appwidget",
            packageName: appwidget.getAttribute("packageName") || "",
            className: appwidget.getAttribute("className") || "",
            x: parseInt(x) || 0,
            y: parseInt(y) || 0,
            spanX: parseInt(appwidget.getAttribute("spanX")) || 1,
            spanY: parseInt(appwidget.getAttribute("spanY")) || 1,
            screen: parseInt(appwidget.getAttribute("screen")) || 0,
            comment: getPrecedingComment(appwidget) || "",
            ...(hidden !== undefined ? { hidden } : {}),
          });
        }
      }

      // Process favorites (apps)
      const standaloneFavorites = home.getElementsByTagName("favorite");
      for (let i = 0; i < standaloneFavorites.length; i++) {
        const favorite = standaloneFavorites[i];
        const x = favorite.getAttribute("x");
        const y = favorite.getAttribute("y");

        if (x !== null && y !== null) {
          const hidden = readHiddenAttribute(favorite);
          workspaceData.home.push({
            type: "app",
            packageName: favorite.getAttribute("packageName") || "",
            className: favorite.getAttribute("className") || "",
            x: parseInt(x) || 0,
            y: parseInt(y) || 0,
            screen: parseInt(favorite.getAttribute("screen")) || 0,
            comment: getPrecedingComment(favorite) || "",
            ...(hidden !== undefined ? { hidden } : {}),
          });
        }
      }

      // Process folders
      const folders = home.getElementsByTagName("folder");
      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        const x = folder.getAttribute("x");
        const y = folder.getAttribute("y");

        if (x !== null && y !== null) {
          const folderHidden = readHiddenAttribute(folder);
          const folderData = {
            type: "folder",
            title: folder.getAttribute("title") || "",
            x: parseInt(x) || 0,
            y: parseInt(y) || 0,
            screen: parseInt(folder.getAttribute("screen")) || 0,
            postPosition: folder.getAttribute("postPosition") === "true",
            apps: [],
            comment: getPrecedingComment(folder) || "",
            ...(folderHidden !== undefined ? { hidden: folderHidden } : {}),
          };

          const folderFavorites = folder.getElementsByTagName("favorite");
          for (let j = 0; j < folderFavorites.length; j++) {
            const favorite = folderFavorites[j];
            const favHidden = readHiddenAttribute(favorite);
            folderData.apps.push({
              packageName: favorite.getAttribute("packageName") || "",
              className: favorite.getAttribute("className") || "",
              screen: parseInt(favorite.getAttribute("screen")) || 0,
              comment: getPrecedingComment(favorite) || "",
              ...(favHidden !== undefined ? { hidden: favHidden } : {}),
            });
          }

          workspaceData.home.push(folderData);
        }
      }
    }

    // Process hotseat elements
    const hotseatElements = favorites.getElementsByTagName("hotseat");
    if (hotseatElements.length > 0) {
      const hotseat = hotseatElements[0];

      const hotseatFavorites = hotseat.getElementsByTagName("favorite");
      for (let i = 0; i < hotseatFavorites.length; i++) {
        const favorite = hotseatFavorites[i];
        const hsHidden = readHiddenAttribute(favorite);
        workspaceData.hotseat.push({
          type: "app",
          packageName: favorite.getAttribute("packageName") || "",
          className: favorite.getAttribute("className") || "",
          screen: parseInt(favorite.getAttribute("screen")) || 0,
          comment: getPrecedingComment(favorite) || "",
          ...(hsHidden !== undefined ? { hidden: hsHidden } : {}),
        });
      }
    }
  } catch (error) {
    console.error("Error parsing workspace XML:", error);
    throw error;
  }

  // Initialize virtual workspace buffer
  virtualWorkspaceBuffer = JSON.parse(JSON.stringify(workspaceData));
}

// Load Default Workspace data
function loadWorkspaceData() {
  // In a real implementation, this would fetch the default_workspace.xml file
  // For now, we'll use a simplified version of the data structure
  // In a production environment, you would use fetch() to load default_workspace.xml

  // Sample data based on the provided default_workspace.xml
  workspaceData = {
    home: [
      // Page 0 (screen=0)
      {
        type: "appwidget",
        packageName: "com.sec.android.daemonapp",
        className: "com.sec.android.daemonapp.appwidget.WeatherAppWidget2x1",
        x: 0,
        y: 2,
        spanX: 2,
        spanY: 2,
        screen: 0,
      },
      {
        type: "appwidget",
        packageName: "com.samsung.android.calendar",
        className: "com.android.calendar.widget.today.TodayWidgetProvider",
        x: 2,
        y: 2,
        spanX: 2,
        spanY: 1,
        screen: 0,
      },
      {
        type: "appwidget",
        packageName: "com.sec.android.app.shealth",
        className:
          "com.samsung.android.app.shealth.tracker.dailyactivity.widget.DaWidgetReceiver",
        x: 2,
        y: 3,
        spanX: 2,
        spanY: 1,
        screen: 0,
      },
      {
        type: "appwidget",
        packageName: "com.android.chrome",
        className:
          "org.chromium.chrome.browser.searchwidget.SearchWidgetProvider",
        x: 0,
        y: 4,
        spanX: 4,
        spanY: 1,
        screen: 0,
      },
      {
        type: "app",
        packageName: "com.sec.android.app.samsungapps",
        className: "com.sec.android.app.samsungapps.SamsungAppsMainActivity",
        x: 0,
        y: 5,
        screen: 0,
      },
      {
        type: "app",
        packageName: "com.android.vending",
        className: "com.android.vending.AssetBrowserActivity",
        x: 1,
        y: 5,
        screen: 0,
      },
      {
        type: "folder",
        title: "Google",
        x: 2,
        y: 5,
        screen: 0,
        postPosition: true,
        apps: [
          {
            packageName: "com.google.android.googlequicksearchbox",
            className: "com.google.android.googlequicksearchbox.SearchActivity",
            screen: 0,
          },
          {
            packageName: "com.android.chrome",
            className: "com.google.android.apps.chrome.Main",
            screen: 1,
          },
          {
            packageName: "com.google.android.gm",
            className: "com.google.android.gm.ConversationListActivityGmail",
            screen: 2,
          },
          {
            packageName: "com.google.android.apps.maps",
            className: "com.google.android.maps.MapsActivity",
            screen: 3,
          },
          {
            packageName: "com.google.android.youtube",
            className:
              "com.google.android.youtube.app.honeycomb.Shell$HomeActivity",
            screen: 4,
          },
          {
            packageName: "com.google.android.apps.docs",
            className: "com.google.android.apps.docs.app.NewMainProxyActivity",
            screen: 5,
          },
          {
            packageName: "com.google.android.apps.youtube.music",
            className:
              "com.google.android.apps.youtube.music.activities.MusicActivity",
            screen: 6,
          },
          {
            packageName: "com.google.android.videos",
            className: "com.google.android.videos.GoogleTvEntryPoint",
            screen: 7,
          },
          {
            packageName: "com.google.android.apps.tachyon",
            className: "com.google.android.apps.tachyon.MainActivity",
            screen: 8,
          },
          {
            packageName: "com.google.android.apps.photos",
            className: "com.google.android.apps.photos.home.HomeActivity",
            screen: 9,
          },
          {
            packageName: "com.google.android.apps.googleassistant",
            className:
              "com.google.android.apps.googleassistant.AssistantActivity",
            screen: 10,
          },
        ],
      },
      {
        type: "folder",
        title: "Зaкон",
        x: 3,
        y: 5,
        screen: 0,
        apps: [
          {
            packageName: "com.yandex.browser",
            className: "com.yandex.browser.YandexBrowserActivity",
            screen: 0,
          },
          {
            packageName: "ru.yandex.yandexmaps",
            className: "ru.yandex.yandexmaps.SplashScreen",
            screen: 1,
          },
          {
            packageName: "ru.dublgis.dgismobile",
            className: "ru.dublgis.dgismobile.GrymMobileActivity",
            screen: 2,
          },
          {
            packageName: "ru.yandex.disk",
            className: "ru.yandex.disk.MainActivity",
            screen: 3,
          },
          {
            packageName: "ru.mail.mailapp",
            className: "ru.mail.mailapp.SplashScreenActivity",
            screen: 4,
          },
          {
            packageName: "com.vk.vkvideo",
            className: "com.vk.video.screens.main.MainActivity",
            screen: 5,
          },
          {
            packageName: "ru.mail.search.electroscope",
            className:
              "ru.mail.search.electroscope.ui.activity.AssistantActivity",
            screen: 6,
          },
        ],
      },
      // Page 1 (screen=1)
      {
        type: "appwidget",
        packageName: "com.yandex.searchapp",
        className: "com.yandex.browser.lite.appwidget.SearchWidgetProvider",
        x: 0,
        y: 0,
        spanX: 4,
        spanY: 1,
        screen: 1,
      },
      {
        type: "app",
        packageName: "com.sec.android.gallery3d",
        className: "com.samsung.android.gallery.app.activity.GalleryActivity",
        x: 2,
        y: 4,
        screen: 1,
      },
      {
        type: "app",
        packageName: "com.sec.android.app.sbrowser",
        className: "com.sec.android.app.sbrowser.SBrowserMainActivity",
        x: 3,
        y: 4,
        screen: 1,
      },
      {
        type: "app",
        packageName: "ru.vk.store",
        className: "ru.vk.store.app.MainActivity",
        x: 0,
        y: 5,
        screen: 1,
      },
      {
        type: "app",
        packageName: "com.samsung.android.calendar",
        className: "com.samsung.android.app.calendar.activity.MainActivity",
        x: 1,
        y: 5,
        screen: 1,
      },
      {
        type: "app",
        packageName: "com.samsung.android.game.gamehome",
        className: "com.samsung.android.game.gamehome.app.MainActivity",
        x: 2,
        y: 5,
        screen: 1,
      },
      {
        type: "app",
        packageName: "com.sec.android.app.clockpackage",
        className: "com.sec.android.app.clockpackage.ClockPackage",
        x: 3,
        y: 5,
        screen: 1,
      },
    ],
    hotseat: [
      {
        type: "app",
        packageName: "com.samsung.android.dialer",
        className: "com.samsung.android.dialer.DialtactsActivity",
        screen: 0,
      },
      {
        type: "app",
        packageName: "com.google.android.apps.messaging",
        className:
          "com.google.android.apps.messaging.ui.ConversationListActivity",
        screen: 1,
      },
      {
        type: "app",
        packageName: "com.yandex.searchapp",
        className: "ru.yandex.searchplugin.MainActivity",
        screen: 2,
      },
      {
        type: "app",
        packageName: "com.sec.android.app.camera",
        className: "com.sec.android.app.camera.Camera",
        screen: 3,
      },
    ],
    xmlHeader: DEFAULT_XML_HEADER,
    xmlComment: "Copyright (C) 2016 The Android Open Source Project...",
    xmlComments: ["Copyright (C) 2016 The Android Open Source Project..."],
    xmlTrailingComments: [],
    rootAttributes: [["xmlns:launcher", LAUNCHER_XML_NAMESPACE]],
  };

  // Initialize virtual workspace buffer
  virtualWorkspaceBuffer = JSON.parse(JSON.stringify(workspaceData));
}

// Handle XML file selection
function handleXMLFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const xmlContent = e.target.result;
    try {
      loadXMLContent(xmlContent, {
        showDetectionToast: true,
        sourceName: file.name,
      });
    } catch (error) {
      console.warn("Error loading selected XML:", error);
      showToast("Error loading XML: " + error.message, "error");
    }

    event.target.value = "";
  };
  reader.readAsText(file);
}

function openPasteXMLModal() {
  const modal = document.getElementById("paste-xml-modal");
  const textarea = document.getElementById("paste-xml-input");
  if (!modal || !textarea) return;

  textarea.value = "";
  modal.style.display = "block";
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.select();
  });
}

function closePasteXMLModal() {
  const modal = document.getElementById("paste-xml-modal");
  const textarea = document.getElementById("paste-xml-input");
  if (textarea) {
    textarea.value = "";
  }
  if (modal) {
    modal.style.display = "none";
  }
}

function openHelpModal() {
  closeGuideModal();
  closeRequestBoardModal();
  closeAccessControlModal();
  closeActivityModal();
  const modal = document.getElementById("help-modal");
  if (modal) {
    modal.style.display = "block";
  }
}

function closeHelpModal() {
  const modal = document.getElementById("help-modal");
  if (modal) {
    modal.style.display = "none";
  }
}

function getRequestTypeLabel(type) {
  return REQUEST_TYPE_LABELS[type] || "Request";
}

function getRequestStatusLabel(status) {
  return REQUEST_STATUS_LABELS[status] || "Open";
}

function getRequestUpdateFieldLabel(field) {
  return REQUEST_UPDATE_FIELD_LABELS[field] || "Other";
}

function formatRequestBoardDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatRequestActorLabel(ip, name) {
  const normalizedIp = String(ip || "").trim() || "unknown";
  const normalizedName = String(name || "").trim();
  return normalizedName ? `${normalizedName} · ${normalizedIp}` : `IP ${normalizedIp}`;
}

function getActivityRoleLabel(role) {
  if (role === "host") return "Host";
  if (role === "approver") return "Approved";
  return "Viewer";
}

function formatActivityDateLabel(value) {
  const dateKey = String(value || "").trim();
  if (!dateKey) {
    return "Today";
  }

  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dateKey;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(parsed);
}

function resetServerActivityState() {
  publicRequestBoardState.activityItems = [];
  publicRequestBoardState.activitySummary = {
    uniqueIps: 0,
    hosts: 0,
    approvers: 0,
    viewers: 0,
  };
  publicRequestBoardState.activityDate = "";
  publicRequestBoardState.activityUpdatedAt = "";
  publicRequestBoardState.activityErrorMessage = "";
  publicRequestBoardState.isLoadingActivity = false;
}

function resetRequestApproverForm() {
  const form = document.getElementById("request-approver-form");
  if (form) {
    form.reset();
  }
}

function canDirectWriteRequestType(requestType) {
  return (
    publicRequestBoardState.viewerCanApplyRequests &&
    (requestType === "update-data-app" || requestType === "add-new-app")
  );
}

function renderRequestBoardComposerActions() {
  const requestType = document.getElementById("request-type")?.value || "update-data-app";
  const canDirectWrite = canDirectWriteRequestType(requestType);
  const submitButton = document.getElementById("request-board-submit-btn");
  const directButton = document.getElementById("request-board-direct-btn");
  const directHelp = document.getElementById("request-direct-help");
  const updateMessageLabel = document.getElementById("request-update-message-label");
  const addMessageLabel = document.getElementById("request-add-message-label");
  const addPackageLabel = document.querySelector('label[for="request-add-package-name"]');
  const addClassLabel = document.querySelector('label[for="request-add-class-name"]');

  if (submitButton) {
    submitButton.disabled = publicRequestBoardState.isSubmitting || publicRequestBoardState.isDirectSaving;
    submitButton.textContent = publicRequestBoardState.isSubmitting ? "Posting..." : "Post";
    submitButton.classList.toggle("primary", !canDirectWrite);
  }

  if (directButton) {
    directButton.hidden = !canDirectWrite;
    directButton.disabled = publicRequestBoardState.isSubmitting || publicRequestBoardState.isDirectSaving;
    directButton.classList.toggle("primary", canDirectWrite);
    if (requestType === "add-new-app") {
      directButton.textContent = publicRequestBoardState.isDirectSaving ? "Adding..." : "Add Now";
    } else {
      directButton.textContent = publicRequestBoardState.isDirectSaving ? "Applying..." : "Apply Now";
    }
  }

  if (updateMessageLabel) {
    updateMessageLabel.textContent = canDirectWriteRequestType("update-data-app") && requestType === "update-data-app"
      ? "Note"
      : "Note *";
  }
  if (addMessageLabel) {
    addMessageLabel.textContent = canDirectWriteRequestType("add-new-app") && requestType === "add-new-app"
      ? "Note"
      : "Note *";
  }
  if (addPackageLabel) {
    addPackageLabel.textContent = canDirectWrite && requestType === "add-new-app" ? "Package *" : "Package";
  }
  if (addClassLabel) {
    addClassLabel.textContent = canDirectWrite && requestType === "add-new-app" ? "Class *" : "Class";
  }

  if (directHelp) {
    if (requestType === "others") {
      directHelp.hidden = true;
      directHelp.textContent = "";
    } else if (canDirectWrite && requestType === "update-data-app") {
      directHelp.hidden = false;
      directHelp.textContent = "Approved IP: apply directly to layout_data.json. Note is optional.";
    } else if (canDirectWrite && requestType === "add-new-app") {
      directHelp.hidden = false;
      directHelp.textContent = "Approved IP: add directly to layout_data.json. Package and class are required.";
    } else {
      directHelp.hidden = false;
      directHelp.textContent = "Post a public request for review.";
    }
  }
}

function getPublicRequestSelectedApp() {
  return layoutCatalogLookup.get(publicRequestBoardState.selectedAppKey) || null;
}

function clearPublicRequestAppSearchResults() {
  const results = document.getElementById("request-app-search-results");
  if (!results) return;

  results.innerHTML = "";
  results.classList.remove("has-results", "has-message");
}

function renderPublicRequestSelectedApp() {
  const card = document.getElementById("request-selected-app-card");
  const content = document.getElementById("request-selected-app-content");
  if (!card || !content) return;

  const selectedApp = getPublicRequestSelectedApp();
  if (!selectedApp) {
    card.classList.add("is-empty");
    content.innerHTML = "Select an app.";
    return;
  }

  card.classList.remove("is-empty");
  content.innerHTML = `
    <div class="request-selected-app-name">${escapeHtml(selectedApp.comment || selectedApp.packageName)}</div>
    <div class="request-selected-app-meta">${escapeHtml(selectedApp.packageName)}</div>
    ${
      selectedApp.className
        ? `<div class="request-selected-app-meta">${escapeHtml(selectedApp.className)}</div>`
        : ""
    }
    ${
      selectedApp.sourcePath
        ? `<div class="request-selected-app-path">${escapeHtml(selectedApp.sourcePath)}</div>`
        : ""
    }
  `;
}

function searchPublicRequestApps(query) {
  const trimmed = String(query || "").trim().toLowerCase();
  if (!trimmed) return [];

  return layoutCatalog.app
    .filter((entry) => {
      const comment = String(entry.comment || "").toLowerCase();
      const packageName = String(entry.packageName || "").toLowerCase();
      const className = String(entry.className || "").toLowerCase();
      const sourcePath = String(entry.sourcePath || "").toLowerCase();
      return (
        comment.includes(trimmed) ||
        packageName.includes(trimmed) ||
        className.includes(trimmed) ||
        sourcePath.includes(trimmed)
      );
    })
    .sort((left, right) => {
      const leftText = String(left.comment || left.packageName || "").toLowerCase();
      const rightText = String(right.comment || right.packageName || "").toLowerCase();
      const leftStarts =
        leftText.startsWith(trimmed) ||
        String(left.packageName || "").toLowerCase().startsWith(trimmed);
      const rightStarts =
        rightText.startsWith(trimmed) ||
        String(right.packageName || "").toLowerCase().startsWith(trimmed);

      if (leftStarts !== rightStarts) {
        return leftStarts ? -1 : 1;
      }

      return (left.comment || left.packageName || "").localeCompare(
        right.comment || right.packageName || "",
      );
    })
    .slice(0, 20);
}

function renderPublicRequestAppSearchResults(query) {
  const results = document.getElementById("request-app-search-results");
  if (!results) return;

  const trimmed = String(query || "").trim();
  if (!trimmed) {
    clearPublicRequestAppSearchResults();
    return;
  }

  const matches = searchPublicRequestApps(trimmed);
  if (matches.length === 0) {
    results.innerHTML = `<div class="search-results-empty">No matches.</div>`;
    results.classList.add("has-message");
    results.classList.remove("has-results");
    return;
  }

  results.innerHTML = matches
    .map((entry) => {
      const title = escapeHtml(entry.comment || entry.packageName);
      const packageName = escapeHtml(entry.packageName);
      const className = escapeHtml(entry.className || "");
      const sourcePath = escapeHtml(entry.sourcePath || "");

      return `
        <div class="request-search-result" data-request-app-key="${escapeHtml(entry.key)}" tabindex="0">
          <div class="request-search-name">${title}</div>
          <div class="request-search-meta">${packageName}${className ? ` · ${className}` : ""}</div>
          ${sourcePath ? `<div class="request-search-path">${sourcePath}</div>` : ""}
        </div>
      `;
    })
    .join("");
  results.classList.add("has-results");
  results.classList.remove("has-message");
}

function selectPublicRequestAppEntry(entry) {
  if (!entry) return;

  publicRequestBoardState.selectedAppKey = entry.key;
  const input = document.getElementById("request-app-search");
  if (input) {
    input.value = entry.comment || entry.packageName;
  }
  clearPublicRequestAppSearchResults();
  renderPublicRequestSelectedApp();
  updatePublicRequestNewValueMeta();
}

function handlePublicRequestAppSearchClick(event) {
  const resultItem = event.target.closest(".request-search-result");
  if (!resultItem) return;

  const entry = layoutCatalogLookup.get(resultItem.dataset.requestAppKey || "");
  if (!entry) return;

  selectPublicRequestAppEntry(entry);
}

function getPublicRequestCurrentFieldValue(targetApp, targetField) {
  if (!targetApp || typeof targetApp !== "object") {
    return "";
  }

  if (targetField === "comment") {
    return String(targetApp.comment || "");
  }
  if (targetField === "package-name") {
    return String(targetApp.packageName || "");
  }
  if (targetField === "class-name") {
    return String(targetApp.className || "");
  }
  if (targetField === "source-path") {
    return String(targetApp.sourcePath || "");
  }
  return "";
}

function updatePublicRequestNewValueMeta() {
  const label = document.getElementById("request-update-new-value-label");
  const hint = document.getElementById("request-update-current-value");
  const input = document.getElementById("request-update-new-value");
  const field = document.getElementById("request-update-field")?.value || "comment";
  const targetApp = getPublicRequestSelectedApp();
  const currentValue = getPublicRequestCurrentFieldValue(targetApp, field);

  if (label) {
    label.textContent = `New ${getRequestUpdateFieldLabel(field)} *`;
  }
  if (input) {
    input.placeholder =
      field === "other"
        ? "Enter value"
        : `New ${getRequestUpdateFieldLabel(field).toLowerCase()}`;
  }
  if (hint) {
    if (!targetApp) {
      hint.textContent = "Current value appears here.";
    } else if (field === "other") {
      hint.textContent = "Manual only. Apply is off.";
    } else if (!currentValue) {
      hint.textContent = "Current: empty";
    } else {
      hint.textContent = `Current: ${currentValue}`;
    }
  }
}

function updatePublicRequestFormVisibility() {
  const typeSelect = document.getElementById("request-type");
  const requestType = typeSelect ? typeSelect.value : "update-data-app";
  const canDirectWrite = canDirectWriteRequestType(requestType);

  const updateFields = document.getElementById("request-update-fields");
  const addFields = document.getElementById("request-add-fields");
  const otherFields = document.getElementById("request-other-fields");
  const syncSectionState = (section, enabled, requiredIds = []) => {
    if (!section) return;

    section
      .querySelectorAll("input, select, textarea")
      .forEach((control) => {
        control.disabled = !enabled;
        if (enabled && requiredIds.includes(control.id)) {
          control.setAttribute("required", "required");
        } else {
          control.removeAttribute("required");
        }
      });
  };

  if (updateFields) {
    updateFields.style.display = requestType === "update-data-app" ? "block" : "none";
  }
  if (addFields) {
    addFields.style.display = requestType === "add-new-app" ? "block" : "none";
  }
  if (otherFields) {
    otherFields.style.display = requestType === "others" ? "block" : "none";
  }

  syncSectionState(updateFields, requestType === "update-data-app", [
    "request-update-field",
    "request-update-new-value",
    ...(canDirectWrite ? [] : ["request-update-message"]),
  ]);
  syncSectionState(addFields, requestType === "add-new-app", [
    "request-add-app-name",
    ...(canDirectWrite ? [] : ["request-add-message"]),
  ]);
  syncSectionState(otherFields, requestType === "others", [
    "request-other-subject",
    "request-other-message",
  ]);

  if (requestType !== "update-data-app") {
    clearPublicRequestAppSearchResults();
  }

  updatePublicRequestNewValueMeta();
  renderRequestBoardComposerActions();
}

function resetPublicRequestBoardForm() {
  const form = document.getElementById("request-board-form");
  if (form) {
    form.reset();
  }

  publicRequestBoardState.selectedAppKey = "";
  publicRequestBoardState.openReplyRequestId = "";
  clearPublicRequestAppSearchResults();
  updatePublicRequestFormVisibility();
  renderPublicRequestSelectedApp();
  updatePublicRequestNewValueMeta();
}

function buildPublicRequestPayloadFromForm(options = {}) {
  const { requireMessage = true } = options;
  const requestType = document.getElementById("request-type")?.value || "update-data-app";

  if (requestType === "update-data-app") {
    const selectedApp = getPublicRequestSelectedApp();
    const messageInput = document.getElementById("request-update-message");
    const fieldSelect = document.getElementById("request-update-field");
    const newValueInput = document.getElementById("request-update-new-value");
    const message = String(messageInput?.value || "").trim();
    const proposedValue = String(newValueInput?.value || "").trim();
    const targetField = fieldSelect?.value || "other";

    if (!selectedApp) {
      showToast("Select an app", "error");
      document.getElementById("request-app-search")?.focus();
      return null;
    }
    if (!proposedValue) {
      showToast("Enter a new value", "error");
      newValueInput?.focus();
      return null;
    }
    if (requireMessage && !message) {
      showToast("Add a short note", "error");
      messageInput?.focus();
      return null;
    }

    return {
      type: requestType,
      targetField,
      targetApp: {
        type: selectedApp.type,
        comment: selectedApp.comment,
        packageName: selectedApp.packageName,
        className: selectedApp.className,
        sourcePath: selectedApp.sourcePath,
      },
      proposedValue,
      message: message || "",
    };
  }

  if (requestType === "add-new-app") {
    const appNameInput = document.getElementById("request-add-app-name");
    const packageNameInput = document.getElementById("request-add-package-name");
    const classNameInput = document.getElementById("request-add-class-name");
    const sourcePathInput = document.getElementById("request-add-source-path");
    const messageInput = document.getElementById("request-add-message");
    const appName = String(appNameInput?.value || "").trim();
    const packageName = String(packageNameInput?.value || "").trim();
    const className = String(classNameInput?.value || "").trim();
    const sourcePath = String(sourcePathInput?.value || "").trim();
    const message = String(messageInput?.value || "").trim();

    if (!appName) {
      showToast("Enter a name", "error");
      appNameInput?.focus();
      return null;
    }
    if (requireMessage && !message) {
      showToast("Add a short note", "error");
      messageInput?.focus();
      return null;
    }

    return {
      type: requestType,
      appName,
      packageName,
      className,
      sourcePath,
      message: message || "",
    };
  }

  const subjectInput = document.getElementById("request-other-subject");
  const messageInput = document.getElementById("request-other-message");
  const subject = String(subjectInput?.value || "").trim();
  const message = String(messageInput?.value || "").trim();

  if (!subject) {
    showToast("Enter a title", "error");
    subjectInput?.focus();
    return null;
  }
  if (!message) {
    showToast("Add a short note", "error");
    messageInput?.focus();
    return null;
  }

  return {
    type: requestType,
    subject,
    message,
  };
}

function buildDirectLayoutWritePayloadFromForm() {
  const requestType = document.getElementById("request-type")?.value || "update-data-app";
  if (!canDirectWriteRequestType(requestType)) {
    showToast("Direct save is only for host and approved IPs", "error");
    return null;
  }

  const payload = buildPublicRequestPayloadFromForm({ requireMessage: false });
  if (!payload) {
    return null;
  }

  if (payload.type === "update-data-app") {
    if (!APPLYABLE_REQUEST_FIELDS.has(payload.targetField)) {
      showToast("This field must go through a request", "error");
      document.getElementById("request-update-field")?.focus();
      return null;
    }
    return payload;
  }

  if (payload.type === "add-new-app") {
    if (!payload.packageName) {
      showToast("Enter a package", "error");
      document.getElementById("request-add-package-name")?.focus();
      return null;
    }
    if (!payload.className) {
      showToast("Enter a class", "error");
      document.getElementById("request-add-class-name")?.focus();
      return null;
    }
    return payload;
  }

  showToast("This type must go through a request", "error");
  return null;
}

async function loadPublicRequestBoard(options = {}) {
  if (STATIC_BUILD) return;
  const { silent = false } = options;
  publicRequestBoardState.isLoading = true;
  publicRequestBoardState.errorMessage = "";
  renderPublicRequestBoard();

  try {
    const response = await fetch(PUBLIC_REQUESTS_ENDPOINT, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Unable to load request board (${response.status})`);
    }

    publicRequestBoardState.items = Array.isArray(payload?.requests) ? payload.requests : [];
    publicRequestBoardState.approvers = Array.isArray(payload?.approvers) ? payload.approvers : [];
    publicRequestBoardState.viewerIp = String(payload?.viewerIp || "").trim() || "unknown";
    publicRequestBoardState.viewerName = String(payload?.viewerName || "").trim();
    publicRequestBoardState.viewerRole = String(payload?.viewerRole || "viewer").trim() || "viewer";
    publicRequestBoardState.viewerCanApplyRequests = Boolean(payload?.viewerCanApplyRequests);
    publicRequestBoardState.viewerCanManageApprovers = Boolean(payload?.viewerCanManageApprovers);
    publicRequestBoardState.updatedAt = String(payload?.updatedAt || "");
    if (publicRequestBoardState.viewerCanApplyRequests) {
      void loadServerActivity({ silent: true });
    } else {
      resetServerActivityState();
    }
  } catch (error) {
    console.error("Unable to load public request board:", error);
    publicRequestBoardState.errorMessage = error?.message || "Unable to load request board";
    publicRequestBoardState.approvers = [];
    publicRequestBoardState.viewerName = "";
    publicRequestBoardState.viewerRole = "viewer";
    publicRequestBoardState.viewerCanApplyRequests = false;
    publicRequestBoardState.viewerCanManageApprovers = false;
    resetServerActivityState();
    if (!silent) {
      showToast(publicRequestBoardState.errorMessage, "error");
    }
  } finally {
    publicRequestBoardState.isLoading = false;
    renderPublicRequestBoard();
  }
}

function renderPublicRequestSummary() {
  const container = document.getElementById("request-board-summary");
  if (!container) return;

  const items = Array.isArray(publicRequestBoardState.items) ? publicRequestBoardState.items : [];
  const counts = {
    total: items.length,
    open: items.filter((item) => item?.status === "open").length,
    inReview: items.filter((item) => item?.status === "in-review").length,
    applied: items.filter((item) => item?.status === "applied").length,
  };

  container.innerHTML = `
    <div class="request-summary-card">
      <strong>${counts.total}</strong>
      <span>All</span>
    </div>
    <div class="request-summary-card">
      <strong>${counts.open}</strong>
      <span>Open</span>
    </div>
    <div class="request-summary-card">
      <strong>${counts.inReview}</strong>
      <span>Review</span>
    </div>
    <div class="request-summary-card">
      <strong>${counts.applied}</strong>
      <span>Done</span>
    </div>
  `;
}

function renderRequestApproverPanel() {
  const panel = document.getElementById("access-control-panel");
  const button = document.getElementById("access-control-btn");
  const count = document.getElementById("access-control-count");
  const list = document.getElementById("request-approver-list");
  const submitButton = document.getElementById("request-approver-submit-btn");
  if (!panel || !list) return;

  const canManage =
    publicRequestBoardState.viewerRole === "host" &&
    Boolean(publicRequestBoardState.viewerCanManageApprovers);
  panel.hidden = !canManage;
  panel.style.display = canManage ? "" : "none";
  if (button) {
    button.hidden = !canManage;
    button.style.display = canManage ? "" : "none";
  }

  if (!canManage) {
    resetRequestApproverForm();
    list.innerHTML = "";
    if (count) {
      count.textContent = "0";
    }
    closeAccessControlModal();
    return;
  }

  if (submitButton) {
    submitButton.disabled = publicRequestBoardState.isSavingApprover;
    submitButton.textContent = publicRequestBoardState.isSavingApprover ? "Saving..." : "Save Access";
  }

  const approvers = Array.isArray(publicRequestBoardState.approvers)
    ? publicRequestBoardState.approvers
    : [];
  if (count) {
    count.textContent = String(approvers.length);
  }

  if (approvers.length === 0) {
    list.innerHTML = `<div class="request-approver-empty">No approved IPs yet.</div>`;
    return;
  }

  list.innerHTML = approvers
    .map((approver) => {
      return `
        <article class="request-approver-item" data-approver-id="${escapeHtml(approver?.id || "")}">
          <div class="request-approver-row">
            <div>
              <p class="request-approver-name">${escapeHtml(approver?.name || "Unnamed")}</p>
              <div class="request-approver-ip">${escapeHtml(approver?.ip || "unknown")}</div>
            </div>
            <button
              type="button"
              class="btn-ghost request-approver-remove"
              data-request-action="remove-approver"
              data-approver-id="${escapeHtml(approver?.id || "")}"
            >
              Remove
            </button>
          </div>
          ${approver?.note ? `<p class="request-approver-note">${escapeHtml(approver.note)}</p>` : ""}
          <div class="request-approver-meta">Updated ${escapeHtml(formatRequestBoardDate(approver?.updatedAt || approver?.createdAt))}</div>
        </article>
      `;
    })
    .join("");
}

function renderActivityAccessControls() {
  const canViewActivity = Boolean(publicRequestBoardState.viewerCanApplyRequests);
  const activityButton = document.getElementById("activity-btn");
  const activityCount = document.getElementById("activity-count");

  if (activityButton) {
    activityButton.hidden = !canViewActivity;
    activityButton.style.display = canViewActivity ? "" : "none";
    activityButton.disabled = publicRequestBoardState.isLoadingActivity;
  }

  if (activityCount) {
    activityCount.textContent = String(
      canViewActivity
        ? (
          publicRequestBoardState.activitySummary?.uniqueIps ||
            publicRequestBoardState.activityItems.length ||
            0
        )
        : 0,
    );
  }

  if (!canViewActivity) {
    closeActivityModal();
  }
}

function getActivityFilters() {
  const filters = publicRequestBoardState.activityFilters || {};
  return {
    query: String(filters.query || "").trim().toLowerCase(),
    time: filters.time || "all",
  };
}

function syncActivityFilterInputs() {
  const filters = getActivityFilters();
  const queryInput = document.getElementById("activity-filter-query");
  const timeSelect = document.getElementById("activity-filter-time");

  if (queryInput && queryInput.value !== filters.query) {
    queryInput.value = filters.query;
  }
  if (timeSelect && timeSelect.value !== filters.time) {
    timeSelect.value = filters.time;
  }
}

function getActivityTimeCutoff(timeFilter) {
  const now = Date.now();
  if (timeFilter === "last-15m") return now - 15 * 60 * 1000;
  if (timeFilter === "last-hour") return now - 60 * 60 * 1000;
  if (timeFilter === "last-4h") return now - 4 * 60 * 60 * 1000;
  return 0;
}

function activityItemMatchesFilters(item, filters = getActivityFilters()) {
  if (filters.query) {
    const haystack = [
      item?.username,
      item?.ip,
      item?.name,
      item?.note,
      item?.lastPath,
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
    if (!haystack.includes(filters.query)) {
      return false;
    }
  }

  const cutoff = getActivityTimeCutoff(filters.time);
  if (cutoff > 0) {
    const timestamp = Date.parse(item?.lastSeen || item?.firstSeen || "");
    if (!Number.isFinite(timestamp) || timestamp < cutoff) {
      return false;
    }
  }

  return true;
}

function getFilteredServerActivityItems(items) {
  const filters = getActivityFilters();
  return (items || []).filter((item) => activityItemMatchesFilters(item, filters));
}

function syncActivityFilterCount(filteredCount, totalCount) {
  const count = document.getElementById("activity-filter-count");
  if (count) {
    count.textContent = `${filteredCount} / ${totalCount}`;
  }
}

function renderServerActivity() {
  renderActivityAccessControls();
  syncActivityFilterInputs();

  const datePill = document.getElementById("activity-date-pill");
  const updatedPill = document.getElementById("activity-updated-pill");
  const summary = document.getElementById("activity-summary");
  const list = document.getElementById("activity-list");
  const refreshButton = document.getElementById("activity-refresh-btn");
  if (!summary || !list) return;

  if (datePill) {
    datePill.textContent = publicRequestBoardState.activityDate
      ? formatActivityDateLabel(publicRequestBoardState.activityDate)
      : "Today";
  }

  if (updatedPill) {
    updatedPill.textContent = publicRequestBoardState.activityUpdatedAt
      ? `Sync ${formatRequestBoardDate(publicRequestBoardState.activityUpdatedAt)}`
      : "Not synced";
  }

  if (refreshButton) {
    refreshButton.disabled = publicRequestBoardState.isLoadingActivity;
    refreshButton.textContent = publicRequestBoardState.isLoadingActivity ? "Loading..." : "Reload";
  }

  const activitySummary = publicRequestBoardState.activitySummary || {};
  summary.innerHTML = `
    <div class="request-summary-card">
      <strong>${Number(activitySummary.uniqueIps || 0)}</strong>
      <span>Total IPs</span>
    </div>
    <div class="request-summary-card">
      <strong>${Number(activitySummary.hosts || 0)}</strong>
      <span>Host</span>
    </div>
    <div class="request-summary-card">
      <strong>${Number(activitySummary.approvers || 0)}</strong>
      <span>Approved</span>
    </div>
    <div class="request-summary-card">
      <strong>${Number(activitySummary.viewers || 0)}</strong>
      <span>Viewers</span>
    </div>
  `;

  if (publicRequestBoardState.isLoadingActivity && publicRequestBoardState.activityItems.length === 0) {
    list.innerHTML = `
      <div class="activity-empty">
        <strong>Loading...</strong>
        <p>Please wait.</p>
      </div>
    `;
    return;
  }

  if (publicRequestBoardState.activityErrorMessage) {
    list.innerHTML = `
      <div class="activity-empty">
        <strong>Unavailable</strong>
        <p>${escapeHtml(publicRequestBoardState.activityErrorMessage)}</p>
      </div>
    `;
    return;
  }

  const items = Array.isArray(publicRequestBoardState.activityItems)
    ? publicRequestBoardState.activityItems
    : [];
  const filteredItems = getFilteredServerActivityItems(items);
  syncActivityFilterCount(filteredItems.length, items.length);

  if (items.length === 0) {
    list.innerHTML = `
      <div class="activity-empty">
        <strong>No access yet</strong>
        <p>No IP reached the server today.</p>
      </div>
    `;
    return;
  }

  if (filteredItems.length === 0) {
    list.innerHTML = `
      <div class="activity-empty">
        <strong>No matching activity</strong>
        <p>Adjust username, IP, or time filters.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = filteredItems
    .map((item) => {
      const roleClass = String(item?.role || "viewer").trim() || "viewer";
      const hits = Number(item?.hits || 0);
      const pageHits = Number(item?.pageHits || 0);
      const apiHits = Number(item?.apiHits || 0);
      const username = String(item?.username || "").trim();
      const actorName = String(item?.name || username || "").trim();

      return `
        <article class="activity-item">
          <div class="activity-item-head">
            <div>
              <div class="activity-item-meta">
                <span class="activity-item-name">${escapeHtml(formatRequestActorLabel(item?.ip, actorName))}</span>
                <span class="activity-role-pill role-${escapeHtml(roleClass)}">${escapeHtml(getActivityRoleLabel(roleClass))}</span>
              </div>
              ${username ? `<div class="activity-item-username">User ${escapeHtml(username)}</div>` : ""}
              <div class="activity-item-ip">IP ${escapeHtml(item?.ip || "unknown")}</div>
              ${item?.note ? `<div class="activity-item-note">${escapeHtml(item.note)}</div>` : ""}
            </div>
            <div class="activity-item-stats">
              <span class="activity-stat-pill">${hits} hits</span>
              <span class="activity-stat-pill">${pageHits} page</span>
              <span class="activity-stat-pill">${apiHits} API</span>
            </div>
          </div>
          <div class="activity-item-meta">
            <span>First ${escapeHtml(formatRequestBoardDate(item?.firstSeen))}</span>
            <span>Last ${escapeHtml(formatRequestBoardDate(item?.lastSeen))}</span>
          </div>
          <div class="activity-item-path">Last path: ${escapeHtml(item?.lastPath || "/")}</div>
        </article>
      `;
    })
    .join("");
}

function getFilteredPublicRequestItems() {
  const items = Array.isArray(publicRequestBoardState.items) ? publicRequestBoardState.items : [];
  const { type, status } = publicRequestBoardState.filters;

  return items.filter((item) => {
    if (type && type !== "all" && item?.type !== type) {
      return false;
    }
    if (status && status !== "all" && item?.status !== status) {
      return false;
    }
    return true;
  });
}

function renderPublicReplyStatusOptions() {
  const options = [
    { value: "", label: "Keep" },
    { value: "open", label: "Open" },
    { value: "in-review", label: "Review" },
    { value: "applied", label: "Done" },
    { value: "closed", label: "Closed" },
  ];

  return options
    .map((option) => {
      return `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`;
    })
    .join("");
}

function renderPublicRequestReplies(item) {
  const replies = Array.isArray(item?.replies) ? item.replies : [];
  if (replies.length === 0) {
    return "";
  }

  return `
    <div class="request-thread-list">
      ${replies
        .map((reply) => {
          const statusBadge = reply?.status
            ? `<span class="request-reply-status-pill status-${escapeHtml(reply.status)}">${escapeHtml(getRequestStatusLabel(reply.status))}</span>`
            : "";

          return `
            <article class="request-reply-item">
              <div class="request-reply-head">
                <div class="request-card-submeta">
                  <span>${escapeHtml(formatRequestActorLabel(reply?.createdByIp, reply?.createdByName))}</span>
                  <span>${escapeHtml(formatRequestBoardDate(reply?.createdAt))}</span>
                </div>
                ${statusBadge}
              </div>
              <p class="request-reply-body">${escapeHtml(reply?.message || "")}</p>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPublicRequestBodyBlocks(item) {
  if (item?.type === "update-data-app") {
    const targetApp = item.targetApp || {};
    const currentValue = getPublicRequestCurrentFieldValue(targetApp, item?.targetField);
    const proposedValue = String(item?.proposedValue || "");
    return `
      <div class="request-block">
        <p class="request-block-label">App</p>
        <div class="request-target-grid">
          <div class="request-meta-row">
            <span class="request-meta-label">Name</span>
            <span class="request-block-value">${escapeHtml(targetApp.comment || targetApp.packageName || "Unknown app")}</span>
          </div>
          <div class="request-meta-row">
            <span class="request-meta-label">Package</span>
            <span class="request-meta-value">${escapeHtml(targetApp.packageName || "-")}</span>
          </div>
          ${
            targetApp.className
              ? `
                <div class="request-meta-row">
                  <span class="request-meta-label">Class</span>
                  <span class="request-meta-value">${escapeHtml(targetApp.className)}</span>
                </div>
              `
              : ""
          }
          ${
            targetApp.sourcePath
              ? `
                <div class="request-meta-row">
                  <span class="request-meta-label">Source</span>
                  <span class="request-meta-value">${escapeHtml(targetApp.sourcePath)}</span>
                </div>
              `
              : ""
          }
        </div>
      </div>
      <div class="request-block">
        <p class="request-block-label">Change</p>
        <div class="request-meta-row">
          <span class="request-meta-label">Field</span>
          <span class="request-block-value">${escapeHtml(getRequestUpdateFieldLabel(item?.targetField))}</span>
        </div>
        <div class="request-meta-row">
          <span class="request-meta-label">Current</span>
          <span class="request-meta-value">${escapeHtml(currentValue || "(empty)")}</span>
        </div>
        <div class="request-meta-row">
          <span class="request-meta-label">New</span>
          <span class="request-block-value">${escapeHtml(proposedValue || "(not provided)")}</span>
        </div>
        <p class="request-message">${escapeHtml(item?.message || "")}</p>
      </div>
    `;
  }

  if (item?.type === "add-new-app") {
    return `
      <div class="request-block">
        <p class="request-block-label">App</p>
        <div class="request-target-grid">
          <div class="request-meta-row">
            <span class="request-meta-label">Name</span>
            <span class="request-block-value">${escapeHtml(item?.appName || "Unnamed app")}</span>
          </div>
          ${
            item?.packageName
              ? `
                <div class="request-meta-row">
                  <span class="request-meta-label">Package</span>
                  <span class="request-meta-value">${escapeHtml(item.packageName)}</span>
                </div>
              `
              : ""
          }
          ${
            item?.className
              ? `
                <div class="request-meta-row">
                  <span class="request-meta-label">Class</span>
                  <span class="request-meta-value">${escapeHtml(item.className)}</span>
                </div>
              `
              : ""
          }
        </div>
      </div>
      <div class="request-block">
        <p class="request-block-label">Note</p>
        <p class="request-message">${escapeHtml(item?.message || "")}</p>
      </div>
    `;
  }

  return `
    <div class="request-block">
      <p class="request-block-label">Title</p>
      <span class="request-block-value">${escapeHtml(item?.subject || "Other request")}</span>
    </div>
    <div class="request-block">
      <p class="request-block-label">Note</p>
      <p class="request-message">${escapeHtml(item?.message || "")}</p>
    </div>
  `;
}

function renderPublicRequestCard(item) {
  const replies = Array.isArray(item?.replies) ? item.replies : [];
  const isReplyFormOpen = publicRequestBoardState.openReplyRequestId === item?.id;
  const isReplySubmitting = publicRequestBoardState.submittingReplyRequestId === item?.id;
  const isApplying = publicRequestBoardState.applyingRequestId === item?.id;
  const applySupported = item?.applySupported !== false &&
    item?.type === "update-data-app" &&
    ["comment", "package-name", "class-name", "source-path"].includes(item?.targetField);
  const canApply =
    publicRequestBoardState.viewerCanApplyRequests &&
    applySupported &&
    String(item?.proposedValue || "").trim() &&
    item?.status !== "applied";
  let title = item?.subject || "Request";

  if (item?.type === "update-data-app") {
    const targetName = item?.targetApp?.comment || item?.targetApp?.packageName || "app";
    title = `Update ${getRequestUpdateFieldLabel(item?.targetField)} for ${targetName}`;
  } else if (item?.type === "add-new-app") {
    title = `New app: ${item?.appName || "Unnamed app"}`;
  }

  return `
    <article class="request-card" data-request-id="${escapeHtml(item?.id || "")}">
      <div class="request-card-head">
        <div>
          <div class="request-badge-row">
            <span class="request-type-pill">${escapeHtml(getRequestTypeLabel(item?.type))}</span>
            <span class="request-status-pill status-${escapeHtml(item?.status || "open")}">${escapeHtml(getRequestStatusLabel(item?.status))}</span>
          </div>
          <h4 class="request-card-title">${escapeHtml(title)}</h4>
          <div class="request-card-submeta">
            <span>${escapeHtml(formatRequestActorLabel(item?.createdByIp, item?.createdByName))}</span>
            <span>${escapeHtml(formatRequestBoardDate(item?.createdAt))}</span>
            <span>Upd. ${escapeHtml(formatRequestBoardDate(item?.updatedAt || item?.createdAt))}</span>
          </div>
        </div>
        <div class="request-footer-meta">
          <span class="request-inline-pill">${replies.length} replies</span>
          <span class="request-inline-pill">${escapeHtml(formatRequestActorLabel(item?.lastActorIp || item?.createdByIp, item?.lastActorName))}</span>
        </div>
      </div>

      <div class="request-card-grid">
        ${renderPublicRequestBodyBlocks(item)}
      </div>

      <div class="request-thread">
        ${renderPublicRequestReplies(item)}
        <form class="request-reply-form ${isReplyFormOpen ? "is-open" : ""}" data-request-id="${escapeHtml(item?.id || "")}">
          <div class="request-reply-grid">
            <div class="form-group">
              <label for="request-reply-message-${escapeHtml(item?.id || "")}">Reply</label>
              <textarea
                id="request-reply-message-${escapeHtml(item?.id || "")}"
                name="message"
                placeholder="Short reply"
                ${isReplySubmitting ? "disabled" : ""}
              ></textarea>
            </div>
            <div class="form-group">
              <label for="request-reply-status-${escapeHtml(item?.id || "")}">Status</label>
              <select
                id="request-reply-status-${escapeHtml(item?.id || "")}"
                name="status"
                ${isReplySubmitting || !publicRequestBoardState.viewerCanApplyRequests ? "disabled" : ""}
              >
                ${renderPublicReplyStatusOptions()}
              </select>
            </div>
          </div>
          <div class="request-reply-actions">
            <button type="button" data-request-action="cancel-reply" data-request-id="${escapeHtml(item?.id || "")}">
              Cancel
            </button>
            <button type="submit" class="primary" ${isReplySubmitting ? "disabled" : ""}>
              ${isReplySubmitting ? "Posting..." : "Post Reply"}
            </button>
          </div>
        </form>
      </div>

      <div class="request-card-footer">
        <div class="request-card-submeta">
          <span>Public</span>
        </div>
        <div class="request-card-actions">
          ${
            canApply
              ? `
                <button
                  type="button"
                  class="btn-success request-apply-toggle"
                  data-request-action="apply-request"
                  data-request-id="${escapeHtml(item?.id || "")}"
                  ${isApplying ? "disabled" : ""}
                >
                  ${isApplying ? "Applying..." : "Apply"}
                </button>
              `
              : ""
          }
          <button
            type="button"
            class="btn-neutral request-reply-toggle"
            data-request-action="${isReplyFormOpen ? "cancel-reply" : "open-reply"}"
            data-request-id="${escapeHtml(item?.id || "")}"
          >
            ${isReplyFormOpen ? "Hide Reply" : "Reply"}
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderPublicRequestBoard() {
  const countPill = document.getElementById("request-board-count");
  if (countPill) {
    countPill.textContent = String(
      Array.isArray(publicRequestBoardState.items) ? publicRequestBoardState.items.length : 0,
    );
  }

  const viewerIp = document.getElementById("request-viewer-ip");
  if (viewerIp) {
    viewerIp.textContent = publicRequestBoardState.viewerIp
      ? formatRequestActorLabel(publicRequestBoardState.viewerIp, publicRequestBoardState.viewerName) +
        (publicRequestBoardState.viewerRole === "host"
          ? " · host"
          : publicRequestBoardState.viewerRole === "approver"
            ? " · approver"
            : "")
      : "Detecting...";
  }

  const updatedAt = document.getElementById("request-board-updated-at");
  if (updatedAt) {
    updatedAt.textContent = publicRequestBoardState.updatedAt
      ? `Sync ${formatRequestBoardDate(publicRequestBoardState.updatedAt)}`
      : "Not synced";
  }

  const submitButton = document.getElementById("request-board-submit-btn");
  if (submitButton) {
    submitButton.disabled = publicRequestBoardState.isSubmitting || publicRequestBoardState.isDirectSaving;
    submitButton.textContent = publicRequestBoardState.isSubmitting ? "Posting..." : "Post";
  }

  const refreshButton = document.getElementById("request-board-refresh-btn");
  if (refreshButton) {
    refreshButton.disabled = publicRequestBoardState.isLoading || publicRequestBoardState.isDirectSaving;
    refreshButton.textContent = publicRequestBoardState.isLoading ? "Loading..." : "Reload";
  }

  renderPublicRequestSummary();
  renderRequestApproverPanel();
  renderActivityAccessControls();
  renderRequestBoardComposerActions();

  const list = document.getElementById("request-board-list");
  if (!list) return;

  if (publicRequestBoardState.isLoading && publicRequestBoardState.items.length === 0) {
    list.innerHTML = `
      <div class="request-board-empty">
        <strong>Loading...</strong>
        <p>Please wait.</p>
      </div>
    `;
    return;
  }

  const filteredItems = getFilteredPublicRequestItems();
  if (filteredItems.length === 0) {
    const emptyMessage = publicRequestBoardState.errorMessage
      ? escapeHtml(publicRequestBoardState.errorMessage)
      : "No results.";
    list.innerHTML = `
      <div class="request-board-empty">
        <strong>Empty</strong>
        <p>${emptyMessage}</p>
      </div>
    `;
    return;
  }

  list.innerHTML = filteredItems.map((item) => renderPublicRequestCard(item)).join("");
}

async function handlePublicRequestBoardSubmit(event) {
  event.preventDefault();
  if (publicRequestBoardState.isSubmitting || publicRequestBoardState.isDirectSaving) {
    return;
  }

  const requestPayload = buildPublicRequestPayloadFromForm();
  if (!requestPayload) {
    return;
  }

  publicRequestBoardState.isSubmitting = true;
  renderPublicRequestBoard();

  try {
    const response = await fetch(PUBLIC_REQUESTS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ request: requestPayload }),
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Unable to post request (${response.status})`);
    }

    resetPublicRequestBoardForm();
    await loadPublicRequestBoard({ silent: true });
    showToast("Request posted", "success");
  } catch (error) {
    console.error("Unable to post request:", error);
    showToast(error?.message || "Post failed", "error");
  } finally {
    publicRequestBoardState.isSubmitting = false;
    renderPublicRequestBoard();
  }
}

async function handleDirectLayoutWriteSubmit() {
  if (publicRequestBoardState.isDirectSaving || publicRequestBoardState.isSubmitting) {
    return;
  }

  const actionPayload = buildDirectLayoutWritePayloadFromForm();
  if (!actionPayload) {
    return;
  }

  publicRequestBoardState.isDirectSaving = true;
  renderPublicRequestBoard();

  try {
    const response = await fetch(PUBLIC_REQUEST_DIRECT_WRITE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        action: actionPayload,
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Unable to save layout data (${response.status})`);
    }

    await reloadLayoutCatalog({ silent: true });
    resetPublicRequestBoardForm();
    await loadPublicRequestBoard({ silent: true });
    showToast(
      actionPayload.type === "add-new-app" ? "App added to database" : "Database updated",
      "success",
    );
  } catch (error) {
    console.error("Unable to write layout data directly:", error);
    showToast(error?.message || "Direct save failed", "error");
  } finally {
    publicRequestBoardState.isDirectSaving = false;
    renderPublicRequestBoard();
  }
}

function handlePublicRequestBoardListClick(event) {
  const actionTarget = event.target.closest("[data-request-action]");
  if (!actionTarget) return;

  const action = actionTarget.dataset.requestAction;
  const requestId = actionTarget.dataset.requestId || "";
  if (!requestId) return;

  if (action === "open-reply") {
    publicRequestBoardState.openReplyRequestId = requestId;
    renderPublicRequestBoard();
    return;
  }

  if (action === "cancel-reply") {
    publicRequestBoardState.openReplyRequestId = "";
    renderPublicRequestBoard();
    return;
  }

  if (action === "apply-request") {
    void applyPublicRequestUpdate(requestId);
  }
}

async function handlePublicRequestBoardListSubmit(event) {
  const form = event.target.closest(".request-reply-form");
  if (!form) return;

  event.preventDefault();
  const requestId = form.dataset.requestId || "";
  const messageInput = form.querySelector('textarea[name="message"]');
  const statusSelect = form.querySelector('select[name="status"]');
  const message = String(messageInput?.value || "").trim();
  const status = publicRequestBoardState.viewerCanApplyRequests
    ? String(statusSelect?.value || "").trim()
    : "";

  if (!requestId) return;
  if (!message) {
    showToast("Enter a reply", "error");
    messageInput?.focus();
    return;
  }
  if (publicRequestBoardState.submittingReplyRequestId) {
    return;
  }

  publicRequestBoardState.submittingReplyRequestId = requestId;

  try {
    const response = await fetch(`${PUBLIC_REQUESTS_ENDPOINT}/${requestId}/replies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        reply: {
          message,
          status,
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Unable to post reply (${response.status})`);
    }

    publicRequestBoardState.openReplyRequestId = "";
    await loadPublicRequestBoard({ silent: true });
    showToast("Reply posted", "success");
  } catch (error) {
    console.error("Unable to post reply:", error);
    showToast(error?.message || "Reply failed", "error");
  } finally {
    publicRequestBoardState.submittingReplyRequestId = "";
    renderPublicRequestBoard();
  }
}

async function applyPublicRequestUpdate(requestId) {
  if (!requestId || publicRequestBoardState.applyingRequestId) {
    return;
  }

  publicRequestBoardState.applyingRequestId = requestId;
  renderPublicRequestBoard();

  try {
    const response = await fetch(`${PUBLIC_REQUESTS_ENDPOINT}/${requestId}/apply`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Unable to apply request (${response.status})`);
    }

    await reloadLayoutCatalog({ silent: true });
    await loadPublicRequestBoard({ silent: true });
    showToast("Applied", "success");
  } catch (error) {
    console.error("Unable to apply request update:", error);
    showToast(error?.message || "Apply failed", "error");
  } finally {
    publicRequestBoardState.applyingRequestId = "";
    renderPublicRequestBoard();
  }
}

async function handleRequestApproverSubmit(event) {
  event.preventDefault();
  if (publicRequestBoardState.isSavingApprover || !publicRequestBoardState.viewerCanManageApprovers) {
    return;
  }

  const ipInput = document.getElementById("request-approver-ip");
  const nameInput = document.getElementById("request-approver-name");
  const noteInput = document.getElementById("request-approver-note");
  const ip = String(ipInput?.value || "").trim();
  const name = String(nameInput?.value || "").trim();
  const note = String(noteInput?.value || "").trim();

  if (!ip) {
    showToast("Enter an IP", "error");
    ipInput?.focus();
    return;
  }
  if (!name) {
    showToast("Enter a name", "error");
    nameInput?.focus();
    return;
  }

  publicRequestBoardState.isSavingApprover = true;
  renderPublicRequestBoard();

  try {
    const response = await fetch(PUBLIC_REQUEST_APPROVERS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        approver: {
          ip,
          name,
          note,
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Unable to save approver (${response.status})`);
    }

    resetRequestApproverForm();
    await loadPublicRequestBoard({ silent: true });
    showToast(payload?.created ? "Approver added" : "Approver updated", "success");
  } catch (error) {
    console.error("Unable to save approver:", error);
    showToast(error?.message || "Save failed", "error");
  } finally {
    publicRequestBoardState.isSavingApprover = false;
    renderPublicRequestBoard();
  }
}

function handleRequestApproverListClick(event) {
  const actionTarget = event.target.closest("[data-request-action]");
  if (!actionTarget) return;

  const action = actionTarget.dataset.requestAction;
  const approverId = actionTarget.dataset.approverId || "";
  if (action === "remove-approver" && approverId) {
    void deleteRequestApprover(approverId);
  }
}

async function deleteRequestApprover(approverId) {
  if (!approverId || !publicRequestBoardState.viewerCanManageApprovers) {
    return;
  }

  try {
    const response = await fetch(`${PUBLIC_REQUEST_APPROVERS_ENDPOINT}/${approverId}`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Unable to remove approver (${response.status})`);
    }

    await loadPublicRequestBoard({ silent: true });
    showToast("Approver removed", "success");
  } catch (error) {
    console.error("Unable to remove approver:", error);
    showToast(error?.message || "Remove failed", "error");
  }
}

async function loadServerActivity(options = {}) {
  const { silent = false } = options;
  if (!publicRequestBoardState.viewerCanApplyRequests) {
    resetServerActivityState();
    renderServerActivity();
    return;
  }
  if (publicRequestBoardState.isLoadingActivity) {
    return;
  }

  publicRequestBoardState.isLoadingActivity = true;
  publicRequestBoardState.activityErrorMessage = "";
  renderServerActivity();

  try {
    const response = await fetch(PUBLIC_REQUEST_ACTIVITY_ENDPOINT, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Unable to load activity (${response.status})`);
    }

    publicRequestBoardState.activityItems = Array.isArray(payload?.items) ? payload.items : [];
    publicRequestBoardState.activitySummary = payload?.summary && typeof payload.summary === "object"
      ? {
          uniqueIps: Number(payload.summary.uniqueIps || 0),
          hosts: Number(payload.summary.hosts || 0),
          approvers: Number(payload.summary.approvers || 0),
          viewers: Number(payload.summary.viewers || 0),
        }
      : {
          uniqueIps: 0,
          hosts: 0,
          approvers: 0,
          viewers: 0,
        };
    publicRequestBoardState.activityDate = String(payload?.date || "").trim();
    publicRequestBoardState.activityUpdatedAt = String(payload?.updatedAt || "").trim();
  } catch (error) {
    console.error("Unable to load server activity:", error);
    publicRequestBoardState.activityErrorMessage = error?.message || "Unable to load activity";
    if (!silent) {
      showToast(publicRequestBoardState.activityErrorMessage, "error");
    }
  } finally {
    publicRequestBoardState.isLoadingActivity = false;
    renderServerActivity();
  }
}

function openRequestBoardModal() {
  closeAccessControlModal();
  closeActivityModal();
  closeGuideModal();
  closeHelpModal();
  const modal = document.getElementById("request-board-modal");
  if (modal) {
    modal.style.display = "block";
  }
  void loadPublicRequestBoard({ silent: true });
}

function closeRequestBoardModal() {
  const modal = document.getElementById("request-board-modal");
  if (modal) {
    modal.style.display = "none";
  }
  publicRequestBoardState.openReplyRequestId = "";
}

function openAccessControlModal() {
  if (!publicRequestBoardState.viewerCanManageApprovers || publicRequestBoardState.viewerRole !== "host") {
    showToast("Access control is only for the host", "error");
    return;
  }

  closeGuideModal();
  closeHelpModal();
  closeRequestBoardModal();
  closeActivityModal();
  const modal = document.getElementById("access-control-modal");
  if (modal) {
    modal.style.display = "block";
  }
  void loadPublicRequestBoard({ silent: true });
}

function closeAccessControlModal() {
  const modal = document.getElementById("access-control-modal");
  if (modal) {
    modal.style.display = "none";
  }
}

function openActivityModal() {
  if (!publicRequestBoardState.viewerCanApplyRequests) {
    showToast("Activity is only for host and approved IPs", "error");
    return;
  }

  closeGuideModal();
  closeHelpModal();
  closeRequestBoardModal();
  closeAccessControlModal();
  const modal = document.getElementById("activity-modal");
  if (modal) {
    modal.style.display = "block";
  }
  renderServerActivity();
  void loadServerActivity({ silent: true });
}

function closeActivityModal() {
  const modal = document.getElementById("activity-modal");
  if (modal) {
    modal.style.display = "none";
  }
}

function openGuideModal() {
  closeHelpModal();
  closeRequestBoardModal();
  closeAccessControlModal();
  closeActivityModal();
  const modal = document.getElementById("guide-modal");
  if (modal) {
    modal.style.display = "block";
    const scroller = modal.querySelector(".guide-modal-scroll");
    if (scroller) {
      scroller.scrollTop = 0;
    }
  }
}

function closeGuideModal() {
  const modal = document.getElementById("guide-modal");
  if (modal) {
    modal.style.display = "none";
  }
}

function importPastedXML() {
  const textarea = document.getElementById("paste-xml-input");
  const xmlText = textarea ? textarea.value.trim() : "";

  if (!xmlText) {
    showToast("Paste XML content first", "error");
    if (textarea) textarea.focus();
    return;
  }

  try {
    loadXMLContent(xmlText, {
      showDetectionToast: true,
      sourceName: "Pasted XML",
    });
    closePasteXMLModal();
  } catch (error) {
    console.warn("Error importing pasted XML:", error);
    showToast("Error loading pasted XML: " + error.message, "error");
  }
}

/** Preserves `hidden` on round-trip when the source XML had the attribute (value may be ""). */
function readHiddenAttribute(element) {
  if (!element || typeof element.hasAttribute !== "function") return undefined;
  if (!element.hasAttribute("hidden")) return undefined;
  return element.getAttribute("hidden") ?? "";
}

// Get the comment node that immediately precedes an XML element
function getPrecedingComment(element) {
  let sibling = element.previousSibling;
  while (sibling) {
    if (sibling.nodeType === Node.COMMENT_NODE) {
      return sibling.textContent;
    }
    if (sibling.nodeType === Node.ELEMENT_NODE) {
      return null;
    }
    sibling = sibling.previousSibling;
  }
  return null;
}

// Parse XML data
function parseXMLData(xmlString) {
  // Clear existing data
  xmlData = {
    folders: {},
    xmlHeader: "",
    xmlComment: "",
    xmlComments: [],
    xmlTrailingComments: [],
    rootAttributes: [],
  };

  try {
    const preamble = extractXMLPreamble(xmlString);
    // Parse XML string
    const xmlDoc = parseXMLDocument(xmlString);
    const boundaryComments = extractXMLBoundaryComments(xmlDoc);

    xmlData.xmlHeader = preamble.xmlHeader;
    xmlData.xmlComment = preamble.xmlComment;
    xmlData.xmlComments = preamble.xmlComments;
    xmlData.xmlTrailingComments = boundaryComments.trailingComments;

    // Get appOrder element
    const appOrder = xmlDoc.documentElement;
    xmlData.rootAttributes = getElementAttributes(appOrder);

    // Get all folder elements
    const folders = appOrder.getElementsByTagName("folder");
    let elementIndex = 0;

    // Process folders
    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];
      const title = folder.getAttribute("title");
      const screen = folder.getAttribute("screen");

      if (title) {
        const folderHidden = readHiddenAttribute(folder);
        xmlData.folders[title] = {
          title: title,
          screen: screen,
          postPosition: folder.getAttribute("postPosition") === "true",
          apps: {},
          index: elementIndex++,
          comment: getPrecedingComment(folder) || "",
          ...(folderHidden !== undefined ? { hidden: folderHidden } : {}),
        };

        // Process apps in folder
        const favorites = folder.getElementsByTagName("favorite");
        for (let j = 0; j < favorites.length; j++) {
          const favorite = favorites[j];
          const packageName = favorite.getAttribute("packageName");
          const className = favorite.getAttribute("className");
          const appScreen = favorite.getAttribute("screen");
          const favHidden = readHiddenAttribute(favorite);

          if (packageName) {
            xmlData.folders[title].apps[packageName] = {
              screen: appScreen,
              "package name": packageName,
              class_name: className,
              index: j,
              comment: getPrecedingComment(favorite) || "",
              ...(favHidden !== undefined ? { hidden: favHidden } : {}),
            };
          }
        }
      }
    }

    // Process standalone apps (not in folders)
    const allFavorites = appOrder.getElementsByTagName("favorite");
    const standaloneApps = [];

    // Find apps that are not inside folders
    for (let i = 0; i < allFavorites.length; i++) {
      const favorite = allFavorites[i];
      const packageName = favorite.getAttribute("packageName");

      // Check if this app is inside a folder
      let inFolder = false;
      for (let j = 0; j < folders.length; j++) {
        if (folders[j].contains(favorite)) {
          inFolder = true;
          break;
        }
      }

      if (!inFolder && packageName) {
        standaloneApps.push(favorite);
      }
    }

    // Create no_folder entry if we have standalone apps
    if (standaloneApps.length > 0) {
      xmlData.folders["no_folder"] = {
        title: "no_folder",
        apps: {},
        index: elementIndex++,
      };

      // Process standalone apps
      for (let i = 0; i < standaloneApps.length; i++) {
        const favorite = standaloneApps[i];
        const packageName = favorite.getAttribute("packageName");
        const className = favorite.getAttribute("className");
        const appScreen = favorite.getAttribute("screen");

        if (packageName) {
          const standaloneHidden = readHiddenAttribute(favorite);
          xmlData.folders["no_folder"].apps[packageName] = {
            screen: appScreen,
            "package name": packageName,
            class_name: className,
            index: elementIndex++,
            comment: getPrecedingComment(favorite) || "",
            ...(standaloneHidden !== undefined
              ? { hidden: standaloneHidden }
              : {}),
          };
        }
      }
    }
  } catch (error) {
    console.error("Error parsing XML:", error);
    throw error;
  }
}

// Initialize virtual buffer
function initializeVirtualBuffer() {
  virtualBuffer = cloneData(xmlData);
  setUnsavedChanges(false);
}

function getWorkspaceItemsForPage(screen = currentPage) {
  const page = Number(screen) || 0;
  const items = [];
  const homeItems = virtualWorkspaceBuffer.home.filter(
    (item) => Number(item.screen) === page,
  );
  const homeRows = getWorkspaceHomeRows();
  const hotseatItems = [...virtualWorkspaceBuffer.hotseat]
    .sort((a, b) => (a.screen || 0) - (b.screen || 0))
    .map((item) => {
      const hotseatSlot = Number.isFinite(Number(item.screen))
        ? Number(item.screen)
        : 0;
      return {
        type: "hotseat-app",
        data: {
          ...item,
          hotseatSlot,
          x: hotseatSlot,
          y: homeRows,
        },
      };
    });

  items.push(
    ...homeItems.map((item) => ({
      type: item.type,
      data: item,
    })),
  );
  items.push(...hotseatItems);
  return items;
}

// Get all items from virtual buffer based on current mode
function getAllItemsVirtual() {
  if (currentMode === "default-workspace") {
    return getWorkspaceItemsForPage(currentPage);
  } else {
    // For Application Order mode (existing functionality)
    const items = [];
    const foldersData = virtualBuffer.folders;

    for (const title in foldersData) {
      if (title !== "no_folder") {
        items.push({
          type: "folder",
          data: foldersData[title],
        });
      }
    }

    if ("no_folder" in foldersData) {
      const noFolderData = foldersData.no_folder;
      if ("apps" in noFolderData) {
        for (const packageName in noFolderData.apps) {
          items.push({
            type: "app",
            data: noFolderData.apps[packageName],
          });
        }
      }
    }

    items.sort((a, b) => (a.data.index || 0) - (b.data.index || 0));

    return items;
  }
}

function buildAppOrderListFromVirtualBuffer(buffer) {
  if (!buffer || !buffer.folders) return [];
  const items = [];
  const foldersData = buffer.folders;

  for (const title in foldersData) {
    if (title !== "no_folder") {
      items.push({
        type: "folder",
        data: foldersData[title],
      });
    }
  }

  if ("no_folder" in foldersData) {
    const noFolderData = foldersData.no_folder;
    if ("apps" in noFolderData) {
      for (const packageName in noFolderData.apps) {
        items.push({
          type: "app",
          data: noFolderData.apps[packageName],
        });
      }
    }
  }

  items.sort((a, b) => (a.data.index || 0) - (b.data.index || 0));
  return items;
}

function buildAppOrderLayoutFingerprintMap(buffer) {
  const list = buildAppOrderListFromVirtualBuffer(buffer);
  const map = new Map();
  list.forEach((item, idx) => {
    map.set(
      `ao:${idx}`,
      JSON.stringify({ type: item.type, data: item.data }),
    );
  });
  return map;
}

function buildWorkspaceLayoutFingerprintMap(wsBuffer) {
  const map = new Map();
  if (!wsBuffer) return map;

  (wsBuffer.home || []).forEach((raw) => {
    const s = Number(raw.screen) || 0;
    const x = Number(raw.x) || 0;
    const y = Number(raw.y) || 0;
    const key = `ws:home:${s}:${x}:${y}`;
    map.set(key, JSON.stringify(raw));
  });

  (wsBuffer.hotseat || []).forEach((raw) => {
    const slot = Number.isFinite(Number(raw.screen))
      ? Number(raw.screen)
      : 0;
    const key = `ws:hs:${slot}`;
    map.set(key, JSON.stringify(raw));
  });

  return map;
}

function collectChangedLayoutKeys(beforeMap, afterMap) {
  const changed = new Set();
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  for (const k of keys) {
    if (beforeMap.get(k) !== afterMap.get(k)) {
      changed.add(k);
    }
  }
  return changed;
}

function flashLayoutCanvasUpdatedItems(changedKeys, options = {}) {
  const { flashAll = false } = options;
  if (!appGrid) return;

  let elements;
  if (flashAll) {
    elements = [...appGrid.querySelectorAll(".app-item")];
  } else {
    if (!changedKeys || changedKeys.size === 0) return;
    elements = [...appGrid.querySelectorAll(".app-item[data-layout-key]")].filter(
      (el) => changedKeys.has(el.dataset.layoutKey),
    );
  }

  if (!elements.length) return;

  elements.forEach((el) => el.classList.add("layout-item-updated"));
  window.setTimeout(() => {
    elements.forEach((el) => el.classList.remove("layout-item-updated"));
  }, 2200);
}

// Get display name for item
function getDisplayName(item) {
  if (!item) return "Item";
  if (item.type === "folder") {
    return item.data.title || "Folder";
  }
  if (item.type === "appwidget") {
    return getWidgetDisplayName(item);
  }

  const displayComment = getDisplayComment(item);
  if (displayComment) {
    return displayComment;
  }

  const packageName = getItemPackageName(item);
  if (packageName) {
    return getPackageFallbackLabel(packageName);
  }
  return "App";
}

function getModeLabel() {
  return currentMode === "default-workspace"
    ? "Default Workspace"
    : "Application Order";
}

function getLayoutProfileLabel() {
  if (currentLayout === "tablet-6x8") return "Tablet (6×8)";
  if (currentLayout === "tablet-6x10") return "Tablet (6×10)";
  if (currentLayout === "tablet-8x6") return "Tablet (8×6)";
  if (currentLayout === "fold-6x6") return "Fold (6×6)";
  if (currentLayout === "custom") return "Custom";
  return "Mobile";
}

function getGridSummaryLabel() {
  if (currentMode === "default-workspace") {
    return `${getWorkspaceCols()}x${getWorkspaceHomeRows()} + dock`;
  }
  return `${getWorkspaceCols()}x${getAppOrderSlotRows()}`;
}

function setPaginationButtonState(button, isUnavailable) {
  if (!button) {
    return;
  }

  button.disabled = false;
  button.classList.toggle("is-nav-disabled", Boolean(isUnavailable));
  button.setAttribute("aria-disabled", isUnavailable ? "true" : "false");
}

function getTotalPagesForCurrentMode() {
  if (currentMode === "default-workspace") {
    const screens = Array.isArray(virtualWorkspaceBuffer.home)
      ? virtualWorkspaceBuffer.home.map((item) => Number(item.screen) || 0)
      : [];
    const maxScreen = screens.length > 0 ? Math.max(...screens) : 0;
    return Math.max(1, maxScreen + 1);
  }

  const itemsPerPage = getWorkspaceCols() * getAppOrderSlotRows();
  return Math.max(1, Math.ceil(allItems.length / itemsPerPage));
}

function normalizeCanvasPageMode(value) {
  return value === "one" || value === "two" ? value : "auto";
}

function syncCanvasPageModeButtons() {
  document.querySelectorAll("[data-canvas-page-mode]").forEach((button) => {
    const isActive = button.dataset.canvasPageMode === canvasPageMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setCanvasPageMode(mode) {
  const nextMode = normalizeCanvasPageMode(mode);
  if (canvasPageMode === nextMode) {
    syncCanvasPageModeButtons();
    return;
  }

  canvasPageMode = nextMode;
  syncCanvasPageModeButtons();
  updateUI();
  schedulePersistCurrentSession();
}

function getResponsiveCanvasPageCount() {
  const totalPages = getTotalPagesForCurrentMode();
  if (currentPage >= totalPages - 1) {
    return 1;
  }

  if (canvasPageMode === "one") {
    return 1;
  }
  if (canvasPageMode === "two") {
    return 2;
  }

  const twoPageCellSize = getMainCellSize({ pageCount: 2 });
  return twoPageCellSize >= CANVAS_TWO_PAGE_MIN_CELL_SIZE ? 2 : 1;
}

function getVisibleCanvasPages(pageCount = canvasVisiblePageCount) {
  const totalPages = getTotalPagesForCurrentMode();
  const pages = [Math.max(0, Math.min(currentPage, totalPages - 1))];
  if (getCanvasPageCount(pageCount) > 1 && pages[0] + 1 < totalPages) {
    pages.push(pages[0] + 1);
  }
  return pages;
}

function getCanvasGridColumnOffsetForPage(pageIndex) {
  return Math.max(0, Number(pageIndex) || 0) * (getWorkspaceCols() + 1);
}

function getCanvasGridColumnForPage(col, pageIndex = 0) {
  return getCanvasGridColumnOffsetForPage(pageIndex) + Number(col) + 1;
}

function getCanvasPageSeparatorColumn(pageIndex = 0) {
  return getCanvasGridColumnOffsetForPage(pageIndex) + getWorkspaceCols() + 1;
}

function getCanvasGridTemplateColumns(cols, cellSize, pageCount = 1) {
  const pages = getCanvasPageCount(pageCount);
  const tracks = [];
  for (let pageIndex = 0; pageIndex < pages; pageIndex++) {
    if (pageIndex > 0) {
      tracks.push(`${CANVAS_PAGE_SEPARATOR_SIZE}px`);
    }
    tracks.push(`repeat(${cols}, ${cellSize}px)`);
  }
  return tracks.join(" ");
}

function getCanvasPageContentWidth(cols, cellSize, gap = getCurrentGridGap()) {
  return cols * cellSize + Math.max(0, cols - 1) * gap;
}

function getCanvasPageStride(cols, cellSize, gap = getCurrentGridGap()) {
  return getCanvasPageContentWidth(cols, cellSize, gap) +
    CANVAS_PAGE_SEPARATOR_SIZE +
    2 * gap;
}

function getCanvasPageStartX(pageIndex, cols, cellSize, gap = getCurrentGridGap()) {
  return Math.max(0, Number(pageIndex) || 0) *
    getCanvasPageStride(cols, cellSize, gap);
}

function getCanvasPageIndexForScreen(screen) {
  const pages = getVisibleCanvasPages();
  const normalizedScreen = Number(screen);
  const index = pages.findIndex((page) => Number(page) === normalizedScreen);
  return index === -1 ? 0 : index;
}

function appendCanvasPageSeparators(container, pageCount, rowSpan) {
  const pages = getCanvasPageCount(pageCount);
  for (let pageIndex = 0; pageIndex < pages - 1; pageIndex++) {
    const separator = document.createElement("div");
    separator.className = "canvas-page-separator";
    separator.style.gridColumn = String(getCanvasPageSeparatorColumn(pageIndex));
    separator.style.gridRow = `1 / span ${rowSpan}`;
    separator.setAttribute("aria-hidden", "true");
    container.appendChild(separator);
  }
}

function getApplicationOrderItemsPerPage() {
  return getWorkspaceCols() * getAppOrderSlotRows();
}

function getResolvedApplicationOrderTopLevelEntries() {
  return getSortedAppOrderItems().map((item) =>
    resolveApplicationOrderTopLevelEntry(item),
  );
}

function findApplicationOrderTopLevelEntryPosition(sourceItem) {
  const sourceEntry = resolveApplicationOrderTopLevelEntry(sourceItem);
  const orderedEntries = getResolvedApplicationOrderTopLevelEntries();
  const position = orderedEntries.findIndex(
    (entry) =>
      entry.type === sourceEntry.type &&
      entry.key === sourceEntry.key,
  );

  return { sourceEntry, orderedEntries, position };
}

function getApplicationOrderPageForItem(sourceItem) {
  const { position } = findApplicationOrderTopLevelEntryPosition(sourceItem);
  if (position === -1) {
    throw new Error("Dragged item could not be resolved");
  }
  return Math.floor(position / getApplicationOrderItemsPerPage());
}

function getApplicationOrderTargetIndexForPage(sourceItem, targetPage) {
  const { orderedEntries, position } =
    findApplicationOrderTopLevelEntryPosition(sourceItem);

  if (position === -1) {
    throw new Error("Dragged item could not be resolved");
  }

  const itemsPerPage = getApplicationOrderItemsPerPage();
  const totalPages = Math.max(
    1,
    Math.ceil(orderedEntries.length / itemsPerPage),
  );
  const normalizedPage = Math.max(
    0,
    Math.min(Number(targetPage) || 0, totalPages - 1),
  );
  const slotWithinPage = position % itemsPerPage;
  const rawTargetIndex = normalizedPage * itemsPerPage + slotWithinPage;

  return Math.min(rawTargetIndex, Math.max(0, orderedEntries.length - 1));
}

function moveApplicationOrderItemToPage(sourceItem, targetPage) {
  const totalPages = getTotalPagesForCurrentMode();
  const screen = Number(targetPage);
  if (!Number.isFinite(screen) || screen < 0 || screen >= totalPages) {
    throw new Error(`Target page must be between 1 and ${totalPages}`);
  }

  const targetIndex = getApplicationOrderTargetIndexForPage(
    sourceItem,
    screen,
  );
  const moved = moveApplicationOrderTopLevelItem(sourceItem, targetIndex);
  currentPage = screen;

  return {
    moved,
    message: moved
      ? `Moved item to page ${screen + 1}`
      : `Item is already on page ${screen + 1}`,
  };
}

function getTotalItemCountForCurrentMode() {
  if (currentMode === "default-workspace") {
    const homeCount = Array.isArray(virtualWorkspaceBuffer.home)
      ? virtualWorkspaceBuffer.home.length
      : 0;
    const hotseatCount = Array.isArray(virtualWorkspaceBuffer.hotseat)
      ? virtualWorkspaceBuffer.hotseat.length
      : 0;
    return homeCount + hotseatCount;
  }

  return allItems.length;
}

function getVisiblePageItemCount() {
  if (currentMode === "default-workspace") {
    const homeCount = Array.isArray(virtualWorkspaceBuffer.home)
      ? virtualWorkspaceBuffer.home.filter(
          (item) => Number(item.screen) === currentPage,
        ).length
      : 0;
    const hotseatCount = Array.isArray(virtualWorkspaceBuffer.hotseat)
      ? virtualWorkspaceBuffer.hotseat.length
      : 0;
    return homeCount + hotseatCount;
  }

  const itemsPerPage = getWorkspaceCols() * getAppOrderSlotRows();
  const startIdx = currentPage * itemsPerPage;
  return Math.max(0, Math.min(itemsPerPage, allItems.length - startIdx));
}

function isXMLInspectorVisible() {
  return Boolean(xmlPanel) && window.getComputedStyle(xmlPanel).display !== "none";
}

function applyStatusTone(element, tone) {
  if (!element) return;
  element.classList.remove("is-saved", "is-dirty", "is-info");
  if (tone) {
    element.classList.add(tone);
  }
}

function updateXMLToggleLabel() {
  if (!toggleXmlBtn) return;
  const isVisible = isXMLInspectorVisible();
  toggleXmlBtn.textContent = isVisible ? "Hide XML" : "Show XML";
  toggleXmlBtn.setAttribute("aria-pressed", isVisible ? "true" : "false");
}

function syncAppChrome() {
  const hasPendingChanges = unsavedChanges || xmlEditorDirty;
  const totalPages = getTotalPagesForCurrentMode();
  const totalItems = getTotalItemCountForCurrentMode();
  const visibleItems = getVisiblePageItemCount();
  const modeLabel = getModeLabel();
  const layoutProfile = getLayoutProfileLabel();
  const gridLabel = getGridSummaryLabel();
  const xmlVisible = isXMLInspectorVisible();

  if (headerModePill) {
    headerModePill.textContent = modeLabel;
    applyStatusTone(headerModePill, "is-info");
  }

  if (headerGridPill) {
    headerGridPill.textContent = `${layoutProfile} ${gridLabel}`;
  }

  if (headerStatePill) {
    headerStatePill.textContent = hasPendingChanges ? "Unsaved" : "Saved";
    applyStatusTone(headerStatePill, hasPendingChanges ? "is-dirty" : "is-saved");
  }

  if (workspaceHeading) {
    workspaceHeading.textContent = `${modeLabel} Studio`;
  }

  if (workspaceSubtitle) {
    workspaceSubtitle.textContent =
      currentMode === "default-workspace"
        ? "Place apps, folders, widgets, and hotseat items on exact coordinates across multiple screens."
        : "Reorder launcher items page by page, inspect the visual sequence, and export cleaner XML.";
  }

  if (metricItems) {
    metricItems.textContent = String(totalItems);
  }

  if (metricItemsDetail) {
    metricItemsDetail.textContent =
      currentMode === "default-workspace"
        ? `Page ${currentPage + 1} currently shows ${visibleItems} visible items.`
        : `${visibleItems} items are visible on the current page.`;
  }

  if (metricPages) {
    metricPages.textContent = `${currentPage + 1}/${totalPages}`;
  }

  if (metricPagesDetail) {
    metricPagesDetail.textContent =
      totalPages > 1
        ? `${totalPages} pages are available in this file.`
        : "This file currently uses a single page.";
  }

  if (metricLayout) {
    metricLayout.textContent = gridLabel;
  }

  if (metricLayoutDetail) {
    metricLayoutDetail.textContent =
      currentLayout === "custom"
        ? "Custom grid profile is active."
        : currentLayout === "fold-6x6"
          ? "Fold density profile is active."
          : isTabletLayoutKey()
            ? "Tablet density profile is active."
            : "Mobile density profile is active.";
  }

  if (metricXml) {
    metricXml.textContent = xmlVisible ? "Live" : "Hidden";
  }

  if (metricXmlDetail) {
    metricXmlDetail.textContent = xmlVisible
      ? "Inspector panel is open with formatted XML."
      : "Open the inspector to validate formatted XML output.";
  }

  if (sidebarContextTitle) {
    sidebarContextTitle.textContent = modeLabel;
  }

  if (sidebarContextCopy) {
    sidebarContextCopy.textContent =
      currentMode === "default-workspace"
        ? "Arrange the actual launcher canvas with spatial placement, hotseat slots, and widget spans."
        : "Manage the launcher sequence as a paged catalog, including folder ordering and item grouping.";
  }

  if (stageTitle) {
    stageTitle.textContent = "Preview";
  }

  if (deviceGridReadout) {
    deviceGridReadout.textContent = gridLabel;
  }

  document.body.dataset.mode = currentMode;
  document.body.dataset.layout = currentLayout;
  document.body.classList.toggle("has-unsaved-changes", hasPendingChanges);
  document.body.classList.toggle("xml-visible", xmlVisible);

  updateXMLToggleLabel();
  syncCanvasPageModeButtons();
  syncXMLPanelChrome();
}

// Update UI
function updateUI() {
  // Get all items
  allItems = getAllItemsVirtual();
  canvasVisiblePageCount = getResponsiveCanvasPageCount();

  // Update page count
  updatePageNavigation();

  // Render current page
  renderScreen();
  renderCartPanel();
  syncOpenFolderModal();
  syncAppChrome();
}

// Update page navigation
function updatePageNavigation() {
  if (currentMode === "default-workspace") {
    // For Default Workspace mode, determine the number of screens/pages
    const screens = virtualWorkspaceBuffer.home.map((item) => item.screen);
    const maxScreen = screens.length > 0 ? Math.max(...screens) : 0;
    const totalPages = maxScreen + 1; // screens are 0-indexed

    const visiblePages = getVisibleCanvasPages();
    pageInfo.textContent =
      visiblePages.length > 1
        ? `${visiblePages[0] + 1}-${visiblePages[visiblePages.length - 1] + 1} / ${totalPages}`
        : `${currentPage + 1} / ${totalPages}`;

    // Update button states — disable Next if the last visible page is already the final page
    const lastVisibleWs = visiblePages[visiblePages.length - 1];
    setPaginationButtonState(prevPageBtn, currentPage <= 0);
    setPaginationButtonState(nextPageBtn, lastVisibleWs >= totalPages - 1);

    // Handle case where current page is beyond total pages
    if (currentPage >= totalPages) {
      currentPage = Math.max(0, totalPages - 1);
      const pagesAfterClamp = getVisibleCanvasPages();
      pageInfo.textContent =
        pagesAfterClamp.length > 1
          ? `${pagesAfterClamp[0] + 1}-${pagesAfterClamp[pagesAfterClamp.length - 1] + 1} / ${totalPages}`
          : `${currentPage + 1} / ${totalPages}`;
    }
  } else {
    const cols = getWorkspaceCols();
    const slotRows = getAppOrderSlotRows();
    const itemsPerPage = cols * slotRows;
    const totalPages = Math.max(1, Math.ceil(allItems.length / itemsPerPage));

    const visiblePages = getVisibleCanvasPages();
    pageInfo.textContent =
      visiblePages.length > 1
        ? `${visiblePages[0] + 1}-${visiblePages[visiblePages.length - 1] + 1} / ${totalPages}`
        : `${currentPage + 1} / ${totalPages}`;

    // Update button states — disable Next if the last visible page is already the final page
    const lastVisibleAo = visiblePages[visiblePages.length - 1];
    setPaginationButtonState(prevPageBtn, currentPage <= 0);
    setPaginationButtonState(nextPageBtn, lastVisibleAo >= totalPages - 1);

    // Handle case where current page is beyond total pages
    if (currentPage >= totalPages) {
      currentPage = Math.max(0, totalPages - 1);
      const pagesAfterClamp = getVisibleCanvasPages();
      pageInfo.textContent =
        pagesAfterClamp.length > 1
          ? `${pagesAfterClamp[0] + 1}-${pagesAfterClamp[pagesAfterClamp.length - 1] + 1} / ${totalPages}`
          : `${currentPage + 1} / ${totalPages}`;
    }
  }
}

function getWorkspaceHotseatGridRow() {
  return getWorkspaceHomeRows() + 2;
}

function setContextMeta(element, meta) {
  if (!element) return;
  element.contextMeta = meta || null;
}

function isFolderModalOpen() {
  return Boolean(folderModal) && window.getComputedStyle(folderModal).display !== "none";
}

function syncOpenFolderModal() {
  if (!isFolderModalOpen() || !currentFolder) {
    return;
  }

  if (currentMode === "default-workspace") {
    const folder = findWorkspaceFolder(currentFolder.title, currentFolder.screen);
    if (!folder) {
      closeFolderModal();
      return;
    }

    updateWorkspaceFolderUI();
    return;
  }

  if (!currentFolder.title || !virtualBuffer.folders[currentFolder.title]) {
    closeFolderModal();
    return;
  }

  updateFolderUI();
}

function getWorkspaceContextMetaFromItem(item) {
  if (!item) return null;

  if (item.type === "hotseat-app") {
    const slot = Number.isFinite(Number(item.data.hotseatSlot))
      ? Number(item.data.hotseatSlot)
      : Number(item.data.screen) || 0;
    return {
      canAdd: false,
      canEdit: true,
      canRemove: true,
      canCart: false,
      canMovePage: false,
      zone: "hotseat",
      slot,
      screen: slot,
      label: getDisplayName(item),
      itemType: item.type,
    };
  }

  return {
    canAdd: false,
    canEdit: item.type === "app" || item.type === "appwidget" || item.type === "folder",
    canRemove: true,
    canCart: item.type === "app" || item.type === "appwidget",
    canMovePage: ["app", "folder", "appwidget"].includes(item.type),
    zone: "home",
    x: item.data.x,
    y: item.data.y,
    screen: item.data.screen,
    label: getDisplayName(item),
    itemType: item.type,
  };
}

function getAppOrderFolderContextMeta(item) {
  if (!item || item.type !== "app") return null;

  return {
    canAdd: true,
    canEdit: true,
    canRemove: true,
    canCart: true,
    zone: "app-order-folder",
    folderTitle: currentFolder?.title || "",
    inFolder: currentFolder?.title || "",
    insertIndex: Number(item.data?.index ?? item.data?.screen ?? 0),
    screen: currentPage,
    label: getDisplayName(item),
    itemType: item.type,
  };
}

function getWorkspaceFolderContextMeta(folderData, item) {
  if (!folderData || !item || item.type !== "app") return null;

  return {
    canAdd: true,
    canEdit: true,
    canRemove: true,
    canCart: true,
    zone: "workspace-folder",
    folderTitle: folderData.title || "",
    folderScreen: Number(folderData.screen) || 0,
    inFolder: folderData.title || "",
    insertIndex: Number(item.data?.screen ?? item.index ?? 0),
    screen: Number(folderData.screen) || 0,
    label: getDisplayName(item),
    itemType: item.type,
  };
}

function appendFolderItemRemoveButton(appItem) {
  if (!appItem) return null;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "folder-item-remove";
  removeButton.title = "Remove app from folder";
  removeButton.setAttribute("aria-label", "Remove app from folder");
  removeButton.textContent = "x";
  removeButton.addEventListener("pointerdown", function (event) {
    event.preventDefault();
    event.stopPropagation();
  });
  removeButton.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    showConfirmDialog(appItem);
  });

  appItem.appendChild(removeButton);
  return removeButton;
}

function resetFolderHistory() {
  folderHistory = { undo: [], redo: [] };
  syncFolderHistoryButtons();
}

function captureFolderHistorySnapshot(label = "") {
  return {
    label,
    mode: currentMode,
    currentFolder: cloneData(currentFolder),
    currentFolderPage,
    virtualBuffer: cloneData(virtualBuffer),
    virtualWorkspaceBuffer: cloneData(virtualWorkspaceBuffer),
    unsavedChanges,
  };
}

function pushFolderHistory(label) {
  if (!isFolderModalOpen() || !currentFolder?.title) {
    return false;
  }

  folderHistory.undo.push(captureFolderHistorySnapshot(label));
  if (folderHistory.undo.length > FOLDER_HISTORY_LIMIT) {
    folderHistory.undo.shift();
  }
  folderHistory.redo = [];
  syncFolderHistoryButtons();
  return true;
}

function popLastFolderHistorySnapshot() {
  const snapshot = folderHistory.undo.pop() || null;
  syncFolderHistoryButtons();
  return snapshot;
}

function restoreFolderHistorySnapshot(snapshot) {
  if (!snapshot) return;

  currentMode = snapshot.mode || currentMode;
  virtualBuffer = cloneData(snapshot.virtualBuffer);
  virtualWorkspaceBuffer = cloneData(snapshot.virtualWorkspaceBuffer);
  currentFolder = cloneData(snapshot.currentFolder);
  currentFolderPage = Number(snapshot.currentFolderPage) || 0;

  if (modeSelect) {
    modeSelect.value = currentMode;
  }

  setUnsavedChanges(Boolean(snapshot.unsavedChanges));
  updateUI();
  refreshXMLViewer();
  syncFolderHistoryButtons();
}

function syncFolderHistoryButtons() {
  const folderVisible = isFolderModalOpen() && Boolean(currentFolder?.title);
  if (folderUndoBtn) {
    folderUndoBtn.disabled = !folderVisible || folderHistory.undo.length === 0;
  }
  if (folderRedoBtn) {
    folderRedoBtn.disabled = !folderVisible || folderHistory.redo.length === 0;
  }
}

function undoFolderHistory() {
  if (!folderHistory.undo.length) return;
  const previous = folderHistory.undo.pop();
  folderHistory.redo.push(captureFolderHistorySnapshot("redo"));
  restoreFolderHistorySnapshot(previous);
  showToast("Folder change undone", "success");
}

function redoFolderHistory() {
  if (!folderHistory.redo.length) return;
  const next = folderHistory.redo.pop();
  folderHistory.undo.push(captureFolderHistorySnapshot("undo"));
  restoreFolderHistorySnapshot(next);
  showToast("Folder change redone", "success");
}

function isFolderAddFormData(formData) {
  return Boolean(
    formData &&
      formData.type === "app" &&
      (
        formData.targetZone === "app-order-folder" ||
        formData.targetZone === "workspace-folder" ||
        formData.inFolder
      ),
  );
}

function isFolderRemovalTarget(appItem) {
  const zone = appItem?.contextMeta?.zone || "";
  return zone === "app-order-folder" || zone === "workspace-folder";
}

function getFolderItemInsertIndex(folderData) {
  if (currentMode === "application-order") {
    const apps = folderData?.apps || {};
    return Object.keys(apps).length;
  }

  const apps = Array.isArray(folderData?.apps) ? folderData.apps : [];
  return apps.length;
}

function buildCurrentFolderAddContext() {
  if (!currentFolder?.title) {
    showToast("Open a folder before adding an app", "error");
    return null;
  }

  if (currentMode === "application-order") {
    const folderData = virtualBuffer.folders?.[currentFolder.title];
    if (!folderData) {
      showToast("Current folder was not found", "error");
      return null;
    }

    return {
      source: "folder-toolbar",
      zone: "app-order-folder",
      folderTitle: currentFolder.title,
      inFolder: currentFolder.title,
      insertIndex: getFolderItemInsertIndex(folderData),
      screen: currentPage,
    };
  }

  const folderData = findWorkspaceFolder(currentFolder.title, currentFolder.screen);
  if (!folderData) {
    showToast("Current folder was not found", "error");
    return null;
  }

  const folderScreen = Number(folderData.screen) || 0;
  return {
    source: "folder-toolbar",
    zone: "workspace-folder",
    folderTitle: folderData.title || currentFolder.title,
    folderScreen,
    inFolder: folderData.title || currentFolder.title,
    insertIndex: getFolderItemInsertIndex(folderData),
    screen: folderScreen,
  };
}

function bindItemDoubleClickAction(appItem, item, folderOpenHandler = null) {
  if (!appItem || !item) return;

  if (item.type === "folder" && typeof folderOpenHandler === "function") {
    appItem.addEventListener("dblclick", function (event) {
      event.preventDefault();
      event.stopPropagation();
      folderOpenHandler(item.data);
    });
    return;
  }

  if (
    item.type === "app" ||
    item.type === "hotseat-app" ||
    item.type === "appwidget"
  ) {
    appItem.addEventListener("dblclick", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openEditItemModal(appItem);
    });
  }
}

function appendGridCellPlaceholder(
  container,
  gridColumn,
  gridRow,
  extraClasses = "",
  meta = null,
) {
  const placeholder = document.createElement("div");
  placeholder.className = `grid-cell-placeholder ${extraClasses}`.trim();
  placeholder.style.gridColumn = String(gridColumn);
  placeholder.style.gridRow = String(gridRow);
  setContextMeta(placeholder, meta);

  if (meta?.zone === "app-order") {
    placeholder.addEventListener("dragover", handleDragOver);
    placeholder.addEventListener("dragenter", handleDragEnter);
    placeholder.addEventListener("dragleave", handleDragLeave);
    placeholder.addEventListener("drop", handleDrop);
  } else if (meta?.zone === "home" || meta?.zone === "hotseat") {
    placeholder.addEventListener("dragover", handleWorkspaceGridDragOver);
    placeholder.addEventListener("dragleave", handleWorkspaceGridDragLeave);
    placeholder.addEventListener("drop", handleWorkspaceGridDrop);
  }

  container.appendChild(placeholder);
  return placeholder;
}

function renderRectGridPlaceholders(
  container,
  cols,
  rows,
  startGridRow = 1,
  extraClasses = "",
  metaFactory = null,
  columnOffset = 0,
) {
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const meta =
        typeof metaFactory === "function"
          ? metaFactory({
              col,
              row,
              gridColumn: col + 1,
              gridRow: startGridRow + row,
            })
          : null;
      appendGridCellPlaceholder(
        container,
        columnOffset + col + 1,
        startGridRow + row,
        extraClasses,
        meta,
      );
    }
  }
}

function getGridCellDensityBand(cellSize, rowCount) {
  if (cellSize <= 42) {
    return "tight";
  }
  if (cellSize <= 60) {
    return "dense";
  }
  if (shouldUseScrollableCanvas(rowCount) || cellSize <= 88) {
    return "balanced";
  }
  return "spacious";
}

function applyCanvasDensityTokens(cellSize, rowCount) {
  if (!appGrid) return;

  const densityBand = getGridCellDensityBand(cellSize, rowCount);
  const isScrollableCanvas = shouldUseScrollableCanvas(rowCount);
  const isDense = densityBand === "dense";
  const isTight = densityBand === "tight";
  const isBalanced = densityBand === "balanced";
  const labelLines = 2;
  const labelSize = isTight
    ? Math.max(9.25, Math.min(11.75, cellSize * 0.24))
    : isDense
      ? Math.max(10.5, Math.min(13, cellSize * 0.22))
      : isBalanced
        ? Math.max(11.25, Math.min(14.5, cellSize * 0.19))
        : Math.max(12, Math.min(15.5, cellSize * 0.18));
  const widgetTitleSize = isTight
    ? Math.max(9.75, Math.min(12.75, cellSize * 0.26))
    : isDense
      ? Math.max(10.5, Math.min(13.75, cellSize * 0.24))
      : isBalanced
        ? Math.max(11.25, Math.min(15, cellSize * 0.22))
        : Math.max(12, Math.min(16, cellSize * 0.2));
  const iconTarget = isTight
    ? Math.max(28, Math.round(cellSize * 0.48))
    : isDense
      ? Math.max(32, Math.round(cellSize * 0.52))
      : isBalanced
        ? Math.max(38, Math.round(cellSize * 0.5))
        : Math.max(42, Math.round(cellSize * 0.48));
  const widgetIconTarget = isTight
    ? Math.max(30, Math.round(cellSize * 0.46))
    : isDense
      ? Math.max(34, Math.round(cellSize * 0.48))
      : isBalanced
        ? Math.max(36, Math.round(cellSize * 0.46))
        : Math.max(40, Math.round(cellSize * 0.44));
  const itemPadBlock = isTight ? 3 : isDense ? 4 : isBalanced ? 5 : 6;
  const itemPadInline = isTight ? 4 : isDense ? 5 : isBalanced ? 6 : 7;
  const labelLineHeight = isTight ? 1.12 : isScrollableCanvas ? 1.16 : 1.18;
  const widgetTitleLineHeight = isTight ? 1.12 : isScrollableCanvas ? 1.16 : 1.2;

  appGrid.dataset.cellBand = densityBand;
  appGrid.style.setProperty("--grid-cell-size", `${cellSize}px`);
  appGrid.style.setProperty("--grid-row-count", String(rowCount));
  appGrid.style.setProperty("--grid-icon-target", `${iconTarget}px`);
  appGrid.style.setProperty("--grid-widget-icon-target", `${widgetIconTarget}px`);
  appGrid.style.setProperty("--grid-title-size", `${labelSize.toFixed(2)}px`);
  appGrid.style.setProperty("--grid-title-line-height", String(labelLineHeight));
  appGrid.style.setProperty("--grid-label-lines", String(labelLines));
  appGrid.style.setProperty(
    "--grid-label-min-height",
    `${Math.round(labelSize * labelLines * labelLineHeight)}px`,
  );
  appGrid.style.setProperty("--grid-widget-title-size", `${widgetTitleSize.toFixed(2)}px`);
  appGrid.style.setProperty(
    "--grid-widget-title-line-height",
    String(widgetTitleLineHeight),
  );
  appGrid.style.setProperty("--grid-item-pad-block", `${itemPadBlock}px`);
  appGrid.style.setProperty("--grid-item-pad-inline", `${itemPadInline}px`);
  appGrid.classList.toggle("grid-compact-cells", densityBand === "dense");
  appGrid.classList.toggle("grid-tight-cells", densityBand === "tight");
  appGrid.classList.toggle("grid-scrollable", isScrollableCanvas);
}

/** X/Y rulers aligned to #app-grid cell tracks (0-based, matches workspace XML). */
function updateLayoutCanvasAxes() {
  const axisX = document.getElementById("canvas-axis-x");
  const axisY = document.getElementById("canvas-axis-y");
  if (!appGrid || !axisX || !axisY) return;

  const cols = getWorkspaceCols();
  const gap = getCurrentGridGap();
  const cellSize = getMainCellSize();
  const visiblePages = getVisibleCanvasPages();
  const renderedPageCount = Math.max(1, visiblePages.length);
  const padRaw = parseFloat(getComputedStyle(appGrid).paddingLeft);
  const pad = Number.isFinite(padRaw) ? padRaw : 16;

  const yCount =
    currentMode === "default-workspace"
      ? getWorkspaceHomeRows()
      : getAppOrderSlotRows();
  const isWorkspaceMode = currentMode === "default-workspace";

  axisX.innerHTML = "";
  axisY.innerHTML = "";

  const gridW = appGrid.style.width;
  const axisXTracks = document.createElement("div");
  axisXTracks.className = "canvas-axis-x-tracks";
  axisXTracks.style.display = "grid";
  axisXTracks.style.gridTemplateColumns = getCanvasGridTemplateColumns(
    cols,
    cellSize,
    renderedPageCount,
  );
  axisXTracks.style.gap = `${gap}px`;
  visiblePages.forEach((page, pageIndex) => {
    if (pageIndex > 0) {
      const pageGap = document.createElement("span");
      pageGap.className = "canvas-axis-page-gap";
      pageGap.setAttribute("aria-hidden", "true");
      axisXTracks.appendChild(pageGap);
    }

    for (let x = 0; x < cols; x++) {
      const tick = document.createElement("span");
      tick.className = "canvas-axis-tick";
      tick.textContent = String(x);
      tick.title = `Page ${page + 1}, x ${x}`;
      axisXTracks.appendChild(tick);
    }
  });
  axisX.appendChild(axisXTracks);
  axisX.style.width = gridW || "";
  axisX.style.paddingLeft = `${pad}px`;
  axisX.style.paddingRight = `${pad}px`;

  const axisYTracks = document.createElement("div");
  axisYTracks.className = "canvas-axis-y-tracks";
  axisYTracks.style.display = "grid";
  axisYTracks.style.gridTemplateRows = `repeat(${yCount}, ${cellSize}px)`;
  axisYTracks.style.gap = `${gap}px`;
  for (let y = 0; y < yCount; y++) {
    const tick = document.createElement("span");
    tick.className = "canvas-axis-tick";
    tick.textContent = String(y);
    axisYTracks.appendChild(tick);
  }
  axisY.appendChild(axisYTracks);
  if (isWorkspaceMode) {
    // Hotseat has slot-based placement, not y coordinates.
    const hotseatBadge = document.createElement("span");
    hotseatBadge.className = "canvas-axis-hotseat-label";
    hotseatBadge.textContent = "HS";
    hotseatBadge.title = "Hotseat khong dung toa do y";
    axisY.appendChild(hotseatBadge);
  }
  axisY.style.paddingTop = `${pad}px`;
  axisY.style.minHeight =
    yCount > 0
      ? `${pad + yCount * cellSize + (yCount - 1) * gap}px`
      : `${pad}px`;
}

// Render screen
function renderScreen() {
  // Clear existing grid
  appGrid.innerHTML = "";
  workspaceDropPreviewElement = null;
  workspaceDropPreviewKey = "";
  appGrid.style.width = "";
  appGrid.style.height = "";
  appGrid.style.gridTemplateColumns = "";
  appGrid.style.gridTemplateRows = "";
  appGrid.style.gap = "";

  appGrid.className = "app-grid";
  appGrid.classList.toggle("show-grid-lines", showGridLines);
  const visiblePages = getVisibleCanvasPages();
  const renderedPageCount = visiblePages.length;
  appGrid.classList.toggle("canvas-two-pages", renderedPageCount > 1);
  if (isTabletLayoutKey()) {
    appGrid.classList.add("tablet");
  } else if (currentLayout === "custom") {
    appGrid.classList.add("custom-layout");
  }

  const previewRowCount =
    currentMode === "default-workspace"
      ? getWorkspaceHomeRows()
      : getAppOrderSlotRows();
  appGrid.classList.toggle(
    "grid-many-rows",
    previewRowCount >= GRID_MANY_ROWS_THRESHOLD,
  );
  appGrid.classList.toggle("grid-eight-rows", previewRowCount === 8);
  appGrid.classList.toggle(
    "grid-ten-rows",
    previewRowCount >= GRID_TEN_ROWS_THRESHOLD,
  );
  const scrollableCanvas = shouldUseScrollableCanvas(previewRowCount);
  const deviceFrame = appGrid.closest(".device-frame");
  if (deviceFrame) {
    deviceFrame.classList.toggle("grid-scrollable", scrollableCanvas);
  }

  const cellSize = getMainCellSize({ pageCount: renderedPageCount });
  applyCanvasDensityTokens(cellSize, previewRowCount);

  if (currentMode === "default-workspace") {
    renderWorkspaceScreen(cellSize, visiblePages);
  } else {
    const cols = getWorkspaceCols();
    const slotRows = getAppOrderSlotRows();
    const itemsPerPage = cols * slotRows;
    const gap = getCurrentGridGap();
    appGrid.style.gridTemplateColumns = getCanvasGridTemplateColumns(
      cols,
      cellSize,
      renderedPageCount,
    );
    appGrid.style.gridTemplateRows = `repeat(${slotRows}, ${cellSize}px)`;
    appGrid.style.gap = `${gap}px`;
    appGrid.style.width = `${getAppOrderGridOuterPixels(
      cols,
      slotRows,
      cellSize,
      gap,
      renderedPageCount,
    ).w}px`;
    appGrid.style.height = `${slotRows * cellSize + Math.max(0, slotRows - 1) * gap + getGridFrameSize()}px`;

    appendCanvasPageSeparators(appGrid, renderedPageCount, slotRows);

    visiblePages.forEach((page, pageIndex) => {
      const startIdx = page * itemsPerPage;
      const endIdx = startIdx + itemsPerPage;
      const pageItems = allItems.slice(startIdx, endIdx);
      const columnOffset = getCanvasGridColumnOffsetForPage(pageIndex);

      renderRectGridPlaceholders(
        appGrid,
        cols,
        slotRows,
        1,
        "",
        ({ col, row }) => ({
          canAdd: true,
          canRemove: false,
          zone: "app-order",
          insertIndex: startIdx + row * cols + col,
          screen: page,
        }),
        columnOffset,
      );

      pageItems.forEach((item, i) => {
        const appItem = document.createElement("div");
        appItem.className = `app-item ${item.type}`;
        appItem.dataset.type = item.type;
        appItem.dataset.index = i;
        appItem.dataset.layoutKey = `ao:${startIdx + i}`;
        const itemCol = i % cols;
        const itemRow = Math.floor(i / cols) + 1;

        appItem.itemData = item;
        appItem.style.gridColumn = String(getCanvasGridColumnForPage(itemCol, pageIndex));
        appItem.style.gridRow = String(itemRow);
        setContextMeta(appItem, {
          canAdd: true,
          canEdit: item.type === "app" || item.type === "appwidget" || item.type === "folder",
          canRemove: true,
          canCart: item.type === "app",
          canMovePage: item.type === "app" || item.type === "folder",
          zone: "app-order",
          insertIndex: startIdx + i,
          screen: page,
          label: getDisplayName(item),
          itemType: item.type,
        });

        if (item.type === "app") {
          const packageName = item.data["package name"] || "";
          appItem.title = packageName;
        }

        appendItemVisuals(appItem, item);
        bindItemDoubleClickAction(appItem, item, openFolder);

        appItem.addEventListener("dragstart", handleDragStart);
        appItem.addEventListener("dragover", handleDragOver);
        appItem.addEventListener("dragenter", handleDragEnter);
        appItem.addEventListener("dragleave", handleDragLeave);
        appItem.addEventListener("drop", handleDrop);
        appItem.addEventListener("dragend", handleDragEnd);
        appItem.setAttribute("draggable", true);

        appGrid.appendChild(appItem);
      });
    });
  }

  updateLayoutCanvasAxes();
}

// Open folder for Default Workspace mode
function openWorkspaceFolder(folderData) {
  // Store the folder data in currentFolder
  currentFolder = folderData;
  currentFolderPage = 0;
  resetFolderHistory();

  // Set folder title
  folderTitle.textContent = folderData.title;

  // Get folder items from virtual workspace buffer
  folderItems = [];
  if (folderData.apps) {
    folderData.apps.forEach((app, index) => {
      folderItems.push({
        type: "app",
        data: app,
        index: index,
      });
    });
  }

  // Sort apps by screen (which represents their order in the folder)
  folderItems.sort((a, b) => (a.data.screen || 0) - (b.data.screen || 0));

  // Update modal-content class based on current layout
  const modalContent = folderModal
    ? folderModal.querySelector(".modal-content")
    : null;
  if (modalContent) {
    if (isTabletLayoutKey()) {
      modalContent.classList.add("tablet");
    } else {
      modalContent.classList.remove("tablet");
    }
  }

  // Update folder UI
  updateWorkspaceFolderUI();

  // Show modal
  folderModal.style.display = "block";
  syncFolderHistoryButtons();
}

// Update folder UI for Default Workspace mode
function updateWorkspaceFolderUI() {
  if (currentFolder && currentFolder.title) {
    const workspaceFolder = findWorkspaceFolder(
      currentFolder.title,
      currentFolder.screen,
    );
    folderItems = Array.isArray(workspaceFolder?.apps)
      ? workspaceFolder.apps
          .map((app) => ({
            type: "app",
            data: app,
          }))
          .sort((a, b) => (a.data.screen || 0) - (b.data.screen || 0))
      : [];
  }

  // Update page count
  updateFolderPageNavigation();

  // Render current page
  syncFolderItemCount();
  renderWorkspaceFolderScreen();
}

// Render folder screen for Default Workspace mode
function renderWorkspaceFolderScreen() {
  // Clear existing grid
  folderGrid.innerHTML = "";

  // Set grid class based on layout
  folderGrid.className = "folder-grid";
  if (isTabletLayoutKey()) {
    folderGrid.classList.add("tablet");
  }

  // Get layout config
  const layoutConfig = getFolderLayoutConfig();
  folderGrid.classList.toggle(
    "grid-many-rows",
    layoutConfig.rows >= GRID_MANY_ROWS_THRESHOLD,
  );
  folderGrid.style.gridTemplateColumns = `repeat(${layoutConfig.cols}, 1fr)`;
  const itemsPerPage = layoutConfig.cols * layoutConfig.rows;

  // Calculate start and end indices for current page
  const startIdx = currentFolderPage * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const pageItems = folderItems.slice(startIdx, endIdx);
  const duplicateKeys = getFolderDuplicateKeySet(folderItems);

  renderRectGridPlaceholders(
    folderGrid,
    layoutConfig.cols,
    layoutConfig.rows,
    1,
    "folder-placeholder",
    ({ col, row }) => {
      const folderScreen = Number(currentFolder?.screen) || 0;
      return {
        canAdd: true,
        canRemove: false,
        zone: "workspace-folder",
        folderTitle: currentFolder?.title || "",
        folderScreen,
        inFolder: currentFolder?.title || "",
        insertIndex: startIdx + row * layoutConfig.cols + col,
        screen: folderScreen,
      };
    },
  );

  // Render items in grid
  pageItems.forEach((item, i) => {
    const appItem = document.createElement("div");
    appItem.className = `app-item ${item.type}`;
    if (duplicateKeys.has(getFolderItemDuplicateKey(item))) {
      appItem.classList.add("has-folder-duplicate");
    }
    appItem.dataset.type = item.type;
    appItem.dataset.index = i;
    appItem.style.gridColumn = String((i % layoutConfig.cols) + 1);
    appItem.style.gridRow = String(Math.floor(i / layoutConfig.cols) + 1);

    // Store item data in element
    appItem.itemData = item;
    setContextMeta(appItem, getWorkspaceFolderContextMeta(currentFolder, item));

    // Add title attribute for hover tooltip (show package name for apps)
    if (item.type === "app") {
      const packageName = item.data.packageName || "";
      appItem.title = packageName; // This will show the package name on hover
    }

    appendItemVisuals(appItem, item, { compact: true });
    appendFolderItemRemoveButton(appItem);
    bindItemDoubleClickAction(appItem, item);

    // Add workspace folder-specific drag and drop events
    appItem.addEventListener("dragstart", handleWorkspaceFolderDragStart);
    appItem.addEventListener("dragover", handleWorkspaceFolderDragOver);
    appItem.addEventListener("dragenter", handleWorkspaceFolderDragEnter);
    appItem.addEventListener("dragleave", handleWorkspaceFolderDragLeave);
    appItem.addEventListener("drop", handleWorkspaceFolderDrop);
    appItem.addEventListener("dragend", handleWorkspaceFolderDragEnd);
    appItem.setAttribute("draggable", true);

    // Add to grid
    folderGrid.appendChild(appItem);
  });
}

// Render screen for Default Workspace mode
function renderWorkspaceScreen(cellSize = getMainCellSize(), visiblePages = getVisibleCanvasPages()) {
  bindWorkspaceGridDnDOnce();

  const cols = getWorkspaceCols();
  const homeRows = getWorkspaceHomeRows();
  const gap = getCurrentGridGap();
  const hotseatGridRow = getWorkspaceHotseatGridRow();
  const renderedPageCount = Math.max(1, visiblePages.length);

  appGrid.style.gridTemplateColumns = getCanvasGridTemplateColumns(
    cols,
    cellSize,
    renderedPageCount,
  );
  appGrid.style.gridTemplateRows = `repeat(${homeRows}, ${cellSize}px) 10px ${cellSize}px`;
  appGrid.style.display = "grid";
  appGrid.style.gap = `${gap}px`;
  appGrid.style.position = "relative";
  appGrid.style.width = `${getWorkspaceGridOuterPixels(
    cols,
    homeRows,
    cellSize,
    gap,
    renderedPageCount,
  ).w}px`;
  appGrid.style.height = `${homeRows * cellSize + (homeRows + 1) * gap + 10 + cellSize + getGridFrameSize()}px`;

  renderRectGridPlaceholders(
    appGrid,
    cols,
    homeRows,
    1,
    "",
    ({ col, row }) => ({
      canAdd: true,
      canRemove: false,
      zone: "home",
      x: col,
      y: row,
      screen: currentPage,
    }),
  );
  renderRectGridPlaceholders(
    appGrid,
    cols,
    1,
    hotseatGridRow,
    "hotseat-placeholder",
    ({ col }) => ({
      canAdd: true,
      canRemove: false,
      zone: "hotseat",
      slot: col,
      screen: col,
    }),
  );

  // ── Hotseat separator ──
  const separator = document.createElement("div");
  separator.className = "hotseat-separator";
  separator.style.gridRow = String(homeRows + 1);
  separator.style.gridColumn = `1 / span ${cols}`;
  appGrid.appendChild(separator);

  // Render items based on their x, y coordinates
  allItems.forEach((item, i) => {
    const appItem = document.createElement("div");
    appItem.className = `app-item ${item.type}`;
    appItem.dataset.type = item.type;
    appItem.dataset.index = i;

    // Store item data in element
    appItem.itemData = item;
    setContextMeta(appItem, getWorkspaceContextMetaFromItem(item));

    if (item.type === "hotseat-app") {
      appItem.dataset.layoutKey = `ws:hs:${item.data.hotseatSlot}`;
    } else {
      const d = item.data;
      const s = Number(d.screen) || 0;
      const x = Number(d.x) || 0;
      const y = Number(d.y) || 0;
      appItem.dataset.layoutKey = `ws:home:${s}:${x}:${y}`;
    }

    // Position item based on x, y coordinates
    if (item.type === "appwidget") {
      appItem.style.gridColumn = `${item.data.x + 1} / span ${item.data.spanX}`;
      appItem.style.gridRow = `${item.data.y + 1} / span ${item.data.spanY}`;
      appItem.style.width = "100%";
      appItem.style.height = "100%";
    } else if (item.type === "folder" || item.type === "app") {
      appItem.style.gridColumn = `${item.data.x + 1}`;
      appItem.style.gridRow = `${item.data.y + 1}`;
    } else if (item.type === "hotseat-app") {
      appItem.style.gridColumn = `${item.data.hotseatSlot + 1}`;
      appItem.style.gridRow = String(hotseatGridRow);
      appItem.setAttribute("draggable", true);
    }

    // Add title attribute for hover tooltip (show package name for apps)
    if (item.type === "app" || item.type === "hotseat-app") {
      const packageName = item.data.packageName || "";
      appItem.title = packageName;
    } else if (item.type === "folder") {
      const folderTitle = item.data.title || "";
      appItem.title = `Folder: ${folderTitle}`;
    } else if (item.type === "appwidget") {
      const packageName = item.data.packageName || "";
      appItem.title = getWidgetDisplayName(item) || packageName;
    }

    appendItemVisuals(appItem, item);

    // Add resize handles for widgets
    if (item.type === "appwidget") {
      addResizeHandles(appItem, item);
    }

    bindItemDoubleClickAction(appItem, item, openWorkspaceFolder);

    // Add workspace-specific drag and drop events
    appItem.addEventListener("dragstart", handleWorkspaceDragStart);
    appItem.addEventListener("dragover", handleWorkspaceDragOver);
    appItem.addEventListener("dragenter", handleWorkspaceDragEnter);
    appItem.addEventListener("dragleave", handleWorkspaceDragLeave);
    appItem.addEventListener("drop", handleWorkspaceDrop);
    appItem.addEventListener("dragend", handleWorkspaceDragEnd);
    appItem.setAttribute("draggable", true);

    // Add to grid
    appGrid.appendChild(appItem);
  });

  if (renderedPageCount > 1) {
    appendCanvasPageSeparators(appGrid, renderedPageCount, hotseatGridRow);
    visiblePages.slice(1).forEach((page, relativeIndex) => {
      const pageIndex = relativeIndex + 1;
      const columnOffset = getCanvasGridColumnOffsetForPage(pageIndex);

      renderRectGridPlaceholders(
        appGrid,
        cols,
        homeRows,
        1,
        "",
        ({ col, row }) => ({
          canAdd: true,
          canRemove: false,
          zone: "home",
          x: col,
          y: row,
          screen: page,
        }),
        columnOffset,
      );
      renderRectGridPlaceholders(
        appGrid,
        cols,
        1,
        hotseatGridRow,
        "hotseat-placeholder",
        ({ col }) => ({
          canAdd: true,
          canRemove: false,
          zone: "hotseat",
          slot: col,
          screen: col,
          canvasPage: page,
        }),
        columnOffset,
      );

      const pageHotseatSeparator = document.createElement("div");
      pageHotseatSeparator.className = "hotseat-separator";
      pageHotseatSeparator.style.gridRow = String(homeRows + 1);
      pageHotseatSeparator.style.gridColumn = `${getCanvasGridColumnForPage(0, pageIndex)} / span ${cols}`;
      appGrid.appendChild(pageHotseatSeparator);

      appendWorkspaceItemsForCanvasPage(page, pageIndex, hotseatGridRow);
    });
  }
}

function appendWorkspaceItemsForCanvasPage(page, pageIndex, hotseatGridRow) {
  getWorkspaceItemsForPage(page).forEach((item, i) => {
    const appItem = document.createElement("div");
    appItem.className = `app-item ${item.type}`;
    appItem.dataset.type = item.type;
    appItem.dataset.index = i;

    appItem.itemData = item;
    const meta = getWorkspaceContextMetaFromItem(item);
    if (meta) meta.canvasPage = page;
    setContextMeta(appItem, meta);

    if (item.type === "hotseat-app") {
      appItem.dataset.layoutKey = `ws:hs:${item.data.hotseatSlot}`;
    } else {
      const d = item.data;
      appItem.dataset.layoutKey = `ws:home:${Number(d.screen) || 0}:${Number(d.x) || 0}:${Number(d.y) || 0}`;
    }

    if (item.type === "appwidget") {
      appItem.style.gridColumn =
        `${getCanvasGridColumnForPage(item.data.x, pageIndex)} / span ${item.data.spanX}`;
      appItem.style.gridRow = `${item.data.y + 1} / span ${item.data.spanY}`;
      appItem.style.width = "100%";
      appItem.style.height = "100%";
    } else if (item.type === "folder" || item.type === "app") {
      appItem.style.gridColumn = `${getCanvasGridColumnForPage(item.data.x, pageIndex)}`;
      appItem.style.gridRow = `${item.data.y + 1}`;
    } else if (item.type === "hotseat-app") {
      appItem.style.gridColumn = `${getCanvasGridColumnForPage(item.data.hotseatSlot, pageIndex)}`;
      appItem.style.gridRow = String(hotseatGridRow);
      appItem.setAttribute("draggable", true);
    }

    if (item.type === "app" || item.type === "hotseat-app") {
      appItem.title = item.data.packageName || "";
    } else if (item.type === "folder") {
      appItem.title = `Folder: ${item.data.title || ""}`;
    } else if (item.type === "appwidget") {
      appItem.title = getWidgetDisplayName(item) || item.data.packageName || "";
    }

    appendItemVisuals(appItem, item);

    if (item.type === "appwidget") {
      addResizeHandles(appItem, item);
    }

    bindItemDoubleClickAction(appItem, item, openWorkspaceFolder);

    appItem.addEventListener("dragstart", handleWorkspaceDragStart);
    appItem.addEventListener("dragover", handleWorkspaceDragOver);
    appItem.addEventListener("dragenter", handleWorkspaceDragEnter);
    appItem.addEventListener("dragleave", handleWorkspaceDragLeave);
    appItem.addEventListener("drop", handleWorkspaceDrop);
    appItem.addEventListener("dragend", handleWorkspaceDragEnd);
    appItem.setAttribute("draggable", true);

    appGrid.appendChild(appItem);
  });
}

// Handle drag start
function handleDragStart(e) {
  initializeSharedDragGesture(this, e, "application-order-item");
}

// Handle drag over
function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = "move";
  return false;
}

// Handle drag enter
function handleDragEnter(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.currentTarget.classList.add("drag-placeholder");
  return false;
}

// Handle drag leave
function handleDragLeave(e) {
  const target = e.currentTarget;
  // Only remove placeholder if the related target is NOT a child of this element
  if (!target.contains(e.relatedTarget)) {
    target.classList.remove("drag-placeholder");
  }
}

// Handle drop
function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  // Remove placeholder class
  this.classList.remove("drag-placeholder");

  if (isCartDragActive()) {
    const cartEntry = getActiveDraggedCartEntry();
    const targetMeta = this.contextMeta || null;
    const targetIndex = Number.isFinite(Number(targetMeta?.insertIndex))
      ? Number(targetMeta.insertIndex)
      : allItems.length;

    try {
      restoreCartEntryToApplicationOrder(cartEntry, targetIndex);
      setUnsavedChanges(true);
      saveChangesBtn.disabled = false;
      resetLayoutBtn.disabled = false;
      updateUI();
      refreshXMLViewer();
      schedulePersistCurrentSession();
      showToast(
        `${getCartEntryDisplayName(cartEntry)} restored to the current page`,
        "success",
      );
    } catch (error) {
      console.error("Error restoring cart item:", error);
      showToast(error.message || String(error), "error");
    } finally {
      resetSharedDragState();
    }

    return false;
  }

  // If source and target are different
  if (dragSourceItem !== this) {
    // Get item data
    const sourceItem = dragSourceItem.itemData;
    const targetItem = this.itemData;
    const targetMeta = this.contextMeta || null;

    if (
      (sourceItem.type === "app" || sourceItem.type === "folder") &&
      targetMeta?.zone === "app-order" &&
      !targetItem
    ) {
      try {
        const moved = moveApplicationOrderTopLevelItem(
          sourceItem,
          Number(targetMeta.insertIndex),
        );

        if (moved) {
          saveChangesBtn.disabled = false;
          resetLayoutBtn.disabled = false;
          updateUI();
          refreshXMLViewer();
        }
      } catch (error) {
        console.error("Error moving application-order item:", error);
        alert("Error moving item: " + error.message);
      }

      return false;
    }

    if (
      (sourceItem.type === "app" || sourceItem.type === "folder") &&
      (targetItem.type === "app" || targetItem.type === "folder")
    ) {
      if (sourceItem.type === "app" && targetItem.type === "folder") {
        openFolderDropChoiceModal("application-order", sourceItem, targetItem);
        return false;
      }

      try {
        swapApplicationOrderTopLevelItems(sourceItem, targetItem);

        saveChangesBtn.disabled = false;
        resetLayoutBtn.disabled = false;

        updateUI();
        refreshXMLViewer();
      } catch (error) {
        console.error("Error swapping application-order items:", error);
        alert("Error swapping items: " + error.message);
      }
    }
  }

  return false;
}

// Handle drag end
function handleDragEnd(e) {
  resetSharedDragState();
}

// Swap apps in virtual buffer
function swapAppsVirtual(packageName1, packageName2) {
  // Find both apps in the virtual buffer
  let app1 = null;
  let app2 = null;
  let folder1Title = null;
  let folder2Title = null;

  // Find apps and their folders
  for (const folderTitle in virtualBuffer.folders) {
    const folderData = virtualBuffer.folders[folderTitle];
    if ("apps" in folderData) {
      if (packageName1 in folderData.apps) {
        app1 = folderData.apps[packageName1];
        folder1Title = folderTitle;
      }
      if (packageName2 in folderData.apps) {
        app2 = folderData.apps[packageName2];
        folder2Title = folderTitle;
      }
    }
  }

  if (!app1) {
    throw new Error(`App with package name '${packageName1}' not found`);
  }

  if (!app2) {
    throw new Error(`App with package name '${packageName2}' not found`);
  }

  // Check if both apps are in the same folder
  if (folder1Title !== folder2Title) {
    throw new Error("Cannot swap apps from different folders");
  }

  // Swap the indices
  const app1Index = app1.index;
  const app2Index = app2.index;

  // Update the indices
  app1.index = app2Index;
  app2.index = app1Index;

  // If swapping apps within a folder (not standalone apps), update screen values
  if (folder1Title !== "no_folder" && folder1Title !== null) {
    // Get the folder containing the apps
    const folderData = virtualBuffer.folders[folder1Title];

    // Create a list of apps with their current indices
    const folderApps = [];
    for (const appPackage in folderData.apps) {
      folderApps.push([appPackage, folderData.apps[appPackage]]);
    }

    // Sort apps by their indices
    folderApps.sort((a, b) => a[1].index - b[1].index);

    // Assign new screen values starting from 0 based on the sorted order
    folderApps.forEach((app, i) => {
      app[1].screen = String(i);
    });
  }

  // Show success toast
  showToast("Successfully swapped apps", "success");

  // Mark that there are unsaved changes
  setUnsavedChanges(true);
}

// Swap folders in virtual buffer
function swapFoldersVirtual(folderTitle1, folderTitle2) {
  // Find both folders in the virtual buffer
  const folder1 = virtualBuffer.folders[folderTitle1];
  const folder2 = virtualBuffer.folders[folderTitle2];

  if (!folder1) {
    throw new Error(`Folder with title '${folderTitle1}' not found`);
  }

  if (!folder2) {
    throw new Error(`Folder with title '${folderTitle2}' not found`);
  }

  // Swap the indices
  const folder1Index = folder1.index;
  const folder2Index = folder2.index;

  // Update the indices
  folder1.index = folder2Index;
  folder2.index = folder1Index;

  // Show success toast
  showToast("Successfully swapped folders", "success");

  // Mark that there are unsaved changes
  setUnsavedChanges(true);
}

function resolveApplicationOrderTopLevelEntry(item) {
  if (!item || !item.type || !item.data) {
    throw new Error("Invalid top-level item");
  }

  if (item.type === "folder") {
    const folderTitle = item.data.title;
    if (!folderTitle || folderTitle === "no_folder") {
      throw new Error("Folder could not be resolved");
    }

    const folderData = virtualBuffer.folders[folderTitle];
    if (!folderData) {
      throw new Error(`Folder with title '${folderTitle}' not found`);
    }

    return {
      type: "folder",
      key: folderTitle,
      ref: folderData,
      label: folderTitle,
    };
  }

  if (item.type === "app") {
    const packageName = item.data["package name"];
    const noFolderApps = virtualBuffer.folders.no_folder?.apps || {};
    const appData = packageName ? noFolderApps[packageName] : null;

    if (!packageName || !appData) {
      throw new Error("Only standalone apps can be swapped at top level");
    }

    return {
      type: "app",
      key: packageName,
      ref: appData,
      label: packageName,
    };
  }

  throw new Error("This item type cannot be reordered here");
}

function swapApplicationOrderTopLevelItems(sourceItem, targetItem) {
  const sourceEntry = resolveApplicationOrderTopLevelEntry(sourceItem);
  const targetEntry = resolveApplicationOrderTopLevelEntry(targetItem);

  if (
    sourceEntry.type === targetEntry.type &&
    sourceEntry.key === targetEntry.key
  ) {
    return;
  }

  const sourceIndex = Number(sourceEntry.ref.index) || 0;
  const targetIndex = Number(targetEntry.ref.index) || 0;

  sourceEntry.ref.index = targetIndex;
  targetEntry.ref.index = sourceIndex;

  showToast("Successfully swapped top-level items", "success");
  setUnsavedChanges(true);

  if (DEBUG) {
    console.log(
      `Swapped application-order items: ${sourceEntry.type}:${sourceEntry.label} <-> ${targetEntry.type}:${targetEntry.label}`,
    );
  }
}

function closeFolderDropChoiceModalUI() {
  const modal = document.getElementById("folder-drop-choice-modal");
  if (modal) {
    modal.style.display = "none";
  }
}

function cancelFolderDropChoice() {
  closeFolderDropChoiceModalUI();
  pendingFolderDropChoice = null;
}

function openFolderDropChoiceModal(kind, sourceItem, targetFolderItem) {
  pendingFolderDropChoice = {
    kind,
    sourceItem,
    targetFolderItem,
  };
  const modal = document.getElementById("folder-drop-choice-modal");
  const msg = document.getElementById("folder-drop-choice-message");
  if (!modal || !msg) return;

  const appLabel = getDisplayName(sourceItem);
  const folderTitle = targetFolderItem?.data?.title || "folder";
  const hint =
    kind === "application-order"
      ? "Swap top-level order with the folder, or move the app inside the folder."
      : "Swap grid positions with the folder, or move the app inside the folder.";
  msg.textContent = `“${appLabel}” onto folder “${folderTitle}”. ${hint}`;
  modal.style.display = "block";
}

function mergeStandaloneAppIntoApplicationOrderFolder(sourceItem, targetFolderItem) {
  if (sourceItem.type !== "app" || targetFolderItem.type !== "folder") {
    throw new Error("Only a standalone app can be merged into a folder");
  }

  const packageName = getItemPackageName(sourceItem);
  if (!packageName) {
    throw new Error("Missing package name");
  }

  const folderTitle = targetFolderItem.data.title;
  if (!folderTitle || folderTitle === "no_folder") {
    throw new Error("Invalid folder");
  }

  const noFolderApps = virtualBuffer.folders.no_folder?.apps || {};
  const appData = noFolderApps[packageName];
  if (!appData) {
    throw new Error("Only standalone apps (outside folders) can be merged into a folder");
  }

  const folderData = virtualBuffer.folders[folderTitle];
  if (!folderData?.apps) {
    throw new Error("Folder not found");
  }

  if (folderData.apps[packageName]) {
    throw new Error("This app is already inside the folder");
  }

  delete virtualBuffer.folders.no_folder.apps[packageName];

  const sorted = getSortedFolderAppsForAppOrder(folderData);
  const nextIndex = sorted.length;
  appData.index = nextIndex;
  appData.screen = String(nextIndex);
  folderData.apps[packageName] = appData;

  reindexApps(folderTitle);
  reindexTopLevelApplicationOrderItems();

  setUnsavedChanges(true);
  showToast(`App merged into folder “${folderTitle}”`, "success");
}

function mergeWorkspaceHomeAppIntoFolder(sourceItem, targetFolderItem) {
  if (sourceItem.type !== "app" || targetFolderItem.type !== "folder") {
    throw new Error("Only a home screen app can be merged into a folder");
  }

  const appData = sourceItem.data;
  const folderBuf = targetFolderItem.data;

  if (appData.type !== "app" || folderBuf.type !== "folder") {
    throw new Error("Invalid items for merge");
  }

  const packageName = appData.packageName;
  if (!packageName) {
    throw new Error("Missing package name");
  }

  const folderIdx = findWorkspaceHomeItemIndex(targetFolderItem);
  if (folderIdx === -1) {
    throw new Error("Folder not found");
  }

  const folderRef = virtualWorkspaceBuffer.home[folderIdx];
  if (!Array.isArray(folderRef.apps)) {
    folderRef.apps = [];
  }

  if (folderRef.apps.some((a) => a.packageName === packageName)) {
    throw new Error("This app is already inside the folder");
  }

  const appIdx = findWorkspaceHomeItemIndex(sourceItem);
  if (appIdx === -1) {
    throw new Error("App not found on workspace");
  }

  virtualWorkspaceBuffer.home.splice(appIdx, 1);

  const newApp = {
    packageName: appData.packageName,
    className: appData.className || "",
    screen: folderRef.apps.length,
    comment:
      appData.comment && String(appData.comment).trim()
        ? ` ${String(appData.comment).trim()} `
        : "",
  };
  if (appData.hidden !== undefined) {
    newApp.hidden = appData.hidden;
  }

  folderRef.apps.push(newApp);
  folderRef.apps.forEach((app, index) => {
    app.screen = index;
  });

  setUnsavedChanges(true);
  showToast(
    `App merged into folder “${folderRef.title || "folder"}”`,
    "success",
  );
}

function applyPendingFolderDropSwap() {
  const pending = pendingFolderDropChoice;
  closeFolderDropChoiceModalUI();
  pendingFolderDropChoice = null;
  if (!pending) return;

  try {
    if (pending.kind === "application-order") {
      swapApplicationOrderTopLevelItems(
        pending.sourceItem,
        pending.targetFolderItem,
      );
    } else {
      swapWorkspaceItems(pending.sourceItem, pending.targetFolderItem);
    }
    saveChangesBtn.disabled = false;
    resetLayoutBtn.disabled = false;
    updateUI();
    refreshXMLViewer();
  } catch (error) {
    console.error("Error swapping app with folder:", error);
    showToast(error.message || String(error), "error");
  }
}

function applyPendingFolderDropMerge() {
  const pending = pendingFolderDropChoice;
  closeFolderDropChoiceModalUI();
  pendingFolderDropChoice = null;
  if (!pending) return;

  try {
    if (pending.kind === "application-order") {
      mergeStandaloneAppIntoApplicationOrderFolder(
        pending.sourceItem,
        pending.targetFolderItem,
      );
    } else {
      mergeWorkspaceHomeAppIntoFolder(
        pending.sourceItem,
        pending.targetFolderItem,
      );
    }
    saveChangesBtn.disabled = false;
    resetLayoutBtn.disabled = false;
    updateUI();
    refreshXMLViewer();
  } catch (error) {
    console.error("Error merging app into folder:", error);
    showToast(error.message || String(error), "error");
  }
}

function moveApplicationOrderTopLevelItem(sourceItem, targetIndex) {
  const sourceEntry = resolveApplicationOrderTopLevelEntry(sourceItem);
  const orderedEntries = getSortedAppOrderItems().map((item) =>
    resolveApplicationOrderTopLevelEntry(item),
  );
  const sourcePosition = orderedEntries.findIndex(
    (entry) =>
      entry.type === sourceEntry.type &&
      entry.key === sourceEntry.key,
  );

  if (sourcePosition === -1) {
    throw new Error("Dragged item could not be resolved");
  }

  const maxIndex = Math.max(0, orderedEntries.length - 1);
  const desiredIndex = Math.max(
    0,
    Math.min(
      Number.isFinite(Number(targetIndex)) ? Number(targetIndex) : maxIndex,
      maxIndex,
    ),
  );

  if (sourcePosition === desiredIndex) {
    return false;
  }

  const [movedEntry] = orderedEntries.splice(sourcePosition, 1);
  orderedEntries.splice(desiredIndex, 0, movedEntry);
  orderedEntries.forEach((entry, index) => {
    entry.ref.index = index;
  });

  showToast("Moved item successfully", "success");
  setUnsavedChanges(true);

  if (DEBUG) {
    console.log(
      `Moved application-order item: ${sourceEntry.type}:${sourceEntry.label} -> index ${desiredIndex}`,
    );
  }

  return true;
}

// Navigate to previous page
function prevPage() {
  if (currentPage > 0) {
    currentPage--;
    updateUI(); // Call updateUI to refresh items for the new page
    schedulePersistCurrentSession();
  }
}

// Navigate to next page
function nextPage() {
  let totalPages;

  if (currentMode === "default-workspace") {
    // For Default Workspace mode, determine the number of screens/pages
    const maxScreen = Math.max(
      ...virtualWorkspaceBuffer.home.map((item) => item.screen),
      0,
    );
    totalPages = maxScreen + 1; // screens are 0-indexed
  } else {
    const cols = getWorkspaceCols();
    const slotRows = getAppOrderSlotRows();
    const itemsPerPage = cols * slotRows;
    totalPages = Math.max(1, Math.ceil(allItems.length / itemsPerPage));
  }

  // In two-page mode, check if the last visible page already shows the end.
  const visiblePages = getVisibleCanvasPages();
  const lastVisible = visiblePages[visiblePages.length - 1];
  if (lastVisible >= totalPages - 1) {
    return;
  }

  if (currentPage < totalPages - 1) {
    currentPage++;
    updateUI(); // Call updateUI to refresh items for the new page
    schedulePersistCurrentSession();
  }
}

// Change mode
function changeMode() {
  const newMode = modeSelect.value;
  if (newMode !== currentMode) {
    currentMode = newMode;

    // Reset to first page
    currentPage = 0;

    // Reload XML data for the new mode, restoring this browser's snapshot when available.
    loadXMLData({ preferSavedSession: true });
  }
}

// Change layout
function changeLayout() {
  const newLayout = layoutSelect.value;
  if (newLayout !== currentLayout) {
    currentLayout = newLayout;
    syncLayoutClasses();
    syncCustomGridPanelVisibility();
    currentPage = 0;
    setUnsavedChanges(true);
    updateUI();
    refreshXMLViewer();
    schedulePersistCurrentSession();
  }
}

function syncCustomGridPanelVisibility() {
  const panel = document.getElementById("custom-grid-panel");
  if (!panel) return;
  panel.style.display = currentLayout === "custom" ? "flex" : "none";
}

function syncCustomGridInputsFromState() {
  const colsInput = document.getElementById("custom-cols");
  const rowsInput = document.getElementById("custom-home-rows");
  if (colsInput) colsInput.value = String(customGridLayout.cols);
  if (rowsInput) rowsInput.value = String(customGridLayout.homeRows);
}

function readCustomGridFromInputs() {
  const colsInput = document.getElementById("custom-cols");
  const rowsInput = document.getElementById("custom-home-rows");
  const c = colsInput ? parseInt(colsInput.value, 10) : 4;
  const r = rowsInput ? parseInt(rowsInput.value, 10) : 6;
  customGridLayout.cols = Math.max(2, Math.min(12, Number.isFinite(c) ? c : 4));
  customGridLayout.homeRows = Math.max(
    1,
    Math.min(12, Number.isFinite(r) ? r : 6),
  );
}

function applyCustomGridLayout() {
  readCustomGridFromInputs();
  currentPage = 0;
  setUnsavedChanges(true);
  updateUI();
  refreshXMLViewer();
  schedulePersistCurrentSession();
  showToast(
    `Custom grid: ${getWorkspaceCols()} columns × ${getWorkspaceHomeRows()} home rows`,
    "success",
  );
}

// Save changes
function saveChanges() {
  try {
    if (xmlEditorDirty) {
      saveXMLEditorChanges();
      return;
    }

    assertNoDuplicateItemsForMode(currentMode);

    if (currentMode === "default-workspace") {
      workspaceData = cloneData(virtualWorkspaceBuffer);
    } else {
      xmlData = cloneData(virtualBuffer);
    }

    rememberCommittedProfile();
    setUnsavedChanges(false);

    refreshXMLViewer({ force: true });
    syncAppChrome();
    showToast("Changes saved successfully!", "success");
  } catch (error) {
    console.error("Error saving changes:", error);
    showToast("Error saving changes: " + error.message, "error");
  }
}

// Reset layout
function resetLayout() {
  try {
    if (xmlEditorDirty && !unsavedChanges) {
      refreshXMLViewer({ force: true });
      showToast("XML editor reset to the current layout", "success");
      return;
    }

    restoreCommittedProfileForMode(currentMode);

    if (currentMode === "default-workspace") {
      virtualWorkspaceBuffer = cloneData(workspaceData);
    } else {
      virtualBuffer = cloneData(xmlData);
    }

    setUnsavedChanges(false);

    updateUI();
    refreshXMLViewer({ force: true });
    showToast("Layout reset to original state!", "success");
  } catch (error) {
    console.error("Error resetting layout:", error);
    showToast("Error resetting layout: " + error.message, "error");
  }
}

// Toggle XML viewer
function toggleXMLViewer() {
  if (xmlPanel.style.display === "none" || xmlPanel.style.display === "") {
    xmlPanel.style.display = "flex";
    if (!xmlContent?.value) {
      refreshXMLViewer({ force: true });
    }
  } else {
    xmlPanel.style.display = "none";
  }
  syncAppChrome();
  requestAnimationFrame(() => updateUI());
}

const XML_INDENT = "    ";
const LAUNCHER_XML_NAMESPACE =
  "http://schemas.android.com/apk/res/com.sec.android.app.launcher";

function getCurrentXMLText() {
  assertNoDuplicateItemsForMode(currentMode);
  if (currentMode === "default-workspace") {
    return generateWorkspaceXMLFromDict();
  }
  return generateXMLFromDict();
}

function getSavedXMLTextForMode(mode = currentMode, profile = getCommittedProfile(mode)) {
  const normalizedProfile = normalizeEditorProfile(profile, mode);
  const gridInfo = getGridInfoFromProfile(normalizedProfile);

  if (mode === "default-workspace") {
    return generateWorkspaceXMLFromBuffer(workspaceData, { gridInfo });
  }

  return generateXMLFromBuffer(xmlData, { gridInfo });
}

function saveXMLEditorChanges(options = {}) {
  const { showSuccessToast = true } = options;
  if (!xmlContent) return;

  const nextXMLText = xmlContent.value;
  if (!nextXMLText.trim()) {
    showToast("Error saving XML: XML text is empty", "error");
    return;
  }

  const previousDirtyState = xmlEditorDirty;
  const previousSyncedText = xmlEditorLastSyncedText;
  const stateSnapshot = {
    profile: createEditorProfileSnapshot(),
    committedProfiles: cloneData(committedEditorProfiles),
    workspaceData: cloneData(workspaceData),
    workingWorkspace: cloneData(virtualWorkspaceBuffer),
    xmlData: cloneData(xmlData),
    workingXml: cloneData(virtualBuffer),
    currentPage,
    currentFolderPage,
    currentFolder: cloneData(currentFolder),
    unsavedChanges,
  };

  try {
    xmlEditorDirty = false;
    const previousMode = stateSnapshot.profile.mode;

    loadXMLContent(nextXMLText, {
      sourceName: "XML editor",
      showDetectionToast: false,
    });
    if (xmlContent) {
      xmlEditorLastSyncedText = xmlContent.value;
    }
    syncXMLPanelChrome();
    syncDirtyActionButtons();
    syncAppChrome();

    requestAnimationFrame(() => {
      if (previousMode !== currentMode) {
        flashLayoutCanvasUpdatedItems(null, { flashAll: true });
      } else if (currentMode === "default-workspace") {
        const beforeMap = buildWorkspaceLayoutFingerprintMap(
          stateSnapshot.workingWorkspace,
        );
        const afterMap = buildWorkspaceLayoutFingerprintMap(
          virtualWorkspaceBuffer,
        );
        const changedKeys = collectChangedLayoutKeys(beforeMap, afterMap);
        flashLayoutCanvasUpdatedItems(changedKeys);
      } else {
        const beforeMap = buildAppOrderLayoutFingerprintMap(
          stateSnapshot.workingXml,
        );
        const afterMap = buildAppOrderLayoutFingerprintMap(virtualBuffer);
        const changedKeys = collectChangedLayoutKeys(beforeMap, afterMap);
        flashLayoutCanvasUpdatedItems(changedKeys);
      }
    });

    if (showSuccessToast) {
      showToast("XML saved and layout updated", "success");
    }
  } catch (error) {
    committedEditorProfiles = cloneData(stateSnapshot.committedProfiles);
    applyEditorProfile(stateSnapshot.profile);
    workspaceData = cloneData(stateSnapshot.workspaceData);
    virtualWorkspaceBuffer = cloneData(stateSnapshot.workingWorkspace);
    xmlData = cloneData(stateSnapshot.xmlData);
    virtualBuffer = cloneData(stateSnapshot.workingXml);
    currentPage = stateSnapshot.currentPage;
    currentFolderPage = stateSnapshot.currentFolderPage;
    currentFolder = cloneData(stateSnapshot.currentFolder);
    setUnsavedChanges(stateSnapshot.unsavedChanges);
    updateUI();

    isSyncingXMLContent = true;
    xmlContent.value = nextXMLText;
    isSyncingXMLContent = false;
    xmlEditorLastSyncedText = previousSyncedText;
    xmlEditorDirty = previousDirtyState;
    syncXMLPanelChrome();
    syncDirtyActionButtons();
    syncAppChrome();
    console.error("Error saving XML editor content:", error);
    showToast("Error saving XML: " + error.message, "error");
  }
}

// Refresh XML viewer
function refreshXMLViewer(options = {}) {
  const { force = false } = options;
  try {
    const nextXMLText = getCurrentXMLText();
    if (force || !xmlEditorDirty || !xmlContent?.value) {
      setXMLContentValue(nextXMLText, { markClean: true });
    }
  } catch (error) {
    if (force || !xmlEditorDirty || !xmlContent?.value) {
      setXMLContentValue(`Error generating XML: ${error.message}`, {
        markClean: true,
      });
    }
  }
  syncAppChrome();
  schedulePersistCurrentSession();
}

function openRawXMLModal() {
  const modal = document.getElementById("raw-xml-modal");
  const textarea = document.getElementById("raw-xml-output");
  if (!modal || !textarea) return;

  try {
    textarea.value = getXMLPanelText();
    modal.style.display = "block";
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.select();
    });
  } catch (error) {
    console.error("Error preparing raw XML:", error);
    showToast("Error preparing XML text: " + error.message, "error");
  }
}

function closeRawXMLModal() {
  const modal = document.getElementById("raw-xml-modal");
  const textarea = document.getElementById("raw-xml-output");
  if (textarea) {
    textarea.value = "";
  }
  if (modal) {
    modal.style.display = "none";
  }
}

async function copyTextToClipboard(text) {
  if (
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      console.warn("Clipboard API write failed, falling back:", error);
    }
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.top = "-1000px";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.focus();
  helper.select();

  const copied = document.execCommand("copy");
  document.body.removeChild(helper);

  if (!copied) {
    throw new Error("Clipboard access was blocked");
  }
}

async function copyCurrentXMLToClipboard() {
  try {
    const xmlText = getXMLPanelText();
    await copyTextToClipboard(xmlText);

    const textarea = document.getElementById("raw-xml-output");
    if (textarea) {
      textarea.value = xmlText;
    }

    showToast("XML copied to clipboard", "success");
  } catch (error) {
    console.error("Error copying XML:", error);
    showToast("Error copying XML: " + error.message, "error");
  }
}

// Apply syntax highlighting to XML content
function highlightXMLSyntax(xmlString) {
  const placeholders = [];
  const savePlaceholder = (html) => {
    const token = `__XML_TOKEN_${placeholders.length}__`;
    placeholders.push(html);
    return token;
  };

  let highlighted = xmlString
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  highlighted = highlighted.replace(/(&lt;\?[^?]*\?&gt;)/g, (match) => {
    return savePlaceholder(`<span class="xml-declaration">${match}</span>`);
  });

  highlighted = highlighted.replace(/(&lt;!--[\s\S]*?--&gt;)/g, (match) => {
    return savePlaceholder(`<span class="xml-comment">${match}</span>`);
  });

  highlighted = highlighted.replace(/(&lt;\/?[^&][\s\S]*?&gt;)/g, (match) => {
    let result = match.replace(
      /(\s+)([a-zA-Z_:][-a-zA-Z0-9_:.]*)(=)/g,
      '$1<span class="xml-attribute">$2</span>$3',
    );

    result = result.replace(
      /(=)(&quot;[\s\S]*?&quot;)/g,
      '$1<span class="xml-value">$2</span>',
    );

    result = result.replace(
      /(&lt;\/?)([^&\s]+)/g,
      '<span class="xml-tag">$1$2</span>',
    );

    return savePlaceholder(result);
  });

  return highlighted.replace(/__XML_TOKEN_(\d+)__/g, (_, index) => {
    return placeholders[Number(index)] || "";
  });
}

function hasXMLValue(value) {
  return value !== undefined && value !== null && value !== "";
}

/** Include attribute in export: `hidden` may be "" and must still round-trip */
function shouldEmitXMLAttribute(name, value) {
  if (value === undefined || value === null) return false;
  if (name === "hidden") return true;
  return hasXMLValue(value);
}

function toComparableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareNumericValues(left, right) {
  return toComparableNumber(left) - toComparableNumber(right);
}

function compareTextValues(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function pushXMLLine(xmlLines, depth, content = "") {
  xmlLines.push(`${XML_INDENT.repeat(depth)}${content}`);
}

function pushXMLSpacer(xmlLines) {
  if (xmlLines.length > 0 && xmlLines[xmlLines.length - 1] !== "") {
    xmlLines.push("");
  }
}

function escapeXMLAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeXMLLineBreaks(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function unwrapXMLComment(comment) {
  return normalizeXMLLineBreaks(comment)
    .replace(/^\s*<!--\s*/, "")
    .replace(/\s*-->\s*$/, "");
}

function normalizeXMLBlockComment(comment) {
  const lines = unwrapXMLComment(comment).split("\n");

  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }
  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  return lines
    .map((line) => line.replace(/\s+$/, "").replace(/--/g, "- -"))
    .join("\n");
}

function normalizeXMLInlineComment(comment) {
  const normalized = normalizeXMLBlockComment(comment);
  if (!normalized) return "";

  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function pushXMLComment(xmlLines, depth, comment) {
  const normalized = normalizeXMLInlineComment(comment);
  if (!normalized) return;
  pushXMLLine(xmlLines, depth, `<!-- ${normalized} -->`);
}

function pushXMLBlockComment(xmlLines, depth, comment) {
  const normalized = normalizeXMLBlockComment(comment);
  if (!normalized) return;

  pushXMLLine(xmlLines, depth, "<!--");
  normalized.split("\n").forEach((line) => {
    pushXMLLine(xmlLines, depth, line);
  });
  pushXMLLine(xmlLines, depth, "-->");
}

function pushStoredXMLPreambleComments(xmlLines, comments) {
  const normalizedComments = Array.isArray(comments)
    ? comments.filter(Boolean)
    : [];

  normalizedComments.forEach((comment) => {
    pushXMLSpacer(xmlLines);
    pushXMLBlockComment(xmlLines, 0, comment);
  });
}

function getRootAttributesForExport(buffer, fallbackAttributes = []) {
  if (Array.isArray(buffer?.rootAttributes) && buffer.rootAttributes.length > 0) {
    return buffer.rootAttributes;
  }
  return fallbackAttributes;
}

function pushXMLTag(xmlLines, depth, tagName, attributes = [], options = {}) {
  const { selfClosing = true, multiline = false } = options;
  const filteredAttributes = attributes.filter(([name, value]) =>
    shouldEmitXMLAttribute(name, value),
  );
  const attributeLines = filteredAttributes.map(
    ([name, value]) => `${name}="${escapeXMLAttribute(value)}"`,
  );

  if (multiline && attributeLines.length > 1) {
    pushXMLLine(xmlLines, depth, `<${tagName}`);
    attributeLines.forEach((attribute, index) => {
      const isLast = index === attributeLines.length - 1;
      const suffix = isLast ? (selfClosing ? " />" : ">") : "";
      pushXMLLine(xmlLines, depth + 1, `${attribute}${suffix}`);
    });
    return;
  }

  const attributesText = attributeLines.length
    ? ` ${attributeLines.join(" ")}`
    : "";
  const closing = selfClosing ? " />" : ">";
  pushXMLLine(xmlLines, depth, `<${tagName}${attributesText}${closing}`);
}

function getSortedAppOrderItems(buffer = virtualBuffer) {
  const topLevelItems = [];
  const folders = buffer.folders || {};

  Object.entries(folders).forEach(([folderTitle, folderData]) => {
    if (folderTitle === "no_folder" || !folderData) return;
    topLevelItems.push({
      type: "folder",
      order: toComparableNumber(folderData.index),
      data: folderData,
    });
  });

  const standaloneApps = folders.no_folder?.apps || {};
  Object.values(standaloneApps).forEach((appData) => {
    topLevelItems.push({
      type: "app",
      order: toComparableNumber(appData.index),
      data: appData,
    });
  });

  return topLevelItems.sort((left, right) => {
    return (
      compareNumericValues(left.order, right.order) ||
      compareTextValues(
        left.data.title || left.data["package name"],
        right.data.title || right.data["package name"],
      )
    );
  });
}

function getSortedFolderAppsForAppOrder(folderData) {
  return Object.values(folderData.apps || {}).sort((left, right) => {
    return (
      compareNumericValues(left.index, right.index) ||
      compareTextValues(left["package name"], right["package name"])
    );
  });
}

function getWorkspaceHomeItemRank(type) {
  switch (type) {
    case "appwidget":
      return 0;
    case "app":
      return 1;
    case "folder":
      return 2;
    default:
      return 99;
  }
}

function getSortedWorkspaceHomeItems(buffer = virtualWorkspaceBuffer) {
  return [...buffer.home].sort((left, right) => {
    return (
      compareNumericValues(left.screen, right.screen) ||
      compareNumericValues(left.y, right.y) ||
      compareNumericValues(left.x, right.x) ||
      compareNumericValues(
        getWorkspaceHomeItemRank(left.type),
        getWorkspaceHomeItemRank(right.type),
      ) ||
      compareTextValues(
        left.title || left.packageName,
        right.title || right.packageName,
      )
    );
  });
}

function getSortedWorkspaceFolderApps(apps) {
  return [...(apps || [])].sort((left, right) => {
    return (
      compareNumericValues(left.screen, right.screen) ||
      compareTextValues(left.packageName, right.packageName)
    );
  });
}

function getSortedHotseatItems(buffer = virtualWorkspaceBuffer) {
  return [...buffer.hotseat].sort((left, right) => {
    return (
      compareNumericValues(
        left.hotseatSlot ?? left.screen,
        right.hotseatSlot ?? right.screen,
      ) || compareTextValues(left.packageName, right.packageName)
    );
  });
}

function pushAppOrderFavorite(xmlLines, depth, itemData) {
  pushXMLComment(xmlLines, depth, itemData.comment);
  pushXMLTag(
    xmlLines,
    depth,
    "favorite",
    [
      ["screen", itemData.screen],
      ["packageName", itemData["package name"]],
      ["className", itemData.class_name],
      ...(itemData.hidden !== undefined ? [["hidden", itemData.hidden]] : []),
    ],
    { selfClosing: true, multiline: true },
  );
}

function pushWorkspaceFavorite(xmlLines, depth, itemData) {
  pushXMLComment(xmlLines, depth, itemData.comment);
  pushXMLTag(
    xmlLines,
    depth,
    "favorite",
    [
      ["screen", itemData.screen],
      ["packageName", itemData.packageName],
      ["className", itemData.className],
      ["x", itemData.x],
      ["y", itemData.y],
      ...(itemData.hidden !== undefined ? [["hidden", itemData.hidden]] : []),
    ],
    { selfClosing: true, multiline: true },
  );
}

function pushWorkspaceWidget(xmlLines, depth, itemData) {
  pushXMLComment(xmlLines, depth, itemData.comment);
  pushXMLTag(
    xmlLines,
    depth,
    "appwidget",
    [
      ["screen", itemData.screen],
      ["packageName", itemData.packageName],
      ["className", itemData.className],
      ["x", itemData.x],
      ["y", itemData.y],
      ["spanX", itemData.spanX],
      ["spanY", itemData.spanY],
      ...(itemData.hidden !== undefined ? [["hidden", itemData.hidden]] : []),
    ],
    { selfClosing: true, multiline: true },
  );
}

// Generate XML from dictionary for Application Order mode
function generateXMLFromBuffer(buffer = virtualBuffer, options = {}) {
  const gridInfo = options.gridInfo || getCurrentGridInfo();
  const xmlLines = [
    buffer.xmlHeader ||
      DEFAULT_XML_HEADER,
  ];

  pushStoredXMLPreambleComments(
    xmlLines,
    buffer.xmlComments?.length
      ? buffer.xmlComments
      : (buffer.xmlComment ? [buffer.xmlComment] : []),
  );

  pushXMLSpacer(xmlLines);
  pushXMLTag(
    xmlLines,
    0,
    "appOrder",
    getRootAttributesForExport(buffer, []),
    { selfClosing: false },
  );
  pushXMLTag(
    xmlLines,
    1,
    "appsGridInfo",
    [["default", gridInfo]],
    { selfClosing: true },
  );

  const topLevelItems = getSortedAppOrderItems(buffer);
  if (topLevelItems.length > 0) {
    pushXMLSpacer(xmlLines);
  }

  topLevelItems.forEach((item, index) => {
    if (index > 0) {
      pushXMLSpacer(xmlLines);
    }

    if (item.type === "folder") {
      const folderData = item.data;
      pushXMLComment(xmlLines, 1, folderData.comment);
      pushXMLTag(
        xmlLines,
        1,
        "folder",
        [
          ["screen", folderData.screen],
          ["postPosition", folderData.postPosition ? "true" : ""],
          ["title", folderData.title],
          ...(folderData.hidden !== undefined ? [["hidden", folderData.hidden]] : []),
        ],
        { selfClosing: false, multiline: true },
      );

      getSortedFolderAppsForAppOrder(folderData).forEach((appData) => {
        pushAppOrderFavorite(xmlLines, 2, appData);
      });

      pushXMLLine(xmlLines, 1, "</folder>");
      return;
    }

    pushAppOrderFavorite(xmlLines, 1, item.data);
  });

  pushXMLLine(xmlLines, 0, "</appOrder>");
  pushStoredXMLPreambleComments(xmlLines, buffer.xmlTrailingComments);
  return xmlLines.join("\n");
}

function generateXMLFromDict() {
  return generateXMLFromBuffer(virtualBuffer);
}

// Generate XML from dictionary for Default Workspace mode
function generateWorkspaceXMLFromBuffer(buffer = virtualWorkspaceBuffer, options = {}) {
  const gridInfo = options.gridInfo || getCurrentGridInfo();
  const xmlLines = [
    buffer.xmlHeader ||
      DEFAULT_XML_HEADER,
  ];

  pushStoredXMLPreambleComments(
    xmlLines,
    buffer.xmlComments?.length
      ? buffer.xmlComments
      : (buffer.xmlComment ? [buffer.xmlComment] : []),
  );

  pushXMLSpacer(xmlLines);
  pushXMLTag(
    xmlLines,
    0,
    "favorites",
    getRootAttributesForExport(buffer, [
      ["xmlns:launcher", LAUNCHER_XML_NAMESPACE],
    ]),
    { selfClosing: false },
  );
  pushXMLTag(
    xmlLines,
    1,
    "homeGridInfo",
    [["default", gridInfo]],
    { selfClosing: true },
  );
  pushXMLSpacer(xmlLines);
  pushXMLLine(xmlLines, 1, "<home>");

  const homeItems = getSortedWorkspaceHomeItems(buffer);
  homeItems.forEach((item, index) => {
    if (index > 0) {
      pushXMLSpacer(xmlLines);
    }

    if (item.type === "appwidget") {
      pushWorkspaceWidget(xmlLines, 2, item);
      return;
    }

    if (item.type === "folder") {
      pushXMLComment(xmlLines, 2, item.comment);
      pushXMLTag(
        xmlLines,
        2,
        "folder",
        [
          ["screen", item.screen],
          ["title", item.title],
          ["postPosition", item.postPosition ? "true" : ""],
          ["x", item.x],
          ["y", item.y],
          ...(item.hidden !== undefined ? [["hidden", item.hidden]] : []),
        ],
        { selfClosing: false, multiline: true },
      );

      getSortedWorkspaceFolderApps(item.apps).forEach((appData) => {
        pushXMLComment(xmlLines, 3, appData.comment);
        pushXMLTag(
          xmlLines,
          3,
          "favorite",
          [
            ["screen", appData.screen],
            ["packageName", appData.packageName],
            ["className", appData.className],
            ...(appData.hidden !== undefined ? [["hidden", appData.hidden]] : []),
          ],
          { selfClosing: true, multiline: true },
        );
      });

      pushXMLLine(xmlLines, 2, "</folder>");
      return;
    }

    pushWorkspaceFavorite(xmlLines, 2, item);
  });

  pushXMLLine(xmlLines, 1, "</home>");
  const hotseatItems = getSortedHotseatItems(buffer);
  if (hotseatItems.length > 0) {
    pushXMLSpacer(xmlLines);
    pushXMLLine(xmlLines, 1, "<hotseat>");

    hotseatItems.forEach((item, index) => {
      if (index > 0) {
        pushXMLSpacer(xmlLines);
      }
      pushXMLComment(xmlLines, 2, item.comment);
      pushXMLTag(
        xmlLines,
        2,
        "favorite",
        [
          ["screen", item.screen],
          ["packageName", item.packageName],
          ["className", item.className],
          ...(item.hidden !== undefined ? [["hidden", item.hidden]] : []),
        ],
        { selfClosing: true, multiline: true },
      );
    });

    pushXMLLine(xmlLines, 1, "</hotseat>");
  }
  pushXMLLine(xmlLines, 0, "</favorites>");
  pushStoredXMLPreambleComments(xmlLines, buffer.xmlTrailingComments);
  return xmlLines.join("\n");
}

function generateWorkspaceXMLFromDict() {
  return generateWorkspaceXMLFromBuffer(virtualWorkspaceBuffer);
}

function exportXML() {
  try {
    let fileName = "";

    if (currentMode === "default-workspace") {
      fileName = `default-workspace_${getTimestamp()}.xml`;
    } else {
      fileName = `application-order_${getTimestamp()}.xml`;
    }

    const xmlContentStr = getCurrentXMLText();

    const blob = new Blob([xmlContentStr], {
      type: "application/xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`XML exported as "${fileName}"`, "success");
  } catch (error) {
    console.error("Error exporting XML:", error);
    showToast("Error exporting XML: " + error.message, "error");
  }
}

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// Open folder
function openFolder(folderData) {
  // Track workspace folders by title + screen so folder actions resolve the right buffer entry.
  currentFolder =
    currentMode === "default-workspace"
      ? {
          title: folderData.title,
          screen: Number(folderData.screen) || 0,
        }
      : { title: folderData.title };
  currentFolderPage = 0;
  resetFolderHistory();

  // Set folder title
  folderTitle.textContent = folderData.title;

  // Update modal-content class based on current layout
  const modalContent = folderModal
    ? folderModal.querySelector(".modal-content")
    : null;
  if (modalContent) {
    if (isTabletLayoutKey()) {
      modalContent.classList.add("tablet");
    } else {
      modalContent.classList.remove("tablet");
    }
  }

  // Update folder UI
  if (currentMode === "default-workspace") {
    updateWorkspaceFolderUI();
  } else {
    // Get folder items from virtual buffer
    const virtualFolderData = virtualBuffer.folders[folderData.title];
    folderItems = [];
    if (virtualFolderData && "apps" in virtualFolderData) {
      for (const packageName in virtualFolderData.apps) {
        folderItems.push({
          type: "app",
          data: virtualFolderData.apps[packageName],
        });
      }
    }

    // Sort apps by index
    folderItems.sort((a, b) => (a.data.index || 0) - (b.data.index || 0));
    updateFolderUI();
  }

  // Show modal
  folderModal.style.display = "block";
  syncFolderHistoryButtons();
}

// Update folder UI
function updateFolderUI() {
  // Update folder items from virtual buffer
  if (currentFolder && currentFolder.title) {
    const virtualFolderData = virtualBuffer.folders[currentFolder.title];
    folderItems = [];
    if (virtualFolderData && "apps" in virtualFolderData) {
      for (const packageName in virtualFolderData.apps) {
        folderItems.push({
          type: "app",
          data: virtualFolderData.apps[packageName],
        });
      }
    }

    // Sort apps by index
    folderItems.sort((a, b) => (a.data.index || 0) - (b.data.index || 0));
  }

  // Update page count
  updateFolderPageNavigation();
  syncFolderItemCount();

  // Render current page
  renderFolderScreen();
}

// Update folder page navigation
function updateFolderPageNavigation() {
  const layoutConfig = getFolderLayoutConfig();
  const itemsPerPage = layoutConfig.cols * layoutConfig.rows;
  const totalPages = Math.max(1, Math.ceil(folderItems.length / itemsPerPage));

  // Update page label
  folderPageInfo.textContent = `${currentFolderPage + 1} / ${totalPages}`;

  // Update button states
  folderPrevBtn.disabled = currentFolderPage <= 0;
  folderNextBtn.disabled = currentFolderPage >= totalPages - 1;

  // Handle case where current page is beyond total pages
  if (currentFolderPage >= totalPages) {
    currentFolderPage = Math.max(0, totalPages - 1);
    folderPageInfo.textContent = `${currentFolderPage + 1} / ${totalPages}`;
  }
}

function getFolderItemDuplicateKey(item) {
  if (!item || item.type !== "app") return "";
  return buildAppDuplicateKey(getItemPackageName(item));
}

function getFolderDuplicateKeySet(items = folderItems) {
  const counts = new Map();
  (items || []).forEach((item) => {
    const key = getFolderItemDuplicateKey(item);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
}

function getFolderDuplicateLabels(items = folderItems) {
  const duplicateKeys = getFolderDuplicateKeySet(items);
  const labels = [];
  const seen = new Set();

  (items || []).forEach((item) => {
    const key = getFolderItemDuplicateKey(item);
    if (!key || !duplicateKeys.has(key) || seen.has(key)) return;
    labels.push(getItemPackageName(item) || getDisplayName(item));
    seen.add(key);
  });

  return labels;
}

function syncFolderStatusPills() {
  const layoutConfig = getFolderLayoutConfig();
  const pageCapacity = Math.max(1, layoutConfig.cols * layoutConfig.rows);
  const count = folderItems.length;
  const pageCount = Math.max(1, Math.ceil(count / pageCapacity));
  const totalCapacity = pageCapacity * pageCount;

  if (folderCapacityPill) {
    folderCapacityPill.textContent = `${count} / ${totalCapacity} slots`;
    folderCapacityPill.title = `${pageCapacity} slots per folder page`;
  }

  if (folderWarningPill) {
    const duplicates = getFolderDuplicateLabels();
    if (duplicates.length > 0) {
      const visibleLabels = duplicates.slice(0, 2).join(", ");
      const suffix = duplicates.length > 2 ? ` +${duplicates.length - 2}` : "";
      folderWarningPill.textContent = `Duplicate ${visibleLabels}${suffix}`;
      folderWarningPill.hidden = false;
    } else {
      folderWarningPill.textContent = "";
      folderWarningPill.hidden = true;
    }
  }
}

// Update the folder item count badge
function syncFolderItemCount() {
  if (folderItemCount) {
    const count = folderItems.length;
    folderItemCount.textContent = count + ' item' + (count !== 1 ? 's' : '');
  }
  syncFolderStatusPills();
  syncFolderHistoryButtons();
}

// Render folder screen
function renderFolderScreen() {
  // Clear existing grid
  folderGrid.innerHTML = "";

  // Set grid class based on layout
  folderGrid.className = "folder-grid";
  if (isTabletLayoutKey()) {
    folderGrid.classList.add("tablet");
  }
  folderGrid.classList.toggle("tablet-eight-cols", currentLayout === "tablet-8x6");

  // Get layout config
  const layoutConfig = getFolderLayoutConfig();
  folderGrid.classList.toggle(
    "grid-many-rows",
    layoutConfig.rows >= GRID_MANY_ROWS_THRESHOLD,
  );
  folderGrid.style.gridTemplateColumns = `repeat(${layoutConfig.cols}, 1fr)`;
  const itemsPerPage = layoutConfig.cols * layoutConfig.rows;

  // Calculate start and end indices for current page
  const startIdx = currentFolderPage * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const pageItems = folderItems.slice(startIdx, endIdx);
  const duplicateKeys = getFolderDuplicateKeySet(folderItems);

  renderRectGridPlaceholders(
    folderGrid,
    layoutConfig.cols,
    layoutConfig.rows,
    1,
    "folder-placeholder",
    ({ col, row }) => ({
      canAdd: true,
      canRemove: false,
      zone: "app-order-folder",
      folderTitle: currentFolder?.title || "",
      inFolder: currentFolder?.title || "",
      insertIndex: startIdx + row * layoutConfig.cols + col,
      screen: currentPage,
    }),
  );

  // Render items in grid
  pageItems.forEach((item, i) => {
    const appItem = document.createElement("div");
    appItem.className = `app-item ${item.type}`;
    if (duplicateKeys.has(getFolderItemDuplicateKey(item))) {
      appItem.classList.add("has-folder-duplicate");
    }
    appItem.dataset.type = item.type;
    appItem.dataset.index = i;
    appItem.style.gridColumn = String((i % layoutConfig.cols) + 1);
    appItem.style.gridRow = String(Math.floor(i / layoutConfig.cols) + 1);

    // Store item data in element
    appItem.itemData = item;
    setContextMeta(appItem, getAppOrderFolderContextMeta(item));

    // Add title attribute for hover tooltip (show package name for apps)
    if (item.type === "app") {
      const packageName = item.data["package name"] || "";
      appItem.title = packageName; // This will show the package name on hover
    }

    appendItemVisuals(appItem, item, { compact: true });
    appendFolderItemRemoveButton(appItem);
    bindItemDoubleClickAction(appItem, item);

    // Add drag and drop events
    appItem.addEventListener("dragstart", handleFolderDragStart);
    appItem.addEventListener("dragover", handleFolderDragOver);
    appItem.addEventListener("dragenter", handleFolderDragEnter);
    appItem.addEventListener("dragleave", handleFolderDragLeave);
    appItem.addEventListener("drop", handleFolderDrop);
    appItem.addEventListener("dragend", handleFolderDragEnd);
    appItem.setAttribute("draggable", true);

    // Add to grid
    folderGrid.appendChild(appItem);
  });
}

// Handle folder drag start
function handleFolderDragStart(e) {
  initializeSharedDragGesture(this, e, "folder-item");
}

// Handle folder drag over
function handleFolderDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = "move";
  return false;
}

// Handle folder drag enter
function handleFolderDragEnter(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.currentTarget.classList.add("drag-placeholder");
  return false;
}

// Handle folder drag leave
function handleFolderDragLeave(e) {
  const target = e.currentTarget;
  if (!target.contains(e.relatedTarget)) {
    target.classList.remove("drag-placeholder");
  }
}

// Handle folder drop
function handleFolderDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  // Remove placeholder class
  this.classList.remove("drag-placeholder");

  // If source and target are different
  if (dragSourceItem !== this) {
    // Get item data
    const sourceItem = dragSourceItem.itemData;
    const targetItem = this.itemData;

    // Only swap apps
    if (sourceItem.type === "app" && targetItem.type === "app") {
      const sourcePackage = sourceItem.data["package name"];
      const targetPackage = targetItem.data["package name"];

      if (sourcePackage && targetPackage) {
        try {
          // Swap the apps in the current folder
          swapFolderApps(sourcePackage, targetPackage);

          // Enable save button since there are unsaved changes
          folderSaveBtn.disabled = false;
          folderResetBtn.disabled = false;

          // Update UI
          updateFolderUI();

          // Refresh XML viewer to show real-time changes
          refreshXMLViewer();

          console.log(
            `Swapped folder apps: ${sourcePackage} <-> ${targetPackage}`,
          );
        } catch (error) {
          console.error("Error swapping apps:", error);
          alert("Error swapping apps: " + error.message);
        }
      }
    }
  }

  return false;
}

// Handle folder drag end
function handleFolderDragEnd(e) {
  resetSharedDragState();
}

// Swap folder apps
function swapFolderApps(packageName1, packageName2) {
  // Find both apps in the virtual buffer
  const folderData = virtualBuffer.folders[currentFolder.title];
  const app1 = folderData.apps[packageName1];
  const app2 = folderData.apps[packageName2];

  if (!app1) {
    throw new Error(`App with package name '${packageName1}' not found`);
  }

  if (!app2) {
    throw new Error(`App with package name '${packageName2}' not found`);
  }

  // Swap the indices
  const app1Index = app1.index;
  const app2Index = app2.index;

  // Update the indices
  app1.index = app2Index;
  app2.index = app1Index;

  // Update the virtual buffer
  virtualBuffer.folders[folderData.title].apps[packageName1].index = app2Index;
  virtualBuffer.folders[folderData.title].apps[packageName2].index = app1Index;

  // Update screen values
  const folderApps = Object.entries(folderData.apps);
  folderApps.sort((a, b) => (a[1].index || 0) - (b[1].index || 0));

  folderApps.forEach((app, i) => {
    app[1].screen = String(i);
    // Update in virtual buffer as well
    virtualBuffer.folders[folderData.title].apps[app[0]].screen = String(i);
  });

  // Show success toast
  showToast("Successfully swapped apps", "success");

  // Mark that there are unsaved changes
  setUnsavedChanges(true);
}

// Navigate to previous folder page
function folderPrevPage() {
  if (currentFolderPage > 0) {
    currentFolderPage--;
    updateFolderPageNavigation();
    if (currentMode === "default-workspace") {
      renderWorkspaceFolderScreen();
    } else {
      renderFolderScreen();
    }
  }
}

// Navigate to next folder page
function folderNextPage() {
  const layoutConfig = getFolderLayoutConfig();
  const itemsPerPage = layoutConfig.cols * layoutConfig.rows;
  const totalPages = Math.max(1, Math.ceil(folderItems.length / itemsPerPage));

  if (currentFolderPage < totalPages - 1) {
    currentFolderPage++;
    updateFolderPageNavigation();
    if (currentMode === "default-workspace") {
      renderWorkspaceFolderScreen();
    } else {
      renderFolderScreen();
    }
  }
}

// Close folder modal
function closeFolderModal() {
  folderModal.style.display = "none";
  currentFolder = null;
  resetFolderHistory();
}

// Save folder changes
function saveFolderChanges() {
  try {
    assertNoDuplicateItemsForMode(currentMode);

    if (currentMode === "default-workspace") {
      workspaceData = cloneData(virtualWorkspaceBuffer);
    } else {
      xmlData = cloneData(virtualBuffer);
    }

    rememberCommittedProfile();
    setUnsavedChanges(false);

    refreshXMLViewer();
    showToast("Folder changes saved successfully!", "success");
  } catch (error) {
    console.error("Error saving folder changes:", error);
    showToast("Error saving folder changes: " + error.message, "error");
  }
}

// Reset folder layout
function resetFolderLayout() {
  try {
    restoreCommittedProfileForMode(currentMode);

    if (currentMode === "default-workspace") {
      virtualWorkspaceBuffer = cloneData(workspaceData);
      updateWorkspaceFolderUI();
    } else {
      virtualBuffer = cloneData(xmlData);
      updateFolderUI();
    }

    setUnsavedChanges(false);

    refreshXMLViewer();
    showToast("Folder layout reset to original state!", "success");
  } catch (error) {
    console.error("Error resetting folder layout:", error);
    showToast("Error resetting folder layout: " + error.message, "error");
  }
}

// ============================================================
// ADD/REMOVE APP FUNCTIONALITY
// ============================================================

function buildDefaultAddModalContext() {
  if (currentMode === "default-workspace") {
    return {
      source: "toolbar",
      zone: "home",
      screen: currentPage,
      x: 0,
      y: 0,
    };
  }

  return {
    source: "toolbar",
    zone: "app-order",
    screen: currentPage,
  };
}

function formatAddContextHint() {
  if (!addModalContext || addModalContext.source === "toolbar") {
    return "";
  }

  if (addModalContext.source === "edit") {
    if (
      addModalContext.zone === "app-order-folder" ||
      addModalContext.zone === "workspace-folder"
    ) {
      return `Editing item in folder "${addModalContext.folderTitle}"`;
    }

    if (addModalContext.zone === "hotseat") {
      return `Editing hotseat slot ${addModalContext.slot + 1}`;
    }

    if (addModalContext.zone === "home") {
      return `Editing page ${addModalContext.screen + 1}, cell (${addModalContext.x}, ${addModalContext.y})`;
    }

    return "Editing selected item";
  }

  if (addModalContext.zone === "hotseat") {
    return `Target hotseat slot ${addModalContext.slot + 1}`;
  }

  if (addModalContext.zone === "home") {
    return `Target home page ${addModalContext.screen + 1}, cell (${addModalContext.x}, ${addModalContext.y})`;
  }

  if (addModalContext.zone === "app-order") {
    return `Target application-order page ${addModalContext.screen + 1}`;
  }

  if (
    addModalContext.zone === "app-order-folder" ||
    addModalContext.zone === "workspace-folder"
  ) {
    return `Target folder "${addModalContext.folderTitle}"`;
  }

  return "";
}

function updateAddContextHint() {
  const hint = document.getElementById("add-context-hint");
  if (!hint) return;

  const text = formatAddContextHint();
  hint.textContent = text;
  hint.style.display = text ? "block" : "none";
}

function getItemModalIntent() {
  const modal = document.getElementById("add-app-modal");
  return modal?.dataset.intent === "edit" ? "edit" : "add";
}

function getModalTypeLabel(type) {
  if (type === "folder") return "Folder";
  if (type === "widget") return "Widget";
  return "App";
}

function isAppOnlyTargetZone(zone) {
  return zone === "hotseat" || zone === "app-order-folder" || zone === "workspace-folder";
}

function normalizeStoredComment(value) {
  return String(value || "").trim();
}

function syncItemModalPresentation() {
  const modal = document.getElementById("add-app-modal");
  const title = document.getElementById("add-app-modal-title");
  const confirmButton = document.getElementById("confirm-add-app");
  const typeSelect = document.getElementById("item-type");
  const searchLabel = document.querySelector('label[for="item-search"]');
  const searchInput = document.getElementById("item-search");
  if (!modal || !title || !confirmButton || !typeSelect) return;

  const typeLabel = getModalTypeLabel(typeSelect.value);
  const intent = getItemModalIntent();
  const zone = getAddTargetZone();
  const appOnlyTarget = isAppOnlyTargetZone(zone);

  if (intent === "edit") {
    title.textContent = `Edit ${typeLabel}`;
    confirmButton.textContent = "Save Changes";
    typeSelect.disabled = true;
    if (searchLabel) {
      searchLabel.textContent =
        typeLabel === "Widget"
          ? "Search Local Widget Data"
          : "Search Local App Data";
    }
    if (searchInput) {
      searchInput.placeholder =
        typeLabel === "Widget"
          ? "Search local widget data to replace this widget"
          : "Search local app data to replace this app";
    }
    return;
  }

  if (appOnlyTarget) {
    title.textContent = "Add App";
  } else if (currentMode === "application-order") {
    title.textContent = "Add Item";
  } else {
    title.textContent =
      getAddTargetZone() === "hotseat" ? "Add App" : "Add Item";
  }

  confirmButton.textContent = `Add ${typeLabel}`;
  typeSelect.disabled = appOnlyTarget;
  if (searchLabel) {
    searchLabel.textContent =
      typeLabel === "Widget" ? "Search Local Widget Data" : "Search Local App Data";
  }
  if (searchInput) {
    searchInput.placeholder =
      typeLabel === "Widget"
        ? "Search local widget data by comment or package name"
        : "Search local app data by comment or package name";
  }
}

function populateEditModalForm(appItem) {
  if (!appItem || !appItem.itemData) return;

  const itemData = appItem.itemData;
  const comment = normalizeStoredComment(getItemComment(itemData));
  const isFolder = itemData.type === "folder";
  const modalType = isFolder ? "folder" : itemData.type === "appwidget" ? "widget" : "app";
  const packageName = isFolder ? "" : getItemPackageName(itemData);
  const className = isFolder ? "" : getItemClassName(itemData);

  document.getElementById("item-type").value = modalType;
  document.getElementById("folder-name").value = isFolder ? itemData.data.title || "" : "";
  document.getElementById("package-name").value = packageName;
  document.getElementById("class-name").value = className;
  document.getElementById("item-comment").value = comment;
  document.getElementById("item-search").value = isFolder ? "" : comment || packageName;

  if (currentMode === "default-workspace") {
    if (addModalContext?.zone === "workspace-folder") {
      document.getElementById("item-screen").value = String(
        addModalContext.folderScreen ?? currentPage,
      );
    } else if (itemData.type === "hotseat-app") {
      document.getElementById("item-screen").value = String(
        itemData.data.hotseatSlot ?? itemData.data.screen ?? 0,
      );
    } else {
      document.getElementById("item-screen").value = String(itemData.data.screen ?? currentPage);
      document.getElementById("pos-x").value = String(itemData.data.x ?? 0);
      document.getElementById("pos-y").value = String(itemData.data.y ?? 0);
    }
  }

  if (itemData.type === "appwidget") {
    document.getElementById("span-x").value = String(itemData.data.spanX || 1);
    document.getElementById("span-y").value = String(itemData.data.spanY || 1);
  }

  clearLayoutSearchResults();
}

function collectItemFormData() {
  const targetZone = getAddTargetZone();
  const itemType = document.getElementById("item-type").value;
  const widgetSpanX =
    itemType === "widget"
      ? parseInt(document.getElementById("span-x").value, 10) || 2
      : 1;
  const widgetSpanY =
    itemType === "widget"
      ? parseInt(document.getElementById("span-y").value, 10) || 1
      : 1;
  return {
    type: itemType,
    name: document.getElementById("folder-name").value.trim(),
    packageName: document.getElementById("package-name").value.trim(),
    className: document.getElementById("class-name").value.trim(),
    screen: parseInt(document.getElementById("item-screen").value, 10) || 0,
    comment: document.getElementById("item-comment").value.trim(),
    inFolder: document.getElementById("in-folder").value,
    x: parseInt(document.getElementById("pos-x").value, 10) || 0,
    y: parseInt(document.getElementById("pos-y").value, 10) || 0,
    spanX: widgetSpanX,
    spanY: widgetSpanY,
    targetZone,
    insertIndex:
      targetZone === "app-order" ||
      targetZone === "app-order-folder" ||
      targetZone === "workspace-folder"
        ? Number(addModalContext?.insertIndex ?? allItems.length)
        : null,
    hotseatSlot:
      targetZone === "hotseat"
        ? Number(addModalContext?.slot ?? 0)
        : null,
    folderTitle: addModalContext?.folderTitle || "",
    folderScreen: Number(addModalContext?.folderScreen ?? addModalContext?.screen ?? currentPage),
  };
}

function clearLayoutSearchResults() {
  const results = document.getElementById("item-search-results");
  if (!results) return;
  results.innerHTML = "";
  results.classList.remove("has-results", "has-message");
  delete results.dataset.selectedKey;
}

function renderLayoutSearchResults(query) {
  const results = document.getElementById("item-search-results");
  const type = document.getElementById("item-type").value;
  if (!results) return;

  if (type !== "app" && type !== "widget") {
    clearLayoutSearchResults();
    return;
  }

  const trimmed = String(query || "").trim();
  if (!trimmed) {
    clearLayoutSearchResults();
    return;
  }

  const matches = searchLayoutCatalog(trimmed, type);
  if (matches.length === 0) {
    results.innerHTML = `<div class="search-results-empty">No ${escapeHtml(type)} matched "${escapeHtml(trimmed)}".</div>`;
    results.classList.add("has-message");
    results.classList.remove("has-results");
    delete results.dataset.selectedKey;
    return;
  }

  results.innerHTML = matches
    .map((entry) => {
      const title = escapeHtml(entry.comment || entry.packageName);
      const packageName = escapeHtml(entry.packageName);
      const typeLabel =
        entry.type === "widget" && entry.span
          ? `Widget ${escapeHtml(entry.span)}`
          : entry.type;

      return `
        <div class="search-result-item" data-search-key="${escapeHtml(entry.key)}">
          <div class="search-result-head">
            <div class="search-result-title">${title}</div>
            <div class="search-result-type">${typeLabel}</div>
          </div>
          <div class="search-result-package">${packageName}</div>
        </div>
      `;
    })
    .join("");
  results.classList.add("has-results");
  results.classList.remove("has-message");
}

function handleLayoutSearchResultClick(event) {
  const resultItem = event.target.closest(".search-result-item");
  if (!resultItem) return;

  const entry = layoutCatalogLookup.get(resultItem.dataset.searchKey);
  if (!entry) return;

  applyCatalogEntryToForm(entry);
}

function applyCatalogEntryToForm(entry) {
  document.getElementById("package-name").value = entry.packageName;
  document.getElementById("class-name").value = entry.className;
  document.getElementById("item-comment").value = entry.comment;

  if (entry.type === "widget") {
    const maxCols = getWorkspaceCols();
    const maxRows = getWorkspaceHomeRows();
    document.getElementById("span-x").value = String(
      Math.max(1, Math.min(maxCols, entry.spanX || 1)),
    );
    document.getElementById("span-y").value = String(
      Math.max(1, Math.min(maxRows, entry.spanY || 1)),
    );
  }

  const searchInput = document.getElementById("item-search");
  const results = document.getElementById("item-search-results");
  searchInput.value = entry.comment || entry.packageName;
  if (results) {
    results.dataset.selectedKey = entry.key;
    results.classList.remove("has-results", "has-message");
    results.innerHTML = "";
  }
}

function syncSearchResultsForCurrentType() {
  const searchInput = document.getElementById("item-search");
  if (!searchInput) return;
  renderLayoutSearchResults(searchInput.value);
}

function applyAddModalContext() {
  const modal = document.getElementById("add-app-modal");
  const typeSelect = document.getElementById("item-type");
  const screenInput = document.getElementById("item-screen");
  const posX = document.getElementById("pos-x");
  const posY = document.getElementById("pos-y");
  const inFolderSelect = document.getElementById("in-folder");
  const zone = getAddTargetZone();

  modal.dataset.targetZone = zone;
  typeSelect.disabled = isAppOnlyTargetZone(zone);

  if (isAppOnlyTargetZone(zone)) {
    typeSelect.value = "app";
  }

  if (zone === "hotseat") {
    typeSelect.value = "app";
    screenInput.value = String(addModalContext?.slot || 0);
    inFolderSelect.value = "";
  } else if (zone === "app-order-folder") {
    screenInput.value = String(addModalContext?.screen ?? currentPage);
    inFolderSelect.value = addModalContext?.folderTitle || "";
  } else if (zone === "workspace-folder") {
    screenInput.value = String(addModalContext?.folderScreen ?? currentPage);
    inFolderSelect.value = addModalContext?.folderTitle || "";
    posX.value = "0";
    posY.value = "0";
  } else {
    screenInput.value = String(addModalContext?.screen ?? currentPage);
    if (addModalContext?.inFolder) {
      inFolderSelect.value = addModalContext.inFolder;
    }
  }

  if (zone === "home") {
    posX.value = String(addModalContext?.x ?? 0);
    posY.value = String(addModalContext?.y ?? 0);
  }

  updateAddContextHint();
}

// Open Add App Modal
function openAddAppModal(context = null) {
  addAppModal = document.getElementById("add-app-modal");
  const modal = addAppModal;
  modal.dataset.intent = "add";
  addModalContext = context || buildDefaultAddModalContext();
  selectedItemForEdit = null;

  // Set modal data attribute for current mode
  modal.dataset.mode = currentMode;

  if (currentMode === "default-workspace") {
    populateWorkspaceFolderDropdown();
  } else {
    populateFolderDropdown();
  }

  // Update position input bounds based on current layout
  updatePositionInputBounds();

  // Reset form
  resetAddAppForm();
  applyAddModalContext();

  // Update field visibility based on current mode and type
  updateModalFieldVisibility();
  syncSearchResultsForCurrentType();

  // Show modal
  modal.style.display = "block";
}

function openEditItemModal(appItem) {
  if (
    !appItem?.itemData ||
    !["app", "hotseat-app", "appwidget", "folder"].includes(appItem.itemData.type)
  ) {
    return;
  }

  addAppModal = document.getElementById("add-app-modal");
  const modal = addAppModal;
  modal.dataset.intent = "edit";
  modal.dataset.mode = currentMode;

  selectedItemForEdit = appItem;
  addModalContext = {
    ...(appItem.contextMeta || {}),
    source: "edit",
  };

  if (currentMode === "default-workspace") {
    populateWorkspaceFolderDropdown();
  } else {
    populateFolderDropdown();
  }
  updatePositionInputBounds();
  resetAddAppForm();
  applyAddModalContext();
  populateEditModalForm(appItem);
  updateModalFieldVisibility();
  syncSearchResultsForCurrentType();

  modal.style.display = "block";
}

// Close Add App Modal
function closeAddAppModal() {
  const modal = document.getElementById("add-app-modal");
  modal.style.display = "none";
  modal.dataset.intent = "add";
  addModalContext = null;
  selectedItemForEdit = null;
  resetAddAppForm();
}

// Reset Add App Form
function resetAddAppForm() {
  document.getElementById("item-type").disabled = false;
  document.getElementById("item-type").value = "app";
  document.getElementById("folder-name").value = "";
  document.getElementById("package-name").value = "";
  document.getElementById("class-name").value = "";
  document.getElementById("item-screen").value = String(currentPage);
  document.getElementById("item-comment").value = "";
  document.getElementById("in-folder").value = "";
  document.getElementById("pos-x").value = "0";
  document.getElementById("pos-y").value = "0";
  document.getElementById("span-x").value = "2";
  document.getElementById("span-y").value = "1";
  document.getElementById("item-search").value = "";
  clearLayoutSearchResults();
  updateAddContextHint();
}

// Update Modal Field Visibility
function updateModalFieldVisibility() {
  const typeSelect = document.getElementById("item-type");
  const type = typeSelect.value;
  const mode = currentMode;
  const zone = getAddTargetZone();
  const intent = getItemModalIntent();

  const folderNameGroup = document.getElementById("folder-name-group");
  const packageNameGroup = document.getElementById("package-name-group");
  const classNameGroup = document.getElementById("class-name-group");
  const widgetSpansGroup = document.getElementById("widget-spans-group");
  const positionGroup = document.getElementById("position-group");
  const screenGroup = document.getElementById("item-screen-group");
  const inFolderGroup = document.getElementById("in-folder-group");
  const searchGroup = document.getElementById("item-search-group");

  // Reset visibility
  folderNameGroup.style.display = "none";
  packageNameGroup.style.display = "block";
  classNameGroup.style.display = "block";
  widgetSpansGroup.style.display = "none";
  positionGroup.style.display = "none";
  screenGroup.style.display = "block";
  inFolderGroup.style.display = "none";
  searchGroup.style.display = "none";

  if (isAppOnlyTargetZone(zone) && type !== "app") {
    typeSelect.value = "app";
  }

  if (mode === "application-order") {
    if (zone === "app-order-folder") {
      screenGroup.style.display = "none";
      inFolderGroup.style.display = "none";
    } else {
      inFolderGroup.style.display = type === "folder" ? "none" : "block";
    }
  } else if (zone === "hotseat") {
    screenGroup.style.display = "none";
  } else if (zone === "workspace-folder") {
    positionGroup.style.display = "none";
    screenGroup.style.display = "none";
    inFolderGroup.style.display = "none";
  } else {
    positionGroup.style.display = "block";
    if (type === "app") {
      inFolderGroup.style.display = "block";
      populateWorkspaceFolderDropdown();
    }
  }

  if (type === "folder") {
    folderNameGroup.style.display = "block";
    packageNameGroup.style.display = "none";
    classNameGroup.style.display = "none";
    searchGroup.style.display = "none";
  } else {
    searchGroup.style.display = "block";
    if (type === "widget" && zone !== "hotseat") {
      widgetSpansGroup.style.display = "block";
    }
  }

  if (intent === "edit") {
    inFolderGroup.style.display = "none";
    if (mode === "application-order" || zone === "workspace-folder") {
      screenGroup.style.display = "none";
    }
  }

  syncItemModalPresentation();
}

// Populate Folder Dropdown (for Application Order mode)
function populateFolderDropdown() {
  const inFolderSelect = document.getElementById("in-folder");
  inFolderSelect.innerHTML = '<option value="">No Folder</option>';

  for (const folderTitle in virtualBuffer.folders) {
    if (folderTitle !== "no_folder") {
      const option = document.createElement("option");
      option.value = folderTitle;
      option.textContent = folderTitle;
      inFolderSelect.appendChild(option);
    }
  }
}

// Populate Workspace Folder Dropdown (for Default Workspace mode)
function populateWorkspaceFolderDropdown() {
  const inFolderSelect = document.getElementById("in-folder");
  inFolderSelect.innerHTML = '<option value="">No Folder</option>';

  // Get folders from virtual workspace buffer
  const folders = virtualWorkspaceBuffer.home.filter(
    (item) => item.type === "folder" && item.screen === currentPage,
  );

  folders.forEach((folder) => {
    const option = document.createElement("option");
    option.value = folder.title;
    option.textContent = folder.title;
    inFolderSelect.appendChild(option);
  });
}

// Update Position Input Bounds
function updatePositionInputBounds() {
  const cols = getWorkspaceCols();
  const homeRows = getWorkspaceHomeRows();
  const posX = document.getElementById("pos-x");
  const posY = document.getElementById("pos-y");
  posX.max = cols - 1;
  posY.max = homeRows - 1;
  const spanX = document.getElementById("span-x");
  const spanY = document.getElementById("span-y");
  if (spanX) spanX.max = Math.min(12, cols);
  if (spanY) spanY.max = Math.min(12, homeRows);
}

// Confirm Add App
function confirmAddApp() {
  let folderHistoryPushed = false;
  try {
    const formData = collectItemFormData();

    if (getItemModalIntent() === "edit") {
      confirmEditItem(formData);
      return;
    }

    // Validate form data
    validateFormData(formData);
    if (isFolderAddFormData(formData)) {
      folderHistoryPushed = pushFolderHistory("add");
    }

    // Add item based on mode
    if (currentMode === "application-order") {
      addToApplicationOrder(formData);
    } else {
      // Default Workspace mode
      if (formData.targetZone === "hotseat") {
        addToWorkspaceHotseat(formData);
      } else if (
        formData.targetZone === "workspace-folder" ||
        (formData.type === "app" && formData.inFolder)
      ) {
        // Add app to existing folder
        addToWorkspaceFolder(formData);
      } else {
        // Add item to home screen
        addToDefaultWorkspace(formData);
      }
    }

    // Enable save button
    setUnsavedChanges(true);
    saveChangesBtn.disabled = false;
    resetLayoutBtn.disabled = false;

    // Update UI
    updateUI();
    refreshXMLViewer();

    // Close modal
    closeAddAppModal();

    showToast(
      `${formData.type === "folder" ? "Folder" : formData.type === "widget" ? "Widget" : "App"} added successfully!`,
      "success",
    );
  } catch (error) {
    if (folderHistoryPushed) {
      popLastFolderHistorySnapshot();
    }
    showToast("Error: " + error.message, "error");
  }
}

function normalizeValidationKeyPart(value) {
  return String(value || "").trim().toLowerCase();
}

function buildAppDuplicateKey(packageName) {
  return normalizeValidationKeyPart(packageName);
}

function buildWidgetDuplicateKey(packageName, className) {
  return `${normalizeValidationKeyPart(packageName)}::${normalizeValidationKeyPart(className)}`;
}

function describeWorkspaceHomeLocation(item) {
  return `home page ${Number(item.screen) + 1}, cell (${Number(item.x)}, ${Number(item.y)})`;
}

function describeWorkspaceFolderLocation(folderItem) {
  return `folder "${folderItem.title}" on page ${Number(folderItem.screen) + 1}`;
}

function describeHotseatLocation(item) {
  return `hotseat slot ${Number(item.screen) + 1}`;
}

function describeAppOrderLocation(folderTitle) {
  return folderTitle === "no_folder"
    ? "top level"
    : `folder "${folderTitle}"`;
}

function buildAppDuplicateScope(mode, container = "") {
  return `${mode}:${container || "outside-folder"}`;
}

function buildWidgetDuplicateScope(mode) {
  return `${mode}:widgets`;
}

function collectValidationEntriesForMode(mode = currentMode) {
  const entries = [];

  if (mode === "application-order") {
    for (const [folderTitle, folderData] of Object.entries(virtualBuffer.folders || {})) {
      const folderApps = folderData?.apps || {};
      for (const [packageName, appData] of Object.entries(folderApps)) {
        entries.push({
          kind: "app",
          key: buildAppDuplicateKey(packageName),
          scope: buildAppDuplicateScope("application-order", folderTitle),
          label: packageName,
          location: describeAppOrderLocation(folderTitle),
          token: `app-order:${folderTitle}:${buildAppDuplicateKey(packageName)}`,
          ref: appData,
        });
      }
    }

    return entries;
  }

  (virtualWorkspaceBuffer.home || []).forEach((item) => {
    if (item.type === "app") {
      entries.push({
        kind: "app",
        key: buildAppDuplicateKey(item.packageName),
        scope: buildAppDuplicateScope("default-workspace", "outside-folder"),
        label: item.packageName,
        location: describeWorkspaceHomeLocation(item),
        token: `workspace-home-app:${Number(item.screen)}:${Number(item.x)}:${Number(item.y)}:${buildAppDuplicateKey(item.packageName)}`,
        ref: item,
      });
      return;
    }

    if (item.type === "appwidget") {
      entries.push({
        kind: "widget",
        key: buildWidgetDuplicateKey(item.packageName, item.className),
        scope: buildWidgetDuplicateScope("default-workspace"),
        label: `${item.packageName} / ${item.className}`,
        location: describeWorkspaceHomeLocation(item),
        token: `workspace-widget:${Number(item.screen)}:${Number(item.x)}:${Number(item.y)}:${buildWidgetDuplicateKey(item.packageName, item.className)}`,
        ref: item,
      });
      return;
    }

    if (item.type === "folder") {
      (item.apps || []).forEach((appData) => {
        entries.push({
          kind: "app",
          key: buildAppDuplicateKey(appData.packageName),
          scope: buildAppDuplicateScope(
            "default-workspace",
            `folder:${item.title}:${Number(item.screen)}`,
          ),
          label: appData.packageName,
          location: describeWorkspaceFolderLocation(item),
          token: `workspace-folder-app:${item.title}:${Number(item.screen)}:${Number(appData.screen)}:${buildAppDuplicateKey(appData.packageName)}`,
          ref: appData,
        });
      });
    }
  });

  (virtualWorkspaceBuffer.hotseat || []).forEach((item) => {
    entries.push({
      kind: "app",
      key: buildAppDuplicateKey(item.packageName),
      scope: buildAppDuplicateScope("default-workspace", "outside-folder"),
      label: item.packageName,
      location: describeHotseatLocation(item),
      token: `workspace-hotseat:${Number(item.screen)}:${buildAppDuplicateKey(item.packageName)}`,
      ref: item,
    });
  });

  return entries;
}

function collectDuplicateIssuesForMode(mode = currentMode) {
  const groups = new Map();

  collectValidationEntriesForMode(mode).forEach((entry) => {
    if (!entry.key) return;
    const groupKey = `${entry.kind}:${entry.scope || "global"}:${entry.key}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        kind: entry.kind,
        scope: entry.scope || "global",
        label: entry.label,
        locations: [],
        tokens: [],
      });
    }

    const group = groups.get(groupKey);
    group.locations.push(entry.location);
    group.tokens.push(entry.token);
  });

  return Array.from(groups.values()).filter((group) => group.locations.length > 1);
}

function formatDuplicateIssues(issues, maxIssues = 6) {
  const visibleIssues = issues.slice(0, maxIssues);
  const lines = visibleIssues.map((issue) => {
    const typeLabel = issue.kind === "widget" ? "Widget" : "App";
    return `- ${typeLabel} "${issue.label}" appears in ${issue.locations.join(", ")}`;
  });

  if (issues.length > visibleIssues.length) {
    lines.push(`- ...and ${issues.length - visibleIssues.length} more duplicate item(s)`);
  }

  return [
    "Duplicate items found in this file:",
    ...lines,
    "Resolve duplicates before rendering, saving, copying, or exporting XML.",
  ].join("\n");
}

function assertNoDuplicateItemsForMode(mode = currentMode) {
  const issues = collectDuplicateIssuesForMode(mode);
  if (issues.length > 0) {
    throw new Error(formatDuplicateIssues(issues));
  }
}

function notifyDuplicateIssuesIfAny(mode = currentMode) {
  const issues = collectDuplicateIssuesForMode(mode);
  if (issues.length === 0) return;

  const duplicateCount = issues.length;
  showToast(
    `Found ${duplicateCount} duplicate ${duplicateCount === 1 ? "item" : "items"}. XML output is blocked until fixed.`,
    "error",
  );
}

function findDuplicateConflictForCandidate(candidate, options = {}) {
  const { mode = currentMode, excludeToken = "" } = options;
  if (!candidate?.key) return null;

  return collectValidationEntriesForMode(mode).find(
    (entry) =>
      entry.kind === candidate.kind &&
      (entry.scope || "global") === (candidate.scope || "global") &&
      entry.key === candidate.key &&
      entry.token !== excludeToken,
  ) || null;
}

function getValidationCandidateFromFormData(formData) {
  if (!formData) return null;

  if (formData.type === "widget") {
    return {
      kind: "widget",
      key: buildWidgetDuplicateKey(formData.packageName, formData.className),
      scope: buildWidgetDuplicateScope(currentMode),
      label: `${formData.packageName} / ${formData.className}`,
    };
  }

  let scope = buildAppDuplicateScope(currentMode, "outside-folder");
  if (currentMode === "application-order") {
    scope = buildAppDuplicateScope(
      "application-order",
      formData.inFolder || "no_folder",
    );
  } else if (formData.inFolder) {
    scope = buildAppDuplicateScope(
      "default-workspace",
      `folder:${formData.inFolder}:${Number(formData.folderScreen ?? currentPage)}`,
    );
  }

  return {
    kind: "app",
    key: buildAppDuplicateKey(formData.packageName),
    scope,
    label: formData.packageName,
  };
}

function getValidationCandidateFromItem(item) {
  if (!item) return null;

  if (item.type === "appwidget") {
    return {
      kind: "widget",
      key: buildWidgetDuplicateKey(getItemPackageName(item), getItemClassName(item)),
      scope: buildWidgetDuplicateScope(currentMode),
    };
  }

  let scope = buildAppDuplicateScope(currentMode, "outside-folder");
  if (currentMode === "application-order") {
    const packageName = getItemPackageName(item);
    const location = findApplicationOrderAppLocation(packageName, item.data);
    scope = buildAppDuplicateScope(
      "application-order",
      location?.folderTitle || "no_folder",
    );
  } else {
    const folderLocation = findWorkspaceFolderAppLocation(
      getItemPackageName(item),
      item.data,
    );
    if (folderLocation) {
      scope = buildAppDuplicateScope(
        "default-workspace",
        `folder:${folderLocation.folderTitle}:${Number(folderLocation.folderScreen)}`,
      );
    }
  }

  return {
    kind: "app",
    key: buildAppDuplicateKey(getItemPackageName(item)),
    scope,
  };
}

function ensureCandidateIsUnique(candidate, options = {}) {
  const conflict = findDuplicateConflictForCandidate(candidate, options);
  if (!conflict) return;

  const typeLabel = candidate.kind === "widget" ? "Widget" : "App";
  if (candidate.kind === "app") {
    const outsideFolderScope = /outside-folder|no_folder$/i.test(candidate.scope || "");
    const scopeLabel = outsideFolderScope
      ? "outside folders"
      : "in this folder";
    throw new Error(`${typeLabel} already exists ${scopeLabel} (${conflict.location})`);
  }

  throw new Error(`${typeLabel} already exists in this file (${conflict.location})`);
}

function getValidationExcludeTokenForEditTarget(targetItem) {
  if (!targetItem?.itemData) return "";

  if (currentMode === "application-order") {
    const packageName = getItemPackageName(targetItem.itemData);
    const location = findApplicationOrderAppLocation(packageName, targetItem.itemData.data);
    return location
      ? `app-order:${location.folderTitle}:${buildAppDuplicateKey(packageName)}`
      : "";
  }

  const itemData = targetItem.itemData;
  const packageName = getItemPackageName(itemData);

  if (itemData.type === "hotseat-app") {
    const slot = Number(itemData.data.hotseatSlot ?? itemData.data.screen ?? -1);
    return `workspace-hotseat:${slot}:${buildAppDuplicateKey(packageName)}`;
  }

  if (itemData.type === "appwidget") {
    return `workspace-widget:${Number(itemData.data.screen)}:${Number(itemData.data.x)}:${Number(itemData.data.y)}:${buildWidgetDuplicateKey(packageName, getItemClassName(itemData))}`;
  }

  const folderLocation = findWorkspaceFolderAppLocation(packageName, itemData.data);
  if (folderLocation) {
    return `workspace-folder-app:${folderLocation.folderTitle}:${Number(folderLocation.folderScreen)}:${Number(folderLocation.appData.screen)}:${buildAppDuplicateKey(packageName)}`;
  }

  return `workspace-home-app:${Number(itemData.data.screen)}:${Number(itemData.data.x)}:${Number(itemData.data.y)}:${buildAppDuplicateKey(packageName)}`;
}

function findApplicationOrderAppLocation(packageName, appDataRef = null) {
  for (const folderTitle in virtualBuffer.folders) {
    const folderApps = virtualBuffer.folders[folderTitle]?.apps;
    if (!folderApps) continue;

    if (appDataRef) {
      for (const [appPackage, appData] of Object.entries(folderApps)) {
        if (appData === appDataRef && (!packageName || appPackage === packageName)) {
          return {
            folderTitle,
            appData,
            packageName: appPackage,
          };
        }
      }
    }

    if (packageName && packageName in folderApps) {
      return {
        folderTitle,
        appData: folderApps[packageName],
        packageName,
      };
    }
  }
  return null;
}

function findApplicationOrderFolderLocation(folderDataRef = null, folderTitle = "") {
  for (const [title, folderData] of Object.entries(virtualBuffer.folders || {})) {
    if (title === "no_folder" || !folderData) {
      continue;
    }

    if (folderDataRef && folderData === folderDataRef) {
      return {
        folderTitle: title,
        folderData,
      };
    }

    if (folderTitle && title === folderTitle) {
      return {
        folderTitle: title,
        folderData,
      };
    }
  }

  return null;
}

function findWorkspaceFolder(title, screen) {
  return (
    virtualWorkspaceBuffer.home.find(
      (item) =>
        item.type === "folder" &&
        item.title === title &&
        Number(item.screen) === Number(screen),
    ) || null
  );
}

function findWorkspaceFolderAppLocation(
  packageName,
  appDataRef = null,
  folderTitle = "",
  folderScreen = null,
) {
  const folders = (virtualWorkspaceBuffer.home || []).filter((item) => {
    if (item.type !== "folder") {
      return false;
    }

    if (folderTitle && item.title !== folderTitle) {
      return false;
    }

    if (folderScreen !== null && folderScreen !== undefined) {
      return Number(item.screen) === Number(folderScreen);
    }

    return true;
  });

  for (const folder of folders) {
    const apps = Array.isArray(folder.apps) ? folder.apps : [];
    const appIndex = apps.findIndex((app) => {
      if (appDataRef) {
        return app === appDataRef && (!packageName || app.packageName === packageName);
      }

      return app.packageName === packageName;
    });

    if (appIndex !== -1) {
      return {
        folder,
        folderTitle: folder.title,
        folderScreen: Number(folder.screen) || 0,
        appData: apps[appIndex],
        appIndex,
      };
    }
  }

  return null;
}

function validateEditFormData(formData, targetItem) {
  if (!targetItem?.itemData) {
    throw new Error("No item selected for editing");
  }

  if (formData.type === "folder") {
    if (!formData.name) {
      throw new Error("Folder name is required");
    }

    if (currentMode === "application-order") {
      const folderLocation = findApplicationOrderFolderLocation(
        targetItem.itemData.data,
        targetItem.itemData.data?.title,
      );
      if (!folderLocation?.folderData) {
        throw new Error("Selected folder was not found");
      }

      const duplicateFolder = virtualBuffer.folders[formData.name];
      if (duplicateFolder && duplicateFolder !== folderLocation.folderData) {
        throw new Error("Folder with this name already exists");
      }
      return;
    }

    const workspaceFolder = targetItem.itemData.data;
    const duplicateFolder = virtualWorkspaceBuffer.home.find(
      (item) =>
        item.type === "folder" &&
        item.title === formData.name &&
        Number(item.screen) === Number(formData.screen) &&
        item !== workspaceFolder,
    );
    if (duplicateFolder) {
      throw new Error("Folder with this name already exists on this screen");
    }

    validatePosition(
      formData.x,
      formData.y,
      formData.screen,
      "folder",
      1,
      1,
      workspaceFolder,
    );
    return;
  }

  if (!formData.packageName) {
    throw new Error("Package name is required");
  }
  if (!formData.className) {
    throw new Error("Class name is required");
  }

  if (currentMode === "application-order") {
    const nextCandidate = getValidationCandidateFromFormData(formData);
    const currentCandidate = getValidationCandidateFromItem(targetItem.itemData);
    if (nextCandidate?.key !== currentCandidate?.key) {
      ensureCandidateIsUnique(nextCandidate, {
        mode: "application-order",
        excludeToken: getValidationExcludeTokenForEditTarget(targetItem),
      });
    }
    return;
  }

  const nextCandidate = getValidationCandidateFromFormData(formData);
  const currentCandidate = getValidationCandidateFromItem(targetItem.itemData);
  if (nextCandidate?.key !== currentCandidate?.key) {
    ensureCandidateIsUnique(nextCandidate, {
      mode: "default-workspace",
      excludeToken: getValidationExcludeTokenForEditTarget(targetItem),
    });
  }

  if (targetItem.itemData.type === "hotseat-app") {
    return;
  }

  if (targetItem.contextMeta?.zone === "workspace-folder") {
    return;
  }

  validatePosition(
    formData.x,
    formData.y,
    formData.screen,
    formData.type,
    formData.spanX,
    formData.spanY,
    targetItem.itemData.data,
  );
}

function updateApplicationOrderItem(targetItem, formData) {
  if (targetItem.itemData.type === "folder") {
    const folderLocation = findApplicationOrderFolderLocation(
      targetItem.itemData.data,
      targetItem.itemData.data?.title,
    );
    if (!folderLocation?.folderData) {
      throw new Error("Selected folder was not found");
    }

    const updatedFolder = folderLocation.folderData;
    updatedFolder.title = formData.name;
    updatedFolder.comment = formData.comment ? ` ${formData.comment} ` : "";

    if (formData.name !== folderLocation.folderTitle) {
      delete virtualBuffer.folders[folderLocation.folderTitle];
      virtualBuffer.folders[formData.name] = updatedFolder;
    }
    return;
  }

  const originalPackage = getItemPackageName(targetItem.itemData);
  const location = findApplicationOrderAppLocation(
    originalPackage,
    targetItem.itemData.data,
  );

  if (!location || !location.appData) {
    throw new Error("Selected app was not found");
  }

  const updatedApp = location.appData;
  updatedApp["package name"] = formData.packageName;
  updatedApp.class_name = formData.className;
  updatedApp.comment = formData.comment ? ` ${formData.comment} ` : "";

  if (formData.packageName !== originalPackage) {
    delete virtualBuffer.folders[location.folderTitle].apps[originalPackage];
  }

  virtualBuffer.folders[location.folderTitle].apps[formData.packageName] = updatedApp;
}

function updateDefaultWorkspaceItem(targetItem, formData) {
  const targetType = targetItem.itemData.type;

  if (targetType === "hotseat-app") {
    const originalPackage = getItemPackageName(targetItem.itemData);
    const hotseatSlot = Number(
      targetItem.itemData.data.hotseatSlot ?? targetItem.itemData.data.screen ?? -1,
    );
    const hotseatItem = virtualWorkspaceBuffer.hotseat.find(
      (item) =>
        item.packageName === originalPackage && Number(item.screen) === hotseatSlot,
    );

    if (!hotseatItem) {
      throw new Error("Selected hotseat app was not found");
    }

    hotseatItem.packageName = formData.packageName;
    hotseatItem.className = formData.className;
    hotseatItem.comment = formData.comment ? ` ${formData.comment} ` : "";
    return;
  }

  if (targetType === "folder") {
    const workspaceFolder = targetItem.itemData.data;
    if (!workspaceFolder) {
      throw new Error("Selected folder was not found");
    }

    workspaceFolder.title = formData.name;
    workspaceFolder.comment = formData.comment ? ` ${formData.comment} ` : "";
    workspaceFolder.screen = formData.screen;
    workspaceFolder.x = formData.x;
    workspaceFolder.y = formData.y;
    return;
  }

  const folderLocation = findWorkspaceFolderAppLocation(
    getItemPackageName(targetItem.itemData),
    targetItem.itemData.data,
    targetItem.contextMeta?.folderTitle,
    targetItem.contextMeta?.folderScreen,
  );
  if (folderLocation) {
    folderLocation.appData.packageName = formData.packageName;
    folderLocation.appData.className = formData.className;
    folderLocation.appData.comment = formData.comment ? ` ${formData.comment} ` : "";
    return;
  }

  const workspaceItem = targetItem.itemData.data;
  if (!workspaceItem) {
    throw new Error("Selected item was not found");
  }

  workspaceItem.packageName = formData.packageName;
  workspaceItem.className = formData.className;
  workspaceItem.comment = formData.comment ? ` ${formData.comment} ` : "";
  workspaceItem.screen = formData.screen;
  workspaceItem.x = formData.x;
  workspaceItem.y = formData.y;

  if (targetType === "appwidget") {
    workspaceItem.spanX = formData.spanX;
    workspaceItem.spanY = formData.spanY;
  }
}

function confirmEditItem(formData) {
  validateEditFormData(formData, selectedItemForEdit);

  if (currentMode === "application-order") {
    updateApplicationOrderItem(selectedItemForEdit, formData);
  } else {
    updateDefaultWorkspaceItem(selectedItemForEdit, formData);
  }

  setUnsavedChanges(true);
  saveChangesBtn.disabled = false;
  resetLayoutBtn.disabled = false;

  updateUI();
  refreshXMLViewer();
  closeAddAppModal();

  showToast(
    `${getModalTypeLabel(formData.type)} updated successfully!`,
    "success",
  );
}

// Validate Form Data
function validateFormData(formData) {
  if (currentMode === "default-workspace" && formData.targetZone === "hotseat") {
    if (formData.type !== "app") {
      throw new Error("Hotseat only supports apps");
    }
  }

  // Validate type-specific fields
  if (formData.type === "folder") {
    if (!formData.name) {
      throw new Error("Folder name is required");
    }

    if (currentMode === "application-order") {
      if (virtualBuffer.folders[formData.name]) {
        throw new Error("Folder with this name already exists");
      }
    } else {
      const duplicateFolder = virtualWorkspaceBuffer.home.find(
        (item) =>
          item.type === "folder" &&
          item.title === formData.name &&
          item.screen === formData.screen,
      );
      if (duplicateFolder) {
        throw new Error("Folder with this name already exists on this screen");
      }

      if (formData.targetZone === "hotseat") {
        throw new Error("Hotseat only supports apps");
      }

      if (formData.x === undefined || formData.y === undefined) {
        throw new Error("Position (X, Y) is required");
      }

      validatePosition(formData.x, formData.y, formData.screen, "folder", 1, 1);
    }
  } else {
    if (!formData.packageName) {
      throw new Error("Package name is required");
    }
    if (!formData.className) {
      throw new Error("Class name is required");
    }

    // Check if app already exists in Application Order mode
    if (currentMode === "application-order") {
      ensureCandidateIsUnique(getValidationCandidateFromFormData(formData), {
        mode: "application-order",
      });
    }

    // For Default Workspace mode, check if adding to folder or standalone
    if (currentMode === "default-workspace") {
      ensureCandidateIsUnique(getValidationCandidateFromFormData(formData), {
        mode: "default-workspace",
      });

      if (formData.targetZone === "hotseat") {
        const cols = getWorkspaceCols();
        if (formData.type !== "app") {
          throw new Error("Hotseat only supports apps");
        }
        if (
          formData.hotseatSlot === null ||
          formData.hotseatSlot < 0 ||
          formData.hotseatSlot >= cols
        ) {
          throw new Error(`Hotseat slot must be between 0 and ${cols - 1}`);
        }
        const existingHotseatItem = virtualWorkspaceBuffer.hotseat.find(
          (item) => Number(item.screen) === Number(formData.hotseatSlot),
        );
        if (existingHotseatItem) {
          throw new Error("Selected hotseat slot is already occupied");
        }
      } else if (formData.type === "app" && formData.inFolder) {
        // Adding to folder - validate folder exists
        const folder = findWorkspaceFolder(
          formData.inFolder,
          formData.folderScreen ?? currentPage,
        );
        if (!folder) {
          throw new Error("Selected folder not found");
        }
      } else {
        // Standalone item - validate position
        if (formData.x === undefined || formData.y === undefined) {
          throw new Error("Position (X, Y) is required");
        }
        validatePosition(
          formData.x,
          formData.y,
          formData.screen,
          formData.type,
          formData.spanX,
          formData.spanY,
        );
      }
    }
  }
}

// Add to Application Order Mode
function shiftTopLevelApplicationOrderIndices(fromIndex) {
  const startIndex = Number.isFinite(Number(fromIndex)) ? Number(fromIndex) : 0;

  for (const folderTitle in virtualBuffer.folders) {
    if (folderTitle !== "no_folder") {
      const folderData = virtualBuffer.folders[folderTitle];
      if ((folderData.index || 0) >= startIndex) {
        folderData.index = (folderData.index || 0) + 1;
      }
    }
  }

  const noFolderApps = virtualBuffer.folders.no_folder?.apps || {};
  for (const packageName in noFolderApps) {
    const appData = noFolderApps[packageName];
    if ((appData.index || 0) >= startIndex) {
      appData.index = (appData.index || 0) + 1;
    }
  }
}

function shiftFolderApplicationOrderIndices(folderTitle, fromIndex) {
  const folderData = virtualBuffer.folders[folderTitle];
  if (!folderData?.apps) {
    return;
  }

  const startIndex = Number.isFinite(Number(fromIndex)) ? Number(fromIndex) : 0;
  for (const appData of Object.values(folderData.apps)) {
    if ((appData.index || 0) >= startIndex) {
      appData.index = (appData.index || 0) + 1;
    }
  }
}

function reindexTopLevelApplicationOrderItems() {
  const topLevelItems = [];

  for (const folderTitle in virtualBuffer.folders) {
    if (folderTitle !== "no_folder") {
      topLevelItems.push({
        type: "folder",
        key: folderTitle,
        data: virtualBuffer.folders[folderTitle],
      });
    }
  }

  const noFolderApps = virtualBuffer.folders.no_folder?.apps || {};
  for (const packageName in noFolderApps) {
    topLevelItems.push({
      type: "app",
      key: packageName,
      data: noFolderApps[packageName],
    });
  }

  topLevelItems
    .sort((a, b) => (a.data.index || 0) - (b.data.index || 0))
    .forEach((item, index) => {
      item.data.index = index;
    });
}

function addToApplicationOrder(formData) {
  const insertIndex = Number.isFinite(Number(formData.insertIndex))
    ? Number(formData.insertIndex)
    : allItems.length;

  if (formData.type === "folder") {
    shiftTopLevelApplicationOrderIndices(insertIndex);
    virtualBuffer.folders[formData.name] = {
      title: formData.name,
      screen: String(formData.screen),
      apps: {},
      index: insertIndex,
      comment: formData.comment ? ` ${formData.comment} ` : "",
    };
  } else {
    const targetFolder = formData.inFolder || "no_folder";

    if (!virtualBuffer.folders[targetFolder]) {
      virtualBuffer.folders[targetFolder] = {
        title: targetFolder,
        screen: String(formData.screen),
        apps: {},
        index: Object.keys(virtualBuffer.folders).length,
        comment: "",
      };
    }

    const folderData = virtualBuffer.folders[targetFolder];
    const appCount = Object.keys(folderData.apps).length;
    const insertIndex = Number.isFinite(Number(formData.insertIndex))
      ? Number(formData.insertIndex)
      : appCount;

    if (targetFolder === "no_folder") {
      shiftTopLevelApplicationOrderIndices(insertIndex);
    } else {
      shiftFolderApplicationOrderIndices(targetFolder, insertIndex);
    }

    folderData.apps[formData.packageName] = {
      screen: String(insertIndex),
      "package name": formData.packageName,
      class_name: formData.className,
      index: insertIndex,
      comment: formData.comment ? ` ${formData.comment} ` : "",
    };

    if (targetFolder !== "no_folder") {
      reindexApps(targetFolder);
    }
  }
}

// Add to Default Workspace Mode (standalone items)
function addToDefaultWorkspace(formData) {
  const newItem = {
    screen: formData.screen,
    comment: formData.comment ? ` ${formData.comment} ` : "",
  };

  if (formData.type === "folder") {
    newItem.type = "folder";
    newItem.title = formData.name;
    newItem.x = formData.x;
    newItem.y = formData.y;
    newItem.apps = [];
    newItem.postPosition = false;
  } else if (formData.type === "app") {
    newItem.type = "app";
    newItem.packageName = formData.packageName;
    newItem.className = formData.className;
    newItem.x = formData.x;
    newItem.y = formData.y;
  } else if (formData.type === "widget") {
    newItem.type = "appwidget";
    newItem.packageName = formData.packageName;
    newItem.className = formData.className;
    newItem.x = formData.x;
    newItem.y = formData.y;
    newItem.spanX = formData.spanX;
    newItem.spanY = formData.spanY;
  }

  virtualWorkspaceBuffer.home.push(newItem);
}

function addToWorkspaceHotseat(formData) {
  virtualWorkspaceBuffer.hotseat.push({
    type: "app",
    packageName: formData.packageName,
    className: formData.className,
    screen: Number(formData.hotseatSlot),
    comment: formData.comment ? ` ${formData.comment} ` : "",
  });
  virtualWorkspaceBuffer.hotseat.sort((a, b) => (a.screen || 0) - (b.screen || 0));
}

// Add App to Workspace Folder
function addToWorkspaceFolder(formData) {
  const folder = findWorkspaceFolder(
    formData.inFolder,
    formData.folderScreen ?? currentPage,
  );

  if (!folder) {
    throw new Error("Folder not found");
  }

  if (!Array.isArray(folder.apps)) {
    folder.apps = [];
  }

  const insertIndex = Number.isFinite(Number(formData.insertIndex))
    ? Number(formData.insertIndex)
    : folder.apps.length;
  folder.apps.splice(insertIndex, 0, {
    packageName: formData.packageName,
    className: formData.className,
    screen: insertIndex,
    comment: formData.comment ? ` ${formData.comment} ` : "",
  });

  folder.apps.forEach((app, index) => {
    app.screen = index;
  });
}

// Validate Position
function validatePosition(
  x,
  y,
  screen,
  type,
  spanX = 1,
  spanY = 1,
  excludeItem = null,
) {
  const cols = getWorkspaceCols();
  const homeRows = getWorkspaceHomeRows();

  if (x < 0 || x >= cols) {
    throw new Error(`X position must be between 0 and ${cols - 1}`);
  }
  if (y < 0 || y >= homeRows) {
    throw new Error(`Y position must be between 0 and ${homeRows - 1}`);
  }

  if (type === "widget") {
    if (x + spanX > cols) {
      throw new Error("Widget exceeds grid width");
    }
    if (y + spanY > homeRows) {
      throw new Error("Widget exceeds grid height");
    }
  }

  // Check for overlaps
  const itemsOnScreen = virtualWorkspaceBuffer.home.filter(
    (item) => item.screen === screen,
  );

  for (const item of itemsOnScreen) {
    if (excludeItem && item === excludeItem) {
      continue;
    }

    const itemSpanX = item.spanX || 1;
    const itemSpanY = item.spanY || 1;

    // Check overlap
    const overlap = !(
      x + spanX <= item.x ||
      item.x + itemSpanX <= x ||
      y + spanY <= item.y ||
      item.y + itemSpanY <= y
    );

    if (overlap) {
      throw new Error("Position overlaps with existing item");
    }
  }
}

// ============================================================
// CART / PAGE TRANSFER
// ============================================================

function isCartDragActive() {
  return Boolean(dragSourceItem?.dataset?.dragOrigin === "cart");
}

function getActiveDraggedItemData() {
  return dragSourceItem?.itemData || null;
}

function findCartEntryById(cartId) {
  return cartItems.find((entry) => entry.id === cartId) || null;
}

function getActiveDraggedCartEntry() {
  if (!isCartDragActive()) {
    return null;
  }
  return findCartEntryById(dragSourceItem?.dataset?.cartId || "");
}

function createCartPreviewItem(entry) {
  if (!entry?.payload) {
    return null;
  }

  if (entry.type === "widget") {
    return {
      type: "appwidget",
      data: {
        packageName: entry.payload.packageName || "",
        className: entry.payload.className || "",
        comment: entry.payload.comment || "",
        spanX: Math.max(1, Number(entry.payload.spanX) || 1),
        spanY: Math.max(1, Number(entry.payload.spanY) || 1),
        ...(entry.payload.hidden !== undefined
          ? { hidden: entry.payload.hidden }
          : {}),
      },
    };
  }

  return {
    type: "app",
    data: {
      packageName: entry.payload.packageName || "",
      className: entry.payload.className || "",
      comment: entry.payload.comment || "",
      ...(entry.payload.hidden !== undefined
        ? { hidden: entry.payload.hidden }
        : {}),
    },
  };
}

function getCartEntryDisplayName(entry) {
  const previewItem = createCartPreviewItem(entry);
  return previewItem ? getDisplayName(previewItem) : "Item";
}

function getCartEntryModeLabel(entry) {
  return entry?.mode === "application-order"
    ? "Application Order"
    : "Default Workspace";
}

function buildCartEntryKey(entry) {
  if (!entry?.payload) {
    return "";
  }

  return entry.type === "widget"
    ? `widget:${buildWidgetDuplicateKey(
        entry.payload.packageName,
        entry.payload.className,
      )}`
    : `app:${buildAppDuplicateKey(entry.payload.packageName)}`;
}

function findCartConflictForEntry(entry, options = {}) {
  const { excludeId = "" } = options;
  const entryKey = buildCartEntryKey(entry);
  if (!entryKey) {
    return null;
  }

  return (
    cartItems.find(
      (existing) =>
        existing.mode === entry.mode &&
        existing.id !== excludeId &&
        buildCartEntryKey(existing) === entryKey,
    ) || null
  );
}

function findValidationConflictForCartEntry(entry, mode = currentMode) {
  if (!entry?.payload) {
    return null;
  }

  const duplicateKey =
    entry.type === "widget"
      ? buildWidgetDuplicateKey(
          entry.payload.packageName,
          entry.payload.className,
        )
      : buildAppDuplicateKey(entry.payload.packageName);

  if (!duplicateKey) {
    return null;
  }

  return (
    collectValidationEntriesForMode(mode).find(
      (candidate) =>
        candidate.kind === (entry.type === "widget" ? "widget" : "app") &&
        candidate.key === duplicateKey,
    ) || null
  );
}

function canRestoreCartEntryInMode(entry, mode = currentMode) {
  if (!entry || entry.mode !== mode) {
    return false;
  }

  if (mode === "application-order" && entry.type !== "app") {
    return false;
  }

  return true;
}

function ensureCartEntryCanBeRestored(entry, mode = currentMode) {
  if (!entry) {
    throw new Error("Cart item was not found");
  }

  if (!canRestoreCartEntryInMode(entry, mode)) {
    throw new Error(
      `This cart item belongs to ${getCartEntryModeLabel(entry)} mode`,
    );
  }

  const conflict = findValidationConflictForCartEntry(entry, mode);
  if (!conflict) {
    return;
  }

  const typeLabel = entry.type === "widget" ? "Widget" : "App";
  throw new Error(`${typeLabel} already exists on canvas (${conflict.location})`);
}

function canItemBeSentToCart(itemLike, meta = null) {
  if (!itemLike) {
    return false;
  }

  if (itemLike.type === "appwidget") {
    return currentMode === "default-workspace" && meta?.zone !== "hotseat";
  }

  return itemLike.type === "app";
}

function createCartEntryFromItem(itemLike) {
  if (!itemLike) {
    throw new Error("No item selected");
  }

  const basePayload = {
    packageName: getItemPackageName(itemLike),
    className: getItemClassName(itemLike),
    comment: getItemComment(itemLike) || "",
  };

  if (itemLike.data?.hidden !== undefined) {
    basePayload.hidden = itemLike.data.hidden;
  }

  if (!basePayload.packageName || !basePayload.className) {
    throw new Error("Item is missing package/class information");
  }

  if (itemLike.type === "appwidget") {
    return normalizeCartEntry({
      id: buildNextCartEntryId(),
      mode: currentMode,
      type: "widget",
      payload: {
        ...basePayload,
        spanX: Math.max(1, Number(itemLike.data?.spanX) || 1),
        spanY: Math.max(1, Number(itemLike.data?.spanY) || 1),
      },
    });
  }

  return normalizeCartEntry({
    id: buildNextCartEntryId(),
    mode: currentMode,
    type: "app",
    payload: basePayload,
  });
}

function removeCartEntryById(entryId) {
  cartItems = cartItems.filter((entry) => entry.id !== entryId);
}

function discardCartEntry(entryId) {
  const entry = findCartEntryById(entryId);
  if (!entry) {
    throw new Error("Cart item was not found");
  }

  if (
    dragSourceItem?.dataset?.dragOrigin === "cart" &&
    dragSourceItem?.dataset?.cartId === entryId
  ) {
    resetSharedDragState();
  }

  removeCartEntryById(entryId);
  updateUI();
  schedulePersistCurrentSession();

  showToast(
    `${entry.type === "widget" ? "Widget" : "App"} removed from cart`,
    "success",
  );
}

function resetSharedDragState() {
  clearWorkspaceDropPreview();
  clearWorkspacePaginationDropState();
  document.body.classList.remove("drag-in-progress");

  document
    .querySelectorAll(
      ".app-item, .grid-cell-placeholder, .cart-card, .workspace-page-chip, .cart-drop-zone, .pagination button",
    )
    .forEach((item) => {
      item.classList.remove(
        "drag-placeholder",
        "drag-invalid",
        "dragging",
        "is-dragover",
      );
      item.style.opacity = "";
    });

  dragSourceItem = null;
  dragTargetItem = null;
}

function sendItemToCart(appItem) {
  const sourceItem = appItem?.itemData;
  const sourceMeta = appItem?.contextMeta || null;

  if (!canItemBeSentToCart(sourceItem, sourceMeta)) {
    throw new Error("Only app/widget items can be sent to cart");
  }

  const cartEntry = createCartEntryFromItem(sourceItem);
  if (findCartConflictForEntry(cartEntry)) {
    throw new Error("This item is already parked in cart");
  }

  if (currentMode === "application-order") {
    removeFromApplicationOrder(appItem);
  } else {
    removeFromDefaultWorkspace(appItem);
  }

  cartItems.push(cartEntry);
  setUnsavedChanges(true);
  saveChangesBtn.disabled = false;
  resetLayoutBtn.disabled = false;
  updateUI();
  refreshXMLViewer();
  schedulePersistCurrentSession();

  showToast(
    `${cartEntry.type === "widget" ? "Widget" : "App"} moved to cart`,
    "success",
  );
}

function findFirstAvailableWorkspacePlacement(
  itemLike,
  targetScreen,
  options = {},
) {
  const { excludeItem = null } = options;
  const targetItem = itemLike?.data ? itemLike : createCartPreviewItem(itemLike);
  if (!targetItem?.data) {
    return null;
  }

  const screen = Number.isFinite(Number(targetScreen))
    ? Number(targetScreen)
    : currentPage;
  const spanX = Math.max(1, Number(targetItem.data.spanX) || 1);
  const spanY = Math.max(1, Number(targetItem.data.spanY) || 1);
  const cols = getWorkspaceCols();
  const rows = getWorkspaceHomeRows();
  const candidates = [];

  if (
    Number.isFinite(Number(targetItem.data.x)) &&
    Number.isFinite(Number(targetItem.data.y))
  ) {
    candidates.push({
      x: Number(targetItem.data.x),
      y: Number(targetItem.data.y),
      screen,
    });
  }

  for (let y = 0; y <= rows - spanY; y++) {
    for (let x = 0; x <= cols - spanX; x++) {
      candidates.push({ x, y, screen });
    }
  }

  return (
    candidates.find((candidate) =>
      isValidDropPosition(
        candidate.x,
        candidate.y,
        candidate.screen,
        targetItem.type,
        spanX,
        spanY,
        excludeItem,
      ),
    ) || null
  );
}

function restoreCartEntryToWorkspace(entry, target) {
  ensureCartEntryCanBeRestored(entry, "default-workspace");

  const previewItem = createCartPreviewItem(entry);
  const spanX = Math.max(1, Number(previewItem.data.spanX) || 1);
  const spanY = Math.max(1, Number(previewItem.data.spanY) || 1);
  const screen = Number(target.screen) || 0;
  const x = Number(target.x) || 0;
  const y = Number(target.y) || 0;

  if (
    !isValidDropPosition(
      x,
      y,
      screen,
      previewItem.type,
      spanX,
      spanY,
      null,
    )
  ) {
    throw new Error("Target cell is occupied or out of bounds");
  }

  const nextItem = {
    type: previewItem.type,
    packageName: entry.payload.packageName,
    className: entry.payload.className,
    x,
    y,
    screen,
    ...(entry.payload.comment ? { comment: entry.payload.comment } : {}),
    ...(entry.payload.hidden !== undefined
      ? { hidden: entry.payload.hidden }
      : {}),
  };

  if (entry.type === "widget") {
    nextItem.spanX = spanX;
    nextItem.spanY = spanY;
  }

  virtualWorkspaceBuffer.home.push(nextItem);
  removeCartEntryById(entry.id);
}

function restoreCartEntryToHotseat(entry, targetSlot) {
  ensureCartEntryCanBeRestored(entry, "default-workspace");

  if (entry.type !== "app") {
    throw new Error("Hotseat only supports apps");
  }

  const slot = Number(targetSlot);
  const cols = getWorkspaceCols();
  if (!Number.isFinite(slot) || slot < 0 || slot >= cols) {
    throw new Error(`Hotseat slot must be between 0 and ${cols - 1}`);
  }

  if (
    !isValidDropPosition(
      slot,
      getWorkspaceHomeRows(),
      currentPage,
      "app",
      1,
      1,
      null,
    )
  ) {
    throw new Error("Selected hotseat slot is already occupied");
  }

  virtualWorkspaceBuffer.hotseat.push({
    type: "app",
    packageName: entry.payload.packageName,
    className: entry.payload.className,
    screen: slot,
    ...(entry.payload.comment ? { comment: entry.payload.comment } : {}),
    ...(entry.payload.hidden !== undefined
      ? { hidden: entry.payload.hidden }
      : {}),
  });
  sortWorkspaceHotseatItems();
  removeCartEntryById(entry.id);
}

function restoreCartEntryToWorkspacePreview(entry, preview) {
  if (!preview?.isValid) {
    throw new Error(
      preview?.message || "Target cell is occupied or out of bounds",
    );
  }

  if (preview.isHotseat) {
    restoreCartEntryToHotseat(entry, preview.x);
    return;
  }

  restoreCartEntryToWorkspace(entry, preview);
}

function restoreCartEntryToApplicationOrder(entry, targetIndex) {
  ensureCartEntryCanBeRestored(entry, "application-order");

  addToApplicationOrder({
    type: "app",
    packageName: entry.payload.packageName,
    className: entry.payload.className,
    comment: normalizeStoredComment(entry.payload.comment),
    inFolder: "",
    insertIndex: Number.isFinite(Number(targetIndex))
      ? Number(targetIndex)
      : allItems.length,
    screen: currentPage,
  });

  removeCartEntryById(entry.id);
}

function getWorkspacePageTransferDragState() {
  if (currentMode !== "default-workspace" || !dragSourceItem) {
    return null;
  }

  if (isCartDragActive()) {
    const cartEntry = getActiveDraggedCartEntry();
    if (!cartEntry || cartEntry.mode !== "default-workspace") {
      return null;
    }

    return {
      kind: "cart",
      entry: cartEntry,
      item: createCartPreviewItem(cartEntry),
    };
  }

  const meta = dragSourceItem.contextMeta || null;
  const item = getActiveDraggedItemData();
  if (!item || meta?.zone !== "home") {
    return null;
  }

  if (!["app", "folder", "appwidget"].includes(item.type)) {
    return null;
  }

  return {
    kind: "workspace",
    item,
  };
}

function getApplicationOrderPageTransferDragState() {
  if (currentMode !== "application-order" || !dragSourceItem) {
    return null;
  }

  const meta = dragSourceItem.contextMeta || null;
  const item = getActiveDraggedItemData();
  if (!item || meta?.zone !== "app-order") {
    return null;
  }

  if (!["app", "folder"].includes(item.type)) {
    return null;
  }

  return {
    kind: "application-order",
    item,
  };
}

function transferWorkspaceDragStateToScreen(dragState, targetScreen) {
  const screen = Number(targetScreen);
  if (!dragState) {
    throw new Error("No item is being dragged");
  }
  if (!Number.isFinite(screen) || screen < 0) {
    throw new Error("Target page is invalid");
  }

  let placement = null;
  let successMessage = "";

  if (dragState.kind === "cart") {
    placement = findFirstAvailableWorkspacePlacement(dragState.item, screen);
    if (!placement) {
      throw new Error("Target page does not have enough free space");
    }

    restoreCartEntryToWorkspace(dragState.entry, placement);
    successMessage = `${getCartEntryDisplayName(dragState.entry)} restored to page ${placement.screen + 1}`;
  } else {
    placement = findFirstAvailableWorkspacePlacement(dragState.item, screen, {
      excludeItem: dragState.item,
    });
    if (!placement) {
      throw new Error("Target page does not have enough free space");
    }

    moveWorkspaceItem(
      dragState.item,
      placement.x,
      placement.y,
      placement.screen,
    );
    successMessage = `Moved item to page ${placement.screen + 1}`;
  }

  currentPage = placement.screen;
  setUnsavedChanges(true);
  saveChangesBtn.disabled = false;
  resetLayoutBtn.disabled = false;
  updateUI();
  refreshXMLViewer();
  schedulePersistCurrentSession();
  return successMessage;
}

function handleWorkspacePageChipDragOver(event) {
  const dragState = getWorkspacePageTransferDragState();
  if (!dragState) {
    return;
  }

  event.preventDefault();
  event.currentTarget.classList.add("is-dragover");
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

function handleWorkspacePageChipDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove("is-dragover");
  }
}

function handleWorkspacePageChipDrop(event) {
  const dragState = getWorkspacePageTransferDragState();
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove("is-dragover");

  if (!dragState) {
    return false;
  }

  const targetScreen = Number(event.currentTarget.dataset.screen);
  try {
    showToast(
      transferWorkspaceDragStateToScreen(dragState, targetScreen),
      "success",
    );
  } catch (error) {
    showToast(error.message || String(error), "error");
  } finally {
    resetSharedDragState();
  }

  return false;
}

function clearWorkspacePaginationDropState() {
  prevPageBtn?.classList.remove("is-dragover");
  nextPageBtn?.classList.remove("is-dragover");
}

function getWorkspacePaginationButtonTarget(button) {
  if (!button || currentMode !== "default-workspace") {
    return null;
  }

  if (button === prevPageBtn) {
    if (currentPage <= 0) {
      return null;
    }
    return { button, screen: currentPage - 1 };
  }

  if (button === nextPageBtn) {
    return { button, screen: currentPage + 1 };
  }

  return null;
}

function getApplicationOrderPaginationButtonTarget(button) {
  if (!button || currentMode !== "application-order") {
    return null;
  }

  const totalPages = getTotalPagesForCurrentMode();
  if (button === prevPageBtn) {
    if (currentPage <= 0) {
      return null;
    }
    return { button, screen: currentPage - 1 };
  }

  if (button === nextPageBtn) {
    if (currentPage >= totalPages - 1) {
      return null;
    }
    return { button, screen: currentPage + 1 };
  }

  return null;
}

function transferApplicationOrderDragStateToPage(dragState, targetPage) {
  const screen = Number(targetPage);
  if (!dragState) {
    throw new Error("No item is being dragged");
  }
  if (!Number.isFinite(screen) || screen < 0) {
    throw new Error("Target page is invalid");
  }
  if (dragState.kind !== "application-order") {
    throw new Error(
      "Only top-level Application Order items can move across pages",
    );
  }

  const result = moveApplicationOrderItemToPage(dragState.item, screen);
  if (result.moved) {
    saveChangesBtn.disabled = false;
    resetLayoutBtn.disabled = false;
    updateUI();
    refreshXMLViewer();
    schedulePersistCurrentSession();
  }
  return result.message;
}

function handleWorkspacePaginationButtonDragOver(event) {
  const dragState =
    currentMode === "application-order"
      ? getApplicationOrderPageTransferDragState()
      : getWorkspacePageTransferDragState();
  const target =
    currentMode === "application-order"
      ? getApplicationOrderPaginationButtonTarget(event.currentTarget)
      : getWorkspacePaginationButtonTarget(event.currentTarget);
  clearWorkspacePaginationDropState();

  if (!dragState || !target) {
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
  target.button.classList.add("is-dragover");
}

function handleWorkspacePaginationButtonDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove("is-dragover");
  }
}

function handleWorkspacePaginationButtonDrop(event) {
  const dragState =
    currentMode === "application-order"
      ? getApplicationOrderPageTransferDragState()
      : getWorkspacePageTransferDragState();
  const target =
    currentMode === "application-order"
      ? getApplicationOrderPaginationButtonTarget(event.currentTarget)
      : getWorkspacePaginationButtonTarget(event.currentTarget);
  event.preventDefault();
  event.stopPropagation();
  clearWorkspacePaginationDropState();

  if (!dragState || !target) {
    return false;
  }

  try {
    showToast(
      currentMode === "application-order"
        ? transferApplicationOrderDragStateToPage(dragState, target.screen)
        : transferWorkspaceDragStateToScreen(dragState, target.screen),
      "success",
    );
  } catch (error) {
    showToast(error.message || String(error), "error");
  } finally {
    resetSharedDragState();
  }

  return false;
}

function renderWorkspacePageStrip() {
  if (!workspacePageStrip) {
    return;
  }

  workspacePageStrip.innerHTML = "";
  workspacePageStrip.classList.toggle(
    "is-hidden",
    currentMode !== "default-workspace",
  );

  if (currentMode !== "default-workspace") {
    return;
  }

  const totalPages = getTotalPagesForCurrentMode();
  for (let screen = 0; screen < totalPages; screen++) {
    const pageChip = document.createElement("button");
    pageChip.type = "button";
    pageChip.className = "workspace-page-chip";
    if (screen === currentPage) {
      pageChip.classList.add("is-active");
    }
    pageChip.dataset.screen = String(screen);
    pageChip.innerHTML = `
      <span class="workspace-page-chip-label">Page ${screen + 1}</span>
      <span class="workspace-page-chip-meta">${virtualWorkspaceBuffer.home.filter((item) => Number(item.screen) === screen).length} item(s)</span>
    `;
    pageChip.addEventListener("click", () => {
      currentPage = screen;
      updateUI();
      schedulePersistCurrentSession();
    });
    pageChip.addEventListener("dragover", handleWorkspacePageChipDragOver);
    pageChip.addEventListener("dragleave", handleWorkspacePageChipDragLeave);
    pageChip.addEventListener("drop", handleWorkspacePageChipDrop);
    workspacePageStrip.appendChild(pageChip);
  }

  const createTarget = document.createElement("div");
  createTarget.className = "workspace-page-chip workspace-page-chip-create";
  createTarget.dataset.screen = String(totalPages);
  createTarget.innerHTML = `
    <span class="workspace-page-chip-label">New Page</span>
    <span class="workspace-page-chip-meta">Drop here to create page ${totalPages + 1}</span>
  `;
  createTarget.addEventListener("dragover", handleWorkspacePageChipDragOver);
  createTarget.addEventListener("dragleave", handleWorkspacePageChipDragLeave);
  createTarget.addEventListener("drop", handleWorkspacePageChipDrop);
  workspacePageStrip.appendChild(createTarget);
}

function renderCartPanel() {
  if (!cartPanel || !cartItemsContainer || !cartCountPill) {
    return;
  }

  const visibleCount = cartItems.length;
  cartPanel.classList.toggle("is-empty", visibleCount === 0);
  cartCountPill.textContent = `${visibleCount} ${visibleCount === 1 ? "item" : "items"}`;
  cartItemsContainer.innerHTML = "";

  if (visibleCount === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "cart-empty-state";
    emptyState.textContent =
      "Cart is empty. Drag app/widget here or use the context menu to park an item temporarily.";
    cartItemsContainer.appendChild(emptyState);
    return;
  }

  cartItems.forEach((entry) => {
    const previewItem = createCartPreviewItem(entry);
    const card = document.createElement("div");
    card.className = "cart-card";
    card.dataset.cartId = entry.id;
    card.dataset.dragOrigin = "cart";
    card.itemData = previewItem;
    card.cartEntry = entry;
    card.title = getCartEntryDisplayName(entry);

    const canDragBack = canRestoreCartEntryInMode(entry, currentMode);
    if (!canDragBack) {
      card.classList.add("is-disabled");
    }

    const visual = document.createElement("div");
    visual.className = `cart-card-visual app-item ${previewItem.type} compact-card`;
    appendItemVisuals(visual, previewItem, { compact: true });

    const meta = document.createElement("div");
    meta.className = "cart-card-meta";
    const type = document.createElement("span");
    type.className = "cart-card-type";
    type.textContent = `${entry.type === "widget" ? "Widget" : "App"} · ${getCartEntryModeLabel(entry)}`;

    const head = document.createElement("div");
    head.className = "cart-card-head";

    const name = document.createElement("span");
    name.className = "cart-card-name";
    name.textContent = getCartEntryDisplayName(entry);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "cart-card-remove";
    removeButton.innerHTML = "&times;";
    removeButton.title = "Remove from cart";
    removeButton.setAttribute(
      "aria-label",
      `Remove ${getCartEntryDisplayName(entry)} from cart`,
    );
    removeButton.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        discardCartEntry(entry.id);
      } catch (error) {
        showToast(error.message || String(error), "error");
      }
    });

    head.append(name, removeButton);

    const copy = document.createElement("span");
    copy.className = "cart-card-copy";
    copy.textContent = canDragBack
      ? "Drag back to canvas"
      : `Switch to ${getCartEntryModeLabel(entry)} to restore`;

    meta.append(type, head, copy);

    card.append(visual, meta);

    if (canDragBack) {
      card.setAttribute("draggable", "true");
      card.addEventListener("dragstart", handleCartDragStart);
      card.addEventListener("dragend", handleCartDragEnd);
    }

    cartItemsContainer.appendChild(card);
  });
}

function openMoveToPageModal(appItem) {
  if (
    !movePageModal ||
    !movePageScreenInput ||
    !appItem?.itemData
  ) {
    return;
  }

  const meta = appItem.contextMeta || null;
  const movePageHint = movePageModal.querySelector(".move-page-hint");
  let currentScreen = 0;
  let maxPage = 1;
  let targetPage = 1;

  if (currentMode === "default-workspace") {
    if (meta?.zone !== "home") {
      return;
    }

    const totalPages = getTotalPagesForCurrentMode();
    currentScreen = Number(appItem.itemData.data?.screen) || 0;
    maxPage = totalPages + 1;
    targetPage = Math.min(maxPage, currentScreen + 2);
    if (movePageHint) {
      movePageHint.textContent =
        "Keep current position if available; otherwise auto-place into the first free slot.";
    }
  } else if (currentMode === "application-order") {
    if (meta?.zone !== "app-order") {
      return;
    }

    const totalPages = getTotalPagesForCurrentMode();
    currentScreen = getApplicationOrderPageForItem(appItem.itemData);
    maxPage = totalPages;
    targetPage = Math.min(maxPage, currentScreen + 2);
    if (movePageHint) {
      movePageHint.textContent =
        "Keep the current slot on the target page when possible; otherwise place the item at the end of that page.";
    }
  } else {
    return;
  }

  selectedItemForMove = appItem;

  movePageScreenInput.min = "1";
  movePageScreenInput.max = String(maxPage);
  movePageScreenInput.value = String(targetPage);

  if (movePageMessage) {
    movePageMessage.textContent = `Move "${getDisplayName(appItem.itemData)}" from page ${currentScreen + 1} to another page.`;
  }

  movePageModal.style.display = "block";
  window.setTimeout(() => {
    movePageScreenInput.focus();
    movePageScreenInput.select();
  }, 0);
}

function closeMoveToPageModal() {
  if (movePageModal) {
    movePageModal.style.display = "none";
  }
  selectedItemForMove = null;
}

function resolveMoveToPagePlacement(item, targetScreen) {
  if (!item?.data) {
    return null;
  }

  const spanX = Math.max(1, Number(item.data.spanX) || 1);
  const spanY = Math.max(1, Number(item.data.spanY) || 1);
  const preferredX = Number(item.data.x) || 0;
  const preferredY = Number(item.data.y) || 0;

  if (
    isValidDropPosition(
      preferredX,
      preferredY,
      targetScreen,
      item.type,
      spanX,
      spanY,
      item,
    )
  ) {
    return {
      x: preferredX,
      y: preferredY,
      screen: targetScreen,
    };
  }

  return findFirstAvailableWorkspacePlacement(item, targetScreen, {
    excludeItem: item,
  });
}

function confirmMoveToPage() {
  if (!selectedItemForMove?.itemData || !movePageScreenInput) {
    closeMoveToPageModal();
    return;
  }

  try {
    const totalPages = getTotalPagesForCurrentMode();
    const requestedPage = Number(movePageScreenInput.value);
    const maxPage =
      currentMode === "default-workspace" ? totalPages + 1 : totalPages;

    if (!Number.isFinite(requestedPage) || requestedPage < 1) {
      throw new Error("Target page must be 1 or greater");
    }
    if (requestedPage > maxPage) {
      throw new Error(`You can move up to page ${maxPage} right now`);
    }

    const targetScreen = requestedPage - 1;
    const item = selectedItemForMove.itemData;

    if (currentMode === "application-order") {
      const result = moveApplicationOrderItemToPage(item, targetScreen);
      if (result.moved) {
        saveChangesBtn.disabled = false;
        resetLayoutBtn.disabled = false;
        updateUI();
        refreshXMLViewer();
        schedulePersistCurrentSession();
      }
      closeMoveToPageModal();
      showToast(result.message, "success");
      return;
    }

    const placement = resolveMoveToPagePlacement(item, targetScreen);

    if (!placement) {
      throw new Error("Target page has no free space for this item");
    }

    moveWorkspaceItem(item, placement.x, placement.y, placement.screen);
    currentPage = placement.screen;
    setUnsavedChanges(true);
    saveChangesBtn.disabled = false;
    resetLayoutBtn.disabled = false;
    updateUI();
    refreshXMLViewer();
    schedulePersistCurrentSession();
    closeMoveToPageModal();
    showToast(`Moved item to page ${placement.screen + 1}`, "success");
  } catch (error) {
    showToast(error.message || String(error), "error");
  }
}

function handleCartDragStart(event) {
  resetSharedDragState();
  dragSourceItem = this;
  dragGrabOffset = { cellX: 0, cellY: 0 };
  document.body.classList.add("drag-in-progress");
  this.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", "cart-item");
  if (event.dataTransfer.setDragImage) {
    event.dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);
  }

  setTimeout(() => {
    this.style.opacity = "0.35";
  }, 0);
}

function handleCartDragEnd() {
  resetSharedDragState();
}

function handleCartDragOver(event) {
  if (!dragSourceItem || isCartDragActive()) {
    return;
  }

  const sourceItem = getActiveDraggedItemData();
  const sourceMeta = dragSourceItem.contextMeta || null;
  if (!canItemBeSentToCart(sourceItem, sourceMeta)) {
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
  event.currentTarget.classList.add("is-dragover");
}

function handleCartDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove("is-dragover");
  }
}

function handleCartDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove("is-dragover");

  if (!dragSourceItem || isCartDragActive()) {
    return false;
  }

  try {
    sendItemToCart(dragSourceItem);
  } catch (error) {
    showToast(error.message || String(error), "error");
  } finally {
    resetSharedDragState();
  }

  return false;
}

// ============================================================
// CONTEXT MENU FUNCTIONALITY
// ============================================================

function setContextMenuItemState(menuItem, enabled) {
  if (!menuItem) return;
  menuItem.classList.toggle("disabled", !enabled);
}

function updateContextMenuForTarget(meta) {
  const menu = document.getElementById("context-menu");
  if (!menu) return;

  const addItem = menu.querySelector('[data-action="add"]');
  const editItem = menu.querySelector('[data-action="edit"]');
  const movePageItem = menu.querySelector('[data-action="move-page"]');
  const cartItem = menu.querySelector('[data-action="cart"]');
  const removeItem = menu.querySelector('[data-action="remove"]');
  const canAdd = !!meta?.canAdd;
  const canEdit = !!meta?.canEdit;
  const canMovePage = !!meta?.canMovePage;
  const canCart = !!meta?.canCart;
  const canRemove = !!meta?.canRemove;

  if (addItem) {
    addItem.textContent =
      meta?.zone === "hotseat" ||
      meta?.zone === "app-order-folder" ||
      meta?.zone === "workspace-folder"
        ? "Add App Here"
        : "Add Here";
    setContextMenuItemState(addItem, canAdd);
  }

  if (editItem) {
    const defaultLabel = meta?.itemType === "appwidget" || meta?.itemType === "widget"
      ? "Edit Widget"
      : meta?.itemType === "folder"
        ? "Edit Folder"
      : meta?.itemType === "app" || meta?.itemType === "hotseat-app"
        ? "Edit App"
        : "Edit Item";
    editItem.textContent = defaultLabel;
    setContextMenuItemState(editItem, canEdit);
  }

  if (movePageItem) {
    movePageItem.textContent = "Move to Page...";
    setContextMenuItemState(movePageItem, canMovePage);
  }

  if (cartItem) {
    cartItem.textContent =
      meta?.itemType === "appwidget" ? "Send Widget to Cart" : "Send App to Cart";
    setContextMenuItemState(cartItem, canCart);
  }

  if (removeItem) {
    const defaultLabel = meta?.itemType === "folder"
      ? "Remove Folder"
      : meta?.itemType === "appwidget"
        ? "Remove Widget"
        : meta?.itemType === "app" || meta?.itemType === "hotseat-app"
          ? "Remove App"
          : "Remove Item";
    removeItem.textContent = defaultLabel;
    setContextMenuItemState(removeItem, canRemove);
  }
}

// Show Context Menu
function showContextMenu(event, appItem) {
  contextMenu = document.getElementById("context-menu");
  selectedItem = appItem;
  updateContextMenuForTarget(appItem?.contextMeta || null);

  contextMenu.style.visibility = "hidden";
  contextMenu.style.display = "block";

  const menuRect = contextMenu.getBoundingClientRect();
  const gutter = 8;
  const left = Math.max(
    gutter,
    Math.min(event.clientX, window.innerWidth - menuRect.width - gutter),
  );
  const top = Math.max(
    gutter,
    Math.min(event.clientY, window.innerHeight - menuRect.height - gutter),
  );

  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;
  contextMenu.style.visibility = "visible";
}

// Hide Context Menu
function hideContextMenu() {
  const menu = document.getElementById("context-menu");
  if (menu) {
    menu.style.display = "none";
    menu.style.visibility = "";
  }
  selectedItem = null;
}

// Handle Context Menu Action
function handleContextMenuAction(e) {
  e.stopPropagation();
  const action = e.target.dataset.action;
  const meta = selectedItem?.contextMeta || null;

  if (e.target.classList.contains("disabled")) {
    hideContextMenu();
    return;
  }

  if (action === "add" && meta?.canAdd) {
    openAddAppModal({
      ...meta,
      source: "context-menu",
    });
  }

  if (action === "edit" && selectedItem && meta?.canEdit) {
    openEditItemModal(selectedItem);
  }

  if (action === "move-page" && selectedItem && meta?.canMovePage) {
    openMoveToPageModal(selectedItem);
  }

  if (action === "cart" && selectedItem && meta?.canCart) {
    try {
      sendItemToCart(selectedItem);
    } catch (error) {
      showToast(error.message || String(error), "error");
    }
  }

  if (action === "remove" && selectedItem && meta?.canRemove) {
    // Show confirmation dialog
    showConfirmDialog(selectedItem);
  }

  hideContextMenu();
}

// ============================================================
// CONFIRMATION DIALOG FUNCTIONALITY
// ============================================================

// Show Confirm Dialog
function showConfirmDialog(appItem) {
  selectedItemForRemoval = appItem;
  const dialog = document.getElementById("confirm-dialog");
  const message = document.getElementById("confirm-message");

  // Get item information
  const itemData = appItem.itemData;
  let itemName = "";
  let itemType = "";

  if (currentMode === "application-order") {
    if (itemData.type === "folder") {
      itemName = itemData.data.title;
      itemType = "Folder";
    } else {
      itemName = getDisplayName(itemData);
      itemType = "App";
    }
  } else {
    if (itemData.type === "folder") {
      itemName = itemData.data.title;
      itemType = "Folder";
    } else if (itemData.type === "appwidget") {
      itemName = getDisplayName(itemData);
      itemType = "Widget";
    } else {
      itemName = getDisplayName(itemData);
      itemType = "App";
    }
  }

  message.textContent = `Are you sure you want to remove the ${itemType} "${itemName}"?`;

  // Show dialog
  dialog.style.display = "block";
}

// Hide Confirm Dialog
function hideConfirmDialog() {
  const dialog = document.getElementById("confirm-dialog");
  dialog.style.display = "none";
  selectedItemForRemoval = null;
}

// Confirm Remove
function confirmRemove() {
  if (!selectedItemForRemoval) {
    return;
  }

  let folderHistoryPushed = false;
  try {
    if (isFolderRemovalTarget(selectedItemForRemoval)) {
      folderHistoryPushed = pushFolderHistory("remove");
    }

    // Remove item based on current mode
    if (currentMode === "application-order") {
      removeFromApplicationOrder(selectedItemForRemoval);
    } else {
      removeFromDefaultWorkspace(selectedItemForRemoval);
    }

    // Enable save button
    setUnsavedChanges(true);
    saveChangesBtn.disabled = false;
    resetLayoutBtn.disabled = false;

    // Update UI
    updateUI();
    refreshXMLViewer();

    // Hide dialog
    hideConfirmDialog();

    showToast("Item removed successfully!", "success");
  } catch (error) {
    if (folderHistoryPushed) {
      popLastFolderHistorySnapshot();
    }
    showToast("Error removing item: " + error.message, "error");
    hideConfirmDialog();
  }
}

// Remove from Application Order Mode
function removeFromApplicationOrder(appItem) {
  const itemData = appItem.itemData;

  if (itemData.type === "folder") {
    // Remove folder
    const folderName = itemData.data.title;
    delete virtualBuffer.folders[folderName];
    reindexTopLevelApplicationOrderItems();
  } else {
    // Remove app from folder
    const packageName = itemData.data["package name"];
    const location = findApplicationOrderAppLocation(packageName, itemData.data);
    const folderName = location?.folderTitle || null;

    if (!folderName || !location?.packageName) {
      throw new Error("Selected app was not found");
    }

    delete virtualBuffer.folders[folderName].apps[location.packageName];

    if (folderName === "no_folder") {
      reindexTopLevelApplicationOrderItems();
    } else {
      // Reindex remaining apps in folder
      reindexApps(folderName);
    }

    // If folder becomes empty, ask if user wants to remove it
    if (
      folderName !== "no_folder" &&
      Object.keys(virtualBuffer.folders[folderName].apps).length === 0
    ) {
      if (
        confirm(
          `Folder "${folderName}" is now empty. Do you want to remove it?`,
        )
      ) {
        delete virtualBuffer.folders[folderName];
        reindexTopLevelApplicationOrderItems();
      }
    }
  }
}

// Remove from Default Workspace Mode
function removeFromDefaultWorkspace(appItem) {
  const itemData = appItem.itemData;
  const itemType = itemData.type;

  if (itemType === "hotseat-app") {
    // Remove from hotseat
    const packageName = itemData.data.packageName;
    const hotseatSlot = Number(
      itemData.data.hotseatSlot ?? itemData.data.screen ?? -1,
    );
    const index = virtualWorkspaceBuffer.hotseat.findIndex(
      (item) =>
        item.packageName === packageName && Number(item.screen) === hotseatSlot,
    );

    if (index !== -1) {
      virtualWorkspaceBuffer.hotseat.splice(index, 1);
    }
  } else {
    // Remove from home
    let itemToRemove = null;
    let itemIndex = -1;

    if (itemType === "folder") {
      const folderName = itemData.data.title;
      itemIndex = virtualWorkspaceBuffer.home.findIndex(
        (item) =>
          item.type === "folder" &&
          item.title === folderName &&
          Number(item.screen) === Number(itemData.data.screen),
      );
    } else if (itemType === "appwidget") {
      const packageName = itemData.data.packageName;
      const x = itemData.data.x;
      const y = itemData.data.y;
      itemIndex = virtualWorkspaceBuffer.home.findIndex(
        (item) =>
          item.type === "appwidget" &&
          item.packageName === packageName &&
          item.x === x &&
          item.y === y,
      );
    } else {
      const packageName = itemData.data.packageName;
      const folderLocation = findWorkspaceFolderAppLocation(
        packageName,
        itemData.data,
        appItem.contextMeta?.folderTitle,
        appItem.contextMeta?.folderScreen,
      );
      if (folderLocation) {
        folderLocation.folder.apps.splice(folderLocation.appIndex, 1);
        folderLocation.folder.apps.forEach((app, index) => {
          app.screen = index;
        });
        return;
      }

      const x = itemData.data.x;
      const y = itemData.data.y;
      itemIndex = virtualWorkspaceBuffer.home.findIndex(
        (item) =>
          item.type === "app" &&
          item.packageName === packageName &&
          item.x === x &&
          item.y === y,
      );
    }

    if (itemIndex === -1) {
      throw new Error("Selected item was not found");
    }

    virtualWorkspaceBuffer.home.splice(itemIndex, 1);
  }
}

// Reindex Apps
function reindexApps(folderName) {
  const folderData = virtualBuffer.folders[folderName];
  if (!folderData || !folderData.apps || folderName === "no_folder") {
    return;
  }

  // Get all apps and sort by current index
  const folderApps = Object.entries(folderData.apps);
  folderApps.sort((a, b) => (a[1].index || 0) - (b[1].index || 0));

  // Reindex starting from 0
  folderApps.forEach((app, i) => {
    app[1].index = i;
    app[1].screen = String(i);
  });
}

// ============================================================
// WORKSPACE DRAG AND DROP FUNCTIONALITY
// ============================================================

function getTransparentDragImage() {
  if (!transparentDragImage) {
    transparentDragImage = document.createElement("canvas");
    transparentDragImage.width = 1;
    transparentDragImage.height = 1;
  }
  return transparentDragImage;
}

function initializeSharedDragGesture(
  sourceElement,
  event,
  dragToken = "drag-item",
  opacity = "0.5",
) {
  resetSharedDragState();
  dragSourceItem = sourceElement;
  sourceElement.classList.add("dragging");
  document.body.classList.add("drag-in-progress");

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragToken);
    if (event.dataTransfer.setDragImage) {
      event.dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);
    }
  }

  window.setTimeout(() => {
    sourceElement.style.opacity = opacity;
  }, 0);
}

function clearWorkspaceDropPreview() {
  workspaceDropPreviewKey = "";
  workspaceStickyPreview = null;

  if (workspaceDropPreviewElement && workspaceDropPreviewElement.parentNode) {
    workspaceDropPreviewElement.parentNode.removeChild(workspaceDropPreviewElement);
  }

  workspaceDropPreviewElement = null;
}

function ensureWorkspaceDropPreviewElement() {
  if (!appGrid) {
    return null;
  }

  if (
    workspaceDropPreviewElement &&
    workspaceDropPreviewElement.parentNode === appGrid
  ) {
    return workspaceDropPreviewElement;
  }

  workspaceDropPreviewElement = document.createElement("div");
  workspaceDropPreviewElement.className = "grid-drop-preview";
  appGrid.appendChild(workspaceDropPreviewElement);
  return workspaceDropPreviewElement;
}

function renderWorkspaceDropPreview(preview) {
  if (!preview) {
    clearWorkspaceDropPreview();
    return;
  }

  const previewKey = [
    preview.x,
    preview.y,
    preview.screen,
    preview.spanX,
    preview.spanY,
    preview.isHotseat ? "hotseat" : "home",
    preview.isValid ? "valid" : "invalid",
  ].join(":");

  if (
    previewKey === workspaceDropPreviewKey &&
    workspaceDropPreviewElement &&
    workspaceDropPreviewElement.parentNode === appGrid
  ) {
    return;
  }

  workspaceDropPreviewKey = previewKey;

  const previewElement = ensureWorkspaceDropPreviewElement();
  if (!previewElement) {
    return;
  }

  previewElement.className = "grid-drop-preview";
  previewElement.classList.add(
    preview.isValid ? "drop-preview-valid" : "drop-preview-invalid",
  );

  if (preview.isHotseat) {
    previewElement.classList.add("hotseat-preview");
    previewElement.style.gridColumn = `${getCanvasGridColumnForPage(
      preview.x,
      getCanvasPageIndexForScreen(preview.screen),
    )}`;
    previewElement.style.gridRow = String(getWorkspaceHotseatGridRow());
  } else {
    previewElement.style.gridColumn = `${getCanvasGridColumnForPage(
      preview.x,
      getCanvasPageIndexForScreen(preview.screen),
    )} / span ${preview.spanX}`;
    previewElement.style.gridRow = `${preview.y + 1} / span ${preview.spanY}`;
  }

  if (preview.isValid) {
    workspaceStickyPreview = {
      x: preview.x,
      y: preview.y,
      screen: preview.screen,
      isHotseat: preview.isHotseat,
      spanX: preview.spanX,
      spanY: preview.spanY,
    };
  }
}

function getWorkspaceGridMetrics() {
  const gridRect = appGrid.getBoundingClientRect();
  const pad = 12;
  const cellSize = getMainCellSize();
  const gap = getCurrentGridGap();
  const cols = getWorkspaceCols();
  const homeRows = getWorkspaceHomeRows();
  const cellUnit = cellSize + gap;
  const hotseatStartY = homeRows * cellUnit + 10 + gap;
  const pageCount = getCanvasPageCount();
  const pageContentWidth = getCanvasPageContentWidth(cols, cellSize, gap);
  const pageStride = getCanvasPageStride(cols, cellSize, gap);

  return {
    gridRect,
    pad,
    cellSize,
    gap,
    cols,
    homeRows,
    cellUnit,
    hotseatStartY,
    pageCount,
    pageContentWidth,
    pageStride,
  };
}

function getWorkspacePreviewAnchorClientPoint(preview, metrics = null) {
  const resolvedMetrics = metrics || getWorkspaceGridMetrics();
  const pageIndex = getCanvasPageIndexForScreen(preview.screen);
  const pageStart = getCanvasPageStartX(
    pageIndex,
    resolvedMetrics.cols,
    resolvedMetrics.cellSize,
    resolvedMetrics.gap,
  );
  const anchorColumn = preview.x + (preview.isHotseat ? 0 : dragGrabOffset.cellX);
  const clientX =
    resolvedMetrics.gridRect.left +
    resolvedMetrics.pad +
    pageStart +
    anchorColumn * resolvedMetrics.cellUnit +
    resolvedMetrics.cellSize / 2;

  const clientY = preview.isHotseat
    ? resolvedMetrics.gridRect.top +
      resolvedMetrics.pad +
      resolvedMetrics.hotseatStartY +
      resolvedMetrics.cellSize / 2
    : resolvedMetrics.gridRect.top +
      resolvedMetrics.pad +
      (preview.y + dragGrabOffset.cellY) * resolvedMetrics.cellUnit +
      resolvedMetrics.cellSize / 2;

  return { clientX, clientY, metrics: resolvedMetrics };
}

function getWorkspacePreviewPointerDistance(
  preview,
  clientX,
  clientY,
  metrics = null,
) {
  const anchor = getWorkspacePreviewAnchorClientPoint(preview, metrics);
  return Math.hypot(clientX - anchor.clientX, clientY - anchor.clientY);
}

function getStickyWorkspaceHomePosition(clientX, clientY, sourceItem) {
  if (!workspaceStickyPreview || workspaceStickyPreview.isHotseat) {
    return null;
  }

  const spanX = sourceItem.data.spanX || 1;
  const spanY = sourceItem.data.spanY || 1;
  const stickyPosition = {
    x: workspaceStickyPreview.x,
    y: workspaceStickyPreview.y,
    screen: workspaceStickyPreview.screen,
    isHotseat: false,
    spanX,
    spanY,
  };

  if (!getVisibleCanvasPages().includes(Number(stickyPosition.screen))) {
    return null;
  }

  if (
    !isValidDropPosition(
      stickyPosition.x,
      stickyPosition.y,
      stickyPosition.screen,
      sourceItem.type,
      spanX,
      spanY,
      sourceItem,
    )
  ) {
    return null;
  }

  const metrics = getWorkspaceGridMetrics();
  const { cellUnit } = metrics;
  const stickyRadius = cellUnit * (sourceItem.type === "appwidget" ? 0.9 : 0.62);

  return getWorkspacePreviewPointerDistance(
    stickyPosition,
    clientX,
    clientY,
    metrics,
  ) <= stickyRadius
    ? stickyPosition
    : null;
}

function getMagneticWorkspaceHomePosition(basePosition, clientX, clientY, sourceItem) {
  if (!basePosition || basePosition.isHotseat) {
    return null;
  }

  const spanX = sourceItem.data.spanX || 1;
  const spanY = sourceItem.data.spanY || 1;
  const metrics = getWorkspaceGridMetrics();
  const maxX = metrics.cols - spanX;
  const maxY = metrics.homeRows - spanY;
  const magnetRadius = metrics.cellUnit * (sourceItem.type === "appwidget" ? 1.45 : 1.02);
  const baseBias = metrics.cellUnit * 0.08;

  let bestCandidate = null;
  let bestScore = Infinity;
  let bestDistance = Infinity;

  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      if (
        !isValidDropPosition(
          x,
          y,
          basePosition.screen,
          sourceItem.type,
          spanX,
          spanY,
          sourceItem,
        )
      ) {
        continue;
      }

      const candidate = {
        x,
        y,
        screen: basePosition.screen,
        isHotseat: false,
        spanX,
        spanY,
      };
      const distance = getWorkspacePreviewPointerDistance(
        candidate,
        clientX,
        clientY,
        metrics,
      );
      const displacement =
        Math.abs(candidate.x - basePosition.x) +
        Math.abs(candidate.y - basePosition.y);
      const score = distance + displacement * baseBias;

      if (score < bestScore) {
        bestScore = score;
        bestDistance = distance;
        bestCandidate = candidate;
      }
    }
  }

  if (!bestCandidate || bestDistance > magnetRadius) {
    return null;
  }

  return bestCandidate;
}

function getWorkspaceGridDropPosition(clientX, clientY, sourceItem) {
  const rawGridPos = calculateGridPosition(clientX, clientY);
  if (!rawGridPos) {
    return null;
  }

  const spanX = sourceItem.data.spanX || 1;
  const spanY = sourceItem.data.spanY || 1;
  const cols = getWorkspaceCols();
  const homeRows = getWorkspaceHomeRows();

  if (rawGridPos.isHotseat) {
    return {
      x: rawGridPos.x,
      y: rawGridPos.y,
      screen: rawGridPos.screen,
      isHotseat: true,
      spanX: 1,
      spanY: 1,
    };
  }

  const dropX = Math.max(
    0,
    Math.min(cols - spanX, rawGridPos.x - dragGrabOffset.cellX),
  );
  const dropY = Math.max(
    0,
    Math.min(homeRows - spanY, rawGridPos.y - dragGrabOffset.cellY),
  );

  return {
    x: dropX,
    y: dropY,
    screen: rawGridPos.screen,
    isHotseat: false,
    spanX,
    spanY,
  };
}

function validateWorkspaceSwap(sourceItem, targetItem) {
  const sourceType = sourceItem.type;
  const targetType = targetItem.type;

  if (sourceType === "hotseat-app" && targetType === "hotseat-app") {
    return { isValid: true, message: "" };
  }

  if (
    (sourceType === "hotseat-app" && targetType === "app") ||
    (sourceType === "app" && targetType === "hotseat-app")
  ) {
    return { isValid: true, message: "" };
  }

  if (sourceType === "hotseat-app") {
    return {
      isValid: false,
      message: "Hotseat apps can only swap with another app",
    };
  }

  if (targetType === "hotseat-app") {
    return {
      isValid: false,
      message: "Only apps can move into hotseat",
    };
  }

  const sourceData = resolveWorkspaceHomeItem(sourceItem);
  const targetData = resolveWorkspaceHomeItem(targetItem);

  if (!sourceData || !targetData) {
    return {
      isValid: false,
      message: "Could not resolve the items for swapping",
    };
  }
  const sourceSpanX = sourceData.spanX || 1;
  const sourceSpanY = sourceData.spanY || 1;
  const targetSpanX = targetData.spanX || 1;
  const targetSpanY = targetData.spanY || 1;
  const cols = getWorkspaceCols();
  const homeRows = getWorkspaceHomeRows();

  if (targetData.x + sourceSpanX > cols || targetData.y + sourceSpanY > homeRows) {
    return {
      isValid: false,
      message: "Target area is too small for this item",
    };
  }

  if (sourceData.x + targetSpanX > cols || sourceData.y + targetSpanY > homeRows) {
    return {
      isValid: false,
      message: "Target item does not fit in the source area",
    };
  }

  const otherItems = virtualWorkspaceBuffer.home.filter(
    (item) =>
      !isSameBufferItem(item, sourceData) &&
      !isSameBufferItem(item, targetData),
  );

  for (const other of otherItems) {
    if (other.screen === targetData.screen) {
      const otherSpanX = other.spanX || 1;
      const otherSpanY = other.spanY || 1;
      const overlapsTargetArea = !(
        targetData.x + sourceSpanX <= other.x ||
        other.x + otherSpanX <= targetData.x ||
        targetData.y + sourceSpanY <= other.y ||
        other.y + otherSpanY <= targetData.y
      );

      if (overlapsTargetArea) {
        return {
          isValid: false,
          message: "Target area overlaps another item",
        };
      }
    }

    if (other.screen === sourceData.screen) {
      const otherSpanX = other.spanX || 1;
      const otherSpanY = other.spanY || 1;
      const overlapsSourceArea = !(
        sourceData.x + targetSpanX <= other.x ||
        other.x + otherSpanX <= sourceData.x ||
        sourceData.y + targetSpanY <= other.y ||
        other.y + otherSpanY <= sourceData.y
      );

      if (overlapsSourceArea) {
        return {
          isValid: false,
          message: "Source area would overlap another item",
        };
      }
    }
  }

  return { isValid: true, message: "" };
}

function getWorkspaceDropPreviewForTarget(targetElement) {
  if (!dragSourceItem || !targetElement || targetElement === dragSourceItem) {
    return null;
  }

  const sourceItem = dragSourceItem.itemData;
  const targetItem = targetElement.itemData;

  if (!sourceItem || !targetItem) {
    return null;
  }

  const swapValidation = validateWorkspaceSwap(sourceItem, targetItem);

  if (targetItem.type === "hotseat-app") {
    const slot = Number(
      targetItem.data.hotseatSlot ?? targetItem.data.screen ?? 0,
    );
    return {
      x: slot,
      y: getWorkspaceHomeRows(),
      screen: currentPage,
      isHotseat: true,
      spanX: 1,
      spanY: 1,
      isValid: swapValidation.isValid,
      message: swapValidation.message,
    };
  }

  return {
    x: targetItem.data.x,
    y: targetItem.data.y,
    screen: targetItem.data.screen,
    isHotseat: false,
    spanX: sourceItem.data.spanX || 1,
    spanY: sourceItem.data.spanY || 1,
    isValid: swapValidation.isValid,
    message: swapValidation.message,
  };
}

function getWorkspaceDropPreviewForGrid(clientX, clientY) {
  if (!dragSourceItem) {
    return null;
  }

  const sourceItem = dragSourceItem.itemData;
  const sourceType = sourceItem.type;
  const dropPosition = getWorkspaceGridDropPosition(clientX, clientY, sourceItem);

  if (!dropPosition) {
    return null;
  }

  if (dropPosition.isHotseat) {
    if (sourceType !== "app" && sourceType !== "hotseat-app") {
      return {
        ...dropPosition,
        isValid: false,
        message: "Hotseat only supports apps",
      };
    }

    const isValid = isValidDropPosition(
      dropPosition.x,
      dropPosition.y,
      dropPosition.screen,
      sourceType,
      1,
      1,
      null,
    );

    return {
      ...dropPosition,
      isValid,
      message: isValid ? "" : "Hotseat slot is occupied",
    };
  }

  if (sourceType === "hotseat-app") {
    const isValid = isValidDropPosition(
      dropPosition.x,
      dropPosition.y,
      dropPosition.screen,
      "app",
      1,
      1,
      null,
    );

    return {
      ...dropPosition,
      isValid,
      message: isValid
        ? ""
        : "Invalid drop position: Position is occupied or out of bounds",
    };
  }

  const stickyPosition = getStickyWorkspaceHomePosition(
    clientX,
    clientY,
    sourceItem,
  );
  const magneticPosition =
    stickyPosition ||
    getMagneticWorkspaceHomePosition(
      dropPosition,
      clientX,
      clientY,
      sourceItem,
    );
  const resolvedPosition = magneticPosition || dropPosition;

  const isValid = isValidDropPosition(
    resolvedPosition.x,
    resolvedPosition.y,
    resolvedPosition.screen,
    sourceItem.type,
    resolvedPosition.spanX,
    resolvedPosition.spanY,
    sourceItem,
  );

  return {
    ...resolvedPosition,
    isValid,
    message: isValid
      ? ""
      : "Invalid drop position: Position is occupied or out of bounds",
  };
}

function updateWorkspaceDropPreviewFromEvent(e, targetElement = null) {
  if (!dragSourceItem || currentMode !== "default-workspace") {
    return;
  }

  if (isCartDragActive()) {
    const preview = getWorkspaceDropPreviewForGrid(e.clientX, e.clientY);
    renderWorkspaceDropPreview(preview);
    return;
  }

  const targetPreview =
    targetElement && targetElement !== dragSourceItem
      ? getWorkspaceDropPreviewForTarget(targetElement)
      : null;

  const preview =
    targetPreview || getWorkspaceDropPreviewForGrid(e.clientX, e.clientY);

  renderWorkspaceDropPreview(preview);
}

function getWorkspaceDropTargetElement(clientX, clientY) {
  const stack = document.elementsFromPoint
    ? document.elementsFromPoint(clientX, clientY)
    : [document.elementFromPoint(clientX, clientY)].filter(Boolean);

  for (const element of stack) {
    if (!element) continue;

    const candidate = element.classList?.contains("app-item")
      ? element
      : element.closest?.(".app-item");

    if (!candidate || candidate === dragSourceItem || !candidate.itemData) {
      continue;
    }

    if (!appGrid || !appGrid.contains(candidate)) {
      continue;
    }

    return candidate;
  }

  return null;
}

/** Hotseat slot under the pointer when hit-testing missed the .app-item (gaps, edges). */
function findWorkspaceHotseatAppElementBySlot(slot) {
  const n = Number(slot);
  if (!Number.isFinite(n) || !appGrid) return null;
  const items = appGrid.querySelectorAll(".app-item");
  for (const el of items) {
    if (el.itemData?.type !== "hotseat-app") continue;
    const s = Number(
      el.itemData.data?.hotseatSlot ?? el.itemData.data?.screen ?? -1,
    );
    if (s === n) return el;
  }
  return null;
}

function performWorkspaceSwapDrop(targetElement) {
  if (!dragSourceItem || !targetElement || dragSourceItem === targetElement) {
    return false;
  }

  const sourceItem = dragSourceItem.itemData;
  const targetItem = targetElement.itemData;
  const preview = getWorkspaceDropPreviewForTarget(targetElement);

  if (!sourceItem || !targetItem || !preview || !preview.isValid) {
    showToast(
      preview && preview.message ? preview.message : "Invalid drop position",
      "error",
    );
    clearWorkspaceDropPreview();
    return false;
  }

  const sourceType = sourceItem.type;
  const targetType = targetItem.type;

  if (sourceType === "hotseat-app" && targetType === "hotseat-app") {
    if (sourceItem.data.packageName === targetItem.data.packageName) {
      clearWorkspaceDropPreview();
      return false;
    }
    swapHotseatItems(sourceItem, targetItem);
  } else if (sourceType === "hotseat-app" && targetType === "app") {
    swapHomeAppWithHotseatApp(targetItem, sourceItem);
  } else if (sourceType === "app" && targetType === "hotseat-app") {
    swapHomeAppWithHotseatApp(sourceItem, targetItem);
  } else if (sourceType === "hotseat-app") {
    showToast("Error: Hotseat apps can only swap with another app", "error");
    clearWorkspaceDropPreview();
    return false;
  } else if (targetType === "hotseat-app") {
    showToast("Error: Only apps can move into hotseat", "error");
    clearWorkspaceDropPreview();
    return false;
  } else {
    if (sourceType === "app" && targetType === "folder") {
      openFolderDropChoiceModal(
        "default-workspace",
        sourceItem,
        targetItem,
      );
      clearWorkspaceDropPreview();
      return false;
    }
    if (
      sourceType === targetType &&
      Number(sourceItem.data.x) === Number(targetItem.data.x) &&
      Number(sourceItem.data.y) === Number(targetItem.data.y) &&
      Number(sourceItem.data.screen) === Number(targetItem.data.screen)
    ) {
      clearWorkspaceDropPreview();
      return false;
    }
    swapWorkspaceItems(sourceItem, targetItem);
  }

  saveChangesBtn.disabled = false;
  resetLayoutBtn.disabled = false;
  updateUI();
  refreshXMLViewer();
  clearWorkspaceDropPreview();
  return false;
}

function handleWorkspaceGridDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    clearWorkspaceDropPreview();
  }
}

// Handle workspace drag start
function handleWorkspaceDragStart(e) {
  resetSharedDragState();
  dragSourceItem = this;
  const itemData = this.itemData;

  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", "workspace-item");
  e.dataTransfer.setData(
    "workspace/drag",
    JSON.stringify({
      type: itemData.type,
      data: itemData.data,
      sourceScreen: itemData.data.screen || 0,
    }),
  );
  if (e.dataTransfer.setDragImage) {
    e.dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);
  }

  // Calculate which cell within the widget the mouse grabbed
  const rect = this.getBoundingClientRect();
  const cellSize = getMainCellSize();
  const gap = getCurrentGridGap();
  const cellUnit = cellSize + gap;
  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;
  dragGrabOffset = {
    cellX: Math.floor(offsetX / cellUnit),
    cellY: Math.floor(offsetY / cellUnit),
  };
  // Clamp to span bounds
  const spanX = itemData.data.spanX || 1;
  const spanY = itemData.data.spanY || 1;
  dragGrabOffset.cellX = Math.min(dragGrabOffset.cellX, spanX - 1);
  dragGrabOffset.cellY = Math.min(dragGrabOffset.cellY, spanY - 1);
  dragGrabOffset.cellX = Math.max(0, dragGrabOffset.cellX);
  dragGrabOffset.cellY = Math.max(0, dragGrabOffset.cellY);

  clearWorkspaceDropPreview();
  document.body.classList.add("drag-in-progress");
  this.classList.add("dragging");

  // Add a small delay to ensure the visual feedback is visible
  setTimeout(() => {
    this.style.opacity = "0.35";
  }, 0);
}

// Handle workspace drag over
function handleWorkspaceDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  updateWorkspaceDropPreviewFromEvent(e, e.currentTarget);
  e.dataTransfer.dropEffect = "move";
  return false;
}

// Handle workspace drag enter
function handleWorkspaceDragEnter(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  updateWorkspaceDropPreviewFromEvent(e, e.currentTarget);
  return false;
}

// Handle workspace drag leave
function handleWorkspaceDragLeave(e) {
  const nextTarget = e.relatedTarget;
  if (nextTarget && appGrid.contains(nextTarget)) {
    return;
  }
}

// Handle workspace drop
function handleWorkspaceDrop(e) {
  e.preventDefault?.();
  /* Always stop bubbling so appGrid.drop does not also run (duplicate / wrong path). */
  e.stopPropagation?.();

  if (!dragSourceItem || dragSourceItem === this) {
    clearWorkspaceDropPreview();
    return false;
  }

  if (isCartDragActive()) {
    const cartEntry = getActiveDraggedCartEntry();
    const preview = getWorkspaceDropPreviewForGrid(e.clientX, e.clientY);

    try {
      if (!preview?.isValid) {
        throw new Error(
          preview?.message || "Target cell is occupied or out of bounds",
        );
      }

      restoreCartEntryToWorkspacePreview(cartEntry, preview);
      currentPage = preview.screen;
      setUnsavedChanges(true);
      saveChangesBtn.disabled = false;
      resetLayoutBtn.disabled = false;
      updateUI();
      refreshXMLViewer();
      schedulePersistCurrentSession();
      showToast(
        `${getCartEntryDisplayName(cartEntry)} restored to page ${preview.screen + 1}`,
        "success",
      );
    } catch (error) {
      console.error("Error restoring cart item:", error);
      showToast(error.message || String(error), "error");
    } finally {
      resetSharedDragState();
    }

    return false;
  }

  try {
    return performWorkspaceSwapDrop(this);
  } catch (error) {
    console.error("Error handling drop:", error);
    showToast("Error: " + error.message, "error");
  }

  clearWorkspaceDropPreview();
  return false;
}

// Swap two hotseat items (match by dock slot, not package — reliable & unique per cell)
function swapHotseatItems(itemData1, itemData2) {
  const slot1 = Number(
    itemData1.data.hotseatSlot ?? itemData1.data.screen ?? -1,
  );
  const slot2 = Number(
    itemData2.data.hotseatSlot ?? itemData2.data.screen ?? -1,
  );

  if (
    !Number.isFinite(slot1) ||
    !Number.isFinite(slot2) ||
    slot1 < 0 ||
    slot2 < 0
  ) {
    throw new Error("Invalid hotseat slot for swap");
  }

  if (slot1 === slot2) {
    return;
  }

  const item1Index = virtualWorkspaceBuffer.hotseat.findIndex(
    (item) => Number(item.screen) === slot1,
  );
  const item2Index = virtualWorkspaceBuffer.hotseat.findIndex(
    (item) => Number(item.screen) === slot2,
  );

  if (item1Index === -1) {
    throw new Error(`No hotseat item at slot ${slot1}`);
  }

  if (item2Index === -1) {
    throw new Error(`No hotseat item at slot ${slot2}`);
  }

  const tempScreen = virtualWorkspaceBuffer.hotseat[item1Index].screen;
  virtualWorkspaceBuffer.hotseat[item1Index].screen =
    virtualWorkspaceBuffer.hotseat[item2Index].screen;
  virtualWorkspaceBuffer.hotseat[item2Index].screen = tempScreen;

  sortWorkspaceHotseatItems();
  setUnsavedChanges(true);

  showToast("Successfully swapped hotseat items", "success");

  console.log(
    `Swapped hotseat items: slots ${slot1} <-> ${slot2} (indices ${item1Index} <-> ${item2Index})`,
  );
}

// Handle workspace drag end
function handleWorkspaceDragEnd(e) {
  resetSharedDragState();
}

// Calculate grid position from mouse coordinates (accounts for home rows, gap track, hotseat row)
function calculateGridPosition(clientX, clientY) {
  const gridRect = appGrid.getBoundingClientRect();
  if (
    clientX < gridRect.left ||
    clientX > gridRect.right ||
    clientY < gridRect.top ||
    clientY > gridRect.bottom
  ) {
    return null;
  }

  const pad = 12; // matches CSS padding
  const relX = clientX - gridRect.left - pad;
  const relY = clientY - gridRect.top - pad;
  // Allow slightly negative values (near edge) — clamp instead of rejecting
  const cellSize = getMainCellSize();
  const gap = getCurrentGridGap(); // matches CSS gap
  const cols = getWorkspaceCols();
  const homeRows = getWorkspaceHomeRows();
  const cellUnit = cellSize + gap;
  const visiblePages = getVisibleCanvasPages();
  const pageContentWidth = getCanvasPageContentWidth(cols, cellSize, gap);
  const pageStride = getCanvasPageStride(cols, cellSize, gap);
  let pageIndex = 0;
  let pageRelX = relX;

  if (visiblePages.length > 1) {
    pageIndex = Math.floor(Math.max(0, relX) / pageStride);
    pageIndex = Math.max(0, Math.min(visiblePages.length - 1, pageIndex));
    pageRelX = relX - pageIndex * pageStride;

    if (pageRelX > pageContentWidth && pageIndex < visiblePages.length - 1) {
      pageIndex += 1;
      pageRelX = relX - pageIndex * pageStride;
    }
  }

  const targetScreen = visiblePages[pageIndex] ?? currentPage;
  const hotseatStartY = homeRows * cellUnit + 10 + gap; // home rows + separator + gap

  if (relY >= hotseatStartY && relY < hotseatStartY + cellSize) {
    const hx = Math.floor(Math.max(0, pageRelX) / cellUnit);
    return {
      x: Math.max(0, Math.min(cols - 1, hx)),
      y: homeRows,
      screen: targetScreen,
      isHotseat: true,
    };
  }

  let x = Math.floor(Math.max(0, pageRelX) / cellUnit);
  let y = Math.floor(Math.max(0, relY) / cellUnit);
  x = Math.max(0, Math.min(cols - 1, x));
  y = Math.max(0, Math.min(homeRows - 1, y));

  return {
    x,
    y,
    screen: targetScreen,
    isHotseat: false,
  };
}

// Helper: check if two buffer items are the same (robust matching)
function isSameBufferItem(bufferItem, excludeData) {
  if (!bufferItem || !excludeData) return false;
  const comparableItem = bufferItem.data || bufferItem;
  const comparableExclude = excludeData.data || excludeData;
  // Reference equality first
  if (comparableItem === comparableExclude) return true;
  // Fallback: match by type + position + package
  if (comparableItem.type !== comparableExclude.type) return false;
  if (comparableItem.type === 'appwidget' || comparableItem.type === 'app') {
    return comparableItem.packageName === comparableExclude.packageName &&
           Number(comparableItem.x) === Number(comparableExclude.x) &&
           Number(comparableItem.y) === Number(comparableExclude.y) &&
           Number(comparableItem.screen) === Number(comparableExclude.screen);
  }
  if (comparableItem.type === 'folder') {
    return comparableItem.title === comparableExclude.title &&
           Number(comparableItem.x) === Number(comparableExclude.x) &&
           Number(comparableItem.y) === Number(comparableExclude.y) &&
           Number(comparableItem.screen) === Number(comparableExclude.screen);
  }
  return false;
}

function getWorkspaceComparableItem(itemLike) {
  if (!itemLike) return null;
  return itemLike.data || itemLike;
}

function findWorkspaceHomeItemIndex(itemLike) {
  const comparableItem = getWorkspaceComparableItem(itemLike);
  if (!comparableItem) return -1;
  return virtualWorkspaceBuffer.home.findIndex((item) =>
    isSameBufferItem(item, comparableItem),
  );
}

function resolveWorkspaceHomeItem(itemLike) {
  const itemIndex = findWorkspaceHomeItemIndex(itemLike);
  if (itemIndex === -1) {
    return getWorkspaceComparableItem(itemLike);
  }
  return virtualWorkspaceBuffer.home[itemIndex];
}

function findWorkspaceHotseatItemIndex(itemLike) {
  const comparableItem = getWorkspaceComparableItem(itemLike);
  if (!comparableItem) return -1;

  const slot = Number(comparableItem.hotseatSlot ?? comparableItem.screen ?? -1);
  if (!Number.isFinite(slot) || slot < 0) {
    return -1;
  }

  return virtualWorkspaceBuffer.hotseat.findIndex(
    (item) => Number(item.screen) === slot,
  );
}

function resolveWorkspaceHotseatItem(itemLike) {
  const itemIndex = findWorkspaceHotseatItemIndex(itemLike);
  if (itemIndex === -1) {
    return null;
  }
  return virtualWorkspaceBuffer.hotseat[itemIndex];
}

function sortWorkspaceHotseatItems() {
  virtualWorkspaceBuffer.hotseat.sort(
    (left, right) => Number(left.screen) - Number(right.screen),
  );
}

function createWorkspaceAppRecord(sourceItem, overrides = {}) {
  const nextItem = {
    type: "app",
    packageName: sourceItem.packageName,
    className: sourceItem.className,
    ...overrides,
  };

  if (sourceItem.comment) {
    nextItem.comment = sourceItem.comment;
  }
  if (sourceItem.hidden !== undefined) {
    nextItem.hidden = sourceItem.hidden;
  }

  return nextItem;
}

function moveHomeAppToHotseat(itemLike, targetSlot) {
  const sourceItem = resolveWorkspaceHomeItem(itemLike);
  const sourceIndex = findWorkspaceHomeItemIndex(itemLike);
  const slot = Number(targetSlot);
  const cols = getWorkspaceCols();

  if (!sourceItem || sourceIndex === -1 || sourceItem.type !== "app") {
    throw new Error("Only home-screen apps can move into hotseat");
  }
  if (!Number.isFinite(slot) || slot < 0 || slot >= cols) {
    throw new Error(`Hotseat slot must be between 0 and ${cols - 1}`);
  }
  if (
    virtualWorkspaceBuffer.hotseat.some(
      (item) => Number(item.screen) === slot,
    )
  ) {
    throw new Error("Selected hotseat slot is already occupied");
  }

  const [movedItem] = virtualWorkspaceBuffer.home.splice(sourceIndex, 1);
  virtualWorkspaceBuffer.hotseat.push(
    createWorkspaceAppRecord(movedItem, { screen: slot }),
  );
  sortWorkspaceHotseatItems();
  setUnsavedChanges(true);
}

function moveHotseatAppToHome(itemLike, targetX, targetY, targetScreen) {
  const sourceIndex = findWorkspaceHotseatItemIndex(itemLike);
  const sourceItem = resolveWorkspaceHotseatItem(itemLike);

  if (!sourceItem || sourceIndex === -1) {
    throw new Error("Source hotseat item was not found");
  }
  if (
    !isValidDropPosition(
      targetX,
      targetY,
      targetScreen,
      "app",
      1,
      1,
      null,
    )
  ) {
    throw new Error("Target cell is occupied or out of bounds");
  }

  const [movedItem] = virtualWorkspaceBuffer.hotseat.splice(sourceIndex, 1);
  virtualWorkspaceBuffer.home.push(
    createWorkspaceAppRecord(movedItem, {
      x: targetX,
      y: targetY,
      screen: targetScreen,
    }),
  );
  sortWorkspaceHotseatItems();
  setUnsavedChanges(true);
}

function moveHotseatAppToSlot(itemLike, targetSlot) {
  const sourceIndex = findWorkspaceHotseatItemIndex(itemLike);
  const sourceItem = resolveWorkspaceHotseatItem(itemLike);
  const slot = Number(targetSlot);
  const cols = getWorkspaceCols();

  if (!sourceItem || sourceIndex === -1) {
    throw new Error("Source hotseat item was not found");
  }
  if (!Number.isFinite(slot) || slot < 0 || slot >= cols) {
    throw new Error(`Hotseat slot must be between 0 and ${cols - 1}`);
  }
  if (Number(sourceItem.screen) === slot) {
    return;
  }
  if (
    virtualWorkspaceBuffer.hotseat.some(
      (item, index) => index !== sourceIndex && Number(item.screen) === slot,
    )
  ) {
    throw new Error("Selected hotseat slot is already occupied");
  }

  virtualWorkspaceBuffer.hotseat[sourceIndex].screen = slot;
  sortWorkspaceHotseatItems();
  setUnsavedChanges(true);
}

function swapHomeAppWithHotseatApp(homeItemLike, hotseatItemLike) {
  const homeIndex = findWorkspaceHomeItemIndex(homeItemLike);
  const hotseatIndex = findWorkspaceHotseatItemIndex(hotseatItemLike);
  const homeItem = resolveWorkspaceHomeItem(homeItemLike);
  const hotseatItem = resolveWorkspaceHotseatItem(hotseatItemLike);

  if (!homeItem || homeIndex === -1 || homeItem.type !== "app") {
    throw new Error("Only apps can swap with hotseat items");
  }
  if (!hotseatItem || hotseatIndex === -1) {
    throw new Error("Target hotseat item was not found");
  }

  const homePosition = {
    x: Number(homeItem.x) || 0,
    y: Number(homeItem.y) || 0,
    screen: Number(homeItem.screen) || 0,
  };
  const hotseatSlot = Number(hotseatItem.screen) || 0;

  virtualWorkspaceBuffer.home[homeIndex] = createWorkspaceAppRecord(
    hotseatItem,
    homePosition,
  );
  virtualWorkspaceBuffer.hotseat[hotseatIndex] = createWorkspaceAppRecord(
    homeItem,
    { screen: hotseatSlot },
  );
  sortWorkspaceHotseatItems();
  setUnsavedChanges(true);
}

function applyWorkspacePreviewMove(sourceItem, preview) {
  if (!sourceItem || !preview?.isValid) {
    throw new Error(
      preview?.message || "Invalid drop position: Position is occupied or out of bounds",
    );
  }

  if (preview.isHotseat) {
    if (sourceItem.type === "hotseat-app") {
      moveHotseatAppToSlot(sourceItem, preview.x);
      return;
    }
    if (sourceItem.type === "app") {
      moveHomeAppToHotseat(sourceItem, preview.x);
      return;
    }
    throw new Error("Hotseat only supports apps");
  }

  if (sourceItem.type === "hotseat-app") {
    moveHotseatAppToHome(sourceItem, preview.x, preview.y, preview.screen);
    return;
  }

  moveWorkspaceItem(sourceItem, preview.x, preview.y, preview.screen);
}

// Check if drop position is valid
function isValidDropPosition(
  x,
  y,
  screen,
  type,
  spanX = 1,
  spanY = 1,
  excludeItem = null,
) {
  const cols = getWorkspaceCols();
  const homeRows = getWorkspaceHomeRows();
  const excludeData = excludeItem ? excludeItem.data : null;

  if (y >= homeRows) {
    if (type !== "app" && type !== "hotseat-app") {
      return false;
    }
    const hotseatPosOccupied = virtualWorkspaceBuffer.hotseat.some((item) => {
      if (excludeData && isSameBufferItem(item, excludeData)) return false;
      return Number(item.screen) === Number(x);
    });
    return !hotseatPosOccupied;
  }

  if (x < 0 || x >= cols || y < 0 || y >= homeRows) {
    return false;
  }

  if (x + spanX > cols || y + spanY > homeRows) {
    return false;
  }

  // Check for overlaps with existing items
  const itemsOnScreen = virtualWorkspaceBuffer.home.filter(
    (item) => item.screen === screen,
  );

  for (const item of itemsOnScreen) {
    if (excludeData && isSameBufferItem(item, excludeData)) continue;

    const itemSpanX = item.spanX || 1;
    const itemSpanY = item.spanY || 1;

    // Check overlap
    const overlap = !(
      x + spanX <= item.x ||
      item.x + itemSpanX <= x ||
      y + spanY <= item.y ||
      item.y + itemSpanY <= y
    );

    if (overlap) {
      return false;
    }
  }

  return true;
}

// Move workspace item to new position
function moveWorkspaceItem(itemData, newX, newY, newScreen) {
  const itemIndex = findWorkspaceHomeItemIndex(itemData);

  if (itemIndex === -1) {
    throw new Error("Source item not found in virtual buffer");
  }

  const sourceData = virtualWorkspaceBuffer.home[itemIndex];

  // Update item position
  virtualWorkspaceBuffer.home[itemIndex].x = newX;
  virtualWorkspaceBuffer.home[itemIndex].y = newY;
  virtualWorkspaceBuffer.home[itemIndex].screen = newScreen;
  setUnsavedChanges(true);

  console.log(
    `Moved item from (${sourceData.x}, ${sourceData.y}) screen ${sourceData.screen} to (${newX}, ${newY}) screen ${newScreen}`,
  );
}

// Swap two workspace items
function swapWorkspaceItems(itemData1, itemData2) {
  const item1Index = findWorkspaceHomeItemIndex(itemData1);
  const item2Index = findWorkspaceHomeItemIndex(itemData2);

  if (item1Index === -1 || item2Index === -1) {
    throw new Error("Could not resolve both items for swapping");
  }

  const data1 = virtualWorkspaceBuffer.home[item1Index];
  const data2 = virtualWorkspaceBuffer.home[item2Index];

  const span1X = data1.spanX || 1;
  const span1Y = data1.spanY || 1;
  const span2X = data2.spanX || 1;
  const span2Y = data2.spanY || 1;

  const cols = getWorkspaceCols();
  const homeRows = getWorkspaceHomeRows();

  // Check if item1 can fit in item2's position and vice versa
  // Widget at data2 position must fit: data2.x + span1X <= cols && data2.y + span1Y <= homeRows
  // Widget at data1 position must fit: data1.x + span2X <= cols && data1.y + span2Y <= homeRows
  if (data2.x + span1X > cols || data2.y + span1Y > homeRows) {
    showToast("Cannot swap: item doesn't fit at target position", "error");
    return;
  }
  if (data1.x + span2X > cols || data1.y + span2Y > homeRows) {
    showToast("Cannot swap: item doesn't fit at source position", "error");
    return;
  }

  // Check for overlap with other items (exclude both swap participants)
  const screen1 = data1.screen;
  const screen2 = data2.screen;
  const otherItems = virtualWorkspaceBuffer.home.filter(
    (_, index) => index !== item1Index && index !== item2Index,
  );

  // Check data1 going to data2 position
  for (const other of otherItems) {
    if (other.screen !== screen2) continue;
    const osx = other.spanX || 1;
    const osy = other.spanY || 1;
    const overlap = !(
      data2.x + span1X <= other.x ||
      other.x + osx <= data2.x ||
      data2.y + span1Y <= other.y ||
      other.y + osy <= data2.y
    );
    if (overlap) {
      showToast("Cannot swap: would overlap with another item", "error");
      return;
    }
  }

  // Check data2 going to data1 position
  for (const other of otherItems) {
    if (other.screen !== screen1) continue;
    const osx = other.spanX || 1;
    const osy = other.spanY || 1;
    const overlap = !(
      data1.x + span2X <= other.x ||
      other.x + osx <= data1.x ||
      data1.y + span2Y <= other.y ||
      other.y + osy <= data1.y
    );
    if (overlap) {
      showToast("Cannot swap: would overlap with another item", "error");
      return;
    }
  }

  // Swap positions
  const tempX = data1.x;
  const tempY = data1.y;
  const tempScreen = data1.screen;

  data1.x = data2.x;
  data1.y = data2.y;
  data1.screen = data2.screen;

  data2.x = tempX;
  data2.y = tempY;
  data2.screen = tempScreen;
  setUnsavedChanges(true);

  // Show success toast
  showToast("Successfully swapped grid items", "success");

  if (DEBUG) console.log(
    `Swapped items: (${tempX}, ${tempY}) screen ${tempScreen} <-> (${data1.x}, ${data1.y}) screen ${data1.screen}`,
  );
}

// Move item between hotseat and main grid
function moveBetweenHotseatAndGrid(
  itemData,
  targetType,
  targetX = 0,
  targetY = 0,
  targetScreen = 0,
) {
  if (targetType === "hotseat") {
    moveHomeAppToHotseat(itemData, targetX);
  } else {
    moveHotseatAppToHome(itemData, targetX, targetY, targetScreen);
  }
}

// Handle grid-level drag over (for empty cell drops)
function handleWorkspaceGridDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  if (dragSourceItem) {
    const targetElement = e.target.closest(".app-item");
    updateWorkspaceDropPreviewFromEvent(
      e,
      targetElement && targetElement !== dragSourceItem ? targetElement : null,
    );
  }
  e.dataTransfer.dropEffect = "move";
  return false;
}

// Legacy grid-level drop handler kept only for reference while the new preview-based
// handler below owns actual workspace drops.
function handleWorkspaceGridDropLegacy(e) {
  return false;
  if (e.preventDefault) {
    e.preventDefault();
  }
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  // If no drag source, ignore
  if (!dragSourceItem) {
    clearWorkspaceDropPreview();
    return false;
  }

  // If the drop target is an app-item that is NOT the drag source, let the
  // item-level handler deal with it (swap logic). But if it IS the drag source
  // (e.g. moving a large widget by less than its span), handle it here.
  const closestItem = e.target.closest(".app-item");
  if (closestItem && closestItem !== dragSourceItem) {
    return false;
  }

  try {
    const sourceItem = dragSourceItem.itemData;
    const preview = getWorkspaceDropPreviewForGrid(e.clientX, e.clientY);

    // Calculate target position — the raw position is where the MOUSE is,
    // adjust by the grab offset so we get the widget's intended top-left
    const rawGridPos = calculateGridPosition(e.clientX, e.clientY);

    if (!rawGridPos) {
      if (DEBUG) console.error("Invalid drop position — outside grid");
      return false;
    }

    // For widgets with span > 1, clamp position so the widget fits within bounds
    const cols = getWorkspaceCols();
    const homeRows = getWorkspaceHomeRows();
    let dropX, dropY;

    if (!rawGridPos.isHotseat) {
      // Subtract grab offset to get the widget's top-left corner
      dropX = rawGridPos.x - dragGrabOffset.cellX;
      dropY = rawGridPos.y - dragGrabOffset.cellY;
      // Clamp so widget doesn't overflow grid
      dropX = Math.min(dropX, cols - spanX);
      dropY = Math.min(dropY, homeRows - spanY);
      dropX = Math.max(0, dropX);
      dropY = Math.max(0, dropY);
    } else {
      dropX = rawGridPos.x;
      dropY = rawGridPos.y;
    }

    const gridPos = { x: dropX, y: dropY, screen: rawGridPos.screen, isHotseat: rawGridPos.isHotseat };

    // Validate drop position
    if (
      !isValidDropPosition(
        gridPos.x,
        gridPos.y,
        gridPos.screen,
        sourceType,
        spanX,
        spanY,
        sourceItem,
      )
    ) {
      showToast(
        "Invalid drop position: Position is occupied or out of bounds",
        "error",
      );
      return false;
    }

    // Handle drop to empty cell
    moveWorkspaceItem(sourceItem, gridPos.x, gridPos.y, gridPos.screen);

    // Enable save button
    saveChangesBtn.disabled = false;
    resetLayoutBtn.disabled = false;

    // Update UI
    updateUI();
    refreshXMLViewer();

    if (DEBUG) console.log(
      `Dropped ${sourceType} to empty cell (${dropX}, ${dropY}) on screen ${gridPos.screen}`,
    );
  } catch (error) {
    console.error("Error handling grid drop:", error);
    showToast("Error: " + error.message, "error");
  }

  return false;
}

function handleWorkspaceGridDrop(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  if (!dragSourceItem) {
    clearWorkspaceDropPreview();
    return false;
  }

  if (isCartDragActive()) {
    const cartEntry = getActiveDraggedCartEntry();

    try {
      const preview = getWorkspaceDropPreviewForGrid(e.clientX, e.clientY);
      if (!preview?.isValid) {
        throw new Error(
          preview?.message || "Target cell is occupied or out of bounds",
        );
      }

      restoreCartEntryToWorkspacePreview(cartEntry, preview);
      currentPage = preview.screen;
      setUnsavedChanges(true);
      saveChangesBtn.disabled = false;
      resetLayoutBtn.disabled = false;
      updateUI();
      refreshXMLViewer();
      schedulePersistCurrentSession();
      showToast(
        `${getCartEntryDisplayName(cartEntry)} restored to page ${preview.screen + 1}`,
        "success",
      );
    } catch (error) {
      console.error("Error restoring cart item:", error);
      showToast(error.message || String(error), "error");
    } finally {
      resetSharedDragState();
    }

    return false;
  }

  let targetElement = getWorkspaceDropTargetElement(e.clientX, e.clientY);

  /* Hotseat: hit-testing often misses the .app-item (cell padding, edges). Resolve slot from coordinates. */
  if (
    !targetElement &&
    dragSourceItem.itemData?.type === "hotseat-app"
  ) {
    const raw = calculateGridPosition(e.clientX, e.clientY);
    if (raw?.isHotseat) {
      const srcSlot = Number(
        dragSourceItem.itemData.data.hotseatSlot ??
          dragSourceItem.itemData.data.screen ??
          -1,
      );
      if (Number.isFinite(srcSlot) && raw.x !== srcSlot) {
        targetElement = findWorkspaceHotseatAppElementBySlot(raw.x);
      }
    }
  }

  if (targetElement) {
    try {
      return performWorkspaceSwapDrop(targetElement);
    } catch (error) {
      console.error("Error handling swap drop:", error);
      showToast("Error: " + error.message, "error");
      clearWorkspaceDropPreview();
      return false;
    }
  }

  try {
    const sourceItem = dragSourceItem.itemData;
    const preview = getWorkspaceDropPreviewForGrid(e.clientX, e.clientY);

    if (!preview) {
      if (DEBUG) console.error("Invalid drop position - outside grid");
      clearWorkspaceDropPreview();
      return false;
    }

    if (!preview.isValid) {
      showToast(
        preview.message || "Invalid drop position: Position is occupied or out of bounds",
        "error",
      );
      clearWorkspaceDropPreview();
      return false;
    }

    applyWorkspacePreviewMove(sourceItem, preview);

    saveChangesBtn.disabled = false;
    resetLayoutBtn.disabled = false;

    updateUI();
    refreshXMLViewer();

    if (DEBUG) console.log(
      `Dropped ${sourceItem.type} to empty cell (${preview.x}, ${preview.y}) on screen ${preview.screen}`,
    );
  } catch (error) {
    console.error("Error handling grid drop:", error);
    showToast("Error: " + error.message, "error");
  }

  clearWorkspaceDropPreview();
  return false;
}

// Check if position is within grid bounds
function isWithinBounds(x, y, screen, type, spanX = 1, spanY = 1) {
  const cols = getWorkspaceCols();
  const homeRows = getWorkspaceHomeRows();

  if (y >= homeRows) {
    if (type !== "app" && type !== "hotseat-app") {
      return false;
    }
    if (x < 0 || x >= cols) {
      return false;
    }
  } else {
    if (x < 0 || x >= cols || y < 0 || y >= homeRows) {
      return false;
    }
    if (x + spanX > cols || y + spanY > homeRows) {
      return false;
    }
  }

  return true;
}

// Find item at a specific position
function findItemAtPosition(x, y, screen) {
  return virtualWorkspaceBuffer.home.find((item) => {
    if (item.screen !== screen) return false;
    const itemSpanX = item.spanX || 1;
    const itemSpanY = item.spanY || 1;
    return (
      x >= item.x &&
      x < item.x + itemSpanX &&
      y >= item.y &&
      y < item.y + itemSpanY
    );
  });
}

// ============================================================
// CROSS-SCREEN DRAG AND DROP HELPER FUNCTIONS
// ============================================================

// Validate screen capacity
function validateScreenCapacity(screen, excludeItem = null) {
  const cols = getWorkspaceCols();
  const homeRows = getWorkspaceHomeRows();
  const totalCells = cols * homeRows;

  // Get all items on the target screen
  const itemsOnScreen = virtualWorkspaceBuffer.home.filter(
    (item) => item.screen === screen,
  );

  let occupiedCells = 0;
  for (const item of itemsOnScreen) {
    if (excludeItem && item === excludeItem.data) continue;
    const spanX = item.spanX || 1;
    const spanY = item.spanY || 1;
    occupiedCells += spanX * spanY;
  }

  // Return available cells
  return totalCells - occupiedCells;
}

// Get target screen from drop position
function getTargetScreenFromDrop(clientX, clientY) {
  // For now, drops happen on the current page
  // This could be enhanced to support screen navigation
  return currentPage;
}

// Recalculate screen pagination
function recalculateScreenPagination() {
  const screens = virtualWorkspaceBuffer.home.map((item) => item.screen);
  const maxScreen = screens.length > 0 ? Math.max(...screens) : 0;

  // Check if current page is beyond total pages
  if (currentPage > maxScreen) {
    currentPage = Math.max(0, maxScreen);
  }

  // Update page info
  const totalPages = maxScreen + 1;
  const visiblePages = getVisibleCanvasPages();
  const lastVisible = visiblePages[visiblePages.length - 1];
  pageInfo.textContent =
    visiblePages.length > 1
      ? `${visiblePages[0] + 1}-${visiblePages[visiblePages.length - 1] + 1} / ${totalPages}`
      : `${currentPage + 1} / ${totalPages}`;
  setPaginationButtonState(prevPageBtn, currentPage <= 0);
  setPaginationButtonState(nextPageBtn, lastVisible >= totalPages - 1);
}

// Handle cross-screen move
function handleCrossScreenMove(itemData, fromScreen, toScreen, x, y) {
  const sourceData = itemData.data;

  // Validate destination screen has space
  const availableSpace = validateScreenCapacity(toScreen);
  const spanX = sourceData.spanX || 1;
  const spanY = sourceData.spanY || 1;

  if (availableSpace < spanX * spanY) {
    throw new Error(`Destination screen ${toScreen} doesn't have enough space`);
  }

  // Validate target position is within bounds
  if (!isWithinBounds(x, y, toScreen, itemData.type, spanX, spanY)) {
    throw new Error("Target position is out of bounds");
  }

  // Find and update the item in virtual buffer
  const itemIndex = virtualWorkspaceBuffer.home.findIndex(
    (item) =>
      item === sourceData ||
      (item.type === sourceData.type &&
        item.x === sourceData.x &&
        item.y === sourceData.y &&
        item.screen === fromScreen),
  );

  if (itemIndex === -1) {
    throw new Error("Source item not found in virtual buffer");
  }

  // Update item position and screen
  virtualWorkspaceBuffer.home[itemIndex].x = x;
  virtualWorkspaceBuffer.home[itemIndex].y = y;
  virtualWorkspaceBuffer.home[itemIndex].screen = toScreen;

  console.log(
    `Moved item from screen ${fromScreen} (${sourceData.x}, ${sourceData.y}) to screen ${toScreen} (${x}, ${y})`,
  );

  // Recalculate pagination
  recalculateScreenPagination();
}

// Validate hotseat capacity
function validateHotseatCapacity() {
  return virtualWorkspaceBuffer.hotseat.length < 4;
}

// ============================================================
// WORKSPACE FOLDER DRAG AND DROP FUNCTIONALITY
// ============================================================

// Handle workspace folder drag start
function handleWorkspaceFolderDragStart(e) {
  initializeSharedDragGesture(this, e, "workspace-folder-item");
}

// Handle workspace folder drag over
function handleWorkspaceFolderDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = "move";
  return false;
}

// Handle workspace folder drag enter
function handleWorkspaceFolderDragEnter(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.currentTarget.classList.add("drag-placeholder");
  return false;
}

// Handle workspace folder drag leave
function handleWorkspaceFolderDragLeave(e) {
  const target = e.currentTarget;
  if (!target.contains(e.relatedTarget)) {
    target.classList.remove("drag-placeholder");
  }
}

// Handle workspace folder drop
function handleWorkspaceFolderDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  // Remove placeholder class
  this.classList.remove("drag-placeholder");

  // If source and target are different
  if (dragSourceItem !== this) {
    // Get item data
    const sourceItem = dragSourceItem.itemData;
    const targetItem = this.itemData;

    // Only swap apps
    if (sourceItem.type === "app" && targetItem.type === "app") {
      const sourcePackage = sourceItem.data.packageName;
      const targetPackage = targetItem.data.packageName;

      if (sourcePackage && targetPackage) {
        try {
          // Swap the apps in the current workspace folder
          swapWorkspaceFolderApps(sourcePackage, targetPackage);

          // Enable save button since there are unsaved changes
          saveChangesBtn.disabled = false;
          resetLayoutBtn.disabled = false;

          // Update UI
          updateWorkspaceFolderUI();

          // Refresh XML viewer to show real-time changes
          refreshXMLViewer();

          console.log(
            `Swapped workspace folder apps: ${sourcePackage} <-> ${targetPackage}`,
          );
        } catch (error) {
          console.error("Error swapping apps:", error);
          alert("Error swapping apps: " + error.message);
        }
      }
    }
  }

  return false;
}

// Handle workspace folder drag end
function handleWorkspaceFolderDragEnd(e) {
  resetSharedDragState();
}

// Swap workspace folder apps
function swapWorkspaceFolderApps(packageName1, packageName2) {
  if (!currentFolder || !currentFolder.title) {
    throw new Error("No folder is currently open");
  }

  // Find the folder in the virtual workspace buffer
  const folder = virtualWorkspaceBuffer.home.find(
    (item) =>
      item.type === "folder" &&
      item.title === currentFolder.title &&
      item.screen === currentFolder.screen,
  );

  if (!folder) {
    throw new Error(
      `Folder '${currentFolder.title}' not found in virtual workspace buffer`,
    );
  }

  // Find both apps in the folder
  const app1Index = folder.apps.findIndex(
    (app) => app.packageName === packageName1,
  );
  const app2Index = folder.apps.findIndex(
    (app) => app.packageName === packageName2,
  );

  if (app1Index === -1) {
    throw new Error(
      `App with package name '${packageName1}' not found in folder`,
    );
  }

  if (app2Index === -1) {
    throw new Error(
      `App with package name '${packageName2}' not found in folder`,
    );
  }

  // Swap the apps in the array
  const tempApp = folder.apps[app1Index];
  folder.apps[app1Index] = folder.apps[app2Index];
  folder.apps[app2Index] = tempApp;

  // Update the screen values to reflect the new order
  folder.apps.forEach((app, i) => {
    app.screen = i;
  });

  // Update the folder items array for UI
  folderItems = [];
  folder.apps.forEach((app, index) => {
    folderItems.push({
      type: "app",
      data: app,
      index: index,
    });
  });

  // Show success toast
  showToast("Successfully swapped apps", "success");

  // Mark that there are unsaved changes
  setUnsavedChanges(true);

  console.log(
    "Swapped apps at positions " + app1Index + " and " + app2Index + " in folder '" + folder.title + "'"
  );
}

// ============================================================
// WIDGET RESIZE FUNCTIONALITY
// ============================================================

function addResizeHandles(appItem, item) {
  appItem.style.position = "relative";

  const handles = ["nw", "ne", "sw", "se"];
  handles.forEach((dir) => {
    const handle = document.createElement("div");
    handle.className = `resize-handle ${dir}`;
    handle.dataset.direction = dir;
    handle.setAttribute("draggable", "false");
    handle.addEventListener("mousedown", function (e) {
      startResize(e, appItem, item, dir);
    });
    appItem.appendChild(handle);
  });

  const sizeLabel = document.createElement("div");
  sizeLabel.className = "resize-size-label";
  sizeLabel.textContent = `${item.data.spanX}\u00D7${item.data.spanY}`;
  appItem.appendChild(sizeLabel);
}

function startResize(e, appItem, item, direction) {
  e.preventDefault();
  e.stopPropagation();

  appItem.setAttribute("draggable", "false");

  resizeState = {
    element: appItem,
    direction: direction,
    startMouseX: e.clientX,
    startMouseY: e.clientY,
    origX: item.data.x,
    origY: item.data.y,
    origSpanX: item.data.spanX,
    origSpanY: item.data.spanY,
    itemData: item,
    newX: item.data.x,
    newY: item.data.y,
    newSpanX: item.data.spanX,
    newSpanY: item.data.spanY,
    hasValidPosition: false,
  };

  appItem.classList.add("resizing");

  document.addEventListener("mousemove", handleResize);
  document.addEventListener("mouseup", endResize);
}

function handleResize(e) {
  if (!resizeState) return;

  const gridRect = appGrid.getBoundingClientRect();
  const pad = 12;
  const cellSize = getMainCellSize();
  const gap = getCurrentGridGap();
  const cellUnit = cellSize + gap;
  const cols = getWorkspaceCols();
  const homeRows = getWorkspaceHomeRows();
  const hotseatStartY = homeRows * cellUnit + 10 + gap;

  const relativeX = e.clientX - gridRect.left - pad;
  const relativeY = e.clientY - gridRect.top - pad;
  if (relativeY >= hotseatStartY) {
    return;
  }

  let mouseGridX = Math.floor(relativeX / cellUnit);
  let mouseGridY = Math.floor(relativeY / cellUnit);

  mouseGridX = Math.max(0, Math.min(cols - 1, mouseGridX));
  mouseGridY = Math.max(0, Math.min(homeRows - 1, mouseGridY));

  const { origX, origY, origSpanX, origSpanY, direction } = resizeState;
  const origRight = origX + origSpanX;
  const origBottom = origY + origSpanY;

  let newX = origX;
  let newY = origY;
  let newSpanX = origSpanX;
  let newSpanY = origSpanY;

  if (direction === "se") {
    newSpanX = Math.max(1, mouseGridX - origX + 1);
    newSpanY = Math.max(1, mouseGridY - origY + 1);
  } else if (direction === "sw") {
    newX = Math.min(mouseGridX, origRight - 1);
    newSpanX = origRight - newX;
    newSpanY = Math.max(1, mouseGridY - origY + 1);
  } else if (direction === "ne") {
    newSpanX = Math.max(1, mouseGridX - origX + 1);
    newY = Math.min(mouseGridY, origBottom - 1);
    newSpanY = origBottom - newY;
  } else if (direction === "nw") {
    newX = Math.min(mouseGridX, origRight - 1);
    newSpanX = origRight - newX;
    newY = Math.min(mouseGridY, origBottom - 1);
    newSpanY = origBottom - newY;
  }

  if (newX < 0) {
    newSpanX += newX;
    newX = 0;
  }
  if (newY < 0) {
    newSpanY += newY;
    newY = 0;
  }
  if (newX + newSpanX > cols) {
    newSpanX = cols - newX;
  }
  if (newY + newSpanY > homeRows) {
    newSpanY = homeRows - newY;
  }

  newSpanX = Math.max(1, newSpanX);
  newSpanY = Math.max(1, newSpanY);

  const screen = resizeState.itemData.data.screen;
  const hasOverlap = checkResizeOverlap(
    newX,
    newY,
    newSpanX,
    newSpanY,
    screen,
    resizeState.itemData.data,
  );

  if (hasOverlap) {
    resizeState.element.classList.add("resize-invalid");
    return;
  }

  resizeState.element.classList.remove("resize-invalid");

  resizeState.element.style.gridColumn = `${newX + 1} / span ${newSpanX}`;
  resizeState.element.style.gridRow = `${newY + 1} / span ${newSpanY}`;

  resizeState.newX = newX;
  resizeState.newY = newY;
  resizeState.newSpanX = newSpanX;
  resizeState.newSpanY = newSpanY;
  resizeState.hasValidPosition = true;

  const sizeLabel = resizeState.element.querySelector(".resize-size-label");
  if (sizeLabel) {
    sizeLabel.textContent = `${newSpanX}\u00D7${newSpanY}`;
  }
  const gridBadge = resizeState.element.querySelector(".widget-grid-badge");
  if (gridBadge) {
    gridBadge.textContent = `${newSpanX}\u00D7${newSpanY}`;
    gridBadge.title = `Grid ${newSpanX}\u00D7${newSpanY}`;
  }
}

function checkResizeOverlap(
  newX,
  newY,
  newSpanX,
  newSpanY,
  screen,
  excludeItem,
) {
  const itemsOnScreen = virtualWorkspaceBuffer.home.filter(
    (item) => item.screen === screen && item !== excludeItem,
  );

  for (const item of itemsOnScreen) {
    const itemSpanX = item.spanX || 1;
    const itemSpanY = item.spanY || 1;
    const overlap = !(
      newX + newSpanX <= item.x ||
      item.x + itemSpanX <= newX ||
      newY + newSpanY <= item.y ||
      item.y + itemSpanY <= newY
    );
    if (overlap) return true;
  }
  return false;
}

function endResize(e) {
  if (!resizeState) return;

  document.removeEventListener("mousemove", handleResize);
  document.removeEventListener("mouseup", endResize);

  const {
    element,
    itemData,
    newX,
    newY,
    newSpanX,
    newSpanY,
    origX,
    origY,
    origSpanX,
    origSpanY,
    hasValidPosition,
  } = resizeState;

  element.classList.remove("resizing");
  element.classList.remove("resize-invalid");
  element.setAttribute("draggable", "true");

  if (
    hasValidPosition &&
    (newX !== origX ||
      newY !== origY ||
      newSpanX !== origSpanX ||
      newSpanY !== origSpanY)
  ) {
    const bufferItem = virtualWorkspaceBuffer.home.find(
      (item) =>
        item === itemData.data ||
        (item.type === "appwidget" &&
          item.x === origX &&
          item.y === origY &&
          item.screen === itemData.data.screen &&
          item.packageName === itemData.data.packageName),
    );

    if (bufferItem) {
      bufferItem.x = newX;
      bufferItem.y = newY;
      bufferItem.spanX = newSpanX;
      bufferItem.spanY = newSpanY;

      saveChangesBtn.disabled = false;
      resetLayoutBtn.disabled = false;
      setUnsavedChanges(true);

      showToast(
        `Widget resized to ${newSpanX}\u00D7${newSpanY}`,
        "success",
      );
    }
  }

  resizeState = null;
  updateUI();
  refreshXMLViewer();
}

// ============================================================
// VIEWPORT FIT: Re-render grid on window resize
// ============================================================
let _resizeTimer = null;
window.addEventListener("resize", function () {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(function () {
    updateUI();
  }, 150);
});

// ============================================================
// XML COMPARE FEATURE
// ============================================================

let _compareActiveTab = "current";
const COMPARE_DIFF_PANES_TEMPLATE =
  '<div class="diff-side-pane diff-side-pane-a" id="diff-pane-a"></div>' +
  '<div class="diff-side-divider"></div>' +
  '<div class="diff-side-pane diff-side-pane-b" id="diff-pane-b"></div>';

function isCompareDiffFocusMode() {
  const modal = document.getElementById("compare-xml-modal");
  return !!modal && modal.classList.contains("compare-diff-focus-mode");
}

function setCompareDiffFocusMode(isActive) {
  const modal = document.getElementById("compare-xml-modal");
  const focusBtn = document.getElementById("compare-diff-focus-btn");
  const active = !!isActive;

  if (modal) {
    modal.classList.toggle("compare-diff-focus-mode", active);
  }

  if (focusBtn) {
    focusBtn.setAttribute("aria-pressed", active ? "true" : "false");
    focusBtn.textContent = active
      ? "Exit Full Screen"
      : "Show Diff Full Screen";
  }
}

function toggleCompareDiffFocusMode() {
  const diffOutput = document.getElementById("compare-diff-output");
  if (!diffOutput || diffOutput.style.display === "none") return;

  setCompareDiffFocusMode(!isCompareDiffFocusMode());

  requestAnimationFrame(function () {
    resetDiffPaneScrollPosition();
  });
}

function isCompareDiffVisible() {
  const diffOutput = document.getElementById("compare-diff-output");
  return !!diffOutput && diffOutput.style.display !== "none";
}

function closeCompareDiffResult() {
  if (!isCompareDiffVisible()) return false;

  resetCompareDiffView();

  requestAnimationFrame(function () {
    const sourceBCurrent = document.getElementById("compare-source-b-current");
    const sourceACustom = document.getElementById("compare-source-a-custom");

    if (_compareActiveTab === "current" && sourceBCurrent) {
      sourceBCurrent.focus();
      return;
    }
    if (sourceACustom) {
      sourceACustom.focus();
    }
  });

  return true;
}

function handleCompareCloseRequest() {
  if (closeCompareDiffResult()) return;
  closeCompareXMLModal();
}

function resetCompareDiffView() {
  setCompareDiffFocusMode(false);

  const diffOutput = document.getElementById("compare-diff-output");
  if (diffOutput) {
    diffOutput.style.display = "none";
  }

  const wrapper = document.getElementById("diff-side-wrapper");
  if (wrapper) {
    wrapper.classList.remove("is-identical");
    wrapper.scrollTop = 0;
    wrapper.innerHTML = COMPARE_DIFF_PANES_TEMPLATE;
  }
}

function resetDiffPaneScrollPosition() {
  const paneA = document.getElementById("diff-pane-a");
  const paneB = document.getElementById("diff-pane-b");

  if (paneA) {
    paneA.scrollTop = 0;
    paneA.scrollLeft = 0;
  }

  if (paneB) {
    paneB.scrollTop = 0;
    paneB.scrollLeft = 0;
  }
}

function initCompareTabSwitching() {
  const tabs = document.querySelectorAll(".compare-source-tabs .compare-tab");
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      const target = this.dataset.tab;
      if (target === _compareActiveTab) return;
      _compareActiveTab = target;

      tabs.forEach(function (t) {
        t.classList.toggle("is-active", t.dataset.tab === target);
      });

      document.querySelectorAll(".compare-tab-panel").forEach(function (panel) {
        panel.classList.toggle(
          "is-active",
          panel.id === "compare-tab-" + target,
        );
      });
    });
  });
}

function openCompareXMLModal() {
  const compareButton = document.getElementById("compare-xml-btn");
  if (compareButton?.disabled) return;

  const modal = document.getElementById("compare-xml-modal");
  if (!modal) return;

  // Auto-fill current XML output into source A
  const currentXml = getCurrentXMLText();
  const sourceACurrent = document.getElementById("compare-source-a-current");
  if (sourceACurrent) {
    sourceACurrent.value = currentXml || "";
  }

  // Clear other fields
  const sourceBCurrent = document.getElementById("compare-source-b-current");
  if (sourceBCurrent) sourceBCurrent.value = "";

  // Hide previous diff result
  resetCompareDiffView();

  modal.style.display = "block";

  // Focus the paste textarea
  requestAnimationFrame(function () {
    if (_compareActiveTab === "current" && sourceBCurrent) {
      sourceBCurrent.focus();
    } else {
      const sourceACustom = document.getElementById("compare-source-a-custom");
      if (sourceACustom) sourceACustom.focus();
    }
  });
}

function closeCompareXMLModal() {
  const modal = document.getElementById("compare-xml-modal");
  resetCompareDiffView();
  if (modal) modal.style.display = "none";
}

function getCompareSources() {
  if (_compareActiveTab === "current") {
    const a = document.getElementById("compare-source-a-current");
    const b = document.getElementById("compare-source-b-current");
    return {
      textA: a ? a.value : "",
      textB: b ? b.value : "",
      labelA: "Current Output",
      labelB: "Pasted XML",
    };
  }
  const a = document.getElementById("compare-source-a-custom");
  const b = document.getElementById("compare-source-b-custom");
  return {
    textA: a ? a.value : "",
    textB: b ? b.value : "",
    labelA: "Source A",
    labelB: "Source B",
  };
}

function getDirectChildElementsByNames(parent, names = []) {
  const allowedNames = Array.isArray(names) ? names : [];
  return Array.from(parent?.children || []).filter((element) => {
    if (!allowedNames.length) return true;
    return allowedNames.includes(getNodeLocalName(element));
  });
}

function getSortedCompareAttributePairs(element) {
  return getElementAttributes(element).sort((left, right) => {
    return (
      compareTextValues(left[0], right[0]) ||
      compareTextValues(left[1], right[1])
    );
  });
}

function formatCompareAttributeValue(value) {
  return `"${String(value ?? "")}"`;
}

function formatCompareAttributePairs(attributePairs = []) {
  if (!attributePairs.length) return "";

  return attributePairs
    .map(([name, value]) => `${name}=${formatCompareAttributeValue(value)}`)
    .join(" | ");
}

function buildCompareTagSnippet(tagName, attributePairs = [], options = {}) {
  const { closing = false, selfClosing = true } = options;
  if (closing) {
    return `</${tagName}>`;
  }

  const attrsText = attributePairs.length
    ? ` ${attributePairs
      .map(([name, value]) => `${name}=${formatCompareAttributeValue(value)}`)
      .join(" ")}`
    : "";

  return selfClosing
    ? `<${tagName}${attrsText} />`
    : `<${tagName}${attrsText}>`;
}

function buildCompareCommentPrefix(element) {
  return "";
}

function buildCompareDisplayText(element, tagName, attributePairs = [], options = {}) {
  return (
    buildCompareCommentPrefix(element) +
    buildCompareTagSnippet(tagName, attributePairs, options)
  );
}

function appendCompareRecord(records, keyCounts, baseKey, compareText, displayText) {
  const nextCount = (keyCounts.get(baseKey) || 0) + 1;
  keyCounts.set(baseKey, nextCount);

  const recordKey = nextCount === 1 ? baseKey : `${baseKey}#${nextCount}`;

  records.push({
    key: recordKey,
    compareText,
    displayText: displayText || compareText,
  });
}

function finalizeCompareSnapshot(mode, records) {
  return {
    mode,
    records: records.map((record, index) => ({
      ...record,
      index: index + 1,
    })),
  };
}

function buildAppOrderCompareSnapshot(root) {
  const records = [];
  const keyCounts = new Map();
  const rootSortedAttrs = getSortedCompareAttributePairs(root);
  appendCompareRecord(
    records,
    keyCounts,
    "root-open:appOrder",
    buildCompareTagSnippet("appOrder", rootSortedAttrs, { selfClosing: false }),
    buildCompareTagSnippet("appOrder", getElementAttributes(root), {
      selfClosing: false,
    }),
  );

  Array.from(root.children || []).forEach((element) => {
    const tagName = getNodeLocalName(element);

    if (tagName === "appsGridInfo") {
      const sortedAttrs = getSortedCompareAttributePairs(element);
      appendCompareRecord(
        records,
        keyCounts,
        "grid:appsGridInfo",
        buildCompareTagSnippet("appsGridInfo", sortedAttrs, { selfClosing: true }),
        buildCompareDisplayText(
          element,
          "appsGridInfo",
          getElementAttributes(element),
          { selfClosing: true },
        ),
      );
      return;
    }

    if (tagName === "folder") {
      const title = element.getAttribute("title") || "(untitled folder)";
      const folderSortedAttrs = getSortedCompareAttributePairs(element);
      appendCompareRecord(
        records,
        keyCounts,
        `folder-open:${title}`,
        buildCompareTagSnippet("folder", folderSortedAttrs, { selfClosing: false }),
        buildCompareDisplayText(
          element,
          "folder",
          getElementAttributes(element),
          { selfClosing: false },
        ),
      );

      getDirectChildElementsByNames(element, ["favorite"]).forEach((favorite) => {
          const packageName =
            favorite.getAttribute("packageName") || "(missing package)";
          const className = favorite.getAttribute("className") || "";
          const favoriteSortedAttrs = getSortedCompareAttributePairs(favorite);

          appendCompareRecord(
            records,
            keyCounts,
            `folder-app:${title}:${packageName}:${className}`,
            buildCompareTagSnippet("favorite", favoriteSortedAttrs, {
              selfClosing: true,
            }),
            buildCompareDisplayText(
              favorite,
              "favorite",
              getElementAttributes(favorite),
              { selfClosing: true },
            ),
          );
        });

      appendCompareRecord(
        records,
        keyCounts,
        `folder-close:${title}`,
        "</folder>",
        "</folder>",
      );
      return;
    }

    if (tagName === "favorite") {
      const packageName =
        element.getAttribute("packageName") || "(missing package)";
      const className = element.getAttribute("className") || "";
      const favoriteSortedAttrs = getSortedCompareAttributePairs(element);

      appendCompareRecord(
        records,
        keyCounts,
        `app:${packageName}:${className}`,
        buildCompareTagSnippet("favorite", favoriteSortedAttrs, {
          selfClosing: true,
        }),
        buildCompareDisplayText(
          element,
          "favorite",
          getElementAttributes(element),
          { selfClosing: true },
        ),
      );
    }
  });

  appendCompareRecord(
    records,
    keyCounts,
    "root-close:appOrder",
    "</appOrder>",
    "</appOrder>",
  );

  return finalizeCompareSnapshot("application-order", records);
}

function buildWorkspaceCompareSnapshot(root) {
  const records = [];
  const keyCounts = new Map();
  const rootSortedAttrs = getSortedCompareAttributePairs(root);
  appendCompareRecord(
    records,
    keyCounts,
    "root-open:favorites",
    buildCompareTagSnippet("favorites", rootSortedAttrs, { selfClosing: false }),
    buildCompareTagSnippet("favorites", getElementAttributes(root), {
      selfClosing: false,
    }),
  );

  Array.from(root.children || []).forEach((element) => {
    const tagName = getNodeLocalName(element);

    if (tagName === "homeGridInfo") {
      const sortedAttrs = getSortedCompareAttributePairs(element);
      appendCompareRecord(
        records,
        keyCounts,
        "grid:homeGridInfo",
        buildCompareTagSnippet("homeGridInfo", sortedAttrs, { selfClosing: true }),
        buildCompareDisplayText(
          element,
          "homeGridInfo",
          getElementAttributes(element),
          { selfClosing: true },
        ),
      );
      return;
    }

    if (tagName === "home") {
      appendCompareRecord(
        records,
        keyCounts,
        "section-open:home",
        "<home>",
        buildCompareDisplayText(element, "home", getElementAttributes(element), {
          selfClosing: false,
        }),
      );

      getDirectChildElementsByNames(element, ["appwidget", "favorite", "folder"]).forEach((child) => {
        const childTag = getNodeLocalName(child);

        if (childTag === "appwidget") {
        const packageName =
            child.getAttribute("packageName") || "(missing package)";
          const className = child.getAttribute("className") || "";
          const sortedAttrs = getSortedCompareAttributePairs(child);

          appendCompareRecord(
            records,
            keyCounts,
            `widget:${packageName}:${className}`,
            buildCompareTagSnippet("appwidget", sortedAttrs, { selfClosing: true }),
            buildCompareDisplayText(
              child,
              "appwidget",
              getElementAttributes(child),
              { selfClosing: true },
            ),
          );
          return;
        }

        if (childTag === "favorite") {
          const packageName =
            child.getAttribute("packageName") || "(missing package)";
          const className = child.getAttribute("className") || "";
          const sortedAttrs = getSortedCompareAttributePairs(child);

          appendCompareRecord(
            records,
            keyCounts,
            `home-app:${packageName}:${className}`,
            buildCompareTagSnippet("favorite", sortedAttrs, { selfClosing: true }),
            buildCompareDisplayText(
              child,
              "favorite",
              getElementAttributes(child),
              { selfClosing: true },
            ),
          );
          return;
        }

        const title = child.getAttribute("title") || "(untitled folder)";
        const folderSortedAttrs = getSortedCompareAttributePairs(child);
        appendCompareRecord(
          records,
          keyCounts,
          `home-folder-open:${title}`,
          buildCompareTagSnippet("folder", folderSortedAttrs, {
            selfClosing: false,
          }),
          buildCompareDisplayText(
            child,
            "folder",
            getElementAttributes(child),
            { selfClosing: false },
          ),
        );

        getDirectChildElementsByNames(child, ["favorite"]).forEach((favorite) => {
          const packageName =
            favorite.getAttribute("packageName") || "(missing package)";
          const className = favorite.getAttribute("className") || "";
          const favoriteSortedAttrs = getSortedCompareAttributePairs(favorite);

          appendCompareRecord(
            records,
            keyCounts,
            `home-folder-app:${title}:${packageName}:${className}`,
            buildCompareTagSnippet("favorite", favoriteSortedAttrs, {
              selfClosing: true,
            }),
            buildCompareDisplayText(
              favorite,
              "favorite",
              getElementAttributes(favorite),
              { selfClosing: true },
            ),
          );
        });

        appendCompareRecord(
          records,
          keyCounts,
          `home-folder-close:${title}`,
          "</folder>",
          "</folder>",
        );
      });

      appendCompareRecord(
        records,
        keyCounts,
        "section-close:home",
        "</home>",
        "</home>",
      );
      return;
    }

    if (tagName === "hotseat") {
      appendCompareRecord(
        records,
        keyCounts,
        "section-open:hotseat",
        "<hotseat>",
        buildCompareDisplayText(
          element,
          "hotseat",
          getElementAttributes(element),
          { selfClosing: false },
        ),
      );

      getDirectChildElementsByNames(element, ["favorite"]).forEach((favorite) => {
        const packageName =
          favorite.getAttribute("packageName") || "(missing package)";
        const className = favorite.getAttribute("className") || "";
        const favoriteSortedAttrs = getSortedCompareAttributePairs(favorite);

      appendCompareRecord(
        records,
        keyCounts,
        `hotseat-app:${packageName}:${className}`,
        buildCompareTagSnippet("favorite", favoriteSortedAttrs, { selfClosing: true }),
        buildCompareDisplayText(
          favorite,
          "favorite",
          getElementAttributes(favorite),
          { selfClosing: true },
        ),
      );
      });

      appendCompareRecord(
        records,
        keyCounts,
        "section-close:hotseat",
        "</hotseat>",
        "</hotseat>",
      );
    }
  });

  appendCompareRecord(
    records,
    keyCounts,
    "root-close:favorites",
    "</favorites>",
    "</favorites>",
  );

  return finalizeCompareSnapshot("default-workspace", records);
}

function buildGenericCompareSnapshot(root) {
  const records = [];
  const keyCounts = new Map();

  function visit(element, pathParts = []) {
    const tagName = getNodeLocalName(element);
    const sortedAttrs = getSortedCompareAttributePairs(element);
    const baseKey = `${pathParts.join("/")}:${tagName}`.replace(/^:/, "");

    appendCompareRecord(
      records,
      keyCounts,
      `${baseKey}:open`,
      buildCompareTagSnippet(tagName, sortedAttrs, {
        selfClosing: element.children.length === 0,
      }),
      buildCompareDisplayText(
        element,
        tagName,
        getElementAttributes(element),
        { selfClosing: element.children.length === 0 },
      ),
    );

    Array.from(element.children || []).forEach((child) => {
      visit(child, [...pathParts, tagName]);
    });

    if (element.children.length > 0) {
      appendCompareRecord(
        records,
        keyCounts,
        `${baseKey}:close`,
        `</${tagName}>`,
        `</${tagName}>`,
      );
    }
  }

  visit(root, []);

  return finalizeCompareSnapshot(getNodeLocalName(root) || "unknown", records);
}

function buildXMLCompareSnapshot(xmlText) {
  const xmlDoc = parseXMLDocument(xmlText);
  const root = xmlDoc.documentElement;
  const rootName = getNodeLocalName(root);

  if (rootName === "appOrder") {
    return buildAppOrderCompareSnapshot(root);
  }
  if (rootName === "favorites") {
    return buildWorkspaceCompareSnapshot(root);
  }
  return buildGenericCompareSnapshot(root);
}

function collapseCompareRows(rows, contextLines = 3) {
  if (rows.length <= contextLines * 2 + 1) {
    return rows;
  }

  const nearChange = new Uint8Array(rows.length);
  for (let idx = 0; idx < rows.length; idx++) {
    if (rows[idx].type !== "ctx") {
      for (
        let mark = Math.max(0, idx - contextLines);
        mark <= Math.min(rows.length - 1, idx + contextLines);
        mark++
      ) {
        nearChange[mark] = 1;
      }
    }
  }

  const collapsed = [];
  let skipped = 0;

  for (let idx = 0; idx < rows.length; idx++) {
    if (rows[idx].type === "ctx" && !nearChange[idx]) {
      skipped++;
      continue;
    }

    if (skipped > 0) {
      collapsed.push({ type: "sep", count: skipped });
      skipped = 0;
    }

    collapsed.push(rows[idx]);
  }

  if (skipped > 0) {
    collapsed.push({ type: "sep", count: skipped });
  }

  return collapsed;
}

function buildStructuredCompareDiff(snapshotA, snapshotB) {
  const recordsA = snapshotA.records || [];
  const recordsB = snapshotB.records || [];
  const keysA = recordsA.map((record) => record.key);
  const keysB = recordsB.map((record) => record.key);
  const n = keysA.length;
  const m = keysB.length;
  const dp = new Array(n + 1);

  for (let i = 0; i <= n; i++) {
    dp[i] = new Uint16Array(m + 1);
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (keysA[i - 1] === keysB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let addCount = 0;
  let delCount = 0;
  let sameCount = 0;
  const rows = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && keysA[i - 1] === keysB[j - 1]) {
      const left = recordsA[i - 1];
      const right = recordsB[j - 1];

      if (left.compareText === right.compareText) {
        sameCount++;
        rows.push({
          type: "ctx",
          leftNum: left.index,
          leftText: left.displayText,
          rightNum: right.index,
          rightText: right.displayText,
        });
      } else {
        addCount++;
        delCount++;
        rows.push({
          type: "change",
          leftNum: left.index,
          leftText: left.displayText,
          rightNum: right.index,
          rightText: right.displayText,
        });
      }

      i--;
      j--;
      continue;
    }

    if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      const right = recordsB[j - 1];
      addCount++;
      rows.push({
        type: "add",
        leftNum: null,
        leftText: null,
        rightNum: right.index,
        rightText: right.displayText,
      });
      j--;
    } else {
      const left = recordsA[i - 1];
      delCount++;
      rows.push({
        type: "del",
        leftNum: left.index,
        leftText: left.displayText,
        rightNum: null,
        rightText: null,
      });
      i--;
    }
  }

  rows.reverse();

  return {
    addCount,
    delCount,
    sameCount,
    rows: collapseCompareRows(rows),
    identical: addCount === 0 && delCount === 0,
  };
}

// ---- Diff algorithm (Myers-like LCS for line-level diff) ----

function computeLineDiff(linesA, linesB) {
  const n = linesA.length;
  const m = linesB.length;

  // Build LCS table
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    dp[i] = new Uint16Array(m + 1);
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff operations
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      ops.push({ type: "same", lineA: i, lineB: j, text: linesA[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "add", lineA: null, lineB: j, text: linesB[j - 1] });
      j--;
    } else {
      ops.push({ type: "del", lineA: i, lineB: null, text: linesA[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDiffView(diffData, labelA, labelB) {
  resetCompareDiffView();

  const output = document.getElementById("compare-diff-output");
  const wrapper = document.getElementById("diff-side-wrapper");
  const paneA = document.getElementById("diff-pane-a");
  const paneB = document.getElementById("diff-pane-b");
  const headerA = document.getElementById("diff-header-a");
  const headerB = document.getElementById("diff-header-b");
  if (!paneA || !paneB || !output || !wrapper) return;

  // Update headers
  if (headerA) headerA.textContent = labelA || "Source A";
  if (headerB) headerB.textContent = labelB || "Source B";

  const addCount = diffData?.addCount || 0;
  const delCount = diffData?.delCount || 0;
  const sameCount = diffData?.sameCount || 0;

  // Update stats
  const statAdd = document.getElementById("diff-stat-add");
  const statDel = document.getElementById("diff-stat-del");
  const statSame = document.getElementById("diff-stat-same");
  if (statAdd) statAdd.textContent = "+" + addCount;
  if (statDel) statDel.textContent = "-" + delCount;
  if (statSame) statSame.textContent = sameCount + " same";

  // If identical
  if (diffData?.identical) {
    paneA.innerHTML = "";
    paneB.innerHTML = "";
    wrapper.classList.add("is-identical");
    wrapper.innerHTML =
      '<div class="diff-identical">' +
      '<span class="diff-identical-icon">\u2714</span>' +
      "Both sources are identical \u2014 no differences found." +
      "</div>";
    output.style.display = "flex";
    return;
  }

  // Render HTML for each pane
  function buildRow(num, text, cls, htmlText) {
    return (
      '<div class="diff-row ' + cls + '">' +
      '<span class="diff-row-num">' + (num != null ? num : "") + "</span>" +
      '<span class="diff-row-text">' +
      (htmlText != null ? htmlText : (text != null ? escapeHtml(text) : "")) +
      "</span>" +
      "</div>"
    );
  }

  function buildSepRow(count) {
    return (
      '<div class="diff-row diff-sep">' +
      '<span class="diff-row-num"></span>' +
      '<span class="diff-row-text">@@ ' + count + " unchanged @@</span>" +
      "</div>"
    );
  }

  let htmlA = "";
  let htmlB = "";

  (diffData?.rows || []).forEach(function (row) {
    if (row.type === "sep") {
      htmlA += buildSepRow(row.count);
      htmlB += buildSepRow(row.count);
    } else if (row.type === "ctx") {
      htmlA += buildRow(row.leftNum, row.leftText, "diff-ctx");
      htmlB += buildRow(row.rightNum, row.rightText, "diff-ctx");
    } else if (row.type === "del") {
      htmlA += buildRow(row.leftNum, row.leftText, "diff-del-row");
      htmlB += buildRow(null, "", "diff-empty");
    } else if (row.type === "add") {
      htmlA += buildRow(null, "", "diff-empty");
      htmlB += buildRow(row.rightNum, row.rightText, "diff-add-row");
    } else if (row.type === "change") {
      htmlA += buildRow(row.leftNum, row.leftText, "diff-del-row");
      htmlB += buildRow(row.rightNum, row.rightText, "diff-add-row");
    }
  });

  paneA.innerHTML = htmlA;
  paneB.innerHTML = htmlB;
  bindDiffPaneScrollSync(paneA, paneB);
  output.style.display = "flex";
}

function bindDiffPaneScrollSync(paneA, paneB) {
  if (!paneA || !paneB) return;

  let syncing = false;

  function syncFrom(source, target) {
    if (syncing) return;
    syncing = true;
    target.scrollTop = source.scrollTop;
    syncing = false;
  }

  paneA.onscroll = function () {
    syncFrom(paneA, paneB);
  };

  paneB.onscroll = function () {
    syncFrom(paneB, paneA);
  };
}

function runXMLCompare() {
  const { textA, textB, labelA, labelB } = getCompareSources();

  if (!textA.trim() && !textB.trim()) {
    showToast("Please provide XML content in both sources", "error");
    return;
  }
  if (!textA.trim()) {
    showToast("Source A is empty", "error");
    return;
  }
  if (!textB.trim()) {
    showToast("Source B is empty", "error");
    return;
  }

  try {
    const snapshotA = buildXMLCompareSnapshot(textA);
    const snapshotB = buildXMLCompareSnapshot(textB);
    const diffData = buildStructuredCompareDiff(snapshotA, snapshotB);
    renderDiffView(diffData, labelA, labelB);
    showToast("Structural XML comparison complete", "success");
  } catch (error) {
    console.error("Error comparing XML:", error);
    showToast("Compare failed: " + error.message, "error");
    return;
  }

  // Reset viewport inside the side-by-side diff.
  requestAnimationFrame(function () {
    resetDiffPaneScrollPosition();
  });
}


// ============================================================
// PUBLIC ACCESS SHIM (for layout-tool-enhancements.js)
// Exposes top-level `let` bindings as live getters/setters on
// window so other classic scripts can read and replace them.
// Safe to call from anywhere — only attaches if not already
// installed.
// ============================================================
(function installLayoutToolPublicShim() {
  if (window.__layoutToolPublicShimInstalled) return;
  window.__layoutToolPublicShimInstalled = true;

  function defineLive(name, getter, setter) {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: getter,
        set: setter,
      });
    } catch (_) {
      /* noop — already defined or non-configurable */
    }
  }

  defineLive(
    "virtualBuffer",
    () => virtualBuffer,
    (v) => { virtualBuffer = v; },
  );
  defineLive(
    "virtualWorkspaceBuffer",
    () => virtualWorkspaceBuffer,
    (v) => { virtualWorkspaceBuffer = v; },
  );
  defineLive(
    "cartItems",
    () => cartItems,
    (v) => { cartItems = v; },
  );
  defineLive(
    "currentMode",
    () => currentMode,
    (v) => { currentMode = v; },
  );
  defineLive(
    "currentLayout",
    () => currentLayout,
    (v) => { currentLayout = v; },
  );
  defineLive(
    "currentPage",
    () => currentPage,
    (v) => { currentPage = v; },
  );
  defineLive(
    "customGridLayout",
    () => customGridLayout,
    (v) => { customGridLayout = v; },
  );
  defineLive(
    "unsavedChanges",
    () => unsavedChanges,
    (v) => { unsavedChanges = v; },
  );
  defineLive(
    "xmlEditorDirty",
    () => xmlEditorDirty,
    (v) => { xmlEditorDirty = v; },
  );
  defineLive(
    "selectedItem",
    () => selectedItem,
    (v) => { selectedItem = v; },
  );

  // Functions are already on the global object via classic script
  // hoisting, so no shim needed for them. We do install setters for
  // a few key fns so wrappers can replace the live binding too.
  function defineFnSlot(name) {
    let value = window[name];
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => value,
        set: (v) => { value = v; },
      });
    } catch (_) {
      /* noop */
    }
  }

  // Make sure these are replaceable through window assignment.
  [
    "setUnsavedChanges",
    "saveChanges",
    "resetLayout",
    "exportXML",
    "updateUI",
    "refreshXMLViewer",
    "schedulePersistCurrentSession",
    "renderCartPanel",
    "syncCartSerialFromEntries",
    "sendItemToCart",
    "hideContextMenu",
    "syncLayoutClasses",
    "syncCustomGridPanelVisibility",
    "showToast",
    "loadXMLContent",
    "copyTextToClipboard",
  ].forEach(defineFnSlot);
})();
