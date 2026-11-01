// Crawls candidates' own websites for sentences about Iran / Israel-Palestine and stores them VERBATIM with the page URL.
// No model is involved, so nothing can be paraphrased or invented: if a site doesn't say it, we don't show it.
// Polite: honors robots.txt "Disallow: /", identifies itself, small per-site page budget, delay between requests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJSON, writeJSON, isBadSiteHost, DATA } from './lib.mjs';
import { classify } from '../lib/stance.mjs';

const UA = 'election-hub/0.1 (civic information project; contact rahamghassemi@gmail.com)';
const sites = { ...readJSON(`${DATA}/sites.json`, {}), ...readJSON(`${DATA}/sites-discovered.json`, {}) };
for (const [k, v] of Object.entries(readJSON(`${DATA}/sites-manual.json`, {}))) { if (k.startsWith('_')) continue; if (v) sites[k] = v; else delete sites[k]; }
for (const k of Object.keys(sites)) if (isBadSiteHost(sites[k])) delete sites[k];
const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const IRAN = /\biran(?:ian)?s?\b/i;
const ISRAEL = /\b(?:israel\w*|gaza|palestin\w*|hamas|aipac|netanyahu|west bank)\b/i;
const STANCE = /\b(war|nuclear|oppos\w+|support\w*|strikes?|deal|sanction\w*|military|hostilit\w+|troops?|diplomacy|diplomatic|negotiat\w+|regime|escalat\w+|authoriz\w+|attack\w*|bomb\w*|ceasefire|embargo|aid|weapons|arms|genocide|settlements?|two-state|stand\w* with|allies|ally|alliance|security|peace|humanitarian|fund\w*|taxpayer|tax dollars|believe\w*|will)\b/i;
const LIST_MENTION = /\b(china|russia|north korea|cartels?)\b/i;   // "threats from China, Russia and Iran" is a passing mention, not a stance
const HEALTH = /\b(?:medicare for all|single[- ]payer|medicaid|health ?care|health insurance|medical debt|medical bills|affordable care act|obamacare|prescription drugs?|insulin|public option)\b/i;
const HOUSING = /\b(?:housing|rents?|renters?|tenants?|landlords?|mortgages?|zoning|homeless\w*|evictions?|homeownership)\b/i;
const STANCE_HEALTH = /\b(debt|bankrupt\w*|medicare for all|single[- ]payer|expand\w*|protect\w*|cut\w*|lower\w*|reduc\w+|cost\w*|afford\w*|guarantee\w*|universal|premiums?|coverage|gut\w*|price\w*|insurance compan\w+|deny\w*|oppos\w+|fight\w*)\b/i;
const STANCE_HOUSING = /\b(afford\w*|rents?|rent control|stabiliz\w+|tenant\w*|renter\w*|landlords?|corporate|wall street|build\w*|expand\w*|protect\w*|cap|ban|lower\w*|reduc\w+|cost\w*|crisis|homeless\w*|evict\w*|fight\w*|guarantee\w*|right)\b/i;
const NEWS_PATH = /\/(news|press|blog|media|updates?|events?|endorse\w*|in-the-news|articles?|posts?|stories|releases?|statements?|archives?|category|tag)\b/i;
const PAGE_HINT = /health|housing|afford|cost|issue|priorit|platform|polic|plan|about|meet|foreign|national|secur|israel|iran|middle|peace|veteran|defen|stand|vision|agenda|values/i;
const EXTRA = readJSON(`${DATA}/site-pages.json`, {});
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** some site builders (Next.js and similar) ship the page copy as escaped HTML inside a JSON <script> blob, so the visible markup is nearly empty;
 *  pull those strings back out so the normal text extraction can read them. It is the page's own copy, nothing is fetched beyond the page itself. */
function embeddedHtml(html) {
  const out = [];
  for (const m of html.matchAll(/"((?:[^"\\]|\\.){80,}?)"/g)) {
    if (!/\\u003c(?:p|h[1-6]|li)\\u003e/.test(m[1])) continue;
    try { out.push(JSON.parse('"' + m[1] + '"')); } catch { /* not a plain JSON string */ }
  }
  return out.length ? '\n<div>' + out.join('</div>\n<div>') + '</div>' : '';
}
// RENDER=1: read pages the way a browser shows them (headless Chrome), for sites that build their copy with JavaScript.
// Only used for candidates whose plain crawl found little (see THIN below); robots.txt is still checked with a plain request.
const RENDER = process.env.RENDER === '1';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function rendered(url) {
  const { execFile } = await import('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'crawl-chrome-'));
  return new Promise(resolve => execFile(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${profile}`, '--virtual-time-budget=12000', '--dump-dom', url],
    { timeout: 40000, maxBuffer: 20_000_000 }, (err, out) => { fs.rmSync(profile, { recursive: true, force: true }); resolve(!err && out && out.length > 500 ? { url, html: out.slice(0, 1_500_000) } : null); }));
}
async function get(url, ms = 12000, plain = false) {
  if (RENDER && !plain) { const r = await rendered(url); if (r) return r; }
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
    if (!r.ok || !/html|text/.test(r.headers.get('content-type') || '')) return null;
    const html = (await r.text()).slice(0, 1_500_000);
    return { url: r.url, html: html + embeddedHtml(html) };
  } catch { return null; }
}
async function robotsAllows(origin) {
  const r = await get(origin + '/robots.txt', 6000, true);
  if (!r) return true;
  let applies = false;
  for (const line of r.html.split('\n')) {
    const l = line.trim();
    if (/^user-agent:\s*\*/i.test(l)) applies = true;
    else if (/^user-agent:/i.test(l)) applies = false;
    else if (applies && /^disallow:\s*\/\s*$/i.test(l)) return false;
  }
  return true;
}
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;|&#8217;|&rsquo;/g, '’').replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"').replace(/&mdash;|&#8212;/g, '—').replace(/&ndash;|&#8211;/g, '–').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
function toText(html) {
  return decode(html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|li|h\d|div|section|article|tr|blockquote)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')).replace(/[ \t\r\f]+/g, ' ');
}
function links(html, base) {
  const out = new Set(); const host = new URL(base).host.replace(/^www\./, '');
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) {
    try { const u = new URL(m[1], base); if (u.host.replace(/^www\./, '') === host && /^https?:$/.test(u.protocol) && !/\.(pdf|jpg|png|gif|zip)$/i.test(u.pathname) && PAGE_HINT.test(u.pathname) && !/donat|volunteer|shop|store|contest|privacy|terms|cookie|disclaimer|legal/i.test(u.pathname) && !NEWS_PATH.test(u.pathname)) out.add(u.origin + u.pathname.replace(/\/+$/, '')); } catch {}
  }
  return [...out].slice(0, 7);
}
/** pages one level below an issues hub, e.g. /issue/health-care/ or /priorities/housing */
function childLinks(pages, already) {
  const out = new Set();
  for (const p of pages) {
    const host = new URL(p.url).host.replace(/^www\./, '');
    for (const m of p.html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) {
      try { const u = new URL(m[1], p.url); const path = u.pathname.replace(/\/+$/, '');
        if (u.host.replace(/^www\./, '') === host && /\/(issues?|priorit(?:y|ies)|platform|plans?|policy|policies|positions?|agenda)\/[^/]+/i.test(path) && !already.has(u.origin + path) && !/donat|volunteer|privacy|terms|news|press|blog|events?/i.test(path)) out.add(u.origin + path); } catch {}
    }
  }
  // pages about OUR topics first, so the page cap never drops /issue/health-care/ in favor of /issue/taxes/
  const rank = u => (/health|medic|insur|housing|rent|tenant|foreign|iran|israel|gaza|palestin|war|national-security|defense|military|afford|cost/i.test(u) ? 0 : 1);
  return [...out].sort((a, b) => rank(a) - rank(b)).slice(0, 16);
}
/** short heading-style lines ("Healthcare is a Right, Not a Privilege") that already state a position under one of our narrow phrase rules */
function headlines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const x = line.replace(/\s+/g, ' ').trim(), w = x.split(/\s+/).length;
    if (w < 3 || w > 30 || x.length > 220 || /[|•»]|https?:/.test(x) || !/^[A-Z“"']/.test(x)) continue;   // fragments that start mid-sentence are skipped
    for (const topic of ['iran', 'israel', 'health', 'housing']) { const h = classify(topic, x); if (h) { out.push({ topic, text: x }); break; } }
  }
  return out;
}
function sentences(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim().replace(/^\d{1,2}\s+(?=[A-Z])/, ''); if (t.length < 40) continue;   // drop list numbers like "04 Lower prescription drug prices..."
    for (const s of t.split(/(?<=[.!?])["”’]?\s+(?=["“‘]?[A-Z])/)) {
      const x = s.trim(); const w = x.split(/\s+/).length;
      if (x.replace(/[^A-Za-z]/g, '').length > 20 && x.replace(/[^A-Z]/g, '').length / x.replace(/[^A-Za-z]/g, '').length > 0.6) continue;
      if (w >= 8 && w <= 45 && /[.!?]["”’]?$/.test(x) && !/[|•»]|\]\(|https?:|will not (?:sell|share|rent)|share the collected|phone numbers?|personal (?:identification )?information|we (?:do not|don.t) (?:sell|share|rent)|customer information|opt-in|third part(?:y|ies)|marketing|promotional|text messag\w*|unsubscribe|terms of (?:use|service)|\b[A-Z]{2,6}:\s|--|cookie|privacy policy|©|paid for by|subscribe/i.test(x)) out.push(x);
    }
  }
  return out;
}

async function crawl(key, site, lastName) {
  let origin; try { origin = new URL(site).origin; } catch { return null; }
  if (!(await robotsAllows(origin))) return { skipped: 'robots' };
  const home = await get(site); if (!home) return { skipped: 'unreachable' };
  // the site must actually be this candidate's: their surname has to appear on the homepage
  if (lastName) {
    const toks = lastName.toLowerCase().split(/\s+/).filter(t => t.length >= 4), host = new URL(home.url).host.toLowerCase(), last = toks.at(-1) || '';
    const hostOk = toks.some(t => host.includes(t));
    const mentions = last ? toText(home.html).toLowerCase().split(last).length - 1 : 0;
    if (!hostOk && mentions < 3) return { skipped: 'wrong-site' };
  }
  if (NEWS_PATH.test(new URL(home.url).pathname) || new URL(site).pathname.split('/').filter(Boolean).length > 1) return { skipped: 'wrong-site' };
  const pages = [home];
  for (const u of EXTRA[key] || []) { try { if (new URL(u).host.replace(/^www\./, '') !== new URL(home.url).host.replace(/^www\./, '')) continue; } catch { continue; } await sleep(400); const p = await get(u); if (p && !pages.some(x => x.url === p.url)) pages.push(p); }   // hand-supplied issue pages
  for (const l of links(home.html, home.url)) { await sleep(400); const p = await get(l); if (p) pages.push(p); }
  const kids = []; for (const l of childLinks(pages, new Set(pages.map(p => p.url.replace(/\/+$/, ''))))) { await sleep(400); const p = await get(l); if (p) kids.push(p); }
  pages.push(...kids);
  if (process.env.DEBUG) console.log(key, 'pages read:', pages.map(p => p.url.replace(/^https?:\/\/[^/]+/, '')).join(' '));
  const found = { iran: [], israel: [], health: [], housing: [] }, seen = new Set(), CAP = { iran: 3, israel: 3, health: 3, housing: 3 };
  for (const p of pages) for (const s of sentences(toText(p.html))) {
    const k = s.toLowerCase().replace(/\W+/g, ' ').slice(0, 80); if (seen.has(k)) continue; seen.add(k);
    const topic = IRAN.test(s) && ISRAEL.test(s) ? (classify('israel', s) ? 'israel' : 'iran') : IRAN.test(s) ? 'iran' : ISRAEL.test(s) ? 'israel' : HEALTH.test(s) ? 'health' : HOUSING.test(s) ? 'housing' : null;
    if (!topic) continue;
    if ((topic === 'iran' || topic === 'israel') && !STANCE.test(s)) continue;
    if (topic === 'health' && !STANCE_HEALTH.test(s)) continue;
    if (topic === 'housing' && !STANCE_HOUSING.test(s)) continue;
    if (/\b(he|she|his|her|him|opponent)\b/i.test(s) && !/\b(i|my|me|we|our|us)\b/i.test(s)) continue;   // about someone else, not the candidate's own position
    if (topic === 'iran' && LIST_MENTION.test(s) && !/\b(war|nuclear|strikes?|oppos\w+|hostilit\w+|deal|diplomacy|negotiat\w+)\b/i.test(s)) continue;
    found[topic].push({ text: s, source: 'Campaign website', url: p.url, date: `retrieved ${today}`, kind: 'campaign-site' });
  }
  for (const p of pages) for (const h of headlines(toText(p.html))) {
    const k = h.text.toLowerCase().replace(/\W+/g, ' ').slice(0, 80); if (seen.has(k)) continue; seen.add(k);
    found[h.topic].push({ text: h.text, source: 'Campaign website', url: p.url, date: `retrieved ${today}`, kind: 'campaign-site' });
  }
  if (process.env.DEBUG) for (const t of Object.keys(found)) console.log('  before cap', t, found[t].length, 'classified', found[t].filter(q => classify(t, q.text)).length);
  // keep the lines that state a position first (they earn the label); fill the rest with other topical sentences
  // decisive lines (full / against) first, then partial ones, then other topical sentences; stable within each group
  const strength = (t, q) => { const h = classify(t, q.text); return !h ? 2 : h.tier === 'partial' ? 1 : 0; };
  for (const t of Object.keys(found)) found[t] = found[t].map((q, i) => ({ q, i, w: strength(t, q) })).sort((a, b) => a.w - b.w || a.i - b.i).map(x => x.q).slice(0, CAP[t]);
  return { pages: pages.length, ...found };
}

const races = readJSON(`${DATA}/races.json`).races, names = {};
for (const r of Object.values(races)) for (const c of r.candidates) names[c.fecId || `${c.name}|${r.state}`] = c.name.replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, '').trim();
const existing = readJSON(`${DATA}/site-quotes.json`, { entries: {} }).entries;
const topicsWith = e => ['iran', 'israel', 'health', 'housing'].filter(t => e?.[t]?.quotes?.length).length;
const THIN = key => topicsWith(existing[key]) < 2;   // a rendered re-crawl only for sites the plain crawl barely read
const entries = Object.entries(sites).filter(([k]) => !RENDER || THIN(k)), result = {}, stats = { crawled: 0, withIran: 0, withIsrael: 0, robots: 0, unreachable: 0, 'wrong-site': 0 };
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < entries.length) {
    const [key, site] = entries[i++];
    if (process.env.ONLY && key !== process.env.ONLY) continue;   // debugging: ONLY=<candidate key> crawls just that one
    const r = await crawl(key, site, names[key]).catch(() => null);
    if (!r) continue;
    if (r.skipped) { stats[r.skipped]++; continue; }
    stats.crawled++;
    if (r.iran.length) stats.withIran++; if (r.israel.length) stats.withIsrael++;
    if (['iran', 'israel', 'health', 'housing'].some(t => r[t].length)) result[key] = Object.fromEntries(['iran', 'israel', 'health', 'housing'].map(t => [t, { quotes: r[t] }]));
  }
}));
if (RENDER) { for (const [k, v] of Object.entries(result)) if (topicsWith(v) > topicsWith(existing[k])) existing[k] = v; if (!process.env.ONLY) writeJSON(`${DATA}/site-quotes.json`, { generated: new Date().toISOString(), entries: existing }); else console.log(JSON.stringify(result, null, 1)); }
else if (process.env.ONLY) console.log(JSON.stringify(result, null, 1));   // debugging run: show, never overwrite the full crawl
else writeJSON(`${DATA}/site-quotes.json`, { generated: new Date().toISOString(), entries: result });
console.log(stats, 'candidates with any quote:', Object.keys(result).length);
