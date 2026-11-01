// Sponsors + cosponsors of the bills we track as stance signals, from GovInfo's bulk BILLSTATUS XML (no API key, no rate limit).
// A cosponsor list only shows who signed on; NOT being on it is never treated as opposition.
import { writeJSON, DATA, download } from './lib.mjs';
import fs from 'node:fs';

const BILLS = [
  { id: 'hr3069', topic: 'm4a', chamber: 'house', type: 'hr', num: 3069, label: 'Medicare for All Act (H.R. 3069)', url: 'https://www.congress.gov/bill/119th-congress/house-bill/3069' },
  { id: 's1506', topic: 'm4a', chamber: 'senate', type: 's', num: 1506, label: 'Medicare for All Act (S. 1506)', url: 'https://www.congress.gov/bill/119th-congress/senate-bill/1506' },
  { id: 'hr4457', topic: 'housing', chamber: 'house', type: 'hr', num: 4457, label: 'Housing Is a Human Right Act (H.R. 4457)', url: 'https://www.congress.gov/bill/119th-congress/house-bill/4457' },
  { id: 'hr10063', topic: 'gndph', chamber: 'house', type: 'hr', num: 10063, label: 'Green New Deal for Public Housing Act (H.R. 10063)', url: 'https://www.congress.gov/bill/119th-congress/house-bill/10063' },
  { id: 's5284', topic: 'gndph', chamber: 'senate', type: 's', num: 5284, label: 'Green New Deal for Public Housing Act (S. 5284)', url: 'https://www.congress.gov/bill/119th-congress/senate-bill/5284' },
  { id: 'hr3565', topic: 'blockbombs', chamber: 'house', type: 'hr', num: 3565, label: 'Block the Bombs Act (H.R. 3565)', url: 'https://www.congress.gov/bill/119th-congress/house-bill/3565' },
];
const out = { generated: new Date().toISOString(), bills: [] };
for (const b of BILLS) {
  const file = await download(`https://www.govinfo.gov/bulkdata/BILLSTATUS/119/${b.type}/BILLSTATUS-119${b.type}${b.num}.xml`, `BILLSTATUS-119${b.type}${b.num}.xml`, 6);
  const xml = fs.readFileSync(file, 'utf8');
  const ids = new Set();
  const sponsor = xml.match(/<sponsors>[\s\S]*?<bioguideId>(.*?)<\/bioguideId>/)?.[1];
  if (sponsor) ids.add(sponsor);
  const block = xml.match(/<cosponsors>([\s\S]*?)<\/cosponsors>/)?.[1] || '';
  for (const item of block.split('<item>').slice(1)) if (!/<sponsorshipWithdrawnDate>/.test(item)) { const id = item.match(/<bioguideId>(.*?)<\/bioguideId>/)?.[1]; if (id) ids.add(id); }
  const { type, num, ...rest } = b;
  out.bills.push({ ...rest, sponsor, cosponsors: [...ids] });
  console.log(`${b.label}: ${ids.size} sponsor+cosponsors`);
}
writeJSON(`${DATA}/cosponsors.json`, out);
