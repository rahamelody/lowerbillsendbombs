// Reads a position out of a candidate's OWN verbatim statements (campaign site, or a news quote of something they said).
// Deliberately narrow: each rule needs an explicit phrase ("pass Medicare for All", "arms embargo on Israel", "end the war in Iran").
// If nothing matches, we return null and the card keeps saying "Has stated a position", never a guess.
// Output tiers use the same scale as votes: full (dark green) / partial (light green) / mixed (amber) / against (red).

const RULES = {
  health: [
    { tier: 'against', label: 'States opposition to Medicare for All', re: /(oppose|against|reject)[^.]{0,40}(medicare for all|single[- ]payer)/i },
    { tier: 'against', label: 'States support for repealing the ACA', re: /(repeal|replace)[^.]{0,20}(affordable care act|\baca\b|obamacare)/i },
    { tier: 'partial', label: 'States support for a public option', re: /not-for-profit health ?care option|medicare for all who want it|public option/i },
    { tier: 'full', label: 'States support for Medicare for All', re: /medicare for all|single[- ]payer/i },
    { tier: 'full', label: 'States support for health care for all', re: /universal health ?care|health ?care (is|as) a (human )?right|guarantee[ds]? health ?care/i },
    { tier: 'partial', label: 'States support for protecting health care', re: /reverse[^.]{0,20}medicaid cuts|protect[^.]{0,30}rural hospitals|protect[^.]{0,30}(affordable care act|\baca\b|medicare|medicaid|obamacare)|(strengthen|expand)[^.]{0,30}(medicare|medicaid)|(cap|lower)[^.]{0,30}(insulin|prescription drug)|negotiate down the price of prescription drugs|health ?care that works for everyone/i },
  ],
  housing: [
    { tier: 'full', label: 'States support for rent protections', re: /rent (control|freeze|stabilization)|rent caps?\b|moratorium on evictions/i },
    { tier: 'full', label: 'States support for housing as a right', re: /social housing|housing (is|as) a (human )?right|(ban|end)[^.]{0,20}(corporate|institutional) (landlords|ownership)/i },
    { tier: 'partial', label: 'States support for protecting renters', re: /(corporate|wall street) landlords|protect(ing)? (renters|tenants)|protections for renters|tenant (protections|rights)/i },
  ],
  iran: [
    { tier: 'against', label: 'States support for the strikes', re: /how president trump dealt with iran|(?<!(?:not|never|longer|n[’'’]t) )support(ed|s)? (the )?(strikes|war|bombing) (on|in|against) iran/i },
    { tier: 'full', label: 'States opposition to the war', re: /\bwar (in|with|on) iran (needs?|has|must|should) (to )?end\b|\bend the (current )?(conflict|war|hostilities) (with|in|on) iran|vote (in support of|for|to pass) a war powers resolution[^.]{0,40}\b(stop|end)\b[^.]{0,30}\bwar\b|(do not|don.t|never|doesn.t) support[^.]{0,20}\bwar (in|with|on|against) iran|\b(get|pull|bring)[^.]{0,25}\bout of iran\b[^.]{0,60}\b(troops|home)|(end|stop|ending)[^.]{0,60}\bwar[^.]{0,30}\biran|\biran[^.]{0,40}(forever|endless|unauthorized|illegal|unnecessary) war|oppose[^.]{0,40}war (in|with|on|against) iran|war (in|with|on) iran[^.]{0,80}(unnecessary|illegal|unjustifiable|endless)|end the war (in|with|on) iran|immediate end to the hostilities|war we don.?t need/i },
  ],
  israel: [
    { tier: 'against', label: 'States strong support for Israel', re: /(stand|stands)[^.]{0,20}with israel|(steadfast|staunch|strong|loyal|unwavering) (ally|friend|supporter)s? (of|to) israel|(strongly )?(?<!(?:not|never|longer|n[’'’]t) )support israel\b|defend our allies like israel|strengthen the u\.?s\.?[–-]israel (alliance|relationship)/i },
    { tier: 'full', label: 'States support for halting arms sales', re: /\b(halt|stop|block|pause|suspend)(ing)?\b[^.]{0,25}\b(offensive )?(weapons|arms)( sales| transfers| shipments)?[^.]{0,15}\bto israel/i },
    { tier: 'full', label: 'States support for the Block the Bombs Act', re: /block the bombs/i },
    { tier: 'full', label: 'States support for an arms embargo', re: /arms embargo|stop arming israel/i },
    { tier: 'full', label: 'States support for ending military aid', re: /(end|cut(ting)? off|stop) (all )?(u\.?s\.? )?military aid|blank[- ]check funding|support (cutting|ending)[^.]{0,20}military aid/i },
    { tier: 'full', label: 'States support for ending aid to Israel', re: /\b(cut(ting)?|end(ing)?|stop(ping)?) (off )?all (u\.?s\.? )?(military )?aid to [^.]{0,40}\bisrael/i },
    { tier: 'full', label: 'Calls Gaza a genocide', re: /(believes|is|calls?|witnessed)[^.]{0,40}\bgenocide\b|genocide (in|of) (gaza|palestin)|stop[^.]{0,20}genocide/i },
    { tier: 'partial', label: 'States support for conditioning aid', re: /aid to israel should not be unconditional|not unconditional|blank checks?|phasing out[^.]{0,30}(arms|aid)|(conditions?|conditioning) (on )?(military )?aid/i },
    { tier: 'partial', label: 'Opposes U.S. support for settlements', re: /end to (u\.?s\.? |us )support for (illegal )?settlements/i },
  ],
};
// statements ABOUT what other people want, polls, or news framing are not the candidate's own position
const THIRD_PARTY = /\b(wants?|polls?|poll shows|percent)\b|%|^[A-Z][A-Z .'’-]{3,}\s*[–—-]\s|\b(?:voted|votes) (?:to|for|against)\b(?<!\bI voted (?:to|for|against)\b)|\bAdministration\b/;   // third-party wants/polls, datelined press releases, and attacks on someone else's votes
const RANK = { against: 3, full: 2, partial: 1 };

/** the first matching rule for one quote, or null */
const ISRAEL_CONTEXT = /israel|gaza|palestin|hamas|netanyahu|west bank|settle/i;   // generic phrases like "no more blank checks" only count when the line is actually about Israel
export function classify(topic, text) {
  if (!text || THIRD_PARTY.test(text)) return null;
  if (topic === 'israel' && !ISRAEL_CONTEXT.test(text)) return null;
  const rules = RULES[topic] || [];
  for (let i = 0; i < rules.length; i++) if (rules[i].re.test(text)) return { tier: rules[i].tier, label: rules[i].label, idx: i };   // idx: earlier rules are more specific
  return null;
}

/** combine many quotes: agreeing positives -> strongest (most specific rule first); any against alongside positives -> mixed; nothing matched -> null.
 *  `evidence` lists the indexes of the quotes that earned the label, so the card can show exactly those. */
export function classifyQuotes(topic, quotes) {
  const hits = (quotes || []).map((q, i) => { const h = classify(topic, q.text); return h && { ...h, i }; }).filter(Boolean);
  if (!hits.length) return null;
  const against = hits.filter(h => h.tier === 'against'), positive = hits.filter(h => h.tier !== 'against');
  // explicit opposition to Medicare for All isn't offset by lukewarm "protect Medicare / lower drug prices" lines; only a real pro-M4A statement makes it mixed
  if (topic === 'health' && against.length && positive.length && positive.every(h => h.tier === 'partial')) return { tier: 'against', label: against[0].label, evidence: against.filter(h => h.label === against[0].label).map(h => h.i) };
  if (against.length && positive.length) return { tier: 'mixed', label: 'Statements point both ways', evidence: hits.map(h => h.i) };
  if (against.length) return { tier: 'against', label: against[0].label, evidence: against.filter(h => h.label === against[0].label).map(h => h.i) };
  const best = [...positive].sort((a, b) => RANK[b.tier] - RANK[a.tier] || a.idx - b.idx)[0];
  return { tier: best.tier, label: best.label, evidence: positive.filter(h => h.label === best.label).map(h => h.i) };
}
