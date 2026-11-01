// Industry PAC money to each candidate (FEC): insurance & pharma, real estate & landlords, defense contractors.
// Method: classify committees by name / connected organization with keyword lists, then total their direct contributions (24K) to candidates.
// The matched committee list is written to data/industry-committees.json so the classification can be audited and corrected.
import { download, unzip, readJSON, writeJSON, DATA, CACHE } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const SECTORS = {
  health: { label: 'insurance & pharma PACs', re: /pharmaceutical|\bpharma\b|phrma|pfizer|merck & co|merck sharp|abbvie|eli lilly|lilly and|bristol[- ]myers|amgen|johnson\s*&\s*johnson|unitedhealth|optum|elevance|anthem|cigna|express scripts|humana|aetna|cvs health|blue cross|health insurance|america'?s health insurance|centene|molina healthcare|novartis|astrazeneca|gilead|biogen|regeneron|sanofi|takeda|genentech|abbott lab|prime therapeutics|health care service corp/i },
  realestate: { label: 'real estate & landlord PACs', re: /realtors|real estate|apartment (?:association|assoc)|multifamily|mortgage bankers|landlord|blackstone|invitation homes|cbre|simon property|prologis|equity residential|avalonbay|brookfield|property group|title insurance/i },
  defense: { label: 'defense contractor PACs', re: /lockheed|raytheon|\brtx\b|northrop|general dynamics|boeing|l3harris|l-3 |bae systems|huntington ingalls|leidos|booz allen|palantir|anduril|textron|general atomics|aerospace industries|\bsaic\b|\bcaci\b|oshkosh|sikorsky|parsons corp/i },
};
const EXCLUDE = /molinaro|victor ruben|trucking|people.s pharma|victory committee|red hook|for congress|for senate|accountability|reform|public health insurance option|republican|democrat|mosaic company|american mosaic/i;
const cycles = [2022, 2024, 2026];
const money = {}, matched = { health: new Map(), realestate: new Map(), defense: new Map() };
for (const cy of cycles) {
  const yy = String(cy).slice(2);
  // committee master -> which committees belong to which sector
  const cmZip = await download(`https://www.fec.gov/files/bulk-downloads/${cy}/cm${yy}.zip`, `cm${yy}.zip`, 24);
  const cmDir = path.join(CACHE, `cm${yy}`); unzip(cmZip, cmDir);
  const sectorOf = new Map();
  for (const line of fs.readFileSync(path.join(cmDir, 'cm.txt'), 'utf8').split('\n')) {
    const f = line.split('|'); if (f.length < 15) continue;
    const text = `${f[1]} ${f[13]}`; if (EXCLUDE.test(text)) continue;
    for (const [k, s] of Object.entries(SECTORS)) if (s.re.test(text)) { sectorOf.set(f[0], k); matched[k].set(f[0], `${f[1]}${f[13] ? ' (' + f[13] + ')' : ''}`); break; }
  }
  // contributions (same pas2 files used for the AIPAC totals)
  const zip = await download(`https://www.fec.gov/files/bulk-downloads/${cy}/pas2${yy}.zip`, `pas2${yy}.zip`, 24);
  const dir = path.join(CACHE, `pas2${yy}`); unzip(zip, dir);
  const seen = new Set();
  for (const line of fs.readFileSync(path.join(dir, 'itpas2.txt'), 'utf8').split('\n')) {
    if (!line.startsWith('C')) continue;
    const f = line.split('|');
    const sector = sectorOf.get(f[0]); if (!sector || !f[16] || f[19] === 'X') continue;
    if (!['24K', '24Z', '24C', '22Z'].includes(f[5])) continue;
    const key = f[21] || f[17]; if (seen.has(key)) continue; seen.add(key);
    const m = ((money[f[16]] ||= {})[sector] ||= {}); m[cy] = (m[cy] || 0) + (f[5] === '22Z' ? -1 : 1) * Number(f[14]);
  }
}
writeJSON(`${DATA}/industry.json`, { generated: new Date().toISOString(), cycles, sectors: Object.fromEntries(Object.entries(SECTORS).map(([k, v]) => [k, v.label])), money });
writeJSON(`${DATA}/industry-committees.json`, Object.fromEntries(Object.entries(matched).map(([k, m]) => [k, [...m.values()].sort()])));
for (const k of Object.keys(SECTORS)) console.log(`${k}: ${matched[k].size} committees matched`);
console.log(`candidates with any industry money: ${Object.keys(money).length}`);
