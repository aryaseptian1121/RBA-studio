// ============================================================
// RBA STUDIO PRO — main.js (Electron Main Process)
// Author: Arya Septian  |  Version: 2.0
// ============================================================
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { exec, execSync, spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const projectsFile = path.join(app.getPath("userData"), "rba-workflows.json");
const settingsFile  = path.join(app.getPath("userData"), "rba-settings.json");

// ─────────────────────────────────────────
// PERSIST HELPERS
// ─────────────────────────────────────────
function loadSavedWorkflows() {
    try { if (!fs.existsSync(projectsFile)) return []; return JSON.parse(fs.readFileSync(projectsFile,"utf8"))||[]; } catch(e){ return []; }
}
function saveWorkflowsFile(list) {
    try { fs.writeFileSync(projectsFile, JSON.stringify(list,null,2)); } catch(e){}
    return list;
}
function loadSettings() {
    try { if (!fs.existsSync(settingsFile)) return {}; return JSON.parse(fs.readFileSync(settingsFile,"utf8"))||{}; } catch(e){ return {}; }
}
function saveSettingsFile(obj) {
    try { fs.writeFileSync(settingsFile, JSON.stringify(obj,null,2)); } catch(e){}
    return obj;
}

// ─────────────────────────────────────────
// DEVICE POOL & ADB
// ─────────────────────────────────────────
class DevicePool {
    constructor() { this.devices=[]; this.adbPath=null; this.scrcpyPath=null; this.scrcpyProc=null; }

    findAdb() {
        if (this.adbPath) return this.adbPath;
        const candidates = [];
        
        // 1. Try which (macOS/Linux) or where (Windows)
        try {
            const cmd = os.platform()==='win32' ? 'where adb' : 'which adb';
            const result = execSync(cmd, { stdio:['ignore','pipe','ignore'], encoding:'utf8' });
            const found = result.trim().split(/\r?\n/)[0];
            if (found) candidates.push(found);
        } catch(e){}
        
        // 2. Config from preferences or env
        const settings = loadSettings();
        if (settings.adbPath) candidates.push(settings.adbPath);
        const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
        if (androidHome) {
            candidates.push(path.join(androidHome, 'platform-tools', os.platform()==='win32' ? 'adb.exe' : 'adb'));
        }
        if (process.env.ADB_PATH) {
            for (const cand of process.env.ADB_PATH.split(path.delimiter).filter(Boolean)) {
                candidates.push(cand);
            }
        }

        // 3. Local project scrcpy folder (production: resourcesPath, dev: __dirname)
        const isPackaged = app.isPackaged;
        const basePath = isPackaged ? path.join(process.resourcesPath, '..') : __dirname;
        const localAdb = path.join(basePath, 'scrcpy', os.platform()==='win32' ? 'adb.exe' : 'adb');
        candidates.push(localAdb);
        const localAdbRoot = path.join(basePath, os.platform()==='win32' ? 'adb.exe' : 'adb');
        candidates.push(localAdbRoot);

        // 4. Platform default paths
        if (os.platform() === 'win32') {
            candidates.push(path.join(os.homedir(),'AppData','Local','Android','Sdk','platform-tools','adb.exe'));
            // Fallback to userData path
            candidates.push(path.join(app.getPath('userData'), 'adb', 'adb.exe'));
        } else {
            candidates.push('/usr/local/bin/adb', '/usr/bin/adb');
        }

        for (const cand of candidates) {
            if (cand && fs.existsSync(cand)) { this.adbPath=cand; return cand; }
        }
        return null;
    }

    adb(args, device, cb) {
        const bin = this.findAdb() || 'adb';
        const dFlag = device ? `-s "${device}"` : '';
        const cmd = `"${bin}" ${dFlag} ${args}`;
        exec(cmd, { timeout: 30000, maxBuffer: 50*1024*1024, encoding:'utf8' }, (err, stdout, stderr) => {
            cb({ success:!err, output:stdout||'', error:err?.message||stderr||'' });
        });
    }

    refresh() {
        try {
            const bin = this.findAdb() || 'adb';
            const out = execSync(`"${bin}" devices`, { encoding:'utf8', timeout:5000 });
            this.devices = out.split('\n').slice(1)
                .map(l=>l.trim())
                .filter(l => l && l.includes('\tdevice'))
                .map(l => l.split(/\s+/)[0]);
        } catch(e) { this.devices=[]; }
        return this.devices;
    }

    findScrcpy() {
        if (this.scrcpyPath) return this.scrcpyPath;
        const candidates = [];
        try {
            const cmd = os.platform()==='win32' ? 'where scrcpy' : 'which scrcpy';
            const result = execSync(cmd,{stdio:['ignore','pipe','ignore'], encoding:'utf8'}).toString().trim();
            if (result) candidates.push(result.split(/\r?\n/)[0]);
        } catch(e){}
        const settings = loadSettings();
        if (settings.scrcpyPath) candidates.push(settings.scrcpyPath);
        
        // Local project scrcpy folder (production: resourcesPath, dev: __dirname)
        const isPackaged = app.isPackaged;
        const basePath = isPackaged ? path.join(process.resourcesPath, '..') : __dirname;
        candidates.push(path.join(basePath, 'scrcpy', os.platform()==='win32' ? 'scrcpy.exe' : 'scrcpy'));
        candidates.push(path.join(basePath, os.platform()==='win32' ? 'scrcpy.exe' : 'scrcpy'));

        for (const cand of candidates) {
            if (cand && fs.existsSync(cand)) { this.scrcpyPath = cand; return cand; }
        }
        return null;
    }

    launchScrcpy(device, args='') {
        try {
            const scrcpy = this.findScrcpy();
            if (!scrcpy) {
                return { success:false, error: 'scrcpy tidak ditemukan. Pastikan file scrcpy ada di folder project atau PATH.' };
            }
            const dFlag = device ? `-s "${device}"` : '';
            if (this.scrcpyProc) { try{this.scrcpyProc.kill();}catch(e){} }
            this.scrcpyProc = spawn(scrcpy, [...dFlag.split(' ').filter(Boolean), ...args.split(' ').filter(Boolean)], { detached:true, stdio:'ignore' });
            this.scrcpyProc.unref();
            return { success:true };
        } catch(e) {
            return { success:false, error: 'scrcpy gagal dijalankan: ' + e.message };
        }
    }
}
const pool = new DevicePool();

// ─────────────────────────────────────────
// WINDOW
// ─────────────────────────────────────────
let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width:1600, height:1020, minWidth:1200, minHeight:700,
        title:"RBA Designer Pro — Studio 2.0",
        webPreferences:{ nodeIntegration:true, contextIsolation:false },
        backgroundColor:'#080d17'
    });
    
    // Load login first
    mainWindow.loadFile(path.join(__dirname, 'login.html'));
}

// ─────────────────────────────────────────
// IPC HANDLERS
// ─────────────────────────────────────────
ipcMain.on("open-external",   (e,url)=>shell.openExternal(url));
ipcMain.on("get-devices",     (e)=>e.reply("device-list", pool.refresh()));

ipcMain.handle("get-saved-workflows", ()=>loadSavedWorkflows());
ipcMain.handle("save-workflow", (e,wf)=>{
    const s=loadSavedWorkflows(); const idx=s.findIndex(i=>i.id===wf.id);
    if(idx>=0) s[idx]=wf; else s.unshift(wf);
    return saveWorkflowsFile(s);
});
ipcMain.handle("load-workflow",   (e,id)=>loadSavedWorkflows().find(i=>i.id===id)||null);
ipcMain.handle("delete-workflow", (e,id)=>saveWorkflowsFile(loadSavedWorkflows().filter(i=>i.id!==id)));
ipcMain.handle("get-settings",    ()=>loadSettings());
ipcMain.handle("save-settings",   (e,s)=>saveSettingsFile(s));

// ADB command execution
ipcMain.handle("run-adb", (e, { device, args })=>{
    return new Promise(res=>pool.adb(args, device, res));
});

// scrcpy launch
ipcMain.handle("launch-scrcpy", (e, { device, args })=>{
    return pool.launchScrcpy(device, args||'');
});

// ADB device check (detailed)
ipcMain.handle("adb-info", ()=>{
    const adb = pool.findAdb();
    const devices = adb ? pool.refresh() : [];
    return { found:!!adb, path:adb||'Not found', devices };
});

// Open file dialog
ipcMain.handle("open-file-dialog", async (e, opts)=>{
    const res = await dialog.showOpenDialog(opts||{});
    return res;
});

// ADB WiFi connect
ipcMain.handle("adb-connect-wifi", async (e, { ip, port })=>{
    return new Promise(resolve=>{
        const bin = pool.findAdb() || 'adb';
        exec(`"${bin}" connect ${ip}:${port||5555}`, {encoding:'utf8', timeout:10000}, (err, stdout)=>{
            const success = !err && stdout.includes('connected');
            resolve({success, output:stdout||'', error:err?.message||''});
        });
    });
});

// Webhook server
let webhookServer = null;
ipcMain.handle("start-webhook", async (e, { port })=>{
    const http = require('http');
    if (webhookServer) { try{webhookServer.close();}catch(err){} webhookServer=null; }
    
    webhookServer = http.createServer((req, res)=>{
        let body = '';
        req.on('data', d=>body+=d);
        req.on('end', ()=>{
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify({received:true}));
            BrowserWindow.getAllWindows()[0]?.webContents.send('webhook-received', {
                method:req.method, url:req.url, body:body, headers:req.headers, timestamp:Date.now()
            });
        });
    });
    
    return new Promise(resolve=>{
        webhookServer.listen(parseInt(port)||3344, ()=>{
            resolve({success:true, port:webhookServer.address().port});
        });
        webhookServer.on('error', e=>resolve({success:false, error:e.message}));
    });
});

ipcMain.handle("stop-webhook", ()=>{
    if (webhookServer) { try{webhookServer.close();}catch(err){} webhookServer=null; }
    return {success:true};
});

// Output path handler for portable file storage
ipcMain.handle("get-output-path", async (event, filename) => {
    const outputDir = path.join(app.getPath('userData'), 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    return path.join(outputDir, filename || 'output.json');
});

// ================================
// AUTHENTICATION
// ================================
let isAuthenticated = false;
let currentUser = null;

// Set userData path for auth module
const auth = require('./auth');
auth.setUserDataPath(app.getPath('userData'));

ipcMain.handle("auth-login", async (event, { username, password }) => {
    const result = await auth.login(username, password);
    if (result.success) {
        isAuthenticated = true;
        currentUser = result.user;
        // Delay 500ms agar renderer sempat terima response
        // sebelum window berpindah halaman
        setTimeout(() => {
            if (mainWindow) {
                mainWindow.loadFile(path.join(__dirname, 'index.html'));
            }
        }, 500);
    }
    return result;
});

ipcMain.handle("auth-change-password", async (event, { username, oldPassword, newPassword }) => {
    if (!isAuthenticated) {
        return { success: false, reason: 'Belum login' };
    }
    return auth.changePassword(username, oldPassword, newPassword);
});

ipcMain.handle("auth-logout", async () => {
    isAuthenticated = false;
    currentUser = null;
    return { success: true };
});

ipcMain.handle("auth-check", async () => {
    return { 
        authenticated: isAuthenticated, 
        user: currentUser 
    };
});

// ================================
// WORKFLOW ENGINE (SAFE ADDITION)
// ================================

function buildGraph(nodes, edges) {
    const nodeMap = {};
    const edgeMap = {};

    nodes.forEach(n => nodeMap[n.id] = n);

    edges.forEach(e => {
        const from = e.from || e.source;
        const to   = e.to   || e.target;

        if (!edgeMap[from]) edgeMap[from] = [];
        edgeMap[from].push(to);
    });

    return { nodeMap, edgeMap };
}

function getNextNode(edgeMap, id) {
    return edgeMap[id]?.[0] || null;
}

function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}

// 🔥 PENTING: pakai ADB EXISTING kamu
async function executeStepSafe(node, device) {
    return new Promise(resolve => {
        const type = node.data.type;
        const p = node.data.properties || {};

        // pakai IPC ADB lama kamu (AMAN)
        if (type === "mobile-tap") {
            pool.adb(`shell input tap ${p.x} ${p.y}`, device, resolve);
        }

        else if (type === "mobile-swipe") {
            pool.adb(`shell input swipe ${p.x1} ${p.y1} ${p.x2} ${p.y2} ${p.duration||300}`, device, resolve);
        }

        else if (type === "delay") {
            setTimeout(resolve, p.duration || 1000);
        }

        else {
            resolve();
        }
    });
}
async function runWorkflowEngineSafe({ nodes, edges, device }) {

    const { nodeMap, edgeMap } = buildGraph(nodes, edges);

    let currentId = nodes[0]?.id;

    const loopStack = [];
    const retryStack = [];

    while (currentId) {
        const node = nodeMap[currentId];
        const type = node.data.type;
        const props = node.data.properties || {};

        console.log("RUN:", node.data.label);

        try {

            // LOOP START
            if (type === "repeat-start") {
                loopStack.push({
                    startId: getNextNode(edgeMap, currentId),
                    current: 0,
                    max: props.repeatCount || 1
                });
            }

            // LOOP END
            else if (type === "repeat-end") {
                const loop = loopStack[loopStack.length - 1];

                if (loop && loop.current < loop.max - 1) {
                    loop.current++;
                    currentId = loop.startId;
                    continue;
                } else {
                    loopStack.pop();
                }
            }

            // RETRY START
            else if (type === "retry-start") {
                retryStack.push({
                    startId: getNextNode(edgeMap, currentId),
                    current: 0,
                    max: props.maxRetries || 0,
                    delay: props.interval || 0
                });
            }

            // RETRY END
            else if (type === "retry-end") {
                const retry = retryStack[retryStack.length - 1];

                if (retry && retry.current < retry.max) {
                    retry.current++;
                    console.log(`Retry ${retry.current}/${retry.max}`);

                    await delay(retry.delay);
                    currentId = retry.startId;
                    continue;
                } else {
                    retryStack.pop();
                }
            }

            // STEP NORMAL
            else {
                await executeStepSafe(node, device);
            }

        } catch (err) {
            console.error("ERROR:", err);
        }

        currentId = getNextNode(edgeMap, currentId);
    }

    console.log("=== Workflow Done ===");
}
ipcMain.handle("run-workflow-safe", async (e, payload) => {
    try {
        await runWorkflowEngineSafe(payload);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ─────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────
app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
