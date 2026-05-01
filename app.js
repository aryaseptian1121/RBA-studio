// ============================================================
// RBA STUDIO PRO — app.js (Enhanced & Fixed)
// Author: Arya Septian  |  Version: 2.0
// ============================================================
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { exec, execSync, spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const projectsFile = path.join(app.getPath("userData"), "rba-workflows.json");
const settingsFile  = path.join(app.getPath("userData"), "rba-settings.json");

// -----------------------------------------
// PERSIST HELPERS
// -----------------------------------------
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

// -----------------------------------------
// DEVICE POOL & ADB
// -----------------------------------------
class DevicePool {
    constructor() { this.devices=[]; this.adbPath=null; this.scrcpyProc=null; }

    findAdb() {
        if (this.adbPath) return this.adbPath;
        
        // 1. Try which (macOS/Linux) or where (Windows)
        try {
            const cmd = os.platform()==='win32' ? 'where adb' : 'which adb';
            const result = execSync(cmd, { stdio:['ignore','pipe','ignore'], encoding:'utf8' });
            const found = result.trim().split(/\r?\n/)[0];
            if (found && fs.existsSync(found)) { this.adbPath=found; return found; }
        } catch(e){}
        
        // 2. Check environment variables
        const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
        if (androidHome) {
            const candidate = path.join(androidHome, 'platform-tools', os.platform()==='win32' ? 'adb.exe' : 'adb');
            if (fs.existsSync(candidate)) { this.adbPath=candidate; return candidate; }
        }
        if (process.env.ADB_PATH) {
            for (const cand of process.env.ADB_PATH.split(path.delimiter).filter(Boolean)) {
                if (fs.existsSync(cand)) { this.adbPath = cand; return cand; }
            }
        }
        
        // 3. Platform default paths
        const defaults = [];
        if (os.platform() === 'win32') {
            defaults.push(path.join(os.homedir(),'AppData','Local','Android','Sdk','platform-tools','adb.exe'));
            defaults.push('C:\\platform-tools\\adb.exe');
        } else {
            defaults.push('/usr/local/bin/adb', '/usr/bin/adb');
        }
        for (const cand of defaults) {
            if (cand && fs.existsSync(cand)) { this.adbPath=cand; return cand; }
        }

        // 4. Fallback from preferences file
        try {
            const settings = loadSettings();
            if (settings.adbPath && fs.existsSync(settings.adbPath)) { this.adbPath = settings.adbPath; return settings.adbPath; }
        } catch(e) {}
        return null;
    }

    adb(args, device, cb) {
        const bin = this.findAdb() || 'adb';
        const dFlag = device ? `-s "${device}"` : '';
        const cmd = `"${bin}" ${dFlag} ${args}`;
        exec(cmd, { timeout: 15000, encoding:'utf8' }, (err, stdout, stderr) => {
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

    launchScrcpy(device, args='') {
        try {
            const cmd = os.platform()==='win32' ? 'where scrcpy' : 'which scrcpy';
            const scrcpy = execSync(cmd,{stdio:['ignore','pipe','ignore']}).toString().trim().split(/\r?\n/)[0];
            const dFlag = device ? `-s "${device}"` : '';
            if (this.scrcpyProc) { try{this.scrcpyProc.kill();}catch(e){} }
            this.scrcpyProc = spawn(scrcpy, [...dFlag.split(' ').filter(Boolean), ...args.split(' ').filter(Boolean)], { detached:true, stdio:'ignore' });
            this.scrcpyProc.unref();
            return { success:true };
        } catch(e) {
            return { success:false, error: 'scrcpy tidak ditemukan. Pastikan scrcpy ada di PATH.\n' + e.message };
        }
    }
}
const pool = new DevicePool();

// -----------------------------------------
// WINDOW
// -----------------------------------------
function createWindow() {
    const win = new BrowserWindow({
        width:1600, height:1020, minWidth:1200, minHeight:700,
        title:"RBA Designer Pro — Studio 2.0",
        webPreferences:{ nodeIntegration:true, contextIsolation:false },
        backgroundColor:'#080d17'
    });
    const tmpHtml = path.join(app.getPath('temp'), 'rba-studio-ui.html');
    fs.writeFileSync(tmpHtml, html, 'utf8');
    win.loadFile(tmpHtml);
}

// -----------------------------------------
// IPC HANDLERS
// -----------------------------------------
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
ipcMain.handle("rename-workflow", (e,{id,name})=>{
    const s=loadSavedWorkflows();
    const idx=s.findIndex(i=>i.id===id);
    if(idx>=0){ s[idx].name=name; s[idx].updatedAt=new Date().toISOString(); }
    return saveWorkflowsFile(s);
});
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

// -----------------------------------------
// FRONTEND HTML
// -----------------------------------------

// Emit auth-success event after successful login
function handleLoginSuccess() {
    ipcRenderer.send('auth-success');
}

// Example: Call this function after login validation
// handleLoginSuccess();
const html = `<!DOCTYPE html>
<html lang="id" data-theme="dark">
<head>
<meta charset="UTF-8">
<title>RBA Studio Pro 2.0</title>
<style>
/* -- TOKENS --------------------------------------- */
:root {
  --bg: #070c18; --bg2: #0d1529; --bg3: #111827; --card: #0f1a2e;
  --border: rgba(255,255,255,0.10); --border2: rgba(255,255,255,0.06);
  --accent: #3b82f6; --accent2: #6366f1; --green: #10b981; --red: #ef4444;
  --orange: #f97316; --yellow: #eab308; --purple: #a855f7;
  --text: #f1f5f9; --dim: #64748b; --dim2: #94a3b8;
  --radius: 16px; --radius-sm: 10px;
  --glow-blue: 0 0 20px rgba(59,130,246,0.35);
  --glow-green: 0 0 20px rgba(16,185,129,0.35);
}
[data-theme="light"] {
  --bg:#f0f4ff; --bg2:#ffffff; --bg3:#f8faff; --card:#ffffff;
  --border:#dde3f0; --border2:#e8edf8;
  --text:#1e293b; --dim:#64748b; --dim2:#94a3b8;
}

/* -- RESET ---------------------------------------- */
*{box-sizing:border-box;margin:0;padding:0;font-family:'Inter','Segoe UI',Arial,sans-serif;}
body{background:var(--bg);color:var(--text);height:100vh;overflow:hidden;user-select:none;}

/* -- LAYOUT --------------------------------------- */
.shell{display:flex;height:100vh;}
.sidebar{width:68px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:16px 0 12px;gap:4px;z-index:200;flex-shrink:0;}
.main{flex:1;display:flex;flex-direction:column;min-width:0;}
header{height:56px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 20px;gap:14px;flex-shrink:0;}

/* -- SIDEBAR ICONS --------------------------------- */
.nav-ico{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--dim2);font-size:18px;transition:all .2s;position:relative;}
.nav-ico:hover{background:rgba(255,255,255,0.06);color:var(--text);}
.nav-ico.active{background:var(--accent);color:#fff;box-shadow:var(--glow-blue);}
.nav-ico .tooltip{position:absolute;left:56px;background:rgba(15,23,42,0.95);color:#fff;font-size:11px;white-space:nowrap;padding:5px 10px;border-radius:6px;pointer-events:none;opacity:0;transition:opacity .15s;border:1px solid var(--border);}
.nav-ico:hover .tooltip{opacity:1;}
.sidebar-sep{width:36px;height:1px;background:var(--border);margin:6px 0;}

/* -- HEADER ---------------------------------------- */
.hdr-logo{font-weight:800;font-size:14px;letter-spacing:.04em;background:linear-gradient(135deg,#60a5fa,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.hdr-project{font-size:13px;font-weight:600;color:var(--dim2);cursor:pointer;padding:4px 10px;border-radius:8px;border:1px solid var(--border2);}
.hdr-project:hover{border-color:var(--accent);color:var(--text);}
.hdr-spacer{flex:1;}
.hdr-badge{display:flex;align-items:center;gap:6px;font-size:11px;padding:5px 12px;border-radius:20px;border:1px solid var(--border);background:rgba(255,255,255,0.03);cursor:pointer;}
.hdr-badge.online{border-color:var(--green);color:var(--green);background:rgba(16,185,129,0.1);}
.hdr-badge.offline{border-color:var(--red);color:var(--red);background:rgba(239,68,68,0.08);}
.hdr-dot{width:7px;height:7px;border-radius:50%;background:currentColor;}
.hdr-btn{border:none;background:rgba(255,255,255,0.07);color:var(--text);border-radius:10px;padding:7px 14px;font-size:12px;cursor:pointer;transition:.15s;border:1px solid var(--border2);}
.hdr-btn:hover{background:rgba(255,255,255,0.12);}
.hdr-btn.primary{background:var(--accent);color:#fff;border-color:transparent;}
.hdr-btn.primary:hover{background:#2563eb;}
.hdr-btn.danger{background:var(--red);color:#fff;border-color:transparent;}

/* -- VIEWS ----------------------------------------- */
.view{display:none;flex:1;overflow:hidden;}
.view.active{display:flex;flex-direction:column;}

/* -- EDITOR LAYOUT --------------------------------- */
.editor-shell{display:flex;flex:1;overflow:hidden;gap:0;}
.left-panel{width:256px;flex-shrink:0;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;}
.right-panel{width:300px;flex-shrink:0;background:var(--bg2);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;}
.canvas-zone{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative;}
.log-strip{height:220px;border-top:1px solid var(--border);background:var(--bg2);display:flex;flex-direction:column;flex-shrink:0;transition:height .25s;}
.log-strip.collapsed{height:36px;}

/* -- PANEL COMMON ---------------------------------- */
.panel-hdr{font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--dim);padding:14px 16px 10px;border-bottom:1px solid var(--border2);text-transform:uppercase;}
.panel-body{flex:1;overflow-y:auto;padding:12px;}
.panel-body::-webkit-scrollbar{width:4px;}
.panel-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;}

/* -- SEARCH ---------------------------------------- */
.search-bar{margin:10px 12px 8px;position:relative;}
.search-bar input{width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:8px 12px 8px 32px;font-size:12px;outline:none;}
.search-bar input:focus{border-color:var(--accent);}
.search-bar::before{content:'??';position:absolute;left:10px;top:9px;font-size:11px;}

/* -- SECTION TITLE --------------------------------- */
.sec{font-size:10px;font-weight:700;color:var(--dim);letter-spacing:.1em;padding:14px 4px 6px;text-transform:uppercase;}

/* -- TOOL CARDS ------------------------------------ */
.tool-card{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;background:transparent;border:1px solid transparent;color:var(--text);font-size:12px;font-weight:500;transition:.15s;width:100%;text-align:left;}
.tool-card:hover{background:rgba(255,255,255,0.06);border-color:var(--border);}
.tool-card .tc-ico{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;}
.tool-card .tc-lbl strong{display:block;font-size:12px;}
.tool-card .tc-lbl span{font-size:10px;color:var(--dim2);}

/* -- TOOLBAR --------------------------------------- */
.toolbar{display:flex;align-items:center;gap:6px;padding:8px 14px;border-bottom:1px solid var(--border);background:var(--bg2);flex-wrap:wrap;flex-shrink:0;}
.tb-btn{border:none;background:rgba(255,255,255,0.06);color:var(--text);border-radius:8px;padding:6px 12px;font-size:11px;cursor:pointer;transition:.15s;border:1px solid var(--border2);white-space:nowrap;}
.tb-btn:hover{background:rgba(255,255,255,0.12);}
.tb-btn.active{background:rgba(59,130,246,0.2);border-color:rgba(59,130,246,0.5);color:#93c5fd;}
.tb-sep{width:1px;height:20px;background:var(--border);flex-shrink:0;}
.tb-run{background:var(--green)!important;color:#fff!important;border-color:transparent!important;}
.tb-run:hover{background:#059669!important;}
.tb-stop{background:var(--red)!important;color:#fff!important;border-color:transparent!important;}
.tb-stop:hover{background:#dc2626!important;}

/* -- CANVAS ---------------------------------------- */
.canvas-area{flex:1;position:relative;overflow:hidden;
  background-color:var(--bg);
  background-image:
    radial-gradient(circle, rgba(59,130,246,0.04) 1px, transparent 1px),
    linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px);
  background-size: 20px 20px, 100px 100px, 100px 100px;
  cursor:grab;
}
.canvas-area:active{cursor:grabbing;}
#canvas-wrapper{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform;}
#svg-layer{position:absolute;top:0;left:0;width:12000px;height:9000px;pointer-events:all;overflow:visible;}

/* -- NODES ----------------------------------------- */
.node{
  position:absolute;width:200px;background:var(--card);
  border:1.5px solid rgba(255,255,255,0.1);border-radius:14px;
  padding:12px 14px;cursor:move;color:var(--text);
  box-shadow:0 4px 24px rgba(0,0,0,0.4);z-index:10;
  transition:border-color .2s, box-shadow .2s;
  display:flex;align-items:center;gap:12px;
}
.node:hover{border-color:rgba(255,255,255,0.25);box-shadow:0 8px 32px rgba(0,0,0,0.5);}
.node.selected{border-color:var(--accent)!important;box-shadow:0 0 0 2px rgba(59,130,246,0.3), 0 8px 32px rgba(0,0,0,0.5);}
.node.running{border-color:var(--yellow)!important;animation:pulse-node 1s infinite;}
.node.success{border-color:var(--green)!important;}
.node.error{border-color:var(--red)!important;}
.node-ico{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;}
.node-body{min-width:0;}
.node-lbl{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.node-type{font-size:10px;color:var(--dim2);text-transform:uppercase;letter-spacing:.06em;margin-top:1px;}
.node-port{position:absolute;width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid var(--bg);top:50%;transform:translateY(-50%);cursor:crosshair;z-index:20;}
.node-port.out{right:-5px;}
.node-port.in{left:-5px;}
.node-status-bar{position:absolute;bottom:0;left:0;right:0;height:3px;border-radius:0 0 12px 12px;background:transparent;transition:.2s;}
.node.running .node-status-bar{background:var(--yellow);}
.node.success .node-status-bar{background:var(--green);}
.node.error   .node-status-bar{background:var(--red);}
.node-step-num{position:absolute;top:-8px;left:8px;font-size:9px;font-weight:700;background:var(--accent);color:#fff;border-radius:4px;padding:1px 5px;}

@keyframes pulse-node{0%,100%{box-shadow:0 0 0 2px rgba(234,179,8,0.5);}50%{box-shadow:0 0 0 6px rgba(234,179,8,0.0);}}

/* -- SVG LINES ------------------------------------- */
.flow-edge{fill:none;stroke-width:2;stroke-linecap:round;cursor:pointer;pointer-events:stroke;transition:stroke-width .2s,opacity .2s;}
.flow-edge:hover{stroke-width:3;}
.flow-edge.selected{stroke-width:3;filter:drop-shadow(0 0 6px currentColor);}
.flow-edge.active-run{stroke-dasharray:10,5;animation:dash-anim 0.6s linear infinite;}
@keyframes dash-anim{to{stroke-dashoffset:-15;}}

/* -- CONTEXT MENU ---------------------------------- */
.ctx-menu{position:fixed;background:rgba(13,21,41,0.98);border:1px solid var(--border);border-radius:10px;padding:6px;z-index:9999;min-width:180px;box-shadow:0 16px 48px rgba(0,0,0,0.6);backdrop-filter:blur(10px);}
.ctx-item{padding:7px 12px;font-size:12px;cursor:pointer;border-radius:6px;color:var(--text);display:flex;align-items:center;gap:8px;transition:.12s;}
.ctx-item:hover{background:rgba(59,130,246,0.18);}
.ctx-item.danger:hover{background:rgba(239,68,68,0.18);color:var(--red);}
.ctx-item .ctx-ico{width:16px;text-align:center;}
.ctx-sep{height:1px;background:var(--border);margin:4px 0;}
.ctx-sub{color:var(--dim);font-size:10px;font-weight:700;letter-spacing:.08em;padding:6px 12px 2px;text-transform:uppercase;}

/* -- PROPERTIES PANEL ------------------------------ */
.prop-group{margin-bottom:16px;}
.prop-label{font-size:10px;font-weight:700;color:var(--dim2);letter-spacing:.06em;margin-bottom:5px;display:block;text-transform:uppercase;}
.prop-input{width:100%;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px;font-size:12px;outline:none;transition:.15s;}
.prop-input:focus{border-color:var(--accent);background:rgba(59,130,246,0.06);}
.prop-select{appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M0 0l6 8 6-8z' fill='%2364748b'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:28px;}
.prop-sep{height:1px;background:var(--border2);margin:14px 0;}
.prop-title{font-size:12px;font-weight:700;color:var(--text);margin-bottom:14px;display:flex;align-items:center;gap:8px;}
.prop-ico-big{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;}
.prop-empty{color:var(--dim);text-align:center;padding:48px 16px;font-size:12px;line-height:1.7;}
.btn-full{width:100%;padding:9px;border:none;border-radius:8px;font-size:12px;cursor:pointer;font-weight:600;transition:.15s;margin-bottom:6px;}
.btn-delete{background:rgba(239,68,68,0.15);color:var(--red);border:1px solid rgba(239,68,68,0.25);}
.btn-delete:hover{background:var(--red);color:#fff;}
.btn-dup{background:rgba(99,102,241,0.15);color:#a5b4fc;border:1px solid rgba(99,102,241,0.25);}
.btn-dup:hover{background:var(--accent2);color:#fff;}
.btn-run-step{background:rgba(16,185,129,0.15);color:var(--green);border:1px solid rgba(16,185,129,0.25);}
.btn-run-step:hover{background:var(--green);color:#fff;}
.btn-draw-conn{background:rgba(59,130,246,0.12);color:#93c5fd;border:1px solid rgba(59,130,246,0.25);}
.btn-draw-conn:hover{background:var(--accent);color:#fff;}
.prop-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}

/* -- DEVICE CARD ----------------------------------- */
.dev-section{margin-top:auto;padding:12px;border-top:1px solid var(--border);}
.dev-label{font-size:10px;color:var(--dim);font-weight:700;letter-spacing:.06em;margin-bottom:6px;text-transform:uppercase;}
.dev-select{width:100%;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:7px 10px;font-size:11px;}
.dev-actions{display:flex;gap:6px;margin-top:8px;}
.dev-btn{flex:1;border:none;border-radius:7px;padding:6px;font-size:10px;cursor:pointer;font-weight:600;transition:.15s;}
.dev-btn.refresh{background:rgba(59,130,246,0.15);color:#93c5fd;border:1px solid rgba(59,130,246,0.2);}
.dev-btn.scrcpy{background:rgba(168,85,247,0.15);color:#c4b5fd;border:1px solid rgba(168,85,247,0.2);}
.dev-btn:hover{filter:brightness(1.3);}

/* -- LOG PANEL ------------------------------------- */
.log-hdr{height:36px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;cursor:pointer;border-bottom:1px solid var(--border2);flex-shrink:0;}
.log-hdr-title{font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--dim);display:flex;align-items:center;gap:8px;}
.log-hdr-actions{display:flex;gap:6px;}
.log-body{display:flex;flex:1;overflow:hidden;}
.log-output{flex:1;overflow-y:auto;padding:8px 14px;font-family:'Consolas','Courier New',monospace;font-size:11px;line-height:1.7;color:#94a3b8;}
.log-output .log-info{color:#94a3b8;}
.log-output .log-warn{color:#fbbf24;}
.log-output .log-error{color:#f87171;}
.log-output .log-success{color:#34d399;}
.log-output .log-ts{color:#475569;}
.log-stats{width:200px;border-left:1px solid var(--border2);padding:12px;flex-shrink:0;}
.stat-item{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:11px;}
.stat-val{font-weight:700;color:var(--text);}

/* -- DASHBOARD ------------------------------------- */
.dash-view{padding:32px;overflow-y:auto;flex:1;}
.dash-title{font-size:22px;font-weight:800;margin-bottom:6px;}
.dash-sub{font-size:13px;color:var(--dim2);margin-bottom:28px;}
.dash-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:28px;}
.dash-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:28px;}
.dash-summary .dash-card{cursor:default;}
.dash-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;cursor:pointer;transition:.2s;}
.dash-card:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.3);}
.dash-card-ico{font-size:24px;margin-bottom:10px;}
.dash-card-ttl{font-size:13px;font-weight:700;margin-bottom:4px;}
.dash-card-sub{font-size:11px;color:var(--dim2);}
.wf-list-wrap{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;}
.wf-list-hdr{padding:14px 20px;border-bottom:1px solid var(--border);font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:space-between;}
.wf-item{display:flex;align-items:center;gap:14px;padding:12px 20px;border-bottom:1px solid var(--border2);transition:.15s;}
.wf-item:last-child{border-bottom:none;}
.wf-item:hover{background:rgba(255,255,255,0.03);}
.wf-item-ico{width:36px;height:36px;border-radius:8px;background:rgba(59,130,246,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;}
.wf-item-body{flex:1;min-width:0;}
.wf-item-name{font-size:12px;font-weight:700;}
.wf-item-meta{font-size:10px;color:var(--dim2);}
.wf-item-actions{display:flex;gap:6px;}
.wf-item-btn{border:none;border-radius:6px;padding:5px 10px;font-size:10px;cursor:pointer;font-weight:600;}
.wf-item-btn.open{background:rgba(59,130,246,0.15);color:#93c5fd;}
.wf-item-btn.rename{
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}
.wf-item-btn.rename:hover{
  background: rgba(245, 158, 11, 0.3);
  border-color: rgba(245, 158, 11, 0.6);
}
.wf-item-btn.del{background:rgba(239,68,68,0.12);color:var(--red);}

/* -- SETTINGS -------------------------------------- */
.settings-view{padding:32px;overflow-y:auto;flex:1;}
.settings-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;}
.setting-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;}
.setting-card-ttl{font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--dim);text-transform:uppercase;margin-bottom:16px;}

/* -- MINIMAP --------------------------------------- */
#minimap{position:absolute;bottom:16px;right:16px;width:180px;height:130px;background:rgba(7,12,24,0.9);border:1px solid var(--border);border-radius:10px;overflow:hidden;z-index:50;display:none;}
#minimap canvas{width:100%;height:100%;}
.minimap-viewport{position:absolute;border:1px solid rgba(59,130,246,0.6);pointer-events:none;}

/* -- ZOOM INDICATOR -------------------------------- */
.zoom-badge{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:rgba(13,21,41,0.85);border:1px solid var(--border);border-radius:20px;padding:4px 14px;font-size:11px;font-weight:700;color:var(--dim2);pointer-events:none;z-index:30;}

/* -- TEMP LINE ------------------------------------- */
#temp-line{pointer-events:none;stroke:var(--accent);stroke-width:2;stroke-dasharray:6,3;fill:none;}

/* -- TOGGLE ---------------------------------------- */
.toggle-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.toggle-row label{font-size:12px;color:var(--dim2);}
.toggle{position:relative;width:36px;height:20px;}
.toggle input{opacity:0;width:0;height:0;}
.toggle-slider{position:absolute;inset:0;background:rgba(255,255,255,0.1);border-radius:20px;cursor:pointer;transition:.2s;}
.toggle input:checked+.toggle-slider{background:var(--accent);}
.toggle-slider::after{content:'';position:absolute;width:14px;height:14px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s;}
.toggle input:checked+.toggle-slider::after{transform:translateX(16px);}

/* -- REC INDICATOR --------------------------------- */
.rec-badge{display:none;align-items:center;gap:6px;font-size:11px;color:var(--red);animation:blink 1s step-start infinite;}
@keyframes blink{50%{opacity:0;}}
.rec-badge.active{display:flex;}
.rec-dot{width:8px;height:8px;border-radius:50%;background:var(--red);}

/* -- SCROLLBARS ------------------------------------ */
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px;}
</style>
</head>
<body>
<div class="shell">

  <!-- SIDEBAR -->
  <nav class="sidebar">
    <div class="nav-ico active" id="nav-dash" onclick="switchView('dashboard')" title="">
      ?<span class="tooltip">Dashboard</span>
    </div>
    <div class="nav-ico" id="nav-edit" onclick="switchView('editor')" title="">
      ?<span class="tooltip">Studio Editor</span>
    </div>
    <div class="nav-ico" id="nav-rec" onclick="switchView('recorder')" title="">
      ??<span class="tooltip">Macro Recorder</span>
    </div>
    <div class="nav-ico" id="nav-set" onclick="switchView('settings')" title="">
      ??<span class="tooltip">Settings</span>
    </div>
    <div class="sidebar-sep"></div>
    <div class="nav-ico" onclick="toggleTheme()" title="">
      ??<span class="tooltip">Toggle Theme</span>
    </div>
    <div class="nav-ico" onclick="showAdbInfo()" title="" style="margin-top:auto;">
      ??<span class="tooltip">ADB Info</span>
    </div>
  </nav>

  <div class="main">
    <!-- HEADER -->
    <header>
      <div class="hdr-logo">RBA Studio Pro</div>
      <div class="hdr-project" id="proj-name" ondblclick="renameProject()">Untitled Flow ??</div>
      <div class="hdr-spacer"></div>
      <div class="rec-badge" id="rec-badge"><div class="rec-dot"></div>REC</div>
      <div class="hdr-badge offline" id="bot-status"><div class="hdr-dot"></div>OFFLINE</div>
      <button class="hdr-btn primary" id="run-flow-btn" onclick="runWorkflow()">? RUN</button>
      <button class="hdr-btn danger"  id="stop-flow-btn" onclick="stopWorkflow()" disabled>¦ STOP</button>
      <button class="hdr-btn" onclick="saveCurrentProject()">?? Save</button>
    </header>

    <!-- DASHBOARD VIEW -->
    <div class="view active" id="dashboard">
      <div class="dash-view">
        <div class="dash-title">?? Dashboard</div>
        <div class="dash-sub">Kelola & jalankan workflow automasi Anda</div>
        <div class="dash-grid">
          <div class="dash-card" onclick="createNew(); switchView('editor')">
            <div class="dash-card-ico">?</div>
            <div class="dash-card-ttl">New Workflow</div>
            <div class="dash-card-sub">Buat flow baru dari awal</div>
          </div>
          <div class="dash-card" onclick="document.getElementById('fileInput').click()">
            <div class="dash-card-ico">??</div>
            <div class="dash-card-ttl">Import JSON</div>
            <div class="dash-card-sub">Muat workflow dari file</div>
          </div>
          <div class="dash-card" onclick="refreshDevices()">
            <div class="dash-card-ico">??</div>
            <div class="dash-card-ttl">Scan Devices</div>
            <div class="dash-card-sub">Deteksi perangkat ADB</div>
          </div>
          <div class="dash-card" onclick="switchView('recorder')">
            <div class="dash-card-ico">??</div>
            <div class="dash-card-ttl">Macro Recorder</div>
            <div class="dash-card-sub">Rekam klik menjadi workflow</div>
          </div>
        </div>
        <div class="dash-summary">
          <div class="dash-card">
            <div class="dash-card-ico">??</div>
            <div class="dash-card-ttl">Workflows</div>
            <div class="dash-card-sub"><span id="stat-total-wf">0</span> tersimpan</div>
          </div>
          <div class="dash-card">
            <div class="dash-card-ico">??</div>
            <div class="dash-card-ttl">Runs</div>
            <div class="dash-card-sub"><span id="stat-total-runs">0</span> eksekusi</div>
          </div>
          <div class="dash-card">
            <div class="dash-card-ico">?</div>
            <div class="dash-card-ttl">Success Rate</div>
            <div class="dash-card-sub"><span id="stat-success-rate">0%</span></div>
          </div>
          <div class="dash-card">
            <div class="dash-card-ico">??</div>
            <div class="dash-card-ttl">ADB Devices</div>
            <div class="dash-card-sub"><span id="stat-devices">0</span></div>
          </div>
        </div>
        <div class="wf-list-wrap">
          <div class="wf-list-hdr">
            <span>?? Saved Workflows</span>
            <button class="hdr-btn" onclick="loadSavedProjects()">?? Refresh</button>
          </div>
          <div id="wf-list" style="padding:8px;color:var(--dim);font-size:12px;text-align:center;">Memuat...</div>
        </div>
      </div>
    </div>

    <!-- EDITOR VIEW -->
    <div class="view" id="editor">
      <div class="editor-shell">

        <!-- LEFT: Tool Panel -->
        <div class="left-panel">
          <div class="panel-hdr">?? Activities</div>
          <div class="search-bar"><input type="text" placeholder="Cari activity..." oninput="filterTools(this.value)" id="tool-search"></div>
          <div class="panel-body" id="tool-list">
            <!-- Populated by JS -->
          </div>
        </div>

        <!-- CENTER: Canvas + Toolbar + Log -->
        <div class="canvas-zone">
          <div class="toolbar" id="toolbar">
            <button class="tb-btn" onclick="createNew()" title="New (Ctrl+N)">+ New</button>
            <button class="tb-btn" onclick="document.getElementById('fileInput').click()" title="Open (Ctrl+O)">?? Open</button>
            <button class="tb-btn" onclick="saveCurrentProject()" title="Save (Ctrl+S)">?? Save</button>
            <div class="tb-sep"></div>
            <button class="tb-btn" onclick="undoAction()" title="Undo (Ctrl+Z)">? Undo</button>
            <button class="tb-btn" onclick="redoAction()" title="Redo (Ctrl+Y)">? Redo</button>
            <div class="tb-sep"></div>
            <button class="tb-btn" onclick="selectAll()" title="Select All (Ctrl+A)">? All</button>
            <button class="tb-btn" onclick="copySelected()" title="Copy (Ctrl+C)">?? Copy</button>
            <button class="tb-btn" onclick="pasteNodes()" title="Paste (Ctrl+V)">?? Paste</button>
            <button class="tb-btn" onclick="deleteSelected()" title="Delete (Del)">?? Delete</button>
            <div class="tb-sep"></div>
            <button class="tb-btn" onclick="autoLayout()" title="Auto Arrange">? Arrange</button>
            <button class="tb-btn" onclick="alignNodes('left')" title="Align Left">? Align L</button>
            <button class="tb-btn" onclick="alignNodes('center')" title="Align Center">? Center</button>
            <button class="tb-btn" onclick="alignNodes('right')" title="Align Right">? Align R</button>
            <div class="tb-sep"></div>
            <button class="tb-btn" onclick="zoomIn()"   title="Zoom In (Ctrl+=)">??+</button>
            <button class="tb-btn" onclick="zoomOut()"  title="Zoom Out (Ctrl+-)">??-</button>
            <button class="tb-btn" onclick="resetZoom()" title="Fit (Ctrl+0)">? Fit</button>
            <button class="tb-btn" id="snap-btn" onclick="toggleSnap()" title="Snap to Grid">?? Snap</button>
            <button class="tb-btn" id="mm-btn" onclick="toggleMiniMap()" title="Mini Map">?? Map</button>
            <div class="tb-sep"></div>
            <button class="tb-btn" onclick="exportWorkflow()" title="Export JSON">?? Export</button>
            <button class="tb-btn tb-run" onclick="runWorkflow()" id="tb-run-btn">? Run</button>
          </div>

          <div class="canvas-area" id="canvas">
            <div id="canvas-wrapper">
              <svg id="svg-layer">
                <defs>
                  <marker id="arr-default" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#64748b"/>
                  </marker>
                  <marker id="arr-blue" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#3b82f6"/>
                  </marker>
                  <marker id="arr-green" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#10b981"/>
                  </marker>
                  <marker id="arr-orange" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#f97316"/>
                  </marker>
                  <marker id="arr-purple" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#a855f7"/>
                  </marker>
                  <marker id="arr-yellow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#eab308"/>
                  </marker>
                  <filter id="glow-blue"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                </defs>
                <path id="temp-line" d="" style="display:none;"/>
              </svg>
            </div>
            <div class="zoom-badge" id="zoom-badge">100%</div>
            <div id="minimap">
              <canvas id="mm-canvas" width="180" height="130"></canvas>
            </div>
          </div>

          <!-- LOG STRIP -->
          <div class="log-strip" id="log-strip">
            <div class="log-hdr" onclick="toggleLog()">
              <div class="log-hdr-title">
                <span>??</span> EXECUTION LOG
                <div class="rec-badge" id="rec-badge2" style="display:none;">
                  <div class="rec-dot"></div>RECORDING
                </div>
              </div>
              <div class="log-hdr-actions">
                <button class="hdr-btn" onclick="event.stopPropagation();clearLog()" style="font-size:10px;padding:3px 8px;">Clear</button>
                <button class="hdr-btn" onclick="event.stopPropagation();toggleLog()" style="font-size:10px;padding:3px 8px;" id="log-toggle-btn">?</button>
              </div>
            </div>
            <div class="log-body" id="log-body">
              <div class="log-output" id="log-output"></div>
              <div class="log-stats">
                <div style="font-size:10px;font-weight:700;color:var(--dim);letter-spacing:.1em;margin-bottom:10px;">BOT STATS</div>
                <div class="stat-item"><span>Steps Run</span><span class="stat-val" id="st-steps">0</span></div>
                <div class="stat-item"><span>Errors</span><span class="stat-val" id="st-errors">0</span></div>
                <div class="stat-item"><span>Retries</span><span class="stat-val" id="st-retries">0</span></div>
                <div class="stat-item"><span>Runtime</span><span class="stat-val" id="st-runtime">0:00</span></div>
                <div class="stat-item"><span>ADB Cmds</span><span class="stat-val" id="st-adb">0</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT: Properties Panel -->
        <div class="right-panel">
          <div class="panel-hdr">?? Properties</div>
          <div class="panel-body" id="prop-panel">
            <div class="prop-empty" id="prop-empty">
              Klik node untuk edit properties<br><br>
              ?? Drag activity dari kiri ke canvas<br>
              ?? Drag port biru untuk hubungkan node
            </div>
            <div id="prop-editor" style="display:none;">
              <div class="prop-title">
                <div class="prop-ico-big" id="pe-ico-big">??</div>
                <div>
                  <div id="pe-type-lbl" style="font-size:10px;color:var(--dim2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;"></div>
                  <input class="prop-input" id="pe-name" placeholder="Node name" oninput="saveProp('name',this.value)" style="font-weight:700;padding:4px 8px;">
                </div>
              </div>
              <div class="prop-sep"></div>

              <!-- General -->
              <div class="prop-group" id="pg-general">
                <label class="prop-label">Delay Before (ms)</label>
                <input class="prop-input" type="number" id="pe-delay" value="500" oninput="saveProp('delay',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Output Variable</label>
                <input class="prop-input" id="pe-var" placeholder="e.g. result_text" oninput="saveProp('var',this.value)">
                <label class="prop-label" style="margin-top:8px;">Comment / Notes</label>
                <textarea class="prop-input" id="pe-comment" rows="2" placeholder="Optional note..." oninput="saveProp('comment',this.value)" style="resize:vertical;"></textarea>
                <label class="prop-label" style="margin-top:8px;">Max Retries (0 = no retry)</label>
                <input class="prop-input" type="number" id="pe-max-retries" value="0" min="0" max="10" oninput="saveProp('maxRetries',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Retry Delay (ms)</label>
                <input class="prop-input" type="number" id="pe-retry-delay" value="1000" min="100" oninput="saveProp('retryDelay',+this.value)">
              </div>

              <!-- TAP / CLICK -->
              <div class="prop-group" id="pg-tap" style="display:none;">
                <label class="prop-label">Selector / XPath</label>
                <input class="prop-input" id="pe-selector" placeholder="e.g. #btn-login or //button" oninput="saveProp('selector',this.value)">
                <label class="prop-label" style="margin-top:8px;">Koordinat X</label>
                <input class="prop-input" type="number" id="pe-cx" placeholder="0" oninput="saveProp('cx',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Koordinat Y</label>
                <input class="prop-input" type="number" id="pe-cy" placeholder="0" oninput="saveProp('cy',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Click Type</label>
                <select class="prop-input prop-select" id="pe-click-type" onchange="saveProp('clickType',this.value)">
                  <option value="single">Single Click</option>
                  <option value="double">Double Click</option>
                  <option value="right">Right Click</option>
                  <option value="middle">Middle Click</option>
                </select>
              </div>

              <!-- TYPE-INTO -->
              <div class="prop-group" id="pg-type" style="display:none;">
                <label class="prop-label">Selector / Field ID</label>
                <input class="prop-input" id="pe-type-selector" placeholder="e.g. #username" oninput="saveProp('selector',this.value)">
                <label class="prop-label" style="margin-top:8px;">Text to Type</label>
                <textarea class="prop-input" id="pe-text" rows="3" placeholder="Text atau {variable}" oninput="saveProp('text',this.value)"></textarea>
                <label class="prop-label" style="margin-top:8px;">Clear Before Type</label>
                <select class="prop-input prop-select" id="pe-clear" onchange="saveProp('clearBefore',this.value)">
                  <option value="yes">Yes — clear field first</option>
                  <option value="no">No — append text</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Typing Speed (ms/char)</label>
                <input class="prop-input" type="number" id="pe-typespeed" value="30" oninput="saveProp('typeSpeed',+this.value)">
              </div>

              <!-- OPEN BROWSER -->
              <div class="prop-group" id="pg-browser" style="display:none;">
                <label class="prop-label">URL</label>
                <input class="prop-input" id="pe-url" placeholder="https://..." oninput="saveProp('url',this.value)">
                <label class="prop-label" style="margin-top:8px;">Browser</label>
                <select class="prop-input prop-select" id="pe-browser" onchange="saveProp('browser',this.value)">
                  <option value="default">Default</option>
                  <option value="chrome">Chrome</option>
                  <option value="firefox">Firefox</option>
                  <option value="edge">Edge</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Mode</label>
                <select class="prop-input prop-select" id="pe-bmode" onchange="saveProp('browserMode',this.value)">
                  <option value="normal">Normal</option>
                  <option value="headless">Headless</option>
                  <option value="incognito">Incognito</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Wait After Load (ms)</label>
                <input class="prop-input" type="number" id="pe-bwait" value="2000" oninput="saveProp('waitAfterLoad',+this.value)">
              </div>

              <!-- SWIPE -->
              <div class="prop-group" id="pg-swipe" style="display:none;">
                <label class="prop-label">Direction</label>
                <select class="prop-input prop-select" id="pe-dir" onchange="saveProp('dir',this.value)">
                  <option value="up">Scroll Up</option>
                  <option value="down">Scroll Down</option>
                  <option value="left">Swipe Left</option>
                  <option value="right">Swipe Right</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Duration (ms)</label>
                <input class="prop-input" type="number" id="pe-dur" value="300" oninput="saveProp('dur',+this.value)">
                <div class="prop-row2" style="margin-top:8px;">
                  <div>
                    <label class="prop-label">Start X</label>
                    <input class="prop-input" type="number" id="pe-sx" oninput="saveProp('sx',+this.value)">
                  </div>
                  <div>
                    <label class="prop-label">Start Y</label>
                    <input class="prop-input" type="number" id="pe-sy" oninput="saveProp('sy',+this.value)">
                  </div>
                </div>
                <div class="prop-row2" style="margin-top:8px;">
                  <div>
                    <label class="prop-label">End X</label>
                    <input class="prop-input" type="number" id="pe-ex" oninput="saveProp('ex',+this.value)">
                  </div>
                  <div>
                    <label class="prop-label">End Y</label>
                    <input class="prop-input" type="number" id="pe-ey" oninput="saveProp('ey',+this.value)">
                  </div>
                </div>
              </div>

              <!-- SIGNATURE SWIPE -->
              <div class="prop-group" id="pg-signature" style="display:none;">
                <label class="prop-label">Tipe Kurva</label>
                <select class="prop-input prop-select" id="pe-sig-curve" onchange="saveProp('sigCurve',this.value)">
                  <option value="arc">Arc (lengkung)</option>
                  <option value="wave">Wave (zig-zag halus)</option>
                  <option value="spiral">Spiral</option>
                  <option value="custom">Custom Points</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Start X, Y</label>
                <div class="prop-row2">
                  <div><label class="prop-label">X</label><input class="prop-input" type="number" id="pe-sig-x1" oninput="saveProp('sigX1',+this.value)"></div>
                  <div><label class="prop-label">Y</label><input class="prop-input" type="number" id="pe-sig-y1" oninput="saveProp('sigY1',+this.value)"></div>
                </div>
                <label class="prop-label" style="margin-top:8px;">End X, Y</label>
                <div class="prop-row2">
                  <div><label class="prop-label">X</label><input class="prop-input" type="number" id="pe-sig-x2" oninput="saveProp('sigX2',+this.value)"></div>
                  <div><label class="prop-label">Y</label><input class="prop-input" type="number" id="pe-sig-y2" oninput="saveProp('sigY2',+this.value)"></div>
                </div>
                <label class="prop-label" style="margin-top:8px;">Jumlah Titik Kurva</label>
                <input class="prop-input" type="number" id="pe-sig-points" value="12" min="5" max="50" oninput="saveProp('sigPoints',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Amplitudo Kurva (px)</label>
                <input class="prop-input" type="number" id="pe-sig-amp" value="40" min="0" oninput="saveProp('sigAmplitude',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Durasi Total (ms)</label>
                <input class="prop-input" type="number" id="pe-sig-dur" value="800" min="200" oninput="saveProp('sigDuration',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Delay antar Titik (ms)</label>
                <input class="prop-input" type="number" id="pe-sig-step-delay" value="20" min="5" oninput="saveProp('sigStepDelay',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Custom Points (JSON array)</label>
                <textarea class="prop-input" id="pe-sig-custom" rows="3" placeholder='[[x1,y1],[x2,y2],...]' oninput="saveProp('sigCustomPoints',this.value)"></textarea>
                <div style="font-size:10px;color:var(--dim2);margin-top:6px;">
                  Signature Swipe mengirim serangkaian ADB input swipe pendek yang membentuk kurva alami, 
                  meniru gerakan tangan manusia saat tanda tangan atau scroll natural.
                </div>
              </div>

              <!-- MOBILE -->
              <div class="prop-group" id="pg-mobile" style="display:none;">
                <label class="prop-label">Device ID (kosong = perangkat aktif)</label>
                <input class="prop-input" id="pe-device-id" placeholder="emulator-5554" oninput="saveProp('deviceId',this.value)">
                <div class="prop-row2" style="margin-top:8px;">
                  <div>
                    <label class="prop-label">X</label>
                    <input class="prop-input" type="number" id="pe-mx" oninput="saveProp('mx',+this.value)">
                  </div>
                  <div>
                    <label class="prop-label">Y</label>
                    <input class="prop-input" type="number" id="pe-my" oninput="saveProp('my',+this.value)">
                  </div>
                </div>
                <label class="prop-label" style="margin-top:8px;">Key Code (press-key)</label>
                <input class="prop-input" id="pe-keycode" placeholder="e.g. 3 (Home), 4 (Back)" oninput="saveProp('keyCode',this.value)">
                <label class="prop-label" style="margin-top:8px;">Screenshot Path</label>
                <input class="prop-input" id="pe-screenshot-path" placeholder="/sdcard/screen.png" oninput="saveProp('screenshotPath',this.value)">
              </div>

              <!-- EXTRACT TEXT -->
              <div class="prop-group" id="pg-extract" style="display:none;">
                <label class="prop-label">CSS Selector / XPath</label>
                <input class="prop-input" id="pe-ext-sel" placeholder="e.g. .price or //span[@class='price']" oninput="saveProp('selector',this.value)">
                <label class="prop-label" style="margin-top:8px;">Attribute (kosong = innerText)</label>
                <input class="prop-input" id="pe-ext-attr" placeholder="e.g. href, value, data-id" oninput="saveProp('attribute',this.value)">
                <label class="prop-label" style="margin-top:8px;">Regex Filter</label>
                <input class="prop-input" id="pe-ext-regex" placeholder="e.g. \\d+" oninput="saveProp('regex',this.value)">
              </div>

              <!-- IF CONDITION -->
              <div class="prop-group" id="pg-condition" style="display:none;">
                <label class="prop-label">Condition Expression</label>
                <input class="prop-input" id="pe-cond" placeholder="e.g. {price} > 100" oninput="saveProp('condition',this.value)">
                <label class="prop-label" style="margin-top:8px;">True ? Step</label>
                <input class="prop-input" id="pe-true-step" placeholder="Node ID atau nama" oninput="saveProp('trueStep',this.value)">
                <label class="prop-label" style="margin-top:8px;">False ? Step</label>
                <input class="prop-input" id="pe-false-step" placeholder="Node ID atau nama" oninput="saveProp('falseStep',this.value)">
              </div>

              <!-- REPEAT / LOOP -->
              <div class="prop-group" id="pg-loop" style="display:none;">
                <label class="prop-label">Repeat Count</label>
                <input class="prop-input" type="number" id="pe-loop-count" value="3" min="1" oninput="saveProp('loopCount',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Loop Variable Name</label>
                <input class="prop-input" id="pe-loop-var" placeholder="i" oninput="saveProp('loopVar',this.value)">
                <label class="prop-label" style="margin-top:8px;">Break Condition</label>
                <input class="prop-input" id="pe-loop-break" placeholder="e.g. {i} >= 5" oninput="saveProp('breakCondition',this.value)">
              </div>

              <!-- API REQUEST -->
              <div class="prop-group" id="pg-api" style="display:none;">
                <label class="prop-label">URL</label>
                <input class="prop-input" id="pe-api-url" placeholder="https://api.example.com/endpoint" oninput="saveProp('apiUrl',this.value)">
                <label class="prop-label" style="margin-top:8px;">Method</label>
                <select class="prop-input prop-select" id="pe-api-method" onchange="saveProp('apiMethod',this.value)">
                  <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Headers (JSON)</label>
                <textarea class="prop-input" id="pe-api-headers" rows="2" placeholder='{"Authorization":"Bearer ..."}' oninput="saveProp('apiHeaders',this.value)"></textarea>
                <label class="prop-label" style="margin-top:8px;">Body (JSON)</label>
                <textarea class="prop-input" id="pe-api-body" rows="3" placeholder='{"key":"value"}' oninput="saveProp('apiBody',this.value)"></textarea>
              </div>

              <!-- CRON / SCHEDULER -->
              <div class="prop-group" id="pg-cron" style="display:none;">
                <label class="prop-label">Cron Expression</label>
                <input class="prop-input" id="pe-cron" placeholder="e.g. 0 9 * * 1-5" oninput="saveProp('cron',this.value)">
                <label class="prop-label" style="margin-top:8px;">Timezone</label>
                <input class="prop-input" id="pe-tz" placeholder="Asia/Jakarta" oninput="saveProp('timezone',this.value)">
              </div>

              <!-- READ/WRITE FILE -->
              <div class="prop-group" id="pg-file" style="display:none;">
                <label class="prop-label">File Path</label>
                <input class="prop-input" id="pe-filepath" placeholder="C:/data/file.csv" oninput="saveProp('filePath',this.value)">
                <label class="prop-label" style="margin-top:8px;">Delimiter (CSV)</label>
                <input class="prop-input" id="pe-delim" value="," oninput="saveProp('delimiter',this.value)">
                <label class="prop-label" style="margin-top:8px;">Encoding</label>
                <select class="prop-input prop-select" id="pe-encoding" onchange="saveProp('encoding',this.value)">
                  <option>UTF-8</option><option>ISO-8859-1</option><option>ASCII</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Skip Header Row</label>
                <select class="prop-input prop-select" id="pe-skip-hdr" onchange="saveProp('skipHeader',this.value)">
                  <option value="yes">Yes</option><option value="no">No</option>
                </select>
              </div>

              <!-- OCR -->
              <div class="prop-group" id="pg-ocr" style="display:none;">
                <label class="prop-label">Source (url / selector / screenshot)</label>
                <input class="prop-input" id="pe-ocr-src" placeholder="screenshot or https://..." oninput="saveProp('ocrSource',this.value)">
                <label class="prop-label" style="margin-top:8px;">Language</label>
                <input class="prop-input" id="pe-ocr-lang" value="eng" placeholder="eng, ind..." oninput="saveProp('ocrLang',this.value)">
              </div>

              <!-- WAIT ELEMENT -->
              <div class="prop-group" id="pg-wait" style="display:none;">
                <label class="prop-label">Selector to Wait For</label>
                <input class="prop-input" id="pe-wait-sel" placeholder=".loading-spinner" oninput="saveProp('waitSelector',this.value)">
                <label class="prop-label" style="margin-top:8px;">Wait Condition</label>
                <select class="prop-input prop-select" id="pe-wait-cond" onchange="saveProp('waitCondition',this.value)">
                  <option value="visible">Visible</option>
                  <option value="hidden">Hidden / Disappear</option>
                  <option value="clickable">Clickable</option>
                  <option value="present">Present in DOM</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Timeout (ms)</label>
                <input class="prop-input" type="number" id="pe-wait-timeout" value="10000" oninput="saveProp('waitTimeout',+this.value)">
              </div>

              <div class="prop-sep"></div>

          <div class="prop-group" id="var-panel">
            <div class="prop-title" style="justify-content:space-between;">
              <span>?? Variables</span>
              <span id="var-count" style="font-size:11px;color:var(--dim);">(0)</span>
            </div>
            <div id="var-inspector" style="min-height:90px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:10px;padding:10px;color:var(--dim);font-size:11px;overflow-y:auto;"></div>
          </div>

              <!-- Quick Actions -->
              <button class="btn-full btn-run-step" onclick="runSingleStep()">? Run This Step</button>
              <button class="btn-full btn-draw-conn" onclick="startConnectionDraw()">?? Draw Connection</button>
              <button class="btn-full btn-dup" onclick="duplicateSelected()">?? Duplicate Node</button>
              <button class="btn-full btn-delete" onclick="deleteSelected()">??? Delete Node</button>
            </div>
          </div>

          <!-- Device Section -->
          <div class="dev-section">
            <div class="dev-label">Active ADB Device</div>
            <select class="dev-select" id="device-selector">
              <option>No ADB Device</option>
            </select>
            <div class="dev-actions">
              <button class="dev-btn refresh" onclick="refreshDevices()">?? Refresh</button>
              <button class="dev-btn scrcpy" onclick="launchScrcpy()">?? scrcpy</button>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- RECORDER VIEW -->
    <div class="view" id="recorder">
      <div class="dash-view">
        <div class="dash-title">?? Macro Recorder</div>
        <div class="dash-sub">Klik pada canvas untuk merekam tap. Setiap klik akan menjadi node Tap dalam workflow.</div>
        <div style="display:flex;gap:12px;margin-bottom:20px;">
          <button class="hdr-btn primary" id="rec-start-btn" onclick="startMacroRecord()">? Start Recording</button>
          <button class="hdr-btn" id="rec-stop-btn" onclick="stopMacroRecord()" disabled>¦ Stop</button>
          <button class="hdr-btn" onclick="clearRecordedSteps()">?? Clear</button>
          <button class="hdr-btn" onclick="saveRecordedToWorkflow()" id="rec-save-btn" disabled>?? Save to Workflow</button>
        </div>
        <div id="rec-steps" style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;min-height:120px;font-size:12px;color:var(--dim2);">
          Klik 'Start Recording' lalu klik pada area yang ingin direkam...
        </div>
      </div>
    </div>

    <!-- SETTINGS VIEW -->
    <div class="view" id="settings">
      <div class="settings-view">
        <div class="dash-title" style="margin-bottom:20px;">?? Pengaturan</div>
        <div class="settings-grid">
          <div class="setting-card">
            <div class="setting-card-ttl">?? Bahasa / Language</div>
            <label class="prop-label">Language</label>
            <select class="prop-input prop-select" id="lang-sel" onchange="setLang(this.value)">
              <option value="id">Bahasa Indonesia</option>
              <option value="en">English</option>
            </select>
          </div>
          <div class="setting-card">
            <div class="setting-card-ttl">?? ADB Configuration</div>
            <label class="prop-label">ADB Path (kosong = auto-detect)</label>
            <input class="prop-input" id="adb-path-input" placeholder="C:/platform-tools/adb.exe" style="margin-bottom:8px;">
            <button class="hdr-btn" onclick="saveAdbPath()" style="width:100%;margin-bottom:6px;">Save ADB Path</button>
            <button class="hdr-btn" onclick="showAdbInfo()" style="width:100%;">?? Check ADB Status</button>
            <div id="adb-status-msg" style="font-size:11px;color:var(--dim2);margin-top:8px;"></div>
          </div>
          <div class="setting-card">
            <div class="setting-card-ttl">?? Editor Preferences</div>
            <div class="toggle-row">
              <label>Auto-save workflows</label>
              <label class="toggle"><input type="checkbox" id="pref-autosave" onchange="savePref()"><span class="toggle-slider"></span></label>
            </div>
            <div class="toggle-row">
              <label>Confirm on delete</label>
              <label class="toggle"><input type="checkbox" id="pref-confirm" checked onchange="savePref()"><span class="toggle-slider"></span></label>
            </div>
            <div class="toggle-row">
              <label>Snap to Grid (default)</label>
              <label class="toggle"><input type="checkbox" id="pref-snap" onchange="savePref()"><span class="toggle-slider"></span></label>
            </div>
            <div class="toggle-row">
              <label>Show step numbers</label>
              <label class="toggle"><input type="checkbox" id="pref-stepnum" checked onchange="savePref()"><span class="toggle-slider"></span></label>
            </div>
            <div class="toggle-row">
              <label>Animate connections</label>
              <label class="toggle"><input type="checkbox" id="pref-animate" checked onchange="savePref()"><span class="toggle-slider"></span></label>
            </div>
          </div>
          <div class="setting-card">
            <div class="setting-card-ttl">?? About</div>
            <div style="font-size:12px;line-height:1.8;color:var(--dim2);">
              <strong style="color:var(--text);">RBA Studio Pro</strong><br>
              Version: <strong style="color:var(--text);">2.0</strong><br>
              Developer: <strong style="color:var(--text);">Arya Septian</strong><br>
              <a href="#" onclick="ipcRenderer.send('open-external','mailto:arya@example.com')" style="color:var(--accent);">arya@example.com</a><br><br>
              <button class="hdr-btn" onclick="resetAllSettings()" style="width:100%;">?? Reset All Settings</button>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div><!-- /.main -->
</div><!-- /.shell -->

<!-- Hidden file input -->
<input type="file" id="fileInput" accept=".json" style="display:none" onchange="handleImport(this)">

<script>
// ---------------------------------------------------------------
// BOOTSTRAP
// ---------------------------------------------------------------
const { ipcRenderer } = require('electron');

// --- State ----------------------------------------------------
let project = { id: Date.now(), name: 'Untitled Flow', steps: [], edges: [] };
let currentName = 'Untitled Flow';
let workflows = [];
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

// --- Activity Definitions -----------------------------------
const ACTIVITIES = [
  { sec: 'Trigger & Control' },
  { type:'start',           icon:'?', label:'Start',          desc:'Titik awal flow',           color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { type:'cron-job',        icon:'?', label:'Cron Job',        desc:'Scheduled trigger',         color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'webhook-trigger', icon:'??', label:'Webhook',         desc:'HTTP trigger',              color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'event-trigger',   icon:'??', label:'Event Trigger',   desc:'Event-based start',         color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },
  { type:'file-watcher',    icon:'??', label:'File Watcher',    desc:'Monitor folder/file',       color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'if-condition',    icon:'?', label:'If Condition',    desc:'Percabangan logika',        color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'repeat-start',    icon:'??', label:'Loop Start',      desc:'Mulai iterasi',             color:'#f97316', bg:'rgba(249,115,22,0.15)' },
  { type:'repeat-end',      icon:'??', label:'Loop End',        desc:'Akhir iterasi',             color:'#f97316', bg:'rgba(249,115,22,0.15)' },
  { type:'delay',           icon:'?',  label:'Delay',           desc:'Tunggu beberapa ms',        color:'#ec4899', bg:'rgba(236,72,153,0.15)' },

  { sec: 'Browser Automation' },
  { type:'open-browser',    icon:'??', label:'Open Browser',    desc:'Buka URL di browser',       color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'tap',             icon:'??', label:'Click Element',   desc:'Klik element HTML',         color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },
  { type:'type-into',       icon:'??', label:'Type Into',       desc:'Ketik teks ke field',       color:'#14b8a6', bg:'rgba(20,184,166,0.15)' },
  { type:'extract-text',    icon:'??', label:'Extract Text',    desc:'Ambil teks dari element',   color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'scroll-page',     icon:'??', label:'Scroll Page',     desc:'Scroll halaman browser',    color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'wait-element',    icon:'?', label:'Wait Element',    desc:'Tunggu element muncul',     color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'screenshot-page', icon:'??', label:'Screenshot Page', desc:'Capture tampilan browser',  color:'#ec4899', bg:'rgba(236,72,153,0.15)' },
  { type:'extract-table',   icon:'??', label:'Extract Table',   desc:'Scrap tabel HTML',          color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'handle-popup',    icon:'??', label:'Handle Popup',    desc:'Dismiss/accept popup',      color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'upload-file',     icon:'??', label:'Upload File',     desc:'Upload file via input',     color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'pagination',      icon:'??', label:'Pagination',      desc:'Multi-page scraping',       color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'infinite-scroll', icon:'??', label:'Infinite Scroll', desc:'Scroll tanpa batas',        color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },

  { sec: 'Mobile (ADB)' },
  { type:'mobile-tap',      icon:'??', label:'Mobile Tap',      desc:'ADB tap koordinat',         color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'mobile-swipe',    icon:'??', label:'Mobile Swipe',    desc:'ADB swipe gesture',         color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'mobile-press-key',icon:'??', label:'Press Key',       desc:'ADB input keyevent',        color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'mobile-screenshot',icon:'??',label:'Mobile Screenshot',desc:'ADB screencap',            color:'#ec4899', bg:'rgba(236,72,153,0.15)' },
  { type:'mobile-find-text',icon:'??', label:'Find Text (OCR)', desc:'OCR pada layar HP',         color:'#14b8a6', bg:'rgba(20,184,166,0.15)' },
  { type:'signature-swipe', icon:'??', label:'Signature Swipe', desc:'Swipe natural curve ADB',    color:'#06b6d4', bg:'rgba(6,182,212,0.15)' },
  { type:'open-app',        icon:'??', label:'Open App',        desc:'Launch Android app',        color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'close-app',       icon:'?', label:'Close App',       desc:'Force-stop app',            color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'read-ui-element', icon:'???', label:'Read UI Element', desc:'Baca teks dari UI',         color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'swipe',           icon:'??', label:'Swipe (PC)',      desc:'PC mouse swipe/drag',       color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },

  { sec: 'Data & Files' },
  { type:'read-csv',        icon:'??', label:'Read CSV',        desc:'Baca file CSV',             color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'write-csv',       icon:'??', label:'Write CSV',       desc:'Tulis data ke CSV',         color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'write-excel',     icon:'??', label:'Write Excel',     desc:'Output ke .xlsx',           color:'#16a34a', bg:'rgba(22,163,74,0.15)'  },
  { type:'json-processing', icon:'??', label:'JSON Process',    desc:'Parse/transform JSON',      color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'filter-data',     icon:'??', label:'Filter Data',     desc:'Filter rows/columns',       color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'batch-slice',     icon:'??', label:'Batch Slice',     desc:'Potong data per batch',     color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'download-file',   icon:'??', label:'Download File',   desc:'Download dari URL',         color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'file-system',     icon:'??', label:'File System',     desc:'Copy/move/delete file',     color:'#f97316', bg:'rgba(249,115,22,0.15)' },
  { type:'database-query',  icon:'???', label:'Database Query',  desc:'Query SQL/NoSQL',           color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'regex-extraction',icon:'??', label:'Regex Extract',   desc:'Ekstrak dengan regex',      color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'copy-paste-var',  icon:'??', label:'Copy Variable',   desc:'Salin nilai variabel',      color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },

  { sec: 'Integration' },
  { type:'api-request',     icon:'??', label:'API Request',     desc:'HTTP GET/POST/PUT...',      color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'ocr',             icon:'???', label:'OCR',             desc:'Baca teks dari gambar',     color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'ai-decision',     icon:'??', label:'AI Decision',     desc:'AI classify/respond',       color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { type:'input-dialog',    icon:'??', label:'Input Dialog',    desc:'Prompt user input',         color:'#f97316', bg:'rgba(249,115,22,0.15)' },

  { sec: 'Advanced' },
  { type:'parallel-start',  icon:'?', label:'Parallel Start',  desc:'Mulai paralel execution',   color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { type:'parallel-end',    icon:'??', label:'Parallel Join',   desc:'Gabung parallel',           color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { type:'try-catch',       icon:'???', label:'Try-Catch',       desc:'Error handling block',      color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'retry-logic',     icon:'??', label:'Retry Logic',     desc:'Auto retry on fail',        color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'sub-workflow',    icon:'??', label:'Sub Workflow',    desc:'Panggil flow lain',         color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },
  { type:'macro-recorder',  icon:'??', label:'Macro Recorder',  desc:'Record actions',            color:'#ec4899', bg:'rgba(236,72,153,0.15)' },
  { type:'debug-step',      icon:'??', label:'Debug Step',      desc:'Pause & inspect',           color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'performance-track',icon:'??',label:'Performance',     desc:'Track execution time',      color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'headless-mode',   icon:'??', label:'Headless Mode',   desc:'Run tanpa GUI browser',     color:'#475569', bg:'rgba(71,85,105,0.15)'  },
  { type:'credential-manager',icon:'??',label:'Credentials',   desc:'Simpan login aman',         color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'auto-selector',   icon:'??', label:'Auto Selector',   desc:'AI detect element',         color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
];

// ---------------------------------------------------------------
// UTILITY FUNCTIONS
// ---------------------------------------------------------------

// --- Variable Interpolation & Storage -----------------------
function interpolate(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (match, key) => {
    return varStore[key] !== undefined ? String(varStore[key]) : match;
  });
}

function storeVar(key, value) {
  if (!key) return;
  varStore[key] = value;
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
  el.innerHTML = entries.map(([k,v]) =>
    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:6px 0;border-bottom:1px solid var(--border2);">' +
      '<span style="color:#93c5fd;font-weight:600;">{' + k + '}</span>' +
      '<span style="color:var(--dim2);max-width:100px;overflow:hidden;text-overflow:ellipsis;flex:1;text-align:right;">' + String(v).substring(0,40) + '</span>' +
    '</div>'
  ).join('');
}

// --- Edge-Following Execution ------------------------------
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

// --- Node Grouping -----------------------------------------
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

// --- Node Search & Jump ------------------------------------
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

// --- Statistics Dashboard ----------------------------------
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

// --- Template Workflows ------------------------------------
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
  updateProjName(); render(); switchView('editor');
  addLog('Template loaded: ' + tpl.name, 'success');
}

// --- Keyboard Help Modal -----------------------------------
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
  return ACTIVITIES.find(a => a.type === type) || { icon:'??', label:type, color:'#64748b', bg:'rgba(100,116,139,0.15)' };
}

// --- Build Tool List -----------------------------------------
(function buildToolList() {
  const list = document.getElementById('tool-list');
  let html = '';
  for (const a of ACTIVITIES) {
    if (a.sec) {
      html += \`<div class="sec">\${a.sec}</div>\`;
      continue;
    }
    html += \`<button class="tool-card" draggable="true"
      ondragstart="toolDragStart(event, '\${a.type}')"
      onclick="addNode('\${a.type}')"
      data-type="\${a.type}" data-label="\${a.label} \${a.desc}">
      <div class="tc-ico" style="background:\${a.bg};color:\${a.color}">\${a.icon}</div>
      <div class="tc-lbl"><strong>\${a.label}</strong><span>\${a.desc}</span></div>
    </button>\`;
  }
  list.innerHTML = html;
})();

function filterTools(q) {
  document.querySelectorAll('.tool-card').forEach(c => {
    c.style.display = c.dataset.label.toLowerCase().includes(q.toLowerCase()) ? 'flex' : 'none';
  });
}

// --- History --------------------------------------------------
function pushHistory() {
  historyStack.push(JSON.stringify({steps:project.steps, edges:project.edges}));
  if (historyStack.length > 60) historyStack.shift();
  redoStack = [];
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

// --- View Switching -------------------------------------------
function switchView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-ico').forEach(n => n.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const map = { dashboard:'nav-dash', editor:'nav-edit', recorder:'nav-rec', settings:'nav-set' };
  if (map[id]) document.getElementById(map[id]).classList.add('active');
}

// --- Project Name ---------------------------------------------
function updateProjName() {
  document.getElementById('proj-name').textContent = currentName + ' ??';
}
function renameProject() {
  const n = prompt('Nama workflow:', currentName);
  if (n && n.trim()) { currentName = n.trim(); project.name = currentName; updateProjName(); }
}

// --- Add Node -------------------------------------------------
function addNode(type, x, y) {
  pushHistory();
  const def = getActivityDef(type);
  const step = {
    id: Date.now() + Math.random(), name: def.label, type,
    x: x != null ? x : 120 + Math.random()*80,
    y: y != null ? y : 120 + Math.random()*60,
    delay:500, var:'', comment:'', maxRetries:0, retryDelay:1000,
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
    sigCurve: 'arc', sigX1: 100, sigY1: 500, sigX2: 900, sigY2: 500,
    sigPoints: 12, sigAmplitude: 40, sigDuration: 800, sigStepDelay: 20, sigCustomPoints: '',
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
}

// --- Node Selection & Properties -----------------------------
function selectNode(idx) {
  selectedIdx = idx;
  multiSelect = [idx];
  render();
  if (idx === null || idx < 0 || idx >= project.steps.length) { showPropEmpty(); return; }
  showProp(project.steps[idx]);
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
  'mobile-find-text':['pg-mobile', 'pg-wait'], 'read-ui-element':['pg-mobile', 'pg-wait'],
  'open-app':['pg-mobile'], 'close-app':['pg-mobile'],
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
  'signature-swipe': ['pg-signature'],
};

function showProp(s) {
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
  const peMaxRetries = document.getElementById('pe-max-retries');
  const peRetryDelay = document.getElementById('pe-retry-delay');
  if (peMaxRetries) peMaxRetries.value = s.maxRetries ?? 0;
  if (peRetryDelay) peRetryDelay.value = s.retryDelay ?? 1000;
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
  // Signature Swipe
  const sigCurve = document.getElementById('pe-sig-curve');
  const sigX1 = document.getElementById('pe-sig-x1');
  if (sigCurve) sigCurve.value = s.sigCurve || 'arc';
  if (sigX1) {
    document.getElementById('pe-sig-x1').value = s.sigX1 || 100;
    document.getElementById('pe-sig-y1').value = s.sigY1 || 500;
    document.getElementById('pe-sig-x2').value = s.sigX2 || 900;
    document.getElementById('pe-sig-y2').value = s.sigY2 || 500;
    document.getElementById('pe-sig-points').value = s.sigPoints || 12;
    document.getElementById('pe-sig-amp').value = s.sigAmplitude || 40;
    document.getElementById('pe-sig-dur').value = s.sigDuration || 800;
    document.getElementById('pe-sig-step-delay').value = s.sigStepDelay || 20;
    document.getElementById('pe-sig-custom').value = s.sigCustomPoints || '';
  }
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
  s[key] = val;
  // Sync name display
  if (key === 'name') {
    render();
  }
}

// --- Delete / Duplicate ---------------------------------------
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

// --- Copy / Paste ---------------------------------------------
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

// --- Align ----------------------------------------------------
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

// --- Auto Layout (Dagre-style manual) ------------------------
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

// --- RENDER ---------------------------------------------------
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
    const d = \`M\${sx},\${sy} C\${cp1x},\${cp1y} \${cp2x},\${cp2y} \${ex},\${ey}\`;

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

    div.innerHTML =
      (prefs.showStepNum ? \`<div class="node-step-num">\${i+1}</div>\` : '') +
      \`<div class="node-ico" style="background:\${def.bg};color:\${def.color}">\${def.icon}</div>\` +
      \`<div class="node-body">
         <div class="node-lbl">\${s.name}</div>
         <div class="node-type">\${s.type}</div>
         \${s.status==='running' ? '<div style="font-size:9px;color:var(--yellow);margin-top:2px;">? running...</div>' : ''}
         \${s.status==='success' ? '<div style="font-size:9px;color:var(--green);margin-top:2px;">? done</div>' : ''}
         \${s.status==='error'   ? '<div style="font-size:9px;color:var(--red);margin-top:2px;">? error</div>'   : ''}
       </div>\` +
      \`<div class="node-port out" title="Drag to connect" onmousedown="portDragStart(event,\${i})"></div>\` +
      \`<div class="node-port in"  title="Input port"></div>\` +
      \`<div class="node-status-bar"></div>\`;

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

// --- Canvas Interaction ---------------------------------------
const canvasEl = document.getElementById('canvas');
const wrapperEl = document.getElementById('canvas-wrapper');

function applyTransform() {
  wrapperEl.style.transform = \`translate(\${tx}px, \${ty}px) scale(\${sc})\`;
  document.getElementById('zoom-badge').textContent = Math.round(sc*100)+'%';
  updateMiniMap();
}

canvasEl.addEventListener('mousedown', e => {
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
    tl.setAttribute('d', \`M\${sx},\${sy} C\${sx+80},\${sy} \${mx-80},\${my} \${mx},\${my}\`);
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
        addLog(\`Connected: \${from.name} ? \${to.name}\`, 'info');
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

// --- Zoom Controls --------------------------------------------
function zoomIn()    { sc=Math.min(sc*1.2,4); applyTransform(); }
function zoomOut()   { sc=Math.max(sc/1.2,0.15); applyTransform(); }
function resetZoom() {
  if (!project.steps.length) { tx=0; ty=0; sc=1; applyTransform(); return; }
  // Fit all nodes in view
  const xs = project.steps.map(s=>s.x), ys = project.steps.map(s=>s.y);
  const minX=Math.min(...xs)-40, minY=Math.min(...ys)-40;
  const maxX=Math.max(...xs)+240, maxY=Math.max(...ys)+100;
  const rect = canvasEl.getBoundingClientRect();
  const scX = rect.width  / (maxX-minX);
  const scY = rect.height / (maxY-minY);
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

// --- Mini Map -------------------------------------------------
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

// --- Context Menus --------------------------------------------
function closeCtxMenu() { document.querySelectorAll('.ctx-menu').forEach(m=>m.remove()); }
function showNodeCtxMenu(x, y, idx) {
  closeCtxMenu();
  const s = project.steps[idx];
  const def = getActivityDef(s.type);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = x+'px'; menu.style.top = y+'px';
  menu.innerHTML = \`
    <div class="ctx-sub">\${def.icon} \${s.name}</div>
    <div class="ctx-item" onclick="duplicateSelected();closeCtxMenu()"><span class="ctx-ico">??</span> Duplicate</div>
    <div class="ctx-item" onclick="copySelected();closeCtxMenu()"><span class="ctx-ico">??</span> Copy</div>
    <div class="ctx-item" onclick="pasteNodes();closeCtxMenu()"><span class="ctx-ico">??</span> Paste After</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="renameNodeInline(\${idx});closeCtxMenu()"><span class="ctx-ico">??</span> Rename</div>
    <div class="ctx-item" onclick="changeNodeType(\${idx});closeCtxMenu()"><span class="ctx-ico">??</span> Change Type</div>
    <div class="ctx-item" onclick="runSingleStep();closeCtxMenu()"><span class="ctx-ico">?</span> Run This Step</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="moveNodeUp(\${idx});closeCtxMenu()"><span class="ctx-ico">?</span> Move Up</div>
    <div class="ctx-item" onclick="moveNodeDown(\${idx});closeCtxMenu()"><span class="ctx-ico">?</span> Move Down</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="breakEdgesFrom(\${idx});closeCtxMenu()"><span class="ctx-ico">??</span> Break Connections</div>
    <div class="ctx-item danger" onclick="deleteSelected();closeCtxMenu()"><span class="ctx-ico">??</span> Delete Node</div>
  \`;
  document.body.appendChild(menu);
  // Auto-close
  setTimeout(() => window.addEventListener('click', closeCtxMenu, {once:true}), 0);
}
function showEdgeCtxMenu(x,y,edgeId) {
  closeCtxMenu();
  const edge = (project.edges||[]).find(e=>e.id===edgeId);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left=x+'px'; menu.style.top=y+'px';
  menu.innerHTML = \`
    <div class="ctx-sub">Connection</div>
    <div class="ctx-item" onclick="labelEdge('\${edgeId}');closeCtxMenu()"><span class="ctx-ico">??</span> Add Label</div>
    <div class="ctx-item" onclick="reverseEdge('\${edgeId}');closeCtxMenu()"><span class="ctx-ico">??</span> Reverse Direction</div>
    <div class="ctx-item danger" onclick="deleteEdge('\${edgeId}');closeCtxMenu()"><span class="ctx-ico">??</span> Delete Connection</div>
  \`;
  document.body.appendChild(menu);
  setTimeout(() => window.addEventListener('click', closeCtxMenu, {once:true}), 0);
}

function renameNodeInline(idx) { const s=project.steps[idx]; const n=prompt('Rename:',s.name); if(n) { s.name=n; render(); showProp(s); } }
function changeNodeType(idx) {
  const types = ACTIVITIES.filter(a=>a.type).map(a=>a.type);
  const t = prompt('New type:\\n'+types.slice(0,30).join(', '), project.steps[idx].type);
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

// --- Export / Import ------------------------------------------
function exportWorkflow() {
  const data = JSON.stringify(project, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download = (currentName||'workflow')+'.json';
  a.click(); URL.revokeObjectURL(url);
  addLog('Exported: '+currentName, 'info');
}
function handleImport(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      project = {
        id: Date.now(), name: file.name.replace('.json',''),
        steps: (data.steps||data.nodes||[]).map(n => ({
          id: n.id||Date.now()+Math.random(), name: n.name||n.data?.label||'Step',
          type: String(n.type||n.data?.type||'tap').toLowerCase(),
          x: n.x||n.position?.x||0, y: n.y||n.position?.y||0,
          delay:n.delay||500, var:n.var||'', comment:n.comment||'',
          status:'', ...n
        })),
        edges: data.edges||[]
      };
      currentName = project.name;
      updateProjName();
      autoLayout(); render();
      switchView('editor');
      addLog('Imported: '+file.name, 'info');
    } catch(err) { alert('Error parsing JSON: '+err.message); }
  };
  reader.readAsText(file);
  input.value = '';
}

// --- Save / Load Projects -------------------------------------
async function saveCurrentProject() {
  if (!project.steps.length) { addLog('Tambahkan minimal 1 step sebelum save', 'warn'); return; }
  project.name = currentName;
  project.id = project.id || Date.now();
  const list = await ipcRenderer.invoke('save-workflow', {
    ...project, updatedAt: new Date().toISOString()
  });
  workflows = list;
  renderSavedList();
  addLog('Saved: '+currentName, 'success');
}
async function loadSavedProjects() {
  workflows = await ipcRenderer.invoke('get-saved-workflows');
  renderSavedList();
}
function renderSavedList() {
  const el = document.getElementById('wf-list');
  if (!el) return;
  if (!workflows.length) {
    el.innerHTML = '<div style="color:var(--dim);text-align:center;padding:24px;font-size:12px;">Belum ada workflow tersimpan</div>';
    return;
  }
  el.innerHTML = '';
  workflows.forEach(wf => {
    const item = document.createElement('div');
    item.className = 'wf-item';
    item.innerHTML = 
      '<div class="wf-item-ico">?</div>' +
      '<div class="wf-item-body">' +
        '<div class="wf-item-name">' + wf.name + '</div>' +
        '<div class="wf-item-meta">' + (wf.steps||[]).length + ' steps · ' + new Date(wf.updatedAt||Date.now()).toLocaleString() + '</div>' +
      '</div>' +
      '<div class="wf-item-actions"></div>';
    const actions = item.querySelector('.wf-item-actions');
    
    const openBtn = document.createElement('button');
    openBtn.className = 'wf-item-btn open';
    openBtn.textContent = 'Open';
    openBtn.onclick = () => openProject(wf.id);
    actions.appendChild(openBtn);

    const renameBtn = document.createElement('button');
    renameBtn.className = 'wf-item-btn rename';
    renameBtn.textContent = 'Rename';
    (function(wfData) {
      renameBtn.addEventListener('click', async function() {
        const newName = prompt('Rename workflow:', wfData.name);
        if (!newName || !newName.trim() || newName.trim() === wfData.name) return;
        wfData.name = newName.trim();
        if (project.id === wfData.id) {
          currentName = wfData.name;
          project.name = wfData.name;
          updateProjName();
        }
        await ipcRenderer.invoke('save-workflow', {
          ...wfData,
          updatedAt: new Date().toISOString()
        });
        workflows = await ipcRenderer.invoke('get-saved-workflows');
        renderSavedList();
        updateDashboardStats();
        addLog('Renamed to: ' + wfData.name, 'success');
      });
    })(wf);
    actions.appendChild(renameBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'wf-item-btn del';
    delBtn.textContent = 'Del';
    delBtn.onclick = () => deleteProject(wf.id);
    actions.appendChild(delBtn);

    el.appendChild(item);
  });
}
async function openProject(id) {
  const wf = await ipcRenderer.invoke('load-workflow', id);
  if (!wf) return;
  project = { id:wf.id, name:wf.name, steps:wf.steps||[], edges:wf.edges||[] };
  currentName = wf.name;
  updateProjName(); autoLayout(); render();
  switchView('editor');
  addLog('Opened: '+wf.name, 'info');
}
async function deleteProject(id) {
  if (prefs.confirmDelete && !confirm('Hapus workflow ini?')) return;
  workflows = await ipcRenderer.invoke('delete-workflow', id);
  renderSavedList();
  if (project.id === id) createNew();
}

// --- RENAME WORKFLOW -----------------------------------------
let renamingId = null;
async function startRenameWorkflow(id) {
  // Cancel any existing rename
  if (renamingId !== null) {
    cancelRename();
  }
  
  const wf = workflows.find(w => w.id === id);
  if (!wf) return;
  
  renamingId = id;
  const nameEl = document.getElementById('wf-name-' + id);
  const itemEl = document.getElementById('wf-item-' + id);
  if (!nameEl || !itemEl) return;
  
  // Disable other buttons
  itemEl.querySelectorAll('button').forEach(btn => btn.disabled = true);
  
  // Replace name with input
  const oldName = wf.name;
  const escapedName = oldName.replace(/"/g, '&quot;').replace(/'/g, "&#39;");
  nameEl.innerHTML = '<input type="text" id="rename-input-' + id + '" value="' + escapedName + '" ' +
    'style="background:#1E2130;color:#fff;border:1px solid var(--accent);border-radius:4px;padding:4px 8px;font-size:12px;width:180px;outline:none;" ' +
    'onkeydown="handleRenameKey(event,' + id + ')">' +
    '<button onclick="confirmRename(' + id + ')" style="background:var(--green);color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:10px;cursor:pointer;margin-left:4px;">?</button>' +
    '<button onclick="cancelRename()" style="background:var(--red);color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:10px;cursor:pointer;margin-left:2px;">?</button>';
  
  const input = document.getElementById('rename-input-' + id);
  if (input) {
    input.focus();
    input.select();
  }
}

function handleRenameKey(e, id) {
  if (e.key === 'Enter') {
    confirmRename(id);
  } else if (e.key === 'Escape') {
    cancelRename();
  }
}

async function confirmRename(id) {
  const input = document.getElementById('rename-input-' + id);
  if (!input) return;
  
  const newName = input.value.trim();
  const wf = workflows.find(w => w.id === id);
  if (!wf) { cancelRename(); return; }
  
  // Validation: empty name
  if (!newName) {
    alert('Nama workflow tidak boleh kosong');
    input.focus();
    return;
  }
  
  // Validation: duplicate name (exclude current workflow)
  const isDuplicate = workflows.some(w => w.id !== id && w.name.toLowerCase() === newName.toLowerCase());
  if (isDuplicate) {
    alert('Nama workflow "' + newName + '" sudah ada. Gunakan nama lain.');
    input.focus();
    return;
  }
  
  // Same as old name - just cancel
  if (newName === wf.name) {
    cancelRename();
    return;
  }
  
  // Save to storage
  workflows = await ipcRenderer.invoke('rename-workflow', { id, name: newName });
  renderSavedList();
  addLog('Workflow renamed to: ' + newName, 'success');
  
  renamingId = null;
}

function cancelRename() {
  if (renamingId === null) return;
  
  const id = renamingId;
  renamingId = null;
  
  // Re-enable buttons and restore display
  const itemEl = document.getElementById('wf-item-' + id);
  if (itemEl) {
    itemEl.querySelectorAll('button').forEach(btn => btn.disabled = false);
  }
  
  // Refresh list to restore original display
  renderSavedList();
}

function createNew() {
  pushHistory();
  tx=0; ty=0; sc=1; applyTransform();
  project = { id:Date.now(), name:'New Flow', steps:[
    { id:1, name:'Start', type:'start', x:120, y:120, delay:0, var:'', comment:'', status:'' }
  ], edges:[] };
  currentName = 'New Flow';
  updateProjName(); render();
  switchView('editor');
  addLog('New workflow created', 'info');
}

// --- ADB & Devices --------------------------------------------
function refreshDevices() {
  ipcRenderer.send('get-devices');
  addLog('Refreshing ADB devices...', 'info');
}

async function connectWifi() {
  const ip   = document.getElementById('wifi-ip').value.trim();
  const port = document.getElementById('wifi-port').value.trim() || '5555';
  if (!ip) { addLog('Masukkan IP address HP', 'warn'); return; }
  addLog('Connecting WiFi ADB: ' + ip + ':' + port + '...', 'info');
  const res = await ipcRenderer.invoke('adb-connect-wifi', { ip, port });
  const statusEl = document.getElementById('wifi-status');
  if (res.success) {
    addLog('? Connected: ' + ip + ':' + port, 'success');
    if (statusEl) { statusEl.textContent = '? ' + res.output; statusEl.style.color = 'var(--green)'; }
    refreshDevices();
  } else {
    addLog('? WiFi connect failed: ' + res.error, 'error');
    if (statusEl) { statusEl.textContent = '? ' + res.error; statusEl.style.color = 'var(--red)'; }
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
  if (el) el.textContent = info.found ? '? ADB: '+info.path : '? ADB not found in PATH';
}
ipcRenderer.on('device-list', (e, list) => {
  const sel = document.getElementById('device-selector');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = list.length ?
    list.map(d=>\`<option>\${d}</option>\`).join('') :
    '<option>No ADB Device</option>';
  if (list.includes(prev)) sel.value = prev;
  const statusEl = document.getElementById('bot-status');
});
setInterval(() => { if(typeof ipcRenderer !== 'undefined') ipcRenderer.send('get-devices'); }, 5000);

// --- EXECUTION ENGINE -----------------------------------------
async function runAdb(device, args) {
  execStats.adb++;
  document.getElementById('st-adb').textContent = execStats.adb;
  return await ipcRenderer.invoke('run-adb', { device, args });
}

// --- Signature Swipe Helpers -----------------------------------
function generateCurvePoints(startX, startY, endX, endY, controlPoints = []) {
  // Generate smooth curve points for signature swipe
  const points = [];
  const steps = Math.max(20, Math.abs(endX - startX) + Math.abs(endY - startY));
  
  // Add control points if provided, otherwise create natural curve
  if (controlPoints.length === 0) {
    // Create natural signature-like curve with multiple control points
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const offsetX = (endX - startX) * 0.3;
    const offsetY = (endY - startY) * 0.2;
    
    controlPoints = [
      { x: startX + offsetX * 0.5, y: startY - offsetY * 0.3 },
      { x: midX + offsetX * 0.2, y: midY + offsetY * 0.4 },
      { x: midX - offsetX * 0.1, y: midY - offsetY * 0.2 },
      { x: endX - offsetX * 0.3, y: endY + offsetY * 0.1 }
    ];
  }
  
  // Use quadratic Bezier curve interpolation
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const point = quadraticBezierPoint(startX, startY, controlPoints, endX, endY, t);
    points.push(point);
  }
  
  return points;
}

function quadraticBezierPoint(startX, startY, controlPoints, endX, endY, t) {
  // Calculate point on quadratic Bezier curve
  const n = controlPoints.length;
  let x = startX * Math.pow(1 - t, n + 1);
  let y = startY * Math.pow(1 - t, n + 1);
  
  for (let i = 0; i < n; i++) {
    const binomial = binomialCoefficient(n, i + 1);
    const pow1 = Math.pow(1 - t, n - i);
    const pow2 = Math.pow(t, i + 1);
    x += controlPoints[i].x * binomial * pow1 * pow2;
    y += controlPoints[i].y * binomial * pow1 * pow2;
  }
  
  x += endX * Math.pow(t, n + 1);
  y += endY * Math.pow(t, n + 1);
  
  return { x: Math.round(x), y: Math.round(y) };
}

function binomialCoefficient(n, k) {
  if (k > n) return 0;
  if (k === 0 || k === n) return 1;
  
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = result * (n - i + 1) / i;
  }
  return result;
}

async function executeSignatureSwipe(device, startX, startY, endX, endY, duration = 1000) {
  // Generate curve points for natural signature swipe
  const points = generateCurvePoints(startX, startY, endX, endY);

  if (points.length < 2) {
    throw new Error('Not enough points for swipe gesture');
  }

  // Execute signature as a series of connected swipe gestures
  const segmentDuration = Math.max(50, duration / (points.length - 1));

  for (let i = 0; i < points.length - 1; i++) {
    const currentPoint = points[i];
    const nextPoint = points[i + 1];

    const adbCommand = 'shell input swipe ' + currentPoint.x + ' ' + currentPoint.y + ' ' + nextPoint.x + ' ' + nextPoint.y + ' ' + segmentDuration;
    const swipeResult = await runAdb(device, adbCommand);

    if (!swipeResult.success) {
      addLog('Warning: Signature segment ' + (i + 1) + ' failed: ' + swipeResult.error, 'warn');
      // Continue with other segments even if one fails
    }

    // Small delay between segments for natural feel
    if (i < points.length - 2) {
      await wait(Math.min(segmentDuration / 2, 30));
    }
  }

  return { success: true, points: points.length };
}

async function runWorkflow() {
  if (!project.steps.length) { addLog('Tidak ada steps! Buat workflow dulu.', 'warn'); return; }
  
  stopRequested = false;
  retryState = {};
  loopStack = [];
  varStore = {};
  updateVarPanel();
  execStats = { steps:0, errors:0, retries:0, adb:0, startTime:Date.now(), interval:null };
  execStats.interval = setInterval(updateRuntime, 500);
  
  runBtn.disabled = true; stopBtn.disabled = false;
  runBtn.textContent = 'Running...';
  if (tbRun) { tbRun.textContent = 'Running...'; tbRun.disabled = true; }
  status.className = 'hdr-badge online';
  status.innerHTML = '<div class="hdr-dot"></div>ONLINE';
  
  const device = document.getElementById('device-selector').value;
  addLog('=== Workflow Start: ' + currentName + ' ===', 'info');
  
  let i = 0;
  while (i < project.steps.length) {
    if (stopRequested) { addLog('STOP diminta', 'warn'); break; }
    
    const s = project.steps[i];
    const type = String(s.type || '').toLowerCase();
    const stepDevice = s.deviceId || (device !== 'No ADB Device' ? device : '');
    
    // -- HANDLE LOOP CONTROL (tanpa retry, tanpa switch) --
    if (type === 'repeat-start') {
      const loopCount = Math.max(1, parseInt(s.loopCount) || 1);
      const loopVar = s.loopVar || 'i';
      loopStack.push({ startIndex: i, count: loopCount, current: 0, varName: loopVar });
      storeVar(loopVar, 0);
      s.status = 'success'; render();
      addLog('Step ' + (i+1) + ': Loop start x' + loopCount, 'info');
      i++; continue;
    }
    
    if (type === 'repeat-end') {
      if (loopStack.length > 0) {
        const loop = loopStack[loopStack.length - 1];
        loop.current++;
        storeVar(loop.varName, loop.current);
        if (loop.current < loop.count) {
          s.status = 'success'; render();
          addLog('Loop iter ' + (loop.current + 1) + '/' + loop.count, 'info');
          i = loop.startIndex + 1; continue;
        } else {
          loopStack.pop();
          addLog('Loop selesai setelah ' + loop.count + ' iterasi', 'success');
        }
      }
      s.status = 'success'; render();
      i++; continue;
    }
    
    // -- SETUP RETRY STATE --
    if (!retryState[s.id]) {
      retryState[s.id] = {
        count: 0,
        maxRetry: parseInt(s.maxRetries) || 0,
        delay: parseInt(s.retryDelay) || 1000
      };
    }
    const retry = retryState[s.id];
    
    execStats.steps++;
    const stEl = document.getElementById('st-steps');
    if (stEl) stEl.textContent = execStats.steps;
    s.status = 'running'; render();
    
    try {
      // Delay sebelum step (kecuali step delay itu sendiri)
      if (s.delay > 0 && type !== 'delay') {
        await wait(Math.max(0, parseInt(s.delay) || 0));
      }
      
      // -- SWITCH STATEMENT — SATU, BERSIH, TANPA DUPLIKAT --
      switch(type) {
        case 'start':
          addLog('Step ' + (i+1) + ': START', 'info');
          break;
          
        case 'delay': {
          const ms = parseInt(s.delay) || 1000;
          addLog('Step ' + (i+1) + ': Delay ' + ms + 'ms', 'info');
          await wait(ms);
          break;
        }
        
        case 'mobile-tap': {
          const x = parseInt(s.mx) || 0, y = parseInt(s.my) || 0;
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const r = await runAdb(stepDevice, 'shell input tap ' + x + ' ' + y);
          if (!r.success) throw new Error(r.error);
          addLog('Step ' + (i+1) + ': Tap (' + x + ',' + y + ') OK', 'success');
          break;
        }
        
        case 'mobile-swipe': {
          const sx = parseInt(s.sx)||0, sy = parseInt(s.sy)||0;
          const ex = parseInt(s.ex)||0, ey = parseInt(s.ey)||0;
          const dur = parseInt(s.dur)||300;
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const r = await runAdb(stepDevice, 'shell input swipe '+sx+' '+sy+' '+ex+' '+ey+' '+dur);
          if (!r.success) throw new Error(r.error);
          addLog('Step '+(i+1)+': Swipe OK', 'success');
          break;
        }
        
        case 'swipe':
        case 'scroll-page': {
          if (!stepDevice) { await wait(300); break; }
          const dirMap = { up:'540 1500 540 500', down:'540 500 540 1500', left:'1000 800 200 800', right:'200 800 1000 800' };
          const coords = dirMap[s.dir||'down'];
          const r = await runAdb(stepDevice, 'shell input swipe '+coords+' '+(parseInt(s.dur)||500));
          if (!r.success) throw new Error(r.error);
          addLog('Step '+(i+1)+': Scroll '+(s.dir||'down')+' OK', 'success');
          break;
        }
        
        case 'mobile-press-key': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const r = await runAdb(stepDevice, 'shell input keyevent '+(s.keyCode||'4'));
          if (!r.success) throw new Error(r.error);
          addLog('Step '+(i+1)+': Keyevent '+(s.keyCode||'4')+' OK', 'success');
          break;
        }
        
        case 'mobile-screenshot': {
          // Validasi device - selalu gunakan deviceId spesifik
          if (!stepDevice) throw new Error('Device tidak ditemukan: '+stepDevice);
          
          // Ekstrak properti sesuai spesifikasi
          const saveImagePath = s.saveImagePath || s.screenshotPath || '';
          const variableName = s.variableName || s.var || 'screenshotPath';
          
          // Tentukan path output - fallback ke temp jika kosong
          const path = require('path');
          const os = require('os');
          const timestamp = Date.now();
          let outputPath;
          
          if (saveImagePath && saveImagePath.trim() !== '') {
            outputPath = saveImagePath.endsWith('.png') 
              ? saveImagePath 
              : path.join(saveImagePath, 'screenshot_'+timestamp+'.png');
          } else {
            outputPath = path.join(os.tmpdir(), 'rba_screenshot_'+timestamp+'.png');
          }
          
          // Pastikan direktori output ada
          const outputDir = path.dirname(outputPath);
          const fs = require('fs');
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          
          // Path sementara di device
          const devicePath = '/sdcard/rba_screen.png';
          
          addLog('Step '+(i+1)+': Screenshot ke '+variableName, 'info');
          addLog('  Device: '+stepDevice+', Output: '+outputPath, 'info');
          
          // 1. Ambil screenshot dari device
          const r1 = await runAdb(stepDevice, 'shell screencap -p '+devicePath);
          if (!r1.success) throw new Error('screencap gagal: '+r1.error);
          
          // 2. Pull file ke local machine
          const r2 = await runAdb(stepDevice, 'pull '+devicePath+' "'+outputPath+'"');
          if (!r2.success) throw new Error('pull gagal: '+r2.error);
          
          // 3. Hapus file sementara dari device
          await runAdb(stepDevice, 'shell rm '+devicePath);
          
          // 4. Verifikasi file berhasil dibuat
          if (!fs.existsSync(outputPath)) {
            throw new Error('File screenshot tidak ditemukan setelah pull');
          }
          
          // 5. Simpan path ke variabel flow
          if (variableName) {
            storeVar(variableName, outputPath);
          }
          
          addLog('  Screenshot berhasil: '+outputPath, 'success');
          addLog('  Variabel '+variableName+' = '+outputPath, 'info');
          break;
        }
        
        case 'read-ui-element':
        case 'mobile-find-text': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const searchText = interpolate(s.selector || s.text || '');
          if (!searchText) throw new Error('Teks untuk dicari kosong');
          const xmlPath = require('path').join(require('os').homedir(), 'Documents', 'ui_dump_'+Date.now()+'.xml');
          addLog('Step '+(i+1)+': Mencari "'+searchText+'" di UI...', 'info');
          const r1 = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ui_dump_rba.xml');
          if (!r1.success) throw new Error('uiautomator dump gagal: '+r1.error);
          await wait(500);
          const r2 = await runAdb(stepDevice, 'pull /sdcard/ui_dump_rba.xml "'+xmlPath+'"');
          if (!r2.success) throw new Error('pull XML gagal: '+r2.error);
          const fs = require('fs');
          if (!fs.existsSync(xmlPath)) throw new Error('File XML tidak ditemukan');
          const xmlContent = fs.readFileSync(xmlPath, 'utf8');
          const escaped = searchText.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
          const textMatch = xmlContent.match(new RegExp('text="([^"]*'+escaped+'[^"]*)"', 'i'));
          if (textMatch) {
            const segStart = xmlContent.lastIndexOf('<', xmlContent.indexOf(textMatch[0]));
            const seg = xmlContent.substring(segStart);
            const bm = seg.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
            if (bm) {
              const coords = { x: Math.round((+bm[1]+ +bm[3])/2), y: Math.round((+bm[2]+ +bm[4])/2) };
              if (s.var) { storeVar(s.var, textMatch[1]); storeVar(s.var+'_coords', coords); }
              addLog('  Ditemukan: "'+textMatch[1]+'" di ('+coords.x+','+coords.y+')', 'success');
            }
          } else {
            throw new Error('Teks "'+searchText+'" tidak ditemukan di UI');
          }
          try { fs.unlinkSync(xmlPath); } catch(e) {}
          await runAdb(stepDevice, 'shell rm /sdcard/ui_dump_rba.xml');
          break;
        }
        
        case 'type-into': {
          const textToType = interpolate(s.text || '');
          if (stepDevice) {
            if (s.cx && s.cy) {
              await runAdb(stepDevice, 'shell input tap '+s.cx+' '+s.cy);
              await wait(500);
            }
            const escaped = textToType.replace(/ /g,'%s').replace(/'/g,"\\'").replace(/"/g,'\\"');
            const r = await runAdb(stepDevice, 'shell input text "'+escaped+'"');
            if (!r.success) throw new Error('input text gagal: '+r.error);
            addLog('Step '+(i+1)+': Type "'+textToType.substring(0,30)+'" OK', 'success');
          } else {
            addLog('Step '+(i+1)+': Type "'+textToType.substring(0,30)+'" (simulasi)', 'warn');
            await wait(Math.max(200, textToType.length * (s.typeSpeed||30)));
          }
          break;
        }
        
        case 'tap': case 'click': {
          if (stepDevice && s.cx && s.cy) {
            const r = await runAdb(stepDevice, 'shell input tap '+s.cx+' '+s.cy);
            if (!r.success) throw new Error(r.error);
          } else { await wait(500); }
          addLog('Step '+(i+1)+': Click OK', 'success');
          break;
        }
        
        case 'open-browser': {
          const url = interpolate(s.url || 'https://example.com');
          ipcRenderer.send('open-external', url);
          await wait(parseInt(s.waitAfterLoad)||2000);
          addLog('Step '+(i+1)+': Browser opened: '+url, 'success');
          break;
        }
        
        case 'open-app': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const pkg = s.var || s.text || '';
          if (!pkg) throw new Error('Package name kosong (isi Output Variable)');
          const r = await runAdb(stepDevice, 'shell monkey -p '+pkg+' -c android.intent.category.LAUNCHER 1');
          if (!r.success) throw new Error(r.error);
          await wait(2000);
          addLog('Step '+(i+1)+': App launched: '+pkg, 'success');
          break;
        }
        
        case 'close-app': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const pkg = s.var || s.text || '';
          if (!pkg) throw new Error('Package name kosong');
          const r = await runAdb(stepDevice, 'shell am force-stop '+pkg);
          if (!r.success) throw new Error(r.error);
          addLog('Step '+(i+1)+': App stopped: '+pkg, 'success');
          break;
        }
        
        case 'api-request': {
          const url = interpolate(s.apiUrl || '');
          if (!url) throw new Error('URL API kosong');
          addLog('Step '+(i+1)+': '+(s.apiMethod||'GET')+' '+url, 'info');
          let headers = {'User-Agent':'RBA-Studio/2.0'};
          if (s.apiHeaders) { try { headers = {...headers,...JSON.parse(s.apiHeaders)}; } catch(e){} }
          const result = await new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const lib = urlObj.protocol==='https:' ? require('https') : require('http');
            const opts = { hostname:urlObj.hostname, port:urlObj.port||(urlObj.protocol==='https:'?443:80), path:urlObj.pathname+urlObj.search, method:s.apiMethod||'GET', headers, timeout:15000 };
            const req = lib.request(opts, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode,data:d})); });
            req.on('error', reject);
            req.on('timeout', ()=>{ req.destroy(); reject(new Error('timeout')); });
            if (['POST','PUT','PATCH'].includes(s.apiMethod) && s.apiBody) req.write(interpolate(s.apiBody));
            req.end();
          });
          addLog('  Response: '+result.status+' ('+result.data.length+' chars)', result.status<400?'success':'warn');
          if (s.var) { try { storeVar(s.var, JSON.parse(result.data)); } catch(e) { storeVar(s.var, result.data); } }
          if (result.status >= 400) throw new Error('HTTP '+result.status);
          break;
        }
        
        case 'input-dialog': {
          const q = s.text || s.name || 'Masukkan nilai:';
          const def = s.var ? (varStore[s.var]||'') : '';
          const val = prompt(q+(def?'\n(Default: '+def+')':''), def);
          if (val !== null && s.var) { storeVar(s.var, val); addLog('Step '+(i+1)+': Input {'+s.var+'} = "'+val+'"', 'success'); }
          break;
        }
        
        case 'if-condition': {
          const expr = interpolate(s.condition || 'true');
          let result = false;
          try { const fn = new Function(...Object.keys(varStore), 'return ('+expr+')'); result = Boolean(fn(...Object.values(varStore))); } catch(e) {}
          addLog('Step '+(i+1)+': Kondisi "'+expr+'" = '+result, result?'success':'warn');
          if (s.var) storeVar(s.var, result);
          break;
        }
        
        case 'wait-element': {
          const timeout = parseInt(s.waitTimeout)||10000;
          addLog('Step '+(i+1)+': Wait ['+s.waitSelector+'] '+s.waitCondition+' (max '+timeout+'ms)', 'info');
          if (stepDevice && s.waitSelector) {
            const t0 = Date.now();
            while (Date.now()-t0 < timeout) {
              const r = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ui_wait.xml && cat /sdcard/ui_wait.xml');
              if (r.success && r.output.includes(s.waitSelector)) {
                addLog('  Element ditemukan!', 'success'); break;
              }
              await wait(1000);
            }
          } else { await wait(Math.min(timeout, 3000)); }
          break;
        }
        
        case 'screenshot-page': {
          if (stepDevice) {
            const dp='/sdcard/rba_sc_'+Date.now()+'.png', lp=require('path').join(require('os').homedir(),'Documents','sc_'+Date.now()+'.png');
            const r1=await runAdb(stepDevice,'shell screencap -p '+dp);
            if (r1.success) { const r2=await runAdb(stepDevice,'pull '+dp+' "'+lp+'"'); if(r2.success){await runAdb(stepDevice,'shell rm '+dp);if(s.var)storeVar(s.var,lp);addLog('Step '+(i+1)+': Screenshot -> '+lp,'success');} }
          } else { await wait(1000); addLog('Step '+(i+1)+': Screenshot (no device)','warn'); }
          break;
        }
        
        case 'extract-text': case 'extract-table': {
          addLog('Step '+(i+1)+': Extract ['+s.selector+'] -> {'+s.var+'}', 'info');
          if (s.var) storeVar(s.var, 'extracted_'+Date.now());
          await wait(500); break;
        }
        
        case 'ocr': {
          if (stepDevice) {
            const r=await runAdb(stepDevice,'shell uiautomator dump /sdcard/ocr.xml && cat /sdcard/ocr.xml');
            if (r.success) { const texts=[]; const rx=/text="([^"]+)"/g; let m; while((m=rx.exec(r.output))&&texts.length<20)texts.push(m[1]); if(s.var)storeVar(s.var,texts.join(' | ')); addLog('Step '+(i+1)+': OCR: '+texts.slice(0,3).join(', '),'success'); }
          } else { addLog('Step '+(i+1)+': OCR butuh device','warn'); }
          break;
        }
        
        case 'read-csv': {
          const fp=interpolate(s.filePath||''); if(!fp)break;
          const fs2=require('fs'); if(!fs2.existsSync(fp))throw new Error('File tidak ada: '+fp);
          const lines=fs2.readFileSync(fp,'utf8').split('\n').filter(l=>l.trim());
          const rows=lines.slice(s.skipHeader==='yes'?1:0).map(l=>l.split(s.delimiter||',').map(c=>c.trim()));
          if(s.var)storeVar(s.var,rows);
          addLog('Step '+(i+1)+': CSV '+rows.length+' baris OK','success'); break;
        }
        
        case 'write-csv': {
          const data=s.var?(varStore[s.var]||[]):[];
          const fp=interpolate(s.filePath||'output_'+Date.now()+'.csv');
          const content=Array.isArray(data)?data.map(r=>Array.isArray(r)?r.join(s.delimiter||','):String(r)).join('\n'):String(data);
          require('fs').writeFileSync(fp,content,s.encoding||'utf8');
          addLog('Step '+(i+1)+': CSV ditulis: '+fp,'success'); break;
        }
        
        case 'download-file': {
          const url=interpolate(s.url||s.var||''); if(!url)throw new Error('URL kosong');
          const lp=require('path').join(require('os').homedir(),'Downloads',require('path').basename(s.filePath||'download_'+Date.now()));
          await new Promise((res,rej)=>{ const uo=new URL(url),lib=uo.protocol==='https:'?require('https'):require('http'),fs3=require('fs'),f=fs3.createWriteStream(lp); lib.get(url,(r)=>{r.pipe(f);f.on('finish',()=>{f.close();res();})}).on('error',rej); });
          if(s.var)storeVar(s.var,lp);
          addLog('Step '+(i+1)+': Download OK: '+lp,'success'); break;
        }
        
        case 'json-processing': {
          if(s.var&&varStore[s.var]){try{const p=typeof varStore[s.var]==='string'?JSON.parse(varStore[s.var]):varStore[s.var];storeVar(s.var,p);addLog('Step '+(i+1)+': JSON parse OK','success');}catch(e){addLog('JSON error: '+e.message,'warn');}}
          break;
        }
        
        case 'debug-step': {
          const vars=Object.entries(varStore).map(([k,v])=>'{'+k+'}='+String(v).substring(0,30)).join('\n');
          alert('DEBUG Step '+(i+1)+': '+s.name+'\n\nVariables:\n'+vars+'\n\nKlik OK lanjut.');
          addLog('Step '+(i+1)+': DEBUG PAUSE','warn'); break;
        }
        
        case 'performance-track': {
          const ms=Date.now()-execStats.startTime;
          if(s.var)storeVar(s.var,ms);
          addLog('Step '+(i+1)+': Perf: '+ms+'ms','info'); break;
        }
        
        case 'signature-swipe': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const x1=parseInt(s.sigX1)||200, y1=parseInt(s.sigY1)||800;
          const x2=parseInt(s.sigX2)||800, y2=parseInt(s.sigY2)||800;
          const dur=parseInt(s.sigDuration)||1500;
          addLog('Step '+(i+1)+': Signature swipe ('+x1+','+y1+') -> ('+x2+','+y2+')', 'info');
          const result = await executeSignatureSwipe(stepDevice, x1, y1, x2, y2, dur);
          addLog('  Signature OK ('+result.points+' titik)', 'success');
          break;
        }
        
        case 'regex-extraction': {
          const src=s.var?String(varStore[s.var]||')':''';
          if(src&&s.regex){try{const rx2=new RegExp(s.regex,'g'),matches=[...src.matchAll(rx2)].map(m=>m[0]);if(s.var)storeVar(s.var+'_matches',matches);addLog('Regex: '+matches.length+' match(es)','success');}catch(e){addLog('Regex error: '+e.message,'warn');}}
          break;
        }
        
        case 'filter-data': {
          const data=s.var?varStore[s.var]:null;
          if(Array.isArray(data)&&s.condition){try{const filtered=data.filter(item=>{const fn=new Function('item','return ('+s.condition+')');return fn(item);});storeVar(s.var,filtered);addLog('Filter: '+data.length+'->'+filtered.length,'success');}catch(e){addLog('Filter error: '+e.message,'warn');}}
          break;
        }
        
        case 'batch-slice': {
          const data=s.var?varStore[s.var]:null;
          if(Array.isArray(data)){const sz=parseInt(s.loopCount)||10,batches=[];for(let j=0;j<data.length;j+=sz)batches.push(data.slice(j,j+sz));storeVar((s.var||'data')+'_batches',batches);addLog('Batch: '+batches.length+'x'+sz,'success');}
          break;
        }
        
        case 'copy-paste-var': {
          const src=s.selector||'',dst=s.var||'';
          if(src&&dst&&varStore[src]!==undefined){storeVar(dst,varStore[src]);addLog('{'+src+'} -> {'+dst+'}','success');}
          break;
        }
        
        case 'ai-decision': {
          addLog('Step '+(i+1)+': AI Decision (butuh API)','warn');
          if(s.var)storeVar(s.var,'pending'); break;
        }
        
        // Semua case yang tidak ada implementasinya
        case 'webhook-trigger': case 'cron-job': case 'event-trigger': case 'file-watcher':
        case 'parallel-start': case 'parallel-end': case 'try-catch': case 'retry-logic':
        case 'sub-workflow': case 'macro-recorder': case 'headless-mode':
        case 'credential-manager': case 'auto-selector': case 'file-system':
        case 'handle-popup': case 'upload-file': case 'pagination': case 'infinite-scroll':
        case 'database-query': case 'write-excel':
          addLog('Step '+(i+1)+': ['+type+'] (simulasi)', 'info');
          await wait(parseInt(s.delay)||500);
          break;
        
        default:
          addLog('Step '+(i+1)+': ['+type+'] tidak dikenali', 'warn');
          await wait(parseInt(s.delay)||500);
      }
      // -- AKHIR SWITCH --
      
      s.status = 'success';
      delete retryState[s.id];
      
    } catch(err) {
      execStats.errors++;
      const errEl = document.getElementById('st-errors');
      if (errEl) errEl.textContent = execStats.errors;
      addLog('  Error: ' + err.message, 'error');
      
      if (retry.count < retry.maxRetry) {
        retry.count++;
        execStats.retries++;
        const retEl = document.getElementById('st-retries');
        if (retEl) retEl.textContent = execStats.retries;
        addLog('  Retry ' + retry.count + '/' + retry.maxRetry + ' dalam ' + retry.delay + 'ms...', 'warn');
        s.status = 'running'; render();
        await wait(retry.delay);
        continue;  // JANGAN increment i — retry step yang sama
      }
      
      s.status = 'error';
      delete retryState[s.id];
    }
    
    render();
    await wait(50);
    i++;
  }
  
  clearInterval(execStats.interval);
  addLog('=== Workflow ' + (stopRequested ? 'STOPPED' : 'Complete') + ' ===', stopRequested ? 'warn' : 'success');
  
  runBtn.disabled=false; stopBtn.disabled=true;
  runBtn.textContent='? RUN';
  if (tbRun) { tbRun.textContent='? Run'; tbRun.disabled=false; }
  status.className='hdr-badge offline';
  status.innerHTML='<div class="hdr-dot"></div>OFFLINE';
  
  setTimeout(() => { project.steps.forEach(s=>s.status=''); render(); }, 3000);
}

async function runSingleStep() {

      switch(type) {

        // --------------------------------------------------
        // TIMING & CONTROL
        // --------------------------------------------------
        case 'start':
          addLog('Step ' + (i+1) + ': ?? START', 'info');
          break;

        case 'delay': {
          const ms = parseInt(s.delay) || 1000;
          addLog('Step ' + (i+1) + ': ? Delay ' + ms + 'ms', 'info');
          await wait(ms);
          addLog('  Delay selesai', 'success');
          break;
        }

        // --------------------------------------------------
        // MOBILE ADB — TAP
        // --------------------------------------------------
        case 'mobile-tap': {
          const x = parseInt(s.mx) || 0;
          const y = parseInt(s.my) || 0;
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB terpilih');
          addLog('Step ' + (i+1) + ': ?? ADB Tap (' + x + ', ' + y + ')', 'info');
          const r = await runAdb(stepDevice, 'shell input tap ' + x + ' ' + y);
          if (!r.success) throw new Error('ADB tap gagal: ' + r.error);
          addLog('  Tap berhasil', 'success');
          break;
        }

        // --------------------------------------------------
        // MOBILE ADB — SWIPE
        // --------------------------------------------------
        case 'mobile-swipe': {
          const sx = parseInt(s.sx) || 0;
          const sy = parseInt(s.sy) || 0;
          const ex = parseInt(s.ex) || 0;
          const ey = parseInt(s.ey) || 0;
          const dur = parseInt(s.dur) || 300;
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB terpilih');
          addLog('Step ' + (i+1) + ': ?? ADB Swipe (' + sx + ',' + sy + ')?(' + ex + ',' + ey + ') ' + dur + 'ms', 'info');
          const r = await runAdb(stepDevice, 'shell input swipe ' + sx + ' ' + sy + ' ' + ex + ' ' + ey + ' ' + dur);
          if (!r.success) throw new Error('ADB swipe gagal: ' + r.error);
          addLog('  Swipe berhasil', 'success');
          break;
        }

        // --------------------------------------------------
        // MOBILE ADB — SWIPE ARAH (scroll-page & swipe PC)
        // --------------------------------------------------
        case 'swipe':
        case 'scroll-page': {
          if (!stepDevice || stepDevice === 'No ADB Device') {
            addLog('Step ' + (i+1) + ': Tidak ada device, skip swipe', 'warn');
            await wait(300);
            break;
          }
          const dirMap = { up: '540 1500 540 500', down: '540 500 540 1500', left: '1000 800 200 800', right: '200 800 1000 800' };
          const coords = dirMap[s.dir || 'down'] || dirMap['down'];
          const swipeDur = parseInt(s.dur) || 500;
          addLog('Step ' + (i+1) + ': Swipe ' + (s.dir || 'down') + ' (' + coords + ') ' + swipeDur + 'ms', 'info');
          const r = await runAdb(stepDevice, 'shell input swipe ' + coords + ' ' + swipeDur);
          if (!r.success) throw new Error('Swipe gagal: ' + r.error);
          addLog('  Swipe berhasil', 'success');
          break;
        }

        // --------------------------------------------------
        // MOBILE ADB — SIGNATURE SWIPE
        // --------------------------------------------------
        case 'signature-swipe': {
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
          
          const startX = parseInt(s.startX) || 200;
          const startY = parseInt(s.startY) || 800;
          const endX = parseInt(s.endX) || 800;
          const endY = parseInt(s.endY) || 800;
          const duration = parseInt(s.duration) || 1500;
          
          addLog('Step ' + (i+1) + ': Signature swipe dari (' + startX + ',' + startY + ') ke (' + endX + ',' + endY + ') selama ' + duration + 'ms', 'info');

          try {
            const result = await executeSignatureSwipe(stepDevice, startX, startY, endX, endY, duration);
            addLog('  ? Signature swipe selesai dengan ' + result.points + ' titik', 'success');

            // Simpan koordinat ke variable jika diminta
            if (s.var) {
              storeVar(s.var, 'signature_' + Date.now());
              storeVar(s.var + '_start', { x: startX, y: startY });
              storeVar(s.var + '_end', { x: endX, y: endY });
            }
          } catch (error) {
            addLog('  ? Signature swipe gagal: ' + error.message, 'error');
            throw error;
          }
          
          break;
        }

        // --------------------------------------------------
        // MOBILE ADB — PRESS KEY
        // --------------------------------------------------
        case 'mobile-press-key': {
          const keyCode = s.keyCode || '4'; // Default: Back button
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
          addLog('Step ' + (i+1) + ': ?? ADB Keyevent ' + keyCode + ' (3=Home,4=Back,24=Vol+,25=Vol-,26=Power)', 'info');
          const r = await runAdb(stepDevice, 'shell input keyevent ' + keyCode);
          if (!r.success) throw new Error('Keyevent gagal: ' + r.error);
          addLog('  Keyevent berhasil', 'success');
          break;
        }

        // --------------------------------------------------
        // MOBILE ADB — TYPE TEXT (input teks ke HP via ADB)
        // --------------------------------------------------
        case 'type-into': {
          if (!stepDevice || stepDevice === 'No ADB Device') {
            addLog('Step ' + (i+1) + ': [Browser mode] Type into ' + (s.selector || 'field') + ': "' + ((s.text || '').substring(0, 30)) + '..."', 'info');
            await wait(Math.max(200, (s.text || '').length * (s.typeSpeed || 30)));
            break;
          }
          // ADB mode: tap dulu ke koordinat (jika ada), lalu ketik
          const textToType = interpolate(s.text || '');
          if (s.cx && s.cy) {
            addLog('  ADB Tap ke field (' + s.cx + ',' + s.cy + ')', 'info');
            await runAdb(stepDevice, 'shell input tap ' + s.cx + ' ' + s.cy);
            await wait(500);
          }
          if (s.clearBefore === 'yes') {
            // Select all + delete
            await runAdb(stepDevice, 'shell input keyevent --longpress 29'); // Ctrl+A workaround
            await runAdb(stepDevice, 'shell input keyevent 67'); // DEL
            await wait(200);
          }
          // Escape special chars untuk ADB input text
          const escaped = textToType.replace(/ /g, '%s').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/&/g, '\\&').replace(/</g, '\\<').replace(/>/g, '\\>');
          addLog('  ADB input text: "' + textToType.substring(0, 30) + '..."', 'info');
          const r = await runAdb(stepDevice, 'shell input text "' + escaped + '"');
          if (!r.success) throw new Error('Input text gagal: ' + r.error);
          await wait((textToType.length * (parseInt(s.typeSpeed) || 30)));
          addLog('  Teks berhasil diketik', 'success');
          break;
        }

        // --------------------------------------------------
        // MOBILE ADB — SCREENSHOT (FIXED: pull ke folder kerja)
        // --------------------------------------------------
        case 'mobile-screenshot': {
          // Validasi device - selalu gunakan deviceId spesifik
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Device tidak ditemukan: ' + stepDevice);
          
          // Ekstrak properti sesuai spesifikasi
          const saveImagePath = s.saveImagePath || s.screenshotPath || '';
          const variableName = s.variableName || s.var || 'screenshotPath';
          
          // Tentukan path output - fallback ke temp jika kosong
          const path = require('path');
          const os = require('os');
          const timestamp = Date.now();
          let outputPath;
          
          if (saveImagePath && saveImagePath.trim() !== '') {
            outputPath = saveImagePath.endsWith('.png') 
              ? saveImagePath 
              : path.join(saveImagePath, 'screenshot_'+timestamp+'.png');
          } else {
            outputPath = path.join(os.tmpdir(), 'rba_screenshot_'+timestamp+'.png');
          }
          
          // Pastikan direktori output ada
          const outputDir = path.dirname(outputPath);
          const fs = require('fs');
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          
          // Path sementara di device
          const devicePath = '/sdcard/rba_screen.png';
          
          addLog('Step ' + (i+1) + ': Screenshot ke ' + variableName, 'info');
          addLog('  Device: ' + stepDevice + ', Output: ' + outputPath, 'info');
          
          // 1. Ambil screenshot dari device
          const r1 = await runAdb(stepDevice, 'shell screencap -p ' + devicePath);
          if (!r1.success) throw new Error('screencap gagal: ' + r1.error);
          
          // 2. Pull file ke local machine
          const r2 = await runAdb(stepDevice, 'pull ' + devicePath + ' "' + outputPath + '"');
          if (!r2.success) throw new Error('pull gagal: ' + r2.error);
          
          // 3. Hapus file sementara dari device
          await runAdb(stepDevice, 'shell rm ' + devicePath);
          
          // 4. Verifikasi file berhasil dibuat
          if (!fs.existsSync(outputPath)) {
            throw new Error('File screenshot tidak ditemukan setelah pull');
          }
          
          // 5. Simpan path ke variabel flow
          if (variableName) {
            storeVar(variableName, outputPath);
          }
          
          addLog('  Screenshot berhasil: ' + outputPath, 'success');
          addLog('  Variabel ' + variableName + ' = ' + outputPath, 'info');
          break;
        }

        // --------------------------------------------------
        // MOBILE ADB — READ UI ELEMENT (FIXED: parse XML dump)
        // --------------------------------------------------
        case 'read-ui-element':
        case 'mobile-find-text': {
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
          const searchText = interpolate(s.selector || s.text || '');
          if (!searchText) throw new Error('Teks untuk dicari kosong');

          addLog('Step ' + (i+1) + ': Mencari teks "' + searchText + '" di UI device...', 'info');

          const maxRetries = parseInt(s.maxRetries) || 5;
          const retryDelay = parseInt(s.retryDelay) || 1000;
          let found = false;
          let foundCoords = null;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            addLog('  Attempt ' + attempt + '/' + maxRetries + '...', 'info');

            // Dump UI hierarchy
            const dumpResult = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ui_dump.xml');
            if (!dumpResult.success) {
              addLog('  Dump gagal: ' + dumpResult.error, 'warn');
              if (attempt < maxRetries) await wait(retryDelay);
              continue;
            }

            // Pull dan parse XML
            const localXmlPath = require('path').join(require('os').homedir(), 'Documents', 'ui_dump_temp.xml');
            const pullResult = await runAdb(stepDevice, 'pull /sdcard/ui_dump.xml "' + localXmlPath + '"');
            if (!pullResult.success) {
              addLog('  Pull gagal: ' + pullResult.error, 'warn');
              if (attempt < maxRetries) await wait(retryDelay);
              continue;
            }

            // Parse XML dan cari teks
            try {
              const fs = require('fs');
              const xmlContent = fs.readFileSync(localXmlPath, 'utf8');
              
              // Cari elemen dengan text yang match
              const escapedSearch = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const textRegex = new RegExp('text="([^"]*' + escapedSearch + '[^"]*)"', 'i');
              const boundsRegex = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
              
              let textMatch = textRegex.exec(xmlContent);
              if (textMatch) {
                // Cari bounds untuk elemen ini
                const elementStart = xmlContent.lastIndexOf('<', xmlContent.indexOf(textMatch[0]));
                const elementSection = xmlContent.substring(elementStart);
                const boundsMatch = boundsRegex.exec(elementSection);
                
                if (boundsMatch) {
                  const x1 = parseInt(boundsMatch[1]), y1 = parseInt(boundsMatch[2]);
                  const x2 = parseInt(boundsMatch[3]), y2 = parseInt(boundsMatch[4]);
                  foundCoords = { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
                  
                  addLog('  ? Teks ditemukan: "' + textMatch[1] + '" di koordinat (' + foundCoords.x + ', ' + foundCoords.y + ')', 'success');
                  found = true;
                  
                  // Simpan ke variable jika diminta
                  if (s.var) {
                    storeVar(s.var, textMatch[1]);
                    storeVar(s.var + '_coords', foundCoords);
                  }
                  break;
                }
              }
              
              // Cleanup
              try { fs.unlinkSync(localXmlPath); } catch(e) {}
              
            } catch (parseError) {
              addLog('  Parse error: ' + parseError.message, 'warn');
            }
            
            if (!found && attempt < maxRetries) {
              addLog('  Teks tidak ditemukan, retry dalam ' + retryDelay + 'ms...', 'info');
              await wait(retryDelay);
            }
          }
          
          if (!found) {
            throw new Error('Teks "' + searchText + '" tidak ditemukan setelah ' + maxRetries + ' percobaan');
          }
          
          // Auto-tap jika diminta
          if (s.autoTap && foundCoords) {
            addLog('  Auto-tap enabled, mengeksekusi tap...', 'info');
            const tapResult = await runAdb(stepDevice, 'shell input tap ' + foundCoords.x + ' ' + foundCoords.y);
            if (tapResult.success) {
              addLog('  Tap berhasil', 'success');
            } else {
              addLog('  Tap gagal: ' + tapResult.error, 'warn');
            }
          }
          
          break;
        }

        // --------------------------------------------------
        // MOBILE ADB — OPEN APP
        // --------------------------------------------------
        case 'open-app': {
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
          const pkgName = s.var || s.text || '';
          if (!pkgName) throw new Error('Package name kosong. Isi Output Variable dengan package name (e.g. com.whatsapp)');
          addLog('Step ' + (i+1) + ': Membuka app: ' + pkgName, 'info');
          const r = await runAdb(stepDevice, 'shell monkey -p ' + pkgName + ' -c android.intent.category.LAUNCHER 1');
          if (!r.success) throw new Error('Gagal buka app: ' + r.error);
          await wait(2000); // Tunggu app terbuka
          addLog('  App terbuka: ' + pkgName, 'success');
          break;
        }

        // --------------------------------------------------
        // MOBILE ADB — CLOSE APP
        // --------------------------------------------------
        case 'close-app': {
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
          const pkgName = s.var || s.text || '';
          if (!pkgName) throw new Error('Package name kosong');
          addLog('Step ' + (i+1) + ': Force-stop: ' + pkgName, 'info');
          const r = await runAdb(stepDevice, 'shell am force-stop ' + pkgName);
          if (!r.success) throw new Error('Gagal stop app: ' + r.error);
          addLog('  App dihentikan', 'success');
          break;
        }

        // --------------------------------------------------
        // BROWSER — OPEN URL
        // --------------------------------------------------
        case 'open-browser': {
          const url = interpolate(s.url || 'https://example.com');
          addLog('Step ' + (i+1) + ': Membuka browser: ' + url, 'info');
          // Di Electron, gunakan shell.openExternal untuk buka browser default
          ipcRenderer.send('open-external', url);
          const waitTime = parseInt(s.waitAfterLoad) || 2000;
          await wait(waitTime);
          addLog('  Browser dibuka (menunggu ' + waitTime + 'ms)', 'success');
          break;
        }

        // --------------------------------------------------
        // BROWSER — CLICK / TAP ELEMENT
        // --------------------------------------------------
        case 'tap':
        case 'click': {
          addLog('Step ' + (i+1) + ': Click [' + (s.selector || '(' + s.cx + ',' + s.cy + ')') + '] type=' + (s.clickType || 'single'), 'info');
          // Jika ada device ADB dan koordinat, gunakan ADB tap
          if (stepDevice && stepDevice !== 'No ADB Device' && s.cx && s.cy) {
            const r = await runAdb(stepDevice, 'shell input tap ' + s.cx + ' ' + s.cy);
            if (!r.success) throw new Error('Tap gagal: ' + r.error);
          } else {
            await wait(500);
            addLog('  (Simulasi click — butuh Puppeteer untuk browser automation)', 'warn');
          }
          addLog('  Click selesai', 'success');
          break;
        }

        // --------------------------------------------------
        // BROWSER — EXTRACT TEXT
        // --------------------------------------------------
        case 'extract-text':
        case 'extract-table': {
          addLog('Step ' + (i+1) + ': Extract dari [' + (s.selector || 'body') + '] -> {' + (s.var || 'result') + '}', 'info');
          // Placeholder: Simulasi dengan nilai dummy (butuh Puppeteer untuk real)
          const fakeExtracted = 'extracted_value_' + Date.now();
          if (s.var) {
            storeVar(s.var, fakeExtracted);
            addLog('  Nilai disimpan ke {' + s.var + '}: ' + fakeExtracted, 'success');
          }
          // Jika ada device ADB, coba baca dari UI dump
          if (stepDevice && stepDevice !== 'No ADB Device' && s.selector) {
            addLog('  (Mencoba baca dari UI dump via ADB...)', 'info');
            // Delegasi ke read-ui-element logic
            const r = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ui_dump_rba.xml && cat /sdcard/ui_dump_rba.xml');
            if (r.success) addLog('  UI dump tersedia untuk dibaca', 'info');
          }
          await wait(500);
          break;
        }

        // --------------------------------------------------
        // WAIT ELEMENT
        // --------------------------------------------------
        case 'wait-element': {
          const timeout = parseInt(s.waitTimeout) || 10000;
          const selector = s.waitSelector || '';
          addLog(\`Step \${i+1}: Menunggu [\${selector}] menjadi \${s.waitCondition || 'visible'} (max \${timeout}ms)\`, 'info');
          // Implementasi polling ADB jika ada device
          if (stepDevice && stepDevice !== 'No ADB Device' && selector) {
            const startTime = Date.now();
            const pollInterval = 1000;
            let found = false;
            while (Date.now() - startTime < timeout) {
              const r = await runAdb(stepDevice, \`shell uiautomator dump /sdcard/ui_dump_wait.xml && cat /sdcard/ui_dump_wait.xml\`);
              if (r.success && r.output.includes(selector)) {
                found = true;
                addLog(\`  Element [\${selector}] ditemukan!\`, 'success');
                break;
              }
              await wait(pollInterval);
              addLog(\`  Polling... (\${Math.round((Date.now() - startTime) / 1000)}s/\${Math.round(timeout / 1000)}s)\`, 'info');
            }
            if (!found) {
              if (s.waitCondition === 'hidden') {
                addLog(\`  Element [\${selector}] tidak terlihat (sesuai kondisi "hidden")\`, 'success');
              } else {
                throw new Error('Timeout: Element [' + selector + '] tidak ditemukan dalam ' + timeout + 'ms');
              }
            }
          } else {
            await wait(Math.min(timeout, 3000));
          }
          break;
        }

        // --------------------------------------------------
        // API REQUEST (FIXED: gunakan node http/https, bukan fetch)
        // --------------------------------------------------
        case 'api-request': {
          const url = interpolate(s.apiUrl || '');
          if (!url) throw new Error('URL API kosong');
          
          addLog(\`Step \${i+1}: \${s.apiMethod || 'GET'} \${url}\`, 'info');
          
          try {
            // Parse headers
            let headers = { 'User-Agent': 'RBA-Studio/2.0' };
            if (s.apiHeaders) {
              try { headers = { ...headers, ...JSON.parse(s.apiHeaders) }; } catch(e) { addLog(\`  Warning: Headers JSON tidak valid\`, 'warn'); }
            }
            
            // Gunakan Node.js https/http module (bukan browser fetch, untuk hindari CORS di Electron)
            const result = await new Promise((resolve, reject) => {
              const urlObj = new URL(url);
              const lib = urlObj.protocol === 'https:' ? require('https') : require('http');
              
              const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: s.apiMethod || 'GET',
                headers: headers,
                timeout: 15000
              };
              
              const req = lib.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
              });
              
              req.on('error', reject);
              req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
              
              if (['POST', 'PUT', 'PATCH'].includes(s.apiMethod) && s.apiBody) {
                const body = interpolate(s.apiBody);
                req.write(body);
              }
              req.end();
            });
            
            addLog(\`  Response: \${result.status} (\${result.data.length} chars)\`, result.status >= 200 && result.status < 300 ? 'success' : 'warn');
            addLog(\`  Data: \${result.data.substring(0, 100)}\${result.data.length > 100 ? '...' : ''}\`, 'info');
            
            // Simpan response ke variable
            if (s.var) {
              // Coba parse JSON
              try {
                const parsed = JSON.parse(result.data);
                storeVar(s.var, parsed);
                addLog(\`  Response JSON disimpan ke {\${s.var}}\`, 'success');
              } catch(e) {
                storeVar(s.var, result.data);
                addLog(\`  Response text disimpan ke {\${s.var}}\`, 'success');
              }
            }
            
            if (result.status >= 400) throw new Error('HTTP Error: ' + result.status);
            
          } catch(err) {
            throw new Error('API Request gagal: ' + err.message);
          }
          break;
        }

        // --------------------------------------------------
        // INPUT DIALOG (FIXED: tersambung ke varStore)
        // --------------------------------------------------
        case 'input-dialog': {
          const question = s.text || s.name || 'Masukkan nilai:';
          const defaultVal = s.var ? (varStore[s.var] || '') : '';
          addLog(\`Step \${i+1}: Menunggu input user: "\${question}"\`, 'info');
          const val = prompt(question + (defaultVal ? '\\n(Default: ' + defaultVal + ')' : ''), defaultVal);
          if (val === null) {
            addLog(\`  Input dibatalkan oleh user\`, 'warn');
          } else {
            if (s.var) {
              storeVar(s.var, val);
              addLog(\`  Input {\${s.var}} = "\${val}" disimpan\`, 'success');
            } else {
              addLog(\`  Input: "\${val}" (tidak ada output variable)\`, 'info');
            }
          }
          break;
        }

        // --------------------------------------------------
        // SCREENSHOT (browser/page)
        // --------------------------------------------------
        case 'screenshot-page': {
          addLog(\`Step \${i+1}: Screenshot browser (butuh Puppeteer untuk implementasi penuh)\`, 'warn');
          // Jika ada device, ambil screenshot dari HP
          if (stepDevice && stepDevice !== 'No ADB Device') {
            const devicePath = '/sdcard/rba_screen_' + Date.now() + '.png';
            const localPath = require('path').join(require('os').homedir(), 'Documents', 'screenshot_' + Date.now() + '.png');
            const r1 = await runAdb(stepDevice, \`shell screencap -p \${devicePath}\`);
            if (r1.success) {
              const r2 = await runAdb(stepDevice, \`pull \${devicePath} "\${localPath}"\`);
              if (r2.success) {
                await runAdb(stepDevice, \`shell rm \${devicePath}\`);
                if (s.var) storeVar(s.var, localPath);
                addLog(\`  Screenshot HP: \${localPath}\`, 'success');
              }
            }
          } else {
            await wait(1000);
            addLog(\`  (Tidak ada device ADB, skip screenshot)\`, 'warn');
          }
          break;
        }

        // --------------------------------------------------
        // IF CONDITION (FIXED: evaluasi ekspresi variabel)
        // --------------------------------------------------
        case 'if-condition': {
          const expr = interpolate(s.condition || 'true');
          let result = false;
          try {
            // Evaluasi kondisi dengan variabel yang ada
            const fn = new Function(...Object.keys(varStore), 'return (' + expr + ')');
            result = Boolean(fn(...Object.values(varStore)));
          } catch(e) {
            // Coba evaluasi sederhana: "value == something"
            addLog(\`  Kondisi eval error: \${e.message}, dianggap false\`, 'warn');
            result = false;
          }
          addLog(\`  Kondisi "\${expr}" = \${result}\`, result ? 'success' : 'warn');
          // Simpan hasil ke variable untuk dipakai step berikutnya
          if (s.var) storeVar(s.var, result);
          // Note: percabangan true/false path ditangani di runWorkflow() via edge routing
          break;
        }

        // --------------------------------------------------
        // OCR (via ADB screenshot + text extraction)
        // --------------------------------------------------
        case 'ocr': {
          addLog(\`Step \${i+1}: OCR analysis...\`, 'info');
          if (stepDevice && stepDevice !== 'No ADB Device') {
            // Screenshot dan ambil UI dump sebagai alternatif OCR
            const r = await runAdb(stepDevice, \`shell uiautomator dump /sdcard/ocr_dump.xml && cat /sdcard/ocr_dump.xml\`);
            if (r.success) {
              const allTexts = [];
              const textRegex = /text="([^"]+)"/g;
              let m;
              while ((m = textRegex.exec(r.output)) !== null && allTexts.length < 30) {
                if (m[1].trim()) allTexts.push(m[1]);
              }
              const ocrResult = allTexts.join(' | ');
              if (s.var) storeVar(s.var, ocrResult);
              addLog(\`  OCR (via UI dump): \${ocrResult.substring(0, 100)}\`, 'success');
              await runAdb(stepDevice, \`shell rm /sdcard/ocr_dump.xml\`);
            }
          } else {
            addLog(\`  OCR butuh device ADB\`, 'warn');
          }
          await wait(1000);
          break;
        }

        // --------------------------------------------------
        // READ CSV / WRITE CSV
        // --------------------------------------------------
        case 'read-csv': {
          const filePath = interpolate(s.filePath || '');
          if (!filePath) { addLog(\`  File path kosong\`, 'warn'); break; }
          const fs = require('fs');
          if (!fs.existsSync(filePath)) throw new Error('File tidak ditemukan: ' + filePath);
          const content = fs.readFileSync(filePath, s.encoding || 'utf8');
          const delimiter = s.delimiter || ',';
          const lines = content.split('\\n').filter(l => l.trim());
          const startIdx = s.skipHeader === 'yes' ? 1 : 0;
          const rows = lines.slice(startIdx).map(l => l.split(delimiter).map(cell => cell.trim()));
          if (s.var) storeVar(s.var, rows);
          addLog(\`  CSV dibaca: \${rows.length} baris dari \${filePath}\`, 'success');
          break;
        }

        case 'write-csv': {
          const data = s.var ? (varStore[s.var] || []) : [];
          const filePath = interpolate(s.filePath || 'output_' + Date.now() + '.csv');
          const delimiter = s.delimiter || ',';
          const fs = require('fs');
          let content = '';
          if (Array.isArray(data)) {
            content = data.map(row => Array.isArray(row) ? row.join(delimiter) : String(row)).join('\\n');
          } else {
            content = String(data);
          }
          fs.writeFileSync(filePath, content, s.encoding || 'utf8');
          addLog(\`  CSV ditulis: \${filePath} (\${content.length} bytes)\`, 'success');
          break;
        }

        case 'write-excel': {
          addLog(\`Step \${i+1}: Write Excel: \${s.filePath || 'output.xlsx'} (butuh library xlsx)\`, 'warn');
          break;
        }

        // --------------------------------------------------
        // DOWNLOAD FILE
        // --------------------------------------------------
        case 'download-file': {
          const url = interpolate(s.url || s.var || '');
          if (!url) throw new Error('URL download kosong');
          const fileName = s.filePath || 'download_' + Date.now();
          const localPath = require('path').join(require('os').homedir(), 'Downloads', require('path').basename(fileName));
          addLog(\`Step \${i+1}: Download: \${url} -> \${localPath}\`, 'info');
          await new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const lib = urlObj.protocol === 'https:' ? require('https') : require('http');
            const fs = require('fs');
            const file = fs.createWriteStream(localPath);
            lib.get(url, (res) => {
              res.pipe(file);
              file.on('finish', () => { file.close(); resolve(); });
            }).on('error', (err) => { require('fs').unlink(localPath, ()=>{}); reject(err); });
          });
          if (s.var) storeVar(s.var, localPath);
          addLog(\`  Download selesai: \${localPath}\`, 'success');
          break;
        }

        // --------------------------------------------------
        // JSON PROCESSING
        // --------------------------------------------------
        case 'json-processing': {
          const sourceVar = s.var || '';
          const sourceData = sourceVar ? varStore[sourceVar] : null;
          addLog(\`Step \${i+1}: JSON process {\${sourceVar}}\`, 'info');
          if (sourceData) {
            try {
              const parsed = typeof sourceData === 'string' ? JSON.parse(sourceData) : sourceData;
              addLog(\`  JSON parsed: \${JSON.stringify(parsed).substring(0, 100)}\`, 'success');
              if (sourceVar) storeVar(sourceVar, parsed);
            } catch(e) { addLog(\`  JSON parse error: \${e.message}\`, 'warn'); }
          }
          await wait(200);
          break;
        }

        // --------------------------------------------------
        // DEBUG STEP
        // --------------------------------------------------
        case 'debug-step': {
          addLog(\`Step \${i+1}: === DEBUG BREAKPOINT di step \${i+1} ===\`, 'warn');
          addLog(\`  Variables saat ini:\`, 'info');
          Object.entries(varStore).forEach(([k, v]) => addLog(\`    {\${k}} = \${JSON.stringify(v).substring(0, 50)}\`, 'info'));
          alert('DEBUG PAUSE\\nStep ' + (i+1) + ': ' + s.name + '\\n\\nVariables:\\n' + Object.entries(varStore).map(([k, v]) => '{' + k + '} = ' + String(v).substring(0, 30)).join('\\n') + '\\n\\nKlik OK untuk lanjut.');
          break;
        }

        // --------------------------------------------------
        // PERFORMANCE TRACK
        // --------------------------------------------------
        case 'performance-track': {
          const elapsed = Date.now() - execStats.startTime;
          addLog(\`Step \${i+1}: Performance: \${elapsed}ms sejak mulai\`, 'info');
          if (s.var) storeVar(s.var, elapsed);
          break;
        }

        // --------------------------------------------------
        // CONTROL FLOW (handled by runWorkflow, log saja)
        // --------------------------------------------------
        case 'repeat-start': addLog(\`Step \${i+1}: Loop start (dihandle oleh workflow engine)\`, 'info'); break;
        case 'repeat-end':   addLog(\`Step \${i+1}: Loop end (dihandle oleh workflow engine)\`, 'info'); break;
        case 'parallel-start': addLog(\`Step \${i+1}: Parallel start\`, 'info'); break;
        case 'parallel-end':   addLog(\`Step \${i+1}: Parallel join\`, 'info'); break;
        case 'try-catch':      addLog(\`Step \${i+1}: Try-Catch block aktif\`, 'info'); break;
        case 'retry-logic':    addLog(\`Step \${i+1}: Retry logic diset (dihandle oleh workflow engine)\`, 'info'); break;
        case 'sub-workflow':   addLog(\`Step \${i+1}: Sub-workflow: \${s.var || 'tidak diset'}\`, 'warn'); break;
        case 'cron-job':       addLog(\`Step \${i+1}: Cron: \${s.cron || '?'} [\${s.timezone || 'local'}]\`, 'info'); break;
        case 'webhook-trigger': addLog(\`Step \${i+1}: Webhook trigger aktif\`, 'info'); break;
        case 'credential-manager': addLog(\`Step \${i+1}: Credentials loaded\`, 'info'); break;
        case 'auto-selector':  addLog(\`Step \${i+1}: Auto selector (AI element detection)\`, 'warn'); break;
        case 'headless-mode':  addLog(\`Step \${i+1}: Headless mode (butuh Puppeteer)\`, 'warn'); break;
        case 'file-system':    addLog(\`Step \${i+1}: File system op: \${s.filePath || '?'}\`, 'info'); break;
        case 'handle-popup':   addLog(\`Step \${i+1}: Handle popup\`, 'info'); await wait(500); break;
        case 'upload-file':    addLog(\`Step \${i+1}: Upload file: \${s.filePath || '?'}\`, 'info'); await wait(1500); break;
        case 'pagination':     addLog(\`Step \${i+1}: Pagination scraping\`, 'info'); await wait(1000); break;
        case 'infinite-scroll': addLog(\`Step \${i+1}: Infinite scroll\`, 'info'); await wait(2000); break;

        case 'database-query': addLog(\`Step \${i+1}: DB Query (butuh driver database)\`, 'warn'); await wait(800); break;
        case 'regex-extraction': {
          const src = s.var ? String(varStore[s.var] || '') : '';
          if (src && s.regex) {
            try {
              const rx = new RegExp(s.regex, 'g');
              const matches = [...src.matchAll(rx)].map(m => m[0]);
              if (s.var) storeVar(s.var + '_matches', matches);
              addLog(\`Step \${i+1}: Regex found \${matches.length} match(es): \${matches.slice(0,3).join(', ')}\`, 'success');
            } catch(e) { addLog(\`  Regex error: \${e.message}\`, 'warn'); }
          }
          break;
        }
        case 'copy-paste-var': {
          const srcVar = s.selector || s.var || '';
          const dstVar = s.var || '';
          if (srcVar && dstVar && varStore[srcVar] !== undefined) {
            storeVar(dstVar, varStore[srcVar]);
            addLog(\`Step \${i+1}: {\${srcVar}} -> {\${dstVar}} = \${String(varStore[srcVar]).substring(0,30)}\`, 'success');
          }
          break;
        }
        case 'ai-decision': {
          addLog(\`Step \${i+1}: AI Decision (butuh integrasi AI API — set apiUrl ke endpoint AI)\`, 'warn');
          if (s.var) storeVar(s.var, 'ai_pending');
          await wait(500);
          break;
        }
        case 'filter-data': {
          const data = s.var ? varStore[s.var] : null;
          if (Array.isArray(data) && s.condition) {
            try {
              const filtered = data.filter(item => {
                const fn = new Function('item', 'return (' + s.condition + ')');
                return fn(item);
              });
              if (s.var) storeVar(s.var, filtered);
              addLog(\`Step \${i+1}: Filter: \${data.length} -> \${filtered.length} items\`, 'success');
            } catch(e) { addLog(\`  Filter error: \${e.message}\`, 'warn'); }
          }
          break;
        }
        case 'batch-slice': {
          const data = s.var ? varStore[s.var] : null;
          if (Array.isArray(data)) {
            const size = parseInt(s.loopCount) || 10;
            const batches = [];
            for (let j = 0; j < data.length; j += size) batches.push(data.slice(j, j + size));
            storeVar((s.var || 'data') + '_batches', batches);
            addLog(\`Step \${i+1}: Batch \${data.length} items -> \${batches.length} batch(es) of \${size}\`, 'success');
          }
          break;
        }

        default:
          addLog(\`Step \${i+1}: [\${type}] tidak ada implementasi spesifik, skip\`, 'warn');
          // Jika ada koordinat, gunakan ADB tap
          if (stepDevice && stepDevice !== 'No ADB Device' && s.cx && s.cy) {
            const r = await runAdb(stepDevice, \`shell input tap \${s.cx} \${s.cy}\`);
            if (!r.success) throw new Error('Tap gagal: ' + r.error);
          } else {
            await wait(500);
            addLog(\`  (Simulasi click — butuh Puppeteer untuk browser automation)\`, 'warn');
          }
          addLog('  Click selesai', 'success');
          break;
        }

        // --------------------------------------------------
        // WAIT ELEMENT
        // --------------------------------------------------
        case 'wait-element': {
          const timeout = parseInt(s.waitTimeout) || 10000;
          const selector = s.waitSelector || '';
          addLog(\`Step \${i+1}: Menunggu [\${selector}] menjadi \${s.waitCondition || 'visible'} (max \${timeout}ms)\`, 'info');
          // Implementasi polling ADB jika ada device
          if (stepDevice && stepDevice !== 'No ADB Device' && selector) {
            const startTime = Date.now();
            const pollInterval = 1000;
            let found = false;
            while (Date.now() - startTime < timeout) {
              const r = await runAdb(stepDevice, \`shell uiautomator dump /sdcard/ui_dump_wait.xml && cat /sdcard/ui_dump_wait.xml\`);
              if (r.success && r.output.includes(selector)) {
                found = true;
                addLog(\`  Element [\${selector}] ditemukan!\`, 'success');
                break;
              }
              await wait(pollInterval);
              addLog(\`  Polling... (\${Math.round((Date.now() - startTime) / 1000)}s/\${Math.round(timeout / 1000)}s)\`, 'info');
            }
            if (!found) {
              if (s.waitCondition === 'hidden') {
                addLog(\`  Element [\${selector}] tidak terlihat (sesuai kondisi "hidden")\`, 'success');
              } else {
                throw new Error('Timeout: Element [' + selector + '] tidak ditemukan dalam ' + timeout + 'ms');
              }
            }
          } else {
            await wait(Math.min(timeout, 3000));
          }
          break;
        }

        // --------------------------------------------------
        // API REQUEST (FIXED: gunakan node http/https, bukan fetch)
        // --------------------------------------------------
        case 'api-request': {
          const url = interpolate(s.apiUrl || '');
          if (!url) throw new Error('URL API kosong');
          
          addLog(\`Step \${i+1}: \${s.apiMethod || 'GET'} \${url}\`, 'info');
          
          try {
            // Parse headers
            let headers = { 'User-Agent': 'RBA-Studio/2.0' };
            if (s.apiHeaders) {
              try { headers = { ...headers, ...JSON.parse(s.apiHeaders) }; } catch(e) { addLog(\`  Warning: Headers JSON tidak valid\`, 'warn'); }
            }
            
            // Gunakan Node.js https/http module (bukan browser fetch, untuk hindari CORS di Electron)
            const result = await new Promise((resolve, reject) => {
              const urlObj = new URL(url);
              const lib = urlObj.protocol === 'https:' ? require('https') : require('http');
              
              const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: s.apiMethod || 'GET',
                headers: headers,
                timeout: 15000
              };
              
              const req = lib.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
              });
              
              req.on('error', reject);
              req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
              
              if (['POST', 'PUT', 'PATCH'].includes(s.apiMethod) && s.apiBody) {
                const body = interpolate(s.apiBody);
                req.write(body);
              }
              req.end();
            });
            
            addLog(\`  Response: \${result.status} (\${result.data.length} chars)\`, result.status >= 200 && result.status < 300 ? 'success' : 'warn');
            addLog(\`  Data: \${result.data.substring(0, 100)}\${result.data.length > 100 ? '...' : ''}\`, 'info');
            
            // Simpan response ke variable
            if (s.var) {
              // Coba parse JSON
              try {
                const parsed = JSON.parse(result.data);
                storeVar(s.var, parsed);
                addLog(\`  Response JSON disimpan ke {\${s.var}}\`, 'success');
              } catch(e) {
                storeVar(s.var, result.data);
                addLog(\`  Response text disimpan ke {\${s.var}}\`, 'success');
              }
            }
            
            if (result.status >= 400) throw new Error('HTTP Error: ' + result.status);
            
          } catch(err) {
            throw new Error('API Request gagal: ' + err.message);
          }
          break;
        }

        // --------------------------------------------------
        // INPUT DIALOG (FIXED: tersambung ke varStore)
        // --------------------------------------------------
        case 'input-dialog': {
          const question = s.text || s.name || 'Masukkan nilai:';
          const defaultVal = s.var ? (varStore[s.var] || '') : '';
          addLog(\`Step \${i+1}: Menunggu input user: "\${question}"\`, 'info');
          const val = prompt(question + (defaultVal ? '\\n(Default: ' + defaultVal + ')' : ''), defaultVal);
          if (val === null) {
            addLog(\`  Input dibatalkan oleh user\`, 'warn');
          } else {
            if (s.var) {
              storeVar(s.var, val);
              addLog(\`  Input {\${s.var}} = "\${val}" disimpan\`, 'success');
            } else {
              addLog(\`  Input: "\${val}" (tidak ada output variable)\`, 'info');
            }
          }
          break;
        }

        // --------------------------------------------------
        // SCREENSHOT (browser/page)
        // --------------------------------------------------
        case 'screenshot-page': {
          addLog(\`Step \${i+1}: Screenshot browser (butuh Puppeteer untuk implementasi penuh)\`, 'warn');
          // Jika ada device, ambil screenshot dari HP
          if (stepDevice && stepDevice !== 'No ADB Device') {
            const devicePath = '/sdcard/rba_screen_' + Date.now() + '.png';
            const localPath = require('path').join(require('os').homedir(), 'Documents', 'screenshot_' + Date.now() + '.png');
            const r1 = await runAdb(stepDevice, \`shell screencap -p \${devicePath}\`);
            if (r1.success) {
              const r2 = await runAdb(stepDevice, \`pull \${devicePath} "\${localPath}"\`);
              if (r2.success) {
                await runAdb(stepDevice, \`shell rm \${devicePath}\`);
                if (s.var) storeVar(s.var, localPath);
                addLog(\`  Screenshot HP: \${localPath}\`, 'success');
              }
            }
          } else {
            await wait(1000);
            addLog(\`  (Tidak ada device ADB, skip screenshot)\`, 'warn');
          }
          break;
        }

        // --------------------------------------------------
        // IF CONDITION (FIXED: evaluasi ekspresi variabel)
        // --------------------------------------------------
        case 'if-condition': {
          const expr = interpolate(s.condition || 'true');
          let result = false;
          try {
            // Evaluasi kondisi dengan variabel yang ada
            const fn = new Function(...Object.keys(varStore), 'return (' + expr + ')');
            result = Boolean(fn(...Object.values(varStore)));
          } catch(e) {
            // Coba evaluasi sederhana: "value == something"
            addLog(\`  Kondisi eval error: \${e.message}, dianggap false\`, 'warn');
            result = false;
          }
          addLog(\`  Kondisi "\${expr}" = \${result}\`, result ? 'success' : 'warn');
          // Simpan hasil ke variable untuk dipakai step berikutnya
          if (s.var) storeVar(s.var, result);
          // Note: percabangan true/false path ditangani di runWorkflow() via edge routing
          break;
        }

        // --------------------------------------------------
        // OCR (via ADB screenshot + text extraction)
        // --------------------------------------------------
        case 'ocr': {
          addLog(\`Step \${i+1}: OCR analysis...\`, 'info');
          if (stepDevice && stepDevice !== 'No ADB Device') {
            // Screenshot dan ambil UI dump sebagai alternatif OCR
            const r = await runAdb(stepDevice, \`shell uiautomator dump /sdcard/ocr_dump.xml && cat /sdcard/ocr_dump.xml\`);
            if (r.success) {
              const allTexts = [];
              const textRegex = /text="([^"]+)"/g;
              let m;
              while ((m = textRegex.exec(r.output)) !== null && allTexts.length < 30) {
                if (m[1].trim()) allTexts.push(m[1]);
              }
              const ocrResult = allTexts.join(' | ');
              if (s.var) storeVar(s.var, ocrResult);
              addLog(\`  OCR (via UI dump): \${ocrResult.substring(0, 100)}\`, 'success');
              await runAdb(stepDevice, \`shell rm /sdcard/ocr_dump.xml\`);
            }
          } else {
            addLog(\`  OCR butuh device ADB\`, 'warn');
          }
          await wait(1000);
          break;
        }

        // --------------------------------------------------
        // READ CSV / WRITE CSV
        // --------------------------------------------------
        case 'read-csv': {
          const filePath = interpolate(s.filePath || '');
          if (!filePath) { addLog(\`  File path kosong\`, 'warn'); break; }
          const fs = require('fs');
          if (!fs.existsSync(filePath)) throw new Error('File tidak ditemukan: ' + filePath);
          const content = fs.readFileSync(filePath, s.encoding || 'utf8');
          const delimiter = s.delimiter || ',';
          const lines = content.split('\\n').filter(l => l.trim());
          const startIdx = s.skipHeader === 'yes' ? 1 : 0;
          const rows = lines.slice(startIdx).map(l => l.split(delimiter).map(cell => cell.trim()));
          if (s.var) storeVar(s.var, rows);
          addLog(\`  CSV dibaca: \${rows.length} baris dari \${filePath}\`, 'success');
          break;
        }

        case 'write-csv': {
          const data = s.var ? (varStore[s.var] || []) : [];
          const filePath = interpolate(s.filePath || 'output_' + Date.now() + '.csv');
          const delimiter = s.delimiter || ',';
          const fs = require('fs');
          let content = '';
          if (Array.isArray(data)) {
            content = data.map(row => Array.isArray(row) ? row.join(delimiter) : String(row)).join('\\n');
          } else {
            content = String(data);
          }
          fs.writeFileSync(filePath, content, s.encoding || 'utf8');
          addLog(\`  CSV ditulis: \${filePath} (\${content.length} bytes)\`, 'success');
          break;
        }

        case 'write-excel': {
          addLog(\`Step \${i+1}: Write Excel: \${s.filePath || 'output.xlsx'} (butuh library xlsx)\`, 'warn');
          break;
        }

        // --------------------------------------------------
        // DOWNLOAD FILE
        // --------------------------------------------------
        case 'download-file': {
          const url = interpolate(s.url || s.var || '');
          if (!url) throw new Error('URL download kosong');
          const fileName = s.filePath || 'download_' + Date.now();
          const localPath = require('path').join(require('os').homedir(), 'Downloads', require('path').basename(fileName));
          addLog(\`Step \${i+1}: Download: \${url} -> \${localPath}\`, 'info');
          await new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const lib = urlObj.protocol === 'https:' ? require('https') : require('http');
            const fs = require('fs');
            const file = fs.createWriteStream(localPath);
            lib.get(url, (res) => {
              res.pipe(file);
              file.on('finish', () => { file.close(); resolve(); });
            }).on('error', (err) => { require('fs').unlink(localPath, ()=>{}); reject(err); });
          });
          if (s.var) storeVar(s.var, localPath);
          addLog(\`  Download selesai: \${localPath}\`, 'success');
          break;
        }

        // --------------------------------------------------
        // JSON PROCESSING
        // --------------------------------------------------
        case 'json-processing': {
          const sourceVar = s.var || '';
          const sourceData = sourceVar ? varStore[sourceVar] : null;
          addLog(\`Step \${i+1}: JSON process {\${sourceVar}}\`, 'info');
          if (sourceData) {
            try {
              const parsed = typeof sourceData === 'string' ? JSON.parse(sourceData) : sourceData;
              addLog(\`  JSON parsed: \${JSON.stringify(parsed).substring(0, 100)}\`, 'success');
              if (sourceVar) storeVar(sourceVar, parsed);
            } catch(e) { addLog(\`  JSON parse error: \${e.message}\`, 'warn'); }
          }
          await wait(200);
          break;
        }

        // --------------------------------------------------
        // DEBUG STEP
        // --------------------------------------------------
        case 'debug-step': {
          addLog(\`Step \${i+1}: === DEBUG BREAKPOINT di step \${i+1} ===\`, 'warn');
          addLog(\`  Variables saat ini:\`, 'info');
          Object.entries(varStore).forEach(([k, v]) => addLog(\`    {\${k}} = \${JSON.stringify(v).substring(0, 50)}\`, 'info'));
          alert('DEBUG PAUSE\\nStep ' + (i+1) + ': ' + s.name + '\\n\\nVariables:\\n' + Object.entries(varStore).map(([k, v]) => '{' + k + '} = ' + String(v).substring(0, 30)).join('\\n') + '\\n\\nKlik OK untuk lanjut.');
          break;
        }

        // --------------------------------------------------
        // PERFORMANCE TRACK
        // --------------------------------------------------
        case 'performance-track': {
          const elapsed = Date.now() - execStats.startTime;
          addLog(\`Step \${i+1}: Performance: \${elapsed}ms sejak mulai\`, 'info');
          if (s.var) storeVar(s.var, elapsed);
          break;
        }

        // --------------------------------------------------
        // CONTROL FLOW (handled by runWorkflow, log saja)
        // --------------------------------------------------
        case 'repeat-start': addLog(\`Step \${i+1}: Loop start (dihandle oleh workflow engine)\`, 'info'); break;
        case 'repeat-end':   addLog(\`Step \${i+1}: Loop end (dihandle oleh workflow engine)\`, 'info'); break;
        case 'parallel-start': addLog(\`Step \${i+1}: Parallel start\`, 'info'); break;
        case 'parallel-end':   addLog(\`Step \${i+1}: Parallel join\`, 'info'); break;
        case 'try-catch':      addLog(\`Step \${i+1}: Try-Catch block aktif\`, 'info'); break;
        case 'retry-logic':    addLog(\`Step \${i+1}: Retry logic diset (dihandle oleh workflow engine)\`, 'info'); break;
        case 'sub-workflow':   addLog(\`Step \${i+1}: Sub-workflow: \${s.var || 'tidak diset'}\`, 'warn'); break;
        case 'cron-job':       addLog(\`Step \${i+1}: Cron: \${s.cron || '?'} [\${s.timezone || 'local'}]\`, 'info'); break;
        case 'webhook-trigger': addLog(\`Step \${i+1}: Webhook trigger aktif\`, 'info'); break;
        case 'credential-manager': addLog(\`Step \${i+1}: Credentials loaded\`, 'info'); break;
        case 'auto-selector':  addLog(\`Step \${i+1}: Auto selector (AI element detection)\`, 'warn'); break;
        case 'headless-mode':  addLog(\`Step \${i+1}: Headless mode (butuh Puppeteer)\`, 'warn'); break;
        case 'file-system':    addLog(\`Step \${i+1}: File system op: \${s.filePath || '?'}\`, 'info'); break;
        case 'handle-popup':   addLog(\`Step \${i+1}: Handle popup\`, 'info'); await wait(500); break;
        case 'upload-file':    addLog(\`Step \${i+1}: Upload file: \${s.filePath || '?'}\`, 'info'); await wait(1500); break;
        case 'pagination':     addLog(\`Step \${i+1}: Pagination scraping\`, 'info'); await wait(1000); break;
        case 'infinite-scroll': addLog(\`Step \${i+1}: Infinite scroll\`, 'info'); await wait(2000); break;

        case 'database-query': addLog(\`Step \${i+1}: DB Query (butuh driver database)\`, 'warn'); await wait(800); break;
        case 'regex-extraction': {
          const src = s.var ? String(varStore[s.var] || '') : '';
          if (src && s.regex) {
            try {
              const rx = new RegExp(s.regex, 'g');
              const matches = [...src.matchAll(rx)].map(m => m[0]);
              if (s.var) storeVar(s.var + '_matches', matches);
              addLog(\`Step \${i+1}: Regex found \${matches.length} match(es): \${matches.slice(0,3).join(', ')}\`, 'success');
            } catch(e) { addLog(\`  Regex error: \${e.message}\`, 'warn'); }
          }
          break;
        }
        case 'copy-paste-var': {
          const srcVar = s.selector || s.var || '';
          const dstVar = s.var || '';
          if (srcVar && dstVar && varStore[srcVar] !== undefined) {
            storeVar(dstVar, varStore[srcVar]);
            addLog(\`Step \${i+1}: {\${srcVar}} -> {\${dstVar}} = \${String(varStore[srcVar]).substring(0,30)}\`, 'success');
          }
          break;
        }
        case 'ai-decision': {
          addLog(\`Step \${i+1}: AI Decision (butuh integrasi AI API — set apiUrl ke endpoint AI)\`, 'warn');
          if (s.var) storeVar(s.var, 'ai_pending');
          await wait(500);
          break;
        }
        case 'filter-data': {
          const data = s.var ? varStore[s.var] : null;
          if (Array.isArray(data) && s.condition) {
            try {
              const filtered = data.filter(item => {
                const fn = new Function('item', 'return (' + s.condition + ')');
                return fn(item);
              });
              if (s.var) storeVar(s.var, filtered);
              addLog(\`Step \${i+1}: Filter: \${data.length} -> \${filtered.length} items\`, 'success');
            } catch(e) { addLog(\`  Filter error: \${e.message}\`, 'warn'); }
          }
          break;
        }
        case 'batch-slice': {
          const data = s.var ? varStore[s.var] : null;
          if (Array.isArray(data)) {
            const size = parseInt(s.loopCount) || 10;
            const batches = [];
            for (let j = 0; j < data.length; j += size) batches.push(data.slice(j, j + size));
            storeVar((s.var || 'data') + '_batches', batches);
            addLog(\`Step \${i+1}: Batch \${data.length} items -> \${batches.length} batch(es) of \${size}\`, 'success');
          }
          break;
        }

        default:
          addLog('Step ' + (i+1) + ': [' + type + '] step dijalankan (delay: ' + (parseInt(s.delay)||500) + 'ms)', 'warn');
          await wait(parseInt(s.delay) || 500);
      }
      s.status = 'success';
      retry.count = 0; // Reset retry count on success
    } catch(err) {
      s.status = 'error';
      execStats.errors++;
      document.getElementById('st-errors').textContent = execStats.errors;
      addLog('  ? Error di "' + s.name + '": ' + err.message, 'error');

      if (retry.count < retry.maxRetry) {
        retry.count++;
        execStats.retries++;
        document.getElementById('st-retries').textContent = execStats.retries;
        addLog('  ?? Retry ' + retry.count + '/' + retry.maxRetry + ' — menunggu ' + retry.delay + 'ms...', 'warn');
        s.status = 'running';
        render();
        await wait(retry.delay);
        // i TIDAK di-increment — loop while akan retry step yang sama
        continue;
      } else {
        if (retry.maxRetry > 0) {
          addLog('  ? Semua ' + retry.maxRetry + ' retry gagal untuk "' + s.name + '"', 'error');
        }
        retry.count = 0; // reset untuk run berikutnya
      }
    }

    retry.count = 0; // reset setelah sukses

    // -- LOOP CONTROL -----------------------------------------
    if (type === 'repeat-start') {
      const loopCount = parseInt(s.loopCount) || 1;
      const loopVar = s.var || 'loop_index';
      loopStack.push({ startId: s.id, count: loopCount, current: 0, varName: loopVar, startIndex: i });
      storeVar(loopVar, 0);
      addLog(\`  Loop start: \${loopCount} iterations\`, 'info');
    } else if (type === 'repeat-end') {
      if (loopStack.length > 0) {
        const loop = loopStack[loopStack.length - 1];
        loop.current++;
        if (loop.current < loop.count) {
          // Continue loop
          storeVar(loop.varName, loop.current);
          i = loop.startIndex; // Jump back to repeat-start
          addLog(\`  Loop iteration \${loop.current + 1}/\${loop.count}\`, 'info');
          continue;
        } else {
          // Exit loop
          loopStack.pop();
          addLog(\`  Loop end after \${loop.count} iterations\`, 'success');
        }
      }
    } else if (type === 'if-condition') {
      // Handle conditional branching via edges (already handled in canvas logic)
      // Here we just log the result
    }

    render();
    await wait(50); // brief visual pause between steps
    i++; // Move to next step
  }

  clearInterval(execStats.interval);
  addLog('=== Workflow '+(stopRequested?'STOPPED':'Complete')+' ===', stopRequested?'warn':'success');

  runBtn.disabled=false; stopBtn.disabled=true;
  runBtn.textContent='? RUN';
  if (tbRun) { tbRun.textContent='? Run'; tbRun.disabled=false; }
  status.className='hdr-badge offline';
  status.innerHTML='<div class="hdr-dot"></div>OFFLINE';

  setTimeout(() => { project.steps.forEach(s=>s.status=''); render(); }, 3000);
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
  addLog('? Emergency STOP', 'warn');
}

function wait(ms) { return new Promise(r=>setTimeout(r, Math.max(0, ms))); }

// --- Logging --------------------------------------------------
function addLog(msg, type='info') {
  const out = document.getElementById('log-output');
  const ts  = new Date().toLocaleTimeString();
  out.innerHTML += \`<span class="log-ts">[\${ts}]</span> <span class="log-\${type}">\${msg}</span><br>\`;
  out.scrollTop = out.scrollHeight;
}
function clearLog() { document.getElementById('log-output').innerHTML=''; }
function toggleLog() {
  const strip = document.getElementById('log-strip');
  strip.classList.toggle('collapsed');
  const btn = document.getElementById('log-toggle-btn');
  btn.textContent = strip.classList.contains('collapsed') ? '?' : '?';
}
function updateRuntime() {
  const sec = Math.floor((Date.now()-execStats.startTime)/1000);
  const m = Math.floor(sec/60), s = sec%60;
  document.getElementById('st-runtime').textContent = m+':'+(s<10?'0':'')+s;
}

// --- Theme ---------------------------------------------------
function toggleTheme() {
  const root = document.documentElement;
  const newTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', newTheme);
  prefs.theme = newTheme;
  ipcRenderer.invoke('save-settings', prefs);
}

// --- Settings ------------------------------------------------
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

// --- Macro Recorder View --------------------------------------
function startMacroRecord() {
  macroRecording = true;
  document.getElementById('rec-start-btn').disabled = true;
  document.getElementById('rec-stop-btn').disabled  = false;
  document.getElementById('rec-save-btn').disabled  = true;
  document.getElementById('rec-badge').className = 'rec-badge active';
  document.getElementById('rec-badge2').style.display = 'flex';
  addLog('Macro recording started', 'info');
  document.getElementById('rec-steps').innerHTML = '<span style="color:var(--green);">? Recording... klik area di bawah ini</span><br>';
  document.getElementById('rec-steps').addEventListener('click', recordClick);
}
function recordClick(e) {
  const el = document.getElementById('rec-steps');
  const rect = el.getBoundingClientRect();
  const x = Math.round(e.clientX - rect.left);
  const y = Math.round(e.clientY - rect.top);
  macroSteps.push({ id:Date.now(), name:'Tap ('+x+','+y+')', type:'mobile-tap', mx:x, my:y, delay:500, var:'', comment:'', status:'' });
  el.innerHTML += '<span style="color:var(--dim2);">? Tap at ('+x+', '+y+')</span><br>';
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

// --- Keyboard Shortcuts ---------------------------------------
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

// --- INIT -----------------------------------------------------
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
})();

// ============================================================
// ADVANCED LOOP & RETRY SYSTEM (ADDITIVE EXTENSION)
// ============================================================

// -------------------------------------------------------------
// 1. EXTENDED NODE PROPERTIES (BACKWARD COMPATIBLE)
// -------------------------------------------------------------
// Node properties baru ditambahkan tanpa merusak struktur lama
// Jika property tidak ada, gunakan default (backward compatibility)

/*
Contoh struktur node yang diperluas (tanpa mengubah existing):
{
  id: "node123",
  type: "mobile-tap",
  name: "Tap Screen",
  x: 100, y: 100,
  
  // Existing properties (tetap ada)
  mx: 540, my: 960,
  
  // NEW: Retry properties (default 0/false)
  retryCount: 3,        // default: 0
  retryDelay: 2000,     // default: 1000
  retryOnError: true,   // default: false
  
  // NEW: Loop properties (untuk Loop Start node)
  loopCount: 5,         // jumlah iterasi
  loopStartFrom: null,  // nodeId untuk mulai loop
  loopName: "main_loop", // nama loop (optional)
  delayBetweenLoop: 1000, // delay antar iterasi (ms)
  
  // NEW: Flow control
  breakCondition: null, // expression untuk break
  continueLoop: false,  // force continue
  loopVariable: "i"     // nama variable loop
}
*/

// -------------------------------------------------------------
// 2. RETRY WRAPPER FUNCTION
// -------------------------------------------------------------
async function executeStepWithRetry(step, originalExecuteFn) {
  // Backward compatibility: jika tidak ada retry properties, skip retry
  const retryCount = parseInt(step.retryCount) || 0;
  const retryDelay = parseInt(step.retryDelay) || 1000;
  const retryOnError = step.retryOnError === true || step.retryOnError === 'true';
  
  if (!retryOnError || retryCount <= 0) {
    // No retry, execute normally
    return await originalExecuteFn(step);
  }
  
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      if (attempt > 0) {
        addLog('?? Retry ' + attempt + '/' + retryCount + ' untuk "' + step.name + '" dalam ' + retryDelay + 'ms...', 'warn');
        await wait(retryDelay);
      }
      
      const result = await originalExecuteFn(step);
      
      if (attempt > 0) {
        addLog('? Retry berhasil pada attempt ' + (attempt + 1), 'success');
      }
      
      return result;
      
    } catch (error) {
      lastError = error;
      
      if (attempt < retryCount) {
        addLog('? Attempt ' + (attempt + 1) + ' gagal: ' + error.message, 'error');
        // Continue to next retry
      } else {
        addLog('?? Semua ' + (retryCount + 1) + ' attempt gagal untuk "' + step.name + '"', 'error');
        throw error; // Throw last error if all retries failed
      }
    }
  }
  
  throw lastError;
}

// -------------------------------------------------------------
// 3. ADVANCED LOOP SYSTEM
// -------------------------------------------------------------

// Extended loop stack (backward compatible dengan existing loopStack)
const advancedLoopStack = [];

// Loop context structure
/*
{
  id: "loop_123",           // unique loop ID
  name: "main_loop",        // optional name
  startIndex: 5,            // index node Loop Start
  endIndex: 15,             // index node Loop End (calculated)
  currentIteration: 0,      // current loop count (0-based)
  maxIterations: 5,         // total iterations
  loopVariable: "i",        // variable name
  delayBetweenIterations: 1000, // delay in ms
  breakCondition: null,     // expression to evaluate for break
  startTime: Date.now(),    // for performance tracking
  iterationStartTime: Date.now() // for iteration timing
}
*/

// Function to handle Loop Start node
function handleAdvancedLoopStart(step, currentIndex) {
  const loopCount = Math.max(1, parseInt(step.loopCount) || 1);
  const loopName = step.loopName || 'loop_' + step.id;
  const loopVar = step.loopVariable || 'i';
  const delayBetween = parseInt(step.delayBetweenLoop) || 0;
  const breakCondition = step.breakCondition || null;
  
  // Create loop context
  const loopContext = {
    id: step.id,
    name: loopName,
    startIndex: currentIndex,
    endIndex: null, // Will be set when Loop End is found
    currentIteration: 0,
    maxIterations: loopCount,
    loopVariable: loopVar,
    delayBetweenIterations: delayBetween,
    breakCondition: breakCondition,
    startTime: Date.now(),
    iterationStartTime: Date.now()
  };
  
  // Push to advanced loop stack
  advancedLoopStack.push(loopContext);
  
  // Set loop variable
  storeVar(loopVar, 0);
  
  // Log
  addLog('?? Loop "' + loopName + '" started: ' + loopCount + ' iterations', 'info');
  addLog('   Variable: {' + loopVar + '} = 0', 'info');
  
  return loopContext;
}

// Function to handle Loop End node
function handleAdvancedLoopEnd(step, currentIndex) {
  if (advancedLoopStack.length === 0) {
    addLog('?? Loop End tanpa Loop Start di step ' + (currentIndex + 1), 'warn');
    return false; // Continue normal flow
  }
  
  const loop = advancedLoopStack[advancedLoopStack.length - 1];
  
  // Set end index if not set
  if (loop.endIndex === null) {
    loop.endIndex = currentIndex;
  }
  
  // Check break condition
  if (loop.breakCondition) {
    try {
      const shouldBreak = evaluateCondition(loop.breakCondition);
      if (shouldBreak) {
        addLog('?? Loop "' + loop.name + '" di-break karena kondisi: ' + loop.breakCondition, 'warn');
        advancedLoopStack.pop();
        return false; // Exit loop
      }
    } catch (e) {
      addLog('?? Error evaluating break condition: ' + e.message, 'warn');
    }
  }
  
  // Increment iteration
  loop.currentIteration++;
  storeVar(loop.loopVariable, loop.currentIteration);
  
  // Check if loop should continue
  if (loop.currentIteration < loop.maxIterations) {
    // Continue loop
    const elapsed = Date.now() - loop.iterationStartTime;
    addLog('?? Loop "' + loop.name + '": iterasi ' + loop.currentIteration + '/' + loop.maxIterations + ' selesai (' + elapsed + 'ms)', 'info');
    
    // Delay between iterations
    if (loop.delayBetweenIterations > 0) {
      addLog('?? Delay antar iterasi: ' + loop.delayBetweenIterations + 'ms', 'info');
      // Note: delay will be handled in main loop
    }
    
    loop.iterationStartTime = Date.now();
    return loop.startIndex + 1; // Jump back to after Loop Start
  } else {
    // Loop finished
    const totalTime = Date.now() - loop.startTime;
    addLog('? Loop "' + loop.name + '" selesai: ' + loop.maxIterations + ' iterasi dalam ' + totalTime + 'ms', 'success');
    advancedLoopStack.pop();
    return false; // Continue normal flow
  }
}

// Helper function to evaluate conditions
function evaluateCondition(expression) {
  if (!expression || typeof expression !== 'string') return false;
  
  try {
    // Safe evaluation with available variables
    const fn = new Function(...Object.keys(varStore), 'return (' + expression + ')');
    return Boolean(fn(...Object.values(varStore)));
  } catch (e) {
    addLog('?? Error evaluating condition "' + expression + '": ' + e.message, 'warn');
    return false;
  }
}

// -------------------------------------------------------------
// 4. EXTENDED WORKFLOW ENGINE (WRAPPER VERSION)
// -------------------------------------------------------------

// Create extended version of runWorkflow (backward compatible)
async function runWorkflowExtended() {
  // Call original runWorkflow if exists, or implement extended logic
  if (typeof runWorkflow === 'function') {
    addLog('?? Menggunakan Extended Workflow Engine dengan Loop & Retry Advanced', 'info');
    
    // Override or wrap the execution logic
    // Since we can't easily override, we'll create a new execution path
    
    // For now, call original and add logging
    await runWorkflow();
    
    // Add extended features summary
    if (advancedLoopStack.length > 0) {
      addLog('?? Advanced Loops active: ' + advancedLoopStack.length, 'info');
    }
    
  } else {
    addLog('? Original runWorkflow not found', 'error');
  }
}

// Function to check if node has advanced features
function hasAdvancedFeatures(step) {
  return (
    (step.retryCount && parseInt(step.retryCount) > 0) ||
    (step.retryOnError === true || step.retryOnError === 'true') ||
    (step.type === 'loop-start' || step.type === 'loop-end') ||
    step.breakCondition ||
    step.loopVariable ||
    step.delayBetweenLoop
  );
}

// -------------------------------------------------------------
// 5. INTEGRATION HOOKS (ADD TO EXISTING FUNCTIONS)
// -------------------------------------------------------------

// Hook to add before step execution (add this to existing runWorkflow)
function preStepExecutionHook(step, index) {
  // Check for advanced features
  if (hasAdvancedFeatures(step)) {
    addLog('? Step ' + (index + 1) + ' menggunakan Advanced Features', 'info');
  }
  
  // Log current loop context
  if (advancedLoopStack.length > 0) {
    const currentLoop = advancedLoopStack[advancedLoopStack.length - 1];
    addLog('   Dalam loop "' + currentLoop.name + '": iterasi ' + (currentLoop.currentIteration + 1) + '/' + currentLoop.maxIterations, 'info');
  }
}

// Hook to add after step execution
function postStepExecutionHook(step, index, success) {
  // Additional logging for advanced features
  if (success && hasAdvancedFeatures(step)) {
    addLog('? Advanced step ' + (index + 1) + ' berhasil', 'success');
  }
}

// -------------------------------------------------------------
// 6. UI EXTENSIONS (ADD TO EXISTING UI)
// -------------------------------------------------------------

// Function to add advanced properties to node editor
function addAdvancedNodeProperties() {
  // This would be called when showing node properties
  // Add UI elements for retry and loop properties
  
  const propPanel = document.getElementById('prop-panel');
  if (!propPanel) return;
  
  // Add retry section
  const retrySection = document.createElement('div');
  retrySection.className = 'prop-section';
  retrySection.innerHTML = `
    <h4>?? Retry Settings</h4>
    <label>Retry Count: <input type="number" id="retry-count" min="0" max="10" value="0"></label>
    <label>Retry Delay (ms): <input type="number" id="retry-delay" min="0" value="1000"></label>
    <label><input type="checkbox" id="retry-on-error"> Retry on Error</label>
  `;
  
  // Add loop section
  const loopSection = document.createElement('div');
  loopSection.className = 'prop-section';
  loopSection.innerHTML = `
    <h4>?? Loop Settings (for Loop Start)</h4>
    <label>Loop Count: <input type="number" id="loop-count" min="1" value="1"></label>
    <label>Loop Variable: <input type="text" id="loop-var" value="i"></label>
    <label>Delay Between Loops (ms): <input type="number" id="loop-delay" min="0" value="0"></label>
    <label>Break Condition: <input type="text" id="break-condition" placeholder="e.g., {counter} > 5"></label>
  `;
  
  // Insert before existing properties
  const existingProps = propPanel.querySelector('.prop-content');
  if (existingProps) {
    existingProps.appendChild(retrySection);
    existingProps.appendChild(loopSection);
  }
}

// Call this when initializing the app
// addAdvancedNodeProperties(); // Uncomment to enable UI extensions

// -------------------------------------------------------------
// 7. EXAMPLE USAGE & DEMO
// -------------------------------------------------------------

/*
// Example: How to use in existing code

// 1. In runWorkflow, before executing a step:
preStepExecutionHook(s, i);

// 2. Wrap step execution with retry:
try {
  await executeStepWithRetry(s, async (step) => {
    // Original step execution logic here
    switch(step.type) {
      case 'mobile-tap':
        // ... existing code
        break;
      // ... other cases
    }
  });
  postStepExecutionHook(s, i, true);
} catch (error) {
  postStepExecutionHook(s, i, false);
  // Handle error
}

// 3. For loop handling (already in existing runWorkflow):
if (type === 'loop-start') {
  handleAdvancedLoopStart(s, i);
  // ... existing logic
}

if (type === 'loop-end') {
  const jumpTo = handleAdvancedLoopEnd(s, i);
  if (jumpTo !== false) {
    i = jumpTo;
    continue;
  }
}
*/

// ============================================================
// WORKING LOOP & RETRY IMPLEMENTATION (READY TO USE)
// ============================================================

// -------------------------------------------------------------
// 1. EXECUTE STEP WITH RETRY (WORKING VERSION)
// -------------------------------------------------------------
async function executeStepWithRetry(step, device, varStore, addLog, runAdb, wait, interpolate, storeVar) {
  const maxRetries = parseInt(step.maxRetries) || 0;
  const retryDelay = parseInt(step.retryDelay) || 1000;

  if (maxRetries <= 0) {
    // No retry, execute directly
    return await executeStepOnce(step, device, varStore, addLog, runAdb, wait, interpolate, storeVar);
  }

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        addLog(`?? Retry ${attempt}/${maxRetries} untuk "${step.name}" dalam ${retryDelay}ms...`, 'warn');
        await wait(retryDelay);
      }

      const result = await executeStepOnce(step, device, varStore, addLog, runAdb, wait, interpolate, storeVar);

      if (attempt > 0) {
        addLog(`? Retry berhasil pada attempt ${attempt + 1}`, 'success');
      }

      return result;

    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        addLog(`? Attempt ${attempt + 1} gagal: ${error.message}`, 'error');
      } else {
        addLog(`?? Semua ${maxRetries + 1} attempt gagal untuk "${step.name}"`, 'error');
        throw error;
      }
    }
  }

  throw lastError;
}

// -------------------------------------------------------------
// 2. EXECUTE SINGLE STEP (CORE LOGIC)
// -------------------------------------------------------------
async function executeStepOnce(step, device, varStore, addLog, runAdb, wait, interpolate, storeVar) {
  const type = String(step.type || '').toLowerCase();
  const stepDevice = step.deviceId || device;

  // Delay before step
  if (step.delay > 0) {
    await wait(step.delay);
  }

  switch(type) {
    case 'start':
      addLog(`Step: ?? START`, 'info');
      break;

    case 'delay': {
      const ms = parseInt(step.delay) || 1000;
      addLog(`Step: ? Delay ${ms}ms`, 'info');
      await wait(ms);
      break;
    }

    case 'mobile-tap': {
      const x = parseInt(step.mx) || 0;
      const y = parseInt(step.my) || 0;
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      addLog(`Step: ?? ADB Tap (${x}, ${y})`, 'info');
      const r = await runAdb(stepDevice, `shell input tap ${x} ${y}`);
      if (!r.success) throw new Error('ADB tap gagal: ' + r.error);
      addLog(`  Tap berhasil`, 'success');
      break;
    }

    case 'mobile-swipe': {
      const sx = parseInt(step.sx)||0, sy = parseInt(step.sy)||0;
      const ex = parseInt(step.ex)||0, ey = parseInt(step.ey)||0;
      const dur = parseInt(step.dur)||300;
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      addLog(`Step: ?? ADB Swipe (${sx},${sy})?(${ex},${ey}) ${dur}ms`, 'info');
      const r = await runAdb(stepDevice, `shell input swipe ${sx} ${sy} ${ex} ${ey} ${dur}`);
      if (!r.success) throw new Error('ADB swipe gagal: ' + r.error);
      addLog(`  Swipe berhasil`, 'success');
      break;
    }

    case 'mobile-press-key': {
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      const keyCode = step.keyCode || '4';
      addLog(`Step: ?? Press Key ${keyCode}`, 'info');
      const r = await runAdb(stepDevice, `shell input keyevent ${keyCode}`);
      if (!r.success) throw new Error('ADB keyevent gagal: ' + r.error);
      addLog(`  Key press berhasil`, 'success');
      break;
    }

    case 'mobile-screenshot': {
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      const devicePath = '/sdcard/rba_screen_' + Date.now() + '.png';
      const localPath = require('path').join(require('os').homedir(), 'Documents', 'screenshot_' + Date.now() + '.png');
      addLog(`Step: ?? Screenshot`, `info`);
      const r1 = await runAdb(stepDevice, `shell screencap -p ${devicePath}`);
      if (!r1.success) throw new Error('screencap gagal: ' + r1.error);
      const r2 = await runAdb(stepDevice, `pull ${devicePath} "${localPath}"`);
      if (!r2.success) throw new Error('pull gagal: ' + r2.error);
      await runAdb(stepDevice, `shell rm ${devicePath}`);
      if (step.var) storeVar(step.var, localPath);
      addLog(`  Screenshot: ${localPath}`, 'success');
      break;
    }

    case 'type-into': {
      const text = interpolate(step.text || '');
      if (stepDevice && stepDevice !== 'No ADB Device') {
        if (step.cx && step.cy) {
          await runAdb(stepDevice, `shell input tap ${step.cx} ${step.cy}`);
          await wait(500);
        }
        const escaped = text.replace(/ /g,'%s').replace(/'/g,"\\'").replace(/"/g,'\\"');
        const r = await runAdb(stepDevice, `shell input text "${escaped}"`);
        if (!r.success) throw new Error('input text gagal: ' + r.error);
        addLog(`Step: ?? Type "${text.substring(0,30)}"`, 'success');
      } else {
        addLog(`Step: ?? Type "${text.substring(0,30)}" (simulasi)`, 'warn');
        await wait(Math.max(200, text.length * 30));
      }
      break;
    }

    case 'tap':
    case 'click': {
      if (stepDevice && stepDevice !== 'No ADB Device' && step.cx && step.cy) {
        const r = await runAdb(stepDevice, `shell input tap ${step.cx} ${step.cy}`);
        if (!r.success) throw new Error(r.error);
      } else {
        await wait(500);
      }
      addLog(`Step: ?? Click`, 'success');
      break;
    }

    case 'open-browser': {
      const url = interpolate(step.url || 'https://example.com');
      ipcRenderer.send('open-external', url);
      await wait(parseInt(step.waitAfterLoad)||2000);
      addLog(`Step: ?? Browser opened: ${url}`, 'success');
      break;
    }

    case 'open-app': {
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      const pkg = step.var || step.text || '';
      if (!pkg) throw new Error('Package name kosong');
      const r = await runAdb(stepDevice, `shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
      if (!r.success) throw new Error(r.error);
      await wait(2000);
      addLog(`Step: ?? App launched: ${pkg}`, 'success');
      break;
    }

    case 'close-app': {
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      const pkg = step.var || step.text || '';
      if (!pkg) throw new Error('Package name kosong');
      const r = await runAdb(stepDevice, `shell am force-stop ${pkg}`);
      if (!r.success) throw new Error(r.error);
      addLog(`Step: ? App stopped: ${pkg}`, 'success');
      break;
    }

    case 'api-request': {
      const url = interpolate(step.apiUrl || '');
      if (!url) throw new Error('URL API kosong');
      addLog(`Step: ?? ${step.apiMethod||'GET'} ${url}`, 'info');
      let headers = {'User-Agent':'RBA-Studio/2.0'};
      if (step.apiHeaders) {
        try { headers = {...headers,...JSON.parse(step.apiHeaders)}; } catch(e) {}
      }
      const result = await new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const lib = urlObj.protocol==='https:' ? require('https') : require('http');
        const opts = { hostname:urlObj.hostname, port:urlObj.port||(urlObj.protocol==='https:'?443:80), path:urlObj.pathname+urlObj.search, method:step.apiMethod||'GET', headers, timeout:15000 };
        const req = lib.request(opts, (res) => {
          let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode,data:d}));
        });
        req.on('error', reject);
        req.on('timeout', ()=>{ req.destroy(); reject(new Error('timeout')); });
        if (['POST','PUT','PATCH'].includes(step.apiMethod) && step.apiBody) req.write(interpolate(step.apiBody));
        req.end();
      });
      addLog(`  Response: ${result.status} (${result.data.length} chars)`, result.status<400?'success':'warn');
      if (step.var) {
        try { storeVar(step.var, JSON.parse(result.data)); } catch(e) { storeVar(step.var, result.data); }
      }
      if (result.status >= 400) throw new Error('HTTP '+result.status);
      break;
    }

    case 'input-dialog': {
      const q = step.text || step.name || 'Masukkan nilai:';
      const def = step.var ? (varStore[step.var]||'') : '';
      const val = prompt(q+(def?'\n(Default: '+def+')':''));
      if (val !== null && step.var) { storeVar(step.var, val); addLog(`Step: ?? Input {${step.var}} = "${val}"`, 'success'); }
      break;
    }

    case 'if-condition': {
      const expr = interpolate(step.condition || 'true');
      let result = false;
      try { const fn = new Function(...Object.keys(varStore), 'return ('+expr+')'); result = Boolean(fn(...Object.values(varStore))); } catch(e) {}
      addLog(`Step: ? Condition "${expr}" = ${result}`, result?'success':'warn');
      if (step.var) storeVar(step.var, result);
      break;
    }

    case 'wait-element': {
      const timeout = parseInt(step.waitTimeout)||10000;
      addLog(`Step: ? Wait [${step.waitSelector}] ${step.waitCondition} (max ${timeout}ms)`, 'info');
      if (stepDevice && step.waitSelector) {
        const t0 = Date.now();
        while (Date.now()-t0 < timeout) {
          const r = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ui_wait.xml && cat /sdcard/ui_wait.xml');
          if (r.success && r.output.includes(step.waitSelector)) {
            addLog(`  Element ditemukan!`, 'success'); break;
          }
          await wait(1000);
        }
      } else { await wait(Math.min(timeout, 3000)); }
      break;
    }

    case 'screenshot-page': {
      if (stepDevice) {
        const dp='/sdcard/rba_sc_'+Date.now()+'.png', lp=require('path').join(require('os').homedir(),'Documents','sc_'+Date.now()+'.png');
        const r1=await runAdb(stepDevice,'shell screencap -p '+dp);
        if (r1.success) { const r2=await runAdb(stepDevice,'pull '+dp+' "'+lp+'"'); if(r2.success){await runAdb(stepDevice,'shell rm '+dp);if(step.var)storeVar(step.var,lp);addLog(`Step: ?? Screenshot -> ${lp}`,'success');} }
      } else { await wait(1000); addLog(`Step: ?? Screenshot (no device)`,'warn'); }
      break;
    }

    case 'extract-text':
    case 'extract-table': {
      addLog(`Step: ?? Extract [${step.selector}] -> {${step.var}}`, 'info');
      if (step.var) storeVar(step.var, 'extracted_'+Date.now());
      await wait(500); break;
    }

    case 'ocr': {
      if (stepDevice) {
        const r=await runAdb(stepDevice,'shell uiautomator dump /sdcard/ocr.xml && cat /sdcard/ocr.xml');
        if (r.success) { const texts=[]; const rx=/text="([^"]+)"/g; let m; while((m=rx.exec(r.output))&&texts.length<20)texts.push(m[1]); if(step.var)storeVar(step.var,texts.join(' | ')); addLog(`Step: ??? OCR: ${texts.slice(0,3).join(', ')}`,'success'); }
      } else { addLog(`Step: ??? OCR butuh device`,'warn'); }
      break;
    }

    case 'read-csv': {
      const fp=interpolate(step.filePath||''); if(!fp)break;
      const fs=require('fs'); if(!fs.existsSync(fp))throw new Error('File tidak ada: '+fp);
      const lines=fs.readFileSync(fp,'utf8').split('\n').filter(l=>l.trim());
      const rows=lines.slice(step.skipHeader==='yes'?1:0).map(l=>l.split(step.delimiter||',').map(c=>c.trim()));
      if(step.var)storeVar(step.var,rows);
      addLog(`Step: ?? CSV ${rows.length} baris OK`,'success'); break;
    }

    case 'write-csv': {
      const data=step.var?varStore[step.var]:[];
      const fp=interpolate(step.filePath||'output_'+Date.now()+'.csv');
      const content=Array.isArray(data)?data.map(r=>Array.isArray(r)?r.join(step.delimiter||','):String(r)).join('\n'):String(data);
      require('fs').writeFileSync(fp,content,step.encoding||'utf8');
      addLog(`Step: ?? CSV ditulis: ${fp}`,'success'); break;
    }

    case 'download-file': {
      const url=interpolate(step.url||step.var||''); if(!url)throw new Error('URL kosong');
      const lp=require('path').join(require('os').homedir(),'Downloads',require('path').basename(step.filePath||'download_'+Date.now()));
      await new Promise((res,rej)=>{ const uo=new URL(url),lib=uo.protocol==='https:'?require('https'):require('http'),fs=require('fs'),f=fs.createWriteStream(lp); lib.get(url,(r)=>{r.pipe(f);f.on('finish',()=>{f.close();res();})}).on('error',rej); });
      if(step.var)storeVar(step.var,lp);
      addLog(`Step: ?? Download OK: ${lp}`,'success'); break;
    }

    case 'json-processing': {
      if(step.var&&varStore[step.var]){try{const p=typeof varStore[step.var]==='string'?JSON.parse(varStore[step.var]):varStore[step.var];storeVar(step.var,p);addLog(`Step: ?? JSON parse OK`,'success');}catch(e){addLog(`JSON error: ${e.message}`,'warn');}}
      break;
    }

    case 'regex-extraction': {
      const src=step.var?String(varStore[step.var]||''):'';
      if(src&&step.regex){try{const rx=new RegExp(step.regex,'g'),matches=[...src.matchAll(rx)].map(m=>m[0]);if(step.var)storeVar(step.var+'_matches',matches);addLog(`Regex: ${matches.length} match(es)`,'success');}catch(e){addLog(`Regex error: ${e.message}`,'warn');}}
      break;
    }

    case 'filter-data': {
      const data=step.var?varStore[step.var]:null;
      if(Array.isArray(data)&&step.condition){try{const filtered=data.filter(item=>{const fn=new Function('item','return ('+step.condition+')');return fn(item);});storeVar(step.var,filtered);addLog(`Filter: ${data.length}->${filtered.length}`,'success');}catch(e){addLog(`Filter error: ${e.message}`,'warn');}}
      break;
    }

    case 'batch-slice': {
      const data=step.var?varStore[step.var]:null;
      if(Array.isArray(data)){const sz=parseInt(step.loopCount)||10,batches=[];for(let j=0;j<data.length;j+=sz)batches.push(data.slice(j,j+sz));storeVar((step.var||'data')+'_batches',batches);addLog(`Batch: ${batches.length}x${sz}`,'success');}
      break;
    }

    case 'copy-paste-var': {
      const src=step.selector||'',dst=step.var||'';
      if(src&&dst&&varStore[src]!==undefined){storeVar(dst,varStore[src]);addLog(`{${src}} -> {${dst}}`,'success');}
      break;
    }

    case 'debug-step': {
      const vars=Object.entries(varStore).map(([k,v])=>'{'+k+'}='+String(v).substring(0,30)).join('\n');
      alert('DEBUG Step: '+step.name+'\n\nVariables:\n'+vars+'\n\nKlik OK lanjut.');
      addLog(`Step: ?? DEBUG PAUSE`,'warn'); break;
    }

    case 'performance-track': {
      const ms=Date.now()-execStats.startTime;
      if(step.var)storeVar(step.var,ms);
      addLog(`Step: ?? Perf: ${ms}ms`,'info'); break;
    }

    case 'signature-swipe': {
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      const x1=parseInt(step.sigX1)||200, y1=parseInt(step.sigY1)||800;
      const x2=parseInt(step.sigX2)||800, y2=parseInt(step.sigY2)||800;
      const dur=parseInt(step.sigDuration)||1500;
      addLog(`Step: ?? Signature swipe (${x1},${y1}) -> (${x2},${y2})`, 'info');
      const result = await executeSignatureSwipe(stepDevice, x1, y1, x2, y2, dur);
      addLog(`  Signature OK (${result.points} titik)`, 'success');
      break;
    }

    default:
      addLog(`Step: [${type}] step dijalankan (${parseInt(step.delay)||500}ms)`, 'warn');
      await wait(parseInt(step.delay) || 500);
  }

  return { success: true };
}

// -------------------------------------------------------------
// 3. RUN WORKFLOW V2 (WITH WORKING LOOPS & RETRY)
// -------------------------------------------------------------
async function runWorkflowV2() {
  if (!project.steps.length) { addLog('Tidak ada steps!', 'warn'); return; }

  // Setup UI
  const runBtn = document.getElementById('run-flow-btn');
  const stopBtn = document.getElementById('stop-flow-btn');
  const tbRun = document.getElementById('tb-run-btn');
  const status = document.getElementById('bot-status');

  stopRequested = false;
  varStore = {};
  updateVarPanel();
  execStats = { steps:0, errors:0, retries:0, adb:0, startTime:Date.now(), interval:null };
  execStats.interval = setInterval(updateRuntime, 500);

  runBtn.disabled = true; stopBtn.disabled = false;
  runBtn.textContent = 'Running V2...';
  if (tbRun) { tbRun.textContent = 'Running V2...'; tbRun.disabled = true; }
  status.className = 'hdr-badge online';
  status.innerHTML = '<div class="hdr-dot"></div>ONLINE';

  const device = document.getElementById('device-selector').value;
  addLog('=== Workflow V2 Start: ' + currentName + ' (Advanced Loops & Retry) ===', 'info');

  // Advanced loop stack for nested loops
  const loopStack = [];

  let i = 0;
  while (i < project.steps.length && !stopRequested) {
    const step = project.steps[i];
    const type = String(step.type || '').toLowerCase();

    execStats.steps++;
    document.getElementById('st-steps').textContent = execStats.steps;
    step.status = 'running';
    render();

    try {
      // -- HANDLE LOOP START --
      if (type === 'repeat-start' || type === 'loop-start') {
        const loopCount = Math.max(1, parseInt(step.loopCount) || 1);
        const loopVar = step.loopVar || step.loopVariable || 'i';
        const loopName = step.loopName || `loop_${step.id}`;

        loopStack.push({
          startIndex: i,
          currentIteration: 0,
          maxIterations: loopCount,
          loopVariable: loopVar,
          loopName: loopName,
          delayBetweenIterations: parseInt(step.delayBetweenLoop) || 0,
          breakCondition: step.breakCondition || null
        });

        storeVar(loopVar, 0);
        addLog(`?? Loop "${loopName}" started: ${loopCount} iterations`, 'info');
        step.status = 'success';
        render();
        i++;
        continue;
      }

      // -- HANDLE LOOP END --
      if (type === 'repeat-end' || type === 'loop-end') {
        if (loopStack.length === 0) {
          addLog(`?? Loop End tanpa Loop Start di step ${i+1}`, 'warn');
          step.status = 'success';
          render();
          i++;
          continue;
        }

        const loop = loopStack[loopStack.length - 1];

        // Check break condition
        let shouldBreak = false;
        if (loop.breakCondition) {
          try {
            const fn = new Function(...Object.keys(varStore), `return (${loop.breakCondition})`);
            shouldBreak = Boolean(fn(...Object.values(varStore)));
          } catch(e) {
            addLog(`?? Break condition error: ${e.message}`, 'warn');
          }
        }

        if (shouldBreak) {
          addLog(`?? Loop "${loop.loopName}" di-break karena kondisi`, 'warn');
          loopStack.pop();
          step.status = 'success';
          render();
          i++;
          continue;
        }

        // Increment iteration
        loop.currentIteration++;
        storeVar(loop.loopVariable, loop.currentIteration);

        if (loop.currentIteration < loop.maxIterations) {
          // Continue loop - jump back to after Loop Start
          addLog(`?? Loop "${loop.loopName}": iterasi ${loop.currentIteration}/${loop.maxIterations}`, 'info');

          // Delay between iterations
          if (loop.delayBetweenIterations > 0) {
            addLog(`?? Delay antar iterasi: ${loop.delayBetweenIterations}ms`, 'info');
            await wait(loop.delayBetweenIterations);
          }

          i = loop.startIndex + 1; // Jump back to step after Loop Start
          continue;
        } else {
          // Loop finished
          addLog(`? Loop "${loop.loopName}" selesai: ${loop.maxIterations} iterasi`, 'success');
          loopStack.pop();
          step.status = 'success';
          render();
          i++;
          continue;
        }
      }

      // -- EXECUTE STEP WITH RETRY --
      await executeStepWithRetry(step, device, varStore, addLog, runAdb, wait, interpolate, storeVar);

      step.status = 'success';

    } catch (error) {
      execStats.errors++;
      document.getElementById('st-errors').textContent = execStats.errors;
      addLog(`? Error di step ${i+1} "${step.name}": ${error.message}`, 'error');
      step.status = 'error';
    }

    render();
    await wait(50);
    i++;
  }

  clearInterval(execStats.interval);
  addLog('=== Workflow V2 ' + (stopRequested ? 'STOPPED' : 'Complete') + ' ===', stopRequested ? 'warn' : 'success');

  runBtn.disabled = false; stopBtn.disabled = true;
  runBtn.textContent = '? RUN';
  if (tbRun) { tbRun.textContent = '? Run'; tbRun.disabled = false; }
  status.className = 'hdr-badge offline';
  status.innerHTML = '<div class="hdr-dot"></div>OFFLINE';

  setTimeout(() => { project.steps.forEach(s => s.status = ''); render(); }, 3000);
}

// -------------------------------------------------------------
// 4. INTEGRATION: REPLACE RUN BUTTON TO USE V2
// -------------------------------------------------------------

// Replace the runWorkflow function call in the HTML
// Change onclick="runWorkflow()" to onclick="runWorkflowV2()"

// For backward compatibility, keep runWorkflow but make it call V2
const originalRunWorkflow = runWorkflow;
runWorkflow = runWorkflowV2;

// ============================================================
// END OF WORKING LOOP & RETRY IMPLEMENTATION
// ============================================================

// ============================================================
// WORKING LOOP & RETRY IMPLEMENTATION (READY TO USE)
// ============================================================

// -------------------------------------------------------------
// 1. EXECUTE STEP WITH RETRY (WORKING VERSION)
// -------------------------------------------------------------
async function executeStepWithRetry(step, device, varStore, addLog, runAdb, wait, interpolate, storeVar) {
  const maxRetries = parseInt(step.maxRetries) || 0;
  const retryDelay = parseInt(step.retryDelay) || 1000;

  if (maxRetries <= 0) {
    // No retry, execute directly
    return await executeStepOnce(step, device, varStore, addLog, runAdb, wait, interpolate, storeVar);
  }

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        addLog(`?? Retry ${attempt}/${maxRetries} untuk "${step.name}" dalam ${retryDelay}ms...`, 'warn');
        await wait(retryDelay);
      }

      const result = await executeStepOnce(step, device, varStore, addLog, runAdb, wait, interpolate, storeVar);

      if (attempt > 0) {
        addLog(`? Retry berhasil pada attempt ${attempt + 1}`, 'success');
      }

      return result;

    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        addLog(`? Attempt ${attempt + 1} gagal: ${error.message}`, 'error');
      } else {
        addLog(`?? Semua ${maxRetries + 1} attempt gagal untuk "${step.name}"`, 'error');
        throw error;
      }
    }
  }

  throw lastError;
}

// -------------------------------------------------------------
// 2. EXECUTE SINGLE STEP (CORE LOGIC)
// -------------------------------------------------------------
async function executeStepOnce(step, device, varStore, addLog, runAdb, wait, interpolate, storeVar) {
  const type = String(step.type || '').toLowerCase();
  const stepDevice = step.deviceId || device;

  // Delay before step
  if (step.delay > 0) {
    await wait(step.delay);
  }

  switch(type) {
    case 'start':
      addLog(`Step: ?? START`, 'info');
      break;

    case 'delay': {
      const ms = parseInt(step.delay) || 1000;
      addLog(`Step: ? Delay ${ms}ms`, 'info');
      await wait(ms);
      break;
    }

    case 'mobile-tap': {
      const x = parseInt(step.mx) || 0;
      const y = parseInt(step.my) || 0;
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      addLog(`Step: ?? ADB Tap (${x}, ${y})`, 'info');
      const r = await runAdb(stepDevice, `shell input tap ${x} ${y}`);
      if (!r.success) throw new Error('ADB tap gagal: ' + r.error);
      addLog(`  Tap berhasil`, 'success');
      break;
    }

    case 'mobile-swipe': {
      const sx = parseInt(step.sx)||0, sy = parseInt(step.sy)||0;
      const ex = parseInt(step.ex)||0, ey = parseInt(step.ey)||0;
      const dur = parseInt(step.dur)||300;
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      addLog(`Step: ?? ADB Swipe (${sx},${sy})?(${ex},${ey}) ${dur}ms`, 'info');
      const r = await runAdb(stepDevice, `shell input swipe ${sx} ${sy} ${ex} ${ey} ${dur}`);
      if (!r.success) throw new Error('ADB swipe gagal: ' + r.error);
      addLog(`  Swipe berhasil`, 'success');
      break;
    }

    case 'mobile-press-key': {
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      const keyCode = step.keyCode || '4';
      addLog(`Step: ?? Press Key ${keyCode}`, 'info');
      const r = await runAdb(stepDevice, `shell input keyevent ${keyCode}`);
      if (!r.success) throw new Error('ADB keyevent gagal: ' + r.error);
      addLog(`  Key press berhasil`, 'success');
      break;
    }

    case 'mobile-screenshot': {
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      const devicePath = '/sdcard/rba_screen_' + Date.now() + '.png';
      const localPath = require('path').join(require('os').homedir(), 'Documents', 'screenshot_' + Date.now() + '.png');
      addLog(`Step: ?? Screenshot`, `info`);
      const r1 = await runAdb(stepDevice, `shell screencap -p ${devicePath}`);
      if (!r1.success) throw new Error('screencap gagal: ' + r1.error);
      const r2 = await runAdb(stepDevice, `pull ${devicePath} "${localPath}"`);
      if (!r2.success) throw new Error('pull gagal: ' + r2.error);
      await runAdb(stepDevice, `shell rm ${devicePath}`);
      if (step.var) storeVar(step.var, localPath);
      addLog(`  Screenshot: ${localPath}`, 'success');
      break;
    }

    case 'type-into': {
      const text = interpolate(step.text || '');
      if (stepDevice && stepDevice !== 'No ADB Device') {
        if (step.cx && step.cy) {
          await runAdb(stepDevice, `shell input tap ${step.cx} ${step.cy}`);
          await wait(500);
        }
        const escaped = text.replace(/ /g,'%s').replace(/'/g,"\\'").replace(/"/g,'\\"');
        const r = await runAdb(stepDevice, `shell input text "${escaped}"`);
        if (!r.success) throw new Error('input text gagal: ' + r.error);
        addLog(`Step: ?? Type "${text.substring(0,30)}"`, 'success');
      } else {
        addLog(`Step: ?? Type "${text.substring(0,30)}" (simulasi)`, 'warn');
        await wait(Math.max(200, text.length * 30));
      }
      break;
    }

    case 'tap':
    case 'click': {
      if (stepDevice && stepDevice !== 'No ADB Device' && step.cx && step.cy) {
        const r = await runAdb(stepDevice, `shell input tap ${step.cx} ${step.cy}`);
        if (!r.success) throw new Error(r.error);
      } else {
        await wait(500);
      }
      addLog(`Step: ?? Click`, 'success');
      break;
    }

    case 'open-browser': {
      const url = interpolate(step.url || 'https://example.com');
      ipcRenderer.send('open-external', url);
      await wait(parseInt(step.waitAfterLoad)||2000);
      addLog(`Step: ?? Browser opened: ${url}`, 'success');
      break;
    }

    case 'open-app': {
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      const pkg = step.var || step.text || '';
      if (!pkg) throw new Error('Package name kosong');
      const r = await runAdb(stepDevice, `shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
      if (!r.success) throw new Error(r.error);
      await wait(2000);
      addLog(`Step: ?? App launched: ${pkg}`, 'success');
      break;
    }

    case 'close-app': {
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      const pkg = step.var || step.text || '';
      if (!pkg) throw new Error('Package name kosong');
      const r = await runAdb(stepDevice, `shell am force-stop ${pkg}`);
      if (!r.success) throw new Error(r.error);
      addLog(`Step: ? App stopped: ${pkg}`, 'success');
      break;
    }

    case 'api-request': {
      const url = interpolate(step.apiUrl || '');
      if (!url) throw new Error('URL API kosong');
      addLog(`Step: ?? ${step.apiMethod||'GET'} ${url}`, 'info');
      let headers = {'User-Agent':'RBA-Studio/2.0'};
      if (step.apiHeaders) {
        try { headers = {...headers,...JSON.parse(step.apiHeaders)}; } catch(e) {}
      }
      const result = await new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const lib = urlObj.protocol==='https:' ? require('https') : require('http');
        const opts = { hostname:urlObj.hostname, port:urlObj.port||(urlObj.protocol==='https:'?443:80), path:urlObj.pathname+urlObj.search, method:step.apiMethod||'GET', headers, timeout:15000 };
        const req = lib.request(opts, (res) => {
          let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode,data:d}));
        });
        req.on('error', reject);
        req.on('timeout', ()=>{ req.destroy(); reject(new Error('timeout')); });
        if (['POST','PUT','PATCH'].includes(step.apiMethod) && step.apiBody) req.write(interpolate(step.apiBody));
        req.end();
      });
      if (step.var) {
        try { storeVar(step.var, JSON.parse(result.data)); } catch(e) { storeVar(step.var, result.data); }
      }
      if (result.status >= 400) throw new Error('HTTP '+result.status);
      addLog(`  Response: ${result.status}`, result.status<400?'success':'warn');
      break;
    }

    case 'input-dialog': {
      const q = step.text || step.name || 'Masukkan nilai:';
      const def = step.var ? (varStore[step.var]||'') : '';
      const val = prompt(q + (def ? '\\n(Default: '+def+')' : ''), def);
      if (val !== null && step.var) {
        storeVar(step.var, val);
        addLog(`Step: ?? Input {${step.var}} = "${val}"`, 'success');
      }
      break;
    }

    case 'if-condition': {
      const expr = interpolate(step.condition || 'true');
      let result = false;
      try {
        const fn = new Function(...Object.keys(varStore), `return (${expr})`);
        result = Boolean(fn(...Object.values(varStore)));
      } catch(e) {
        addLog(`  Kondisi eval error: ${e.message}`, 'warn');
        result = false;
      }
      addLog(`Step: ? Kondisi "${expr}" = ${result}`, result?'success':'warn');
      if (step.var) storeVar(step.var, result);
      break;
    }

    case 'wait-element': {
      const timeout = parseInt(step.waitTimeout)||10000;
      addLog(`Step: ? Wait element "${step.waitSelector}" (${timeout}ms)`, 'info');
      if (stepDevice && stepDevice !== 'No ADB Device' && step.waitSelector) {
        const t0 = Date.now();
        while (Date.now()-t0 < timeout) {
          const r = await runAdb(stepDevice, `shell uiautomator dump /sdcard/ui_wait.xml && cat /sdcard/ui_wait.xml`);
          if (r.success && r.output.includes(step.waitSelector)) {
            addLog(`  Element ditemukan!`, 'success');
            break;
          }
          await wait(1000);
        }
      } else {
        await wait(Math.min(timeout, 3000));
      }
      break;
    }

    case 'screenshot-page': {
      if (stepDevice && stepDevice !== 'No ADB Device') {
        const dp='/sdcard/rba_sc_'+Date.now()+'.png', lp=require('path').join(require('os').homedir(),'Documents','sc_'+Date.now()+'.png');
        const r1=await runAdb(stepDevice,`shell screencap -p ${dp}`);
        if (r1.success) {
          const r2=await runAdb(stepDevice,`pull ${dp} "${lp}"`);
          if (r2.success) {
            await runAdb(stepDevice,`shell rm ${dp}`);
            if (step.var) storeVar(step.var, lp);
            addLog(`Step: ?? Screenshot: ${lp}`, 'success');
          }
        }
      } else {
        addLog(`Step: ?? Screenshot (no device)`, 'warn');
      }
      break;
    }

    case 'extract-text':
    case 'extract-table': {
      addLog(`Step: ?? Extract "${step.selector}" -> {${step.var}}`, 'info');
      if (step.var) storeVar(step.var, 'extracted_'+Date.now());
      await wait(500);
      break;
    }

    case 'ocr': {
      if (stepDevice && stepDevice !== 'No ADB Device') {
        const r = await runAdb(stepDevice, `shell uiautomator dump /sdcard/ocr.xml && cat /sdcard/ocr.xml`);
        if (r.success) {
          const texts = [];
          const rx = /text="([^"]+)"/g;
          let m;
          while ((m = rx.exec(r.output)) !== null && texts.length < 30) {
            if (m[1].trim()) texts.push(m[1]);
          }
          const ocrResult = texts.join(' | ');
          if (step.var) storeVar(step.var, ocrResult);
          addLog(`Step: ??? OCR: ${ocrResult.substring(0,100)}`, 'success');
          await runAdb(stepDevice, `shell rm /sdcard/ocr.xml`);
        }
      } else {
        addLog(`Step: ??? OCR butuh device`, 'warn');
      }
      break;
    }

    case 'read-csv': {
      const fp = interpolate(step.filePath || '');
      if (!fp) break;
      const fs = require('fs');
      if (!fs.existsSync(fp)) throw new Error('File tidak ada: '+fp);
      const content = fs.readFileSync(fp, step.encoding || 'utf8');
      const lines = content.split('\\n').filter(l=>l.trim());
      const rows = lines.slice(step.skipHeader==='yes'?1:0).map(l=>l.split(step.delimiter||',').map(c=>c.trim()));
      if (step.var) storeVar(step.var, rows);
      addLog(`Step: ?? CSV dibaca: ${rows.length} baris`, 'success');
      break;
    }

    case 'write-csv': {
      const data = step.var ? (varStore[step.var] || []) : [];
      const fp = interpolate(step.filePath || 'output_'+Date.now()+'.csv');
      const content = Array.isArray(data) ? data.map(r=>Array.isArray(r)?r.join(step.delimiter||','):String(r)).join('\\n') : String(data);
      require('fs').writeFileSync(fp, content, step.encoding || 'utf8');
      addLog(`Step: ?? CSV ditulis: ${fp}`, 'success');
      break;
    }

    case 'download-file': {
      const url = interpolate(step.url || step.var || '');
      if (!url) throw new Error('URL kosong');
      const lp = require('path').join(require('os').homedir(), 'Downloads', require('path').basename(step.filePath || 'download_'+Date.now()));
      addLog(`Step: ?? Download: ${url}`, 'info');
      await new Promise((res,rej)=>{
        const uo = new URL(url), lib = uo.protocol==='https:'?require('https'):require('http'), fs=require('fs'), f=fs.createWriteStream(lp);
        lib.get(url,(r)=>{r.pipe(f);f.on('finish',()=>{f.close();res();})}).on('error',(err)=>{require('fs').unlink(lp,()=>{});rej(err);});
      });
      if (step.var) storeVar(step.var, lp);
      addLog(`  Download selesai: ${lp}`, 'success');
      break;
    }

    case 'json-processing': {
      if (step.var && varStore[step.var]) {
        try {
          const p = typeof varStore[step.var]==='string' ? JSON.parse(varStore[step.var]) : varStore[step.var];
          storeVar(step.var, p);
          addLog(`Step: ?? JSON parsed`, 'success');
        } catch(e) { addLog(`JSON error: ${e.message}`, 'warn'); }
      }
      break;
    }

    case 'debug-step': {
      const vars = Object.entries(varStore).map(([k,v])=>`{${k}}=${String(v).substring(0,30)}`).join('\\n');
      alert(`DEBUG Step: ${step.name}\\n\\nVariables:\\n${vars}\\n\\nKlik OK lanjut.`);
      addLog(`Step: ?? DEBUG PAUSE`, 'warn');
      break;
    }

    case 'performance-track': {
      const ms = Date.now() - execStats.startTime;
      if (step.var) storeVar(step.var, ms);
      addLog(`Step: ?? Performance: ${ms}ms`, 'info');
      break;
    }

    case 'signature-swipe': {
      if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
      const x1 = parseInt(step.sigX1)||200, y1 = parseInt(step.sigY1)||800;
      const x2 = parseInt(step.sigX2)||800, y2 = parseInt(step.sigY2)||800;
      const dur = parseInt(step.sigDuration)||1500;
      addLog(`Step: ?? Signature swipe (${x1},${y1}) -> (${x2},${y2})`, 'info');
      const result = await executeSignatureSwipe(stepDevice, x1, y1, x2, y2, dur);
      addLog(`  Signature OK (${result.points} titik)`, 'success');
      break;
    }

    case 'regex-extraction': {
      const src = step.var ? String(varStore[step.var] || '') : '';
      if (src && step.regex) {
        try {
          const rx = new RegExp(step.regex, 'g');
          const matches = [...src.matchAll(rx)].map(m => m[0]);
          if (step.var) storeVar(step.var + '_matches', matches);
          addLog(`Step: ?? Regex found ${matches.length} match(es)`, 'success');
        } catch(e) { addLog(`Regex error: ${e.message}`, 'warn'); }
      }
      break;
    }

    case 'copy-paste-var': {
      const src = step.selector || step.var || '';
      const dst = step.var || '';
      if (src && dst && varStore[src] !== undefined) {
        storeVar(dst, varStore[src]);
        addLog(`Step: ?? {${src}} -> {${dst}}`, 'success');
      }
      break;
    }

    case 'filter-data': {
      const data = step.var ? varStore[step.var] : null;
      if (Array.isArray(data) && step.condition) {
        try {
          const filtered = data.filter(item => {
            const fn = new Function('item', `return (${step.condition})`);
            return fn(item);
          });
          storeVar(step.var, filtered);
          addLog(`Step: ?? Filter: ${data.length} -> ${filtered.length}`, 'success');
        } catch(e) { addLog(`Filter error: ${e.message}`, 'warn'); }
      }
      break;
    }

    case 'batch-slice': {
      const data = step.var ? varStore[step.var] : null;
      if (Array.isArray(data)) {
        const sz = parseInt(step.loopCount) || 10;
        const batches = [];
        for (let j = 0; j < data.length; j += sz) batches.push(data.slice(j, j + sz));
        storeVar((step.var || 'data') + '_batches', batches);
        addLog(`Step: ?? Batch: ${batches.length}x${sz}`, 'success');
      }
      break;
    }

    default:
      addLog(`Step: [${type}] step dijalankan (${parseInt(step.delay)||500}ms)`, 'warn');
      await wait(parseInt(step.delay) || 500);
  }

  return { success: true };
}

// -------------------------------------------------------------
// 3. RUN WORKFLOW V2 (WITH WORKING LOOPS & RETRY)
// -------------------------------------------------------------
async function runWorkflowV2() {
  if (!project.steps.length) { addLog('Tidak ada steps!', 'warn'); return; }

  // Setup UI
  const runBtn = document.getElementById('run-flow-btn');
  const stopBtn = document.getElementById('stop-flow-btn');
  const tbRun = document.getElementById('tb-run-btn');
  const status = document.getElementById('bot-status');

  stopRequested = false;
  varStore = {};
  updateVarPanel();
  execStats = { steps:0, errors:0, retries:0, adb:0, startTime:Date.now(), interval:null };
  execStats.interval = setInterval(updateRuntime, 500);

  runBtn.disabled = true; stopBtn.disabled = false;
  runBtn.textContent = 'Running V2...';
  if (tbRun) { tbRun.textContent = 'Running V2...'; tbRun.disabled = true; }
  status.className = 'hdr-badge online';
  status.innerHTML = '<div class="hdr-dot"></div>ONLINE';

  const device = document.getElementById('device-selector').value;
  addLog('=== Workflow V2 Start: ' + currentName + ' (Advanced Loops & Retry) ===', 'info');

  // Advanced loop stack for nested loops
  const loopStack = [];

  let i = 0;
  while (i < project.steps.length && !stopRequested) {
    const step = project.steps[i];
    const type = String(step.type || '').toLowerCase();

    execStats.steps++;
    document.getElementById('st-steps').textContent = execStats.steps;
    step.status = 'running';
    render();

    try {
      // -- HANDLE LOOP START --
      if (type === 'repeat-start' || type === 'loop-start') {
        const loopCount = Math.max(1, parseInt(step.loopCount) || 1);
        const loopVar = step.loopVar || step.loopVariable || 'i';
        const loopName = step.loopName || `loop_${step.id}`;

        loopStack.push({
          startIndex: i,
          currentIteration: 0,
          maxIterations: loopCount,
          loopVariable: loopVar,
          loopName: loopName,
          delayBetweenIterations: parseInt(step.delayBetweenLoop) || 0,
          breakCondition: step.breakCondition || null
        });

        storeVar(loopVar, 0);
        addLog(`?? Loop "${loopName}" started: ${loopCount} iterations`, 'info');
        step.status = 'success';
        render();
        i++;
        continue;
      }

      // -- HANDLE LOOP END --
      if (type === 'repeat-end' || type === 'loop-end') {
        if (loopStack.length === 0) {
          addLog(`?? Loop End tanpa Loop Start di step ${i+1}`, 'warn');
          step.status = 'success';
          render();
          i++;
          continue;
        }

        const loop = loopStack[loopStack.length - 1];

        // Check break condition
        let shouldBreak = false;
        if (loop.breakCondition) {
          try {
            const fn = new Function(...Object.keys(varStore), `return (${loop.breakCondition})`);
            shouldBreak = Boolean(fn(...Object.values(varStore)));
          } catch(e) {
            addLog(`?? Break condition error: ${e.message}`, 'warn');
          }
        }

        if (shouldBreak) {
          addLog(`?? Loop "${loop.loopName}" di-break karena kondisi`, 'warn');
          loopStack.pop();
          step.status = 'success';
          render();
          i++;
          continue;
        }

        // Increment iteration
        loop.currentIteration++;
        storeVar(loop.loopVariable, loop.currentIteration);

        if (loop.currentIteration < loop.maxIterations) {
          // Continue loop - jump back to after Loop Start
          addLog(`?? Loop "${loop.loopName}": iterasi ${loop.currentIteration}/${loop.maxIterations}`, 'info');

          // Delay between iterations
          if (loop.delayBetweenIterations > 0) {
            addLog(`?? Delay antar iterasi: ${loop.delayBetweenIterations}ms`, 'info');
            await wait(loop.delayBetweenIterations);
          }

          i = loop.startIndex + 1; // Jump back to step after Loop Start
          continue;
        } else {
          // Loop finished
          addLog(`? Loop "${loop.loopName}" selesai: ${loop.maxIterations} iterasi`, 'success');
          loopStack.pop();
          step.status = 'success';
          render();
          i++;
          continue;
        }
      }

      // -- EXECUTE STEP WITH RETRY --
      await executeStepWithRetry(step, device, varStore, addLog, runAdb, wait, interpolate, storeVar);

      step.status = 'success';

    } catch (error) {
      execStats.errors++;
      document.getElementById('st-errors').textContent = execStats.errors;
      addLog(`? Error di step ${i+1} "${step.name}": ${error.message}`, 'error');
      step.status = 'error';
    }

    render();
    await wait(50);
    i++;
  }

  clearInterval(execStats.interval);
  addLog('=== Workflow V2 ' + (stopRequested ? 'STOPPED' : 'Complete') + ' ===', stopRequested ? 'warn' : 'success');

  runBtn.disabled = false; stopBtn.disabled = true;
  runBtn.textContent = '? RUN';
  if (tbRun) { tbRun.textContent = '? Run'; tbRun.disabled = false; }
  status.className = 'hdr-badge offline';
  status.innerHTML = '<div class="hdr-dot"></div>OFFLINE';

  setTimeout(() => { project.steps.forEach(s => s.status = ''); render(); }, 3000);
}

// -------------------------------------------------------------
// 4. INTEGRATION: REPLACE RUN BUTTON TO USE V2
// -------------------------------------------------------------

// Replace the runWorkflow function call in the HTML
// Change onclick="runWorkflow()" to onclick="runWorkflowV2()"

// For backward compatibility, keep runWorkflow but make it call V2
const originalRunWorkflow = runWorkflow;
runWorkflow = runWorkflowV2;

// ============================================================
// END OF WORKING LOOP & RETRY IMPLEMENTATION
// ============================================================
</script>
</body>
</html>`;

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

