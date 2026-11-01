// Builds the GitHub Pages version of the site into ./docs: the same pages, plus every API answer precomputed into one data file
// and a small script (static-api.js) that answers the app's /api/ calls in the browser. Run: npm run build-static
import fs from 'node:fs';
import path from 'node:path';
import { load } from '../lib/load.mjs';
import { readJSON, DATA } from './lib.mjs';

const ROOT = path.join(import.meta.dirname, '..'), OUT = path.join(ROOT, 'docs');
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'lib'), { recursive: true });
for (const f of ['search.mjs', 'geo.mjs']) fs.copyFileSync(path.join(ROOT, 'lib', f), path.join(OUT, 'lib', f));
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

const a = load();
const races = Object.fromEntries(Object.entries(a.races).map(([k, r]) => [k, a.enrich(r)]));
const offBallot = a.offBallot.map(a.enrichCandidate);
const endorsed = (readJSON(`${DATA}/endorsed.json`, { endorsed: [] }).endorsed || []).map(e => e.id);
fs.writeFileSync(path.join(OUT, 'data', 'site.json'), JSON.stringify({ built: new Date().toISOString(), meta: a.meta, races, offBallot, endorsed, bills: a.bills() }));

// the site is served from a sub-path (https://<user>.github.io/<repo>/), so root-relative links become relative
const edit = (file, pairs) => { const p = path.join(OUT, file); let s = fs.readFileSync(p, 'utf8'); for (const [from, to] of pairs) s = s.split(from).join(to); fs.writeFileSync(p, s); };
edit('index.html', [['href="/style.css"', 'href="style.css"'], ['href="/"', 'href="./"'], ['href="/bills"', 'href="bills.html"'], ['<script src="/app.js" type="module"></script>', '<script src="static-api.js" type="module"></script>\n<script src="app.js" type="module"></script>']]);
edit('bills.html', [['href="/style.css"', 'href="style.css"'], ['href="/"', 'href="./"'], ['href="/bills"', 'href="bills.html"'], ['href="/#method"', 'href="./#method"'], ['<script src="/bills.js" type="module"></script>', '<script src="static-api.js" type="module"></script>\n<script src="bills.js" type="module"></script>']]);
edit('app.js', [["a.href = '/?q='", "a.href = './?q='"]]);
edit('bills.js', [['href="/?q=', 'href="./?q=']]);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`docs/ built: ${Object.keys(races).length} races, ${offBallot.length} members not on the ballot, ${(fs.statSync(path.join(OUT, 'data', 'site.json')).size / 1e6).toFixed(1)} MB data`);
