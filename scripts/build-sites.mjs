// Finds each candidate's campaign/official website from their Wikipedia article (infobox "website" field, or an External links entry).
// Output: data/sites.json  { "<candidateKey>": "https://..." }   candidateKey = fecId || "Name|ST"
import { readJSON, writeJSON, DATA, CACHE } from './lib.mjs';
import fs from 'node:fs';

export const candKey = (c, state) => c.fecId || `${c.name}|${state}`;
const doc = readJSON(`${DATA}/races.json`);
const cands = [];
for (const r of Object.values(doc.races)) for (const c of r.candidates) if (c.wiki) cands.push({ c, state: r.state });
const titles = [...new Set(cands.map(x => x.c.wiki))];

const pickUrl = text => {
  const m = text.match(/\{\{\s*(?:URL|url|Official website|official URL)\s*\|\s*(?:1\s*=\s*)?([^|}\s]+)/) || text.match(/\[(https?:\/\/[^\s\]]+)/) || text.match(/(https?:\/\/[^\s|}\]]+)/);
  if (!m) return null;
  let u = m[1].trim(); if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  try { return new URL(u).href; } catch { return null; }
};
const BAD = /\.gov(\/|$)|\.mil(\/|$)|wikipedia|wikimedia|facebook\.com|twitter\.com|x\.com|instagram|youtube|ballotpedia|opensecrets|fec\.gov|votesmart|\.house\.gov|\.senate\.gov|congress\.gov/i;

const byTitle = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < titles.length; i += 20) {
  const batch = titles.slice(i, i + 20);
  const cacheFile = `${CACHE}/wikisite-${i}.json`;
  let j = readJSON(cacheFile, null);
  for (let attempt = 0; !j && attempt < 6; attempt++) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(batch.join('|'))}`;
    const res = await fetch(url, { headers: { 'user-agent': 'election-hub/0.1 (civic info project; rahamghassemi@gmail.com)' } });
    const text = await res.text();
    try { j = JSON.parse(text); writeJSON(cacheFile, j); } catch { await sleep(4000 * (attempt + 1)); }
  }
  if (!j) { console.warn('giving up on batch', i); continue; }
  const redir = new Map([...(j.query?.normalized || []), ...(j.query?.redirects || [])].map(x => [x.from, x.to]));
  const pages = new Map((j.query?.pages || []).map(p => [p.title, p.revisions?.[0]?.slots?.main?.content || '']));
  for (const t of batch) { let r = t; for (let k = 0; k < 3 && redir.has(r); k++) r = redir.get(r); byTitle.set(t, pages.get(r) || ''); }
  await sleep(1200);
}
const out = {};
for (const { c, state } of cands) {
  const wt = byTitle.get(c.wiki) || '';
  let url = null;
  const info = wt.match(/\|\s*website\s*=\s*([^\n]*(?:\n(?!\|)[^\n]*)?)/i);
  if (info) url = pickUrl(info[1]);
  if (!url) { const ext = wt.match(/\*\s*\[(https?:\/\/[^\s\]]+)\s+[^\]]*(?:campaign|official)[^\]]*\]/i); if (ext) url = pickUrl(ext[0]); }
  if (url && !BAD.test(url)) out[candKey(c, state)] = url;
}
writeJSON(`${DATA}/sites.json`, out);
console.log(`sites: ${Object.keys(out).length} of ${cands.length} candidates with a Wikipedia page`);
