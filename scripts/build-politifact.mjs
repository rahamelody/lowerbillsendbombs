// PolitiFact fact-checks of a candidate's own claims, for the four topics, where PolitiFact has a personality page for them.
//   politifact.com/personalities/<name>/ lists "stated on <date> in <venue>: <claim>" with PolitiFact's rating and a link to the fact-check.
// Notes on what this is and isn't:
//   - The claim line is PolitiFact's own summary of what was said (only the parts in quotation marks are the candidate's exact words),
//     so it is shown as "a claim PolitiFact checked", never under "in their own words", and never used to label a stance.
//   - robots.txt asks for a 10 second delay between requests; this script waits that long. Only first-page statements by the candidate are read.
//   node scripts/build-politifact.mjs            candidates in the important races that are thin on our topics
//   ONLY="Ken Paxton" node scripts/build-politifact.mjs
import { readJSON, writeJSON, namesMatch, DATA } from './lib.mjs';

const UA = 'election-hub/0.1 (civic info project; contact rahamghassemi@gmail.com)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TOPICS = {
  health: /\b(medicare for all|single[- ]payer|medicaid|medicare|health ?care|health insurance|affordable care act|obamacare|prescription drugs?|insulin|public option|abortion coverage|hospitals?)\b/i,
  housing: /\b(housing|rents?|renters?|tenants?|landlords?|mortgages?|homeless\w*|evictions?|homeownership|home prices?)\b/i,
  iran: /\biran(?:ian)?\b/i,
  israel: /\b(israel\w*|gaza|palestin\w*|hamas|netanyahu|west bank|aipac)\b/i,
};
const decode = s => s.replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&#8217;|&rsquo;|&#039;|&apos;/g, '’').replace(/&#8216;|&lsquo;/g, '‘').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const slugs = name => {
  const base = name.replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, '').replace(/["'’.]/g, '').trim().toLowerCase().split(/\s+/);
  const full = base.join('-'), fl = base.length > 2 ? `${base[0]}-${base.at(-1)}` : null;
  return [...new Set([full, fl].filter(Boolean))];
};
async function page(url) {
  try { const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(25000) }); return r.ok ? await r.text() : null; } catch { return null; }
}
function statements(html, person) {
  const out = [];
  for (const it of html.split('<div class="pf-post-list-item').slice(1)) {
    const who = decode((it.match(/class="pf-statement-person"[^>]*>(.*?)<\/a>/s) || [])[1] || '');
    if (!who || !namesMatch(who, person)) continue;   // statements BY this person only, not fact-checks about them
    const when = decode((it.match(/class="pf-statement-date">(.*?)<\/span>/s) || [])[1] || '');
    const quote = (it.match(/class="pf-statement-quote[^"]*"[\s\S]*?>([\s\S]*?)<\/a>/) || [])[1];
    const url = (it.match(/href="(https?:\/\/(?:www\.)?politifact\.com\/factchecks\/[^"]+)"/) || [])[1];
    const rating = decode((it.match(/meter-[a-z-]+\.jpg" alt="([^"]+)"/) || [])[1] || '');
    const published = decode((it.match(/<span class="text-secondary fw-light">([\s\S]*?)<\/span>/) || [])[1] || '');
    if (!quote || !url) continue;
    out.push({ text: decode(quote), said: when.replace(/^stated on\s*/i, '').replace(/:$/, ''), url, rating, published });
  }
  return out;
}

const { races } = readJSON(`${DATA}/races.json`);
const imp = readJSON(`${DATA}/important-races.json`);
const keys = (imp.races || imp).map?.(r => r.key || r) ?? Object.keys(imp);
const quotes = readJSON(`${DATA}/site-quotes.json`, { entries: {} }).entries, stm = readJSON(`${DATA}/statements.json`, { entries: {} }).entries;
const covered = key => ['iran', 'israel', 'health', 'housing'].filter(t => quotes[key]?.[t]?.quotes?.length || stm[key]?.[t]?.quotes?.length).length;
const cands = [];
for (const k of keys) for (const c of races[k]?.candidates || []) {
  if (c.featured === false || c.bioguide) continue;   // sitting members already have votes
  const key = c.fecId || `${c.name}|${races[k].state}`;
  if (process.env.ONLY ? c.name === process.env.ONLY : covered(key) < 3) cands.push({ key, name: c.name, state: races[k].state });
}
const seen = new Set(); const todo = cands.filter(c => !seen.has(c.key) && seen.add(c.key));
console.log(`${todo.length} candidates to look up (about ${Math.round(todo.length * 15 / 60)} minutes at PolitiFact's requested pace)`);

const result = {}; let found = 0;
for (const c of todo) {
  let html = null, slug = null;
  for (const s of slugs(c.name)) { await sleep(10500); html = await page(`https://www.politifact.com/personalities/${s}/`); if (html) { slug = s; break; } }
  if (!html) continue;
  const all = statements(html, c.name), hits = {};
  for (const st of all) for (const [t, re] of Object.entries(TOPICS)) if (re.test(st.text)) (hits[t] ||= []).push(st);
  console.log(`${c.name}: ${all.length} claims on the page, topic hits: ${Object.entries(hits).map(([t, v]) => t + ' ' + v.length).join(', ') || 'none'}`);
  if (Object.keys(hits).length) { result[c.key] = { name: c.name, profile: `https://www.politifact.com/personalities/${slug}/`, ...Object.fromEntries(Object.entries(hits).map(([t, v]) => [t, v.slice(0, 3)])) }; found++; }
}
if (!process.env.ONLY) writeJSON(`${DATA}/politifact.json`, { generated: new Date().toISOString(), entries: result });
else console.log(JSON.stringify(result, null, 1));
console.log(`${found} candidates with fact-checked claims on our topics`);
