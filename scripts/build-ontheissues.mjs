// OnTheIssues.org collects dated, sourced excerpts of what candidates have said ("[Whatley OpEd]: Israel is one of America's closest allies...",
// each with its original source and date). For candidates with a page there, this pulls the Foreign Policy, War & Peace and Health Care excerpts
// into data/ontheissues.json so they can fill gaps on the cards. Each excerpt is kept verbatim and linked to the OnTheIssues page it came from.
//   node scripts/build-ontheissues.mjs                candidates shown by default who are thin on our topics
//   ONLY="Michael Whatley" node scripts/build-ontheissues.mjs
import { readJSON, writeJSON, DATA } from './lib.mjs';

const UA = 'election-hub/0.1 (civic info project; contact rahamghassemi@gmail.com)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = 'https://www.ontheissues.org';
const PAGES = ['Foreign_Policy', 'War_+_Peace', 'Health_Care'];   // the OnTheIssues topics that map to Israel / Iran / health
const T = {
  iran: /\biran(?:ian)?\b/i,
  israel: /\b(israel\w*|gaza|palestin\w*|hamas|netanyahu|west bank|aipac)\b/i,
  health: /\b(medicare|medicaid|single[- ]payer|health ?care|health insurance|affordable care act|obamacare|prescription drugs?|insulin|public option)\b/i,
};
const decode = s => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;|&rsquo;|&#8217;/g, '’').replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"').replace(/&mdash;|&#8212;/g, '—').replace(/[ \t\r\f]+/g, ' ');
async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(25000) }); if (!r.ok) return null;
    const buf = await r.arrayBuffer(), cs = (r.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1] || 'windows-1252';   // these pages are not UTF-8
    return new TextDecoder(/utf-?8/i.test(cs) ? 'utf-8' : 'windows-1252').decode(buf);
  } catch { return null; }
}

const slugs = name => {
  const b = name.replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, '').replace(/["'’.]/g, '').trim().split(/\s+/);
  return [...new Set([b.join('_'), b.length > 2 ? `${b[0]}_${b.at(-1)}` : null].filter(Boolean))];
};
/** one topic page -> [{ headline, text, source, date }] */
function entries(html) {
  const body = decode(html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')), lines = body.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const res = []; let cur = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^Source:/i.test(l)) {
      // the source line wraps: "Source: <publication>" then ", <date>" on the next line
      const next = lines[i + 1] || '', d = (l + ' ' + next).match(/,\s*((?:[A-Z][a-z]{2,8}\.? )?(?:\d{1,2},? )?\d{4})\s*$/)?.[1] || '';
      const text = cur.filter(x => x.length > 60).join(' ').trim();
      if (text) res.push({ headline: cur.find(x => x.length <= 120) || '', text, source: l.replace(/^Source:\s*/i, '').replace(/,\s*(?:[A-Z][a-z]{2,8}\.? )?(?:\d{1,2},? )?\d{4}\s*$/, '').replace(/,\s*$/, ''), date: d });
      cur = []; continue;
    }
    if (/^Click here|^Other candidates on|^Agree\?/i.test(l)) { cur = []; continue; }
    cur.push(l);
  }
  return res;
}
/** long excerpts: keep whole leading sentences up to ~420 characters (still verbatim, never cut mid-sentence) */
const lead = t => { if (t.length <= 420) return t; const parts = t.split(/(?<=[.!?]["”’]?)\s+/); let o = ''; for (const p of parts) { if ((o + ' ' + p).trim().length > 420 && o) break; o = (o + ' ' + p).trim(); } return o; };
/** only the candidate's OWN words: "[Whatley OpEd]: ..." or  Whatley said, "..."  -- never a spokesman's, an aide's, or OnTheIssues' own notes */
function ownWords(text, last) {
  const L = last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lab = text.match(new RegExp(`^\\[([^\\]]*\\b${L}\\b[^\\]]*)\\]:\\s*([\\s\\S]+)$`, 'i'));
  if (lab && !/spokes|aide|campaign|staff|press/i.test(lab[1])) return lab[2].trim();
  const said = text.match(new RegExp(`^[^"“]{0,60}\\b${L}\\b(?!['’]s)[^"“]{0,14}\\b(?:said|says|wrote|tweeted|told [^"“]{0,40}),?\\s*:?\\s*["“]([^"”]{40,}?)["”]`, 'i'));
  if (said && !/spokes|aide|campaign said/i.test(said[0].slice(0, said[0].indexOf(said[1])))) return said[1].trim();
  return null;
}

const { races } = readJSON(`${DATA}/races.json`);
const have = readJSON(`${DATA}/site-quotes.json`, { entries: {} }).entries, cur = readJSON(`${DATA}/statements.json`, { entries: {} }).entries;
const covered = k => ['iran', 'israel', 'health', 'housing'].filter(t => have[k]?.[t]?.quotes?.length || cur[k]?.[t]?.quotes?.length).length;
const imp = readJSON(`${DATA}/important-races.json`, {}), impKeys = new Set(((imp.races || imp).map?.(r => r.key || r)) ?? Object.keys(imp));
const todo = []; const seen = new Set();
for (const r of Object.values(races)) for (const c of r.candidates) {
  if (process.env.IMPORTANT === '1' && !impKeys.has(r.key)) continue;   // IMPORTANT=1: everyone in the important races, whether or not they are already covered
  if (c.bioguide || c.featured === false) continue;
  const key = c.fecId || `${c.name}|${r.state}`; if (seen.has(key)) continue; seen.add(key);
  if (process.env.ONLY ? c.name === process.env.ONLY : (process.env.IMPORTANT === '1' || covered(key) < 3)) todo.push({ key, name: c.name, senate: r.key.endsWith('-S') || /-S\d?$/.test(r.key) });
}
console.log(`${todo.length} candidates to look up`);
const result = {}; let found = 0, pages = 0;
for (const c of todo) {
  let main = null, slug = null;
  for (const s of slugs(c.name)) { for (const dir of c.senate ? ['Senate', 'House'] : ['House', 'Senate']) { await sleep(1200); main = await get(`${BASE}/${dir}/${s}.htm`); if (main && /pop_wide\('\.\.\//.test(main)) { slug = s; break; } main = null; } if (main) break; }
  if (!main) continue;
  const links = Object.fromEntries(PAGES.map(p => [p, (main.match(new RegExp(`pop_wide\\('\\.\\./([A-Za-z]+/${slug.replace(/[+]/g, '\\+')}_${p.replace(/[+]/g, '\\+')}\\.htm)'`)) || [])[1]]));
  const got = {};
  for (const p of PAGES) {
    if (!links[p]) continue;
    await sleep(1200); const html = await get(`${BASE}/${links[p]}`); pages++; if (!html) continue;
    for (const e of entries(html)) {
      const words = ownWords(e.text, c.name.replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, '').trim().split(/\s+/).at(-1)); if (!words) continue;
      e.text = lead(words);
      for (const [topic, re] of Object.entries(T)) {
        if (p === 'Health_Care' ? topic !== 'health' : topic === 'health') continue;
        if (re.test(e.text)) (got[topic] ||= []).push({ text: e.text, source: `${e.source} (via OnTheIssues)`, url: `${BASE}/${links[p]}`, date: e.date || 'undated', kind: 'news', headline: e.headline });
      }
    }
  }
  if (Object.keys(got).length) { result[c.key] = { name: c.name, ...got }; found++; console.log(`${c.name}: ${Object.entries(got).map(([t, v]) => t + ' ' + v.length).join(', ')}`); }
}
if (process.env.ONLY) console.log(JSON.stringify(result, null, 1).slice(0, 3000));
else writeJSON(`${DATA}/ontheissues.json`, { generated: new Date().toISOString(), entries: result });
console.log(`${found} candidates with excerpts (${pages} topic pages read)`);
