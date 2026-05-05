const { exec } = require('child_process');

let isRunning = false;
let currentSender = null;
let adbExecutor = null;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function sendLog(sender, type, message) {
  if (!sender) return;
  sender.send('flow-log', { timestamp: Date.now(), type, message });
}

function defaultAdbExecutor(args, device, cb) {
  const bin = 'adb';
  const dFlag = device ? `-s "${device}"` : '';
  const cmd = `${bin} ${dFlag} ${args}`;
  exec(cmd, { timeout: 30000, maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
    cb({ success: !err, output: stdout || '', error: err?.message || stderr || '' });
  });
}

function setAdbExecutor(fn) {
  adbExecutor = fn;
}

function getAdbExecutor() {
  return adbExecutor || defaultAdbExecutor;
}

function buildGraph(nodes, edges) {
  const nodeMap = {};
  const edgeMap = {};

  (nodes || []).forEach(node => {
    nodeMap[node.id] = node;
  });

  (edges || []).forEach(edge => {
    const source = edge.source || edge.from;
    const target = edge.target || edge.to;
    if (!source || !target) return;
    if (!edgeMap[source]) edgeMap[source] = [];
    edgeMap[source].push(target);
  });

  return { nodeMap, edgeMap };
}

function getNextNode(edgeMap, id) {
  return edgeMap[id]?.[0] || null;
}

async function adbExec(device, command) {
  return new Promise(resolve => {
    const execFn = getAdbExecutor();
    execFn(command, device, resolve);
  });
}

function normalizeNumber(value) {
  const num = parseInt(value);
  return Number.isNaN(num) ? 0 : num;
}

async function executeNode(node, sender, device) {
  if (!isRunning) return;

  const type = String(node.type || node.data?.type || '').toLowerCase();
  const data = node.data || {};

  const tapX = data.x ?? data.cx ?? data.mx;
  const tapY = data.y ?? data.cy ?? data.my;
  const swipeX1 = data.x1 ?? data.sx;
  const swipeY1 = data.y1 ?? data.sy;
  const swipeX2 = data.x2 ?? data.ex;
  const swipeY2 = data.y2 ?? data.ey;
  const duration = normalizeNumber(data.duration || data.delay || data.dur);
  const keycode = data.keycode || data.keyCode || data.key;

  if (type === 'delay') {
    const ms = duration || 0;
    sendLog(sender, 'info', `Delay ${ms}ms`);
    await delay(ms);
    return;
  }

  if (type === 'tap' || type === 'mobile-tap' || type === 'click') {
    if (tapX == null || tapY == null) {
      sendLog(sender, 'warn', 'Tap node missing coordinates');
      return;
    }
    const result = await adbExec(device, `shell input tap ${tapX} ${tapY}`);
    if (!result.success) {
      sendLog(sender, 'error', `ADB tap failed: ${result.error}`);
      return;
    }
    sendLog(sender, 'success', `Tap ${tapX},${tapY}`);
    return;
  }

  if (type === 'swipe' || type === 'mobile-swipe') {
    if (swipeX1 == null || swipeY1 == null || swipeX2 == null || swipeY2 == null) {
      sendLog(sender, 'warn', 'Swipe node missing coordinates');
      return;
    }
    const result = await adbExec(device, `shell input swipe ${swipeX1} ${swipeY1} ${swipeX2} ${swipeY2} ${duration || 300}`);
    if (!result.success) {
      sendLog(sender, 'error', `ADB swipe failed: ${result.error}`);
      return;
    }
    sendLog(sender, 'success', `Swipe ${swipeX1},${swipeY1} -> ${swipeX2},${swipeY2}`);
    return;
  }

  if (type === 'key' || type === 'mobile-press-key') {
    if (!keycode) {
      sendLog(sender, 'warn', 'Key node missing keycode');
      return;
    }
    const result = await adbExec(device, `shell input keyevent ${keycode}`);
    if (!result.success) {
      sendLog(sender, 'error', `ADB keyevent failed: ${result.error}`);
      return;
    }
    sendLog(sender, 'success', `Key event ${keycode}`);
    return;
  }

  sendLog(sender, 'info', `Skipped unsupported node type: ${type}`);
}

async function runFlow(flowData, sender) {
  if (isRunning) {
    sendLog(sender, 'warn', 'Flow already running');
    return;
  }

  if (!flowData || !Array.isArray(flowData.nodes) || flowData.nodes.length === 0) {
    sendLog(sender, 'error', 'Flow data must include at least one node');
    return;
  }

  isRunning = true;
  currentSender = sender;

  const { nodeMap, edgeMap } = buildGraph(flowData.nodes, flowData.edges || []);
  const startId = flowData.nodes[0].id;
  const device = flowData.device || '';
  const loopStack = [];

  sendLog(sender, 'info', `Flow started: ${flowData.name || 'unnamed'}`);

  let currentId = startId;
  while (currentId && isRunning) {
    const node = nodeMap[currentId];
    if (!node) {
      sendLog(sender, 'warn', `Missing node: ${currentId}`);
      break;
    }

    const type = String(node.type || node.data?.type || '').toLowerCase();
    if (type === 'repeat-start' || type === 'loop-start' || type === 'loop') {
      loopStack.push({
        startId: getNextNode(edgeMap, currentId),
        current: 0,
        max: Math.max(1, normalizeNumber(node.data?.repeat || node.data?.repeatCount || node.data?.loopCount))
      });
      sendLog(sender, 'info', `Loop started (${loopStack[loopStack.length - 1].max}x)`);
      currentId = getNextNode(edgeMap, currentId);
      continue;
    }

    if (type === 'repeat-end' || type === 'loop-end') {
      const loop = loopStack[loopStack.length - 1];
      if (loop && loop.current < loop.max - 1) {
        loop.current += 1;
        sendLog(sender, 'info', `Loop iteration ${loop.current + 1}/${loop.max}`);
        currentId = loop.startId;
        continue;
      }
      loopStack.pop();
      currentId = getNextNode(edgeMap, currentId);
      continue;
    }

    await executeNode(node, sender, node.data?.deviceId || device);
    currentId = getNextNode(edgeMap, currentId);
  }

  if (isRunning) {
    sendLog(sender, 'success', 'Flow complete');
    sender.send('flow-complete', { success: true });
  }

  isRunning = false;
  currentSender = null;
}

function stopFlow() {
  if (!isRunning) return;
  isRunning = false;
  if (currentSender) {
    sendLog(currentSender, 'warn', 'Flow stopped by user');
    currentSender.send('flow-complete', { success: false });
    currentSender = null;
  }
}

module.exports = { runFlow, stopFlow, setAdbExecutor };
