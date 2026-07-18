const API_BASE = 'https://cognex-worker.parthanahalli-rehaan.workers.dev';

let currentRepo = null;
let isIngesting = false;
let cy = null;

const els = {
  repoUrl: document.getElementById('repoUrl'),
  ingestBtn: document.getElementById('ingestBtn'),
  ingestStatus: document.getElementById('ingestStatus'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  chatMessages: document.getElementById('chatMessages'),
  graphViz: document.getElementById('graphViz'),
  filesList: document.getElementById('filesList'),
};

document.addEventListener('DOMContentLoaded', () => {
  initHints();
  initSuggestions();
  initIngest();
  initChat();
});

function initHints() {
  document.querySelectorAll('.hint-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els.repoUrl.value = btn.dataset.repo;
    });
  });
}

function initSuggestions() {
  document.querySelectorAll('.suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!els.chatInput.disabled) {
        els.chatInput.value = btn.dataset.q;
        sendMessage();
      }
    });
  });
}

function initIngest() {
  els.ingestBtn.addEventListener('click', ingestRepo);
  els.repoUrl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') ingestRepo();
  });
}

async function ingestRepo() {
  const repoUrl = els.repoUrl.value.trim();
  if (!repoUrl || !repoUrl.includes('github.com')) {
    showStatus('Please enter a valid GitHub URL', 'error');
    return;
  }
  if (isIngesting) return;
  isIngesting = true;
  setIngestLoading(true);
  showStatus('⚡ FETCHING REPOSITORY DATA... HOLD TIGHT.', 'info');

  try {
    const response = await fetch(`${API_BASE}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl }),
    });
    const data = await response.json();

    if (data.success && data.status !== 'accepted') {
      currentRepo = repoUrl;
      showStatus(`✅ GRAPH BUILT — ${data.nodes} NODES · ${data.edges} EDGES · ${data.documents} DOCS · ${data.duration}S`, 'success');
      enableChat();
      loadGraph(repoUrl);
      loadFiles(repoUrl);
    } else if (data.status === 'accepted') {
      currentRepo = repoUrl;
      showStatus('⏳ INGESTION ACCEPTED. POLLING STATUS...', 'info');
      enableChat();
      pollStatus(repoUrl);
    } else if (data.status === 'already_exists') {
      currentRepo = repoUrl;
      showStatus(`ℹ️ REPO ALREADY INGESTED — ${data.nodeCount} NODES · ${data.docCount} DOCS`, 'info');
      enableChat();
      loadGraph(repoUrl);
      loadFiles(repoUrl);
    } else {
      showStatus(`❌ ERROR: ${data.error || 'UNKNOWN ERROR'}`, 'error');
    }
  } catch (err) {
    showStatus(`❌ NETWORK ERROR: ${err.message}`, 'error');
  } finally {
    isIngesting = false;
    setIngestLoading(false);
  }
}

function pollStatus(repoUrl) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/status?repoUrl=${encodeURIComponent(repoUrl)}`);
      const data = await res.json();
      if (data.status === 'done') {
        clearInterval(interval);
        showStatus(`✅ INGESTION COMPLETE — ${data.nodeCount} NODES · ${data.docCount} DOCS`, 'success');
        loadGraph(repoUrl);
        loadFiles(repoUrl);
      } else if (data.status === 'error') {
        clearInterval(interval);
        showStatus(`❌ INGESTION FAILED: ${data.message}`, 'error');
      } else {
        showStatus(`⏳ PROCESSING... ${data.progress || 0}% — ${data.message || ''}`, 'info');
      }
    } catch (err) {
      clearInterval(interval);
    }
  }, 2000);
}

function setIngestLoading(loading) {
  els.ingestBtn.disabled = loading;
  els.ingestBtn.innerHTML = loading
    ? '<span class="btn-icon">⏳</span><span class="btn-text">BUILDING...</span>'
    : '<span class="btn-icon">⚡</span><span class="btn-text">BUILD GRAPH</span>';
}

function showStatus(message, type) {
  els.ingestStatus.textContent = message;
  els.ingestStatus.className = `status ${type}`;
  els.ingestStatus.classList.remove('hidden');
}

function enableChat() {
  els.chatInput.disabled = false;
  els.sendBtn.disabled = false;
  els.chatInput.placeholder = `> Ask about ${currentRepo.split('/').pop()}...`;
  els.chatInput.focus();
}

function initChat() {
  els.sendBtn.addEventListener('click', sendMessage);
  els.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

async function sendMessage() {
  const query = els.chatInput.value.trim();
  if (!query || !currentRepo) return;
  addMessage('user', query);
  els.chatInput.value = '';
  const assistantMsg = addMessage('assistant', '', true);

  try {
    const response = await fetch(`${API_BASE}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: currentRepo, query }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      assistantMsg.textContent = fullText;
      scrollToBottom();
    }
    assistantMsg.classList.remove('streaming');
  } catch (err) {
    assistantMsg.textContent = `❌ ERROR: ${err.message}. MAKE SURE THE BACKEND IS RUNNING.`;
    assistantMsg.classList.remove('streaming');
  }
}

function addMessage(role, text, streaming = false) {
  const welcome = els.chatMessages.querySelector('.welcome');
  if (welcome) welcome.remove();
  const msg = document.createElement('div');
  msg.className = `message ${role}${streaming ? ' streaming' : ''}`;
  const header = document.createElement('div');
  header.className = 'message-header';
  header.textContent = role === 'user' ? 'YOU' : 'COGNEX';
  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = text;
  msg.appendChild(header);
  msg.appendChild(content);
  els.chatMessages.appendChild(msg);
  scrollToBottom();
  return content;
}

function scrollToBottom() {
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

async function loadGraph(repoUrl) {
  if (!repoUrl) return;
  els.graphViz.innerHTML = '<div class="empty-state"><div class="empty-ascii">⏳</div><p>LOADING GRAPH...</p></div>';
  try {
    const response = await fetch(`${API_BASE}/api/graph?repoUrl=${encodeURIComponent(repoUrl)}`);
    const data = await response.json();
    console.log('[GRAPH] response:', data);

    if (!data.nodes || data.nodes.length === 0) {
      els.graphViz.innerHTML = '<div class="empty-state"><div class="empty-ascii">┌─┐<br>│ │<br>└─┘</div><p>NO GRAPH DATA</p></div>';
      return;
    }
    renderCytoscape(data.nodes, data.edges);
  } catch (err) {
    console.error('[GRAPH] error:', err);
    els.graphViz.innerHTML = `<div class="empty-state"><div class="empty-ascii">✖</div><p>ERROR: ${err.message}</p></div>`;
  }
}

function renderCytoscape(nodes, edges) {
  // FIX: remove loading spinner only, don't clear entire container
  const emptyState = els.graphViz.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // FIX: force height if flex collapsed the empty container
  if (els.graphViz.clientHeight < 100) {
    els.graphViz.style.height = '300px';
  }

  if (cy) {
    try { cy.destroy(); } catch (e) { /* ignore */ }
  }

  const colorMap = {
    file: '#0a0a0a', function: '#333333', contributor: '#c8ff00',
    issue: '#0a0a0a', pr: '#c8ff00', commit: '#555555',
    dependency: '#0a0a0a', repo: '#c8ff00', readme: '#0a0a0a',
  };
  const borderMap = {
    contributor: '#0a0a0a', pr: '#0a0a0a', repo: '#0a0a0a',
  };

  const cyNodes = nodes.map(n => ({
    data: {
      id: n.id,
      label: n.label.length > 24 ? n.label.substring(0, 24) + '...' : n.label,
      fullLabel: n.label,
      type: n.node_type,
      ...n.metadata,
    },
    style: {
      'background-color': colorMap[n.node_type] || '#0a0a0a',
      'border-color': borderMap[n.node_type] || '#c8ff00',
      'border-width': 2,
      'color': ['contributor', 'pr', 'repo'].includes(n.node_type) ? '#0a0a0a' : '#ffffff',
    },
  }));

  const cyEdges = edges.map(e => ({
    data: {
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      label: e.relation,
    },
  }));

  try {
    cy = cytoscape({
      container: els.graphViz,
      elements: [...cyNodes, ...cyEdges],
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'width': 36,
            'height': 36,
            'font-size': '9px',
            'font-family': 'Syne Mono, monospace',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-background-color': '#ffffff',
            'text-background-opacity': 0.9,
            'text-background-padding': '2px',
            'text-margin-y': 4,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': '#cccccc',
            'target-arrow-color': '#cccccc',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(label)',
            'font-size': '8px',
            'font-family': 'Syne Mono, monospace',
            'color': '#888888',
            'text-rotation': 'autorotate',
          },
        },
        {
          selector: ':selected',
          style: {
            'border-width': 3,
            'border-color': '#0a0a0a',
            'background-color': '#c8ff00',
          },
        },
      ],
      layout: {
        name: 'cose',
        padding: 16,
        animate: true,
        animationDuration: 400,
        componentSpacing: 60,
        nodeRepulsion: 300000,
        idealEdgeLength: 80,
      },
      minZoom: 0.2,
      maxZoom: 3,
    });

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const data = node.data();
      const detail = JSON.stringify({
        id: data.id,
        type: data.type,
        label: data.fullLabel,
        ...Object.fromEntries(
          Object.entries(data).filter(([k]) => !['id', 'label', 'fullLabel', 'type'].includes(k))
        ),
      }, null, 2);
      addMessage('assistant', `NODE DETAILS:\n${detail}`, false);
    });
  } catch (err) {
    console.error('[CYTOSCAPE] init error:', err);
    els.graphViz.innerHTML = `<div class="empty-state"><div class="empty-ascii">✖</div><p>GRAPH RENDER ERROR: ${err.message}</p></div>`;
  }
}

async function loadFiles(repoUrl) {
  if (!repoUrl) return;
  els.filesList.innerHTML = '<div class="empty-state"><div class="empty-ascii">⏳</div><p>LOADING FILES...</p></div>';
  try {
    const response = await fetch(`${API_BASE}/api/graph?repoUrl=${encodeURIComponent(repoUrl)}`);
    const data = await response.json();
    const files = data.nodes.filter(n => n.node_type === 'file');
    if (files.length === 0) {
      els.filesList.innerHTML = '<div class="empty-state"><div class="empty-ascii">📂</div><p>NO FILES FOUND</p></div>';
      return;
    }
    els.filesList.innerHTML = '';
    files.sort((a, b) => a.label.localeCompare(b.label));
    files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'file-item';
      const icon = getFileIcon(file.metadata?.extension || '');
      const size = file.metadata?.size ? formatBytes(file.metadata.size) : '';
      item.innerHTML = `
        <span class="file-icon">${icon}</span>
        <span class="file-name">${file.label}</span>
        <span class="file-meta">${size}</span>
      `;
      els.filesList.appendChild(item);
    });
  } catch (err) {
    els.filesList.innerHTML = `<div class="empty-state"><div class="empty-ascii">✖</div><p>ERROR: ${err.message}</p></div>`;
  }
}

function getFileIcon(ext) {
  const icons = {
    js: '📜', ts: '📘', jsx: '⚛', tsx: '⚛',
    py: '🐍', go: '🔵', rs: '⚙', java: '☕',
    json: '📋', md: '📝', yml: '⚙', yaml: '⚙',
    html: '🌐', css: '🎨', svg: '🖼',
  };
  return icons[ext] || '📄';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
}