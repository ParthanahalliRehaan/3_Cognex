(function() {
  'use strict';
  // const API_BASE = 'http://127.0.0.1:8787';
  const API_BASE = (window.location.hostname === 'localhost' ||
                    window.location.hostname === '127.0.0.1' ||
                    window.location.hostname === '::1')
    ? 'http://127.0.0.1:8787'
    : 'https://cognex-worker.parthanahalli-rehaan.workers.dev';

  const MAX_TABS = 20;
  const TAB_TRUNCATE_LEN = 24;
  const POLL_INTERVAL_MS = 2000;
  const FETCH_TIMEOUT_MS = 30000;
  const CHAT_THROTTLE_MS = 50;
  const STATUS_POLL_TIMEOUT_MS = 10000;
  const MAX_POLL_RETRIES = 3;

  let currentRepo = null;
  let isIngesting = false;
  let cy = null;
  let allFileNodes = [];
  let openFiles = [];
  let activeFileId = null;
  let fileContents = {};
  let graphData = null;
  let pollIntervalId = null;
  let pollRetries = 0;
  let chatAbortController = null;
  let ingestAbortController = null;
  let lastChatUpdate = 0;
  let pendingChatText = '';
  let chatChunkBuffer = [];
  let chatRafId = null;
  let activeTab = 'graph';
  let lastFocusedElement = null;
  let focusedNode = null;
  let nodeDegrees = {};
  let treeRootData = null;
  let treeFilterQuery = '';

  const els = {};

  function cacheElements() {
    const ids = [
      'repoUrl', 'ingestBtn', 'ingestStatus', 'chatInput', 'sendBtn',
      'chatMessages', 'graphViz', 'filesTree', 'editorTabs', 'editorContent',
      'nodeModal', 'modalTitle', 'modalBody', 'graphTooltip',
      'tabBar', 'contentArea',
      'graphSearch', 'orphanToggle', 'focusResetBtn',
      'graphStats', 'statNodes', 'statEdges', 'statComponents',
      'orphanBadge', 'orphanBadgeCount', 'orphanCount',
      'fileSearch', 'fileCountBadge', 'expandAllBtn', 'collapseAllBtn',
      'clearChatBtn'
    ];
    ids.forEach(id => { els[id] = document.getElementById(id); });
  }

  function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getFileIcon(ext) {
    const icons = {
      js: '\u{1F4DC}', ts: '\u{1F4D8}', jsx: '\u{269B}', tsx: '\u{269B}',
      py: '\u{1F40D}', go: '\u{1F535}', rs: '\u{2699}', java: '\u{2615}',
      json: '\u{1F4CB}', md: '\u{1F4DD}', yml: '\u{2699}', yaml: '\u{2699}',
      html: '\u{1F310}', css: '\u{1F3A8}', svg: '\u{1F5BC}', scss: '\u{1F3A8}',
      sass: '\u{1F3A8}', xml: '\u{1F4C4}', sh: '\u{1F527}', bash: '\u{1F527}',
      c: '\u{1F537}', cpp: '\u{1F537}', h: '\u{1F537}', hpp: '\u{1F537}',
      rb: '\u{1F48E}', php: '\u{1F418}', mjs: '\u{1F4DC}', cjs: '\u{1F4DC}',
      vue: '\u{1F49A}', svelte: '\u{1F9E1}',
    };
    return icons[ext] || '\u{1F4C4}';
  }

  function getLangFromExt(ext) {
    const map = {
      js: 'js', ts: 'ts', jsx: 'js', tsx: 'ts',
      py: 'py', java: 'java', go: 'go', rs: 'rs',
      html: 'html', htm: 'html', css: 'css', scss: 'css', sass: 'css',
      json: 'json', md: 'md', yml: 'yaml', yaml: 'yaml',
      xml: 'xml', sh: 'bash', bash: 'bash', zsh: 'bash',
      c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
      rb: 'rb', php: 'php', mjs: 'js', cjs: 'js',
      vue: 'html', svelte: 'html',
    };
    return map[ext] || 'text';
  }

  function parseRepoUrl(url) {
    let match = url.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/|$)/);
    if (match) return { owner: match[1], repo: match[2] };
    match = url.match(/git@github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/);
    if (match) return { owner: match[1], repo: match[2] };
    return null;
  }

  function normalizeLineEndings(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function showStatus(message, type) {
    if (!els.ingestStatus) return;
    els.ingestStatus.textContent = message;
    els.ingestStatus.className = `status ${type}`;
    els.ingestStatus.classList.remove('hidden');
  }

  function hideStatus() {
    if (!els.ingestStatus) return;
    els.ingestStatus.classList.add('hidden');
  }

  function setIngestLoading(loading) {
    if (!els.ingestBtn) return;
    els.ingestBtn.disabled = loading;
    els.ingestBtn.innerHTML = loading
      ? '<span class="btn-icon" aria-hidden="true">\u23F3</span><span class="btn-text">Building\u2026</span>'
      : '<span class="btn-icon" aria-hidden="true">\u{1F4A5}</span><span class="btn-text">Build graph</span>';
  }

  function throttledChatUpdate(assistantMsg) {
    if (chatRafId) return;
    chatRafId = requestAnimationFrame(() => {
      chatRafId = null;
      const now = performance.now();
      if (now - lastChatUpdate < CHAT_THROTTLE_MS) {
        throttledChatUpdate(assistantMsg);
        return;
      }
      lastChatUpdate = now;
      assistantMsg.innerHTML = formatChatContent(pendingChatText);
      scrollToBottom();
    });
  }

  function trapFocus(container) {
    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]):not([disabled])'
    );
    if (focusable.length === 0) return () => {};
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function onKeydown(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    container.addEventListener('keydown', onKeydown);
    first.focus();
    return () => container.removeEventListener('keydown', onKeydown);
  }

  function resetAppState() {
    currentRepo = null;
    allFileNodes = [];
    openFiles = [];
    activeFileId = null;
    fileContents = {};
    graphData = null;
    pollRetries = 0;
    focusedNode = null;
    nodeDegrees = {};
    treeRootData = null;
    treeFilterQuery = '';

    if (cy) {
      try { cy.destroy(); } catch (e) {}
      cy = null;
    }

    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }

    if (chatAbortController) {
      chatAbortController.abort();
      chatAbortController = null;
    }

    if (ingestAbortController) {
      ingestAbortController.abort();
      ingestAbortController = null;
    }

    pendingChatText = '';
    chatChunkBuffer = [];
    if (chatRafId) {
      cancelAnimationFrame(chatRafId);
      chatRafId = null;
    }

    if (els.graphViz) {
      els.graphViz.innerHTML = '<div class="empty-state"><div class="empty-ascii" aria-hidden="true">\u250C\u2500\u2510<br>\u2502 \u2502<br>\u2514\u2500\u2518</div><p>Enter a repository URL above to build a graph</p></div>';
    }

    if (els.filesTree) {
      els.filesTree.innerHTML = '<div class="empty-state"><div class="empty-ascii" aria-hidden="true">\u{1F4C1}</div><p>No files yet</p></div>';
    }

    if (els.editorTabs) els.editorTabs.innerHTML = '';
    if (els.editorContent) {
      els.editorContent.innerHTML = '<div class="editor-empty"><div class="empty-ascii" aria-hidden="true">\u{1F4C1}</div><p>Select a file from the tree to view</p></div>';
    }

    if (els.chatMessages) {
      els.chatMessages.innerHTML = '<div class="welcome"><div class="welcome-ascii" aria-hidden="true">[&gt;_]</div><p>Ask me anything about this repository.</p><div class="suggestions" role="list" aria-label="Suggested questions"><button type="button" class="suggestion" data-q="Who are the top contributors?" role="listitem">\u{1F464} Top contributors?</button><button type="button" class="suggestion" data-q="What are the main dependencies?" role="listitem">\u{1F4E6} Dependencies?</button><button type="button" class="suggestion" data-q="Explain the architecture" role="listitem">\u{1F3D7} Architecture?</button><button type="button" class="suggestion" data-q="Find security vulnerabilities" role="listitem">\u{1F512} Security issues?</button><button type="button" class="suggestion" data-q="Summarize the README" role="listitem">\u{1F4DD} Summarize README?</button></div></div>';
    }

    if (els.orphanToggle) els.orphanToggle.setAttribute('aria-pressed', 'false');
    if (els.graphSearch) els.graphSearch.value = '';
    if (els.graphStats) els.graphStats.classList.add('hidden');
    if (els.orphanBadge) els.orphanBadge.classList.add('hidden');
    if (els.fileSearch) els.fileSearch.value = '';
    if (els.fileCountBadge) els.fileCountBadge.textContent = '0';

    if (els.chatInput) {
      els.chatInput.disabled = true;
      els.chatInput.placeholder = 'Ask about this repo\u2026';
      els.chatInput.value = '';
      els.chatInput.rows = 1;
    }
    if (els.sendBtn) els.sendBtn.disabled = true;

    hideStatus();
  }

  document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    initHints();
    initSuggestions();
    initIngest();
    initTabs();
    initChat();
    initModal();
    initKeyboardShortcuts();
    initGraphControls();
    initFileControls();
    window.addEventListener('resize', () => {
      if (cy && activeTab === 'graph') cy.resize();
    });
  });

  function initHints() {
    const container = document.querySelector('.hints');
    if (!container) return;
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.hint-btn');
      if (!btn || !els.repoUrl) return;
      els.repoUrl.value = btn.dataset.repo;
      els.repoUrl.focus();
    });
  }

  function initSuggestions() {
    if (!els.chatMessages) return;
    els.chatMessages.addEventListener('click', (e) => {
      const btn = e.target.closest('.suggestion');
      if (!btn || !els.chatInput || els.chatInput.disabled) return;
      els.chatInput.value = btn.dataset.q;
      els.chatInput.focus();
      autoResizeTextarea(els.chatInput);
    });
  }

  function initIngest() {
    if (!els.ingestBtn || !els.repoUrl) return;
    els.ingestBtn.addEventListener('click', ingestRepo);
    els.repoUrl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') ingestRepo();
    });
  }

  function initTabs() {
    if (!els.tabBar) return;
    els.tabBar.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(tabName) {
    if (!tabName || activeTab === tabName) return;
    activeTab = tabName;

    els.tabBar.querySelectorAll('.tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === tabName + 'Tab');
    });

    if (tabName === 'graph' && cy) {
      setTimeout(() => { cy.resize(); cy.fit(40); }, 50);
    }
  }

  async function ingestRepo() {
    if (!els.repoUrl) return;
    const repoUrl = els.repoUrl.value.trim();
    if (!repoUrl || !repoUrl.includes('github.com')) {
      showStatus('Please enter a valid GitHub URL', 'error');
      return;
    }
    if (isIngesting) return;

    resetAppState();

    if (ingestAbortController) ingestAbortController.abort();
    ingestAbortController = new AbortController();

    isIngesting = true;
    setIngestLoading(true);
    showStatus('Fetching repository data\u2026', 'info');

    try {
      const response = await fetch(`${API_BASE}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl }),
        signal: ingestAbortController.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error');
        showStatus(`Server error ${response.status}: ${text.slice(0, 200)}`, 'error');
        return;
      }

      let data;
      try {
        data = await response.json();
      } catch (jsonErr) {
        showStatus(`Invalid server response: ${jsonErr.message}`, 'error');
        return;
      }

      if (data.success && data.status !== 'accepted') {
        currentRepo = repoUrl;
        showStatus(`Graph built \u2014 ${data.nodes} nodes \u00B7 ${data.edges} edges \u00B7 ${data.documents} docs \u00B7 ${data.duration}s`, 'success');
        enableChat();
        loadGraph(repoUrl);
        loadFiles(repoUrl);
      } else if (data.status === 'accepted') {
        currentRepo = repoUrl;
        showStatus('Ingestion accepted. Polling status\u2026', 'info');
        enableChat();
        pollStatus(repoUrl);
      } else if (data.status === 'already_exists') {
        currentRepo = repoUrl;
        showStatus(`Repo already ingested \u2014 ${data.nodeCount} nodes \u00B7 ${data.docCount} docs`, 'info');
        enableChat();
        loadGraph(repoUrl);
        loadFiles(repoUrl);
      } else {
        showStatus(`Error: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        showStatus('Ingestion cancelled', 'info');
      } else {
        showStatus(`Network error: ${err.message}`, 'error');
      }
    } finally {
      isIngesting = false;
      setIngestLoading(false);
      ingestAbortController = null;
    }
  }

  function pollStatus(repoUrl) {
    if (pollIntervalId) clearInterval(pollIntervalId);
    pollRetries = 0;
    let isPolling = false;

    pollIntervalId = setInterval(async () => {
      if (isPolling) return;
      isPolling = true;
      try {
        const res = await fetchWithTimeout(
          `${API_BASE}/api/status?repoUrl=${encodeURIComponent(repoUrl)}`,
          { timeout: STATUS_POLL_TIMEOUT_MS }
        );
        const data = await res.json();
        pollRetries = 0;

        if (data.status === 'done') {
          clearInterval(pollIntervalId);
          pollIntervalId = null;
          showStatus(`Ingestion complete \u2014 ${data.nodeCount} nodes \u00B7 ${data.docCount} docs`, 'success');
          loadGraph(repoUrl);
          loadFiles(repoUrl);
        } else if (data.status === 'error') {
          clearInterval(pollIntervalId);
          pollIntervalId = null;
          showStatus(`Ingestion failed: ${data.message}`, 'error');
        } else {
          showStatus(`Processing\u2026 ${data.progress || 0}% \u2014 ${data.message || ''}`, 'info');
        }
      } catch (err) {
        if (++pollRetries >= MAX_POLL_RETRIES) {
          clearInterval(pollIntervalId);
          pollIntervalId = null;
          showStatus('Status polling failed after retries. Please refresh.', 'error');
        } else {
          showStatus(`Polling error (retry ${pollRetries}/${MAX_POLL_RETRIES})\u2026`, 'info');
        }
      } finally {
        isPolling = false;
      }
    }, POLL_INTERVAL_MS);
  }

  function enableChat() {
    if (els.chatInput) {
      els.chatInput.disabled = false;
      els.chatInput.placeholder = `> Ask about ${currentRepo.split('/').pop()}\u2026`;
    }
    if (els.sendBtn) els.sendBtn.disabled = false;
  }

  function initChat() {
    if (!els.sendBtn || !els.chatInput) return;
    els.sendBtn.addEventListener('click', sendMessage);
    els.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    els.chatInput.addEventListener('input', () => {
      autoResizeTextarea(els.chatInput);
    });
    if (els.clearChatBtn) {
      els.clearChatBtn.addEventListener('click', clearChat);
    }
  }

  function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(120, el.scrollHeight) + 'px';
  }

  function clearChat() {
    if (!els.chatMessages) return;
    els.chatMessages.innerHTML = '<div class="welcome"><div class="welcome-ascii" aria-hidden="true">[&gt;_]</div><p>Ask me anything about this repository.</p><div class="suggestions" role="list" aria-label="Suggested questions"><button type="button" class="suggestion" data-q="Who are the top contributors?" role="listitem">\u{1F464} Top contributors?</button><button type="button" class="suggestion" data-q="What are the main dependencies?" role="listitem">\u{1F4E6} Dependencies?</button><button type="button" class="suggestion" data-q="Explain the architecture" role="listitem">\u{1F3D7} Architecture?</button><button type="button" class="suggestion" data-q="Find security vulnerabilities" role="listitem">\u{1F512} Security issues?</button><button type="button" class="suggestion" data-q="Summarize the README" role="listitem">\u{1F4DD} Summarize README?</button></div></div>';
  }

  async function sendMessage() {
    if (!els.chatInput || !els.chatMessages) return;
    const query = els.chatInput.value.trim();
    if (!query || !currentRepo) return;

    if (chatAbortController) chatAbortController.abort();
    chatAbortController = new AbortController();

    if (chatRafId) {
      cancelAnimationFrame(chatRafId);
      chatRafId = null;
    }

    addMessage('user', query);
    els.chatInput.value = '';
    els.chatInput.style.height = 'auto';
    els.chatInput.rows = 1;
    const assistantMsg = addMessage('assistant', '', true);
    pendingChatText = '';
    chatChunkBuffer = [];
    if (els.chatMessages) els.chatMessages.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(`${API_BASE}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: currentRepo, query }),
        signal: chatAbortController.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        chatChunkBuffer.push(chunk);
        pendingChatText = chatChunkBuffer.join('');
        throttledChatUpdate(assistantMsg);
      }

      if (chatRafId) cancelAnimationFrame(chatRafId);
      chatRafId = null;
      assistantMsg.innerHTML = formatChatContent(pendingChatText);
      assistantMsg.classList.remove('streaming');
      addCopyButtons(assistantMsg);
      scrollToBottom();
    } catch (err) {
      if (err.name === 'AbortError') {
        assistantMsg.textContent = 'Message cancelled.';
      } else {
        assistantMsg.textContent = `Error: ${err.message}. Make sure the backend is running.`;
      }
      assistantMsg.classList.remove('streaming');
    } finally {
      chatAbortController = null;
      if (els.chatMessages) els.chatMessages.setAttribute('aria-busy', 'false');
    }
  }

  function formatChatContent(text) {
    let html = escapeHtml(text);
    if (!html) return html;

    // Code blocks
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Lists
    html = html.replace(/^(\s*)-\s+(.+)$/gm, (match, indent, item) => {
      return `<li>${item}</li>`;
    });

    // Wrap consecutive li in ul
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
      return `<ul>${match}</ul>`;
    });

    // Paragraphs
    const blocks = html.split(/\n\n+/);
    html = blocks.map(block => {
      if (block.startsWith('<') && (block.startsWith('<pre') || block.startsWith('<ul') || block.startsWith('<li'))) return block;
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    }).join('');

    return html;
  }

  function addMessage(role, text, streaming = false) {
    if (!els.chatMessages) return null;
    const welcome = els.chatMessages.querySelector('.welcome');
    if (welcome) welcome.remove();

    const msg = document.createElement('div');
    msg.className = `message ${role}${streaming ? ' streaming' : ''}`;
    msg.setAttribute('role', 'listitem');

    const header = document.createElement('div');
    header.className = 'message-header';
    const name = document.createElement('span');
    name.textContent = role === 'user' ? 'You' : 'Cognex';
    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    header.appendChild(name);
    header.appendChild(time);

    const content = document.createElement('div');
    content.className = 'message-content';
    if (role === 'assistant' && !streaming) {
      content.innerHTML = formatChatContent(text);
    } else {
      content.textContent = text;
    }

    msg.appendChild(header);
    msg.appendChild(content);
    els.chatMessages.appendChild(msg);
    scrollToBottom();
    return content;
  }

  function addCopyButtons(msgContent) {
    const pres = msgContent.querySelectorAll('pre');
    pres.forEach(pre => {
      if (pre.querySelector('.copy-code-btn')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-code-btn';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy code to clipboard');
      btn.addEventListener('click', async () => {
        const code = pre.querySelector('code')?.textContent || pre.textContent;
        try {
          await navigator.clipboard.writeText(code);
          btn.textContent = 'Copied!';
          setTimeout(() => btn.textContent = 'Copy', 2000);
        } catch {
          btn.textContent = 'Failed';
          setTimeout(() => btn.textContent = 'Copy', 2000);
        }
      });
      pre.appendChild(btn);
    });
  }

  function scrollToBottom() {
    if (els.chatMessages) {
      els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    }
  }

  let modalFocusTrapCleanup = null;

  function initModal() {
    if (!els.nodeModal) return;
    els.nodeModal.addEventListener('click', (e) => {
      if (e.target === els.nodeModal) closeNodeModal();
    });
    const closeBtn = document.getElementById('modalCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeNodeModal);
  }

  function showNodeModal(nodeData) {
    if (!els.modalTitle || !els.modalBody || !els.nodeModal) return;
    lastFocusedElement = document.activeElement;

    const isFile = nodeData.type === 'file';
    const title = isFile
      ? `File: ${nodeData.fullLabel || nodeData.label}`
      : (nodeData.fullLabel || nodeData.label);
    els.modalTitle.textContent = title;

    const frag = document.createDocumentFragment();

    if (isFile) {
      const ext = (nodeData.fullLabel || nodeData.label || '').split('.').pop();
      const meta = nodeData.metadata || {};
      const size = meta.size ? formatBytes(meta.size) : 'Unknown';
      const path = meta.path || nodeData.fullLabel || nodeData.label;

      const badge = document.createElement('div');
      badge.className = 'modal-file-badge';
      badge.innerHTML = `<span class="modal-file-icon" aria-hidden="true">${getFileIcon(ext)}</span><span class="modal-file-name">${escapeHtml(nodeData.fullLabel || nodeData.label)}</span>`;
      frag.appendChild(badge);

      const grid = document.createElement('div');
      grid.className = 'modal-meta-grid';
      grid.innerHTML = `
        <div class="modal-meta-card"><label>Type</label><span>${escapeHtml(nodeData.type)}</span></div>
        <div class="modal-meta-card"><label>Extension</label><span>${escapeHtml(ext || '\u2014')}</span></div>
        <div class="modal-meta-card"><label>Size</label><span>${escapeHtml(size)}</span></div>
        <div class="modal-meta-card"><label>Path</label><span class="modal-meta-path">${escapeHtml(path)}</span></div>
      `;
      frag.appendChild(grid);

      const actions = document.createElement('div');
      actions.className = 'modal-actions';

      const askBtn = document.createElement('button');
      askBtn.type = 'button';
      askBtn.className = 'modal-btn primary';
      askBtn.innerHTML = '<span aria-hidden="true">\u{1F916}</span> Ask AI what the file does';
      askBtn.addEventListener('click', () => askAIAboutFile(nodeData.fullLabel || nodeData.label));
      actions.appendChild(askBtn);

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'modal-btn';
      openBtn.innerHTML = '<span aria-hidden="true">\u{1F4C2}</span> Open in editor';
      openBtn.addEventListener('click', () => openFileFromModal(nodeData.id));
      actions.appendChild(openBtn);

      frag.appendChild(actions);
    } else {
      const badge = document.createElement('div');
      badge.className = 'modal-type-badge';
      badge.textContent = nodeData.type;
      frag.appendChild(badge);

      const meta = nodeData.metadata || {};
      const metaEntries = Object.entries(meta).filter(([k]) =>
        !['id', 'label', 'fullLabel', 'type'].includes(k)
      );

      if (metaEntries.length > 0) {
        const grid = document.createElement('div');
        grid.className = 'modal-meta-grid';
        metaEntries.forEach(([key, value]) => {
          let displayValue = value;
          if (typeof value === 'object') displayValue = JSON.stringify(value);
          const card = document.createElement('div');
          card.className = 'modal-meta-card';
          card.innerHTML = `<label>${escapeHtml(key)}</label><span>${escapeHtml(String(displayValue))}</span>`;
          grid.appendChild(card);
        });
        frag.appendChild(grid);
      }

      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      const askBtn = document.createElement('button');
      askBtn.type = 'button';
      askBtn.className = 'modal-btn primary';
      askBtn.innerHTML = `Ask AI about this ${escapeHtml(nodeData.type)}`;
      askBtn.addEventListener('click', () => askAIAboutNode(nodeData.fullLabel || nodeData.label, nodeData.type));
      actions.appendChild(askBtn);
      frag.appendChild(actions);
    }

    els.modalBody.innerHTML = '';
    els.modalBody.appendChild(frag);
    els.nodeModal.classList.remove('hidden');
    modalFocusTrapCleanup = trapFocus(els.nodeModal);
  }

  function closeNodeModal() {
    if (!els.nodeModal) return;
    els.nodeModal.classList.add('hidden');
    if (modalFocusTrapCleanup) {
      modalFocusTrapCleanup();
      modalFocusTrapCleanup = null;
    }
    if (lastFocusedElement) {
      lastFocusedElement.focus();
      lastFocusedElement = null;
    }
  }

  function openFileFromModal(nodeId) {
    const file = allFileNodes.find(f => f.id === nodeId);
    if (file) {
      closeNodeModal();
      switchTab('files');
      openFile(file);
    }
  }

  function askAIAboutFile(filename) {
    closeNodeModal();
    switchTab('chat');
    if (els.chatInput) {
      els.chatInput.value = `What does the file ${filename} do?`;
      autoResizeTextarea(els.chatInput);
      setTimeout(() => {
        els.chatInput.focus();
        sendMessage();
      }, 100);
    }
  }

  function askAIAboutNode(name, type) {
    closeNodeModal();
    switchTab('chat');
    if (els.chatInput) {
      els.chatInput.value = `Tell me about the ${type} "${name}" in this repository.`;
      autoResizeTextarea(els.chatInput);
      setTimeout(() => {
        els.chatInput.focus();
        sendMessage();
      }, 100);
    }
  }

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (els.nodeModal && !els.nodeModal.classList.contains('hidden')) {
          closeNodeModal();
        }
      }
    });
  }

  async function loadGraph(repoUrl) {
    if (!repoUrl || !els.graphViz) return;

    if (graphData && currentRepo === repoUrl) {
      renderCytoscape(graphData.nodes, graphData.edges);
      return;
    }

    els.graphViz.innerHTML = '<div class="empty-state"><div class="empty-ascii" aria-hidden="true">\u23F3</div><p>Loading graph\u2026</p></div>';
    if (els.graphStats) els.graphStats.classList.add('hidden');

    try {
      const response = await fetchWithTimeout(
        `${API_BASE}/api/graph?repoUrl=${encodeURIComponent(repoUrl)}`
      );
      const data = await response.json();

      if (!data.nodes || data.nodes.length === 0) {
        els.graphViz.innerHTML = '<div class="empty-state"><div class="empty-ascii" aria-hidden="true">\u250C\u2500\u2510<br>\u2502 \u2502<br>\u2514\u2500\u2518</div><p>No graph data</p></div>';
        return;
      }
      graphData = data;
      renderCytoscape(data.nodes, data.edges);
    } catch (err) {
      console.error('[GRAPH] error:', err);
      els.graphViz.innerHTML = `<div class="empty-state"><div class="empty-ascii" aria-hidden="true">\u2716</div><p>Graph error: ${escapeHtml(err.message)}</p><button type="button" class="modal-btn primary" onclick="window.cognexRetryGraph()" style="margin-top:12px">Retry</button></div>`;
    }
  }

  window.cognexRetryGraph = function() {
    if (currentRepo) loadGraph(currentRepo);
  };

  function computeDegrees(nodes, edges) {
    const deg = {};
    nodes.forEach(n => { deg[n.id] = 0; });
    edges.forEach(e => {
      if (deg[e.source_node_id] !== undefined) deg[e.source_node_id]++;
      if (deg[e.target_node_id] !== undefined) deg[e.target_node_id]++;
    });
    return deg;
  }

  const NODE_STYLES = {
    file:       { stops: ['#7a9f4a', '#4a6b22', '#1a3008'], border: '#8ab84a', glow: 'rgba(107, 142, 61, 0.55)' },
    function:   { stops: ['#6b8e3d', '#3d5a1a', '#0f2604'], border: '#5a7d2a', glow: 'rgba(90, 125, 42, 0.5)' },
    contributor:{ stops: ['#b3d94a', '#8ab800', '#5a7d00'], border: '#0a0a0a', glow: 'rgba(138, 184, 0, 0.45)' },
    issue:      { stops: ['#8b5a2b', '#a06b35', '#cd853f'], border: '#d2691e', glow: 'rgba(160, 107, 53, 0.5)' },
    pr:         { stops: ['#b3d94a', '#8ab800', '#5a7d00'], border: '#0a0a0a', glow: 'rgba(138, 184, 0, 0.45)' },
    commit:     { stops: ['#666666', '#888888', '#444444'], border: '#999999', glow: 'rgba(100, 100, 100, 0.5)' },
    dependency: { stops: ['#5a7d3a', '#2d4210', '#0f1a04'], border: '#6b8e3d', glow: 'rgba(74, 103, 42, 0.5)' },
    repo:       { stops: ['#b3d94a', '#8ab800', '#5a7d00'], border: '#0a0a0a', glow: 'rgba(138, 184, 0, 0.5)' },
    readme:     { stops: ['#7a6b4a', '#4a3d22', '#1a1408'], border: '#8a7d4a', glow: 'rgba(122, 107, 74, 0.5)' },
  };

  const CY_STYLESHEET = [
    {
      selector: 'node',
      style: {
        'font-size': '10px',
        'font-family': 'Syne Mono, monospace',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.95,
        'text-background-padding': '4px',
        'text-margin-y': 8,
        'color': '#0a0a0a',
        'transition-property': 'opacity, border-width, shadow-blur, width, height',
        'transition-duration': '0.25s',
      },
    },
    {
      selector: 'node.hover',
      style: {
        'text-opacity': 1,
        'label': 'data(fullLabel)',
      },
    },
    {
      selector: 'edge',
      style: {
        'width': 1.5,
        'line-color': '#bbbbbb',
        'target-arrow-color': '#bbbbbb',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '8px',
        'font-family': 'Syne Mono, monospace',
        'color': '#888888',
        'text-rotation': 'autorotate',
        'line-opacity': 0.65,
        'transition-property': 'opacity',
        'transition-duration': '0.25s',
      },
    },
    {
      selector: ':selected',
      style: {
        'border-width': 4,
        'border-color': '#8ab800',
        'shadow-blur': 24,
        'shadow-color': 'rgba(138, 184, 0, 0.7)',
      },
    },
    {
      selector: '.dimmed',
      style: { 'opacity': 0.1 },
    },
    {
      selector: '.match',
      style: {
        'opacity': 1,
        'border-width': 3,
        'border-color': '#d97706',
        'shadow-blur': 20,
        'shadow-color': 'rgba(217, 119, 6, 0.5)',
        'text-opacity': 1,
        'z-index': 999,
      },
    },
    {
      selector: '.highlighted',
      style: {
        'opacity': 1,
        'border-width': 3,
        'border-color': '#8ab800',
        'z-index': 999,
      },
    },
  ];

  function buildCyElements(nodes, edges, degrees) {
    const cyNodes = nodes.map(n => {
      const style = NODE_STYLES[n.node_type] || NODE_STYLES.file;
      const degree = degrees[n.id] || 0;
      const size = Math.min(76, Math.max(28, 32 + degree * 5));
      return {
        data: {
          id: n.id,
          label: n.label.length > 24 ? n.label.substring(0, 24) + '\u2026' : n.label,
          fullLabel: n.label,
          type: n.node_type,
          degree: degree,
          metadata: n.metadata || {},
        },
        style: {
          'background-fill': 'radial-gradient',
          'background-gradient-stop-colors': style.stops.join(' '),
          'background-gradient-stop-positions': '0 50 100',
          'background-gradient-center-x': '30%',
          'background-gradient-center-y': '30%',
          'border-color': style.border,
          'border-width': 2,
          'width': size,
          'height': size,
          'shadow-blur': 16,
          'shadow-color': style.glow,
          'shadow-offset-x': 2,
          'shadow-offset-y': 5,
          'shadow-opacity': 0.85,
          'text-opacity': 0,
        },
      };
    });

    const cyEdges = edges.map(e => ({
      data: {
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        label: e.relation,
      },
    }));

    return { cyNodes, cyEdges };
  }

  function attachCyEvents(cyInstance) {
    cyInstance.on('mouseover', 'node', (e) => {
      const node = e.target;
      if (els.graphTooltip) {
        const deg = node.data('degree') || 0;
        els.graphTooltip.innerHTML = '<strong>' + escapeHtml(node.data('fullLabel')) + '</strong><br><span style="opacity:0.7">' + deg + ' connection' + (deg === 1 ? '' : 's') + '</span>';
        els.graphTooltip.style.display = 'block';
        updateTooltipPosition(e);
      }
      node.addClass('hover');
    });

    cyInstance.on('mousemove', 'node', updateTooltipPosition);

    cyInstance.on('mouseout', 'node', (e) => {
      if (els.graphTooltip) els.graphTooltip.style.display = 'none';
      e.target.removeClass('hover');
    });

    cyInstance.on('tap', 'node', (evt) => {
      const node = evt.target;
      const data = node.data();
      if (data.type === 'file') {
        const fileNode = graphData?.nodes?.find(n => n.id === data.id);
        if (fileNode) {
          switchTab('files');
          openFile(fileNode);
        }
      } else {
        showNodeModal(data);
      }
    });

    cyInstance.one('layoutstop', () => {
      cyInstance.fit(40);
    });
  }

  function renderCytoscape(nodes, edges) {
    if (!els.graphViz) return;
    const emptyState = els.graphViz.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    if (els.graphViz.clientHeight < 100) {
      els.graphViz.style.height = '500px';
    }

    if (cy) {
      try { cy.destroy(); } catch (e) {}
    }

    nodeDegrees = computeDegrees(nodes, edges);

    // Filter out orphan nodes (degree 0) and their edges — only show connected graph
    const connectedNodeIds = new Set();
    Object.entries(nodeDegrees).forEach(([id, deg]) => {
      if (deg > 0) connectedNodeIds.add(id);
    });
    const filteredNodes = nodes.filter(n => connectedNodeIds.has(n.id));
    const filteredEdges = edges.filter(e =>
      connectedNodeIds.has(e.source_node_id) && connectedNodeIds.has(e.target_node_id)
    );

    if (filteredNodes.length === 0) {
      els.graphViz.innerHTML = '<div class="empty-state"><div class="empty-ascii" aria-hidden="true">\u250C\u2500\u2510<br>\u2502 \u2502<br>\u2514\u2500\u2518</div><p>No connected graph data</p></div>';
      return;
    }

    const { cyNodes, cyEdges } = buildCyElements(filteredNodes, filteredEdges, nodeDegrees);

    try {
      cy = cytoscape({
        container: els.graphViz,
        elements: [...cyNodes, ...cyEdges],
        style: CY_STYLESHEET,
        minZoom: 0.05,
        maxZoom: 4,
        wheelSensitivity: 1.2,
        hideEdgesOnViewport: filteredNodes.length > 200,
        textureOnViewport: filteredNodes.length > 500,
      });
      attachCyEvents(cy);
      runSmartLayout(cy, nodeDegrees);
      if (els.graphStats) els.graphStats.classList.remove('hidden');
    } catch (err) {
      console.error('[CYTOSCAPE] init error:', err);
      if (els.graphViz) {
        els.graphViz.innerHTML = `<div class="empty-state"><div class="empty-ascii" aria-hidden="true">\u2716</div><p>Graph render error: ${escapeHtml(err.message)}</p><button type="button" class="modal-btn primary" onclick="window.cognexRetryGraph()" style="margin-top:12px">Retry</button></div>`;
      }
    }
  }

  function runSmartLayout(cyInstance, degrees) {
    updateGraphStats(cyInstance, degrees);

    const layout = cyInstance.layout({
      name: 'cose',
      padding: 40,
      animate: true,
      animationDuration: 800,
      componentSpacing: 160,
      nodeRepulsion: 12000,
      idealEdgeLength: 90,
      gravity: 0.15,
      numIter: 2500,
      initialTemp: 350,
      coolingFactor: 0.92,
      minTemp: 0.5,
      fit: true,
      randomize: true,
      nodeOverlap: 15,
    });

    layout.one('layoutstop', () => {
      cyInstance.fit(50);
    });

    layout.run();
  }

  function updateGraphStats(cyInstance, degrees) {
    const totalNodes = cyInstance.nodes().length;
    const totalEdges = cyInstance.edges().length;
    const components = cyInstance.elements().components().length;

    if (els.statNodes) els.statNodes.textContent = totalNodes;
    if (els.statEdges) els.statEdges.textContent = totalEdges;
    if (els.statComponents) els.statComponents.textContent = components;
    if (els.orphanBadge) els.orphanBadge.classList.add('hidden');
  }

  function initGraphControls() {
    initOrphanToggle();
    initFocusReset();
    initGraphSearch();
  }

  function initOrphanToggle() {
    if (els.orphanToggle) els.orphanToggle.style.display = 'none';
    if (els.orphanBadge) els.orphanBadge.classList.add('hidden');
  }

  function initFocusReset() {
    const btn = els.focusResetBtn;
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!cy) return;
      if (els.graphSearch) {
        els.graphSearch.value = '';
        searchGraph('');
      }
      cy.fit(50);
    });
  }

  function initGraphSearch() {
    const input = els.graphSearch;
    if (!input) return;
    let debounceTimer;
    input.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => searchGraph(e.target.value.trim()), 150);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        searchGraph('');
        input.blur();
      }
    });
  }

  function searchGraph(query) {
    if (!cy) return;
    cy.nodes().removeClass('match dimmed');
    cy.edges().removeClass('dimmed');

    if (!query) {
      cy.elements().removeClass('dimmed');
      cy.fit(50);
      return;
    }

    const lower = query.toLowerCase();
    const matches = cy.nodes().filter(n => {
      const label = (n.data('fullLabel') || n.data('label') || '').toLowerCase();
      return label.includes(lower);
    });

    if (matches.length === 0) return;

    cy.elements().addClass('dimmed');
    matches.removeClass('dimmed').addClass('match');
    cy.fit(matches, 80);
  }

  function updateTooltipPosition(e) {
    if (!els.graphTooltip) return;
    const evt = e.originalEvent;
    const tooltipWidth = els.graphTooltip.offsetWidth || 200;
    const tooltipHeight = els.graphTooltip.offsetHeight || 40;
    const padding = 14;

    let left = evt.clientX + padding;
    let top = evt.clientY - tooltipHeight - padding;

    if (left + tooltipWidth > window.innerWidth) {
      left = evt.clientX - tooltipWidth - padding;
    }
    if (top < 0) {
      top = evt.clientY + padding;
    }
    if (left < 0) left = padding;

    els.graphTooltip.style.left = left + 'px';
    els.graphTooltip.style.top = top + 'px';
  }

  const treeItemMap = new WeakMap();

  async function loadFiles(repoUrl) {
    if (!repoUrl || !els.filesTree) return;

    let data = graphData;
    if (!data || currentRepo !== repoUrl) {
      els.filesTree.innerHTML = '<div class="empty-state"><div class="empty-ascii" aria-hidden="true">\u23F3</div><p>Loading files\u2026</p></div>';
      try {
        const response = await fetchWithTimeout(
          `${API_BASE}/api/graph?repoUrl=${encodeURIComponent(repoUrl)}`
        );
        data = await response.json();
        graphData = data;
      } catch (err) {
        els.filesTree.innerHTML = `<div class="empty-state"><div class="empty-ascii" aria-hidden="true">\u2716</div><p>Error: ${escapeHtml(err.message)}</p></div>`;
        return;
      }
    }

    const files = data.nodes.filter(n => n.node_type === 'file');
    allFileNodes = files;

    if (els.fileCountBadge) els.fileCountBadge.textContent = files.length;

    if (files.length === 0) {
      els.filesTree.innerHTML = '<div class="empty-state"><div class="empty-ascii" aria-hidden="true">\u{1F4C1}</div><p>No files found</p></div>';
      return;
    }

    treeRootData = buildTree(files);
    els.filesTree.innerHTML = '';
    renderTree(treeRootData, els.filesTree);
  }

  function buildTree(files) {
    const root = {};
    files.forEach(file => {
      const path = file.metadata?.path || file.label;
      const parts = path.split('/').filter(Boolean);
      let current = root;
      parts.forEach((part, i) => {
        if (i === parts.length - 1) {
          current[part] = { type: 'file', node: file, name: part };
        } else {
          if (!current[part]) current[part] = { type: 'folder', children: {}, name: part, expanded: true };
          current = current[part].children;
        }
      });
    });
    return root;
  }

  function renderTree(tree, container, level = 0) {
    const ul = document.createElement('ul');
    ul.className = 'tree-list';
    ul.setAttribute('role', level > 0 ? 'group' : 'tree');
    if (level > 0) ul.classList.add('tree-children');

    const entries = Object.entries(tree).sort((a, b) => {
      const aIsFolder = a[1].type === 'folder';
      const bIsFolder = b[1].type === 'folder';
      if (aIsFolder && !bIsFolder) return -1;
      if (!aIsFolder && bIsFolder) return 1;
      return a[0].localeCompare(b[0]);
    });

    entries.forEach(([name, item]) => {
      const li = document.createElement('li');
      li.className = 'tree-item';
      li.setAttribute('role', 'treeitem');
      if (item.type === 'folder') {
        li.setAttribute('aria-expanded', item.expanded ? 'true' : 'false');
      }
      treeItemMap.set(li, item);

      if (item.type === 'folder') {
        const folderEl = document.createElement('div');
        folderEl.className = 'tree-folder';
        folderEl.setAttribute('tabindex', level === 0 && entries[0] === entries[0] ? '0' : '-1');
        folderEl.setAttribute('aria-expanded', item.expanded ? 'true' : 'false');
        folderEl.innerHTML = `<span class="tree-chevron" aria-hidden="true">${item.expanded ? '\u25BC' : '\u25B6'}</span><span class="tree-icon" aria-hidden="true">${item.expanded ? '\u{1F4C2}' : '\u{1F4C1}'}</span><span class="tree-label">${escapeHtml(name)}</span>`;

        folderEl.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleFolder(folderEl, item, li);
        });
        folderEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleFolder(folderEl, item, li);
          }
        });
        li.appendChild(folderEl);

        const childrenContainer = document.createElement('div');
        if (!item.expanded) childrenContainer.style.display = 'none';
        renderTree(item.children, childrenContainer, level + 1);
        li.appendChild(childrenContainer);
      } else {
        const fileEl = document.createElement('div');
        fileEl.className = 'tree-file';
        fileEl.setAttribute('tabindex', '-1');
        fileEl.setAttribute('data-file-id', item.node.id);
        const ext = name.split('.').pop();
        const icon = getFileIcon(ext);
        fileEl.innerHTML = `<span class="tree-icon" aria-hidden="true">${icon}</span><span class="tree-label">${escapeHtml(name)}</span>`;

        fileEl.addEventListener('click', (e) => {
          e.stopPropagation();
          openFile(item.node);
        });
        fileEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openFile(item.node);
          }
        });
        li.appendChild(fileEl);
      }

      ul.appendChild(li);
    });

    container.appendChild(ul);

    if (level === 0) {
      initTreeKeyboardNav(container);
    }
  }

  function toggleFolder(folderEl, item, li) {
    item.expanded = !item.expanded;
    const chevron = folderEl.querySelector('.tree-chevron');
    const icon = folderEl.querySelector('.tree-icon');
    const children = folderEl.nextElementSibling;
    if (item.expanded) {
      chevron.textContent = '\u25BC';
      icon.textContent = '\u{1F4C2}';
      if (children) children.style.display = 'block';
      folderEl.setAttribute('aria-expanded', 'true');
      li.setAttribute('aria-expanded', 'true');
    } else {
      chevron.textContent = '\u25B6';
      icon.textContent = '\u{1F4C1}';
      if (children) children.style.display = 'none';
      folderEl.setAttribute('aria-expanded', 'false');
      li.setAttribute('aria-expanded', 'false');
    }
  }

  function initTreeKeyboardNav(container) {
    const getFocusables = () => Array.from(container.querySelectorAll('.tree-folder, .tree-file'));

    const focusAt = (items, index) => {
      if (index < 0) index = items.length - 1;
      if (index >= items.length) index = 0;
      items.forEach(el => el.setAttribute('tabindex', '-1'));
      const target = items[index];
      if (target) {
        target.setAttribute('tabindex', '0');
        target.focus();
      }
    };

    container.addEventListener('keydown', (e) => {
      const items = getFocusables();
      const current = document.activeElement;
      let idx = items.indexOf(current);
      if (idx === -1) return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          focusAt(items, idx + 1);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          focusAt(items, idx - 1);
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          if (current.classList.contains('tree-folder')) {
            const li = current.closest('.tree-item');
            const item = treeItemMap.get(li);
            if (item && !item.expanded) {
              toggleFolder(current, item, li);
            }
          } else if (current.classList.contains('tree-file')) {
            current.click();
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (current.classList.contains('tree-folder')) {
            const li = current.closest('.tree-item');
            const item = treeItemMap.get(li);
            if (item && item.expanded) {
              toggleFolder(current, item, li);
            } else {
              const parentLi = li.parentElement?.closest('.tree-item');
              const parentFolder = parentLi?.querySelector('.tree-folder');
              const pIdx = parentFolder ? items.indexOf(parentFolder) : -1;
              if (pIdx !== -1) focusAt(items, pIdx);
            }
          } else if (current.classList.contains('tree-file')) {
            const parentLi = current.closest('.tree-item').parentElement?.closest('.tree-item');
            const parentFolder = parentLi?.querySelector('.tree-folder');
            const pIdx = parentFolder ? items.indexOf(parentFolder) : -1;
            if (pIdx !== -1) focusAt(items, pIdx);
          }
          break;
        }
        case 'Home': {
          e.preventDefault();
          focusAt(items, 0);
          break;
        }
        case 'End': {
          e.preventDefault();
          focusAt(items, items.length - 1);
          break;
        }
      }
    });
  }

  function updateTreeActiveState() {
    document.querySelectorAll('.tree-file').forEach(el => {
      el.classList.toggle('active', el.dataset.fileId === activeFileId);
    });
  }

  function initFileControls() {
    if (els.fileSearch) {
      let debounceTimer;
      els.fileSearch.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => filterTree(e.target.value.trim().toLowerCase()), 100);
      });
      els.fileSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          els.fileSearch.value = '';
          filterTree('');
          els.fileSearch.blur();
        }
      });
    }
    if (els.expandAllBtn) {
      els.expandAllBtn.addEventListener('click', () => {
        setAllFolders(true);
      });
    }
    if (els.collapseAllBtn) {
      els.collapseAllBtn.addEventListener('click', () => {
        setAllFolders(false);
      });
    }
  }

  function filterTree(query) {
    treeFilterQuery = query;
    if (!treeRootData || !els.filesTree) return;
    els.filesTree.innerHTML = '';
    if (query) {
      const filtered = filterTreeData(treeRootData, query);
      renderTree(filtered, els.filesTree);
    } else {
      renderTree(treeRootData, els.filesTree);
    }
  }

  function filterTreeData(tree, query) {
    const result = {};
    Object.entries(tree).forEach(([name, item]) => {
      if (item.type === 'folder') {
        const children = filterTreeData(item.children, query);
        if (Object.keys(children).length > 0 || name.toLowerCase().includes(query)) {
          result[name] = { ...item, children, expanded: true };
        }
      } else {
        if (name.toLowerCase().includes(query)) {
          result[name] = item;
        }
      }
    });
    return result;
  }

  function setAllFolders(expanded) {
    function walk(item) {
      if (item.type === 'folder') {
        item.expanded = expanded;
        Object.values(item.children).forEach(walk);
      }
    }
    if (treeRootData) {
      Object.values(treeRootData).forEach(walk);
      filterTree(treeFilterQuery);
    }
  }

  function openFile(fileNode) {
    const fileId = fileNode.id;
    const existing = openFiles.find(f => f.id === fileId);
    if (!existing) {
      if (openFiles.length >= MAX_TABS) openFiles.shift();
      openFiles.push(fileNode);
    }
    activeFileId = fileId;
    renderTabs();
    renderEditor();
    fetchAndShowFile(fileNode);
    updateTreeActiveState();
  }

  function closeTab(fileId) {
    openFiles = openFiles.filter(f => f.id !== fileId);
    if (activeFileId === fileId) {
      activeFileId = openFiles.length > 0 ? openFiles[openFiles.length - 1].id : null;
    }
    renderTabs();
    renderEditor();
    updateTreeActiveState();
  }

  function activateTab(fileId) {
    activeFileId = fileId;
    renderTabs();
    renderEditor();
    updateTreeActiveState();
  }

  function renderTabs() {
    if (!els.editorTabs) return;
    els.editorTabs.innerHTML = '';
    if (openFiles.length === 0) {
      els.editorTabs.style.display = 'none';
      return;
    }
    els.editorTabs.style.display = 'flex';

    openFiles.forEach((file, index) => {
      const tab = document.createElement('div');
      tab.className = `editor-tab ${file.id === activeFileId ? 'active' : ''}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', file.id === activeFileId ? 'true' : 'false');
      tab.setAttribute('tabindex', file.id === activeFileId ? '0' : '-1');

      const ext = file.label.split('.').pop();
      const icon = getFileIcon(ext);
      const path = file.metadata?.path || file.label;
      const displayName = file.label.length > TAB_TRUNCATE_LEN
        ? file.label.substring(0, TAB_TRUNCATE_LEN) + '\u2026'
        : file.label;

      const iconSpan = document.createElement('span');
      iconSpan.className = 'tab-icon';
      iconSpan.setAttribute('aria-hidden', 'true');
      iconSpan.textContent = icon;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tab-name';
      nameSpan.textContent = displayName;
      nameSpan.title = file.label;

      const pathSpan = document.createElement('span');
      pathSpan.className = 'tab-path';
      pathSpan.textContent = path;
      pathSpan.title = path;

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tab-close';
      closeBtn.setAttribute('aria-label', `Close ${file.label}`);
      closeBtn.textContent = '\u00D7';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(file.id);
      });

      tab.appendChild(iconSpan);
      tab.appendChild(nameSpan);
      if (path !== file.label) tab.appendChild(pathSpan);
      tab.appendChild(closeBtn);

      tab.addEventListener('click', () => activateTab(file.id));
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          const next = els.editorTabs.children[index + 1];
          if (next) next.focus();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const prev = els.editorTabs.children[index - 1];
          if (prev) prev.focus();
        }
      });

      els.editorTabs.appendChild(tab);
    });
  }

  async function fetchAndShowFile(fileNode) {
    if (fileContents[fileNode.id] !== undefined) {
      renderEditor();
      return;
    }
    renderEditorLoading();

    const repoInfo = parseRepoUrl(currentRepo);
    const path = fileNode.metadata?.path || fileNode.label;

    if (repoInfo) {
      const content = await fetchFileContent(repoInfo.owner, repoInfo.repo, path);
      if (content !== null) {
        fileContents[fileNode.id] = content;
        renderEditor();
        return;
      }
    }

    fileContents[fileNode.id] = null;
    renderEditor();
  }

  function renderEditorLoading() {
    if (!els.editorContent) return;
    els.editorContent.innerHTML = `
      <div class="editor-empty">
        <div class="empty-ascii" aria-hidden="true">\u23F3</div>
        <p>Loading file\u2026</p>
      </div>
    `;
  }

  function renderEditor() {
    if (!els.editorContent) return;
    if (!activeFileId || openFiles.length === 0) {
      els.editorContent.innerHTML = `
        <div class="editor-empty">
          <div class="empty-ascii" aria-hidden="true">\u{1F4C1}</div>
          <p>Select a file from the tree to view</p>
        </div>
      `;
      return;
    }

    const file = openFiles.find(f => f.id === activeFileId);
    if (!file) return;

    const content = fileContents[file.id];
    const ext = file.label.split('.').pop();
    const lang = getLangFromExt(ext);

    if (content !== undefined && content !== null) {
      const normalized = normalizeLineEndings(content);
      const lines = normalized.split('\n');
      const lineNumbersHtml = lines.map((_, i) => `<span class="line-num">${i + 1}</span>`).join('\n');
      const codeLinesHtml = lines.map(line => {
        const highlighted = highlightCodeLine(line, lang);
        return `<div class="code-line">${highlighted || ' '}</div>`;
      }).join('');

      els.editorContent.innerHTML = `
        <div class="code-viewer">
          <div class="line-numbers" aria-hidden="true">${lineNumbersHtml}</div>
          <div class="code-area"><pre><code>${codeLinesHtml}</code></pre></div>
        </div>
      `;
    } else {
      const size = file.metadata?.size ? formatBytes(file.metadata.size) : 'Unknown';
      const path = file.metadata?.path || file.label;
      const repoInfo = parseRepoUrl(currentRepo);

      els.editorContent.innerHTML = `
        <div class="editor-meta">
          <div class="meta-header">
            <span class="meta-icon" aria-hidden="true">${getFileIcon(ext)}</span>
            <h3>${escapeHtml(file.label)}</h3>
          </div>
          <div class="meta-grid">
            <div class="meta-card"><label>Type</label><span>${ext.toUpperCase()}</span></div>
            <div class="meta-card"><label>Size</label><span>${escapeHtml(size)}</span></div>
            <div class="meta-card"><label>Path</label><span>${escapeHtml(path)}</span></div>
          </div>
          ${repoInfo ? `
          <div class="meta-grid" style="margin-top:10px">
            <div class="meta-card"><label>Branch</label><span>main / master</span></div>
            <div class="meta-card"><label>Owner</label><span>${escapeHtml(repoInfo.owner)}</span></div>
          </div>
          ` : ''}
          <button type="button" class="ask-ai-btn" id="askAIFileBtn">
             Ask AI what this file does
          </button>
        </div>
      `;

      const askBtn = document.getElementById('askAIFileBtn');
      if (askBtn) {
        askBtn.addEventListener('click', () => askAIAboutFile(file.label));
      }
    }
  }

  async function fetchFileContent(owner, repo, path) {
    const branches = ['main', 'master', 'develop', 'dev'];
    const fetchers = branches.map(branch => {
      const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${encodeURIComponent(path)}`;
      return fetchWithTimeout(url, { timeout: 10000 })
        .then(async res => {
          if (!res.ok) throw new Error('not ok');
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('text/html')) throw new Error('html');
          const text = await res.text();
          const trimmed = text.trim();
          if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) throw new Error('html');
          if (text.includes('\0')) throw new Error('binary');
          return text;
        });
    });

    try {
      return await Promise.any(fetchers);
    } catch {
      return null;
    }
  }

  function highlightCodeLine(line, lang) {
    let html = escapeHtml(line);
    if (!html) return html;

    if (lang === 'js' || lang === 'ts') {
      html = html.replace(/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|import|export|from|default|class|extends|super|new|this|typeof|instanceof|in|of|try|catch|finally|throw|async|await|yield|void|delete|true|false|null|undefined)\b/g, '<span class="token-keyword">$1</span>');
      html = html.replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, '<span class="token-string">$&</span>');
      html = html.replace(/(\/\/.*)/g, '<span class="token-comment">$1</span>');
      html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-number">$1</span>');
      html = html.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/g, '<span class="token-function">$1</span>');
    } else if (lang === 'py') {
      html = html.replace(/\b(def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|raise|pass|break|continue|lambda|yield|assert|del|global|nonlocal|True|False|None|and|or|not|in|is)\b/g, '<span class="token-keyword">$1</span>');
      html = html.replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, '<span class="token-string">$&</span>');
      html = html.replace(/(#.*)/g, '<span class="token-comment">$1</span>');
      html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-number">$1</span>');
      html = html.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)(?=\s*\()/g, '<span class="token-function">$1</span>');
    } else if (lang === 'html' || lang === 'xml') {
      html = html.replace(/(&lt;\/?[a-zA-Z0-9-]+)/g, '<span class="token-tag">$1</span>');
      html = html.replace(/([a-zA-Z-]+)=(&quot;.*?&quot;)/g, '<span class="token-attr">$1</span>=<span class="token-string">$2</span>');
      html = html.replace(/(&lt;!--.*--&gt;)/g, '<span class="token-comment">$1</span>');
    } else if (lang === 'css' || lang === 'scss') {
      html = html.replace(/(\/\*.*?\*\/)/g, '<span class="token-comment">$1</span>');
      html = html.replace(/([a-zA-Z-]+)\s*:/g, '<span class="token-property">$1</span>:');
      html = html.replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, '<span class="token-string">$&</span>');
    } else if (lang === 'json') {
      html = html.replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span class="token-property">$1</span>:');
      html = html.replace(/:(\s*)("(?:[^"\\]|\\.)*")/g, ':$1<span class="token-string">$2</span>');
      html = html.replace(/\b(true|false|null)\b/g, '<span class="token-keyword">$1</span>');
      html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-number">$1</span>');
    }

    return html;
  }

})();