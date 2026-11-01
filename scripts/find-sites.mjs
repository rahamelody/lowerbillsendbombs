// Finds campaign websites for candidates in the important races that have none on file, by trying the usual campaign-domain patterns
// and ACCEPTING A SITE ONLY IF THE PAGE CONFIRMS IT: it names the candidate (first + last), mentions their state, and reads like a campaign site.
// Output: data/sites-discovered.json  { "<fecId or Name|ST>": "https://..." }   (hand-verified entries in sites-manual.json always override)
import dns from 'node:dns/promises';
import { readJSON, writeJSON, normName, isBadSiteHost, DATA, STATES } from './lib.mjs';

const UA = 'election-hub/0.1 (non-commercial civic information project; contact rahamghassemi@gmail.com)';
const important = readJSON(`${DATA}/important-races.json`, {});
const { races } = readJSON(`${DATA}/races.json`);
const have = { ...readJSON(`${DATA}/sites.json`, {}), ...readJSON(`${DATA}/sites-discovered.json`, {}) };
for (const k of Object.keys(have)) if (isBadSiteHost(have[k])) delete have[k];   // a news/government page is not a campaign site
for (const [k, v] of Object.entries(readJSON(`${DATA}/sites-manual.json`, {}))) if (!k.startsWith('_') && v) have[k] = v;
const slug = s => normName(s).all.join('').replace(/[^a-z]/g, '');
const patterns = (c, st) => {
  const n = normName(c.name), f = n.first.replace(/[^a-z]/g, ''), l = n.lastTail.replace(/[^a-z]/g, ''), fl = f + l, S = STATES[st].toLowerCase().replace(/ /g, ''), s2 = st.toLowerCase();
  const office = races[Object.keys(races).find(k => races[k].candidates.includes(c))].type === 'senate' ? ['forsenate', '4senate'] : ['forcongress', '4congress'];
  const stems = [fl, l + office[0], fl + office[0], l + office[1], fl + office[1], 'vote' + fl, 'vote' + l, 'elect' + fl, 'elect' + l, 'team' + l, f + 'for' + s2, f + 'for' + S, l + 'for' + s2, l + 'for' + S, fl + '2026', l + '2026', l + 'forus', 'friendsof' + fl, f + l + 'forus', l + 'forall'];
  return [...new Set(stems)].flatMap(s => [`${s}.com`, `${s}.org`]).filter(d => d.length > 8);
};
async function ok(domain, c, st, race) {
  try { await dns.lookup(domain); } catch { return null; }
  let res;
  try { res = await fetch('https://' + domain + '/', { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(9000) }); if (!res.ok) return null; } catch { return null; }
  const html = (await res.text()).slice(0, 600000).toLowerCase().replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ');
  const n = normName(c.name), first = n.first.replace(/[^a-z]/g, ''), last = n.lastTail.replace(/[^a-z]/g, '');
  const count = w => html.split(w).length - 1;
  const names = count(last) >= 2 && count(first) >= 1;
  const place = html.includes(STATES[st].toLowerCase()) || new RegExp(`\\b${st.toLowerCase()}-?\\d*\\b`).test(html) || /district|congress|senate/.test(html);
  const campaign = /for congress|for senate|congress|u\.s\. senate|campaign|paid for by|donate|volunteer/.test(html);
  const junk = /domain (is )?for sale|buy this domain|parked|this site can.t be reached|coming soon\s*$/.test(html.slice(0, 3000));
  return names && place && campaign && !junk ? res.url.replace(/\/$/, '/') : null;
}
const targets = [];
for (const key of Object.keys(important)) for (const c of races[key]?.candidates.filter(c => c.featured && !c.bioguide) || []) { const k = c.fecId || `${c.name}|${races[key].state}`; if (!have[k]) targets.push({ k, c, st: races[key].state, race: key }); }
console.log(`looking for campaign sites for ${targets.length} candidates in important races`);
const found = readJSON(`${DATA}/sites-discovered.json`, {});
let i = 0, hits = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < targets.length) {
    const t = targets[i++];
    for (const d of patterns(t.c, t.st)) { const u = await ok(d, t.c, t.st, t.race); if (u) { found[t.k] = u; hits++; console.log(`  ${t.c.name} (${t.race}) -> ${u}`); break; } }
  }
}));
writeJSON(`${DATA}/sites-discovered.json`, found);
console.log(`found ${hits} of ${targets.length}`);
