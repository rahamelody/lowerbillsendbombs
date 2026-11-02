// Reads every data file and builds the lookup helpers (enrichment, search). Shared by the server and the scripts.
import { readJSON, DATA } from '../scripts/lib.mjs';
import { summarize } from './summary.mjs';
import { createSearch } from './search.mjs';
import { createBills } from './bills.mjs';

export function load() {
  const { races, generated, moneyAsOf, filingsThrough, liveCheckedAt } = readJSON(`${DATA}/races.json`);
  const offBallot = readJSON(`${DATA}/people.json`, []);
  const { votes, tally, members119 } = readJSON(`${DATA}/votes.json`);
  const cosponsorData = readJSON(`${DATA}/cosponsors.json`, { bills: [] });
  const setOf = topic => new Set(cosponsorData.bills.filter(b => b.topic === topic).flatMap(b => b.cosponsors));
  const billUrl = id => cosponsorData.bills.find(b => b.id === id)?.url;
  const cosp = { moneyNotes: readJSON(`${DATA}/money-notes.json`, {}), bb: setOf('blockbombs'), bbUrl: billUrl('hr3565'), m4a: setOf('m4a'), housing: setOf('housing'), gndph: setOf('gndph'), badDefense: setOf('baddefense'), badDefenseUrl: billUrl('hr1229'), gndphUrl: billUrl('hr10063'), members119: new Set(members119 || []), m4aUrl: billUrl('hr3069'), housingUrl: billUrl('hr4457') };
  const keyVotes = readJSON(`${DATA}/key-votes.json`, []);
  const { entries: curated } = readJSON(`${DATA}/statements.json`, { entries: {} });
  const { entries: siteQuotes } = readJSON(`${DATA}/site-quotes.json`, { entries: {} });
  const { entries: otiQuotes } = readJSON(`${DATA}/ontheissues.json`, { entries: {} });   // dated, sourced excerpts of their own words (OnTheIssues.org)
  // hand-curated, source-checked quotes win; crawled campaign-site sentences fill the gaps
  const statements = {};
  for (const key of new Set([...Object.keys(curated), ...Object.keys(siteQuotes), ...Object.keys(otiQuotes)])) {
    const c = curated[key] || {}, e = siteQuotes[key] || {}, o = otiQuotes[key] || {};
    statements[key] = Object.fromEntries(['iran', 'israel', 'health', 'housing'].map(t => {
      // hand-checked quotes (news, debates) come first; crawled campaign-site sentences fill the remaining slots, three in all
      const cq = c[t]?.quotes || [], oq = (o[t] || []).filter(q => !cq.some(x => x.text === q.text)), eq = (e[t]?.quotes || []).filter(q => ![...cq, ...oq].some(x => x.text === q.text));
      const shown = cq.length || oq.length || eq.length ? { ...(c[t] || {}), quotes: [...cq, ...oq, ...eq].slice(0, 3) } : c[t];
      if (!shown && !e[t]?.quotes?.length && !oq.length) return [t, null];
      // `quotes` are what we display (hand-checked ones win); `stanceQuotes` is everything they've said, used only to read their position
      return [t, { ...(shown || {}), badge: c[t]?.badge, stanceQuotes: [...(c[t]?.quotes || []), ...oq, ...(e[t]?.quotes || [])] }];
    }).filter(([, v]) => v));
  }
  const stateRecords = { ...readJSON(`${DATA}/state-records.json`, { records: {} }).records, ...readJSON(`${DATA}/state-records-manual.json`, { records: {} }).records };
  const ctx = { votes, tally, keyVotes, statements, cosp, stateRecords };
  const enrichCandidate = c => ({ ...c, record: summarize(c, ctx) });
  const enrich = race => ({ ...race, candidates: race.candidates.map(enrichCandidate) });
  const { search, suggest, locate } = createSearch({ races, offBallot, enrich });
  return { races, offBallot, tally, keyVotes, committees: readJSON(`${DATA}/committees.json`, []), enrich, enrichCandidate, search, suggest, locate, bills: createBills({ races, offBallot, votes }), meta: { racesBuilt: generated, moneyAsOf, filingsThrough, liveCheckedAt } };
}
