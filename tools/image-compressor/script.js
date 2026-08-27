// Image Compression — fully client-side.
// Compression runs in the browser: Canvas encoders for JPEG/WebP/AVIF,
// UPNG (+pako) for palette-quantized PNG. No server, no uploads.

(() => {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────────
  /** @type {Array<{id:string, file:File, originalSize:number, originalUrl:string, originalDims?:{w:number,h:number}}>} */
  let items = [];
  /** @type {Object.<string, any>} compressed result keyed by item id */
  let results = {};
  /** @type {Object.<string, string>} blob URL keyed by item id */
  let resultUrls = {};

  let listFormat = 'auto';
  let listQuality = 50;
  let listWidth = 9999;

  const limits = {
    maxFiles: 20,
    maxFileSizeMb: 50,
    maxSidePx: 16384,
    maxMegapixels: 100,
    defaultQuality: 80,
  };
  const MAX_QUALITY_NO_ALPHA = 85;
  const MAX_QUALITY_WITH_ALPHA = 90;

  // Which encoders this browser actually supports (detected at init).
  const support = { webp: false, avif: false };

  // Compare-view state
  let compareItemId = null;
  let cmpFormat = 'auto';
  let cmpQuality = 50;
  let cmpWidth = 9999;
  let cmpZoom = 100;
  let cmpDividerPct = 50;
  let cmpRequestSeq = 0; // race protector
  let cmpDebounceTimer = null;

  // ─── DOM ───────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);

  const shell = $('#main');
  const dropzone = $('#dropzone');
  const fileInput = $('#file-input');
  const fileGrid = $('#file-grid');
  const summary = $('#summary');
  const errorBanner = $('#error-banner');

  const qualityRange = $('#quality-range');
  const qualityValue = $('#quality-value');
  const widthSelect = $('#width-select');
  const recompressBtn = $('#recompress-btn');

  const downloadZipBtn = $('#download-zip');
  const downloadLabel = $('#download-label');
  const clearBtn = $('#clear-btn');

  const statOriginal = $('#stat-original');
  const statCompressed = $('#stat-compressed');
  const statSaved = $('#stat-saved');

  // Compare DOM
  const cmpBack = $('#compare-back');
  const cmpDownload = $('#compare-download');
  const cmpFilename = $('#compare-filename');
  const cmpMeta = $('#compare-meta');
  const cmpViewport = $('#compare-viewport');
  const cmpStage = $('#compare-stage');
  const cmpImgOrig = $('#compare-img-orig');
  const cmpImgComp = $('#compare-img-comp');
  const cmpPaneComp = $('#compare-pane-comp');
  const cmpDivider = $('#compare-divider');
  const cmpTagComp = $('#compare-tag-comp');
  const cmpBusy = $('#compare-busy');
  const cmpQualityRange = $('#cmp-quality-range');
  const cmpQualityValue = $('#cmp-quality-value');
  const cmpWidthSelect = $('#cmp-width-select');
  const cmpZoomRange = $('#cmp-zoom-range');
  const cmpZoomValue = $('#cmp-zoom-value');
  const cmpZoomIn = $('#cmp-zoom-in');
  const cmpZoomOut = $('#cmp-zoom-out');
  const cmpZoomFit = $('#cmp-zoom-fit');
  const cmpStatOrig = $('#cmp-stat-orig');
  const cmpStatComp = $('#cmp-stat-comp');
  const cmpStatSaved = $('#cmp-stat-saved');
  const cmpStatDim = $('#cmp-stat-dim');
  const cmpStatMime = $('#cmp-stat-mime');

  // ─── Helpers ───────────────────────────────────────────────────────
  const uid = () => Math.random().toString(36).slice(2, 10);

  const fmtBytes = (n) => {
    if (n == null || isNaN(n)) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  };

  const showError = (message) => {
    if (!message) {
      errorBanner.hidden = true;
      errorBanner.textContent = '';
      return;
    }
    errorBanner.hidden = false;
    errorBanner.textContent = message;
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const probeImageDims = (url) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = url;
    });

  const triggerDownload = (url, filename) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const fileExtFromMime = (mime, fallback) =>
    (mime || '').split('/')[1] || fallback || 'webp';

  const baseName = (filename) => filename.replace(/\.[^.]+$/, '');

  // ─── Encoder support detection ─────────────────────────────────────
  function detectEncoder(type) {
    return new Promise((resolve) => {
      try {
        const c = document.createElement('canvas');
        c.width = 2;
        c.height = 2;
        c.getContext('2d').fillRect(0, 0, 2, 2);
        c.toBlob((blob) => resolve(!!blob && blob.type === type), type, 0.8);
      } catch {
        resolve(false);
      }
    });
  }

  async function initEncoderSupport() {
    support.webp = await detectEncoder('image/webp');
    support.avif = await detectEncoder('image/avif');

    const names = [];
    if (support.webp) names.push('WebP');
    if (support.avif) names.push('AVIF');
    names.push('JPEG', 'PNG');

    const hint = document.getElementById('supported-formats-hint');
    if (hint) hint.textContent = names.join(', ');
    const footerFormats = document.getElementById('footer-formats');
    if (footerFormats) footerFormats.textContent = names.join(' · ');

    [['webp', support.webp], ['avif', support.avif]].forEach(([fmt, ok]) => {
      if (ok) return;
      document
        .querySelectorAll(`[data-format="${fmt}"], [data-cmp-format="${fmt}"]`)
        .forEach((btn) => {
          btn.disabled = true;
          btn.classList.add('is-unavailable');
          btn.title = `${fmt.toUpperCase()} encoding is not supported by this browser`;
        });
    });
  }

  // ─── List view: drop / pick ────────────────────────────────────────
  function bindDropzone() {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('is-dragover');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      handleFiles([...e.dataTransfer.files]);
    });
    fileInput.addEventListener('change', () => {
      handleFiles([...fileInput.files]);
      fileInput.value = '';
    });
  }

  function handleFiles(filesIn) {
    showError('');
    const imgs = filesIn.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) {
      showError('No images detected in the dropped files.');
      return;
    }
    const remaining = limits.maxFiles - items.length;
    if (remaining <= 0) {
      showError(`Limit reached: ${limits.maxFiles} files max per session. Clear all first.`);
      return;
    }
    const accepted = imgs.slice(0, remaining);
    if (accepted.length < imgs.length) {
      showError(`Only ${accepted.length} of ${imgs.length} files added — limit is ${limits.maxFiles}.`);
    }

    accepted.forEach((file) => {
      if (file.size > limits.maxFileSizeMb * 1024 * 1024) {
        showError(`"${file.name}" is bigger than ${limits.maxFileSizeMb} MB — skipped.`);
        return;
      }
      const id = uid();
      const item = {
        id,
        file,
        originalSize: file.size,
        originalUrl: URL.createObjectURL(file),
      };
      items.unshift(item);
      renderListCard(item);
      compressForList(id);
    });
  }

  // ─── List view: card rendering ─────────────────────────────────────
  function renderListCard(item) {
    const card = document.createElement('article');
    card.className = 'file-card';
    card.id = `card-${item.id}`;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open compare view for ${item.file.name}`);

    const thumb = document.createElement('div');
    thumb.className = 'file-card__thumb';
    const thumbImg = document.createElement('img');
    thumbImg.alt = '';
    thumbImg.src = item.originalUrl;
    thumb.appendChild(thumbImg);

    const body = document.createElement('div');
    body.className = 'file-card__body';
    body.innerHTML = `
      <p class="file-card__name" title="${escapeAttr(item.file.name)}">${escapeHtml(item.file.name)}</p>
      <p class="file-card__size">${fmtBytes(item.originalSize)}</p>
      <div class="file-card__bar" id="bar-${item.id}"><div class="file-card__bar-fill"></div></div>
      <div class="file-card__status" id="status-${item.id}"><span class="badge badge--working">Optimising…</span></div>
    `;

    const actions = document.createElement('div');
    actions.className = 'file-card__actions';

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'icon-btn';
    dlBtn.id = `dl-${item.id}`;
    dlBtn.title = 'Download';
    dlBtn.disabled = true;
    dlBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadOne(item.id);
    });

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'icon-btn icon-btn--danger';
    rmBtn.title = 'Remove';
    rmBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    rmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeItem(item.id);
    });

    actions.append(dlBtn, rmBtn);
    card.append(thumb, body, actions);

    card.addEventListener('click', () => openCompare(item.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCompare(item.id);
      }
    });

    fileGrid.prepend(card);
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function escapeAttr(str) { return escapeHtml(str); }

  function removeItem(id) {
    const card = document.getElementById(`card-${id}`);
    if (card) card.remove();
    const item = items.find((it) => it.id === id);
    if (item?.originalUrl) URL.revokeObjectURL(item.originalUrl);
    if (resultUrls[id]) {
      URL.revokeObjectURL(resultUrls[id]);
      delete resultUrls[id];
    }
    items = items.filter((it) => it.id !== id);
    delete results[id];
    updateSummary();
  }

  function clearAll() {
    items.forEach((item) => {
      if (item.originalUrl) URL.revokeObjectURL(item.originalUrl);
      if (resultUrls[item.id]) URL.revokeObjectURL(resultUrls[item.id]);
    });
    items = [];
    results = {};
    resultUrls = {};
    fileGrid.innerHTML = '';
    summary.hidden = true;
    recompressBtn.hidden = true;
    showError('');
  }

  // ─── List view: compress one file ──────────────────────────────────
  async function compressForList(id) {
    const item = items.find((it) => it.id === id);
    if (!item) return;

    setListCardWorking(id);

    try {
      const res = await postCompress({
        file: item.file,
        format: listFormat,
        quality: listQuality,
        width: listWidth,
      });
      results[id] = res;

      if (resultUrls[id]) URL.revokeObjectURL(resultUrls[id]);
      resultUrls[id] = blobUrlFromResult(res);

      renderListCardResult(id, res);
    } catch (err) {
      renderListCardError(id, err.message || 'Server unreachable');
    }
    updateSummary();
  }

  function setListCardWorking(id) {
    const bar = document.getElementById(`bar-${id}`);
    const status = document.getElementById(`status-${id}`);
    const dlBtn = document.getElementById(`dl-${id}`);
    if (bar) bar.style.display = 'block';
    if (status) status.innerHTML = '<span class="badge badge--working">Optimising…</span>';
    if (dlBtn) dlBtn.disabled = true;
  }

  function renderListCardResult(id, res) {
    const bar = document.getElementById(`bar-${id}`);
    const status = document.getElementById(`status-${id}`);
    const dlBtn = document.getElementById(`dl-${id}`);
    if (bar) bar.style.display = 'none';

    if (res.error) {
      if (status) status.innerHTML = `<span class="badge badge--error">${escapeHtml(res.message || 'Failed')}</span>`;
      if (dlBtn) dlBtn.disabled = true;
      return;
    }

    const pct = Math.round((1 - res.compressedSize / res.originalSize) * 100);
    if (pct <= 0) {
      if (status) {
        status.innerHTML = `
          <span class="badge badge--neutral">Already optimised</span>
          <span class="file-card__meta">${fmtBytes(res.originalSize)} → ${fmtBytes(res.compressedSize)}</span>`;
      }
      if (dlBtn) dlBtn.disabled = true;
      return;
    }

    if (status) {
      status.innerHTML = `
        <span class="badge badge--success">−${pct}%</span>
        <span class="file-card__meta">${fmtBytes(res.originalSize)} → ${fmtBytes(res.compressedSize)}</span>`;
    }
    if (dlBtn) dlBtn.disabled = false;
  }

  function renderListCardError(id, message) {
    const bar = document.getElementById(`bar-${id}`);
    const status = document.getElementById(`status-${id}`);
    if (bar) bar.style.display = 'none';
    if (status) status.innerHTML = `<span class="badge badge--error">${escapeHtml(message)}</span>`;
  }

  function blobUrlFromResult(res) {
    const blob = new Blob([res.bytes], { type: res.mime });
    return URL.createObjectURL(blob);
  }

  // ─── Summary ───────────────────────────────────────────────────────
  function updateSummary() {
    const valid = Object.entries(results).filter(([id, r]) => {
      if (!r || r.error) return false;
      const pct = Math.round((1 - r.compressedSize / r.originalSize) * 100);
      return pct > 0;
    });

    if (!valid.length) {
      summary.hidden = true;
      return;
    }

    let totalOrig = 0;
    let totalComp = 0;
    valid.forEach(([, r]) => { totalOrig += r.originalSize; totalComp += r.compressedSize; });
    const pct = Math.round((1 - totalComp / totalOrig) * 100);

    statOriginal.textContent = fmtBytes(totalOrig);
    statCompressed.textContent = fmtBytes(totalComp);
    statSaved.textContent = `−${Math.abs(pct)}%`;
    downloadLabel.textContent = valid.length === 1 ? 'Download' : 'Download all';

    summary.hidden = false;
  }

  // ─── Recompress (settings change in list view) ─────────────────────
  function markListDirty() {
    if (!items.length) return;
    recompressBtn.hidden = false;
  }

  function recompressAll() {
    recompressBtn.hidden = true;
    items.forEach(({ id }) => {
      setListCardWorking(id);
      delete results[id];
      if (resultUrls[id]) {
        URL.revokeObjectURL(resultUrls[id]);
        delete resultUrls[id];
      }
    });
    summary.hidden = true;
    items.forEach(({ id }) => compressForList(id));
  }

  // ─── Local compression engine ──────────────────────────────────────
  async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        /* fall through to <img> decoding (e.g. SVG blobs) */
      }
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not decode image'));
        img.src = url;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function sourceSize(src) {
    return {
      w: src.width || src.naturalWidth || 0,
      h: src.height || src.naturalHeight || 0,
    };
  }

  // Stepped-halving downscale keeps text and edges crisp.
  function drawToCanvas(src, targetWidth) {
    const { w: sw, h: sh } = sourceSize(src);
    let w = sw;
    let h = sh;
    if (targetWidth > 0 && sw > targetWidth) {
      w = targetWidth;
      h = Math.max(1, Math.round((sh * targetWidth) / sw));
    }

    let cur = src;
    let cw = sw;
    let ch = sh;
    while (cw > w * 2) {
      const nw = Math.max(w, Math.floor(cw / 2));
      const nh = Math.max(h, Math.floor(ch / 2));
      const step = document.createElement('canvas');
      step.width = nw;
      step.height = nh;
      const sctx = step.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(cur, 0, 0, nw, nh);
      cur = step;
      cw = nw;
      ch = nh;
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, w, h);
    return { canvas, ctx, width: w, height: h, originalWidth: sw, originalHeight: sh };
  }

  // Cheap alpha probe: inspect a downscaled copy instead of the full bitmap.
  function canvasHasAlpha(canvas) {
    const scale = Math.min(1, 256 / Math.max(canvas.width, canvas.height));
    const probe = document.createElement('canvas');
    probe.width = Math.max(1, Math.round(canvas.width * scale));
    probe.height = Math.max(1, Math.round(canvas.height * scale));
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(canvas, 0, 0, probe.width, probe.height);
    const data = pctx.getImageData(0, 0, probe.width, probe.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 254) return true;
    }
    return false;
  }

  function canvasBlob(canvas, type, q) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error(`${type} encoding failed`))),
          type,
          q,
        );
      } catch (err) {
        reject(err);
      }
    });
  }

  function autoFormat(mime) {
    const m = (mime || '').toLowerCase();
    if (/jpe?g|tiff|bmp|hei[cf]/.test(m)) return 'jpeg';
    if (m.includes('png')) return 'png';
    if (m.includes('gif')) return support.webp ? 'webp' : 'png';
    if (m.includes('avif') && support.avif) return 'avif';
    return support.webp ? 'webp' : 'jpeg';
  }

  // Quality slider → PNG palette size (UPNG cnum). >=95 means lossless.
  function pngColorCount(quality) {
    if (quality >= 95) return 0;
    if (quality >= 86) return 1024;
    if (quality >= 61) return 256;
    if (quality >= 41) return 128;
    if (quality >= 26) return 64;
    if (quality >= 11) return 32;
    return 16;
  }

  async function compressLocal({ file, format, quality, width }) {
    const originalSize = file.size;
    const src = await decodeImage(file);
    const { w: sw, h: sh } = sourceSize(src);

    try {
      if (!sw || !sh) throw new Error('Image has invalid dimensions');
      if (sw > limits.maxSidePx || sh > limits.maxSidePx) {
        throw new Error(`Image too large: ${sw}×${sh}px (max ${limits.maxSidePx}px per side)`);
      }
      if (sw * sh > limits.maxMegapixels * 1_000_000) {
        throw new Error(`Image too large: ${Math.round((sw * sh) / 1e6)}MP (max ${limits.maxMegapixels}MP)`);
      }

      let fmt = String(format || 'auto').toLowerCase();
      if (fmt === 'auto') fmt = autoFormat(file.type);
      if (fmt === 'jpg') fmt = 'jpeg';
      if (fmt === 'gif') fmt = support.webp ? 'webp' : 'png';
      if (fmt === 'webp' && !support.webp) fmt = 'jpeg';
      if (fmt === 'avif' && !support.avif) fmt = support.webp ? 'webp' : 'jpeg';

      const targetWidth = parseInt(width, 10);
      const resizeTo = targetWidth > 0 && targetWidth < 9999 ? targetWidth : 0;
      const drawn = drawToCanvas(src, resizeTo);

      const alpha = canvasHasAlpha(drawn.canvas);
      const requested = Math.max(1, Math.min(100, parseInt(quality, 10) || limits.defaultQuality));
      const capped = Math.min(requested, alpha ? MAX_QUALITY_WITH_ALPHA : MAX_QUALITY_NO_ALPHA);

      let bytes;
      let mime;
      let appliedQuality = capped;

      if (fmt === 'jpeg') {
        // JPEG has no alpha: flatten onto white like the original service did.
        const flat = document.createElement('canvas');
        flat.width = drawn.width;
        flat.height = drawn.height;
        const fctx = flat.getContext('2d');
        fctx.fillStyle = '#ffffff';
        fctx.fillRect(0, 0, flat.width, flat.height);
        fctx.drawImage(drawn.canvas, 0, 0);
        const blob = await canvasBlob(flat, 'image/jpeg', capped / 100);
        bytes = new Uint8Array(await blob.arrayBuffer());
        mime = 'image/jpeg';
      } else if (fmt === 'png') {
        if (typeof UPNG === 'undefined') throw new Error('PNG encoder failed to load');
        const rgba = drawn.ctx.getImageData(0, 0, drawn.width, drawn.height).data.buffer;
        const cnum = pngColorCount(requested);
        bytes = new Uint8Array(UPNG.encode([rgba], drawn.width, drawn.height, cnum));
        mime = 'image/png';
        appliedQuality = requested;
      } else {
        const type = `image/${fmt}`;
        const blob = await canvasBlob(drawn.canvas, type, capped / 100);
        if (blob.type !== type) throw new Error(`${fmt.toUpperCase()} encoding is not supported by this browser`);
        bytes = new Uint8Array(await blob.arrayBuffer());
        mime = type;
      }

      const compressedSize = bytes.length;
      const saved = originalSize - compressedSize;
      return {
        mime,
        originalSize,
        compressedSize,
        savedBytes: saved,
        ratio: originalSize ? Math.round((saved / originalSize) * 1000) / 10 : 0,
        appliedQuality,
        appliedFormat: fmt,
        width: drawn.width,
        height: drawn.height,
        originalWidth: drawn.originalWidth,
        originalHeight: drawn.originalHeight,
        bytes,
        error: false,
      };
    } finally {
      if (typeof src.close === 'function') {
        try { src.close(); } catch { /* already closed */ }
      }
    }
  }

  // Serialise jobs so a big batch never freezes the page all at once.
  let compressChain = Promise.resolve();
  function postCompress(job) {
    const run = compressChain.then(
      () => compressLocal(job),
      () => compressLocal(job),
    );
    compressChain = run.then(() => undefined, () => undefined)
      .then(() => new Promise((r) => setTimeout(r, 0)));
    return run;
  }

  // ─── Download single ───────────────────────────────────────────────
  function downloadOne(id) {
    const r = results[id];
    if (!r || r.error) return;
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const ext = fileExtFromMime(r.mime, listFormat);
    const url = resultUrls[id] || blobUrlFromResult(r);
    triggerDownload(url, `${baseName(item.file.name)}.${ext}`);
  }

  // ─── Download all (ZIP) ────────────────────────────────────────────
  async function downloadZip() {
    const ready = items.filter((it) => {
      const r = results[it.id];
      if (!r || r.error) return false;
      return Math.round((1 - r.compressedSize / r.originalSize) * 100) > 0;
    });
    if (!ready.length) {
      showError('No compressed images ready to download.');
      return;
    }

    if (typeof window.fflate === 'undefined' || typeof window.fflate.zipSync !== 'function') {
      showError('ZIP library failed to load — download files individually.');
      return;
    }

    downloadZipBtn.disabled = true;
    const originalLabel = downloadLabel.textContent;
    downloadLabel.innerHTML = '<span class="spinner" style="margin-right:0.4rem"></span>Preparing…';

    try {
      const map = {};
      const usedNames = new Set();
      ready.forEach((it) => {
        const r = results[it.id];
        const ext = fileExtFromMime(r.mime, listFormat);
        let candidate = `${baseName(it.file.name)}.${ext}`;
        let counter = 1;
        while (usedNames.has(candidate)) {
          candidate = `${baseName(it.file.name)}-${counter++}.${ext}`;
        }
        usedNames.add(candidate);
        map[candidate] = [r.bytes, { level: 0 }];
      });

      const zipped = window.fflate.zipSync(map);
      const blob = new Blob([zipped], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `imgpress-${Date.now()}.zip`);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      showError(`ZIP failed: ${err.message}`);
    } finally {
      downloadZipBtn.disabled = false;
      downloadLabel.textContent = originalLabel;
    }
  }

  // ─── Compare view ──────────────────────────────────────────────────
  function openCompare(id) {
    const item = items.find((it) => it.id === id);
    if (!item) return;

    compareItemId = id;
    cmpFormat = listFormat;
    cmpQuality = listQuality;
    cmpWidth = listWidth;
    cmpZoom = 100;
    cmpDividerPct = 50;

    cmpFilename.textContent = item.file.name;
    cmpMeta.textContent = `${fmtBytes(item.originalSize)} · ${item.file.type || 'image'}`;
    cmpImgOrig.src = item.originalUrl;
    cmpImgOrig.alt = `Original ${item.file.name}`;

    if (results[id] && !results[id].error && resultUrls[id]) {
      cmpImgComp.src = resultUrls[id];
      paintCompareStats(item, results[id]);
    } else {
      cmpImgComp.removeAttribute('src');
      paintCompareStats(item, null);
    }

    // Sync panel controls with current state
    syncCompareControls();
    setDividerPct(50);
    setZoom(100);
    fitToViewport(item);

    shell.dataset.view = 'compare';

    // Probe original dimensions if missing
    if (!item.originalDims) {
      probeImageDims(item.originalUrl).then((dims) => {
        item.originalDims = dims;
        if (compareItemId === id) {
          paintCompareStats(item, results[id] || null);
          fitToViewport(item);
        }
      });
    }

    // If we only had a list-mode result, kick off a recompress with current cmp settings
    requestCompareCompress();
  }

  function closeCompare() {
    compareItemId = null;
    shell.dataset.view = 'list';
  }

  function syncCompareControls() {
    document.querySelectorAll('[data-cmp-format]').forEach((btn) => {
      const active = btn.dataset.cmpFormat === cmpFormat;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    cmpQualityRange.value = String(cmpQuality);
    cmpQualityValue.textContent = String(cmpQuality);
    cmpWidthSelect.value = String(cmpWidth);
    cmpZoomRange.value = String(cmpZoom);
    cmpZoomValue.textContent = `${cmpZoom}%`;
  }

  function paintCompareStats(item, res) {
    const origDims = item.originalDims
      ? `${item.originalDims.w}×${item.originalDims.h}`
      : '—';

    cmpStatOrig.textContent = fmtBytes(item.originalSize);

    if (!res || res.error) {
      cmpStatComp.textContent = '—';
      cmpStatSaved.textContent = '—';
      cmpStatDim.textContent = origDims;
      cmpStatMime.textContent = '—';
      cmpDownload.disabled = true;
      cmpTagComp.textContent = 'Compressed';
      return;
    }

    const pct = Math.round((1 - res.compressedSize / res.originalSize) * 100);
    cmpStatComp.textContent = fmtBytes(res.compressedSize);
    cmpStatSaved.textContent =
      pct > 0
        ? `−${pct}% (${fmtBytes(res.originalSize - res.compressedSize)})`
        : 'Already optimised';
    cmpStatDim.textContent =
      res.width && res.height
        ? `${res.originalWidth || res.width}×${res.originalHeight || res.height} → ${res.width}×${res.height}`
        : origDims;
    cmpStatMime.textContent = (res.mime || '').replace('image/', '').toUpperCase();
    cmpDownload.disabled = pct <= 0;
    cmpTagComp.textContent =
      pct > 0 ? `${(res.appliedFormat || res.mime?.split('/')[1] || '').toUpperCase()} −${pct}%` : 'Compressed';
  }

  function setDividerPct(pct) {
    cmpDividerPct = clamp(pct, 0, 100);
    cmpDivider.style.left = `${cmpDividerPct}%`;
    cmpDivider.setAttribute('aria-valuenow', String(Math.round(cmpDividerPct)));
    cmpPaneComp.style.clipPath = `inset(0 0 0 ${cmpDividerPct}%)`;
  }

  function setZoom(zoomPct) {
    cmpZoom = clamp(zoomPct, 25, 400);
    cmpZoomRange.value = String(cmpZoom);
    cmpZoomValue.textContent = `${Math.round(cmpZoom)}%`;
    [cmpImgOrig, cmpImgComp].forEach((img) => {
      if (!img) return;
      img.style.transform = `translate(-50%, -50%) scale(${cmpZoom / 100})`;
      img.style.position = 'absolute';
      img.style.top = '50%';
      img.style.left = '50%';
      img.style.transformOrigin = 'center';
    });
  }

  function fitToViewport(item) {
    if (!item.originalDims || !cmpViewport) return;
    const { w, h } = item.originalDims;
    if (!w || !h) return;
    const vw = cmpViewport.clientWidth - 40;
    const vh = cmpViewport.clientHeight - 40;
    if (vw <= 0 || vh <= 0) return;
    const scale = Math.min(vw / w, vh / h, 1);
    setZoom(Math.round(scale * 100));
  }

  // Divider drag
  function bindDividerDrag() {
    let dragging = false;

    const updateFromEvent = (e) => {
      const rect = cmpStage.getBoundingClientRect();
      const x = ('clientX' in e ? e.clientX : e.touches?.[0]?.clientX) || rect.left;
      const pct = ((x - rect.left) / rect.width) * 100;
      setDividerPct(pct);
    };

    cmpDivider.addEventListener('pointerdown', (e) => {
      dragging = true;
      cmpDivider.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    cmpDivider.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      updateFromEvent(e);
    });
    cmpDivider.addEventListener('pointerup', (e) => {
      dragging = false;
      try { cmpDivider.releasePointerCapture(e.pointerId); } catch {}
    });
    cmpStage.addEventListener('click', (e) => {
      if (e.target === cmpDivider || cmpDivider.contains(e.target)) return;
      updateFromEvent(e);
    });

    cmpDivider.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 5 : 1;
      if (e.key === 'ArrowLeft') { setDividerPct(cmpDividerPct - step); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { setDividerPct(cmpDividerPct + step); e.preventDefault(); }
      else if (e.key === 'Home') { setDividerPct(0); e.preventDefault(); }
      else if (e.key === 'End') { setDividerPct(100); e.preventDefault(); }
    });
  }

  // Re-compress for compare view (debounced on quality/width changes)
  function requestCompareCompress() {
    if (!compareItemId) return;
    if (cmpDebounceTimer) clearTimeout(cmpDebounceTimer);
    cmpDebounceTimer = setTimeout(runCompareCompress, 220);
  }

  async function runCompareCompress() {
    if (!compareItemId) return;
    const item = items.find((it) => it.id === compareItemId);
    if (!item) return;

    const seq = ++cmpRequestSeq;
    cmpBusy.hidden = false;
    cmpDownload.disabled = true;

    try {
      const res = await postCompress({
        file: item.file,
        format: cmpFormat,
        quality: cmpQuality,
        width: cmpWidth,
      });

      if (seq !== cmpRequestSeq || compareItemId !== item.id) return;

      // Persist as the canonical result for this item too
      results[item.id] = res;
      if (resultUrls[item.id]) URL.revokeObjectURL(resultUrls[item.id]);
      resultUrls[item.id] = res.error ? null : blobUrlFromResult(res);

      if (!res.error && resultUrls[item.id]) {
        cmpImgComp.src = resultUrls[item.id];
      } else {
        cmpImgComp.removeAttribute('src');
      }

      paintCompareStats(item, res);
      // Reflect into list card
      renderListCardResult(item.id, res);
      updateSummary();
    } catch (err) {
      if (seq !== cmpRequestSeq) return;
      cmpStatComp.textContent = 'failed';
      cmpStatSaved.textContent = err.message || '—';
      cmpDownload.disabled = true;
    } finally {
      if (seq === cmpRequestSeq) cmpBusy.hidden = true;
    }
  }

  function bindCompareControls() {
    cmpBack.addEventListener('click', closeCompare);

    document.querySelectorAll('[data-cmp-format]').forEach((btn) => {
      btn.addEventListener('click', () => {
        cmpFormat = btn.dataset.cmpFormat;
        syncCompareControls();
        requestCompareCompress();
      });
    });

    cmpQualityRange.addEventListener('input', () => {
      cmpQuality = parseInt(cmpQualityRange.value, 10);
      cmpQualityValue.textContent = String(cmpQuality);
      requestCompareCompress();
    });

    cmpWidthSelect.addEventListener('change', () => {
      cmpWidth = parseInt(cmpWidthSelect.value, 10);
      requestCompareCompress();
    });

    cmpZoomRange.addEventListener('input', () => setZoom(parseInt(cmpZoomRange.value, 10)));
    cmpZoomIn.addEventListener('click', () => setZoom(cmpZoom + 25));
    cmpZoomOut.addEventListener('click', () => setZoom(cmpZoom - 25));
    cmpZoomFit.addEventListener('click', () => {
      const item = items.find((it) => it.id === compareItemId);
      if (item) fitToViewport(item);
    });

    cmpDownload.addEventListener('click', () => {
      if (!compareItemId) return;
      downloadOne(compareItemId);
    });

    window.addEventListener('keydown', (e) => {
      if (shell.dataset.view !== 'compare') return;
      if (e.key === 'Escape') closeCompare();
    });
  }

  // ─── List controls ─────────────────────────────────────────────────
  function bindListControls() {
    document.querySelectorAll('[data-format]').forEach((btn) => {
      btn.addEventListener('click', () => {
        listFormat = btn.dataset.format;
        document.querySelectorAll('[data-format]').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        markListDirty();
      });
    });

    qualityRange.addEventListener('input', () => {
      listQuality = parseInt(qualityRange.value, 10);
      qualityValue.textContent = String(listQuality);
      qualityRange.setAttribute('aria-valuenow', String(listQuality));
      markListDirty();
    });

    widthSelect.addEventListener('change', () => {
      listWidth = parseInt(widthSelect.value, 10);
      markListDirty();
    });

    recompressBtn.addEventListener('click', recompressAll);

    downloadZipBtn.addEventListener('click', downloadZip);
    clearBtn.addEventListener('click', clearAll);
  }

  // ─── Init ──────────────────────────────────────────────────────────
  // Theme (light/dark) is handled by the shared ToolHub bridge
  // (../../assets/tool-bridge.js) via the [data-swpl-theme-toggle] button.
  function init() {
    bindDropzone();
    bindListControls();
    bindCompareControls();
    bindDividerDrag();
    initEncoderSupport();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
