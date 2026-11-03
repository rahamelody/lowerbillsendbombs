// Turns a candidate's raw votes / FEC money / cosponsorships / curated quotes into the "record" the UI shows.
//
// Every badge gets a TIER, decided here and nowhere else, against this guide's stated priorities
// (affordability: Medicare for All + housing as a right; foreign policy: end the Iran war, stop arming Israel, no AIPAC money):
//   full    = aligned with those priorities          (dark green)
//   partial = partially aligned                      (light green)
//   mixed   = split / contradictory record           (amber)
//   against = not aligned                            (red)
//   null    = no record: no badge, never guessed     (gray)

import { classifyQuotes } from './stance.mjs';

const sum = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
const SECTOR_LABEL = { health: 'insurance & pharma PACs', realestate: 'real estate & landlord PACs', defense: 'defense contractor PACs' };

/** share of "aligned" actions -> tier (0.75+ full, 0.5+ partial, above 0.25 mixed, else against) */
const tierOf = share => (share >= 0.75 ? 'full' : share >= 0.5 ? 'partial' : share > 0.25 ? 'mixed' : 'against');

export function summarize(c, { votes, tally, keyVotes, statements, cosp = {}, stateRecords = {} }) {
  const mine = (c.bioguide && votes[c.bioguide]) || {};
  const stmt = (c.bioguide && statements[c.bioguide]) || (c.fecId && statements[c.fecId]) || (c.state && statements[`${c.name}|${c.state}`]) || {};
  const rows = keyVotes
    .filter(v => mine[v.id])
    .map(v => ({ id: v.id, date: v.date, chamber: v.chamber, topic: v.topic, kind: v.kind, title: v.title, weight: v.weight || 1, vote: mine[v.id], result: tally[v.id] ? `${tally[v.id].yea}–${tally[v.id].nay}` : null }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const stateRec = (c.state && stateRecords[`${c.name}|${c.state}`]) || null;   // their record in a STATE legislature (LegiScan): sponsorships and floor votes on bills that match strict topic rules
  const topicQuotes = t => ({ quotes: (stmt[t]?.quotes || []).slice(0, 3), flag: stmt[t]?.flag || null, note: stmt[t]?.note || null });
  const isHouse119 = Object.keys(mine).some(k => k.startsWith('H119-'));
  const member119 = !!(c.bioguide && cosp.members119?.has(c.bioguide));
  // cosponsorship: true = signed on; false = a sitting member who didn't (NEVER treated as opposition); null = can't say
  const cosponsor = (set, houseOnly) => {
    if (!set || !c.bioguide) return null;
    if (set.has(c.bioguide)) return true;
    return member119 && (!houseOnly || isHouse119) ? false : null;
  };
  const chip = (label, url, yes) => (yes == null ? null : { label, url, yes });
  // State legislative record -> badge (only when there is no congressional vote/cosponsorship badge). Words never override it.
  const applyState = (obj, topic) => {
    const rows = stateRec?.rows.filter(r => r.topic === topic) || [];
    if (!rows.length) return;
    obj.stateRows = rows; obj.stateMeta = { state: stateRec.state, chamber: stateRec.chamber, district: stateRec.district, url: stateRec.url };
    if (obj.badge) return;
    const sponsors = rows.filter(r => r.role), votesR = rows.filter(r => r.vote);
    const posSp = sponsors.filter(r => r.aligned === true), negSp = sponsors.filter(r => r.aligned === false);   // aligned: null = shown on the card, never scored
    const good = votesR.filter(r => (r.vote === 'Yea') === r.aligned).length, bad = votesR.length - good;
    const noun = { health: 'a state single-payer bill', housing: posSp.length > 1 ? `${posSp.length} state tenant-protection bills` : 'a state tenant-protection bill', israel: 'a state bill against funding settlement activity' }[topic];
    let tier = null, label = null;
    if (negSp.length && posSp.length) { tier = 'mixed'; label = 'Mixed state record'; }
    else if (negSp.length) { tier = 'against'; label = negSp.find(r => r.badgeLabel)?.badgeLabel || (topic === 'israel' ? 'Sponsors state bills penalizing boycotts of Israel' : `${negSp.some(r => r.role === 'Sponsor') ? 'Sponsors' : 'Cosponsors'} a state bill ${negSp[0].short || 'for ' + negSp[0].what}`); }
    else if (posSp.length) { tier = posSp[0].tier; label = `${posSp.some(r => r.role === 'Sponsor') ? 'Sponsors' : 'Cosponsors'} ${noun}`; }
    else if (votesR.length) {
      const what = topic === 'health' ? 'single-payer measures' : topic === 'housing' ? 'housing protections' : 'this measure';
      tier = bad === 0 ? 'partial' : good === 0 ? 'against' : 'mixed';
      label = bad === 0 ? `Voted for state ${what}` : good === 0 ? `Voted against state ${what}` : 'Mixed state votes';
    }
    if (tier) obj.badge = { tier, label, basis: 'state' };
  };
  // a position stated in their own words: a hand-set badge first, else the narrow phrase classifier. Votes and cosponsorships always win over this.
  // The quotes that earned the label are moved to the front of what the card displays, so the label is always backed by what's shown.
  const applyWords = (obj, topic) => {
    if (obj.badge) return;
    const st = stmt[topic], pool = st?.stanceQuotes || st?.quotes || [];
    const w = st?.badge ? { ...st.badge, evidence: [] } : classifyQuotes(topic, pool);
    if (!w) return;
    obj.badge = { tier: w.tier, label: w.label, basis: 'statements' };
    const seen = new Set();
    obj.quotes = [...(w.evidence || []).map(i => pool[i]), ...(obj.quotes || [])].filter(q => q && !seen.has(q.text) && seen.add(q.text)).slice(0, 3);
  };

  // ---- Iran war: a "Yea" on a war-powers resolution is a vote to end U.S. hostilities
  const iranRows = rows.filter(r => r.topic === 'iran');
  const iranCast = iranRows.filter(r => r.vote !== 'Absent');
  const endYea = iranCast.filter(r => r.vote === 'Yea').length;
  const iran = { votes: iranRows, stance: null, headline: null, badge: null, ...topicQuotes('iran') };
  if (iranCast.length) {
    const tier = tierOf(endYea / iranCast.length);
    iran.stance = tier;
    iran.badge = { tier, lean: tier === 'mixed', label: { full: 'Voted to end the war', partial: 'Mostly voted to end the war', mixed: 'Split on ending the war', against: 'Voted against ending the war' }[tier] };
    iran.counts = { endYea, endNay: iranCast.length - endYea, absent: iranRows.length - iranCast.length };
    iran.headline = tier === 'against'
      ? `Voted against ending U.S. hostilities with Iran in ${iranCast.length - endYea} of ${iranCast.length} war-powers votes`
      : `Voted to end U.S. hostilities with Iran in ${endYea} of ${iranCast.length} war-powers votes`;
  }
  applyWords(iran, 'iran'); iran.stance = iran.badge?.tier || null;
  // military budget: a Yea funds the military. Shown as a secondary line under the Iran war, not in the badge.
  const milRows = rows.filter(r => r.topic === 'military'), milCast = milRows.filter(r => r.vote !== 'Absent');
  const milYes = milCast.filter(r => r.vote === 'Yea').length;
  const military = { votes: milRows, headline: null, tier: null };
  if (milCast.length) {
    military.tier = milYes / milCast.length >= 0.75 ? 'against' : milYes / milCast.length <= 0.25 ? 'full' : 'mixed';
    military.headline = milYes === 0 ? `Voted no on all ${milCast.length} defense budget bills` : `Voted yes on ${milYes} of ${milCast.length} defense budget bills`;
  }

  // ---- Israel / Palestine
  // 'restrict' votes: Yea blocks/questions arms sales.  'aid' votes: Nay is a vote not to send more aid.  'support' resolutions are symbolic and unscored.
  // The main aid package (weight 3) counts triple so a yes on it isn't outweighed by no votes on two partisan bills.
  const isr = rows.filter(r => r.topic === 'israel');
  const castOf = k => isr.filter(r => k.includes(r.kind) && r.vote !== 'Absent');
  const aid = castOf(['aid']), sup = castOf(['support']), res = castOf(['restrict']);
  const y = a => a.filter(r => r.vote === 'Yea').length;
  const w = r => r.weight || 1;
  const bb = cosponsor(cosp.bb, true);
  const israel = { votes: isr, lean: null, headline: null, badge: null, cosponsor: chip('Block the Bombs Act', cosp.bbUrl, bb), ...topicQuotes('israel'),
    counts: { aid: [y(aid), aid.length], support: [y(sup), sup.length], restrict: [y(res), res.length] } };
  const scored = [...res, ...aid].reduce((t, r) => t + w(r), 0);
  if (scored) {
    const limiting = res.filter(r => r.vote === 'Yea').reduce((t, r) => t + w(r), 0) + aid.filter(r => r.vote === 'Nay').reduce((t, r) => t + w(r), 0);
    let tier = tierOf(limiting / scored);
    if (bb === true) tier = 'full';
    israel.lean = tier;
    israel.badge = { tier, lean: tier === 'mixed' && bb !== true, label: bb === true ? 'Backs blocking arms to Israel' : { full: 'Votes to block arms and aid', partial: 'Votes to limit arms/aid', mixed: 'Mixed votes on arms/aid', against: 'Votes to back Israel aid' }[tier] };
    const parts = [];
    if (aid.length) parts.push(`${y(aid)} of ${aid.length} Israel aid bills`);
    if (res.length) parts.push(`${y(res)} of ${res.length} resolutions to block or question arms sales`);
    israel.headline = `Voted yes on ${parts.join('; yes on ')}`;
  } else if (bb === true) {
    israel.lean = 'full'; israel.badge = { tier: 'full', label: 'Backs blocking arms to Israel' }; israel.headline = 'Cosponsors the Block the Bombs Act';
  } else if (sup.length) {
    israel.headline = `Voted on ${sup.length} symbolic resolution${sup.length > 1 ? 's' : ''} about Israel; no aid or arms-sale votes`;
  }

  // Bills this guide opposes: a cosponsorship or a yes vote is shown and counts against. (Not being on a list, or voting no, is never shown or counted.)
  const badBills = [];
  if (cosponsor(cosp.badDefense, false) === true) badBills.push({ verb: 'Cosponsors', label: 'United States-Israel Defense Partnership Act', url: cosp.badDefenseUrl });
  if (mine['H119-638'] === 'Yea') badBills.push({ verb: 'Voted for', label: 'fiscal 2027 defense authorization (NDAA), with Section 219 on U.S.–Israel defense cooperation', url: 'https://voteview.com/rollcall/RH1190638' });
  if (badBills.length) {
    israel.badBills = badBills;
    if (!israel.badge) { israel.badge = { tier: 'against', label: 'Backs U.S.–Israel defense integration' }; israel.headline = israel.headline || badBills.map(b => `${b.verb} the ${b.label}`).join('; '); }
    else if (israel.badge.tier !== 'against') israel.badge = { tier: 'mixed', label: 'Mixed: also backs U.S.–Israel defense integration' };
  }
  applyState(israel, 'israel');
  applyWords(israel, 'israel');

  // ---- Affordability: health care and housing. A vote "aligns" if it protects coverage/tenants ('protects' + Yea) or rejects cuts ('cuts' + Nay).
  const aligned = r => (r.kind === 'protects' && r.vote === 'Yea') || (r.kind === 'cuts' && r.vote === 'Nay');
  const afford = (topic, words, bill, bill2) => {
    const tr = rows.filter(r => r.topic === topic), cast = tr.filter(r => r.vote !== 'Absent');
    const good = cast.filter(aligned).length;
    const cos = bill ? cosponsor(bill.set, bill.houseOnly) : null, cos2 = bill2 ? cosponsor(bill2.set, bill2.houseOnly) : null;
    const t = { votes: tr, stance: null, headline: null, badge: null, cosponsor: bill ? chip(bill.label, bill.url, cos) : null, cosponsor2: bill2 ? chip(bill2.label, bill2.url, cos2) : null, ...topicQuotes(topic) };
    if (cast.length) {
      // votes alone top out at "partial": only a cosponsorship (Medicare for All / housing bills) earns the top tier
      const tier = tierOf(good / cast.length);
      t.headline = `${words.pre} ${good} of ${cast.length} ${words.noun}`;
      t.counts = { good, bad: cast.length - good };
      t.badge = { tier: tier === 'full' ? 'partial' : tier, lean: tier === 'mixed', label: words.labels[tier] };
    }
    const signed = [[bill, cos], [bill2, cos2]].filter(([, c]) => c === true).map(([b]) => b);
    if (signed.length) { t.badge = { tier: 'full', label: signed[0].cosLabel || words.cosLabel }; t.headline = t.headline || `Cosponsors ${signed.map(b => b.short).join(' and ')}`; }
    applyState(t, topic);
    applyWords(t, topic);
    t.stance = t.badge?.tier || null;
    return t;
  };
  const health = afford('health',
    { pre: 'Voted to protect or expand health coverage on', noun: 'key health care votes', cosLabel: 'Backs Medicare for All', labels: { full: 'Votes to protect health care', partial: 'Votes to protect health care', mixed: 'Mixed votes on health care', against: 'Votes to cut health care' } },
    cosp.m4a && { set: cosp.m4a, label: 'Medicare for All Act', short: 'Medicare for All', url: cosp.m4aUrl });
  const housing = afford('housing',
    { pre: 'Voted to rein in hedge-fund landlords on', noun: 'housing votes', cosLabel: 'Backs housing as a right', labels: { full: 'Votes to rein in hedge-fund landlords', partial: 'Votes to rein in hedge-fund landlords', mixed: 'Mixed votes on housing', against: 'Votes against reining in landlords' } },
    cosp.housing && { set: cosp.housing, label: 'Housing Is a Human Right Act', short: 'the Housing Is a Human Right Act', url: cosp.housingUrl, houseOnly: true, cosLabel: 'Backs housing as a right' },
    cosp.gndph && { set: cosp.gndph, label: 'Green New Deal for Public Housing Act', short: 'the Green New Deal for Public Housing Act', url: cosp.gndphUrl, cosLabel: 'Backs public housing investment' });

  // ---- Money
  const totals = { direct: sum(c.money.direct), ieSupport: sum(c.money.ieSupport), ieOppose: sum(c.money.ieOppose), conduitSupport: sum(c.money.conduitSupport), conduitOppose: sum(c.money.conduitOppose) };
  const member = !!(c.incumbent || c.formerMember || c.sittingElsewhere);   // people who could have taken this money; for challengers $0 is the default and says little
  const backing = totals.direct + totals.ieSupport + totals.conduitSupport;   // conduit = groups UDP gave money to; their spending on the candidate
const opposed = totals.ieOppose + totals.conduitOppose;
  const industry = { applicable: member };
  for (const k of ['health', 'realestate', 'defense']) {
    const total = sum(c.industry?.[k]);
    industry[k] = { total, label: SECTOR_LABEL[k], tier: total > 0 ? 'against' : member ? 'full' : null };
  }

  return {
    // red: AIPAC-linked money for them.  green: AIPAC-linked groups spent AGAINST them (the strongest signal), or a sitting/former member took none.
    // A challenger with $0 either way stays neutral: they were never likely to be offered it, so $0 says little.
    money: { direct: c.money.direct, ieSupport: c.money.ieSupport, ieOppose: c.money.ieOppose, conduitSupport: c.money.conduitSupport, conduitOppose: c.money.conduitOppose, totals, tier: backing > 0 ? 'against' : opposed > 0 ? 'full' : member ? 'full' : null, targeted: backing === 0 && opposed > 0, opposed, note: (cosp.moneyNotes || {})[c.fecId] || null },
    industry, military,
    iran, israel, health, housing,
    hasRecord: rows.length > 0,
  };
}
