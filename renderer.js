// ═══════════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════════
const { ipcRenderer } = require('electron');
const { exec } = require('child_process');

// ─── State ────────────────────────────────────────────────────
let project = { id: Date.now(), name: 'Untitled Flow', steps: [], edges: [] };
let currentName = 'Untitled Flow';
let workflows = [];
let isDirty = false;  // Track unsaved changes
let selectedIdx = null;     // selected node index
let selectedEdgeId = null;  // selected edge id
let historyStack = [], redoStack = [];

// Canvas interaction state
let tx = 0, ty = 0, sc = 1;   // single transform system
let isPanning = false, panSX = 0, panSY = 0;
let isDraggingNode = false, dragNode = null, dragOX = 0, dragOY = 0;
let isDrawingEdge = false, edgeFromIdx = null;
let snapToGrid = false, miniMapOn = false;
let multiSelect = [];  // array of selected indices
let clipboard = [];

// Execution state
let stopRequested = false;
let execStats = { steps:0, errors:0, retries:0, adb:0, startTime:0, interval:null };
let isFlowRunning = false;  // BUG #1 FIX: Track flow execution state

// Feature: Variables & Interpolation
let varStore = {};  // { varName: value }
let loopStack = [];  // { startId, count, current, varName }
let retryState = {};  // { stepId: { count, maxRetry } }
let pendingWebhookWorkflow = false;
let executionHistory = [];  // { id, date, workflowName, totalSteps, errors, success, duration }

// Feature: Node Grouping
let groups = [];  // { id, name, nodeIds, color, x, y, w, h }

// Feature: Macro Recording
let macroRecording = false;
let macroSteps = [];

// Prefs
let prefs = { lang:'id', autoSave:true, confirmDelete:true, snap:false, showStepNum:true, animate:true, adbPath:'', theme:'dark' };

// ─── Activity Definitions ───────────────────────────────────
const ACTIVITIES = [
  { sec: 'Trigger & Control' },
  { type:'start',           icon:'⚡', label:'Start',          desc:'Titik awal flow',           color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { type:'cron-job',        icon:'⏰', label:'Cron Job',        desc:'Scheduled trigger',         color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'webhook-trigger', icon:'🔗', label:'Webhook',         desc:'HTTP trigger',              color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'event-trigger',   icon:'📡', label:'Event Trigger',   desc:'Event-based start',         color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },
  { type:'file-watcher',    icon:'👀', label:'File Watcher',    desc:'Monitor folder/file',       color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'if-condition',    icon:'❓', label:'If Condition',    desc:'Percabangan logika',        color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'repeat-start',    icon:'🔁', label:'Loop Start',      desc:'Mulai iterasi',             color:'#f97316', bg:'rgba(249,115,22,0.15)' },
  { type:'repeat-end',      icon:'🔚', label:'Loop End',        desc:'Akhir iterasi',             color:'#f97316', bg:'rgba(249,115,22,0.15)' },
  { type:'delay',           icon:'⏱',  label:'Delay',           desc:'Tunggu beberapa ms',        color:'#ec4899', bg:'rgba(236,72,153,0.15)' },

  { sec: 'Browser Automation' },
  { type:'open-browser',    icon:'🌐', label:'Open Browser',    desc:'Buka URL di browser',       color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'tap',             icon:'👆', label:'Click Element',   desc:'Klik element HTML',         color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },
  { type:'type-into',       icon:'⌨️', label:'Type Into',       desc:'Ketik teks ke field',       color:'#14b8a6', bg:'rgba(20,184,166,0.15)' },
  { type:'extract-text',    icon:'📄', label:'Extract Text',    desc:'Ambil teks dari element',   color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'scroll-page',     icon:'📜', label:'Scroll Page',     desc:'Scroll halaman browser',    color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'wait-element',    icon:'⏳', label:'Wait Element',    desc:'Tunggu element muncul',     color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'screenshot-page', icon:'📸', label:'Screenshot Page', desc:'Capture tampilan browser',  color:'#ec4899', bg:'rgba(236,72,153,0.15)' },
  { type:'extract-table',   icon:'📊', label:'Extract Table',   desc:'Scrap tabel HTML',          color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'handle-popup',    icon:'💬', label:'Handle Popup',    desc:'Dismiss/accept popup',       color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'upload-file',     icon:'📤', label:'Upload File',     desc:'Upload file via input',     color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'pagination',      icon:'📑', label:'Pagination',      desc:'Multi-page scraping',       color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'infinite-scroll', icon:'🔄', label:'Infinite Scroll', desc:'Scroll tanpa batas',        color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },

  { sec: 'Mobile (ADB)' },
  { type:'mobile-tap',      icon:'📱', label:'Mobile Tap',      desc:'ADB tap koordinat',         color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'mobile-swipe',    icon:'👆', label:'Mobile Swipe',    desc:'ADB swipe gesture',         color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'mobile-press-key',icon:'⌨️', label:'Press Key',       desc:'ADB input keyevent',        color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'mobile-screenshot',icon:'📸',label:'Mobile Screenshot',desc:'ADB screencap',            color:'#ec4899', bg:'rgba(236,72,153,0.15)' },
  { type:'mobile-find-text',icon:'🔎', label:'Find Text (OCR)', desc:'OCR pada layar HP',         color:'#14b8a6', bg:'rgba(20,184,166,0.15)' },
  { type:'open-app',        icon:'📲', label:'Open App',        desc:'Launch Android app',        color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'close-app',       icon:'❌', label:'Close App',       desc:'Force-stop app',            color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'read-ui-element', icon:'👁️', label:'Read UI Element', desc:'Baca teks dari UI',         color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'swipe',           icon:'👈', label:'Swipe (PC)',      desc:'PC mouse swipe/drag',       color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },

  { sec: 'Data & Files' },
  { type:'read-csv',        icon:'📊', label:'Read CSV',        desc:'Baca file CSV',             color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'write-csv',       icon:'📝', label:'Write CSV',       desc:'Tulis data ke CSV',         color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'write-excel',     icon:'📗', label:'Write Excel',     desc:'Output ke .xlsx',           color:'#16a34a', bg:'rgba(22,163,74,0.15)'  },
  { type:'json-processing', icon:'🔧', label:'JSON Process',    desc:'Parse/transform JSON',      color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'filter-data',     icon:'🔍', label:'Filter Data',     desc:'Filter rows/columns',       color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'batch-slice',     icon:'📦', label:'Batch Slice',     desc:'Potong data per batch',     color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'download-file',   icon:'⬇️', label:'Download File',   desc:'Download dari URL',         color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'file-system',     icon:'📁', label:'File System',     desc:'Copy/move/delete file',     color:'#f97316', bg:'rgba(249,115,22,0.15)' },
  { type:'database-query',  icon:'🗄️', label:'Database Query',  desc:'Query SQL/NoSQL',           color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'regex-extraction',icon:'🔍', label:'Regex Extract',   desc:'Ekstrak dengan regex',      color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'copy-paste-var',  icon:'📋', label:'Copy Variable',   desc:'Salin nilai variabel',      color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },

  { sec: 'Integration' },
  { type:'api-request',     icon:'🌐', label:'API Request',     desc:'HTTP GET/POST/PUT...',      color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'ocr',             icon:'👁️', label:'OCR',             desc:'Baca teks dari gambar',     color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'ai-decision',     icon:'🤖', label:'AI Decision',     desc:'AI classify/respond',       color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { type:'input-dialog',    icon:'💬', label:'Input Dialog',    desc:'Prompt user input',         color:'#f97316', bg:'rgba(249,115,22,0.15)' },

  { sec: 'Advanced' },
  { type:'parallel-start',  icon:'⚡', label:'Parallel Start',  desc:'Mulai paralel execution',   color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { type:'parallel-end',    icon:'🔗', label:'Parallel Join',   desc:'Gabung parallel',           color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { type:'try-catch',       icon:'🛡️', label:'Try-Catch',       desc:'Error handling block',      color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'retry-logic',     icon:'🔄', label:'Retry Logic',     desc:'Auto retry on fail',        color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'sub-workflow',    icon:'📁', label:'Sub Workflow',    desc:'Panggil flow lain',         color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },
  { type:'macro-recorder',  icon:'🎬', label:'Macro Recorder',  desc:'Record actions',            color:'#ec4899', bg:'rgba(236,72,153,0.15)' },
  { type:'debug-step',      icon:'🐛', label:'Debug Step',      desc:'Pause & inspect',           color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'performance-track',icon:'📈',label:'Performance',     desc:'Track execution time',      color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'headless-mode',   icon:'👻', label:'Headless Mode',   desc:'Run tanpa GUI browser',     color:'#475569', bg:'rgba(71,85,105,0.15)'  },
  { type:'credential-manager',icon:'🔐',label:'Credentials',   desc:'Simpan login aman',         color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'auto-selector',   icon:'🎯', label:'Auto Selector',   desc:'AI detect element',         color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
];

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

// ─── Variable Interpolation & Storage ───────────────────────
// BUG #2 FIX: Support both {{variableName}} and {variableName} syntax
function interpolate(str) {
  if (!str) return str;
  const strVal = String(str);
  
  // First, resolve {{variableName}} (double braces - user expected format)
  let result = strVal.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = varStore[key];
    return value !== undefined ? value : '{{' + key + '}}';
  });
  
  // Then, resolve {variableName} (single braces - legacy format)
  result = result.replace(/\{(\w+)\}/g, (_, key) => {
    const value = varStore[key];
    return value !== undefined ? value : '{' + key + '}';
  });
  
  return result;
}

// DEBUG: Log variable resolution
function resolveWithLog(label, str) {
  if (!str) return str;
  const result = interpolate(str);
  if (result !== str) {
    console.log('[VAR RESOLVE] ' + label + ': "' + str + '" → "' + result + '"');
  }
  return result;
}

function storeVar(key, value) {
  if (!key) return;
  varStore[key] = value;
  console.log('[VAR STORE] ' + key + ' = ' + String(value).substring(0, 50));
  updateVarPanel();
}

function updateVarPanel() {
  const el = document.getElementById('var-inspector');
  if (!el) return;
  const entries = Object.entries(varStore);
  if (!entries.length) {
    el.innerHTML = '<div style="color:var(--dim);font-size:11px;padding:10px;text-align:center;">No variables yet</div>';
    return;
  }
  // BUG #2 FIX: Show live updates with proper formatting
  console.log('[VAR PANEL] Updating with ' + entries.length + ' variables:', Object.keys(varStore));
  el.innerHTML = entries.map(([k,v]) =>
    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:6px 0;border-bottom:1px solid var(--border2);">' +
      '<span style="color:#93c5fd;font-weight:600;">{' + k + '}</span>' +
      '<span style="color:var(--dim2);max-width:100px;overflow:hidden;text-overflow:ellipsis;flex:1;text-align:right;">' + String(v).substring(0,40) + '</span>' +
    '</div>'
  ).join('');
}

// ─── Safe Path Helper for Screenshots ──────────────────────
function getSafeSavePath(filename) {
  const path = require('path');
  const fs   = require('fs');
  const os   = require('os');
  
  // Daftar direktori yang aman (tidak ada spasi, karakter khusus)
  const candidates = [
    'C:\\rba_output',
    path.join(os.homedir(), 'AppData', 'Local', 'RBAStudio', 'output'),
    path.join(os.tmpdir(), 'rba_output'),
    os.tmpdir()
  ];
  
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const testPath = path.join(dir, '.test_' + Date.now());
      fs.writeFileSync(testPath, 'ok');
      fs.unlinkSync(testPath);
      const result = path.join(dir, filename);
      return result;
    } catch(e) {
      // Coba direktori berikutnya
    }
  }
  return path.join(os.tmpdir(), filename);
}

// ─── Edge-Following Execution ──────────────────────────────
function getNextStep(currentId, conditionResult = null) {
  const edges = project.edges || [];
  const outEdges = edges.filter(e => e.from === currentId);
  if (!outEdges.length) return null;
  
  if (conditionResult !== null) {
    const trueEdge  = outEdges.find(e => e.label === 'true'  || e.label === 'yes');
    const falseEdge = outEdges.find(e => e.label === 'false' || e.label === 'no');
    if (conditionResult && trueEdge)  return project.steps.find(s => s.id === trueEdge.to);
    if (!conditionResult && falseEdge) return project.steps.find(s => s.id === falseEdge.to);
  }
  return project.steps.find(s => s.id === outEdges[0].to);
}

function focusNodeOnCanvas(stepId) {
  const s = project.steps.find(st => st.id === stepId);
  if (!s) return;
  const canvasEl = document.getElementById('canvas');
  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  tx = rect.width/2  - (s.x + 100) * sc;
  ty = rect.height/2 - (s.y + 30)  * sc;
  applyTransform();
}

// ─── Node Grouping ─────────────────────────────────────────
function groupSelected() {
  if (multiSelect.length < 2) { addLog('Pilih minimal 2 node untuk group', 'warn'); return; }
  const name = prompt('Nama group:', 'Group 1');
  if (!name) return;
  pushHistory();
  const nodes = multiSelect.map(i => project.steps[i]);
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const group = {
    id: 'g-' + Date.now(),
    name,
    nodeIds: nodes.map(n => n.id),
    color: '#3b82f6',
    x: Math.min(...xs) - 20,
    y: Math.min(...ys) - 30,
    w: Math.max(...xs) + 220 - Math.min(...xs) + 20,
    h: Math.max(...ys) + 80 - Math.min(...ys) + 30
  };
  groups.push(group);
  render();
  addLog('Grouped ' + nodes.length + ' nodes: "' + name + '"', 'info');
}

// ─── Node Search & Jump ────────────────────────────────────
function searchNodes(q) {
  if (!q) { render(); return; }
  const lower = q.toLowerCase();
  project.steps.forEach((s, i) => {
    const match = s.name.toLowerCase().includes(lower) || s.type.toLowerCase().includes(lower);
    const nodeEl = document.querySelector('.node[data-idx="' + i + '"]');
    if (nodeEl) nodeEl.style.opacity = match ? '1' : '0.2';
    if (match && q.length > 2) {
      const canvasEl = document.getElementById('canvas');
      if (canvasEl) {
        const rect = canvasEl.getBoundingClientRect();
        tx = rect.width/2  - (s.x + 100) * sc;
        ty = rect.height/2 - (s.y + 30)  * sc;
        applyTransform();
      }
    }
  });
}

// ─── Statistics Dashboard ──────────────────────────────────
function updateDashboardStats() {
  const stats = {
    'stat-total-wf': workflows.length,
    'stat-total-runs': executionHistory.length,
    'stat-devices': 0
  };
  
  const successCount = executionHistory.filter(h=>h.success).length;
  const rate = executionHistory.length ? Math.round(successCount/executionHistory.length*100) : 0;
  stats['stat-success-rate'] = rate + '%';
  
  const devSel = document.getElementById('device-selector');
  if (devSel) {
    stats['stat-devices'] = devSel.querySelectorAll('option:not([value="No ADB Device"])').length;
  }
  
  Object.entries(stats).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });
}

// ─── Template Workflows ────────────────────────────────────
const TEMPLATES = {
  'login-auto': {
    name: 'Login Automation',
    steps: [
      { type:'start', name:'Start', id:1 },
      { type:'open-browser', name:'Open Login', url:'https://example.com/login', browser:'chrome', waitAfterLoad:2000, id:2 },
      { type:'type-into', name:'Username', selector:'#username', text:'', clearBefore:'yes', id:3 },
      { type:'type-into', name:'Password', selector:'#password', text:'', clearBefore:'yes', id:4 },
      { type:'tap', name:'Login', selector:'#btn-login', id:5 },
      { type:'screenshot-page', name:'Capture', id:6 }
    ]
  },
  'adb-record': {
    name: 'ADB Screen Record',
    steps: [
      { type:'start', name:'Start', id:1 },
      { type:'mobile-screenshot', name:'Before', screenshotPath:'/sdcard/before.png', id:2 },
      { type:'mobile-tap', name:'Tap', mx:540, my:960, id:3 },
      { type:'delay', name:'Wait', delay:2000, id:4 },
      { type:'mobile-screenshot', name:'After', screenshotPath:'/sdcard/after.png', id:5 }
    ]
  },
  'csv-scrape': {
    name: 'Scrape to CSV',
    steps: [
      { type:'start', name:'Start', id:1 },
      { type:'open-browser', name:'Open', url:'https://example.com', id:2 },
      { type:'extract-table', name:'Extract', selector:'table', var:'data', id:3 },
      { type:'write-csv', name:'Save', filePath:'output.csv', var:'data', id:4 }
    ]
  }
};

function loadTemplate(key) {
  const tpl = TEMPLATES[key];
  if (!tpl) return;
  pushHistory();
  const steps = tpl.steps.map((s, i) => ({
    ...s,
    id: Date.now() + i,
    delay: s.delay || 500,
    var: s.var || '',
    comment: '',
    status: '',
    x: 80 + (i % 3) * 260,
    y: 80 + Math.floor(i / 3) * 140
  }));
  project = { id: Date.now(), name: tpl.name, steps, edges: [] };
  project.edges = steps.slice(0,-1).map((s,i) => ({
    id: 'e-'+Date.now()+i, from: s.id, to: steps[i+1].id, label: ''
  }));
  currentName = tpl.name;
  selectedIdx = null;
  selectedEdgeId = null;
  historyStack = [];
  redoStack = [];
  isDirty = false;
  
  updateProjName();
  render();
  switchView('editor');
  
  console.log('[TEMPLATE] Loaded template:', {
    name: tpl.name,
    steps: steps.length,
    edges: project.edges.length
  });
  addLog('Template loaded: ' + tpl.name, 'success');
}

// ─── Keyboard Help Modal ────────────────────────────────────
function showShortcutHelp() {
  const existing = document.getElementById('shortcut-modal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'shortcut-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
  const shortcuts = [
    ['Ctrl+N','New Workflow'], ['Ctrl+S','Save'], ['Ctrl+Z','Undo'], ['Ctrl+Y','Redo'],
    ['Ctrl+C','Copy'], ['Ctrl+V','Paste'], ['Ctrl+D','Duplicate'], ['Ctrl+A','Select All'],
    ['Del','Delete'], ['Ctrl+=','Zoom In'], ['Ctrl+-','Zoom Out'], ['Ctrl+0','Fit View'],
    ['Escape','Deselect'], ['F1 / ?','Help']
  ];
  let inner = '<div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px;width:500px;max-height:80vh;overflow-y:auto;">';
  inner += '<div style="font-weight:800;font-size:16px;margin-bottom:20px;">Keyboard Shortcuts</div>';
  shortcuts.forEach(function(item) {
    inner += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border2);font-size:12px;">';
    inner += '<span>' + item[1] + '</span>';
    inner += '<kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">' + item[0] + '</kbd>';
    inner += '</div>';
  });
  inner += '<button onclick="document.getElementById(\'shortcut-modal\').remove()" style="width:100%;margin-top:16px;padding:9px;border:none;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;font-weight:600;">Close</button>';
  inner += '</div>';
  modal.innerHTML = inner;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
}

function getActivityDef(type) {
  return ACTIVITIES.find(a => a.type === type) || { icon:'📌', label:type, color:'#64748b', bg:'rgba(100,116,139,0.15)' };
}

// ─── Build Tool List ─────────────────────────────────────────
(function buildToolList() {
  const list = document.getElementById('tool-list');
  let html = '';
  for (const a of ACTIVITIES) {
    if (a.sec) {
      html += '<div class="sec">' + a.sec + '</div>';
      continue;
    }
    html += '<button class="tool-card" draggable="true" data-type="' + a.type + '" data-label="' + a.label + ' ' + a.desc + '">';
    html += '<div class="tc-ico" style="background:' + a.bg + ';color:' + a.color + '">' + a.icon + '</div>';
    html += '<div class="tc-lbl"><strong>' + a.label + '</strong><span>' + a.desc + '</span></div>';
    html += '</button>';
  }
  list.innerHTML = html;
  list.querySelectorAll('.tool-card').forEach(btn => {
    const type = btn.dataset.type;
    btn.addEventListener('click', () => addNode(type));
    btn.addEventListener('dragstart', e => toolDragStart(e, type));
  });
})();

function filterTools(q) {
  document.querySelectorAll('.tool-card').forEach(c => {
    c.style.display = c.dataset.label.toLowerCase().includes(q.toLowerCase()) ? 'flex' : 'none';
  });
}

// ─── History ──────────────────────────────────────────────────
function pushHistory() {
  historyStack.push(JSON.stringify({steps:project.steps, edges:project.edges}));
  if (historyStack.length > 60) historyStack.shift();
  redoStack = [];
  isDirty = true;
}
function undoAction() {
  if (!historyStack.length) return;
  redoStack.push(JSON.stringify({steps:project.steps, edges:project.edges}));
  const s = JSON.parse(historyStack.pop());
  project.steps = s.steps; project.edges = s.edges||[];
  render(); showPropEmpty();
}
function redoAction() {
  if (!redoStack.length) return;
  historyStack.push(JSON.stringify({steps:project.steps, edges:project.edges}));
  const s = JSON.parse(redoStack.pop());
  project.steps = s.steps; project.edges = s.edges||[];
  render(); showPropEmpty();
}

// ─── View Switching ───────────────────────────────────────────
function switchView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-ico').forEach(n => n.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const map = { dashboard:'nav-dash', editor:'nav-edit', recorder:'nav-rec', settings:'nav-set' };
  if (map[id]) document.getElementById(map[id]).classList.add('active');
}

// ─── Project Name ─────────────────────────────────────────────
function updateProjName() {
  document.getElementById('proj-name').textContent = currentName + ' ✏️';
}
function renameProject() {
  const n = prompt('Nama workflow:', currentName);
  if (n && n.trim()) { 
    currentName = n.trim(); 
    project.name = currentName;
    updateProjName(); 
    isDirty = true;
    addLog('Workflow renamed to: ' + currentName + ' (click Save to persist)', 'success');
  }
}

// ─── Add Node ─────────────────────────────────────────────────
function addNode(type, x, y) {
  pushHistory();
  const def = getActivityDef(type);
  const step = {
    id: Date.now() + Math.random(), name: def.label, type,
    x: x != null ? x : 120 + Math.random()*80,
    y: y != null ? y : 120 + Math.random()*60,
    delay:500, var:'', comment:'',
    // type-specific defaults
    cx:0,cy:0, mx:0,my:0, selector:'', url:'', text:'', dir:'down', dur:300,
    sx:0,sy:0,ex:0,ey:0, loopCount:3, loopVar:'i', condition:'',
    apiUrl:'', apiMethod:'GET', apiHeaders:'', apiBody:'',
    filePath:'', delimiter:',', deviceId:'',
    cron:'0 9 * * *', timezone:'Asia/Jakarta',
    clickType:'single', clearBefore:'yes', typeSpeed:30,
    attribute:'', regex:'', keyCode:'', screenshotPath:'/sdcard/screen.png',
    waitSelector:'', waitCondition:'visible', waitTimeout:10000,
    ocrSource:'screenshot', ocrLang:'eng', browser:'default', browserMode:'normal', waitAfterLoad:2000,
    trueStep:'', falseStep:'',
    status:''
  };
  project.steps.push(step);
  // Auto-connect to previous node
  if (project.steps.length >= 2) {
    const prev = project.steps[project.steps.length - 2];
    project.edges.push({ id: 'e-'+Date.now(), from: prev.id, to: step.id, label: '' });
  }
  render();
  selectNode(project.steps.length - 1);
  addLog('Added: ' + def.label, 'info');
  
  // User guidance for loop structure
  if (type === 'repeat-start') {
    addLog('💡 Tips: Pastikan ada "Loop End" setelah step-step yang ingin diulang', 'info');
    addLog('   ↳ Loop akan berjalan dari Loop Start ke Loop End sebanyak yang ditentukan', 'info');
  }
}

// ─── Node Selection & Properties ─────────────────────────────
function selectNode(idx) {
  selectedIdx = idx;
  multiSelect = [idx];
  render();
  if (idx === null || idx < 0 || idx >= project.steps.length) { showPropEmpty(); return; }
  showProp(project.steps[idx]);
}

// ═══════════════════════════════════════════════════════════════
// FIX: Properties Panel - Reset & Re-initialize
// ═══════════════════════════════════════════════════════════════

/**
 * Reset Properties Panel state - dipanggil setiap kali node baru dipilih.
 * Memastikan semua input field editable dan event listeners ter-attach.
 */
function resetPanelState() {
  console.log('[PROP PANEL] Reset panel state...');
  
  // List semua input field yang harus di-reset
  const inputIds = [
    'pe-name', 'pe-delay', 'pe-var', 'pe-comment',
    'pe-cx', 'pe-cy', 'pe-selector', 'pe-click-type',
    'pe-type-selector', 'pe-text', 'pe-clear', 'pe-typespeed',
    'pe-url', 'pe-browser', 'pe-bmode', 'pe-bwait',
    'pe-dir', 'pe-dur', 'pe-sx', 'pe-sy', 'pe-ex', 'pe-ey',
    'pe-mx', 'pe-my', 'pe-device-id', 'pe-keycode', 'pe-screenshot-path',
    'pe-ext-sel', 'pe-ext-attr', 'pe-ext-regex',
    'pe-cond', 'pe-true-step', 'pe-false-step',
    'pe-loop-count', 'pe-loop-var', 'pe-loop-break',
    'pe-api-url', 'pe-api-method', 'pe-api-headers', 'pe-api-body',
    'pe-cron', 'pe-tz',
    'pe-filepath', 'pe-delim', 'pe-encoding',
    'pe-ocr-src', 'pe-ocr-lang',
    'pe-wait-sel', 'pe-wait-cond', 'pe-wait-timeout'
  ];
  
  // Reset setiap input field - TIDAK menggunakan cloneNode (menyebabkan bug)
  inputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      // Hapus atribut readonly/disabled jika ada
      el.removeAttribute('readonly');
      el.removeAttribute('disabled');
      el.removeAttribute('aria-disabled');
      
      // Pastikan pointer events aktif
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'text';
      el.style.opacity = '1';
      
      // JANGAN clone element - itu menghapus event listeners!
      // Cukup reset style dan attributes saja
    }
  });
  
  // Force focus removal dari field sebelumnya
  if (document.activeElement && 
      (document.activeElement.tagName === 'INPUT' || 
       document.activeElement.tagName === 'TEXTAREA')) {
    document.activeElement.blur();
  }
  
  console.log('[PROP PANEL] ✓ Panel state reset complete');
}

function showPropEmpty() {
  selectedIdx = null; multiSelect = [];
  document.getElementById('prop-empty').style.display = 'block';
  document.getElementById('prop-editor').style.display = 'none';
}

const PROP_GROUPS = {
  'tap':['pg-tap'], 'click':['pg-tap'],
  'type-into':['pg-type'],
  'open-browser':['pg-browser'],
  'swipe':['pg-swipe'],
  'mobile-tap':['pg-mobile'], 'mobile-swipe':['pg-mobile','pg-swipe'],
  'mobile-press-key':['pg-mobile'], 'mobile-screenshot':['pg-mobile'],
  'mobile-find-text':['pg-mobile'], 'open-app':['pg-mobile'], 'close-app':['pg-mobile'],
  'extract-text':['pg-extract'], 'extract-table':['pg-extract'],
  'if-condition':['pg-condition'],
  'repeat-start':['pg-loop'], 'repeat-end':[],
  'api-request':['pg-api'],
  'cron-job':['pg-cron'],
  'read-csv':['pg-file'], 'write-csv':['pg-file'], 'write-excel':['pg-file'],
  'download-file':['pg-file'], 'file-system':['pg-file'],
  'ocr':['pg-ocr'],
  'wait-element':['pg-wait'],
  'scroll-page':['pg-swipe'],
};

function showProp(s) {
  // FIX: Reset panel state sebelum populate data
  // Ini memastikan field editable dan event listeners fresh
  resetPanelState();
  
  document.getElementById('prop-empty').style.display = 'none';
  document.getElementById('prop-editor').style.display = 'block';
  const def = getActivityDef(s.type);
  document.getElementById('pe-ico-big').textContent = def.icon;
  document.getElementById('pe-ico-big').style.background = def.bg;
  document.getElementById('pe-type-lbl').textContent = s.type;
  document.getElementById('pe-name').value = s.name;
  document.getElementById('pe-delay').value = s.delay ?? 500;
  document.getElementById('pe-var').value = s.var ?? '';
  document.getElementById('pe-comment').value = s.comment ?? '';
  // Tap/Click
  document.getElementById('pe-cx').value = s.cx ?? 0;
  document.getElementById('pe-cy').value = s.cy ?? 0;
  document.getElementById('pe-selector').value = s.selector ?? '';
  document.getElementById('pe-click-type').value = s.clickType ?? 'single';
  // Type-into
  document.getElementById('pe-type-selector').value = s.selector ?? '';
  document.getElementById('pe-text').value = s.text ?? '';
  document.getElementById('pe-clear').value = s.clearBefore ?? 'yes';
  document.getElementById('pe-typespeed').value = s.typeSpeed ?? 30;
  // Browser
  document.getElementById('pe-url').value = s.url ?? '';
  document.getElementById('pe-browser').value = s.browser ?? 'default';
  document.getElementById('pe-bmode').value = s.browserMode ?? 'normal';
  document.getElementById('pe-bwait').value = s.waitAfterLoad ?? 2000;
  // Swipe
  document.getElementById('pe-dir').value = s.dir ?? 'down';
  document.getElementById('pe-dur').value = s.dur ?? 300;
  document.getElementById('pe-sx').value = s.sx ?? 0;
  document.getElementById('pe-sy').value = s.sy ?? 0;
  document.getElementById('pe-ex').value = s.ex ?? 0;
  document.getElementById('pe-ey').value = s.ey ?? 0;
  // Mobile
  document.getElementById('pe-mx').value = s.mx ?? 0;
  document.getElementById('pe-my').value = s.my ?? 0;
  document.getElementById('pe-device-id').value = s.deviceId ?? '';
  document.getElementById('pe-keycode').value = s.keyCode ?? '';
  document.getElementById('pe-screenshot-path').value = s.screenshotPath ?? '/sdcard/screen.png';
  // Extract
  document.getElementById('pe-ext-sel').value = s.selector ?? '';
  document.getElementById('pe-ext-attr').value = s.attribute ?? '';
  document.getElementById('pe-ext-regex').value = s.regex ?? '';
  // Condition
  document.getElementById('pe-cond').value = s.condition ?? '';
  document.getElementById('pe-true-step').value = s.trueStep ?? '';
  document.getElementById('pe-false-step').value = s.falseStep ?? '';
  // Loop
  document.getElementById('pe-loop-count').value = s.loopCount ?? 3;
  document.getElementById('pe-loop-var').value = s.loopVar ?? 'i';
  document.getElementById('pe-loop-break').value = s.breakCondition ?? '';
  // API
  document.getElementById('pe-api-url').value = s.apiUrl ?? '';
  document.getElementById('pe-api-method').value = s.apiMethod ?? 'GET';
  document.getElementById('pe-api-headers').value = s.apiHeaders ?? '';
  document.getElementById('pe-api-body').value = s.apiBody ?? '';
  // Cron
  document.getElementById('pe-cron').value = s.cron ?? '0 9 * * *';
  document.getElementById('pe-tz').value = s.timezone ?? 'Asia/Jakarta';
  // File
  document.getElementById('pe-filepath').value = s.filePath ?? '';
  document.getElementById('pe-delim').value = s.delimiter ?? ',';
  document.getElementById('pe-encoding').value = s.encoding ?? 'UTF-8';
  // OCR
  document.getElementById('pe-ocr-src').value = s.ocrSource ?? 'screenshot';
  document.getElementById('pe-ocr-lang').value = s.ocrLang ?? 'eng';
  // Wait element
  document.getElementById('pe-wait-sel').value = s.waitSelector ?? '';
  document.getElementById('pe-wait-cond').value = s.waitCondition ?? 'visible';
  document.getElementById('pe-wait-timeout').value = s.waitTimeout ?? 10000;

  // Show/hide groups
  const allGroups = ['pg-tap','pg-type','pg-browser','pg-swipe','pg-mobile','pg-extract',
                     'pg-condition','pg-loop','pg-api','pg-cron','pg-file','pg-ocr','pg-wait'];
  allGroups.forEach(g => { const el = document.getElementById(g); if(el) el.style.display='none'; });
  const show = PROP_GROUPS[s.type] || [];
  show.forEach(g => { const el = document.getElementById(g); if(el) el.style.display='block'; });
}

function saveProp(key, val) {
  if (selectedIdx === null) return;
  const s = project.steps[selectedIdx];
  if (!s) return;
  
  const oldVal = s[key];
  s[key] = val;
  isDirty = true;  // Mark as unsaved when property changes
  
  // Log property change for debugging
  console.log('[PROP CHANGED]', {
    stepId: s.id,
    stepName: s.name,
    property: key,
    oldValue: oldVal,
    newValue: val
  });
  
  // FIX #2: Support both 'var' and 'outputVariable' keys
  // Ini memastikan backward compatibility dengan flow lama
  if (key === 'var') {
    s.outputVariable = val;  // Sync ke outputVariable
    console.log('[PROP DEBUG] var → outputVariable: "' + val + '"');
  } else if (key === 'outputVariable') {
    s.var = val;  // Sync ke var
    console.log('[PROP DEBUG] outputVariable → var: "' + val + '"');
  }
  
  // Re-render to reflect changes
  if (key === 'name' || key === 'type') {
    render();
  }
  
  // FIX: Force update UI untuk field yang bermasalah
  // Pastikan nilai benar-benar tersimpan ke step object
  if (key === 'var' || key === 'outputVariable' || key === 'comment' || key === 'deviceId' || key === 'keyCode') {
    console.log('[PROP DEBUG] ' + key + ' = "' + val + '"');
    console.log('[PROP DEBUG] Node data:', JSON.stringify(s));
  }
}

// ─── Delete / Duplicate ───────────────────────────────────────
function deleteSelected() {
  if (selectedIdx === null) return;
  if (prefs.confirmDelete && !confirm('Hapus node ini?')) return;
  pushHistory();
  const id = project.steps[selectedIdx].id;
  project.steps.splice(selectedIdx, 1);
  project.edges = (project.edges||[]).filter(e => e.from !== id && e.to !== id);
  selectedIdx = null;
  render(); showPropEmpty();
}
function duplicateSelected() {
  if (selectedIdx === null) return;
  pushHistory();
  const orig = project.steps[selectedIdx];
  const dup = { ...orig, id: Date.now(), x: orig.x+30, y: orig.y+30, status:'' };
  project.steps.splice(selectedIdx+1, 0, dup);
  selectedIdx = selectedIdx + 1;
  render(); showProp(project.steps[selectedIdx]);
}

// ─── Copy / Paste ─────────────────────────────────────────────
function copySelected() {
  if (selectedIdx === null) return;
  clipboard = [{ ...project.steps[selectedIdx] }];
  addLog('Copied: ' + project.steps[selectedIdx].name, 'info');
}
function pasteNodes() {
  if (!clipboard.length) return;
  pushHistory();
  const pasted = clipboard.map(n => ({ ...n, id:Date.now()+Math.random(), x:n.x+30, y:n.y+30, status:'' }));
  project.steps.push(...pasted);
  render();
  addLog('Pasted '+pasted.length+' node(s)', 'info');
}
function selectAll() {
  multiSelect = project.steps.map((_,i) => i);
  render();
}

// ─── Align ────────────────────────────────────────────────────
function alignNodes(dir) {
  const sel = multiSelect.length > 1 ? multiSelect : (selectedIdx !== null ? [selectedIdx] : []);
  if (sel.length < 2) return;
  pushHistory();
  const nodes = sel.map(i => project.steps[i]);
  if (dir === 'left')   { const minX = Math.min(...nodes.map(n=>n.x)); nodes.forEach(n=>n.x=minX); }
  if (dir === 'right')  { const maxX = Math.max(...nodes.map(n=>n.x)); nodes.forEach(n=>n.x=maxX); }
  if (dir === 'center') { const cx = nodes.reduce((s,n)=>s+n.x,0)/nodes.length; nodes.forEach(n=>n.x=cx); }
  if (dir === 'top')    { const minY = Math.min(...nodes.map(n=>n.y)); nodes.forEach(n=>n.y=minY); }
  if (dir === 'bottom') { const maxY = Math.max(...nodes.map(n=>n.y)); nodes.forEach(n=>n.y=maxY); }
  render();
}

// ─── Auto Layout (Dagre-style manual) ────────────────────────
function autoLayout() {
  pushHistory();
  const cols = Math.max(1, Math.ceil(Math.sqrt(project.steps.length * 0.8)));
  const gX = 260, gY = 140, padX = 80, padY = 80;
  project.steps.forEach((s, i) => {
    s.x = padX + (i % cols) * gX;
    s.y = padY + Math.floor(i / cols) * gY;
  });
  render();
}

// ─── RENDER ───────────────────────────────────────────────────
function render() {
  const svg = document.getElementById('svg-layer');
  const wrapper = document.getElementById('canvas-wrapper');
  // Remove old nodes
  wrapper.querySelectorAll('.node').forEach(n => n.remove());
  // Clear SVG but keep defs
  const defs = svg.querySelector('defs');
  const tempLine = document.getElementById('temp-line');
  svg.innerHTML = '';
  if (defs) svg.appendChild(defs);
  // Re-add temp line
  const tl = document.createElementNS('http://www.w3.org/2000/svg','path');
  tl.id = 'temp-line';
  tl.setAttribute('fill','none');
  tl.style.display = 'none';
  svg.appendChild(tl);

  const NODE_W = 200, NODE_H = 60;

  // Draw edges
  const edges = project.edges || [];
  // If no edges, draw sequential edges
  const drawEdges = edges.length > 0 ? edges : project.steps.slice(0,-1).map((s,i) => ({
    id: 'auto-'+i, from: s.id, to: project.steps[i+1].id, label:''
  }));

  for (const edge of drawEdges) {
    const fromNode = project.steps.find(s=>s.id===edge.from);
    const toNode   = project.steps.find(s=>s.id===edge.to);
    if (!fromNode || !toNode) continue;

    const sx = fromNode.x + NODE_W;
    const sy = fromNode.y + NODE_H/2;
    const ex = toNode.x;
    const ey = toNode.y + NODE_H/2;
    const dx = ex - sx, dy = ey - sy;
    const cpOff = Math.max(60, Math.abs(dx) * 0.45);
    const cp1x = sx + cpOff, cp1y = sy;
    const cp2x = ex - cpOff, cp2y = ey;
    const d = 'M' + sx + ',' + sy + ' C' + cp1x + ',' + cp1y + ' ' + cp2x + ',' + cp2y + ' ' + ex + ',' + ey;

    const def = getActivityDef(fromNode.type);
    const isActive = fromNode.status === 'running' && prefs.animate;
    const isSelEdge = edge.id === selectedEdgeId;

    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', isSelEdge ? '#60a5fa' : def.color);
    path.setAttribute('stroke-width', isSelEdge ? '3' : '2');
    path.setAttribute('fill','none');
    path.setAttribute('stroke-linecap','round');
    path.setAttribute('marker-end', 'url(#arr-default)');
    path.setAttribute('class','flow-edge' + (isSelEdge?' selected':'') + (isActive?' active-run':''));
    if (isActive) path.setAttribute('stroke-dasharray','10,5');
    path.dataset.edgeId = edge.id;

    path.addEventListener('click', e => {
      e.stopPropagation();
      selectedEdgeId = edge.id;
      selectedIdx = null;
      render();
      showPropEmpty();
    });
    path.addEventListener('contextmenu', e => {
      e.preventDefault();
      showEdgeCtxMenu(e.clientX, e.clientY, edge.id);
    });
    svg.appendChild(path);

    // Edge label
    if (edge.label) {
      const mx = (sx+ex)/2, my = (sy+ey)/2 - 10;
      const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
      txt.setAttribute('x', mx); txt.setAttribute('y', my);
      txt.setAttribute('text-anchor','middle');
      txt.setAttribute('fill','rgba(255,255,255,0.5)');
      txt.setAttribute('font-size','9');
      txt.textContent = edge.label;
      svg.appendChild(txt);
    }

    // Junction dots
    [[sx,sy],[ex,ey]].forEach(([cx,cy]) => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
      dot.setAttribute('cx',cx); dot.setAttribute('cy',cy); dot.setAttribute('r','3.5');
      dot.setAttribute('fill', def.color); dot.setAttribute('opacity','0.7');
      svg.appendChild(dot);
    });
  }

  // Draw groups (before nodes)
  groups.forEach(g => {
    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x', g.x); rect.setAttribute('y', g.y);
    rect.setAttribute('width', g.w); rect.setAttribute('height', g.h);
    rect.setAttribute('fill', g.color + '11');
    rect.setAttribute('stroke', g.color + '66');
    rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('stroke-dasharray', '4,3');
    rect.setAttribute('rx', '12');
    svg.appendChild(rect);
    // Group label
    const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
    txt.setAttribute('x', g.x + 10); txt.setAttribute('y', g.y + 16);
    txt.setAttribute('fill', g.color); txt.setAttribute('font-size', '10');
    txt.setAttribute('font-weight', '700');
    txt.textContent = 'g ' + g.name;
    svg.appendChild(txt);
  });

  // Draw nodes
  project.steps.forEach((s, i) => {
    const def = getActivityDef(s.type);
    const isSelected = selectedIdx === i || multiSelect.includes(i);
    const div = document.createElement('div');
    div.className = 'node ' + s.type + (isSelected ? ' selected' : '') + (s.status ? ' '+s.status : '');
    div.style.left = s.x + 'px';
    div.style.top  = s.y + 'px';
    div.dataset.idx = i;

    let nodeHTML = '';
    if (prefs.showStepNum) {
      nodeHTML += '<div class="node-step-num">' + (i + 1) + '</div>';
    }
    nodeHTML += '<div class="node-ico" style="background:' + def.bg + ';color:' + def.color + '">' + def.icon + '</div>';
    nodeHTML += '<div class="node-body">';
    nodeHTML += '  <div class="node-lbl">' + s.name + '</div>';
    nodeHTML += '  <div class="node-type">' + s.type + '</div>';
    if (s.status === 'running') {
      nodeHTML += '<div style="font-size:9px;color:var(--yellow);margin-top:2px;">⏳ running...</div>';
    }
    if (s.status === 'success') {
      nodeHTML += '<div style="font-size:9px;color:var(--green);margin-top:2px;">✓ done</div>';
    }
    if (s.status === 'error') {
      nodeHTML += '<div style="font-size:9px;color:var(--red);margin-top:2px;">✗ error</div>';
    }
    nodeHTML += '</div>';
    nodeHTML += '<div class="node-port out" title="Drag to connect"></div>';
    nodeHTML += '<div class="node-port in"  title="Input port"></div>';
    nodeHTML += '<div class="node-status-bar"></div>';
    div.innerHTML = nodeHTML;

    // Attach event listeners to ports after HTML is set
    const outPort = div.querySelector('.node-port.out');
    if (outPort) {
      (function(capturedIdx) {
        outPort.addEventListener('mousedown', function(e) {
          portDragStart(e, capturedIdx);
        });
      })(i);
    }

    // Mousedown: drag node
    div.addEventListener('mousedown', e => {
      if (e.target.classList.contains('node-port')) return;
      e.stopPropagation();
      pushHistory();
      selectNode(i);
      isDraggingNode = true;
      dragNode = s;
      const canvas = document.getElementById('canvas');
      const rect = canvas.getBoundingClientRect();
      dragOX = (e.clientX - rect.left - tx) / sc - s.x;
      dragOY = (e.clientY - rect.top  - ty) / sc - s.y;
    });

    // Context menu
    div.addEventListener('contextmenu', e => {
      e.preventDefault();
      selectNode(i);
      showNodeCtxMenu(e.clientX, e.clientY, i);
    });

    // Double-click: rename inline
    div.addEventListener('dblclick', e => {
      e.stopPropagation();
      const n = prompt('Rename node:', s.name);
      if (n && n.trim()) { s.name = n.trim(); render(); showProp(s); }
    });

    wrapper.appendChild(div);
  });
}

// ─── Canvas Interaction ───────────────────────────────────────
const canvasEl = document.getElementById('canvas');
const wrapperEl = document.getElementById('canvas-wrapper');

function applyTransform() {
  wrapperEl.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + sc + ')';
  document.getElementById('zoom-badge').textContent = Math.round(sc*100)+'%';
  updateMiniMap();
}

canvasEl.addEventListener('mousedown', e => {
  // BUG #1 FIX: Do NOT capture events from the properties panel
  if (e.target.closest('.prop-panel') || e.target.closest('#prop-editor') || e.target.closest('#properties-panel')) {
    return;
  }
  
  if (e.target === canvasEl || e.target === wrapperEl || e.target.id === 'svg-layer') {
    if (e.button === 1 || e.button === 2 || (e.button===0 && !e.altKey)) {
      if (e.button === 0) {
        // deselect
        selectedIdx = null; multiSelect = []; selectedEdgeId = null;
        closeCtxMenu();
        render(); showPropEmpty();
      }
      isPanning = true;
      panSX = e.clientX - tx;
      panSY = e.clientY - ty;
    }
  }
});

document.addEventListener('mousemove', e => {
  if (isPanning && !isDraggingNode) {
    tx = e.clientX - panSX;
    ty = e.clientY - panSY;
    applyTransform();
  }
  if (isDraggingNode && dragNode) {
    const rect = canvasEl.getBoundingClientRect();
    let nx = (e.clientX - rect.left - tx) / sc - dragOX;
    let ny = (e.clientY - rect.top  - ty) / sc - dragOY;
    if (snapToGrid) { const g=20; nx=Math.round(nx/g)*g; ny=Math.round(ny/g)*g; }
    dragNode.x = Math.max(0, nx);
    dragNode.y = Math.max(0, ny);
    render();
  }
  if (isDrawingEdge) {
    const rect = canvasEl.getBoundingClientRect();
    const mx = (e.clientX - rect.left - tx) / sc;
    const my = (e.clientY - rect.top  - ty) / sc;
    const fromNode = project.steps[edgeFromIdx];
    if (!fromNode) return;
    const sx = fromNode.x + 200, sy = fromNode.y + 30;
    const tl = document.getElementById('temp-line');
    tl.setAttribute('d', 'M' + sx + ',' + sy + ' C' + (sx+80) + ',' + sy + ' ' + (mx-80) + ',' + my + ' ' + mx + ',' + my);
    tl.style.display = 'block';
    tl.setAttribute('stroke', 'rgba(59,130,246,0.7)');
    tl.setAttribute('stroke-width','2');
    tl.setAttribute('stroke-dasharray','6,3');
  }
});

document.addEventListener('mouseup', e => {
  if (isDraggingNode) { isDraggingNode = false; dragNode = null; }
  if (isDrawingEdge) {
    // Check if dropped on a node port
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const nodeEl = el && el.closest('.node');
    if (nodeEl && nodeEl.dataset.idx !== undefined) {
      const toIdx = parseInt(nodeEl.dataset.idx);
      if (toIdx !== edgeFromIdx) {
        pushHistory();
        const from = project.steps[edgeFromIdx];
        const to   = project.steps[toIdx];
        // Remove existing auto-edge between these two
        project.edges = project.edges.filter(e => !(e.from===from.id && e.to===to.id));
        project.edges.push({ id:'e-'+Date.now(), from:from.id, to:to.id, label:'' });
        addLog('Connected: ' + from.name + ' → ' + to.name, 'info');
        render();
      }
    }
    isDrawingEdge = false; edgeFromIdx = null;
    const tl = document.getElementById('temp-line');
    if (tl) tl.style.display = 'none';
  }
  isPanning = false;
});

// Port drag start
function portDragStart(e, idx) {
  e.stopPropagation();
  e.preventDefault();
  isDrawingEdge = true;
  edgeFromIdx = idx;
}
function startConnectionDraw() {
  if (selectedIdx === null) { addLog('Pilih node dulu', 'warn'); return; }
  addLog('Drag port biru (kanan) dari node ke node tujuan untuk menghubungkan', 'info');
}

// Scroll to zoom
canvasEl.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvasEl.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const newSc = Math.max(0.15, Math.min(4, sc * factor));
  tx = mx - (mx - tx) * (newSc/sc);
  ty = my - (my - ty) * (newSc/sc);
  sc = newSc;
  applyTransform();
}, { passive:false });

// Drag & Drop from tool panel
let draggedType = null;
function toolDragStart(e, type) { draggedType = type; e.dataTransfer.effectAllowed='copy'; }
canvasEl.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
canvasEl.addEventListener('drop', e => {
  e.preventDefault();
  if (!draggedType) return;
  const rect = canvasEl.getBoundingClientRect();
  const x = (e.clientX - rect.left - tx) / sc - 100;
  const y = (e.clientY - rect.top  - ty) / sc - 30;
  addNode(draggedType, Math.max(0,x), Math.max(0,y));
  draggedType = null;
});

// ─── Zoom Controls ────────────────────────────────────────────
function zoomIn()    { sc=Math.min(sc*1.2,4); applyTransform(); }
function zoomOut()   { sc=Math.max(sc/1.2,0.15); applyTransform(); }
function resetZoom() {
  if (!project.steps.length) { tx=0; ty=0; sc=1; applyTransform(); return; }
  // Fit all nodes in view
  const xs = project.steps.map(s=>s.x), ys = project.steps.map(s=>s.y);
  const minX=Math.min(...xs)-40, minY=Math.min(...ys)-40;
  const maxX=Math.max(...xs)+240, maxY=Math.max(...ys)+100;
  const rect = canvasEl.getBoundingClientRect();
  const scX = rect.width  / (maxX-minX || 1);
  const scY = rect.height / (maxY-minY || 1);
  sc = Math.max(0.2, Math.min(1.2, Math.min(scX,scY)));
  tx = -minX*sc + (rect.width  - (maxX-minX)*sc)/2;
  ty = -minY*sc + (rect.height - (maxY-minY)*sc)/2;
  applyTransform();
}

function toggleSnap() {
  snapToGrid = !snapToGrid;
  const btn = document.getElementById('snap-btn');
  btn.classList.toggle('active', snapToGrid);
  addLog('Snap to grid: ' + (snapToGrid?'ON':'OFF'), 'info');
}

// ─── Mini Map ─────────────────────────────────────────────────
function toggleMiniMap() {
  miniMapOn = !miniMapOn;
  document.getElementById('minimap').style.display = miniMapOn ? 'block' : 'none';
  document.getElementById('mm-btn').classList.toggle('active', miniMapOn);
  if (miniMapOn) updateMiniMap();
}
function updateMiniMap() {
  if (!miniMapOn) return;
  const canvas = document.getElementById('mm-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='rgba(15,23,42,0.8)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  if (!project.steps.length) return;
  const xs = project.steps.map(s=>s.x||0), ys = project.steps.map(s=>s.y||0);
  const minX=Math.min(...xs)-20, minY=Math.min(...ys)-20;
  const maxX=Math.max(...xs)+240, maxY=Math.max(...ys)+100;
  const scX=180/(maxX-minX||1), scY=130/(maxY-minY||1), mmSc=Math.min(scX,scY);
  project.steps.forEach(s => {
    const def = getActivityDef(s.type);
    ctx.fillStyle = def.color+'99';
    ctx.fillRect((s.x-minX)*mmSc+2,(s.y-minY)*mmSc+2, 200*mmSc, 60*mmSc);
  });
  // Viewport indicator
  const rect = canvasEl.getBoundingClientRect();
  const vx = (-tx/sc - minX)*mmSc+2;
  const vy = (-ty/sc - minY)*mmSc+2;
  const vw = (rect.width/sc)*mmSc;
  const vh = (rect.height/sc)*mmSc;
  ctx.strokeStyle='rgba(59,130,246,0.8)';
  ctx.lineWidth=1.5;
  ctx.strokeRect(vx,vy,vw,vh);
}

// ─── Context Menus ────────────────────────────────────────────
function closeCtxMenu() { document.querySelectorAll('.ctx-menu').forEach(m=>m.remove()); }
function showNodeCtxMenu(x, y, idx) {
  closeCtxMenu();
  const s = project.steps[idx];
  const def = getActivityDef(s.type);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const items = [
    { ico:'📋', lbl:'Duplicate',         fn: function(){ duplicateSelected(); closeCtxMenu(); } },
    { ico:'📄', lbl:'Copy',              fn: function(){ copySelected(); closeCtxMenu(); } },
    { ico:'📌', lbl:'Paste After',       fn: function(){ pasteNodes(); closeCtxMenu(); } },
    { sep: true },
    { ico:'✏️', lbl:'Rename',            fn: function(){ renameNodeInline(idx); closeCtxMenu(); } },
    { ico:'🔄', lbl:'Change Type',       fn: function(){ changeNodeType(idx); closeCtxMenu(); } },
    { ico:'▶',  lbl:'Run This Step',     fn: function(){ runSingleStep(); closeCtxMenu(); } },
    { sep: true },
    { ico:'⬆',  lbl:'Move Up',          fn: function(){ moveNodeUp(idx); closeCtxMenu(); } },
    { ico:'⬇',  lbl:'Move Down',        fn: function(){ moveNodeDown(idx); closeCtxMenu(); } },
    { sep: true },
    { ico:'✂️', lbl:'Break Connections', fn: function(){ breakEdgesFrom(idx); closeCtxMenu(); } },
    { ico:'🗑',  lbl:'Delete Node',      fn: function(){ deleteSelected(); closeCtxMenu(); }, danger: true },
  ];

  const sub = document.createElement('div');
  sub.className = 'ctx-sub';
  sub.textContent = def.icon + ' ' + s.name;
  menu.appendChild(sub);

  items.forEach(function(item) {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    const ico = document.createElement('span');
    ico.className = 'ctx-ico';
    ico.textContent = item.ico;
    el.appendChild(ico);
    el.appendChild(document.createTextNode(' ' + item.lbl));
    el.addEventListener('click', item.fn);
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  setTimeout(() => window.addEventListener('click', closeCtxMenu, {once:true}), 0);
}
function showEdgeCtxMenu(x,y,edgeId) {
  closeCtxMenu();
  const edge = (project.edges||[]).find(e=>e.id===edgeId);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const sub = document.createElement('div');
  sub.className = 'ctx-sub';
  sub.textContent = 'Connection';
  menu.appendChild(sub);

  const items = [
    { ico:'✏️', lbl:'Add Label',            fn: function(){ labelEdge(edgeId); closeCtxMenu(); } },
    { ico:'🔄', lbl:'Reverse Direction',   fn: function(){ reverseEdge(edgeId); closeCtxMenu(); } },
    { ico:'🗑',  lbl:'Delete Connection',  fn: function(){ deleteEdge(edgeId); closeCtxMenu(); }, danger: true },
  ];

  items.forEach(function(item) {
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    const ico = document.createElement('span');
    ico.className = 'ctx-ico';
    ico.textContent = item.ico;
    el.appendChild(ico);
    el.appendChild(document.createTextNode(' ' + item.lbl));
    el.addEventListener('click', item.fn);
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  setTimeout(() => window.addEventListener('click', closeCtxMenu, {once:true}), 0);
}

function renameNodeInline(idx) { const s=project.steps[idx]; const n=prompt('Rename:',s.name); if(n) { s.name=n; render(); showProp(s); } }
function changeNodeType(idx) {
  const types = ACTIVITIES.filter(a=>a.type).map(a=>a.type);
  const t = prompt('New type:\n'+types.slice(0,30).join(', '), project.steps[idx].type);
  if (t && types.includes(t)) { pushHistory(); project.steps[idx].type=t; render(); showProp(project.steps[idx]); }
}
function moveNodeUp(idx) { if(idx<1) return; pushHistory(); [project.steps[idx-1],project.steps[idx]]=[project.steps[idx],project.steps[idx-1]]; selectedIdx=idx-1; render(); }
function moveNodeDown(idx) { if(idx>=project.steps.length-1) return; pushHistory(); [project.steps[idx],project.steps[idx+1]]=[project.steps[idx+1],project.steps[idx]]; selectedIdx=idx+1; render(); }
function breakEdgesFrom(idx) {
  pushHistory();
  const id = project.steps[idx].id;
  project.edges = (project.edges||[]).filter(e=>e.from!==id && e.to!==id);
  render();
}
function labelEdge(id) {
  const e = (project.edges||[]).find(e=>e.id===id);
  if (!e) return;
  const l = prompt('Edge label:', e.label||'');
  if (l !== null) { e.label=l; render(); }
}
function reverseEdge(id) {
  const e = (project.edges||[]).find(e=>e.id===id);
  if (!e) return;
  pushHistory();
  [e.from, e.to] = [e.to, e.from];
  render();
}
function deleteEdge(id) {
  pushHistory();
  project.edges = (project.edges||[]).filter(e=>e.id!==id);
  selectedEdgeId = null;
  render();
}

// ─── Template Modal (BUG #15) ──────────────────────────────
function showTemplateModal() {
  // Remove existing modal if any
  const existing = document.getElementById('template-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'template-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.background = 'rgba(0,0,0,0.5)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '9999';

  const dialog = document.createElement('div');
  dialog.style.background = 'var(--bg)';
  dialog.style.border = '1px solid var(--border)';
  dialog.style.borderRadius = '8px';
  dialog.style.padding = '24px';
  dialog.style.minWidth = '400px';
  dialog.style.maxHeight = '80vh';
  dialog.style.overflowY = 'auto';
  dialog.style.boxShadow = '0 20px 60px rgba(0,0,0,0.3)';

  const title = document.createElement('h2');
  title.textContent = 'Template Workflows';
  title.style.marginTop = '0';
  title.style.marginBottom = '16px';
  dialog.appendChild(title);

  const templates = [
    { name: 'Empty Workflow', desc: 'Start from scratch', steps: [] },
    { name: 'Mobile Testing', desc: 'Template for mobile app testing', steps: [
      { name: 'Open App', type: 'open-app', var: 'com.example.app' },
      { name: 'Take Screenshot', type: 'mobile-screenshot', screenshotPath: '/sdcard/test.png' },
      { name: 'Close App', type: 'close-app', var: 'com.example.app' }
    ]},
    { name: 'Web Scraping', desc: 'Template for web scraping workflow', steps: [
      { name: 'Open Browser', type: 'open-browser', url: 'https://example.com', browser: 'chrome' },
      { name: 'Wait for Load', type: 'wait-element', waitSelector: 'body', waitCondition: 'visible', waitTimeout: '5000' },
      { name: 'Extract Text', type: 'extract-text', selector: 'body', var: 'result' }
    ]},
    { name: 'API Integration', desc: 'Template for API testing', steps: [
      { name: 'API Call', type: 'api-request', apiMethod: 'GET', apiUrl: 'https://api.example.com/data' },
      { name: 'Extract Data', type: 'json-processing' }
    ]}
  ];

  templates.forEach(function(template) {
    const item = document.createElement('div');
    item.style.padding = '12px';
    item.style.margin = '8px 0';
    item.style.border = '1px solid var(--border)';
    item.style.borderRadius = '4px';
    item.style.cursor = 'pointer';
    item.style.transition = 'all 0.2s';

    const itemName = document.createElement('div');
    itemName.style.fontWeight = 'bold';
    itemName.textContent = template.name;
    item.appendChild(itemName);

    const itemDesc = document.createElement('div');
    itemDesc.style.fontSize = '12px';
    itemDesc.style.color = 'var(--dim)';
    itemDesc.style.marginTop = '4px';
    itemDesc.textContent = template.desc;
    item.appendChild(itemDesc);

    item.addEventListener('mouseenter', function() {
      item.style.background = 'var(--border)';
      item.style.transform = 'translateX(4px)';
    });

    item.addEventListener('mouseleave', function() {
      item.style.background = 'transparent';
      item.style.transform = 'translateX(0)';
    });

    item.addEventListener('click', function() {
      project.id = Date.now();
      project.name = template.name;
      project.steps = JSON.parse(JSON.stringify(template.steps)).map(function(s) {
        s.id = 'step-' + Date.now() + '-' + Math.random();
        s.x = (Math.random() * 300) - 150;
        s.y = (Math.random() * 200) - 100;
        return s;
      });
      project.edges = [];
      currentName = template.name;
      selectedIdx = null;
      selectedEdgeId = null;
      historyStack = [];
      redoStack = [];
      isDirty = false;
      updateProjName();
      render();
      modal.remove();
      switchView('editor');
      addLog('Loaded template: ' + template.name, 'info');
    });

    dialog.appendChild(item);
  });

  const btnRow = document.createElement('div');
  btnRow.style.marginTop = '16px';
  btnRow.style.display = 'flex';
  btnRow.style.gap = '8px';
  btnRow.style.justifyContent = 'flex-end';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.padding = '8px 16px';
  cancelBtn.style.cursor = 'pointer';
  cancelBtn.addEventListener('click', function() { modal.remove(); });
  btnRow.appendChild(cancelBtn);

  dialog.appendChild(btnRow);
  modal.appendChild(dialog);
  document.body.appendChild(modal);
}

// ─── CRITICAL: Sync state before operations ───────────────────
// This ensures canvas state is always reflected in project object
function syncProjectState() {
  // Sync name
  if (currentName) {
    project.name = currentName;
  }
  // Ensure ID is set
  if (!project.id) {
    project.id = Date.now();
  }
  // Ensure nodes and edges arrays exist
  if (!project.steps) project.steps = [];
  if (!project.edges) project.edges = [];
  console.log('[SYNC] Project state synchronized:', {
    id: project.id,
    name: project.name,
    stepsCount: project.steps.length,
    edgesCount: project.edges.length
  });
  return project;
}

// ─── Export / Import ──────────────────────────────────────────
function exportWorkflow() {
  syncProjectState();  // CRITICAL: Ensure latest state
  const data = JSON.stringify(project, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download = (currentName||'workflow')+'.json';
  a.click(); URL.revokeObjectURL(url);
  console.log('[EXPORT] Exported workflow:', project.name, 'with', project.steps.length, 'steps');
  addLog('Exported: '+currentName, 'info');
}

function handleImport(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      
      // CRITICAL: Preserve ID if it exists in imported data, otherwise create consistent one
      const importedId = data.id;
      
      project = {
        id: importedId || Date.now(),  // Use imported ID if available, else generate new
        name: data.name || file.name.replace('.json',''),
        steps: (data.steps||data.nodes||[]).map(n => ({
          id: n.id || ('step-'+Date.now()+'-'+Math.random()),
          name: n.name||n.data?.label||'Step',
          type: String(n.type||n.data?.type||'tap').toLowerCase(),
          x: n.x||n.position?.x||0,
          y: n.y||n.position?.y||0,
          delay: n.delay||500,
          var: n.var||'',
          comment: n.comment||'',
          status: '',
          // Preserve all other properties from imported node
          ...Object.fromEntries(
            Object.entries(n).filter(([k,v]) => 
              !['id','name','type','x','y','position','delay','var','comment','status','data'].includes(k)
            )
          )
        })),
        edges: (data.edges||[]).map(e => ({
          ...e,
          id: e.id || ('e-'+Date.now()+'-'+Math.random())
        }))
      };
      
      currentName = project.name;
      selectedIdx = null;
      selectedEdgeId = null;
      historyStack = [];
      redoStack = [];
      isDirty = false;  // Reset dirty flag after import
      
      updateProjName();
      autoLayout();
      render();
      switchView('editor');
      
      console.log('[IMPORT] Workflow imported:', {
        id: project.id,
        name: project.name,
        steps: project.steps.length,
        edges: project.edges.length
      });
      addLog('Imported: '+file.name+' (ID: '+project.id+')', 'success');
    } catch(err) { 
      console.error('[IMPORT ERROR]', err);
      alert('Error parsing JSON: '+err.message); 
    }
  };
  reader.readAsText(file);
  input.value = '';
}

// ─── Save / Load Projects ─────────────────────────────────────
async function saveCurrentProject() {
  if (!project.steps.length) { addLog('Tambahkan minimal 1 step sebelum save', 'warn'); return; }
  
  // CRITICAL: Sync state before saving
  syncProjectState();
  
  console.log('[SAVE] Saving workflow:', {
    id: project.id,
    name: project.name,
    steps: project.steps.length,
    edges: project.edges.length
  });
  
  const list = await ipcRenderer.invoke('save-workflow', {
    id: project.id,
    name: project.name,
    steps: JSON.parse(JSON.stringify(project.steps)),  // Deep copy to prevent mutation
    edges: JSON.parse(JSON.stringify(project.edges)),   // Deep copy to prevent mutation
    updatedAt: new Date().toISOString()
  });
  
  workflows = list;
  renderSavedList();
  console.log('[SAVE SUCCESS] Workflow saved with ID:', project.id);
  addLog('Saved: '+currentName, 'success');
  isDirty = false;
}
async function loadSavedProjects() {
  try {
    workflows = await ipcRenderer.invoke('get-saved-workflows');
    renderSavedList();
    logAutoDetection('Saved workflows refreshed', 'info');
  } catch (err) {
    addLog('loadSavedProjects failed: ' + err.message, 'error');
  }
}
function renderSavedList() {
  const el = document.getElementById('wf-list');
  if (!el) return;
  el.innerHTML = '';
  if (!workflows.length) {
    const emptyDiv = document.createElement('div');
    emptyDiv.style.color = 'var(--dim)';
    emptyDiv.style.textAlign = 'center';
    emptyDiv.style.padding = '24px';
    emptyDiv.style.fontSize = '12px';
    emptyDiv.textContent = 'Belum ada workflow tersimpan';
    el.appendChild(emptyDiv);
    return;
  }

  workflows.forEach(function(wf) {
    const item = document.createElement('div');
    item.className = 'wf-item';

    const ico = document.createElement('div');
    ico.className = 'wf-item-ico';
    ico.textContent = '⚡';
    item.appendChild(ico);

    const body = document.createElement('div');
    body.className = 'wf-item-body';

    const name = document.createElement('div');
    name.className = 'wf-item-name';
    name.textContent = wf.name;
    body.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'wf-item-meta';
    const stepCount = (wf.steps || []).length;
    const updatedDate = new Date(wf.updatedAt || Date.now()).toLocaleString();
    meta.textContent = stepCount + ' steps · ' + updatedDate;
    body.appendChild(meta);

    item.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'wf-item-actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'wf-item-btn open';
    openBtn.textContent = 'Open';
    (function(wfId) {
      openBtn.addEventListener('click', function() {
        openProject(wfId);
      });
    })(wf.id);
    actions.appendChild(openBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'wf-item-btn del';
    delBtn.textContent = 'Del';
    (function(wfId) {
      delBtn.addEventListener('click', function() {
        deleteProject(wfId);
      });
    })(wf.id);
    actions.appendChild(delBtn);

    item.appendChild(actions);
    el.appendChild(item);
  });
}
async function openProject(id) {
  const wf = await ipcRenderer.invoke('load-workflow', id);
  if (!wf) {
    console.error('[OPEN ERROR] Workflow not found with ID:', id);
    addLog('Workflow not found!', 'error');
    return;
  }
  
  // Reset state and load workflow
  project = { 
    id: wf.id, 
    name: wf.name, 
    steps: (wf.steps||[]).map(s => ({...s})),  // Deep copy steps
    edges: (wf.edges||[]).map(e => ({...e}))   // Deep copy edges
  };
  
  currentName = wf.name;
  selectedIdx = null;
  selectedEdgeId = null;
  historyStack = [];
  redoStack = [];
  isDirty = false;
  
  updateProjName();
  autoLayout();
  render();
  switchView('editor');
  
  console.log('[OPEN] Workflow loaded:', {
    id: wf.id,
    name: wf.name,
    steps: (wf.steps||[]).length,
    edges: (wf.edges||[]).length
  });
  addLog('Opened: '+wf.name, 'success');
}
async function deleteProject(id) {
  if (prefs.confirmDelete && !confirm('Hapus workflow ini?')) return;
  workflows = await ipcRenderer.invoke('delete-workflow', id);
  renderSavedList();
  if (project.id === id) createNew();
}

function createNew() {
  pushHistory();
  tx=0; ty=0; sc=1; applyTransform();
  
  const newId = Date.now();
  project = { 
    id: newId, 
    name: 'New Flow', 
    steps: [
      { 
        id: 1, 
        name: 'Start', 
        type: 'start', 
        x: 120, 
        y: 120, 
        delay: 0, 
        var: '', 
        comment: '', 
        status: '' 
      }
    ], 
    edges: [] 
  };
  
  currentName = 'New Flow';
  selectedIdx = null;
  selectedEdgeId = null;
  historyStack = [];
  redoStack = [];
  isDirty = false;
  
  updateProjName();
  render();
  switchView('editor');
  
  console.log('[NEW] New workflow created with ID:', newId);
  addLog('New workflow created', 'success');
}

// ─── ADB & Devices ────────────────────────────────────────────
async function refreshDevices() {
  addLog('Refreshing ADB devices...', 'info');
  try {
    const info = await ipcRenderer.invoke('adb-info');
    if (!info.found) {
      addLog('ADB tidak ditemukan: ' + info.path, 'warn');
      updateDeviceSelector([]);
      const statusEl = document.getElementById('adb-status-msg');
      if (statusEl) {
        statusEl.textContent = '❌ ADB tidak ditemukan: ' + info.path;
        statusEl.style.color = 'var(--red)';
      }
      return;
    }
    updateDeviceSelector(info.devices);
    logAutoDetection('ADB devices refreshed: ' + (info.devices.length ? info.devices.join(', ') : 'no devices found'), 'success');
    const statusEl = document.getElementById('adb-status-msg');
    if (statusEl) {
      statusEl.textContent = '✅ ADB: ' + info.path;
      statusEl.style.color = 'var(--green)';
    }
  } catch (err) {
    addLog('refreshDevices failed: ' + err.message, 'error');
    ipcRenderer.send('get-devices');
  }
}

async function connectWifi() {
  const ip   = document.getElementById('wifi-ip').value.trim();
  const port = document.getElementById('wifi-port').value.trim() || '5555';
  if (!ip) { addLog('Masukkan IP address HP', 'warn'); return; }
  addLog('Connecting WiFi ADB: ' + ip + ':' + port + '...', 'info');
  const res = await ipcRenderer.invoke('adb-connect-wifi', { ip, port });
  const statusEl = document.getElementById('wifi-status');
  if (res.success) {
    addLog('✅ Connected: ' + ip + ':' + port, 'success');
    if (statusEl) { statusEl.textContent = '✅ ' + res.output; statusEl.style.color = 'var(--green)'; }
    refreshDevices();
  } else {
    addLog('❌ WiFi connect failed: ' + res.error, 'error');
    if (statusEl) { statusEl.textContent = '❌ ' + res.error; statusEl.style.color = 'var(--red)'; }
  }
}

async function launchScrcpy() {
  const device = document.getElementById('device-selector').value;
  if (device === 'No ADB Device' || !device) {
    addLog('Tidak ada device terpilih. Hubungkan HP via USB atau WiFi ADB.', 'warn');
    return;
  }
  addLog('Launching scrcpy for: '+device, 'info');
  const res = await ipcRenderer.invoke('launch-scrcpy', { device, args:'' });
  if (res.success) addLog('scrcpy launched!', 'success');
  else addLog('scrcpy error: '+res.error, 'error');
}
async function showAdbInfo() {
  const info = await ipcRenderer.invoke('adb-info');
  const msg = 'ADB Found: '+info.found+
    '\\nPath: '+info.path+
    '\\nDevices: '+(info.devices.length?info.devices.join(', '):'None');
  alert(msg);
  const el = document.getElementById('adb-status-msg');
  if (el) el.textContent = info.found ? '✅ ADB: '+info.path : '❌ ADB not found in PATH';
}
function updateDeviceSelector(devices) {
  const sel = document.getElementById('device-selector');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = devices.length ?
    devices.map(d => '<option>' + d + '</option>').join('') :
    '<option>No ADB Device</option>';
  if (devices.includes(prev)) sel.value = prev;
  const statusEl = document.getElementById('bot-status');
  if (statusEl) {
    statusEl.textContent = devices.length ? '✅ ' + devices.length + ' device(s)' : '⚠️ No ADB Device';
  }
}
ipcRenderer.on('device-list', (e, list) => {
  updateDeviceSelector(list);
});
setInterval(() => { if(typeof ipcRenderer !== 'undefined') ipcRenderer.send('get-devices'); }, 5000);

// ─── EXECUTION ENGINE ─────────────────────────────────────────
async function runAdb(device, args) {
  execStats.adb++;
  document.getElementById('st-adb').textContent = execStats.adb;
  return await ipcRenderer.invoke('run-adb', { device, args });
}

async function runWorkflow() {
  if (!project.steps.length) { addLog('Tidak ada steps!', 'warn'); return; }

  // ── Setup UI ──────────────────────────────────────────────
  const runBtn  = document.getElementById('run-flow-btn');
  const stopBtn = document.getElementById('stop-flow-btn');
  const tbRun   = document.getElementById('tb-run-btn');
  const status  = document.getElementById('bot-status');

  stopRequested = false;
  retryState    = {};
  loopStack     = [];
  varStore      = {};
  updateVarPanel();
  execStats = { steps:0, errors:0, retries:0, adb:0, startTime:Date.now(), interval:null };
  execStats.interval = setInterval(updateRuntime, 500);

  runBtn.disabled  = true; stopBtn.disabled = false;
  runBtn.textContent = '⏳ Running...';
  if (tbRun) { tbRun.textContent = '⏳ Running...'; tbRun.disabled = true; }
  status.className = 'hdr-badge online';
  status.innerHTML = '<div class="hdr-dot"></div>ONLINE';

  const device = document.getElementById('device-selector').value;
  addLog('=== Workflow Start: ' + currentName + ' ===', 'info');

  // ═══════════════════════════════════════════════════════════
  // BANGUN EXECUTION ORDER BERDASARKAN EDGE (bukan array index)
  // ═══════════════════════════════════════════════════════════
  function buildExecutionOrder() {
    const stepMap = {};
    project.steps.forEach(s => { stepMap[s.id] = s; });

    // Build adjacency: dari setiap node, kemana edge menuju
    const nextMap = {}; // { fromId: [toId, ...] }
    const prevMap = {}; // { toId: [fromId, ...] }
    (project.edges || []).forEach(e => {
      if (!nextMap[e.from]) nextMap[e.from] = [];
      nextMap[e.from].push(e.to);
      if (!prevMap[e.to]) prevMap[e.to] = [];
      prevMap[e.to].push(e.from);
    });

    // Cari node Start (tidak punya incoming edge, atau type === 'start')
    let startNode = project.steps.find(s => String(s.type).toLowerCase() === 'start');
    if (!startNode) {
      // Fallback: node pertama yang tidak punya incoming
      startNode = project.steps.find(s => !prevMap[s.id] || prevMap[s.id].length === 0);
    }
    if (!startNode) startNode = project.steps[0];

    // Traverse graph mengikuti edge untuk bangun ordered list
    const visited  = new Set();
    const ordered  = []; // array of step objects dalam urutan eksekusi
    const queue    = [startNode.id];

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = stepMap[currentId];
      if (node) ordered.push(node);

      // Tambah semua neighbor ke queue
      const nexts = nextMap[currentId] || [];
      nexts.forEach(nId => {
        if (!visited.has(nId)) queue.push(nId);
      });
    }

    // Tambah node yang tidak terhubung (jika ada)
    project.steps.forEach(s => {
      if (!visited.has(s.id)) ordered.push(s);
    });

    return { ordered, nextMap, stepMap };
  }

  const { ordered, nextMap, stepMap } = buildExecutionOrder();

  addLog('Execution order: ' + ordered.map((s,i) => (i+1)+'.'+s.name).join(' → '), 'info');

  // ═══════════════════════════════════════════════════════════
  // MAIN EXECUTION LOOP — MENGIKUTI EDGE, BUKAN ARRAY INDEX
  // ═══════════════════════════════════════════════════════════

  // Kita tetap gunakan index ke array 'ordered' (bukan project.steps)
  // sehingga loop bisa jump back dengan benar
  let i = 0;

  while (i < ordered.length) {
    if (stopRequested) { addLog('⛔ STOP diminta', 'warn'); break; }

    const s    = ordered[i];
    const type = String(s.type || '').toLowerCase();
    const stepDevice = s.deviceId || (device !== 'No ADB Device' ? device : '');

    // ─── LOOP CONTROL (sebelum switch) ──────────────────────
    if (type === 'repeat-start') {
      const loopCount = Math.max(1, parseInt(s.loopCount) || 1);
      const loopVar   = s.loopVar || 'i';

      loopStack.push({
        startIndex: i,      // index di 'ordered' array
        count:      loopCount,
        current:    0,
        varName:    loopVar
      });
      storeVar(loopVar, 0);
      s.status = 'success'; render();
      addLog('Step '+(i+1)+': 🔁 Loop START — '+loopCount+'x', 'info');
      i++; continue;
    }

    if (type === 'repeat-end') {
      if (loopStack.length > 0) {
        const loop = loopStack[loopStack.length - 1];
        loop.current++;
        storeVar(loop.varName, loop.current);

        if (loop.current < loop.count) {
          s.status = 'success'; render();
          addLog('🔁 Iterasi '+(loop.current+1)+'/'+loop.count+' — kembali ke step '+(loop.startIndex+2), 'info');
          i = loop.startIndex + 1; // ← lompat ke step pertama DALAM loop
          continue;
        } else {
          loopStack.pop();
          addLog('✅ Loop selesai: '+loop.count+'x iterasi', 'success');
        }
      } else {
        addLog('⚠️ Loop End tanpa Loop Start di step '+(i+1), 'warn');
      }
      s.status = 'success'; render();
      i++; continue;
    }

    // ─── RETRY STATE ─────────────────────────────────────────
    if (!retryState[s.id]) {
      retryState[s.id] = {
        count:    0,
        maxRetry: parseInt(s.maxRetries)  || 0,
        delay:    parseInt(s.retryDelay)  || 1000
      };
    }
    const retry = retryState[s.id];

    execStats.steps++;
    const stEl = document.getElementById('st-steps');
    if (stEl) stEl.textContent = execStats.steps;
    s.status = 'running'; render();

    try {
      const preDelay = parseInt(s.delay) || 0;
      if (preDelay > 0 && type !== 'delay') await wait(preDelay);

      // ─── SWITCH (satu, bersih, tanpa duplikat) ─────────────
      switch (type) {

        case 'start':
          addLog('Step '+(i+1)+': 🟢 START', 'info');
          break;

        case 'delay': {
          const ms = parseInt(s.delay) || 1000;
          addLog('Step '+(i+1)+': ⏱ Delay '+ms+'ms', 'info');
          await wait(ms);
          addLog('  ✓ Selesai', 'success');
          break;
        }

        case 'mobile-tap': {
          const x = parseInt(s.mx)||0, y = parseInt(s.my)||0;
          if (!stepDevice) throw new Error('Tidak ada device ADB terpilih');
          addLog('Step '+(i+1)+': 📱 ADB Tap ('+x+','+y+')', 'info');
          const r = await runAdb(stepDevice, 'shell input tap '+x+' '+y);
          if (!r.success) throw new Error('Tap gagal: '+r.error);
          addLog('  ✓ Tap OK', 'success');
          break;
        }

        case 'mobile-swipe': {
          const sx=parseInt(s.sx)||0, sy=parseInt(s.sy)||0;
          const ex=parseInt(s.ex)||0, ey=parseInt(s.ey)||0;
          const dur=parseInt(s.dur)||300;
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          addLog('Step '+(i+1)+': 📱 Swipe ('+sx+','+sy+')→('+ex+','+ey+') '+dur+'ms', 'info');
          const r = await runAdb(stepDevice, 'shell input swipe '+sx+' '+sy+' '+ex+' '+ey+' '+dur);
          if (!r.success) throw new Error('Swipe gagal: '+r.error);
          addLog('  ✓ Swipe OK', 'success');
          break;
        }

        case 'swipe':
        case 'scroll-page': {
          if (!stepDevice) { await wait(300); break; }
          const map = {up:'540 1500 540 500',down:'540 500 540 1500',left:'1000 800 200 800',right:'200 800 1000 800'};
          const coords = map[s.dir||'down']||map['down'];
          const r = await runAdb(stepDevice, 'shell input swipe '+coords+' '+(parseInt(s.dur)||500));
          if (!r.success) throw new Error('Swipe gagal: '+r.error);
          addLog('Step '+(i+1)+': ✓ Scroll '+(s.dir||'down')+' OK', 'success');
          break;
        }

        case 'mobile-press-key': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const r = await runAdb(stepDevice, 'shell input keyevent '+(s.keyCode||'4'));
          if (!r.success) throw new Error('Keyevent gagal: '+r.error);
          addLog('Step '+(i+1)+': ✓ Key '+(s.keyCode||'4')+' OK', 'success');
          break;
        }

        case 'type-into': {
          const txt = interpolate(s.text||'');
          if (stepDevice) {
            if (s.cx && s.cy) { await runAdb(stepDevice,'shell input tap '+s.cx+' '+s.cy); await wait(500); }
            if (s.clearBefore==='yes') { await runAdb(stepDevice,'shell input keyevent 67'); await wait(200); }
            const esc = txt.replace(/ /g,'%s').replace(/'/g,"\\'").replace(/"/g,'\\"');
            const r = await runAdb(stepDevice, 'shell input text "'+esc+'"');
            if (!r.success) throw new Error('Type gagal: '+r.error);
          } else {
            await wait(Math.max(200, txt.length*(parseInt(s.typeSpeed)||30)));
          }
          addLog('Step '+(i+1)+': ✓ Type "'+txt.substring(0,30)+'"', 'success');
          break;
        }

        case 'tap':
        case 'click': {
          if (stepDevice && s.cx && s.cy) {
            const r = await runAdb(stepDevice,'shell input tap '+s.cx+' '+s.cy);
            if (!r.success) throw new Error(r.error);
          } else { await wait(500); }
          addLog('Step '+(i+1)+': ✓ Click OK', 'success');
          break;
        }

        case 'open-browser': {
          const url = interpolate(s.url||'https://example.com');
          ipcRenderer.send('open-external', url);
          await wait(parseInt(s.waitAfterLoad)||2000);
          addLog('Step '+(i+1)+': ✓ Browser: '+url, 'success');
          break;
        }

        case 'open-app': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const pkg = s.var||s.text||'';
          if (!pkg) throw new Error('Package name kosong (isi Output Variable)');
          const r = await runAdb(stepDevice,'shell monkey -p '+pkg+' -c android.intent.category.LAUNCHER 1');
          if (!r.success) throw new Error('Launch gagal: '+r.error);
          await wait(2000);
          addLog('Step '+(i+1)+': ✓ App: '+pkg, 'success');
          break;
        }

        case 'close-app': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const pkg = s.var||s.text||'';
          if (!pkg) throw new Error('Package name kosong');
          const r = await runAdb(stepDevice,'shell am force-stop '+pkg);
          if (!r.success) throw new Error('Stop gagal: '+r.error);
          addLog('Step '+(i+1)+': ✓ Closed: '+pkg, 'success');
          break;
        }

        case 'mobile-screenshot': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          
          // DEBUG: Log sebelum screenshot
          console.log('[EXEC] Step '+(i+1)+': mobile-screenshot');
          console.log('[EXEC] Node config:', JSON.stringify(s));
          
          // Import screenshot utility
          const { takeScreenshot, getTimestamp } = require('./adb-screenshot');
          
          // Generate filename with timestamp
          const timestamp = getTimestamp();
          const filename = `screenshot_${timestamp}.png`;
          
          // Determine local save path
          const safeDir = 'C:\\rba_output';
          const fs2 = require('fs');
          const path2 = require('path');
          try { if (!fs2.existsSync(safeDir)) fs2.mkdirSync(safeDir, {recursive:true}); } catch(e) {}
          const localPath = fs2.existsSync(safeDir)
            ? path2.join(safeDir, filename)
            : path2.join(require('os').tmpdir(), filename);
          
          addLog('Step '+(i+1)+': 📸 Screenshot → '+localPath, 'info');
          
          // BUG #3 FIX: Use takeScreenshot with full JPG + Gallery support
          const result = await takeScreenshot(stepDevice, localPath, {
            deviceFolder: '/sdcard/DCIM/Screenshots/',
            prefix: 'screen',
            deleteDeviceFile: false,
            convertToJpg: true
          });
          
          console.log('[SCREENSHOT] Result:', result);
          console.log('[SCREENSHOT] Format:', result.format || 'png');
          
          if (!result.success) {
            throw new Error('Screenshot gagal: ' + result.error);
          }
          
          // Result.localPath already contains JPG path (if conversion succeeded)
          const outputPath = result.localPath;
          
          // Log results
          addLog('  ✓ Laptop: '+outputPath, 'success');
          addLog('  ✓ Device: '+result.devicePath, 'success');
          addLog('  ✓ Format: '+(result.format||'png'), 'info');
          addLog('  ✓ Media Scanner triggered', 'success');
          
          // BUG #2 FIX: Support both 'var' and 'outputVariable'
          const varName = s.var || s.outputVariable;
          if (varName) {
            storeVar(varName, outputPath);
            console.log('[VAR] ' + varName + ' = ' + outputPath);
            addLog('  [VAR] {' + varName + '} = ' + outputPath.substring(0, 50) + '...', 'info');
          } else {
            console.log('[VAR] No output variable specified');
          }
          
          break;
        }

        case 'screenshot-page': {
          if (stepDevice) {
            const r=await runAdb(stepDevice,'shell uiautomator dump /sdcard/ocr.xml && cat /sdcard/ocr.xml');
            if(r.success){
              const texts=[];const rx2=/text="([^"]+)"/g;let m2;
              while((m2=rx2.exec(r.output))!==null&&texts.length<20)texts.push(m2[1]);
              if(s.var)storeVar(s.var,texts.join(' | '));
              addLog('Step '+(i+1)+': ✓ OCR: '+texts.slice(0,3).join(', '),'success');
              await runAdb(stepDevice,'shell rm /sdcard/ocr.xml');
            }
          } else { addLog('Step '+(i+1)+': OCR butuh device','warn'); }
          break;
        }

        case 'read-ui-element':
        case 'mobile-find-text': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          
          // BUG #2 FIX: Resolve variables with logging
          const searchTxt = resolveWithLog('searchText', s.selector||s.text||'');
          if (!searchTxt) throw new Error('Teks untuk dicari kosong');
          
          const xmlPath = require('path').join(require('os').tmpdir(), 'ui_dump_'+Date.now()+'.xml');
          addLog('Step '+(i+1)+': 🔎 Cari "'+searchTxt+'"...', 'info');
          const r1 = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ui_rba.xml');
          if (!r1.success) throw new Error('uiautomator dump gagal: '+r1.error);
          await wait(800);
          const r2 = await runAdb(stepDevice, 'pull /sdcard/ui_rba.xml "'+xmlPath.replace(/\\/g,'/')+'"');
          if (!r2.success) throw new Error('pull XML gagal: '+r2.error);
          const fs4=require('fs');
          if (!fs4.existsSync(xmlPath)) throw new Error('XML tidak ditemukan');
          const xml = fs4.readFileSync(xmlPath,'utf8');
          const esc4 = searchTxt.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
          const tm = xml.match(new RegExp('text="([^"]*'+esc4+'[^"]*)"','i'));
          if (tm) {
            const seg = xml.substring(xml.lastIndexOf('<',xml.indexOf(tm[0])));
            const bm  = seg.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
            if (bm) {
              const coords={x:Math.round((+bm[1]+ +bm[3])/2),y:Math.round((+bm[2]+ +bm[4])/2)};
              if(s.var){storeVar(s.var,tm[1]);storeVar(s.var+'_coords',coords);}
              addLog('  ✓ Ditemukan: "'+tm[1]+'" di ('+coords.x+','+coords.y+')', 'success');
              if(s.autoTap) await runAdb(stepDevice,'shell input tap '+coords.x+' '+coords.y);
            }
          } else { throw new Error('Teks "'+searchTxt+'" tidak ditemukan di UI'); }
          try{fs4.unlinkSync(xmlPath);}catch(e){}
          await runAdb(stepDevice,'shell rm /sdcard/ui_rba.xml');
          break;
        }

        case 'api-request': {
          const url=interpolate(s.apiUrl||'');
          if(!url)throw new Error('URL API kosong');
          addLog('Step '+(i+1)+': 🌐 '+(s.apiMethod||'GET')+' '+url,'info');
          let hdrs={'User-Agent':'RBA-Studio/2.0'};
          if(s.apiHeaders){try{hdrs={...hdrs,...JSON.parse(s.apiHeaders)};}catch(e){}}
          const apiRes=await new Promise((resolve,reject)=>{
            const uo=new URL(url),lib=uo.protocol==='https:'?require('https'):require('http');
            const opts={hostname:uo.hostname,port:uo.port||(uo.protocol==='https:'?443:80),path:uo.pathname+uo.search,method:s.apiMethod||'GET',headers:hdrs,timeout:15000};
            const req=lib.request(opts,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,data:d}));});
            req.on('error',reject);req.on('timeout',()=>{req.destroy();reject(new Error('timeout'));});
            if(['POST','PUT','PATCH'].includes(s.apiMethod)&&s.apiBody)req.write(interpolate(s.apiBody));
            req.end();
          });
          addLog('  Response: '+apiRes.status+' ('+apiRes.data.length+' chars)',apiRes.status<400?'success':'warn');
          if(s.var){try{storeVar(s.var,JSON.parse(apiRes.data));}catch(e){storeVar(s.var,apiRes.data);}}
          if(apiRes.status>=400)throw new Error('HTTP '+apiRes.status);
          break;
        }

        case 'input-dialog': {
          const q=s.text||s.name||'Masukkan nilai:';
          const def=s.var?(varStore[s.var]||''):'';
          const val=prompt(q+(def?'\n(Default: '+def+')':''),def);
          if(val!==null&&s.var){storeVar(s.var,val);addLog('Step '+(i+1)+': ✓ Input {'+s.var+'} = "'+val+'"','success');}
          break;
        }

        case 'if-condition': {
          const expr=interpolate(s.condition||'true');
          let cond=false;
          try{const fn=new Function(...Object.keys(varStore),'return ('+expr+')');cond=Boolean(fn(...Object.values(varStore)));}catch(e){}
          addLog('Step '+(i+1)+': ❓ "'+expr+'" = '+cond,cond?'success':'warn');
          if(s.var)storeVar(s.var,cond);
          break;
        }

        case 'wait-element': {
          const timeout=parseInt(s.waitTimeout)||10000;
          const sel=s.waitSelector||'';
          addLog('Step '+(i+1)+': ⏳ Wait ['+sel+'] max '+timeout+'ms','info');
          if(stepDevice&&sel){
            const t0=Date.now();
            while(Date.now()-t0<timeout){
              const r=await runAdb(stepDevice,'shell uiautomator dump /sdcard/ui_wait.xml && cat /sdcard/ui_wait.xml');
              if(r.success&&r.output.includes(sel)){addLog('  ✓ Element ditemukan!','success');break;}
              await wait(1000);
            }
          } else {await wait(Math.min(timeout,3000));}
          break;
        }

        case 'ocr': {
          // BUG #4 FIX: Validate both required fields
          console.log('[OCR] Step '+(i+1)+': ocr');
          console.log('[OCR] Node config:', JSON.stringify(s));
          
          // BUG #4: Support searchText field (what text to search for)
          const searchText = resolveWithLog('searchText', s.text || s.selector || '');
          
          // Support both 'var' and 'outputVariable'
          const varName = s.var || s.outputVariable;
          const imagePath = varName ? varStore[varName] : null;
          
          console.log('[OCR] varName:', varName, 'imagePath:', imagePath, 'searchText:', searchText);
          
          // BUG #4: Validate screenshot path from variable
          const hasImagePath = imagePath && fs.existsSync(imagePath);

          if (hasImagePath) {
            console.log('[OCR] Using image from variable:', imagePath);

            const { convertPngToJpg } = require('./image-convert');
            const ext = path.extname(imagePath).toLowerCase();

            let ocrImagePath = imagePath;
            if (ext === '.png') {
              const jpgPath = imagePath.replace(/\.png$/i, '.jpg');
              const convResult = await convertPngToJpg(imagePath, jpgPath);
              if (convResult.success) {
                ocrImagePath = convResult.outputPath;
                console.log('[OCR] Converted PNG → JPG:', ocrImagePath);
              }
            }

            try {
              const tesseract = require('tesseract.js');
              console.log('[OCR] Running Tesseract on:', ocrImagePath);

              const { data: { text } } = await tesseract.recognize(ocrImagePath, 'eng+ind');
              const extractedText = text.trim();

              console.log('[OCR] Extracted text:', extractedText.substring(0, 100));

              let ocrResult = extractedText;
              let found = false;
              if (searchText && searchText.trim() !== '') {
                found = extractedText.toLowerCase().includes(searchText.toLowerCase());
                ocrResult = found ? 'DITEMUKAN: ' + searchText : 'TIDAK DITEMUKAN';
                console.log('[OCR] Search "' + searchText + '":', found);

                if (varName) {
                  storeVar(varName, found);
                  storeVar(varName + '_text', extractedText);
                }
              } else {
                if (varName) {
                  storeVar(varName, extractedText);
                }
              }

              addLog('Step '+(i+1)+': ✓ OCR: '+ocrResult.substring(0, 50)+'...', 'success');
            } catch (ocrErr) {
              console.log('[OCR] Tesseract error:', ocrErr.message);
              throw new Error('OCR pada file lokal gagal: ' + ocrErr.message + '\nPastikan Tesseract.js terinstall: npm install tesseract.js');
            }
          } else if (stepDevice) {
            console.log('[OCR] Using device uiautomator dump (fallback)');

            if (!searchText || searchText.trim() === '') {
              throw new Error('Teks untuk dicari kosong. Isi field "Teks yang dicari" pada node OCR.');
            }

            const r = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ocr.xml && cat /sdcard/ocr.xml');
            if (r.success) {
              const texts = [];
              const rx2 = /text="([^"]+)"/g;
              let m2;
              while ((m2 = rx2.exec(r.output)) !== null && texts.length < 20) {
                texts.push(m2[1]);
              }

              const found = texts.join(' | ').toLowerCase().includes(searchText.toLowerCase());
              if (varName) {
                storeVar(varName, found);
              }
              addLog('Step '+(i+1)+': ✓ OCR: '+(found ? 'DITEMUKAN' : 'TIDAK DITEMUKAN')+' "'+searchText+'"', found ? 'success' : 'warn');
              await runAdb(stepDevice, 'shell rm /sdcard/ocr.xml');
            } else {
              throw new Error('OCR gagal: ' + r.error);
            }
          } else {
            throw new Error('OCR butuh gambar. Tambahkan node Mobile Screenshot sebelumnya dan simpan ke variable.');
          }
          break;
        }

        case 'read-csv': {
          const fp=interpolate(s.filePath||'');if(!fp)break;
          const fs5=require('fs');if(!fs5.existsSync(fp))throw new Error('File tidak ada: '+fp);
          const rows=fs5.readFileSync(fp,'utf8').split('\n').filter(l=>l.trim()).slice(s.skipHeader==='yes'?1:0).map(l=>l.split(s.delimiter||',').map(c=>c.trim()));
          if(s.var)storeVar(s.var,rows);
          addLog('Step '+(i+1)+': ✓ CSV: '+rows.length+' baris','success');
          break;
        }

        case 'write-csv': {
          const data=s.var?(varStore[s.var]||[]):[];
          const fp=interpolate(s.filePath||'output_'+Date.now()+'.csv');
          const content=Array.isArray(data)?data.map(row=>Array.isArray(row)?row.join(s.delimiter||','):String(row)).join('\n'):String(data);
          require('fs').writeFileSync(fp,content,s.encoding||'utf8');
          addLog('Step '+(i+1)+': ✓ CSV: '+fp,'success');
          break;
        }

        case 'download-file': {
          const url=interpolate(s.url||s.var||'');if(!url)throw new Error('URL kosong');
          const lp=require('path').join(require('os').homedir(),'Downloads',require('path').basename(s.filePath||'dl_'+Date.now()));
          await new Promise((res3,rej3)=>{const uo2=new URL(url),lib2=uo2.protocol==='https:'?require('https'):require('http'),f=require('fs').createWriteStream(lp);lib2.get(url,r=>{r.pipe(f);f.on('finish',()=>{f.close();res3();});}).on('error',rej3);});
          if(s.var)storeVar(s.var,lp);
          addLog('Step '+(i+1)+': ✓ Download: '+lp,'success');
          break;
        }

        case 'json-processing': {
          if(s.var&&varStore[s.var]){try{const p=typeof varStore[s.var]==='string'?JSON.parse(varStore[s.var]):varStore[s.var];storeVar(s.var,p);addLog('Step '+(i+1)+': ✓ JSON OK','success');}catch(e){addLog('JSON error: '+e.message,'warn');}}
          break;
        }

        case 'debug-step': {
          const vars=Object.entries(varStore).map(([k,v])=>'{'+k+'}='+String(v).substring(0,30)).join('\n');
          addLog('Step '+(i+1)+': 🐛 DEBUG PAUSE','warn');
          alert('DEBUG Step '+(i+1)+': '+s.name+'\n\nVariables:\n'+(vars||'(kosong)')+'\n\nOK untuk lanjut');
          break;
        }

        case 'performance-track': {
          const ms=Date.now()-execStats.startTime;
          if(s.var)storeVar(s.var,ms);
          addLog('Step '+(i+1)+': 📈 '+ms+'ms','info');
          break;
        }

        case 'signature-swipe': {
          if(!stepDevice)throw new Error('Tidak ada device ADB');
          const x1=parseInt(s.sigX1)||200,y1=parseInt(s.sigY1)||800;
          const x2=parseInt(s.sigX2)||800,y2=parseInt(s.sigY2)||800;
          const dur=parseInt(s.sigDuration)||1500;
          addLog('Step '+(i+1)+': ✍️ Signature ('+x1+','+y1+')→('+x2+','+y2+')','info');
          const result=await executeSignatureSwipe(stepDevice,x1,y1,x2,y2,dur);
          addLog('  ✓ OK ('+result.points+' titik)','success');
          break;
        }

        case 'regex-extraction': {
          const src=s.var?String(varStore[s.var]||''):'';
          if(src&&s.regex){try{const matches=[...src.matchAll(new RegExp(s.regex,'g'))].map(m=>m[0]);storeVar((s.var||'result')+'_matches',matches);addLog('Step '+(i+1)+': ✓ Regex: '+matches.length+' match','success');}catch(e){addLog('Regex error: '+e.message,'warn');}}
          break;
        }

        case 'filter-data': {
          const data=s.var?varStore[s.var]:null;
          if(Array.isArray(data)&&s.condition){try{const filtered=data.filter(item=>{const fn=new Function('item','return ('+s.condition+')');return fn(item);});storeVar(s.var,filtered);addLog('Step '+(i+1)+': ✓ Filter: '+data.length+'→'+filtered.length,'success');}catch(e){addLog('Filter error: '+e.message,'warn');}}
          break;
        }

        case 'batch-slice': {
          const data=s.var?varStore[s.var]:null;
          if(Array.isArray(data)){const sz=parseInt(s.loopCount)||10,batches=[];for(let j=0;j<data.length;j+=sz)batches.push(data.slice(j,j+sz));storeVar((s.var||'data')+'_batches',batches);addLog('Step '+(i+1)+': ✓ Batch: '+batches.length+'x'+sz,'success');}
          break;
        }

        case 'copy-paste-var': {
          const src=s.selector||'',dst=s.var||'';
          if(src&&dst&&varStore[src]!==undefined){storeVar(dst,varStore[src]);addLog('Step '+(i+1)+': ✓ {'+src+'}→{'+dst+'}','success');}
          break;
        }

        case 'extract-text':
        case 'extract-table': {
          addLog('Step '+(i+1)+': Extract ['+s.selector+'] → {'+s.var+'}','info');
          if(s.var)storeVar(s.var,'extracted_'+Date.now());
          await wait(500);
          break;
        }

        // ── Semua case simulasi ──────────────────────────────
        case 'webhook-trigger':case 'cron-job':case 'event-trigger':case 'parallel-start':case 'parallel-end':case 'try-catch':case 'retry-logic':
        case 'sub-workflow':case 'macro-recorder':case 'headless-mode':case 'credential-manager':
        case 'auto-selector':case 'file-system':case 'handle-popup':case 'upload-file':
        case 'pagination':case 'infinite-scroll':case 'database-query':case 'write-excel':
        case 'ai-decision': {
          addLog('Step '+(i+1)+': ['+type+'] (simulasi OK)','info');
          await wait(parseInt(s.delay)||300);
          break;
        }

        default: {
          addLog('Step '+(i+1)+': ['+type+'] tidak dikenali, skip','warn');
          await wait(300);
        }

      } // ← AKHIR SWITCH (hanya SATU switch)

      // ── Step sukses ───────────────────────────────────────
      s.status = 'success';
      delete retryState[s.id];

    } catch(err) {
      // ── Error + Retry ─────────────────────────────────────
      execStats.errors++;
      const errEl = document.getElementById('st-errors');
      if (errEl) errEl.textContent = execStats.errors;
      addLog('  ✗ Error: '+err.message, 'error');

      if (retry.count < retry.maxRetry) {
        retry.count++;
        execStats.retries++;
        const retEl = document.getElementById('st-retries');
        if (retEl) retEl.textContent = execStats.retries;
        addLog('  🔄 Retry '+retry.count+'/'+retry.maxRetry+' ('+retry.delay+'ms)...','warn');
        s.status = 'running'; render();
        await wait(retry.delay);
        continue; // ← JANGAN i++, retry step yang sama
      }

      s.status = 'error';
      delete retryState[s.id];
    }

    render();
    await wait(50);
    i++;
  }

  // ── Selesai ───────────────────────────────────────────────
  clearInterval(execStats.interval);
  addLog('=== Workflow '+(stopRequested?'STOPPED':'Complete ✅')+' ===', stopRequested?'warn':'success');

  // BUG #1 FIX: Reset input state after flow completion
  isFlowRunning = false;
  resetPanelState();  // Re-enable all property panel inputs
  
  // Explicitly re-enable all property panel inputs (extra safety)
  document.querySelectorAll('.prop-input, .prop-textarea, textarea[id^="pe-"]').forEach(el => {
    el.disabled = false;
    el.removeAttribute('disabled');
    el.removeAttribute('readonly');
    el.style.pointerEvents = 'auto';
    el.style.opacity = '1';
    el.style.cursor = 'text';
  });
  console.log('[FLOW] Panel inputs re-enabled after flow completion');

  runBtn.disabled=false; stopBtn.disabled=true;
  runBtn.textContent='▶ RUN';
  if (tbRun) { tbRun.textContent='▶ Run'; tbRun.disabled=false; }
  status.className='hdr-badge offline';
  status.innerHTML='<div class="hdr-dot"></div>OFFLINE';

  setTimeout(()=>{ project.steps.forEach(s=>s.status=''); render(); }, 3000);
}



async function runSingleStep() {
  if (selectedIdx === null) return;
  const s = project.steps[selectedIdx];
  s.status='running'; render();
  addLog('Running single step: '+s.name, 'info');
  await wait(s.delay||0);
  s.status='success'; render();
  addLog('Step done', 'success');
  setTimeout(()=>{ s.status=''; render(); }, 2000);
}

function stopWorkflow() {
  stopRequested = true;
  document.getElementById('stop-flow-btn').disabled = true;
  addLog('⛔ Emergency STOP', 'warn');
}

function wait(ms) { return new Promise(r=>setTimeout(r, Math.max(0, ms))); }

// ─── Logging ──────────────────────────────────────────────────
function addLog(msg, type='info') {
  const out = document.getElementById('log-output');
  const ts  = new Date().toLocaleTimeString();
  out.innerHTML += '<span class="log-ts">[' + ts + ']</span> <span class="log-' + type + '">' + msg + '</span><br>';
  out.scrollTop = out.scrollHeight;
}
function logAutoDetection(msg, type='info') {
  addLog('[Auto] ' + msg, type);
}
function safeCall(name, fn) {
  return function(...args) {
    try {
      return fn(...args);
    } catch (err) {
      addLog(name + ' failed: ' + (err?.message || err), 'error');
      console.error(err);
    }
  };
}
function clearLog() { document.getElementById('log-output').innerHTML=''; }
function toggleLog() {
  const strip = document.getElementById('log-strip');
  strip.classList.toggle('collapsed');
  const btn = document.getElementById('log-toggle-btn');
  btn.textContent = strip.classList.contains('collapsed') ? '▲' : '▼';
}
function updateRuntime() {
  const sec = Math.floor((Date.now()-execStats.startTime)/1000);
  const m = Math.floor(sec/60), s = sec%60;
  document.getElementById('st-runtime').textContent = m+':'+(s<10?'0':'')+s;
}

// ─── Theme ───────────────────────────────────────────────────
function toggleTheme() {
  try {
    const root = document.documentElement;
    const newTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', newTheme);
    if (newTheme === 'light') {
      root.style.setProperty('--accent', '#74A8A4');
      root.style.setProperty('--accent2', '#5f9c95');
    } else {
      root.style.setProperty('--accent', '#3b82f6');
      root.style.setProperty('--accent2', '#6366f1');
    }
    prefs.theme = newTheme;
    ipcRenderer.invoke('save-settings', prefs).catch(() => {});
    logAutoDetection('Theme switched to ' + newTheme, 'info');
  } catch (err) {
    addLog('toggleTheme failed: ' + err.message, 'error');
  }
}

// ─── Settings ────────────────────────────────────────────────
async function loadPrefs() {
  const s = await ipcRenderer.invoke('get-settings');
  Object.assign(prefs, s);
  document.documentElement.setAttribute('data-theme', prefs.theme || 'dark');
  document.getElementById('pref-autosave').checked = prefs.autoSave;
  document.getElementById('pref-confirm').checked  = prefs.confirmDelete;
  document.getElementById('pref-snap').checked     = prefs.snap;
  document.getElementById('pref-stepnum').checked  = prefs.showStepNum;
  document.getElementById('pref-animate').checked  = prefs.animate;
  if (prefs.adbPath) document.getElementById('adb-path-input').value = prefs.adbPath;
}
function savePref() {
  prefs.autoSave    = document.getElementById('pref-autosave').checked;
  prefs.confirmDelete = document.getElementById('pref-confirm').checked;
  prefs.snap        = document.getElementById('pref-snap').checked;
  prefs.showStepNum = document.getElementById('pref-stepnum').checked;
  prefs.animate     = document.getElementById('pref-animate').checked;
  snapToGrid = prefs.snap;
  ipcRenderer.invoke('save-settings', prefs);
  render();
}
function saveAdbPath() {
  prefs.adbPath = document.getElementById('adb-path-input').value;
  ipcRenderer.invoke('save-settings', prefs);
  addLog('ADB path saved: '+prefs.adbPath, 'info');
}
function setLang(l) { prefs.lang=l; ipcRenderer.invoke('save-settings',prefs); }
function resetAllSettings() { if(confirm('Reset semua settings?')) { ipcRenderer.invoke('save-settings',{}); location.reload(); } }

// ─── Macro Recorder View ──────────────────────────────────────
function startMacroRecord() {
  macroRecording = true;
  document.getElementById('rec-start-btn').disabled = true;
  document.getElementById('rec-stop-btn').disabled  = false;
  document.getElementById('rec-save-btn').disabled  = true;
  document.getElementById('rec-badge').className = 'rec-badge active';
  document.getElementById('rec-badge2').style.display = 'flex';
  addLog('Macro recording started', 'info');
  document.getElementById('rec-steps').innerHTML = '<span style="color:var(--green);">● Recording... klik area di bawah ini</span><br>';
  document.getElementById('rec-steps').addEventListener('click', recordClick);
}
function recordClick(e) {
  const el = document.getElementById('rec-steps');
  const rect = el.getBoundingClientRect();
  const x = Math.round(e.clientX - rect.left);
  const y = Math.round(e.clientY - rect.top);
  macroSteps.push({ id:Date.now(), name:'Tap ('+x+','+y+')', type:'mobile-tap', mx:x, my:y, delay:500, var:'', comment:'', status:'' });
  el.innerHTML += '<span style="color:var(--dim2);">↳ Tap at ('+x+', '+y+')</span><br>';
}
function stopMacroRecord() {
  macroRecording = false;
  document.getElementById('rec-start-btn').disabled = false;
  document.getElementById('rec-stop-btn').disabled  = true;
  document.getElementById('rec-save-btn').disabled  = macroSteps.length === 0;
  document.getElementById('rec-badge').className = 'rec-badge';
  document.getElementById('rec-badge2').style.display = 'none';
  document.getElementById('rec-steps').removeEventListener('click', recordClick);
  addLog('Macro stopped. '+macroSteps.length+' steps recorded.', 'info');
}
function clearRecordedSteps() { macroSteps=[]; document.getElementById('rec-steps').innerHTML='Klik Start Recording...'; document.getElementById('rec-save-btn').disabled=true; }
function saveRecordedToWorkflow() {
  pushHistory();
  project.steps.push(...macroSteps.map(s=>({...s})));
  project.edges = project.steps.slice(0,-1).map((s,i)=>({ id:'e-'+Date.now()+i, from:s.id, to:project.steps[i+1].id, label:'' }));
  autoLayout(); render(); switchView('editor');
  addLog('Macro saved: '+macroSteps.length+' steps added', 'success');
}

// ─── Keyboard Shortcuts ───────────────────────────────────────
window.addEventListener('keydown', e => {
  const t = e.target.tagName;
  if (t==='INPUT'||t==='TEXTAREA'||t==='SELECT') return;
  if (e.key === 'F1' || (e.shiftKey && e.key === '?')) { e.preventDefault(); showShortcutHelp(); }
  if (e.ctrlKey) {
    switch(e.key.toLowerCase()) {
      case 'z': e.preventDefault(); e.shiftKey ? redoAction() : undoAction(); break;
      case 'y': e.preventDefault(); redoAction(); break;
      case 's': e.preventDefault(); saveCurrentProject(); break;
      case 'n': e.preventDefault(); createNew(); break;
      case 'o': e.preventDefault(); document.getElementById('fileInput').click(); break;
      case '=': case '+': e.preventDefault(); zoomIn(); break;
      case '-': e.preventDefault(); zoomOut(); break;
      case '0': e.preventDefault(); resetZoom(); break;
      case 'a': e.preventDefault(); selectAll(); break;
      case 'c': e.preventDefault(); copySelected(); break;
      case 'v': e.preventDefault(); pasteNodes(); break;
      case 'd': e.preventDefault(); duplicateSelected(); break;
    }
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { if(selectedIdx!==null) deleteSelected(); }
  if (e.key === 'Escape') { closeCtxMenu(); showPropEmpty(); selectedIdx=null; multiSelect=[]; render(); }
});

// ─── INIT ─────────────────────────────────────────────────────
(async function init() {
  await loadPrefs();
  await loadSavedProjects();
  updateDashboardStats();
  createNew();
  applyTransform();
  addLog('RBA Studio Pro 2.0 ready!', 'success');
  addLog('Tip: Drag activities dari panel kiri ke canvas, lalu drag port biru untuk menghubungkan nodes.', 'info');
  // Check ADB before refreshing devices
  const adbInfo = await ipcRenderer.invoke('adb-info');
  if (adbInfo.found) {
    refreshDevices();
    updateDashboardStats();
  } else {
    addLog('ADB tidak ditemukan. Install ADB untuk fitur device Android.', 'warn');
  }
  window.ipcRenderer = ipcRenderer;
  window.switchView = safeCall('switchView', switchView);
  window.toggleTheme = safeCall('toggleTheme', toggleTheme);
  window.refreshDevices = safeCall('refreshDevices', refreshDevices);
  window.createNew = safeCall('createNew', createNew);
  window.loadSavedProjects = safeCall('loadSavedProjects', loadSavedProjects);
  window.openProject = safeCall('openProject', openProject);
  window.deleteProject = safeCall('deleteProject', deleteProject);
  window.showAdbInfo = safeCall('showAdbInfo', showAdbInfo);
  window.showTemplateModal = safeCall('showTemplateModal', showTemplateModal);

  // Auto-save timer (BUG #14)
  if (prefs.autoSave) {
    setInterval(function() {
      if (isDirty && project.steps.length > 0) {
        saveCurrentProject();
      }
    }, prefs.autoSaveInterval || 30000);  // Default 30 seconds
  }
})();


