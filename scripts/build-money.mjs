// Builds data/money.json from FEC bulk files:
//   * direct contributions from the AIPAC PAC (C00797670)               -> pas2 (committee-to-candidate) files
//   * independent expenditures by United Democracy Project (C00799031)   -> independent_expenditure_YYYY.csv
// Keyed by FEC candidate id; values are per-cycle dollar totals. Tracked committees are listed in data/committees.json.
import { download, unzip, csvObjects, readJSON, writeJSON, DATA, CACHE } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const committees = readJSON(`${DATA}/committees.json`);
const direct = new Set(committees.filter(c => c.kind === 'direct').map(c => c.id));
const ie = new Set(committees.filter(c => c.kind === 'independent').map(c => c.id));
const cycles = [2022, 2024, 2026];
const money = {};
const conduits = {};          // committee id -> { name, received }  (groups UDP/AIPAC PAC transferred money to, per FEC 24K transfers)
let filingsThrough = '';   // newest filing receipt date in the FEC independent-expenditure files (YYYY-MM-DD)
const bulkFiles = new Set();   // FEC filing numbers already present in the bulk files
const ieRows = [];            // every IE row, so conduit spending can be attributed after the transfers are known
const slot = (cand, key, cycle) => ((money[cand] ||= {})[key] ||= {})[cycle] = (money[cand]?.[key]?.[cycle] || 0);
const add = (cand, key, cycle, amt) => { slot(cand, key, cycle); money[cand][key][cycle] += amt; };

for (const cy of cycles) {
  const yy = String(cy).slice(2);
  // direct contributions (pas2). Columns: CMTE_ID|AMNDT|RPT_TP|PGI|IMAGE|TRAN_TP|ENTITY|NAME|CITY|ST|ZIP|EMP|OCC|DATE|AMT|OTHER_ID|CAND_ID|TRAN_ID|FILE|MEMO_CD|MEMO_TXT|SUB_ID
  const zip = await download(`https://www.fec.gov/files/bulk-downloads/${cy}/pas2${yy}.zip`, `pas2${yy}.zip`, 12);
  const dir = path.join(CACHE, `pas2${yy}`); unzip(zip, dir);
  const seen = new Set();
  for (const line of fs.readFileSync(path.join(dir, 'itpas2.txt'), 'utf8').split('\n')) {
    if (!line.startsWith('C')) continue;
    const f = line.split('|');
    if (!direct.has(f[0]) || !f[16] || f[19] === 'X') continue;
    if (!['24K', '24Z', '24C', '22Z'].includes(f[5])) continue;
    const key = f[21] || f[17]; if (seen.has(key)) continue; seen.add(key);
    add(f[16], 'direct', cy, (f[5] === '22Z' ? -1 : 1) * Number(f[14]));
  }
  // independent expenditures
  const csv = await download(`https://www.fec.gov/files/bulk-downloads/${cy}/independent_expenditure_${cy}.csv`, `ie${cy}.csv`, 12);
  const latest = new Map();   // dedupe amendments: keep one row per (committee, transaction id, report file)
  for (const r of csvObjects(fs.readFileSync(csv, 'utf8'))) {
    if (!ie.has(r.spe_id) || !r.cand_id) continue;
    latest.set(`${r.spe_id}|${r.tran_id}|${r.image_num}`, r);
  }
  const byTran = new Map();
  for (const r of latest.values()) { const k = `${r.spe_id}|${r.tran_id}`; const prev = byTran.get(k); if (!prev || Number(r.file_num) >= Number(prev.file_num)) byTran.set(k, r); }
  for (const r of byTran.values()) add(r.cand_id, r.sup_opp === 'S' ? 'ieSupport' : 'ieOppose', cy, Number(r.exp_amo) || 0);
  // latest version of every independent expenditure by any committee (an amended filing replaces the original), for conduit attribution below
  const latestAll = new Map();
  for (const r of csvObjects(fs.readFileSync(csv, 'utf8'))) { if (!r.cand_id) continue; const k = `${r.spe_id}|${r.tran_id}`, prev = latestAll.get(k); if (!prev || Number(r.file_num) >= Number(prev.file_num)) latestAll.set(k, r); }
  for (const r of latestAll.values()) { bulkFiles.add(String(r.file_num)); ieRows.push({ cy, ...r }); const m = (r.receipt_dat || '').match(/^(\d{2})-([A-Z]{3})-(\d{2})$/); if (m) { const mo = 'JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC'.indexOf(m[2]) / 3 + 1; const iso = `20${m[3]}-${String(mo).padStart(2, '0')}-${m[1]}`; if (iso > filingsThrough && iso <= new Date().toISOString().slice(0, 10)) filingsThrough = iso; } }
}
// ---- conduit groups: outside committees that UDP (AIPAC's super PAC) gave money to, 2026 cycle.
// What they spend on a candidate is NOT all AIPAC's money, so it's reported separately and labeled "groups funded by UDP".
// Sources: data/conduits-seed.json (derived from FEC's committee-to-committee transfer file) + data/conduits-live.json (refreshed daily from the OpenFEC API by scripts/refresh-live.mjs).
// Only super-PAC-to-committee gifts of $100k+ count. AIPAC PAC's small gifts go to candidate campaigns and party committees, which are not conduits.
for (const file of ['conduits-seed.json', 'conduits-live.json']) {
  for (const [id, c] of Object.entries(readJSON(`${DATA}/${file}`, {}))) if (!ie.has(id) && c.received >= 100000) conduits[id] = { name: c.name, received: Math.max(c.received, conduits[id]?.received || 0) };
}
const seen2 = new Set();
for (const r of ieRows) {
  if (!conduits[r.spe_id]) continue;
  const key = `${r.spe_id}|${r.tran_id}|${r.cy}`; if (seen2.has(key)) continue; seen2.add(key);
  add(r.cand_id, r.sup_opp === 'S' ? 'conduitSupport' : 'conduitOppose', r.cy, Number(r.exp_amo) || 0);
}

// ---- live layer: raw e-filings (scripts/refresh-live.mjs) that are newer than the bulk files. Whole filings already in the bulk data are skipped, so nothing double counts.
const live = readJSON(`${DATA}/live-ie.json`, null);
let liveAdded = 0;
if (live) {
  const seenLive = new Set();
  for (const r of live.rows || []) {
    if (bulkFiles.has(String(r.file_number)) || !/^2026-/.test(r.dissem || '')) continue;      // bogus future dates (typos in filings) are ignored too
    const key = `${r.spe_id}|${r.tran_id}`; if (seenLive.has(key)) continue; seenLive.add(key);
    const kind = r.spe_id === 'C00799031' ? (r.sup_opp === 'S' ? 'ieSupport' : 'ieOppose') : (r.sup_opp === 'S' ? 'conduitSupport' : 'conduitOppose');
    add(r.cand_id, kind, 2026, r.amount); liveAdded++;
  }
}
console.log(`live e-filing lines merged: ${liveAdded}${live ? ' (feed checked ' + live.fetchedAt.slice(0, 16).replace('T', ' ') + ' UTC)' : ' (no live feed yet; run scripts/refresh-live.mjs)'}`);
writeJSON(`${DATA}/conduits.json`, conduits);
writeJSON(`${DATA}/money.json`, { generated: new Date().toISOString(), filingsThrough, liveCheckedAt: live?.fetchedAt || null, cycles, money });
const n = Object.keys(money).length;
const tot = k => Object.values(money).reduce((s, m) => s + Object.values(m[k] || {}).reduce((a, b) => a + b, 0), 0);
console.log(`money: ${n} candidates; direct $${tot('direct').toLocaleString()}; IE support $${tot('ieSupport').toLocaleString()}; IE oppose $${tot('ieOppose').toLocaleString()}`);
