import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const CACHE = path.join(ROOT, '.cache');
export const DATA = path.join(ROOT, 'data');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

const UA = 'election-hub/0.1 (civic info project; contact: rahamghassemi@gmail.com)';

/** Download a URL to .cache (re-using a cached copy younger than maxAgeHours). Returns the local path. */
export async function download(url, name, maxAgeHours = 12) {
  const dest = path.join(CACHE, name);
  if (fs.existsSync(dest) && (Date.now() - fs.statSync(dest).mtimeMs) / 36e5 < maxAgeHours) return dest;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      return dest;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

export function unzip(zipPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', outDir]);
}

export function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
export function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 1)); }

/** Minimal CSV parser (handles quotes). Returns array of arrays. */
export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
export function csvObjects(text) {
  const [head, ...rows] = parseCSV(text);
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** Normalize a person name for fuzzy matching: "SMITH, JOHN Q JR" / "John Q. Smith Jr." -> {first,last} lowercase ascii. */
export function normName(raw) {
  let s = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)|".*?"|'.*?'/g, ' ');
  s = s.replace(/\b(jr|sr|ii|iii|iv|dr|mr|mrs|ms|hon)\b\.?/g, ' ').replace(/[.]/g, '');
  let first, last;
  if (s.includes(',')) { const [l, f] = s.split(','); last = l; first = f; } else { const p = s.trim().split(/\s+/); last = p.pop(); first = p.join(' '); }
  const clean = x => x.replace(/[^a-z\s-]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const lw = clean(last), fw = clean(first);
  return { first: fw[0] || '', last: lw.join(' '), lastTail: lw[lw.length - 1] || '', all: [...fw, ...lw] };
}
export function namesMatch(a, b) {
  const x = normName(a), y = normName(b);
  if (!x.lastTail || !y.lastTail) return false;
  // surname vs surname only (a first name like "James" must never satisfy a surname match)
  const xl = x.last.split(' '), yl = y.last.split(' ');
  const sameFirstToken = x.all[0] && x.all[0] === y.all[0];   // married/maiden or extra surnames: the surname must appear AND the first name must be identical
  const lastOk = x.last === y.last || x.lastTail === y.lastTail || xl.some(w => w.length > 2 && yl.includes(w))
    || (sameFirstToken && (y.all.includes(x.lastTail) || x.all.includes(y.lastTail)));
  if (!lastOk) return false;
  const f1 = x.first, f2 = y.first;
  return !f1 || !f2 || f1[0] === f2[0] || f1.startsWith(f2) || f2.startsWith(f1) || firstNamesMatch(f1, f2);   // Peggy / Margaret, Jim / James
}

// Same person's first name? Equal, a >=3-letter prefix ("Chris"/"Christopher"), or a standard nickname pair ("Tom"/"Thomas", "Jim"/"James"). Initials alone never count.
const NICK = [['thomas', 'tom', 'tommy'], ['margaret', 'peggy', 'maggie', 'meg', 'peg', 'margie'], ['james', 'jim', 'jimmy', 'jamie'], ['william', 'bill', 'will', 'billy'], ['robert', 'bob', 'rob', 'bobby'], ['michael', 'mike', 'mick'], ['richard', 'rick', 'dick', 'rich'], ['john', 'jack', 'johnny'], ['charles', 'chuck', 'charlie'], ['edward', 'ed', 'ted', 'eddie'], ['david', 'dave'], ['stephen', 'steven', 'steve'], ['joseph', 'joe'], ['anthony', 'tony'], ['andrew', 'andy', 'drew'], ['daniel', 'dan', 'danny'], ['kenneth', 'ken'], ['donald', 'don'], ['ronald', 'ron'], ['patrick', 'pat'], ['elizabeth', 'liz', 'beth', 'betty'], ['katherine', 'kathryn', 'kate', 'katie', 'kathy'], ['susan', 'sue'], ['jennifer', 'jen', 'jenny'], ['matthew', 'matt'], ['nicholas', 'nick'], ['benjamin', 'ben'], ['samuel', 'sam'], ['gregory', 'greg'], ['jeffrey', 'jeff'], ['timothy', 'tim'], ['joshua', 'josh'], ['zachary', 'zach'], ['alexander', 'alex'], ['mitchell', 'mitch'], ['theodore', 'ted'], ['gabriel', 'gabe'], ['christopher', 'chris'], ['margaret', 'maggie', 'peggy'], ['deborah', 'debbie', 'deb'], ['rebecca', 'becky', 'becca'], ['jonathan', 'jon'], ['lawrence', 'larry'], ['raymond', 'ray'], ['frederick', 'fred', 'freddie']];
const NICK_OF = new Map(); NICK.forEach((g, i) => g.forEach(n => (NICK_OF.get(n) || NICK_OF.set(n, new Set()).get(n)).add(i)));
export function firstNamesMatch(a, b) {
  const x = (a || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, ''), y = (b || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  if (!x || !y) return false;
  if (x === y || (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x)))) return true;
  const gx = NICK_OF.get(x), gy = NICK_OF.get(y);
  return !!(gx && gy && [...gx].some(i => gy.has(i)));
}

/** Not a candidate's own site: news outlets, government/university/legislature pages, social networks and reference sites that a Wikipedia infobox sometimes links by mistake. */
export const isBadSiteHost = url => { try { return /(^|\.)(apnews|floridapolitics|wmur|stltoday|wispolitics|ncf\.edu|ballotpedia|wikipedia|facebook|twitter|x|instagram|youtube|linkedin|politico|nytimes|washingtonpost|nbc[a-z]*|cbs[a-z]*|abc[a-z]*news|foxnews|cnn|npr|axios|patch|archive|web\.archive|ctmirror|opensecrets|votesmart)\.(com|org|net|gov)$|\.(gov|edu|mil)$|(^|\.)leg\.state\.|senatedems|housedems|legislature|(^|\.)(news|times|post|herald|gazette|tribune|journal)[a-z]*\./i.test(new URL(url).host); } catch { return true; } };
