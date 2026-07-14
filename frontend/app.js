const API_BASE = 'http://127.0.0.1:8787';

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
  tabs: document.querySelectorAll('.tab'),
  tabContents: document.querySelectorAll('.tab-content'),
  graphViz: document.getElementById('graphViz'),
  filesList: document.getElementById('filesList'),
  nodeDetails: document.getElementById('nodeDetails'),
  nodeJson: document.getElementById('nodeJson'),
};

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initHints();
  initSuggestions();
  initIngest();
  initChat();
});

function initTabs() {
  els.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      els.tabs.forEach(t => t.classList.remove('active'));
      els.tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${target}Tab`).classList.add('active');
      if (target === 'graph' && currentRepo) loadGraph(currentRepo);
      if (target === 'files' && currentRepo) loadFiles(currentRepo);
    });
  });
}

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
  showStatus('🔍 Fetching repository data... This may take 1-2 minutes.', 'info');

  try {
    const response = await fetch(`${API_BASE}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl }),
    });
    const data = await response.json();
    if (data.success) {
      currentRepo = repoUrl;
      showStatus(`✅ Graph built! ${data.nodes} nodes, ${data.edges} edges, ${data.documents} docs in ${data.duration}s`, 'success');
      enableChat();
      loadGraph(repoUrl);
      loadFiles(repoUrl);
    } else if (data.status === 'already_exists') {
      currentRepo = repoUrl;
      showStatus(`ℹ️ Repo already ingested. ${data.nodeCount} nodes, ${data.docCount} docs.`, 'info');
      enableChat();
    } else {
      showStatus(`❌ Error: ${data.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    showStatus(`❌ Network error: ${err.message}`, 'error');
  } finally {
    isIngesting = false;
    setIngestLoading(false);
  }
}

function setIngestLoading(loading) {
  els.ingestBtn.disabled = loading;
  els.ingestBtn.innerHTML = loading
    ? '<span class="btn-icon">⏳</span><span class="btn-text">Building...</span>'
    : '<span class="btn-icon">🔍</span><span class="btn-text">Build Graph</span>';
}

function showStatus(message, type) {
  els.ingestStatus.textContent = message;
  els.ingestStatus.className = `status ${type}`;
  els.ingestStatus.classList.remove('hidden');
}

function enableChat() {
  els.chatInput.disabled = false;
  els.sendBtn.disabled = false;
  els.chatInput.placeholder = `Ask about ${currentRepo.split('/').pop()}...`;
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
    assistantMsg.textContent = `❌ Error: ${err.message}. Make sure the backend is running.`;
    assistantMsg.classList.remove('streaming');
  }
}

function addMessage(role, text, streaming = false) {
  const welcome = els.chatMessages.querySelector('.welcome-message');
  if (welcome) welcome.remove();
  const msg = document.createElement('div');
  msg.className = `message ${role}${streaming ? ' streaming' : ''}`;
  const header = document.createElement('div');
  header.className = 'message-header';
  header.textContent = role === 'user' ? 'You' : '🧠 Cognex';
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
  els.graphViz.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading graph...</p></div>';
  try {
    const response = await fetch(`${API_BASE}/api/graph?repoUrl=${encodeURIComponent(repoUrl)}`);
    const data = await response.json();
    if (data.nodes.length === 0) {
      els.graphViz.innerHTML = '<div class="empty-state"><div class="empty-icon">🕸️</div><p>No graph data yet</p></div>';
      return;
    }
    renderCytoscape(data.nodes, data.edges);
  } catch (err) {
    els.graphViz.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Error: ${err.message}</p></div>`;
  }
}

function renderCytoscape(nodes, edges) {
  const colorMap = {
    file: '#6366f1', function: '#8b5cf6', contributor: '#22c55e',
    issue: '#ef4444', pr: '#f59e0b', commit: '#3b82f6',
    dependency: '#ec4899', repo: '#f97316', readme: '#14b8a6',
  };
  const cyNodes = nodes.map(n => ({
    data: {
      id: n.id,
      label: n.label.length > 30 ? n.label.substring(0, 30) + '...' : n.label,
      fullLabel: n.label,
      type: n.node_type,
      ...n.metadata,
    },
    style: { 'background-color': colorMap[n.node_type] || '#6b7280' },
  }));
  const cyEdges = edges.map(e => ({
    data: {
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      label: e.relation,
    },
  }));
  if (cy) cy.destroy();
  cy = cytoscape({
    container: els.graphViz,
    elements: [...cyNodes, ...cyEdges],
    style: [
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'width': 40,
          'height': 40,
          'font-size': '10px',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'color': '#a0a0b8',
          'text-background-color': '#0a0a0f',
          'text-background-opacity': 0.8,
          'text-background-padding': '2px',
          'border-width': 2,
          'border-color': '#2a2a4a',
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 1,
          'line-color': '#3a3a6a',
          'target-arrow-color': '#3a3a6a',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'label': 'data(label)',
          'font-size': '8px',
          'color': '#6a6a8a',
          'text-rotation': 'autorotate',
        },
      },
      {
        selector: ':selected',
        style: {
          'border-width': 3,
          'border-color': '#6366f1',
        },
      },
    ],
    layout: {
      name: 'cose',
      padding: 20,
      animate: true,
      animationDuration: 500,
      componentSpacing: 80,
      nodeRepulsion: 400000,
      idealEdgeLength: 100,
    },
    minZoom: 0.2,
    maxZoom: 3,
  });
  cy.on('tap', 'node', (evt) => {
    const node = evt.target;
    const data = node.data();
    els.nodeDetails.classList.remove('hidden');
    els.nodeJson.textContent = JSON.stringify({
      id: data.id,
      type: data.type,
      label: data.fullLabel,
      ...Object.fromEntries(
        Object.entries(data).filter(([k]) => !['id', 'label', 'fullLabel', 'type'].includes(k))
      ),
    }, null, 2);
  });
  cy.on('tap', (evt) => {
    if (evt.target === cy) els.nodeDetails.classList.add('hidden');
  });
}

async function loadFiles(repoUrl) {
  if (!repoUrl) return;
  els.filesList.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading files...</p></div>';
  try {
    const response = await fetch(`${API_BASE}/api/graph?repoUrl=${encodeURIComponent(repoUrl)}`);
    const data = await response.json();
    const files = data.nodes.filter(n => n.node_type === 'file');
    if (files.length === 0) {
      els.filesList.innerHTML = '<div class="empty-state"><div class="empty-icon">📁</div><p>No files found</p></div>';
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
    els.filesList.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Error: ${err.message}</p></div>`;
  }
}

function getFileIcon(ext) {
  const icons = {
    js: '📜', ts: '📘', jsx: '⚛️', tsx: '⚛️',
    py: '🐍', go: '🔵', rs: '⚙️', java: '☕',
    json: '📋', md: '📝', yml: '⚙️', yaml: '⚙️',
    html: '🌐', css: '🎨', svg: '🖼️',
  };
  return icons[ext] || '📄';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}