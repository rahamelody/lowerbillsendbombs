// Pulls the newest FEC filings straight from OpenFEC's raw e-filing endpoints (hours old, not days) for the committees this guide tracks,
// and saves them to data/live-ie.json. scripts/build-money.mjs merges them in, skipping any filing already present in the bulk files.
//   node scripts/refresh-live.mjs        (needs FEC_API_KEY in .env; free from https://api.data.gov/signup/)
// What this CAN'T show: transfers between committees made since a committee's last periodic report are not public until its next report.
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, writeJSON, DATA } from './lib.mjs';

// minimal .env loader (no dependency); the key is only ever sent to api.open.fec.gov
const envFile = path.join(import.meta.dirname, '..', '.env');
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const KEY = process.env.FEC_API_KEY;
if (!KEY) { console.error('No FEC_API_KEY. Add it to .env (free: https://api.data.gov/signup/).'); process.exit(1); }

const UDP = 'C00799031';
const { filingsThrough } = readJSON(`${DATA}/money.json`, {});
// start a few days before the bulk data's newest filing, so nothing slips between the two sources
const since = new Date(new Date((filingsThrough || '2026-10-01') + 'T12:00:00').getTime() - 4 * 864e5).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;

async function pages(endpoint, params) {
  const out = []; let last = {};
  for (let i = 0; i < 12; i++) {
    const q = new URLSearchParams({ api_key: KEY, per_page: '100', ...params, ...last });
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(`https://api.open.fec.gov/v1/${endpoint}/?${q}`); calls++;
      if (res.status !== 429) break;
      console.warn('rate limited; waiting 60s'); await sleep(60000);
    }
    if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
    const j = await res.json();
    out.push(...(j.results || []));
    const li = j.pagination?.last_indexes;
    if (!li || !(j.results || []).length || (j.results || []).length < 100) break;
    last = Object.fromEntries(Object.entries(li).map(([k, v]) => [k === 'last_index' ? 'last_index' : k, v]));
    await sleep(400);
  }
  return out;
}

// 0) which committees did UDP give $100k+ to? (processed schedule B carries the recipient committee id)
const live0 = {};
for (const r of await pages('schedules/schedule_b', { committee_id: UDP, two_year_transaction_period: '2026', min_amount: '100000', disbursement_purpose_category: 'CONTRIBUTIONS', sort: '-disbursement_date' })) {
  const id = r.recipient_committee_id; if (!id || id === UDP) continue;
  (live0[id] ||= { name: r.recipient_name, received: 0 }).received += Number(r.disbursement_amount) || 0;
}
writeJSON(`${DATA}/conduits-live.json`, live0);
const conduits = [...new Set([...Object.keys(readJSON(`${DATA}/conduits-seed.json`, {})), ...Object.keys(live0)])];

// 1) independent expenditures (24/48-hour reports + schedule E on periodic reports) by UDP and the groups it funds
const rows = [];
for (const cid of [UDP, ...conduits]) {
  const items = await pages('schedules/schedule_e/efile', { committee_id: cid, min_dissemination_date: since, sort: '-expenditure_amount', most_recent: 'true' });
  for (const r of items) {
    if (!r.candidate_id || !r.support_oppose_indicator) continue;
    rows.push({ spe_id: cid, cand_id: r.candidate_id, sup_opp: r.support_oppose_indicator, amount: Number(r.expenditure_amount) || 0, dissem: r.dissemination_date, file_number: r.file_number, tran_id: r.transaction_id });
  }
  await sleep(400);
}

// 2) UDP's own large disbursements since `since` (newly disclosed transfers to other committees would show up here)
const transfers = (await pages('schedules/schedule_b/efile', { committee_id: UDP, min_disbursement_date: since, min_amount: '100000', sort: '-disbursement_date' }))
  .map(r => ({ date: r.disbursement_date, amount: r.disbursement_amount, to: r.recipient_name, purpose: r.disbursement_description, file_number: r.file_number }))
  .filter(t => t.date && t.date >= since && !/AMERICAN ISRAEL PUBLIC AFFAIRS/i.test(t.to || ''));   // monthly payroll reimbursement, not a political transfer

writeJSON(`${DATA}/live-ie.json`, { fetchedAt: new Date().toISOString(), since, rows, transfers });
console.log(`live: ${rows.length} independent-expenditure lines since ${since} from ${1 + conduits.length} committees (${calls} API calls)`);
console.log(transfers.length ? `UDP transfers disclosed since ${since}:\n` + transfers.map(t => `  ${t.date}  $${Number(t.amount).toLocaleString()}  ${t.to}`).join('\n') : `No new large UDP transfers disclosed since ${since}.`);
