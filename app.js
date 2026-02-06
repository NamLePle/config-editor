class JSONEditor {
  constructor() {
    this.editor = document.getElementById('json-editor');
    this.lineNumbers = document.getElementById('line-numbers');
    this.urlInput = document.getElementById('api-url');
    this.adminKeyInput = document.getElementById('admin-key');
    this.statusBar = document.getElementById('status-bar');
    this.statusText = document.getElementById('status-text');
    this.errorModal = document.getElementById('error-modal');
    this.modalBody = document.getElementById('modal-body');
    this.diffContainer = document.getElementById('diff-container');
    this.diffContent = document.getElementById('diff-content');
    this.confirmModal = document.getElementById('confirm-modal');
    this.confirmDiffContent = document.getElementById('confirm-diff-content');

    this.lastFetchedConfig = null;

    this.initEventListeners();
    this.updateLineNumbers();
    this.loadSavedSettings();
  }

  initEventListeners() {
    // Editor events
    this.editor.addEventListener('input', () => this.updateLineNumbers());
    this.editor.addEventListener('scroll', () => this.syncScroll());
    this.editor.addEventListener('keydown', (e) => this.handleKeydown(e));

    // Main action buttons
    document.getElementById('fetch-btn').addEventListener('click', () => this.fetchConfig());
    document.getElementById('diff-btn').addEventListener('click', () => this.showDiff());
    document.getElementById('modify-btn').addEventListener('click', () => this.initiateModify());

    // Editor action buttons
    document.getElementById('format-btn').addEventListener('click', () => this.formatJSON());
    document.getElementById('validate-btn').addEventListener('click', () => this.validateJSON());
    document.getElementById('copy-btn').addEventListener('click', () => this.copyToClipboard());

    // Diff close button
    document.getElementById('close-diff-btn').addEventListener('click', () => this.closeDiff());

    // Error modal events
    document.getElementById('modal-close').addEventListener('click', () => this.closeErrorModal());
    this.errorModal.addEventListener('click', (e) => {
      if (e.target === this.errorModal) this.closeErrorModal();
    });

    // Confirm modal events
    document.getElementById('confirm-modal-close').addEventListener('click', () => this.closeConfirmModal());
    document.getElementById('cancel-modify-btn').addEventListener('click', () => this.closeConfirmModal());
    document.getElementById('confirm-modify-btn').addEventListener('click', () => this.executeModify());
    this.confirmModal.addEventListener('click', (e) => {
      if (e.target === this.confirmModal) this.closeConfirmModal();
    });

    // Save settings on change
    this.urlInput.addEventListener('change', () => this.saveSettings());
    this.adminKeyInput.addEventListener('change', () => this.saveSettings());
  }

  loadSavedSettings() {
    const savedUrl = localStorage.getItem('json-editor-url');
    const savedKey = localStorage.getItem('json-editor-admin-key');
    if (savedUrl) this.urlInput.value = savedUrl;
    if (savedKey) this.adminKeyInput.value = savedKey;
  }

  saveSettings() {
    localStorage.setItem('json-editor-url', this.urlInput.value);
    localStorage.setItem('json-editor-admin-key', this.adminKeyInput.value);
  }

  updateLineNumbers() {
    const lines = this.editor.value.split('\n');
    const lineCount = lines.length;
    let lineNumbersHtml = '';
    for (let i = 1; i <= lineCount; i++) {
      lineNumbersHtml += i + '\n';
    }
    this.lineNumbers.textContent = lineNumbersHtml;
  }

  syncScroll() {
    this.lineNumbers.scrollTop = this.editor.scrollTop;
  }

  handleKeydown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = this.editor.selectionStart;
      const end = this.editor.selectionEnd;
      this.editor.value = this.editor.value.substring(0, start) + '  ' + this.editor.value.substring(end);
      this.editor.selectionStart = this.editor.selectionEnd = start + 2;
      this.updateLineNumbers();
    }
  }

  setStatus(message, type = '') {
    this.statusText.textContent = message;
    this.statusBar.className = 'status-bar ' + type;
  }

  getBaseUrl() {
    const url = this.urlInput.value.trim();
    // Extract base URL: https://host/1/docs -> https://host/1
    const match = url.match(/^(https?:\/\/[^/]+\/\d+)/);
    if (!match) return null;
    return match[1];
  }

  getConfigUrl() {
    const base = this.getBaseUrl();
    return base ? `${base}/v1/bot/config` : null;
  }

  getModifyUrl() {
    const base = this.getBaseUrl();
    return base ? `${base}/v1/bot-auth/modify-config` : null;
  }

  async fetchConfig() {
    const configUrl = this.getConfigUrl();
    if (!configUrl) {
      this.showError('Invalid URL format.\n\nExpected: https://host/1/docs');
      return;
    }

    this.setStatus('Fetching...', 'loading');
    document.getElementById('fetch-btn').disabled = true;

    try {
      const response = await fetch(configUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.editor.value = errorText;
        this.updateLineNumbers();
        this.setStatus(`HTTP ${response.status}`, 'error');
        this.showError(`HTTP ${response.status}: ${response.statusText}\n\nResponse body shown in editor.`);
        return;
      }

      const rawText = await response.text();
      try {
        const data = JSON.parse(rawText);
        this.lastFetchedConfig = data;
        this.editor.value = JSON.stringify(data, null, 2);
        this.updateLineNumbers();
        this.setStatus('Fetched successfully', 'success');
      } catch (parseError) {
        this.editor.value = rawText;
        this.updateLineNumbers();
        this.setStatus('Invalid JSON response', 'error');
        this.showError(`Response is not valid JSON:\n\n${parseError.message}\n\nRaw response shown in editor.`);
      }
    } catch (error) {
      console.error('Fetch error:', error);
      this.setStatus('Fetch failed', 'error');
      const isCorsError = error.message === 'Failed to fetch' || error.name === 'TypeError';
      if (isCorsError) {
        this.showError(`Failed to fetch config:\n\n${error.message}\n\nThis is likely a CORS error.`);
      } else {
        this.showError(`Failed to fetch config:\n\n${error.message}`);
      }
    } finally {
      document.getElementById('fetch-btn').disabled = false;
    }
  }

  async fetchCurrentConfig() {
    const configUrl = this.getConfigUrl();
    const response = await fetch(configUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  async showDiff() {
    const editorContent = this.editor.value.trim();
    if (!editorContent) {
      this.showError('Editor is empty. Please fetch or paste JSON first.');
      return;
    }

    let newConfig;
    try {
      newConfig = JSON.parse(editorContent);
    } catch (e) {
      this.showError(`Invalid JSON in editor:\n\n${e.message}`);
      return;
    }

    // Validate marketId uniqueness
    const validationWarnings = this.validateConfig(newConfig);

    this.setStatus('Fetching current config for comparison...', 'loading');
    document.getElementById('diff-btn').disabled = true;

    try {
      const oldConfig = await this.fetchCurrentConfig();
      const oldValidationWarnings = this.validateConfig(oldConfig, 'Source config');
      const allWarnings = [...oldValidationWarnings, ...validationWarnings];

      let diffHtml = '';
      if (allWarnings.length > 0) {
        diffHtml += `<div class="diff-warnings">
          <div class="diff-section-title warning">⚠ Warnings</div>
          ${allWarnings.map(w => `<div class="diff-item warning">${this.escapeHtml(w)}</div>`).join('')}
        </div>`;
      }

      diffHtml += this.generateDiffHtml(oldConfig, newConfig);
      this.diffContent.innerHTML = diffHtml;
      this.diffContainer.style.display = 'block';
      this.setStatus('Diff generated', 'success');
    } catch (error) {
      this.setStatus('Failed to fetch for diff', 'error');
      this.showError(`Failed to fetch current config:\n\n${error.message}`);
    } finally {
      document.getElementById('diff-btn').disabled = false;
    }
  }

  validateConfig(config, prefix = 'New config') {
    const warnings = [];

    // Check borosTradeConfig.operations
    if (config?.borosTradeConfig?.operations) {
      const marketIds = config.borosTradeConfig.operations.map(op => op.marketId);
      const duplicates = marketIds.filter((id, idx) => marketIds.indexOf(id) !== idx);
      if (duplicates.length > 0) {
        warnings.push(`${prefix}: Duplicate marketId in borosTradeConfig.operations: ${[...new Set(duplicates)].join(', ')}`);
      }
    }

    // Check cashAndCarryConfig.operations
    if (config?.cashAndCarryConfig?.operations) {
      const symbols = config.cashAndCarryConfig.operations.map(op => op.symbol);
      const duplicates = symbols.filter((s, idx) => symbols.indexOf(s) !== idx);
      if (duplicates.length > 0) {
        warnings.push(`${prefix}: Duplicate symbol in cashAndCarryConfig.operations: ${[...new Set(duplicates)].join(', ')}`);
      }
    }

    return warnings;
  }

  generateDiffHtml(oldObj, newObj, path = '') {
    // Collect all changes recursively
    const result = { added: [], removed: [], changed: [] };
    this.collectChanges(oldObj, newObj, path, result);

    let html = '';

    // Summary header
    const totalChanges = result.added.length + result.removed.length + result.changed.length;
    html += `<div class="diff-summary">
      <strong>Summary:</strong>
      <span class="diff-count added">${result.added.length} added</span> |
      <span class="diff-count removed">${result.removed.length} removed</span> |
      <span class="diff-count changed">${result.changed.length} modified</span> |
      <strong>Total: ${totalChanges} changes</strong>
    </div>`;

    // Added items
    if (result.added.length > 0) {
      html += `<div class="diff-section">
        <div class="diff-section-title added">+ Added (${result.added.length})</div>`;
      for (const item of result.added) {
        html += item;
      }
      html += '</div>';
    }

    // Removed items
    if (result.removed.length > 0) {
      html += `<div class="diff-section">
        <div class="diff-section-title removed">- Removed (${result.removed.length})</div>`;
      for (const item of result.removed) {
        html += item;
      }
      html += '</div>';
    }

    // Modified values
    if (result.changed.length > 0) {
      html += `<div class="diff-section">
        <div class="diff-section-title changed">~ Modified Values (${result.changed.length})</div>`;
      for (const item of result.changed) {
        html += item;
      }
      html += '</div>';
    }

    if (result.added.length === 0 && result.removed.length === 0 && result.changed.length === 0) {
      html = '<div class="no-changes">No changes detected</div>';
    }

    return html;
  }

  collectChanges(oldObj, newObj, path, result) {
    const oldKeys = new Set(Object.keys(oldObj || {}));
    const newKeys = new Set(Object.keys(newObj || {}));

    const addedKeys = [...newKeys].filter(k => !oldKeys.has(k));
    const removedKeys = [...oldKeys].filter(k => !newKeys.has(k));
    const commonKeys = [...oldKeys].filter(k => newKeys.has(k));

    // Top-level added keys
    for (const key of addedKeys) {
      const value = this.formatValue(newObj[key]);
      result.added.push(`<div class="diff-item added">
        <span class="diff-key">${path}${key}</span>
        <span class="diff-value">${this.escapeHtml(value)}</span>
      </div>`);
    }

    // Top-level removed keys
    for (const key of removedKeys) {
      const value = this.formatValue(oldObj[key]);
      result.removed.push(`<div class="diff-item removed">
        <span class="diff-key">${path}${key}</span>
        <span class="diff-value">${this.escapeHtml(value)}</span>
      </div>`);
    }

    // Compare common keys
    for (const key of commonKeys) {
      this.compareValues(oldObj[key], newObj[key], `${path}${key}`, result);
    }
  }

  compareValues(oldVal, newVal, path, result) {
    if (oldVal === newVal) return;

    const oldType = typeof oldVal;
    const newType = typeof newVal;

    // Both are numbers
    if (oldType === 'number' && newType === 'number') {
      if (oldVal === newVal) return;
      const diff = Math.abs(newVal - oldVal);
      const maxVal = Math.max(Math.abs(oldVal), Math.abs(newVal));
      const relativeDiff = diff / (maxVal + 1e-9);
      const percentChange = (relativeDiff * 100).toFixed(2);

      result.changed.push(`<div class="diff-item changed">
        <span class="diff-key">${path}</span>
        <div class="diff-comparison">
          <span class="diff-old">Old: ${oldVal}</span>
          <span class="diff-new">New: ${newVal}</span>
          <span class="diff-delta">Δ: ${diff.toFixed(6)} (${percentChange}%)</span>
        </div>
      </div>`);
      return;
    }

    // Both are strings
    if (oldType === 'string' && newType === 'string') {
      if (oldVal === newVal) return;
      result.changed.push(`<div class="diff-item changed">
        <span class="diff-key">${path}</span>
        <div class="diff-comparison">
          <span class="diff-old">Old: "${this.escapeHtml(oldVal)}"</span>
          <span class="diff-new">New: "${this.escapeHtml(newVal)}"</span>
        </div>
      </div>`);
      return;
    }

    // Both are booleans
    if (oldType === 'boolean' && newType === 'boolean') {
      if (oldVal === newVal) return;
      result.changed.push(`<div class="diff-item changed">
        <span class="diff-key">${path}</span>
        <div class="diff-comparison">
          <span class="diff-old">Old: ${oldVal}</span>
          <span class="diff-new">New: ${newVal}</span>
        </div>
      </div>`);
      return;
    }

    // Both are arrays
    if (Array.isArray(oldVal) && Array.isArray(newVal)) {
      // Check if this is an operations array (items have marketId or symbol)
      const isOperationsArray = (oldVal.length > 0 && (oldVal[0]?.marketId !== undefined || oldVal[0]?.symbol !== undefined)) ||
                                 (newVal.length > 0 && (newVal[0]?.marketId !== undefined || newVal[0]?.symbol !== undefined));

      if (isOperationsArray) {
        // Match by marketId or symbol
        const getKey = (item) => item?.marketId !== undefined ? `marketId:${item.marketId}` : `symbol:${item?.symbol}`;

        const oldMap = new Map(oldVal.map(item => [getKey(item), item]));
        const newMap = new Map(newVal.map(item => [getKey(item), item]));

        const oldKeys = new Set(oldMap.keys());
        const newKeys = new Set(newMap.keys());

        // Added operations
        for (const key of newKeys) {
          if (!oldKeys.has(key)) {
            result.added.push(`<div class="diff-item added">
              <span class="diff-key">${path}[${key}]</span>
              <span class="diff-value">${this.escapeHtml(this.formatValue(newMap.get(key)))}</span>
            </div>`);
          }
        }

        // Removed operations
        for (const key of oldKeys) {
          if (!newKeys.has(key)) {
            result.removed.push(`<div class="diff-item removed">
              <span class="diff-key">${path}[${key}]</span>
              <span class="diff-value">${this.escapeHtml(this.formatValue(oldMap.get(key)))}</span>
            </div>`);
          }
        }

        // Modified operations (same marketId/symbol)
        for (const key of oldKeys) {
          if (newKeys.has(key)) {
            this.compareValues(oldMap.get(key), newMap.get(key), `${path}[${key}]`, result);
          }
        }
      } else {
        // Default array comparison by index
        const maxLen = Math.max(oldVal.length, newVal.length);

        if (oldVal.length !== newVal.length) {
          result.changed.push(`<div class="diff-item changed">
            <span class="diff-key">${path}.length</span>
            <div class="diff-comparison">
              <span class="diff-old">Old: ${oldVal.length}</span>
              <span class="diff-new">New: ${newVal.length}</span>
            </div>
          </div>`);
        }

        for (let i = 0; i < maxLen; i++) {
          if (i >= oldVal.length) {
            result.added.push(`<div class="diff-item added">
              <span class="diff-key">${path}[${i}]</span>
              <span class="diff-value">${this.escapeHtml(this.formatValue(newVal[i]))}</span>
            </div>`);
          } else if (i >= newVal.length) {
            result.removed.push(`<div class="diff-item removed">
              <span class="diff-key">${path}[${i}]</span>
              <span class="diff-value">${this.escapeHtml(this.formatValue(oldVal[i]))}</span>
            </div>`);
          } else {
            this.compareValues(oldVal[i], newVal[i], `${path}[${i}]`, result);
          }
        }
      }
      return;
    }

    // Both are objects
    if (oldType === 'object' && newType === 'object' && oldVal !== null && newVal !== null) {
      const oldKeys = new Set(Object.keys(oldVal));
      const newKeys = new Set(Object.keys(newVal));

      // Added keys in nested object
      for (const key of newKeys) {
        if (!oldKeys.has(key)) {
          result.added.push(`<div class="diff-item added">
            <span class="diff-key">${path}.${key}</span>
            <span class="diff-value">${this.escapeHtml(this.formatValue(newVal[key]))}</span>
          </div>`);
        }
      }

      // Removed keys in nested object
      for (const key of oldKeys) {
        if (!newKeys.has(key)) {
          result.removed.push(`<div class="diff-item removed">
            <span class="diff-key">${path}.${key}</span>
            <span class="diff-value">${this.escapeHtml(this.formatValue(oldVal[key]))}</span>
          </div>`);
        }
      }

      // Common keys
      for (const key of oldKeys) {
        if (newKeys.has(key)) {
          this.compareValues(oldVal[key], newVal[key], `${path}.${key}`, result);
        }
      }
      return;
    }

    // Type changed
    result.changed.push(`<div class="diff-item changed">
      <span class="diff-key">${path}</span>
      <div class="diff-comparison">
        <span class="diff-old">Old (${oldType}): ${this.escapeHtml(this.formatValue(oldVal))}</span>
        <span class="diff-new">New (${newType}): ${this.escapeHtml(this.formatValue(newVal))}</span>
      </div>
    </div>`);
  }

  formatValue(val) {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'object') {
      const str = JSON.stringify(val);
      return str.length > 100 ? str.substring(0, 100) + '...' : str;
    }
    return String(val);
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  closeDiff() {
    this.diffContainer.style.display = 'none';
  }

  async initiateModify() {
    const editorContent = this.editor.value.trim();
    if (!editorContent) {
      this.showError('Editor is empty. Please fetch or paste JSON first.');
      return;
    }

    let newConfig;
    try {
      newConfig = JSON.parse(editorContent);
    } catch (e) {
      this.showError(`Invalid JSON in editor:\n\n${e.message}`);
      return;
    }

    const adminKey = this.adminKeyInput.value.trim();
    if (!adminKey) {
      this.showError('Please enter the admin API key.');
      return;
    }

    // Validate marketId uniqueness
    const validationWarnings = this.validateConfig(newConfig);

    this.setStatus('Fetching current config for comparison...', 'loading');

    try {
      const oldConfig = await this.fetchCurrentConfig();
      const oldValidationWarnings = this.validateConfig(oldConfig, 'Source config');
      const allWarnings = [...oldValidationWarnings, ...validationWarnings];

      let diffHtml = '';
      if (allWarnings.length > 0) {
        diffHtml += `<div class="diff-warnings">
          <div class="diff-section-title warning">⚠ Warnings</div>
          ${allWarnings.map(w => `<div class="diff-item warning">${this.escapeHtml(w)}</div>`).join('')}
        </div>`;
      }

      diffHtml += this.generateDiffHtml(oldConfig, newConfig);
      this.confirmDiffContent.innerHTML = diffHtml;
      this.confirmModal.classList.add('show');
      this.setStatus('Review changes before applying', 'loading');
    } catch (error) {
      this.setStatus('Failed to fetch for comparison', 'error');
      this.showError(`Failed to fetch current config:\n\n${error.message}`);
    }
  }

  closeConfirmModal() {
    this.confirmModal.classList.remove('show');
    this.setStatus('Modification cancelled', '');
  }

  async executeModify() {
    const editorContent = this.editor.value.trim();
    let newConfig;
    try {
      newConfig = JSON.parse(editorContent);
    } catch (e) {
      this.showError(`Invalid JSON in editor:\n\n${e.message}`);
      return;
    }

    const adminKey = this.adminKeyInput.value.trim();
    const modifyUrl = this.getModifyUrl();
    if (!modifyUrl) {
      this.showError('Invalid URL format.\n\nExpected: https://host/1/docs');
      return;
    }

    this.closeConfirmModal();
    this.setStatus('Applying changes...', 'loading');
    document.getElementById('modify-btn').disabled = true;

    try {
      const response = await fetch(modifyUrl, {
        method: 'POST',
        headers: {
          'Accept': '*/*',
          'Content-Type': 'application/json',
          'admin-api-key': adminKey
        },
        credentials: 'include',
        body: JSON.stringify({
          config: newConfig,
          isActive: true
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      this.setStatus('Configuration applied successfully!', 'success');

      // Refresh to get the new config
      await this.fetchConfig();
    } catch (error) {
      this.setStatus('Modify failed', 'error');
      this.showError(`Failed to apply configuration:\n\n${error.message}`);
    } finally {
      document.getElementById('modify-btn').disabled = false;
    }
  }

  formatJSON() {
    try {
      const json = JSON.parse(this.editor.value);
      this.editor.value = JSON.stringify(json, null, 2);
      this.updateLineNumbers();
      this.setStatus('Formatted successfully', 'success');
    } catch (error) {
      this.setStatus('Invalid JSON', 'error');
      this.showError(`Cannot format - Invalid JSON:\n\n${error.message}`);
    }
  }

  validateJSON() {
    try {
      JSON.parse(this.editor.value);
      this.setStatus('Valid JSON', 'success');
    } catch (error) {
      this.setStatus('Invalid JSON', 'error');
      this.showError(`Validation Error:\n\n${error.message}`);
    }
  }

  async copyToClipboard() {
    try {
      await navigator.clipboard.writeText(this.editor.value);
      this.setStatus('Copied to clipboard', 'success');
    } catch (error) {
      this.setStatus('Copy failed', 'error');
    }
  }

  showError(message) {
    this.modalBody.textContent = message;
    this.errorModal.classList.add('show');
  }

  closeErrorModal() {
    this.errorModal.classList.remove('show');
  }
}

// Initialize the editor when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new JSONEditor();
});
