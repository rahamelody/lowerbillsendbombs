// Builds data/nominees.json: general-election candidates per race, scraped from Wikipedia's per-state 2026 election pages.
// Output keys: "MI-11" (House), "AK-AL" (at-large), "GA-S" / "OH-S2" (Senate). Races that don't exist are simply absent.
import { download, readJSON, writeJSON, STATES, DATA } from './lib.mjs';
import fs from 'node:fs';

const api = title => `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&formatversion=2`;

async function wikitext(title, name) {
  try {
    const p = await download(api(title), name, 6);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j.parse?.wikitext || null;
  } catch { return null; }
}

/** Split template body on top-level pipes. */
function splitTemplate(body) {
  const parts = []; let depth = 0, cur = '';
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; }
    else if (two === '}}' || two === ']]') { depth--; cur += two; i++; }
    else if (body[i] === '|' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += body[i];
  }
  parts.push(cur);
  return parts;
}
const unlink = s => s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '').replace(/'''?/g, '').replace(/\{\{[^}]*\}\}/g, '').trim();
const PARTY = { Democratic: 'D', Republican: 'R', Libertarian: 'L', Green: 'G', Independent: 'I', 'Working Families': 'WFP', Constitution: 'C', Forward: 'F', 'No party': 'NPA', 'Independent American': 'IAP', 'Natural Law': 'NL', 'Socialist Workers': 'SWP', Conservative: 'CON', 'Liberal': 'LIB' };
const shortParty = p => { const x = unlink(p || ''); for (const [k, v] of Object.entries(PARTY)) if (x.startsWith(k)) return v; const o = x.replace(/ Party.*$/, '').trim(); return o && o.length <= 10 ? o : (o ? 'Other' : '?'); };

const wikiTarget = raw => { const m = (raw || '').match(/\[\[([^\]|#]+)/); return m ? m[1].trim() : null; };

/** Extract top-level {{...}} templates from text. */
function topTemplates(text) {
  const res = []; let depth = 0, st = -1;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') { if (depth++ === 0) st = i; i++; }
    else if (text[i] === '}' && text[i + 1] === '}') { if (--depth === 0 && st >= 0) { res.push(text.slice(st + 2, i)); st = -1; } i++; }
  }
  return res;
}

function candsFromBox(box) {
  const cands = [];
  for (const t of topTemplates(box)) {
    if (!/^\s*Election box (?:winning )?candidate/i.test(t)) continue;
    const args = {};
    for (const a of splitTemplate(t).slice(1)) { const i = a.indexOf('='); if (i > 0) args[a.slice(0, i).trim()] = a.slice(i + 1).trim(); }
    const name = unlink(args.candidate || '');
    if (!name || /write-?in|^others?$|scattering|^none|blank/i.test(name)) continue;
    cands.push({ name, party: shortParty(args.party), wiki: wikiTarget(args.candidate) });
  }
  return cands;
}

/** Candidates listed as bullets under "Nominee" / "Advanced to general" headings (used when no results box is populated yet). */
function candsFromAdvanced(wt) {
  const cands = []; let party = '?';
  const lines = wt.split('\n'); let inList = false;
  for (const line of lines) {
    const h = line.match(/^(=+)\s*([^=]+?)\s*=+\s*$/);
    if (h) {
      const title = h[2];
      if (/Democratic|Republican|Libertarian|Green|Independent|Constitution|Working Families|Forward|Conservative|Unity|No Labels|Socialist|Natural Law/i.test(title) && !/Nominee|Advanced/i.test(title)) party = shortParty(title);
      inList = /^(Nominee|Nominees|Advanced to (the )?general.*|Declared|Candidates)$/i.test(title.trim()) && !/primary/i.test(title);
      if (/^Declared$/i.test(title.trim()) && party !== 'I' && !/Independent/i.test(wt.slice(0, 0))) inList = party === 'I';
      continue;
    }
    if (!inList) continue;
    const b = line.match(/^\*\s*(.+)/); if (!b) continue;
    let txt = b[1].replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '').replace(/<ref[^>]*\/>/g, '');
    const nm = unlink(txt.split(/,| \u2013 | \u2014 | - |\(/)[0]).replace(/^\[\[.*$/, '').trim();
    if (nm && nm.length < 60 && /[a-z]/i.test(nm)) cands.push({ name: nm, party, fromList: true, wiki: wikiTarget(b[1]) });
  }
  return cands;
}

/** Candidates in the general election: the last populated results box in the chunk, after any "General election" heading. */
function parseBoxes(chunk) {
  const idx = [...chunk.matchAll(/\n=+\s*General election\s*=+/gi)].map(m => m.index);
  const scope = idx.length ? chunk.slice(idx[idx.length - 1]) : chunk;
  const boxes = [...scope.matchAll(/\{\{Election box begin[\s\S]*?\{\{Election box end\}\}/gi)].map(m => m[0]);
  for (let i = boxes.length - 1; i >= 0; i--) {
    if (/primary|runoff|caucus|convention/i.test((boxes[i].match(/title\s*=\s*([^|}\n]*)/i) || [])[1] || '') && !idx.length) continue;
    const c = candsFromBox(boxes[i]);
    if (c.length) return { cands: c };
  }
  const adv = candsFromAdvanced(chunk);
  return adv.length ? { cands: adv } : null;
}

const out = readJSON(`${DATA}/nominees.json`, {});
const result = {};

for (const [st, state] of Object.entries(STATES)) {
  // ---- House
  const houseTitles = st === 'CA'
    ? ['2026 United States House of Representatives elections in California (districts 1\u201326)', '2026 United States House of Representatives elections in California (districts 27\u201352)']
    : [`2026 United States House of Representatives elections in ${state}`, `2026 United States House of Representatives election in ${state}`];
  for (const [ti, title] of houseTitles.entries()) {
    const wt = await wikitext(title, `wiki-house-${st}-${ti}.json`);
    if (!wt) continue;
    const heads = [...wt.matchAll(/\n==\s*(District (\d+)|At-large(?: district)?|[A-Za-z. ]+'s at-large district)[^=\n]*==\s*\n/gi)];
    if (!heads.length) {
      const parsed = parseBoxes(wt);
      if (parsed && ['AK', 'DE', 'ND', 'SD', 'VT', 'WY'].includes(st)) result[`${st}-AL`] = { type: 'house', state: st, district: 0, candidates: parsed.cands };
      continue;
    }
    heads.forEach((h, i) => {
      const end = i + 1 < heads.length ? heads[i + 1].index : wt.length;
      let chunk = wt.slice(h.index + h[0].length, end);
      const stop = chunk.search(/\n==\s*(?!District|At-large)[^=\n]+==\s*\n/);
      if (stop > 0) chunk = chunk.slice(0, stop);
      const parsed = parseBoxes(chunk);
      const key = `${st}-${h[2] ? Number(h[2]) : 'AL'}`;
      if (parsed) result[key] = { type: 'house', state: st, district: h[2] ? Number(h[2]) : 0, candidates: parsed.cands };
    });
  }
  // ---- Senate (regular and special elections)
  for (const [suffix, title] of [['S', `2026 United States Senate election in ${state}`], ['S2', `2026 United States Senate special election in ${state}`]]) {
    const s = await wikitext(title, `wiki-senate-${st}-${suffix}.json`);
    if (!s) continue;
    const parsed = parseBoxes(s);
    if (parsed) result[`${st}-${suffix}`] = { type: 'senate', state: st, special: suffix === 'S2', candidates: parsed.cands };
  }
}
writeJSON(`${DATA}/nominees.json`, result);
const houses = Object.values(result).filter(r => r.type === 'house').length;
const senates = Object.values(result).filter(r => r.type === 'senate').length;
console.log(`nominees: ${houses} House races, ${senates} Senate races`);
