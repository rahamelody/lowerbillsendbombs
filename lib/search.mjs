// Universal search: figures out whether the text is a ZIP, state, address, place, or a person's name, and never returns an error for "not an address".
import { censusAddress, censusPointFresh, zipLookup, placeLookup } from './geo.mjs';

const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
const BY_NAME = Object.fromEntries(Object.entries(STATE_NAMES).map(([a, n]) => [n.toLowerCase(), a]));
const ascii = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = s => ascii(s).replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);

export function stateFrom(q) {
  const t = ascii(q).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(state of|the state of)\s+/, '');
  if (BY_NAME[t]) return BY_NAME[t];
  if (t === 'washington dc' || t === 'washington d c' || t === 'dc') return 'DC';
  if (t.length === 2 && STATE_NAMES[t.toUpperCase()]) return t.toUpperCase();
  return null;
}

export function createSearch({ races, offBallot, enrich }) {
  // flat people index: everyone on a 2026 ballot plus sitting members who aren't
  const index = [];
  for (const r of Object.values(races)) for (const c of r.candidates) index.push({ c, race: r, name: ascii(c.name), toks: tokens(c.name) });
  for (const p of offBallot) index.push({ c: p, race: null, name: ascii(p.name), toks: tokens(p.name) });

  const officeLabel = (c, r) => {
    const type = r ? r.type : c.chamber;
    const where = type === 'senate' ? `U.S. Senate · ${(r || c).state}` : `U.S. House · ${(r || c).state}-${((r || c).district ?? c.district) === 0 ? 'AL' : (r || c).district ?? c.district}`;
    return where;
  };
  const statusLabel = (c, r) => !r ? `Not on the 2026 ballot (term ends ${c.termEnds?.slice(0, 4)})` : c.incumbent ? 'Incumbent · on the Nov. 3 ballot' : c.formerMember ? 'Former member · on the Nov. 3 ballot' : 'Candidate on the Nov. 3 ballot';

  function searchPeople(q) {
    let qt = tokens(q);
    // a state name or abbreviation next to a name narrows the search ("ossoff georgia", "rogers MI")
    let stateFilter = null;
    if (qt.length > 1) {
      for (let n = Math.min(2, qt.length - 1); n >= 1 && !stateFilter; n--) for (const end of [qt.length, n]) {
        const part = end === qt.length ? qt.slice(-n).join(' ') : qt.slice(0, n).join(' ');
        const st = stateFrom(part); if (st) { stateFilter = st; qt = end === qt.length ? qt.slice(0, -n) : qt.slice(n); break; }
      }
    }
    if (!qt.length) return [];
    const full = qt.join(' ');
    const hits = [];
    for (const it of index) {
      if (stateFilter && (it.race?.state || it.c.state) !== stateFilter) continue;
      if (!qt.every(t => it.toks.some(w => w.startsWith(t)))) continue;
      let score = it.name === full ? 100 : it.toks.join(' ').includes(full) ? 60 : 40;
      if (it.c.incumbent) score += 10; if (it.race) score += 5; if (it.c.hasVotes) score += 2;
      hits.push({ ...it, score });
    }
    hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const seen = new Set(), out = [];
    for (const h of hits) {
      const id = h.c.bioguide || `${h.c.fecId}|${h.c.name}`; if (seen.has(id)) continue; seen.add(id);
      out.push({ name: h.c.name, party: h.c.party, photo: h.c.photo || null, bioguide: h.c.bioguide || null, office: officeLabel(h.c, h.race), status: statusLabel(h.c, h.race), raceKey: h.race?.key || null, onBallot: !!h.race });
      if (out.length >= 15) break;
    }
    return out;
  }

  const houseKey = (state, d) => `${state}-${d === 0 || d === 98 ? 'AL' : d}`;
  function ballot(state, districts, label, approx, notes = []) {
    const out = { kind: 'ballot', label, state, approx, senate: [], houses: [], notes: [...notes] };
    if (state === 'DC') { out.notes.push('Washington, D.C. has a non-voting delegate and no U.S. senators, so there are no voting House or Senate seats to show.'); return out; }
    for (const d of districts) { const r = races[houseKey(state, d)] || (d === 0 ? races[`${state}-1`] : null); if (r) out.houses.push({ ...enrich(r), districtLabel: r.district === 0 ? 'At-large' : `District ${r.district}` }); else out.notes.push(`We don't have candidate data for ${state}-${d} yet.`); }
    for (const k of [`${state}-S`, `${state}-S2`]) if (races[k]) out.senate.push(enrich(races[k]));
    if (!out.senate.length) out.notes.push(`There is no U.S. Senate election in ${STATE_NAMES[state]} this year.`);
    if (out.houses.length > 1) out.notes.unshift(`This area touches ${out.houses.length} congressional districts. Enter a full street address to see exactly which one is yours.`);
    return out;
  }

  function stateView(st) {
    const houseRaces = Object.values(races).filter(r => r.type === 'house' && r.state === st).sort((a, b) => a.district - b.district)
      .map(r => ({ key: r.key, district: r.district, openSeat: r.openSeat, candidates: r.candidates.slice(0, 4).map(c => ({ name: c.name, party: c.party, incumbent: c.incumbent, photo: c.photo || null })), more: Math.max(0, r.candidates.length - 4) }));
    const senate = [`${st}-S`, `${st}-S2`].filter(k => races[k]).map(k => enrich(races[k]));
    const notes = [];
    if (st === 'DC') notes.push('Washington, D.C. has a non-voting delegate and no U.S. senators, so there are no voting House or Senate seats to show.');
    else if (!senate.length) notes.push(`There is no U.S. Senate election in ${STATE_NAMES[st]} this year.`);
    return { kind: 'state', state: st, stateName: STATE_NAMES[st], senate, houseRaces, notes };
  }

  const none = (q, extra, customTips) => ({ kind: 'none', query: q, message: extra || `We couldn't find anything for “${q}”.`, tips: customTips || ['A candidate or official’s name, like “Ossoff” or “Rashida Tlaib”', 'A ZIP code, like 48226', 'A state, like “Georgia” or “GA”', 'A city, like “Ann Arbor, MI”, or a full street address'] });

  const STATE_ABBRS = new Set(Object.keys(STATE_NAMES).map(a => a.toLowerCase()));
  const hasLocality = q => {
    if (/\b\d{5}(-\d{4})?\b/.test(q) || q.includes(',')) return true;
    const t = ascii(q).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    return t.some(w => STATE_ABBRS.has(w) && w.length === 2 && w !== 'in' && w !== 'or' && w !== 'me' && w !== 'hi' && w !== 'ok') || Object.keys(BY_NAME).some(n => ascii(q).includes(n));
  };

  async function search(raw) {
    let q = (raw || '').trim().replace(/\s+/g, ' ');
    if (!q) return none('', 'Type a name, ZIP code, state, city or address to get started.');
    try {
      const zip = q.match(/^(\d{5})(?:-\d{4})?$/);
      if (zip) {
        const z = await zipLookup(zip[1]);
        return z ? ballot(z.state, z.districts, `ZIP ${zip[1]} · ${z.place}`, true) : none(q, `We couldn't find ZIP code ${zip[1]}. Double-check it, or try your city or street address.`);
      }
      const st = stateFrom(q);
      if (st) return stateView(st);
      // "my address is 12 Pine Rd ..." -> start at the street number
      const lead = q.match(/\b(\d{1,6}\s+[A-Za-z].*)$/);
      if (lead && !/^\d/.test(q) && /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|hwy|terrace|cir)\b\.?/i.test(lead[1])) q = lead[1];
      const looksLikeAddress = /^\d+\s+\S+/.test(q) && q.length > 8;
      const looksLikePlace = /,/.test(q) || /\d/.test(q);
      if (looksLikeAddress) {
        if (!hasLocality(q)) return none(q, 'That looks like a street address, but we also need a city and state or a ZIP code to find your districts.', ['Include the city and state, like “5 Main St, Buffalo, NY”', 'Or add your ZIP code, like “5 Main St 14203”']);
        const a = await censusAddress(q).catch(() => null);
        if (a?.state) return ballot(a.state, [a.district], a.matchedAddress, false);
      }
      if (!looksLikeAddress) { const people = searchPeople(q); if (people.length) return { kind: 'people', query: q, matches: people }; }
      const place = await placeLookup(q).catch(() => null);
      if (place?.state) return ballot(place.state, [place.district], place.label, !place.exact, place.exact ? [] : ['We couldn’t match that exact street address, so this shows the district at the center of the place we found. Check the address, or double-check with your ZIP code.']);
      // last resort: a ZIP code inside the text still gets the user their districts
      const embedded = q.match(/\b(\d{5})(?:-\d{4})?\b/);
      if (embedded) {
        const z = await zipLookup(embedded[1]).catch(() => null);
        if (z) return ballot(z.state, z.districts, `ZIP ${embedded[1]} · ${z.place}`, true, ['We couldn’t find that exact street address, so these are the districts for its ZIP code.']);
      }
      return none(q);
    } catch (e) {
      console.error('search failed', e);
      return none(q, 'Our location lookup is slow right now. Try a name, state or ZIP code, or try again in a moment.');
    }
  }

  /** Fast, local-only suggestions for the type-ahead dropdown. */
  function suggest(raw) {
    const q = (raw || '').trim().replace(/\s+/g, ' ');
    if (q.length < 2) return [];
    const out = [];
    if (/^\d{3,5}$/.test(q)) { if (q.length === 5) out.push({ type: 'zip', label: `ZIP code ${q}`, sub: 'Show races for this ZIP', q }); return out; }
    const t = ascii(q);
    for (const [ab, name] of Object.entries(STATE_NAMES)) if (ascii(name).startsWith(t) || ab.toLowerCase() === t) out.push({ type: 'state', label: name, sub: 'State · all 2026 races', q: name });
    out.splice(3);
    for (const m of searchPeople(q).slice(0, 6)) out.push({ type: 'person', label: m.name, sub: `${m.office} · ${m.party.split('/')[0]}${m.onBallot ? '' : ' · not on ballot'}`, photo: m.photo, match: m });
    return out;
  }
  /** the visitor's device location -> their ballot. Coordinates are used for this one lookup and never stored or logged. */
  async function locate(lat, lon) {
    lat = Number(lat); lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return none('', 'We couldn’t read your location. Try typing your address or ZIP code instead.');
    try {
      const p = await censusPointFresh(lat, lon);
      if (p?.state) return ballot(p.state, p.district == null ? [] : [p.district], 'Your current location', false);
      return none('', 'Your location doesn’t appear to be in a U.S. congressional district. Try typing your address or ZIP code instead.');
    } catch {
      return none('', 'Our location lookup is slow right now. Try again in a moment, or type your address or ZIP code.');
    }
  }
  return { search, searchPeople, suggest, locate };
}
