// Zero-dependency server: static files from ./public plus the JSON API (/api/search, /api/race, /api/person, /api/meta).
// It also refreshes the FEC money data itself once a day (see "daily refresh" below), then hot-reloads its in-memory data.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readJSON, DATA } from './scripts/lib.mjs';
import { load } from './lib/load.mjs';

const PORT = process.env.PORT || 3000;
const ROOT = import.meta.dirname;
const PUBLIC = path.join(ROOT, 'public');

let app = load();
// pick up edits to the data files (quotes, sites, bills...) without restarting: reload when any data file is newer than what we loaded
const dataStamp = () => Math.max(...fs.readdirSync(DATA).filter(f => f.endsWith('.json')).map(f => fs.statSync(path.join(DATA, f)).mtimeMs));
let loadedStamp = dataStamp();
const freshApp = () => { const s = dataStamp(); if (s > loadedStamp && !status.running) { try { app = load(); loadedStamp = s; console.log('[data] reloaded after a data file changed'); } catch (e) { console.error('[data] reload failed, keeping the old data:', e.message); } } return app; };

// ---------------------------------------------------------------- daily refresh
// Every day at REFRESH_HOUR (local time, default 5am) -- and once at startup if the data is over a day old -- the server runs:
//   refresh-live (newest FEC filings) -> build-money (merge) -> build-races (rebuild), then reloads itself.
// Turn it off with AUTO_REFRESH=0. If a run fails it tries again in an hour (up to 3 times) and keeps serving the old data meanwhile.
const status = { enabled: process.env.AUTO_REFRESH !== '0', running: false, lastOk: null, lastError: null, next: null };
const runStep = script => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [path.join(ROOT, 'scripts', script)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = ''; p.stdout.on('data', d => { tail = (tail + d).slice(-600); }); p.stderr.on('data', d => { tail = (tail + d).slice(-600); });
  p.on('close', code => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}: ${tail.trim().split('\n').pop()}`))));
});
async function refresh(reason, attempt = 1) {
  if (status.running) return;
  status.running = true;
  const t0 = Date.now();
  try {
    if (process.env.FEC_API_KEY || fs.existsSync(path.join(ROOT, '.env'))) await runStep('refresh-live.mjs').catch(e => console.warn('[refresh] live feed skipped:', e.message));   // no key / API down: still rebuild from the bulk files
    await runStep('build-money.mjs');
    await runStep('build-races.mjs');
    app = load();
    status.lastOk = new Date().toISOString(); status.lastError = null;
    console.log(`[refresh] ${reason}: ok in ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    status.lastError = e.message; console.error(`[refresh] ${reason}: FAILED (attempt ${attempt}) ${e.message}`);
    if (attempt < 3) setTimeout(() => refresh(reason, attempt + 1), 60 * 60 * 1000);
  } finally { status.running = false; }
}
function scheduleNext() {
  const hour = Number(process.env.REFRESH_HOUR ?? 5), now = new Date(), at = new Date(now);
  at.setHours(hour, 0, 0, 0); if (at <= now) at.setDate(at.getDate() + 1);
  status.next = at.toISOString();
  setTimeout(async () => { await refresh('daily'); scheduleNext(); }, at - now).unref?.();
}
if (status.enabled) {
  const age = Date.now() - fs.statSync(path.join(DATA, 'races.json')).mtimeMs;
  if (age > 24 * 36e5) setTimeout(() => refresh('startup (data over 24h old)'), 5000);
  scheduleNext();
  console.log(`[refresh] daily at ${String(process.env.REFRESH_HOUR ?? 5).padStart(2, '0')}:00 local time; next run ${status.next}`);
}

// ---------------------------------------------------------------- http
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const a = freshApp();   // one consistent snapshot per request, even if a refresh swaps `app` mid-flight
  if (p === '/api/search' || p === '/api/lookup') {
    const result = await a.search(url.searchParams.get('q') ?? url.searchParams.get('address'));
    return send(res, 200, { ...result, meta: a.meta });
  }
  if (p === '/api/featured') {   // the home-page portraits: a random handful of the candidates this project endorses (data/endorsed.json, hand-editable)
    const ids = new Set((readJSON(`${DATA}/endorsed.json`, { endorsed: [] }).endorsed || []).map(e => e.id));
    const seen = new Set(), pool = [];
    for (const c of [...Object.values(a.races).flatMap(r => r.candidates), ...a.offBallot]) {
      const id = c.bioguide || c.fecId || c.name;
      if (!ids.has(id) || !c.photo || seen.has(id)) continue;
      // guard: show only people whose CURRENT record is aligned or partially aligned everywhere we have one, and who took no AIPAC-linked money
      const rec = a.enrichCandidate(c).record;
      const tiers = ['health', 'housing', 'iran', 'israel'].map(t => rec[t].badge?.tier).filter(Boolean);
      if (!tiers.length || !tiers.every(t => t === 'full' || t === 'partial') || rec.money.tier === 'against') continue;
      seen.add(id); pool.push(c);
    }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return send(res, 200, { tiles: pool.slice(0, 8).map(c => ({ photo: c.photo, name: c.name })) });
  }
  if (p === '/api/locate') {   // device location -> ballot; coordinates are used for one Census lookup and not stored or logged
    const result = await a.locate(url.searchParams.get('lat'), url.searchParams.get('lon'));
    return send(res, 200, { ...result, meta: a.meta });
  }
  if (p === '/api/bills') return send(res, 200, a.bills());   // sponsors + cosponsors of the tracked bills
  if (p === '/api/suggest') return send(res, 200, { suggestions: a.suggest(url.searchParams.get('q')) });
  if (p === '/api/race') {   // /api/race?key=MI-S
    const r = a.races[url.searchParams.get('key')];
    return r ? send(res, 200, a.enrich(r)) : send(res, 404, { error: 'unknown race' });
  }
  if (p === '/api/person') { // sitting members who aren't on the 2026 ballot: /api/person?bioguide=S000148
    const person = a.offBallot.find(x => x.bioguide === url.searchParams.get('bioguide'));
    return person ? send(res, 200, a.enrichCandidate(person)) : send(res, 404, { error: 'unknown person' });
  }
  if (p === '/api/meta') return send(res, 200, { ...a.meta, committees: a.committees, keyVotes: a.keyVotes.map(v => ({ ...v, ...(a.tally[v.id] || {}) })), refresh: status });
  const file = path.join(PUBLIC, p === '/' ? 'index.html' : p === '/bills' ? 'bills.html' : p);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, () => console.log(`Lower my Bills, End the Bombs on http://localhost:${PORT}`));
