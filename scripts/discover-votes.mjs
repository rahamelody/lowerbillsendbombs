// Scans House/Senate roll-call XML for Israel/Iran/Gaza-related votes. Usage: node scripts/discover-votes.mjs > candidates.json
const KW = /israel|iran|gaza|palestin|hamas|unrwa|hezbollah|houthi|antisemit|war powers|icc\b|international criminal/i;
const tag = (x, t) => (x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }
const get = async u => { for (let a = 0; a < 3; a++) { try { const r = await fetch(u); if (r.status === 404) return null; if (r.ok) return await r.text(); } catch {} } return null; };
const found = [];
// House: sessions by year; roll numbers sequential until 404 streak
for (const year of [2023, 2024, 2025, 2026]) {
  let miss = 0;
  for (let start = 1; miss < 3 && start < 1400; start += 40) {
    const nums = Array.from({ length: 40 }, (_, i) => start + i);
    const res = await pool(nums, 20, n => get(`https://clerk.house.gov/evs/${year}/roll${String(n).padStart(3, '0')}.xml`));
    miss = res.every(r => r === null) ? miss + 1 : 0;
    res.forEach((x, i) => { if (!x) return; const desc = tag(x, 'vote-desc') + ' | ' + tag(x, 'legis-num'); const q = tag(x, 'vote-question'); if (KW.test(desc)) found.push({ chamber: 'house', year, roll: nums[i], date: tag(x, 'action-date'), bill: tag(x, 'legis-num'), question: q, desc: tag(x, 'vote-desc'), result: tag(x, 'vote-result') }); });
  }
}
// Senate: congress/session pairs
for (const [c, s] of [[118, 1], [118, 2], [119, 1], [119, 2]]) {
  let miss = 0;
  for (let start = 1; miss < 3 && start < 1000; start += 40) {
    const nums = Array.from({ length: 40 }, (_, i) => start + i);
    const res = await pool(nums, 20, n => get(`https://www.senate.gov/legislative/LIS/roll_call_votes/vote${c}${s}/vote_${c}_${s}_${String(n).padStart(5, '0')}.xml`));
    miss = res.every(r => r === null) ? miss + 1 : 0;
    res.forEach((x, i) => { if (!x) return; const t = [tag(x, 'vote_question_text'), tag(x, 'vote_title'), tag(x, 'vote_document_text'), tag(x, 'question')].join(' | '); if (KW.test(t)) found.push({ chamber: 'senate', congress: c, session: s, roll: nums[i], date: tag(x, 'vote_date'), question: tag(x, 'question'), desc: t, result: tag(x, 'vote_result_text') || tag(x, 'vote_result') }); });
  }
}
console.log(JSON.stringify(found, null, 1));
