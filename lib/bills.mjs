// The sponsors + cosponsors of the three bills this guide tracks (data/cosponsors.json, from GovInfo), with who each member is.
// A cosponsor list only shows who signed on; not being on it is never treated as opposition.
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, DATA, CACHE } from '../scripts/lib.mjs';

const BILLS = [
  { key: 'm4a', title: 'Medicare for All Act', ids: ['hr3069', 's1506'], what: 'Establishes a national health insurance program, run by the Department of Health and Human Services, that covers all U.S. residents, enrolls people automatically at birth or residency, and covers medically necessary care.', whatSource: { label: 'Congressional Research Service summary', url: 'https://www.congress.gov/bill/119th-congress/house-bill/3069' } },
  { key: 'blockbombs', title: 'Block the Bombs Act', ids: ['hr3565'], what: 'Prohibits the President from selling, transferring or exporting certain defense articles to Israel, including BLU-109 bunker-buster bombs, JDAM guidance assemblies and 155mm artillery ammunition, except in specified circumstances.', whatSource: { label: 'Congressional Research Service summary', url: 'https://www.congress.gov/bill/119th-congress/house-bill/3565' } },
  { key: 'gndph', title: 'Green New Deal for Public Housing Act', ids: ['hr10063', 's5284'], what: 'Creates two HUD grant programs for public housing agencies: workforce grants for jobs, apprenticeships and training for residents, and capital grants for deep energy retrofits, renewable energy, accessibility and code compliance, community facilities and disaster resilience. It also repeals the Faircloth Amendment, which limits building new public housing. It sets no dollar amount, instead appropriating funds as necessary to address the public housing repair backlog.', whatSource: { label: 'National Low Income Housing Coalition', url: 'https://nlihc.org/resource/lawmakers-reintroduce-green-new-deal-public-housing-act' } },
  { key: 'housing', title: 'Housing Is a Human Right Act', ids: ['hr4457'], what: 'Would invest over $300 billion in affordable housing and homelessness services, including $27 billion a year for services, and fund alternatives to criminalizing homelessness.', whatSource: { label: 'National Low Income Housing Coalition', url: 'https://nlihc.org/resource/reps-jayapal-and-meng-reintroduce-housing-human-right-act-0' } },
  { key: 'badndaa', bad: true, voteId: 'H119-638', title: 'National Defense Authorization Act, fiscal 2027', what: 'The House passed the fiscal 2027 defense authorization bill 216 to 212 on July 22, 2026. It includes Section 219, which would direct the Defense Department to expand joint defense research, development and industrial cooperation with Israel (the Senate version has a differently worded Section 1217). This is a very large bill, so a yes vote also funds much else; this guide counts it against a candidate because of this provision. The list below is everyone who voted yes.', whatSource: { label: 'Stimson Center on Section 219', url: 'https://www.stimson.org/2026/the-myths-and-real-risks-of-section-219-unpacking-the-ndaa-provision-on-us-israel-cooperative-projects/' }, voteLink: { label: 'House roll call 638 on Voteview', url: 'https://voteview.com/rollcall/RH1190638' } },
  { key: 'baddefense', bad: true, title: 'United States-Israel Defense Partnership Act', ids: ['hr1229', 's554'], what: 'Requires the Department of Defense to set up a joint program with Israel\u2019s Ministry of Defense on counter-drone technology, open a Defense Innovation Unit office in Israel, and seek to bring Israel into the U.S. national technology and industrial base, which now covers the U.S., U.K., Australia, New Zealand and Canada. It also authorizes joint military research and development with Israel. This guide counts cosponsoring it against a candidate.', whatSource: { label: 'Congressional Research Service summary', url: 'https://www.congress.gov/bill/119th-congress/house-bill/1229' } },
];

export function createBills({ races, offBallot, votes = {} }) {
  const who = new Map();
  for (const r of Object.values(races)) for (const c of r.candidates) if (c.bioguide) who.set(c.bioguide, { name: c.name, party: c.party, state: r.state, district: r.district, chamber: r.chamber || (r.key?.endsWith('-S') ? 'senate' : 'house'), photo: c.photo, status: 'On the 2026 ballot' });
  for (const p of offBallot) if (p.bioguide && !who.has(p.bioguide)) who.set(p.bioguide, { name: p.name, party: p.party, state: p.state, district: p.district, chamber: p.chamber, photo: p.photo, status: 'Not on the 2026 ballot' });
  // anyone left (members who have since left Congress): congress-legislators history
  let leftover = null;
  const lookupLeft = id => {
    if (!leftover) { leftover = new Map(); for (const f of ['legislators-current.json', 'legislators-historical.json']) { const file = path.join(CACHE, f); if (!fs.existsSync(file)) continue; for (const x of JSON.parse(fs.readFileSync(file, 'utf8'))) if (x.id?.bioguide) leftover.set(x.id.bioguide, x); } }
    const x = leftover.get(id); if (!x) return null;
    const t = x.terms.at(-1);
    return { name: x.name.official_full || `${x.name.first} ${x.name.last}`, party: t.party === 'Democrat' ? 'D' : t.party === 'Republican' ? 'R' : t.party?.[0] || '', state: t.state, district: t.district ?? null, chamber: t.type === 'sen' ? 'senate' : 'house', photo: `https://unitedstates.github.io/images/congress/225x275/${id}.jpg`, status: 'No longer in Congress' };
  };
  return function bills() {
    const { generated, bills: src } = readJSON(`${DATA}/cosponsors.json`, { bills: [] });
    return {
      generated,
      bills: BILLS.map(b => {
        if (b.voteId) {   // a bill we list by who voted yes (a floor vote), not by cosponsors
          const members = [];
          for (const [id, v] of Object.entries(votes)) if (v[b.voteId] === 'Yea') { const m = who.get(id) || lookupLeft(id); if (m) members.push({ bioguide: id, ...m, role: 'Voted yes', bill: b.title, url: b.voteLink.url }); }
          members.sort((a, c) => a.state.localeCompare(c.state) || a.name.localeCompare(c.name));
          return { key: b.key, bad: true, title: b.title, what: b.what, whatSource: b.whatSource, links: [b.voteLink], count: members.length, house: members.length, senate: 0, members };
        }
        const parts = b.ids.map(id => src.find(x => x.id === id)).filter(Boolean);
        const members = [];
        for (const part of parts) for (const id of new Set([part.sponsor, ...part.cosponsors].filter(Boolean))) {
          const m = who.get(id) || lookupLeft(id); if (!m) continue;
          members.push({ bioguide: id, ...m, role: id === part.sponsor ? 'Sponsor' : 'Cosponsor', bill: part.label, url: part.url });
        }
        members.sort((a, c) => (a.role === 'Sponsor' ? 0 : 1) - (c.role === 'Sponsor' ? 0 : 1) || a.chamber.localeCompare(c.chamber) * -1 || a.state.localeCompare(c.state) || a.name.localeCompare(c.name));
        return { key: b.key, bad: !!b.bad, title: b.title, what: b.what, whatSource: b.whatSource, links: parts.map(p => ({ label: p.label, url: p.url })), count: members.length, house: members.filter(m => m.chamber === 'house').length, senate: members.filter(m => m.chamber === 'senate').length, members };
      }),
    };
  };
}
