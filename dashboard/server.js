import { createServer } from 'node:http';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.DASHBOARD_PORT ?? 4020);
const WORKSPACE = process.env.WORKSPACE ?? '/workspace';
const STATE_FILE = path.join(WORKSPACE, '.agent/state.json');
const GOALS_FILE = path.join(WORKSPACE, 'GOALS.md');
const MEMORY_FILE = path.join(WORKSPACE, 'MEMORY.md');
const PAUSED_FILE = path.join(WORKSPACE, '.agent/PAUSED');
const LAST_TICK_LOG = path.join(WORKSPACE, '.agent/last-tick.log');
const INTERVAL_FILE = path.join(WORKSPACE, '.agent/INTERVAL');
const MODEL_FILE = path.join(WORKSPACE, '.agent/MODEL');
const EFFORT_FILE = path.join(WORKSPACE, '.agent/EFFORT');

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

// Parse goals from GOALS.md
function parseGoals(md) {
  const re =
    /^\|\s*(G-\d+)\s*\|\s*(P[012])\s*\|\s*(open|in_progress|done|blocked)\s*\|\s*(\d+)m\s*\|\s*([^|]+?)\s*\|/;
  return md
    .split('\n')
    .filter((l) => re.test(l))
    .map((l) => {
      const m = l.match(re);
      return { id: m[1], priority: m[2], status: m[3], estimate: `${m[4]}m`, title: m[5].trim() };
    });
}

// SSE: stream state changes in real-time
const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch {
      sseClients.delete(res);
    }
  }
}

// Watch state.json for changes and broadcast
let lastStateJson = '';
setInterval(async () => {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    if (raw !== lastStateJson) {
      lastStateJson = raw;
      broadcast('state', JSON.parse(raw));
    }
  } catch {
    /* file may not exist yet */
  }
}, 2000);

// Watch goals for changes
let lastGoalsMd = '';
setInterval(async () => {
  try {
    const raw = await readFile(GOALS_FILE, 'utf8');
    if (raw !== lastGoalsMd) {
      lastGoalsMd = raw;
      broadcast('goals', parseGoals(raw));
    }
  } catch {
    /* */
  }
}, 3000);

// Check pause state
setInterval(async () => {
  const paused = existsSync(PAUSED_FILE);
  broadcast('pause', { paused });
}, 5000);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  if (method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve the dashboard HTML
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = await readFile(path.join(import.meta.dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // SSE endpoint
  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`event: connected\ndata: {}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));

    // Send initial state
    const state = await readJson(STATE_FILE);
    if (state) res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    const goalsMd = await readText(GOALS_FILE);
    if (goalsMd) res.write(`event: goals\ndata: ${JSON.stringify(parseGoals(goalsMd))}\n\n`);
    res.write(`event: pause\ndata: ${JSON.stringify({ paused: existsSync(PAUSED_FILE) })}\n\n`);
    return;
  }

  // GET /api/state
  if (url.pathname === '/api/state' && method === 'GET') {
    return json(res, (await readJson(STATE_FILE)) ?? {});
  }

  // GET /api/goals
  if (url.pathname === '/api/goals' && method === 'GET') {
    const md = await readText(GOALS_FILE);
    return json(res, parseGoals(md));
  }

  // POST /api/goals — add a new goal
  if (url.pathname === '/api/goals' && method === 'POST') {
    const { priority, estimate, title } = await body(req);
    const md = await readText(GOALS_FILE);
    const ids = md.match(/G-(\d+)/g)?.map((g) => Number(g.slice(2))) ?? [0];
    const nextId = Math.max(...ids) + 1;
    const row = `| G-${String(nextId).padStart(3, '0')} | ${priority} | open | ${estimate} | ${title} |`;
    const lines = md.split('\n');
    const activeIdx = lines.findIndex((l) => l.trim() === '## Active');
    let insertAt = activeIdx + 1;
    for (let i = activeIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith('##')) break;
      if (/^\|\s*G-\d+/.test(lines[i])) insertAt = i + 1;
    }
    lines.splice(insertAt, 0, row);
    await writeFile(GOALS_FILE, lines.join('\n'), 'utf8');
    return json(res, { id: `G-${String(nextId).padStart(3, '0')}`, status: 'added' }, 201);
  }

  // POST /api/pause — pause the autopilot
  if (url.pathname === '/api/pause' && method === 'POST') {
    await writeFile(
      PAUSED_FILE,
      `manual pause via dashboard at ${new Date().toISOString()}\n`,
      'utf8',
    );
    return json(res, { paused: true });
  }

  // POST /api/resume — resume the autopilot
  if (url.pathname === '/api/resume' && method === 'POST') {
    try {
      await unlink(PAUSED_FILE);
    } catch {
      /* may not exist */
    }
    return json(res, { paused: false });
  }

  // GET /api/logs — last tick log
  if (url.pathname === '/api/logs' && method === 'GET') {
    const log = await readText(LAST_TICK_LOG);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(log);
    return;
  }

  // GET /api/interval
  if (url.pathname === '/api/interval' && method === 'GET') {
    const val = (await readText(INTERVAL_FILE)).trim();
    return json(res, { minutes: val ? Number(val) : null });
  }

  // POST /api/interval — set tick interval
  if (url.pathname === '/api/interval' && method === 'POST') {
    const { minutes } = await body(req);
    const clamped = Math.max(5, Math.min(60, Number(minutes) || 10));
    await writeFile(INTERVAL_FILE, String(clamped), 'utf8');
    return json(res, { minutes: clamped });
  }

  // GET /api/model
  if (url.pathname === '/api/model' && method === 'GET') {
    const val = (await readText(MODEL_FILE)).trim();
    return json(res, { model: val || null });
  }

  // POST /api/model
  if (url.pathname === '/api/model' && method === 'POST') {
    const { model } = await body(req);
    const allowed = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
    if (!allowed.includes(model)) return json(res, { error: 'invalid model' }, 400);
    await writeFile(MODEL_FILE, model, 'utf8');
    return json(res, { model });
  }

  // GET /api/effort
  if (url.pathname === '/api/effort' && method === 'GET') {
    const val = (await readText(EFFORT_FILE)).trim();
    return json(res, { effort: val || 'max' });
  }

  // POST /api/effort
  if (url.pathname === '/api/effort' && method === 'POST') {
    const { effort } = await body(req);
    const allowed = ['low', 'high', 'max'];
    if (!allowed.includes(effort)) return json(res, { error: 'invalid effort' }, 400);
    await writeFile(EFFORT_FILE, effort, 'utf8');
    return json(res, { effort });
  }

  // GET /api/memory — recent journal entries
  if (url.pathname === '/api/memory' && method === 'GET') {
    const mem = await readText(MEMORY_FILE);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(mem);
    return;
  }

  // 404
  cors(res);
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dashboard] listening on http://localhost:${PORT}`);
});
