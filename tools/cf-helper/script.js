// Global variables
let debounceTimeout = null;
const DEBOUNCE_DELAY_SMALL = 280;
const DEBOUNCE_DELAY_LARGE = 900;
const LARGE_INPUT_CHARS = 200_000;
const SYNTAX_SNIPPET_MAX = 8000;
let modalResolvePromise = null;
let outputFlushRaf = null;
const pendingOutputValues = new Map();

// DOM Elements - Quote Escaper Tab
const inputJson = document.getElementById('input-json');
const outputJson = document.getElementById('output-json');
const removeLineBreaksCheckbox = document.getElementById('remove-line-breaks');
const errorMessage = document.getElementById('error-message');
const fileInput = document.getElementById('file-input');
const syntaxErrorModal = document.getElementById('syntax-error-modal');
const modalErrorMessage = document.getElementById('modal-error-message');

// DOM Elements - Carrier Feature Inserter Tab
const carrierFeatureJson = document.getElementById('carrier-feature-json');
const canonicalIdInput = document.getElementById('canonical-id');
const carrierGroupInput = document.getElementById('carrier-group');
const imsCode = document.getElementById('ims-code');
const cpFeatureData = document.getElementById('cp-feature-data');
const imsOutputJson = document.getElementById('ims-output-json');
const imsFileInput = document.getElementById('ims-file-input');

// Tab navigation
const tabButtons = document.querySelectorAll('.tool-nav__btn');
const tabContents = document.querySelectorAll('.tool-panel');
const inputSizeHint = document.getElementById('input-size-hint');
const quoteStatus = document.getElementById('quote-status');
const quoteOutputMeta = document.getElementById('quote-output-meta');
const carrierIdSummary = document.getElementById('carrier-id-summary');
const carrierSummary = document.getElementById('carrier-summary');
const carrierDiffPreview = document.getElementById('carrier-diff-preview');

// Buttons - Quote Escaper Tab
const loadFileBtn = document.getElementById('load-file-btn');
const pasteBtn = document.getElementById('paste-btn');
const clearBtn = document.getElementById('clear-btn');
const saveFileBtn = document.getElementById('save-file-btn');
const copyBtn = document.getElementById('copy-btn');
const convertBtn = document.getElementById('convert-btn');

// Buttons - Carrier Feature Inserter Tab
const imsLoadFileBtn = document.getElementById('ims-load-file-btn');
const imsTemplateBtn = document.getElementById('ims-template-btn');
const imsPasteBtn = document.getElementById('ims-paste-btn');
const imsClearBtn = document.getElementById('ims-clear-btn');
const imsExampleBtn = document.getElementById('ims-example-btn');
const cpExampleBtn = document.getElementById('cp-example-btn');
const imsSaveFileBtn = document.getElementById('ims-save-file-btn');
const imsCopyBtn = document.getElementById('ims-copy-btn');
const insertFeaturesBtn = document.getElementById('insert-features-btn');

// Modal Buttons
const closeModalBtn = document.getElementById('close-modal-btn');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalContinueBtn = document.getElementById('modal-continue-btn');

// ============ JSON Conversion Functions ============

/**
 * Convert JSON string to escaped format
 * @param {string} jsonString - Original JSON string
 * @returns {string} - Escaped JSON string
 */
function convertJsonFormat(jsonString) {
    // Escape quotes in the JSON string
    const escapedJson = jsonString.replace(/"/g, '\\"');
    return escapedJson;
}

/**
 * Convert JSON text with line breaks to single line format,
 * keeping spaces only in the 'note' field value
 * @param {string} text - Text with line breaks
 * @returns {string} - Text with line breaks removed and selective spaces maintained
 */
function convertLineBreaks(text) {
    // First, remove line breaks
    let textNoBreaks = text.replace(/\n/g, '').replace(/\r/g, '');

    // Try to parse as JSON to identify the note field
    try {
        const jsonObj = JSON.parse(textNoBreaks);

        // If there's a root note field, preserve its spaces and JSON escaping.
        if (
            jsonObj &&
            typeof jsonObj === 'object' &&
            !Array.isArray(jsonObj) &&
            typeof jsonObj.note === 'string'
        ) {
            const noteValue = jsonObj.note;
            const noteSentinel = '__CF_HELPER_NOTE_SENTINEL__';
            jsonObj.note = noteSentinel;
            const noSpacesJson = JSON.stringify(jsonObj).replace(/\s+/g, '');
            return noSpacesJson.replace(JSON.stringify(noteSentinel), JSON.stringify(noteValue));
        } else {
            // No note field, remove all extra spaces
            return textNoBreaks.replace(/\s+/g, '');
        }
    } catch (e) {
        // If not valid JSON, just remove line breaks
        return textNoBreaks;
    }
}

/**
 * Check JSON syntax and return detailed error message if invalid
 * @param {string} jsonString - JSON string to check
 * @returns {Object} - {isValid: boolean, message: string}
 */
function lineAndColumnAt(jsonString, position) {
    let line = 1;
    let lineStart = 0;
    const end = Math.min(position, jsonString.length);
    for (let i = 0; i < end; i++) {
        if (jsonString.charCodeAt(i) === 10) {
            line++;
            lineStart = i + 1;
        }
    }
    const column = position - lineStart + 1;
    return { line, column, lineStart };
}

function getLineSlice(jsonString, line) {
    let current = 1;
    let start = 0;
    for (let i = 0; i < jsonString.length; i++) {
        if (jsonString.charCodeAt(i) === 10) {
            if (current === line) {
                return jsonString.slice(start, i);
            }
            current++;
            start = i + 1;
        }
    }
    if (current === line) {
        return jsonString.slice(start);
    }
    return '';
}

function checkJsonSyntax(jsonString) {
    try {
        JSON.parse(jsonString);
        return { isValid: true, message: 'Valid JSON syntax' };
    } catch (e) {
        let errorMsg = '';

        if (e instanceof SyntaxError) {
            const match = e.message.match(/position (\d+)/);
            if (match) {
                const position = parseInt(match[1], 10);
                const { line, column } = lineAndColumnAt(jsonString, position);
                errorMsg = `Error at line ${line}, column ${column}\n`;
                errorMsg += `${e.message}\n\n`;
                const errorLine = getLineSlice(jsonString, line);
                if (errorLine.length > SYNTAX_SNIPPET_MAX) {
                    errorMsg += `Problematic line (${line}): [line too long: ${errorLine.length} characters, showing start]\n`;
                    errorMsg += errorLine.slice(0, SYNTAX_SNIPPET_MAX) + '...\n';
                    errorMsg += `Position: ^ (column ${column})`;
                } else {
                    errorMsg += `Problematic line (${line}): ${errorLine}\n`;
                    const caretLen = Math.min(column - 1, 200);
                    errorMsg += `Position: ${' '.repeat(caretLen)}^`;
                }
            } else {
                errorMsg = e.message;
            }
        } else {
            errorMsg = `Unexpected error: ${e.message}`;
        }

        return { isValid: false, message: errorMsg };
    }
}

/**
 * Undo quote-escaper output: turn \" back into "
 * @param {string} text
 * @returns {string}
 */
function unescapeJsonQuotes(text) {
    return text.replace(/\\"/g, '"');
}

/**
 * Normalize input that may be raw JSON or quote-escaped JSON (including double-escaped).
 * @param {string} text
 * @param {{ removeLineBreaks?: boolean }} options
 * @returns {{ jsonText: string, wasQuoteEscaped: boolean } | null}
 */
function normalizeJsonInput(text, options = {}) {
    const { removeLineBreaks = false } = options;
    let current = text.trim();
    if (!current) {
        return null;
    }

    let wasQuoteEscaped = false;

    if (checkJsonSyntax(current).isValid) {
        let jsonText = current;
        if (removeLineBreaks) {
            jsonText = convertLineBreaks(current);
        }
        return { jsonText, wasQuoteEscaped };
    }

    for (let depth = 0; depth < 5; depth++) {
        const unescaped = unescapeJsonQuotes(current);
        if (unescaped === current) {
            break;
        }
        wasQuoteEscaped = true;
        current = unescaped;
        if (checkJsonSyntax(current).isValid) {
            let jsonText = current;
            if (removeLineBreaks) {
                jsonText = convertLineBreaks(current);
            }
            return { jsonText, wasQuoteEscaped };
        }
    }

    return null;
}

/**
 * Accept raw JSON or quote-escaped JSON for validation.
 * @param {string} jsonString
 * @returns {{ isValid: boolean, message: string, normalized?: { jsonText: string, wasQuoteEscaped: boolean } }}
 */
function checkJsonOrQuoteEscapedSyntax(jsonString) {
    const normalized = normalizeJsonInput(jsonString, {});
    if (normalized) {
        return {
            isValid: true,
            message: normalized.wasQuoteEscaped
                ? 'Valid quote-escaped JSON syntax'
                : 'Valid JSON syntax',
            normalized,
        };
    }
    return checkJsonSyntax(jsonString);
}

/**
 * Build quote-escaped output without double-escaping already escaped input.
 * @param {string} inputContent
 * @param {boolean} removeLineBreaks
 * @returns {{ output: string, wasQuoteEscaped: boolean } | null}
 */
function buildQuoteEscapedOutput(inputContent, removeLineBreaks) {
    const normalized = normalizeJsonInput(inputContent, { removeLineBreaks });
    if (!normalized) {
        return null;
    }

    return {
        output: convertJsonFormat(normalized.jsonText),
        wasQuoteEscaped: normalized.wasQuoteEscaped,
    };
}

/**
 * Parse IMS code that may be raw JSON or quote-escaped JSON from Quote escaper.
 * @param {string} content
 * @returns {{ isValid: boolean, message?: string, jsonString?: string }}
 */
function parseImsJsonContent(content) {
    const normalized = normalizeJsonInput(content, {});
    if (!normalized) {
        return { isValid: false, message: 'Invalid IMS code JSON syntax.' };
    }

    try {
        return {
            isValid: true,
            jsonString: JSON.stringify(JSON.parse(normalized.jsonText)),
        };
    } catch (e) {
        return { isValid: false, message: e.message };
    }
}

// ============ Conversion Logic ============

/**
 * Convert the input JSON and display the result
 * @param {boolean} showErrors - Whether to show error messages
 * @returns {Promise<boolean>} - Promise that resolves to true if conversion succeeded
 */
function flushOutputTextareas() {
    outputFlushRaf = null;
    pendingOutputValues.forEach((value, el) => {
        el.value = value;
        syncOutputMeta(el, value);
    });
    pendingOutputValues.clear();
}

function scheduleOutputUpdate(textarea, value) {
    pendingOutputValues.set(textarea, value);
    if (outputFlushRaf === null) {
        outputFlushRaf = requestAnimationFrame(flushOutputTextareas);
    }
}

function setTextareaValue(textarea, value) {
    pendingOutputValues.delete(textarea);
    textarea.value = value;
    syncOutputMeta(textarea, value);
}

function formatCharacterCount(length) {
    if (length >= 1_000_000) {
        return `${(length / 1_000_000).toFixed(2)}M chars`;
    }
    if (length >= 10_000) {
        return `${Math.round(length / 1000)}k chars`;
    }
    return `${length} chars`;
}

function setStatusPill(element, message, state = '') {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('is-success', state === 'success');
    element.classList.toggle('is-warning', state === 'warning');
}

function updateQuoteOutputMeta(length = outputJson.value.length) {
    if (!quoteOutputMeta) return;
    quoteOutputMeta.textContent = length > 0
        ? `${formatCharacterCount(length)} ready.`
        : 'No output yet.';
}

function syncOutputMeta(textarea, value) {
    if (textarea === outputJson) {
        updateQuoteOutputMeta(value.length);
    } else if (textarea === imsOutputJson && value.length === 0) {
        updateCarrierSummary('Waiting for insert.');
        clearCarrierDiffPreview();
    }
}

function updateQuoteStatus(message, state = '') {
    setStatusPill(quoteStatus, message, state);
}

function updateCarrierSummary(message, state = '') {
    if (!carrierSummary) return;
    carrierSummary.textContent = message;
    carrierSummary.classList.toggle('is-success', state === 'success');
    carrierSummary.classList.toggle('is-warning', state === 'warning');
}

function parseTargetValues(value) {
    const ids = value
        .split(/[,\s;]+/)
        .map(id => id.trim())
        .filter(Boolean);
    return Array.from(new Set(ids));
}

function parseCanonicalIds(value) {
    return parseTargetValues(value);
}

function parseCarrierGroups(value) {
    return parseTargetValues(value);
}

function getCanonicalIdValue(entry) {
    if (!entry || entry.canonical_id === undefined || entry.canonical_id === null) {
        return '';
    }
    return String(entry.canonical_id).trim();
}

function getCarrierGroupValue(entry) {
    if (!entry || entry.carrier_group === undefined || entry.carrier_group === null) {
        return '';
    }
    return String(entry.carrier_group).trim();
}

function updateTargetSummary() {
    if (!carrierIdSummary) return;

    const canonicalIds = parseCanonicalIds(canonicalIdInput.value);
    const carrierGroups = parseCarrierGroups(carrierGroupInput.value);
    const parts = [];

    if (canonicalIds.length === 0 && carrierGroups.length === 0) {
        setStatusPill(carrierIdSummary, 'No targets selected');
        return;
    }

    let overallState = 'success';

    try {
        const parsed = JSON.parse(carrierFeatureJson.value || '{}');

        if (canonicalIds.length > 0) {
            if (Array.isArray(parsed.specific)) {
                const rowIds = new Set(parsed.specific.map(getCanonicalIdValue));
                const matched = canonicalIds.filter(id => rowIds.has(id)).length;
                parts.push(`${canonicalIds.length} ID(s), ${matched} matched`);
                if (matched !== canonicalIds.length) {
                    overallState = 'warning';
                }
            } else {
                parts.push(`${canonicalIds.length} ID(s)`);
            }
        }

        if (carrierGroups.length > 0) {
            if (Array.isArray(parsed.customer)) {
                const rowGroups = new Set(parsed.customer.map(getCarrierGroupValue));
                const matched = carrierGroups.filter(group => rowGroups.has(group)).length;
                parts.push(`${carrierGroups.length} group(s), ${matched} matched`);
                if (matched !== carrierGroups.length) {
                    overallState = 'warning';
                }
            } else {
                parts.push(`${carrierGroups.length} group(s)`);
            }
        }
    } catch {
        // The insert action shows the full JSON syntax error.
        if (canonicalIds.length > 0) {
            parts.push(`${canonicalIds.length} ID(s)`);
        }
        if (carrierGroups.length > 0) {
            parts.push(`${carrierGroups.length} group(s)`);
        }
        overallState = undefined;
    }

    setStatusPill(carrierIdSummary, parts.join(' · '), overallState);
}

function cloneValue(value) {
    if (value === undefined) {
        return undefined;
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
}

function stringifyPreviewValue(value) {
    if (value === undefined) {
        return '<missing>';
    }
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function truncatePreviewValue(value, maxLength = 220) {
    const text = stringifyPreviewValue(value);
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength)}... (${formatCharacterCount(text.length)})`;
}

function hasSameJsonValue(beforeValue, afterValue) {
    return stringifyPreviewValue(beforeValue) === stringifyPreviewValue(afterValue);
}

function buildFeatureChange(field, beforeValue, afterValue) {
    return {
        field,
        before: cloneValue(beforeValue),
        after: cloneValue(afterValue),
        action: beforeValue === undefined ? 'added' : 'updated',
        changed: !hasSameJsonValue(beforeValue, afterValue),
    };
}

function getDiffTargetLabel(item) {
    if (item.targetType === 'carrier_group') {
        return `Carrier group ${item.targetLabel}`;
    }
    return `Canonical ID ${item.targetLabel}`;
}

function getDiffTargetMissingMessage(item) {
    if (item.targetType === 'carrier_group') {
        return 'No row matched this carrier group.';
    }
    return 'No row matched this canonical ID.';
}

function applyFeaturesToEntry(entry, escapedIms, cpFeatureValue) {
    const originalFeature = entry.feature && typeof entry.feature === 'object' && !Array.isArray(entry.feature)
        ? entry.feature
        : {};
    const changes = [];

    if (!entry.feature || typeof entry.feature !== 'object' || Array.isArray(entry.feature)) {
        entry.feature = {};
    }

    if (escapedIms) {
        changes.push(buildFeatureChange(
            'CarrierFeature_IMS_ImsUpdate',
            originalFeature["CarrierFeature_IMS_ImsUpdate"],
            escapedIms,
        ));
        entry.feature["CarrierFeature_IMS_ImsUpdate"] = escapedIms;
    }

    if (cpFeatureValue) {
        changes.push(buildFeatureChange(
            'CarrierFeature_CP_ConfigFeature',
            originalFeature["CarrierFeature_CP_ConfigFeature"],
            cpFeatureValue,
        ));
        entry.feature["CarrierFeature_CP_ConfigFeature"] = cpFeatureValue;
    }

    return changes;
}

function clearCarrierDiffPreview() {
    if (!carrierDiffPreview) return;
    carrierDiffPreview.innerHTML = '<div class="diff-preview__empty">Diff preview appears after Insert.</div>';
}

function clearCarrierGeneratedResult(message = 'Inputs changed. Run Insert again.') {
    if (imsOutputJson.value) {
        setTextareaValue(imsOutputJson, '');
        updateCarrierSummary(message, 'warning');
    } else {
        clearCarrierDiffPreview();
    }
}

function appendDiffValue(parent, label, value, modifier) {
    const block = document.createElement('div');
    block.className = `diff-value diff-value--${modifier}`;

    const title = document.createElement('div');
    title.className = 'diff-value__label';
    title.textContent = label;

    const pre = document.createElement('pre');
    pre.className = 'diff-value__text';
    pre.textContent = truncatePreviewValue(value);

    block.append(title, pre);
    parent.appendChild(block);
}

function renderCarrierDiffPreview(diffItems) {
    if (!carrierDiffPreview) return;
    carrierDiffPreview.innerHTML = '';

    if (!diffItems || diffItems.length === 0) {
        carrierDiffPreview.innerHTML = '<div class="diff-preview__empty">No diff to show.</div>';
        return;
    }

    const totalChangedFields = diffItems.reduce(
        (sum, item) => sum + (Array.isArray(item.changes) ? item.changes.filter(change => change.changed).length : 0),
        0,
    );
    const missingCount = diffItems.filter(item => item.status === 'missing').length;

    const summary = document.createElement('div');
    summary.className = 'diff-preview__summary';
    summary.textContent = `${totalChangedFields} field change(s), ${missingCount} missing target(s)`;
    carrierDiffPreview.appendChild(summary);

    diffItems.forEach((item) => {
        const entry = document.createElement('details');
        entry.className = `diff-item diff-item--${item.status}`;
        entry.open = item.status !== 'missing';

        const header = document.createElement('summary');
        header.className = 'diff-item__summary';

        const id = document.createElement('span');
        id.className = 'diff-item__id';
        id.textContent = getDiffTargetLabel(item);

        const meta = document.createElement('span');
        meta.className = 'diff-item__meta';
        if (item.status === 'missing') {
            meta.textContent = 'not found';
        } else {
            const changedCount = item.changes.filter(change => change.changed).length;
            const skippedCount = item.changes.length - changedCount;
            meta.textContent = skippedCount > 0
                ? `${changedCount} changed, ${skippedCount} unchanged`
                : `${changedCount} changed`;
        }

        header.append(id, meta);
        entry.appendChild(header);

        if (item.status === 'missing') {
            const missing = document.createElement('div');
            missing.className = 'diff-item__empty';
            missing.textContent = getDiffTargetMissingMessage(item);
            entry.appendChild(missing);
        } else {
            item.changes.forEach((change) => {
                const row = document.createElement('div');
                row.className = `diff-change ${change.changed ? '' : 'diff-change--unchanged'}`;

                const rowHead = document.createElement('div');
                rowHead.className = 'diff-change__head';

                const field = document.createElement('span');
                field.className = 'diff-change__field';
                field.textContent = change.field;

                const action = document.createElement('span');
                action.className = `diff-change__action diff-change__action--${change.changed ? change.action : 'same'}`;
                action.textContent = change.changed ? change.action : 'unchanged';

                rowHead.append(field, action);
                row.appendChild(rowHead);

                const values = document.createElement('div');
                values.className = 'diff-change__values';
                appendDiffValue(values, 'Before', change.before, 'before');
                appendDiffValue(values, 'After', change.after, 'after');
                row.appendChild(values);

                entry.appendChild(row);
            });
        }

        carrierDiffPreview.appendChild(entry);
    });
}

function handleCarrierInputChanged() {
    updateTargetSummary();
    clearCarrierGeneratedResult();
}

function updateInputSizeHint(length) {
    if (!inputSizeHint) return;
    if (length >= LARGE_INPUT_CHARS) {
        const mb = (length / 1_000_000).toFixed(2);
        inputSizeHint.textContent = `Large input (~${mb}M chars): live preview off; use Convert.`;
        inputSizeHint.hidden = false;
    } else if (length >= 80_000) {
        const k = Math.round(length / 1000);
        inputSizeHint.textContent = `~${k}k chars: preview may be slower.`;
        inputSizeHint.hidden = false;
    } else {
        inputSizeHint.textContent = '';
        inputSizeHint.hidden = true;
    }
}

function debounceMsForLength(len) {
    if (len > 120_000) return DEBOUNCE_DELAY_LARGE;
    if (len > 40_000) return DEBOUNCE_DELAY_LARGE * 0.5;
    return DEBOUNCE_DELAY_SMALL;
}

async function convertJson(showErrors = true) {
    const inputContent = inputJson.value.trim();

    if (!inputContent) {
        if (showErrors) {
            showErrorMessage('Input is empty. Please provide JSON to convert.');
            updateQuoteStatus('Input empty', 'warning');
        }
        return false;
    }

    // Check JSON syntax first (raw or quote-escaped)
    const { isValid, message } = checkJsonOrQuoteEscapedSyntax(inputContent);
    if (!isValid) {
        if (showErrors) {
            const result = await showSyntaxErrorDialog('Invalid JSON syntax:\n' + message);
            if (result !== 'continue') {
                return false;
            }
        } else {
            return false;
        }
    }

    try {
        const result = buildQuoteEscapedOutput(
            inputContent,
            removeLineBreaksCheckbox.checked,
        );
        if (!result) {
            if (showErrors) {
                showErrorMessage('Failed to convert JSON: invalid syntax.');
            }
            return false;
        }

        setTextareaValue(outputJson, result.output);
        if (result.wasQuoteEscaped && result.output === inputContent.trim()) {
            updateQuoteStatus('Already quote-escaped', 'success');
        } else {
            updateQuoteStatus('Converted', 'success');
        }
        hideErrorMessage();
        return true;
    } catch (e) {
        if (showErrors) {
            showErrorMessage(`Failed to convert JSON:\n${e.message}`);
        }
        return false;
    }
}

/**
 * Convert JSON in real-time without showing error messages
 */
function convertJsonRealTime() {
    debounceTimeout = null;

    const rawLen = inputJson.value.length;
    updateInputSizeHint(rawLen);

    if (rawLen >= LARGE_INPUT_CHARS) {
        return;
    }

    const inputContent = inputJson.value.trim();

    if (!inputContent) {
        scheduleOutputUpdate(outputJson, '');
        updateQuoteStatus('Ready');
        hideErrorMessage();
        return;
    }

    try {
        const result = buildQuoteEscapedOutput(
            inputContent,
            removeLineBreaksCheckbox.checked,
        );
        if (!result) {
            return;
        }

        scheduleOutputUpdate(outputJson, result.output);
        if (result.wasQuoteEscaped && result.output === inputContent.trim()) {
            updateQuoteStatus('Already quote-escaped', 'success');
        } else {
            updateQuoteStatus('Preview ready', 'success');
        }
        hideErrorMessage();
    } catch {
        /* manual Convert shows errors */
    }
}

/**
 * Handle input changes and trigger conversion with debouncing
 */
function onInputChange() {
    const len = inputJson.value.length;
    updateInputSizeHint(len);

    if (debounceTimeout) {
        clearTimeout(debounceTimeout);
    }

    if (len >= LARGE_INPUT_CHARS) {
        updateQuoteStatus('Manual convert', 'warning');
        return;
    }

    debounceTimeout = setTimeout(convertJsonRealTime, debounceMsForLength(len));
}

// ============ File Operations ============

/**
 * Load JSON from a file into the input field
 */
function loadInputFile() {
    fileInput.click();
}

/**
 * Handle file selection
 */
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const content = await readFile(file);
        inputJson.value = content;
        updateInputSizeHint(content.length);

        // Check JSON syntax
        const { isValid, message } = checkJsonOrQuoteEscapedSyntax(content);
        if (!isValid) {
            const result = await showSyntaxErrorDialog('Invalid JSON syntax:\n' + message);
            if (result === 'continue') {
                convertJsonRealTime();
            }
        } else {
            convertJsonRealTime();
        }
    } catch (e) {
        showErrorMessage(`Failed to load file:\n${e.message}`);
    }

    // Reset file input
    fileInput.value = '';
}

/**
 * Read file content
 * @param {File} file - File to read
 * @returns {Promise<string>} - File content
 */
function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

/**
 * Save the output JSON to a file
 */
function saveOutputFile() {
    const content = outputJson.value.trim();

    if (!content) {
        showErrorMessage('Output is empty. Nothing to save.');
        return;
    }

    try {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'converted_json.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        showErrorMessage(`Failed to save file:\n${e.message}`);
    }
}

// ============ Clipboard Operations ============

/**
 * Paste content from clipboard to input text area and convert immediately
 */
async function pasteFromClipboard() {
    try {
        const clipboardContent = await navigator.clipboard.readText();
        inputJson.value = clipboardContent;
        updateInputSizeHint(clipboardContent.length);

        // Check JSON syntax (raw or quote-escaped)
        const { isValid, message } = checkJsonOrQuoteEscapedSyntax(clipboardContent);
        if (!isValid) {
            const result = await showSyntaxErrorDialog('Invalid JSON syntax:\n' + message);
            if (result === 'continue') {
                convertJsonRealTime();
            }
        } else {
            convertJsonRealTime();
        }
    } catch (e) {
        if (e.name === 'NotAllowedError') {
            showErrorMessage('Clipboard access denied. Please allow clipboard permissions.');
        } else {
            showErrorMessage(`Failed to paste from clipboard:\n${e.message}`);
        }
    }
}

/**
 * Copy output content to clipboard
 */
async function copyToClipboard() {
    const outputContent = outputJson.value.trim();
    
    if (!outputContent) {
        showErrorMessage('Output is empty. Nothing to copy.');
        return;
    }

    try {
        await navigator.clipboard.writeText(outputContent);
        showSuccessMessage('Output copied to clipboard!');
        setTimeout(hideErrorMessage, 2000);
    } catch (e) {
        showErrorMessage(`Failed to copy to clipboard:\n${e.message}`);
    }
}

// ============ UI Helpers ============

/**
 * Show error message
 * @param {string} message - Error message to display
 */
function showErrorMessage(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('success');
    errorMessage.classList.remove('hidden');
    errorMessage.style.display = 'block';
}

/**
 * Show success message
 * @param {string} message - Success message to display
 */
function showSuccessMessage(message) {
    errorMessage.textContent = message;
    errorMessage.classList.add('success');
    errorMessage.classList.remove('hidden');
    errorMessage.style.display = 'block';
}

/**
 * Hide error/success message
 */
function hideErrorMessage() {
    errorMessage.classList.add('hidden');
    errorMessage.style.display = 'none';
}

/**
 * Clear the input text area
 */
function clearInput() {
    inputJson.value = '';
    setTextareaValue(outputJson, '');
    updateInputSizeHint(0);
    updateQuoteStatus('Ready');
    hideErrorMessage();
}

/**
 * Show syntax error dialog with OK and Continue options
 * @param {string} message - Error message to display
 * @returns {Promise<string>} - Promise that resolves to 'ok' or 'continue'
 */
function showSyntaxErrorDialog(message) {
    return new Promise((resolve) => {
        modalErrorMessage.textContent = message;
        syntaxErrorModal.classList.remove('hidden');
        
        modalResolvePromise = resolve;
    });
}

/**
 * Hide syntax error modal
 */
function hideSyntaxErrorModal() {
    syntaxErrorModal.classList.add('hidden');
    if (modalResolvePromise) {
        modalResolvePromise('ok');
        modalResolvePromise = null;
    }
}

/**
 * Continue with conversion despite syntax error
 */
function continueWithConversion() {
    syntaxErrorModal.classList.add('hidden');
    if (modalResolvePromise) {
        modalResolvePromise('continue');
        modalResolvePromise = null;
    }
}

// ============ Event Listeners ============

// Input events
inputJson.addEventListener('input', onInputChange);
inputJson.addEventListener('paste', () => {
    setTimeout(onInputChange, 10);
});

// Button events
loadFileBtn.addEventListener('click', loadInputFile);
fileInput.addEventListener('change', handleFileSelect);
pasteBtn.addEventListener('click', pasteFromClipboard);
clearBtn.addEventListener('click', clearInput);
saveFileBtn.addEventListener('click', saveOutputFile);
copyBtn.addEventListener('click', copyToClipboard);
convertBtn.addEventListener('click', () => convertJson(true));

// Modal events
closeModalBtn.addEventListener('click', hideSyntaxErrorModal);
modalCloseBtn.addEventListener('click', hideSyntaxErrorModal);
modalContinueBtn.addEventListener('click', continueWithConversion);

// Close modal on background click
syntaxErrorModal.addEventListener('click', (e) => {
    if (e.target === syntaxErrorModal) {
        hideSyntaxErrorModal();
    }
});

// Close modal on Escape key + Ctrl+Enter to convert
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !syntaxErrorModal.classList.contains('hidden')) {
        hideSyntaxErrorModal();
    }
    // Ctrl+Enter: trigger Convert in quote-escaper or Insert in carrier tab
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        const quoteTab = document.getElementById('quote-escaper-tab');
        const carrierTab = document.getElementById('carrier-feature-inserter-tab');
        if (quoteTab && !quoteTab.hidden) {
            e.preventDefault();
            convertJson(true);
        } else if (carrierTab && !carrierTab.hidden) {
            e.preventDefault();
            insertFeatures();
        }
    }
});

// ============ Tab Navigation ============

/**
 * Switch to a specific tab
 * @param {string} tabId - The tab ID to switch to
 */
function switchTab(tabId) {
    tabButtons.forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.tab === tabId);
        btn.setAttribute('aria-selected', btn.dataset.tab === tabId ? 'true' : 'false');
    });

    tabContents.forEach(content => {
        content.classList.remove('is-active');
        content.hidden = true;
    });

    const targetTab = document.getElementById(`${tabId}-tab`);
    if (targetTab) {
        targetTab.classList.add('is-active');
        targetTab.hidden = false;
    }

    // Clear any error messages when switching tabs
    hideErrorMessage();
}

// Tab button click events
tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        switchTab(tabId);
    });
});

// ============ IMS Feature Insertion Functions ============

/**
 * Load example IMS code into the IMS code textarea
 */
function loadExampleImsCode() {
    const exampleImsCode = `{"note":"Enable IMS for Atheer_AE","imsprofile_update":{"profile":[{"name":"Atheer VoLTE","mnoname":"Atheer_AE","network":[{"type":"nr,lte","services":["mmtel","mmtel-video"],"enabled":true}]}]},"imsswitch_update":{"imsswitch":[{"mnoname":"Atheer_AE","enableIms":true,"enableServiceVolte":true,"enableServiceVilte":true}]}}`;
    imsCode.value = exampleImsCode;
    clearCarrierGeneratedResult('IMS code changed. Run Insert again.');
    showSuccessMessage('Example IMS code loaded!');
    setTimeout(hideErrorMessage, 2000);
}

/**
 * Load example CP Feature data into the CP Feature textarea
 */
function loadExampleCpFeatureData() {
    // Load the example from the template file
    const exampleCpFeatureData = `<CP_FEATURE>
<CP_Version>2</CP_Version>
<!--   Enabled SA, VoNR, R16, NSA_SA_NRCA_ULCA for PLMN : 28601 -->
<CP_EFS>5,@@@|/nv/item_files/modem/nas/sa_plmn_permit_list|0|82F61082F62022F82032F45162F86024F42004556804F56502180502F80962F83062F87905F53017F20272F41142F00462F26000F2FF04855827F44524F43024F51056F54704057842F45062F88942F09402F85114F94025F53027F40012F48327F46004257804455825F03056F53742F00604755824F54262F21125F00027F44037F01012F43004456804457854F24027F49205F51002F89804F43902F81032F43304F49412F45005225105F51104F40904F42905F51704F51514F92027F47704054804157805F56025F09927F40105F52772F28602580504F41325F50104F43004856804356862F81927F41162F28904F45412F61004F40404F46105F22104F40124F04062F89932F40156F58332F25004F42000F3FF02680542F09505925104956827F43032F80154F77062F27004256802F85862F21032F29104F40725F55042F05604756827F24332F81015F56604955827F45004F44902F21005325104357827F43202F80104F53562F22062F89804056825F04024F50112F44042F01425F52032F20199F9FF05F28100F1FF04F55504F52504655802F80242F06662F23004F54512F47004156862F29042F03032F40327F42004F45904F48902F86127F49304F46924F53002F82904656832F24104555862F82904F47925F51005F520</CP_EFS>
<CP_EFS>5,@@@|/nv/item_files/modem/nas/ss_vonr_allowed_list|0|82F61082F62062F21125F00025F52022F82032F20162F86024F42005F28199F9FF00F1FF54F24027F49205F22105F51024F04062F89932F40102F80962F83062F87962F23032F25000F3FF02F81012F47032F43305925162F29012F45062F26024F54254F77000F2FF32F40362F27005225102F86102F85814F92062F21032F29124F43024F51025F55027F47702F82942F45025F09962F88902F21014F94002F85105325125F53072F28632F24102F80162F22025F50125F51025F04024F50125F03042F006</CP_EFS>
<CP_MDB>5,@@@|/mdb/nr/plmn2features_sub.mdb|0|01015175616C636F6D6D00000000000000000000000000000000000000020101544B15540100000000000000000000006B000000D0000000789C63616060D801C413188184020303070304187C6503D30A3F45C0B4C0771508FF1344DCE003849FF603225FFE0D423B40C527406905A83E876F30FD503ECC9CCF109A11AADE0026FE05C217809A3BE12B541ECA17F8D6C42007320F4AFFFFFF9FC10648030019E621831A001A00789C63666660E06460606004627E66208701CA61000002AD00271A001A00789C63666660E06460606004620166208701CA61040002BC00291A001A00789C63666660E06460606004627E66208701CA61040002AE0028</CP_MDB>
<CP_MDB>5,@@@|/mdb/nr/plmn2features_sub.mdb_Subscription01|0|01015175616C636F6D6D00000000000000000000000000000000000000020101544B15540100000000000000000000006B000000D0000000789C63616060D801C413188184020303070304187C6503D30A3F45C0B4C0771508FF1344DCE003849FF603225FFE0D423B40C527406905A83E876F30FD503ECC9CCF109A11AADE0026FE05C217809A3BE12B541ECA17F8D6C42007320F4AFFFFFF9FC10648030019E621831A001A00789C63666660E06460606004627E66208701CA61000002AD00271A001A00789C63666660E06460606004620166208701CA61040002BC00291A001A00789C63666660E06460606004627E66208701CA61040002AE0028</CP_MDB>
<CP_MDB>5,@@@|/mdb/lte/plmn2features_lte_sub.mdb|0|01015175616C636F6D6D000000000000000000000000000000000000000201019CE4C8F10100000000000000000000008600000010010000789C35CE310E83300C05D00F8A2A46231575EDC08CB274EFC2CE11380247A87A821EB51510B2A5C1FE89943C45F6B7EC00C47C3F557EEE40033B292555C21BB7B3545C2F18B2CBD1ABED663EBF575576738AA6A333FB2558DEB37F2E395A715ECD9CE7BC17EB605EB847EB468CE75E5BA7FAE3A10AFFD3CFEAB2D240775AEAD1FC0325EC2F8F0D001300789C63666660E06260606004627E0000C600210D001300789C63666660E0626060600462010000C700220D001300789C63666660E06260606004623E0000C500200D001300789C63666660E06260606004625E0000C4001F</CP_MDB>
<CP_MDB>5,@@@|/mdb/lte/plmn2features_lte_sub.mdb_Subscription01|0|01015175616C636F6D6D000000000000000000000000000000000000000201019CE4C8F10100000000000000000000008600000010010000789C35CE310E83300C05D00F8A2A46231575EDC08CB274EFC2CE11380247A87A821EB51510B2A5C1FE89943C45F6B7EC00C47C3F557EEE40033B292555C21BB7B3545C2F18B2CBD1ABED663EBF575576738AA6A333FB2558DEB37F2E395A715ECD9CE7BC17EB605EB847EB468CE75E5BA7FAE3A10AFFD3CFEAB2D240775AEAD1FC0325EC2F8F0D001300789C63666660E06260606004627E0000C600210D001300789C63666660E0626060600462010000C700220D001300789C63666660E06260606004623E0000C500200D001300789C63666660E06260606004625E0000C4001F</CP_MDB>
    <CP_MDB>5,@@@|/mdb/nr/plmn2cacombos_nr.mdb|0|0103435050320000000000000000000000000000000000000000000000020101B15ABB062F000000E800FD55000000002200000030000000789C636160609000E2098C404281818183010204BE35816905286D00A50166A9059EAB371C08789C8D5B6D6E24290C8D34E7692954CD0E48F955C34D7280BED25E75D31418FBBDE7D6E647AB30C618E32F0CF9F5EB63FCFD5B3F3EBEDB753D9EE7CFEFD7F739BECBFE1CD09FF6E3BBFEB48ECFBBF96A59F3F5FB78A1AF81DDC895F169C089DF0CBFDE93BEDA47DB4CDC4DD71E5416FADD73DD6D6BAEDEC1580DB4C7BC137BB5AD1FA89D40EE9CF218BC58338AEBE6D50D3F1AD0AF1B63C872ACF073C9A66CC80679ACBAB104680DAC36F085710BD8E8BB4D1213CCDD0A337898F1D6C2D8BA15648E04C8D493A044DF81AF573F421EB6C5B7DEB8159F3DAC76CDE08439F992C26C24CB86A26C17E1D4A5D8614D8525565860C5F4FB0C58276319977BDBA36C253C284033892D3997253493B383CCD59630EAE061085AD6191757237BA713968603DB4B3D049D7A6570A6738BB14F5D3FB6A8FA0530CF48D0C0CDB6009B6BDA3ADDD198AB29AD030595DCE2762BEA425A3D5B6130F3CAF6CB1DC10980AE8C290FC1C621D85002FC8CC2BE3238D32E172A4446BF26F46B421FE18918A71629F208DEAAE8898CBD6DAC008D140034C7CC57ECA1841B3851F72AD45D99D736E8605D00265B1F93DDD4FDEEADF9D4C655AD1708768205222BCE08F1F0EE9877768BF69CB06772505459CB1850674387575A9763D89485092138602BBF17C0B72E21DD2E6876A2D7052DB7F1B46205771A812B98F8B40409DF74A463F3028D61963AC4166C52D3087100A47D884F9E13D3C2BEF46F4B6183D03BC4FC6FEE03E5848C774A3CA7F9281F097726A1E97426D17974A74C4A3020E12BABCAB6073820D8F678C643D573D584872A7838C5E69891101ED33D93F9CE643EE37B2506C8B784BBAC21A1E355D5D389F04D272AA7369190FD203FCA741C1DE647C1D9A4F8E4E2268EC7173FB31FE1A70823B487398502EB0E7FFED1E7B8240BE30E470A633879B61553D14D605E30F154D803F7ED8F2F5EBF37B6CADF55FCC14008BC7A3C0A4107ACBDF2DA915E11F48AA017AC5584341DD1B28096C4331DCE543433BBA87175DBA7257614731B8FAFA377A535217DC4D7D11882D7D20B158C257C2A8C0AC515773ED241335974243F1CD16B12D02B790687ADFD42E5B54AB82B4548A720D25609DF74981FD61D1723991FA5538E0EF3A3E0892EA8E438061DEA90C9B10E2F74BA4EF0B5DA8ACCCCCFD9592D3DDE1ECB6A17CF052A49567057D921F3FBD44E45C2371D0A16B0FB5D6C7CA7BDEDD1F4970C0A8BAAB0A40A0B2A4BDE31A543D83E8A771F82D83B5BF6280216BB61874D6BAC421F30CD13260787EE141FD948DDA99526B48FC9528F3493AC9935528720C58514A9DED4917165870A1D2E8467C21353C04E625DE64D149B98865BB523EA5A35288003F6E207B013B7ADF6383920119B255B71C9565CB215A3BA74A1295D2849B04CE1E5B66E0ADB14DECCE36BEFBAE664DE50EBF641B0D31965DE3985D5773A81DC58B473B31EA494374975120B48129D24CF499277E16E846130DFA766F0D40C9E9A13D31B5155086550F425CC4B65190236854314D6E4F1CC2C8B3B2E7F3884215009F73CC931673EA65F5C02E859C9C3EE5D302A4BB03B6E20D84DB0625CDF563A439C5D433890B359CF5467863ACDDA613FFA3EBAC1C083071E30D0BB309003C1D1E545491C521490D6F54BC0925ABA3F5549D6120EA227E9CCF095C199C112C94426B7EF408E42955D756986D762C488AE09F584C872F49AABAC0B722CC9554BD86A095FE420C1C6BCDB4BBBD8D614C192D22B29B9F26637DB9BED6CBC9FEFFA948AA7DA132F73E972FCADF6ECFE64DFABDC5BC6EF1E976F289D8FD5D7327457E93D35167CBD5B13613C2D74A77DE0B3A9EF4D313C4BE9D3243D6A40DA9926EB4BFC30489C98BC1BD6BC8BDB8B2B83BF91791AB1F3D81CCE493A3E63C1D2C72481878123C2FC66F0C159C345A60C74C29C57061719F4E2BBF0F270B64E04E38560D84D59F253709625D251315096FC54717869A9288E6BF8836A3D4847251D0CDF74A4EFD7B58AA4C81C6C5FD7DE9372465270068281C39A72981C7E556CF21CD694C3E47C2C08B28E5D6FCEC97927C63BE5EDFE8F87C54B4F55A35227E47727517965E69F820438D73A918ED7474F27C2B9062A64FC4EC4EF8498C8302927A77D9126D9B7E2A327FCF58CB7AEE7EE094F9DF9A12C1F7D38CC8BF8E4ABB3F58A12193F28006CE9B47425607425BE09BB68947440D805A35A3E57CBE7CA5371518550B70E7C41C87E5C5E23D560D2E28183B84912F625CC4A588C3014511756F156C554154FD53519B8B867ACE70915809C029207EC8D460036847995BA4F119149841D116E44B453F74BEA41165D46ABF8BE75E38CBA012955923BA97046B128A9A87918BEFDC99EA5445896A163FCD9B0C5BF700EC2F28D7BC1BC58A330C50DC2AC513F0D60938A7E0FCABD50D73589F085223CF28799C4258455146F6267A82506D8C6F3CFE8F7039CF88C5EBD43512F4DD423137A46522F4A34AE8B738C8BD288EB921E4EB02638138C71D62C42015578DB259C5E13561ABDAF03D19E0AF31056241C83D354616B22C0A5756B556606E028073D8FD7CFF9FAF9E7F5F3AA808CD7A9CF327A5E1AF4F33BFA8E3FE377F40E7D7AFE1EBDBF07A13FA3B78EEF7AD31AC46AB31936F149D691BAD1CAD49CF9756CA091599FC343BAFFB371FF62E354D969EBDEBCBD6737C19F915F43136FB69C88FC571CB2391BA38B8D2EA6D6133CA3EF6A3C6E31ACF5D95E782D5CCDB8EC1BF6F5344574ADC0D1ADE66EF6E66677225D244A205834C11A28564FB246CC23601E1EF308125C5B14D71E338E67FDBB88D4BF9B29FF75AE8F6AA0BA3E9A97B5F1B875CA44313FDAAD968B169CF93C9BF6896D5C02AC12D6EB7AF7581856173C480FE468F8F8159AEB6359C1B12D63CAF8FAFAF80F16B85ACB</CP_MDB>
</CP_FEATURE>`;
    cpFeatureData.value = exampleCpFeatureData;
    clearCarrierGeneratedResult('CP feature changed. Run Insert again.');
    showSuccessMessage('Example CP Feature data loaded!');
    setTimeout(hideErrorMessage, 2000);
}

/** Collapse CP feature payload to a single line (strip \\r\\n, \\r, \\n). */
function normalizeCpFeatureToOneLine(text) {
    return text.replace(/\r\n|\r|\n/g, '');
}

/**
 * Insert features (IMS and/or CP Feature) into CarrierFeature JSON for Canonical IDs and/or Carrier Groups
 * @returns {Promise<boolean>} - Promise that resolves to true if at least one insertion succeeded
 */
async function insertFeatures() {
    const carrierJsonContent = carrierFeatureJson.value.trim();
    const canonicalIdInputValue = canonicalIdInput.value.trim();
    const carrierGroupInputValue = carrierGroupInput.value.trim();
    const imsCodeContent = imsCode.value.trim();
    const cpFeatureContent = cpFeatureData.value.trim();

    // Validate inputs
    if (!carrierJsonContent) {
        showErrorMessage('Please provide CarrierFeature JSON file.');
        updateCarrierSummary('CarrierFeature JSON is empty.', 'warning');
        return false;
    }

    if (!canonicalIdInputValue && !carrierGroupInputValue) {
        showErrorMessage('Please enter at least one Canonical ID or Carrier Group.');
        updateTargetSummary();
        return false;
    }

    // Check if at least one feature is provided
    if (!imsCodeContent && !cpFeatureContent) {
        showErrorMessage('Please provide either IMS code or CP feature data, or both.');
        updateCarrierSummary('No feature payload selected.', 'warning');
        return false;
    }

    // Check CarrierFeature JSON syntax
    const { isValid, message } = checkJsonSyntax(carrierJsonContent);
    if (!isValid) {
        showErrorMessage(`Invalid CarrierFeature JSON syntax:\n${message}`);
        updateCarrierSummary('CarrierFeature JSON has syntax errors.', 'warning');
        return false;
    }

    // Check IMS code syntax if provided (raw or quote-escaped)
    let imsParseResult = null;
    if (imsCodeContent) {
        imsParseResult = parseImsJsonContent(imsCodeContent);
        if (!imsParseResult.isValid) {
            showErrorMessage(`Invalid IMS code syntax:\n${imsParseResult.message}`);
            updateCarrierSummary('IMS code has syntax errors.', 'warning');
            return false;
        }
    }

    try {
        // Parse CarrierFeature JSON
        const carrierData = JSON.parse(carrierJsonContent);

        const canonicalIds = parseCanonicalIds(canonicalIdInputValue);
        const carrierGroups = parseCarrierGroups(carrierGroupInputValue);

        if (canonicalIds.length === 0 && carrierGroups.length === 0) {
            showErrorMessage('Please enter at least one valid Canonical ID or Carrier Group.');
            return false;
        }

        if (canonicalIds.length > 0 && (!carrierData.specific || !Array.isArray(carrierData.specific))) {
            showErrorMessage('Invalid CarrierFeature JSON: Missing or invalid "specific" array.');
            updateCarrierSummary('Missing specific array.', 'warning');
            return false;
        }

        if (carrierGroups.length > 0 && (!carrierData.customer || !Array.isArray(carrierData.customer))) {
            showErrorMessage('Invalid CarrierFeature JSON: Missing or invalid "customer" array.');
            updateCarrierSummary('Missing customer array.', 'warning');
            return false;
        }

        // Parse IMS code if provided (accepts quote-escaped output from Quote escaper)
        const escapedIms = imsParseResult ? imsParseResult.jsonString : null;

        const cpFeatureValue = cpFeatureContent
            ? normalizeCpFeatureToOneLine(cpFeatureContent)
            : null;

        let successCount = 0;
        let failedTargets = [];
        const diffItems = [];

        for (const canonicalId of canonicalIds) {
            const entry = carrierData.specific.find(
                item => getCanonicalIdValue(item) === canonicalId
            );

            if (!entry) {
                showToast(`Canonical ID "${canonicalId}" not found`, 'error');
                failedTargets.push(`Canonical ID "${canonicalId}"`);
                diffItems.push({
                    targetLabel: canonicalId,
                    targetType: 'canonical_id',
                    status: 'missing',
                    changes: [],
                });
                continue;
            }

            const changes = applyFeaturesToEntry(entry, escapedIms, cpFeatureValue);
            diffItems.push({
                targetLabel: canonicalId,
                targetType: 'canonical_id',
                status: 'updated',
                changes,
            });
            successCount++;
        }

        for (const carrierGroup of carrierGroups) {
            const entry = carrierData.customer.find(
                item => getCarrierGroupValue(item) === carrierGroup
            );

            if (!entry) {
                showToast(`Carrier group "${carrierGroup}" not found`, 'error');
                failedTargets.push(`Carrier group "${carrierGroup}"`);
                diffItems.push({
                    targetLabel: carrierGroup,
                    targetType: 'carrier_group',
                    status: 'missing',
                    changes: [],
                });
                continue;
            }

            const changes = applyFeaturesToEntry(entry, escapedIms, cpFeatureValue);
            diffItems.push({
                targetLabel: carrierGroup,
                targetType: 'carrier_group',
                status: 'updated',
                changes,
            });
            successCount++;
        }

        // Convert back to formatted JSON
        const modifiedJson = JSON.stringify(carrierData, null, 2);

        setTextareaValue(imsOutputJson, modifiedJson);
        renderCarrierDiffPreview(diffItems);
        updateTargetSummary();

        const totalTargets = canonicalIds.length + carrierGroups.length;

        // Show summary message
        if (successCount > 0) {
            if (failedTargets.length === 0) {
                showSuccessMessage(`Features successfully inserted into ${successCount} target(s)!`);
                updateCarrierSummary(`${successCount} target(s) updated.`, 'success');
            } else {
                showSuccessMessage(`Features inserted into ${successCount} target(s). ${failedTargets.length} target(s) not found.`);
                updateCarrierSummary(`${successCount} updated, ${failedTargets.length} missing.`, 'warning');
            }
        } else {
            showErrorMessage(`Failed to insert features into any target. All ${totalTargets} target(s) not found.`);
            updateCarrierSummary('No matching targets found.', 'warning');
        }

        setTimeout(hideErrorMessage, 5000);
        return successCount > 0;

    } catch (e) {
        showErrorMessage(`Failed to insert features:\n${e.message}`);
        return false;
    }
}

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type of toast ('success' or 'error')
 */
function showToast(message, type = 'success') {
    // Create toast element if it doesn't exist
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.classList.add('toast', type);

    // Add animation keyframes if not already added
    if (!document.getElementById('toast-animation')) {
        const style = document.createElement('style');
        style.id = 'toast-animation';
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes fadeOut {
                from {
                    opacity: 1;
                }
                to {
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Add toast to container
    toastContainer.appendChild(toast);

    // Remove toast after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// ============ IMS File Operations ============

/**
 * Load CarrierFeature JSON from a file
 */
function loadImsFile() {
    imsFileInput.click();
}

/**
 * Load the bundled CarrierFeature template into the editor.
 */
async function loadCarrierTemplate() {
    try {
        const response = await fetch('example.template.json', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Template request failed (${response.status})`);
        }
        const content = await response.text();
        carrierFeatureJson.value = content;
        clearCarrierGeneratedResult('Template loaded. Run Insert again.');
        const parsed = JSON.parse(content);
        const rowCount = Array.isArray(parsed.specific) ? parsed.specific.length : 0;
        updateTargetSummary();
        updateCarrierSummary(`Template loaded: ${rowCount} row(s).`, rowCount > 0 ? 'success' : 'warning');
        showSuccessMessage(`CarrierFeature template loaded (${rowCount} row(s)).`);
        setTimeout(hideErrorMessage, 2000);
    } catch (e) {
        showErrorMessage(`Failed to load template:\n${e.message}`);
        updateCarrierSummary('Template load failed.', 'warning');
    }
}

/**
 * Handle IMS file selection
 */
async function handleImsFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const content = await readFile(file);
        carrierFeatureJson.value = content;
        clearCarrierGeneratedResult('CarrierFeature JSON loaded. Run Insert again.');

        // Check JSON syntax
        const { isValid, message } = checkJsonSyntax(content);
        if (!isValid) {
            showErrorMessage(`Invalid JSON syntax:\n${message}`);
            updateCarrierSummary('CarrierFeature JSON has syntax errors.', 'warning');
        } else {
            updateTargetSummary();
            updateCarrierSummary('CarrierFeature JSON loaded.', 'success');
            showSuccessMessage('CarrierFeature JSON loaded successfully!');
            setTimeout(hideErrorMessage, 2000);
        }
    } catch (e) {
        showErrorMessage(`Failed to load file:\n${e.message}`);
    }

    // Reset file input
    imsFileInput.value = '';
}

/**
 * Paste CarrierFeature JSON from clipboard
 */
async function pasteImsFromClipboard() {
    try {
        const clipboardContent = await navigator.clipboard.readText();
        carrierFeatureJson.value = clipboardContent;
        clearCarrierGeneratedResult('CarrierFeature JSON pasted. Run Insert again.');

        // Check JSON syntax
        const { isValid, message } = checkJsonSyntax(clipboardContent);
        if (!isValid) {
            showErrorMessage(`Invalid JSON syntax:\n${message}`);
            updateCarrierSummary('CarrierFeature JSON has syntax errors.', 'warning');
        } else {
            updateTargetSummary();
            updateCarrierSummary('CarrierFeature JSON pasted.', 'success');
            showSuccessMessage('CarrierFeature JSON pasted successfully!');
            setTimeout(hideErrorMessage, 2000);
        }
    } catch (e) {
        if (e.name === 'NotAllowedError') {
            showErrorMessage('Clipboard access denied. Please allow clipboard permissions.');
        } else {
            showErrorMessage(`Failed to paste from clipboard:\n${e.message}`);
        }
    }
}

/**
 * Clear IMS tab inputs
 */
function clearImsInputs() {
    carrierFeatureJson.value = '';
    canonicalIdInput.value = '';
    carrierGroupInput.value = '';
    imsCode.value = '';
    cpFeatureData.value = '';
    setTextareaValue(imsOutputJson, '');
    updateTargetSummary();
    updateCarrierSummary('Waiting for insert.');
    hideErrorMessage();
}

/**
 * Save modified IMS output to file
 */
function saveImsOutputFile() {
    const content = imsOutputJson.value.trim();

    if (!content) {
        showErrorMessage('Output is empty. Nothing to save.');
        return;
    }

    try {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'carrier_feature_modified.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showSuccessMessage('File saved successfully!');
        setTimeout(hideErrorMessage, 2000);
    } catch (e) {
        showErrorMessage(`Failed to save file:\n${e.message}`);
    }
}

/**
 * Copy IMS output to clipboard
 */
async function copyImsToClipboard() {
    const outputContent = imsOutputJson.value.trim();
    
    if (!outputContent) {
        showErrorMessage('Output is empty. Nothing to copy.');
        return;
    }

    try {
        await navigator.clipboard.writeText(outputContent);
        showSuccessMessage('Output copied to clipboard!');
        setTimeout(hideErrorMessage, 2000);
    } catch (e) {
        showErrorMessage(`Failed to copy to clipboard:\n${e.message}`);
    }
}

// ============ IMS Tab Event Listeners ============

// IMS tab buttons
imsLoadFileBtn.addEventListener('click', loadImsFile);
imsTemplateBtn.addEventListener('click', loadCarrierTemplate);
imsFileInput.addEventListener('change', handleImsFileSelect);
imsPasteBtn.addEventListener('click', pasteImsFromClipboard);
imsClearBtn.addEventListener('click', clearImsInputs);
imsExampleBtn.addEventListener('click', loadExampleImsCode);
cpExampleBtn.addEventListener('click', loadExampleCpFeatureData);
imsSaveFileBtn.addEventListener('click', saveImsOutputFile);
imsCopyBtn.addEventListener('click', copyImsToClipboard);
insertFeaturesBtn.addEventListener('click', insertFeatures);
carrierFeatureJson.addEventListener('input', handleCarrierInputChanged);
canonicalIdInput.addEventListener('input', handleCarrierInputChanged);
carrierGroupInput.addEventListener('input', handleCarrierInputChanged);
imsCode.addEventListener('input', handleCarrierInputChanged);
cpFeatureData.addEventListener('input', handleCarrierInputChanged);

// ============ Initialization ============

/**
 * Initialize the application
 */
function init() {
    // Load default example (empty)
    inputJson.value = '';
    outputJson.value = '';
    updateQuoteOutputMeta(0);
    updateQuoteStatus('Ready');
    
    // Initialize IMS tab
    carrierFeatureJson.value = '';
    canonicalIdInput.value = '';
    carrierGroupInput.value = '';
    imsCode.value = '';
    cpFeatureData.value = '';
    imsOutputJson.value = '';
    updateTargetSummary();
    updateCarrierSummary('Waiting for insert.');
}

// Run initialization when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
