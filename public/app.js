const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = n => '$' + Math.round(n).toLocaleString('en-US');
const PARTY = { CON: 'Conservative', D: 'Democrat', R: 'Republican', L: 'Libertarian', G: 'Green', I: 'Independent', C: 'Constitution', WFP: 'Working Families', NL: 'Natural Law' };
const badge = b => `<span class="badge t-${esc(b.tier)}${b.basis === 'statements' ? ' words' : ''}"${b.basis === 'statements' ? ' title="From their own words, not votes"' : ''}>${esc(b.label)}</span>`;

const cycles = o => Object.entries(o || {}).filter(([, v]) => v).sort(([a], [b]) => b - a).map(([cy, v]) => `${cy}: ${usd(v)}`).join(' · ');
const partyName = p => p.split('/').map(x => PARTY[x] || x).join(' / ');
const initials = name => name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();

const backing = rec => rec.money.totals.direct + rec.money.totals.ieSupport + (rec.money.totals.conduitSupport || 0);
/** AIPAC-linked money, shown like every other PAC line: red when taken, green check when a member took none, green when AIPAC-linked groups spent against them */
function aipacLines(rec) {
  const t = rec.money.totals, total = backing(rec), opp = rec.money.opposed || 0;
  const tip = `AIPAC PAC direct: ${usd(t.direct)}; United Democracy Project (AIPAC's super PAC) spent in support: ${usd(t.ieSupport)}; spent by groups UDP funded: ${usd(t.conduitSupport || 0)}${opp ? `; spent against them (incl. those groups): ${usd(opp)}` : ''}`;
  let html = '';
  if (total) html += `<p class="cos bad" title="${esc(tip)}">${usd(total)} from AIPAC-linked PACs and super PAC spending</p>`;
  else if (rec.money.tier === 'full') html += `<p class="cos yes" title="${esc(tip)}">✓ No AIPAC-linked PAC money found</p>`;
  if (opp) html += `<p class="cos ${total ? '' : 'yes'}" title="${esc(tip)}">${total ? '' : '✓ '}AIPAC-linked groups ${total ? 'also ' : ''}spent ${usd(opp)} against them</p>`;
  return html;
}

function votesList(votes) {
  return `<details><summary>All ${votes.length} ${votes.length === 1 ? 'vote' : 'votes'}</summary><ul class="votes">${votes.map(v =>
    `<li><span class="v ${esc(v.vote)}">${v.vote === 'Absent' ? 'No vote' : esc(v.vote)}</span><span>${esc(v.title)}<span class="d">${esc(v.date)} · ${v.chamber === 'house' ? 'House' : 'Senate'}${v.result ? ' · ' + esc(v.result) : ''}</span></span></li>`).join('')}</ul></details>`;
}

function quotesHTML(quotes) {
  return quotes.map(q => `<figure class="quote"><blockquote>“${esc(q.text)}”</blockquote><figcaption>${q.url ? `<a href="${esc(q.url)}" rel="noopener" target="_blank">${esc(q.source || 'Source')}</a>` : esc(q.source || '')}${q.date ? ` · ${esc(q.date)}` : ''}</figcaption></figure>`).join('');
}

function cosponsorChip(co) {
  if (!co) return '';
  const link = `<a href="${esc(co.url)}" rel="noopener" target="_blank">${esc(co.label)}</a>`;
  return co.yes ? `<p class="cos yes">✓ Cosponsors the ${link}</p>` : `<p class="cos no">Not a cosponsor of the ${link}</p>`;
}
/** "$X from insurance & pharma PACs" (red) or "No ... PAC money" (green, only for people who could have taken it) */
function industryChip(ind) {
  if (ind.total > 0) return `<p class="cos bad">${usd(ind.total)} from ${esc(ind.label)}</p>`;
  return ind.tier === 'full' ? `<p class="cos yes">✓ No ${esc(ind.label.replace('PACs', 'PAC'))} money found</p>` : '';
}

// extras shown under a topic's badge: cosponsorship, industry money, the defense-budget record
function extras(topic, r, rec) {
  if (topic === 'health') return cosponsorChip(r.cosponsor) + industryChip(rec.industry.health);
  if (topic === 'housing') return cosponsorChip(r.cosponsor) + cosponsorChip(r.cosponsor2) + industryChip(rec.industry.realestate);
  if (topic === 'israel') return cosponsorChip(r.cosponsor) + aipacLines(rec);
  if (topic === 'iran') {
    const m = rec.military;
    return (m.headline ? `<p class="cos ${m.tier === 'full' ? 'yes' : m.tier === 'against' ? 'bad' : ''}">${esc(m.headline)}</p>` : '') + industryChip(rec.industry.defense);
  }
  return '';
}

/** PAC money that bears on a topic, as a collapsed-row pill: insurance/pharma -> health care, real estate -> housing, defense contractors -> Iran, AIPAC-linked -> Israel */
function pacPill(topic, rec) {
  if (topic === 'israel') {
    const total = backing(rec), opp = rec.money.opposed || 0;
    if (total) return `<span class="badge t-against">${usd(total)} from AIPAC-linked PACs</span>`;
    if (opp) return `<span class="badge t-full">AIPAC-linked groups spent ${usd(opp)} against them</span>`;
    return '';
  }
  const ind = rec.industry[{ health: 'health', housing: 'realestate', iran: 'defense' }[topic]];
  return ind?.total > 0 ? `<span class="badge t-against">${usd(ind.total)} from ${esc(ind.label)}</span>` : '';
}

/** Collapsed view: only the high-level label. Details live in topicCell(), revealed on click.
 *  With no vote or cosponsorship record, we show whatever else we know (their quotes, any PAC money) before falling back to "No record". */
function topicSummary(topic, rec) {
  const r = rec[topic];
  if (r.badge) return badge(r.badge);
  const quoted = r.quotes?.length ? '<span class="badge t-quoted">Has stated a position</span>' : '';
  const money = pacPill(topic, rec);
  return quoted + money || '<span class="badge t-none">No record</span>';
}

/** state-legislature record: each sponsorship / floor vote with a link to the bill */
function stateBlock(r) {
  if (!r.stateRows?.length) return '';
  const m = r.stateMeta, shown = r.stateRows.slice(0, 6), more = r.stateRows.length - shown.length;
  const what = x => (x.vote ? `Voted ${x.vote}${x.result ? ` (${esc(x.result)})` : ''}` : esc(x.role));
  return `<div class="state-rec"><div class="qlabel">State record · ${esc(m.state)} ${esc(m.chamber)} · <a href="${esc(m.url)}" rel="noopener" target="_blank">LegiScan</a></div><ul>${shown.map(x => `<li><b>${what(x)}</b> · <a href="${esc(x.url)}" rel="noopener" target="_blank">${esc(x.bill)}</a> ${esc(x.title.length > 120 ? x.title.slice(0, 117) + '…' : x.title)}</li>`).join('')}${more > 0 ? `<li class="sub">+ ${more} more</li>` : ''}</ul></div>`;
}

function topicCell(topic, rec, c) {
  const r = rec[topic];
  const flag = r.flag ? `<div class="shift">↻ Position has shifted. ${esc(r.flag)}</div>` : '';
  const quotes = r.quotes?.length ? `${flag}<div class="qlabel">In their own words</div>${quotesHTML(r.quotes)}` : '';
  const votes = r.votes.length ? votesList(r.votes) : '';
  const ex = extras(topic, r, rec);
  // a badge exists only when there is a vote or cosponsorship behind it; otherwise we show quotes, or say there's no record
  const stateHtml = stateBlock(r);
  if (r.badge?.basis === 'state') return `<p class="sub">Based on their state legislative record, not votes in Congress.</p>${stateHtml}${quotes}${ex}${votes}`;
  if (r.badge?.basis === 'statements') return `<p class="sub">Based on their own words below, not votes.</p>${quotes}${ex}${votes}`;
  if (r.badge) return `${r.headline ? `<p class="txt">${esc(r.headline)}.</p>` : ''}${ex}${votes}`;   // the badge itself is the collapsed header
  if (quotes) return `${quotes}${ex}`;
  if (ex) return `${ex}<div class="sub">${c.incumbent || c.formerMember ? 'No recorded votes in our list, and no sourced quote yet.' : 'No voting record, and no sourced quote on file yet.'}</div>`;
  return `<span class="dash">—</span><div class="sub">${c.incumbent || c.formerMember ? 'No recorded votes in our list, and no sourced quote yet.' : 'No voting record, and no sourced quote on file yet.'}</div>`;
}

let FOCUS = null;
const STATE_NAME = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'D.C.', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };

/** "U.S. Senate · MI" / "U.S. House · MI-13" / "U.S. House · Georgia" -> kicker + big place name */
function splitTitle(title) {
  const [office, place = ''] = title.split(' · ');
  const m = place.match(/^([A-Z]{2})(?:-(\w+))?$/);
  if (!m) return { kicker: office, place };
  const name = STATE_NAME[m[1]] || m[1];
  return { kicker: office, place: m[2] ? `${name} <em>${m[2] === 'AL' ? 'at-large' : 'District ' + esc(m[2])}</em>` : name };
}

function card(c, extra = false) {
  const focus = FOCUS && c.name === FOCUS;
  const photo = c.photo
    ? `<img class="photo" src="${esc(c.photo)}" alt="Portrait of ${esc(c.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'initials',textContent:'${esc(initials(c.name))}'}))">`
    : `<div class="initials" aria-hidden="true">${esc(initials(c.name))}</div>`;
  const status = c.incumbent ? '<p class="status-line inc">★ Incumbent</p>' : c.sittingElsewhere ? `<p class="status-line">Currently serves in the ${esc(c.sittingElsewhere)}</p>` : c.formerMember ? '<p class="status-line">Former member of Congress</p>' : '<p class="status-line">Challenger</p>';
  return `<article class="ccard${focus ? ' focus' : ''}${extra ? ' extra' : ''}"${focus ? ' id="focus-col"' : ''}>
    <div class="c-head">${photo}${c.photo && c.photoCredit && c.photoCredit !== 'Official congressional portrait' ? `<span class="credit">Photo: ${esc(c.photoCredit)}</span>` : ''}<h3>${esc(c.name)}</h3>${status}</div>
    ${[['health', 'Health care'], ['housing', 'Housing'], ['iran', 'Iran war'], ['israel', 'Israel / Palestine']].map(([t, label]) => `<div class="c-sec" data-topic="${t}"><button type="button" class="sec-head" aria-expanded="false"><h4>${label}</h4>${topicSummary(t, c.record)}<span class="chev" aria-hidden="true"></span></button><div class="c-detail" hidden>${topicCell(t, c.record, c)}</div></div>`).join('')}
  </article>`;
}

function race(r, title, opts = {}) {
  const cs = r.candidates;
  const { kicker, place } = splitTitle(title);
  const tags = opts.tags ? opts.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')
    : `<span class="tag ${r.openSeat ? 'open' : ''}">${r.openSeat ? 'Open seat' : 'Incumbent running'}</span><span class="tag">${cs.length} candidate${cs.length > 1 ? 's' : ''}</span>${r.special ? '<span class="tag">Special election</span>' : ''}`;
  const listNote = cs.some(c => c.fromList) ? `<p class="note">This candidate list is built from nominee announcements rather than official results. Check your sample ballot to confirm.</p>` : '';
  return `<section class="race reveal">
    <header class="race-head"><div><p class="kicker">${esc(kicker)}</p><h2>${place}</h2></div><div class="tags">${tags}</div></header>
    ${listNote}
    <div class="race-tools"><span>Tap any row to see the details for every candidate.</span><button type="button" class="expand-all">Expand all</button></div>
    <div class="grid-wrap"><div class="rgrid">${cs.map(c => card(c, c.featured === false)).join('')}</div></div>
    ${cs.some(c => c.featured === false) ? `<button type="button" class="more-toggle" data-more="${cs.filter(c => c.featured === false).length}" aria-expanded="false">Show ${cs.filter(c => c.featured === false).length} more on this ballot</button>` : ''}
  </section>`;
}

const results = $('#results');
const footerHTML = () => `<aside class="before-vote reveal"><div><h3>Before you vote</h3><p>Election Day is <strong>Tuesday, Nov. 3</strong>. Check your polling place and what’s on your full ballot:</p>
  <p class="links"><a href="https://www.vote.gov/" rel="noopener" target="_blank">Find your polling place ↗</a><a href="https://ballotpedia.org/Sample_Ballot_Lookup_Tool" rel="noopener" target="_blank">See your full sample ballot ↗</a><a href="https://www.vote411.org/" rel="noopener" target="_blank">Vote411 voter guide ↗</a></p></div>
  <div><h3>About this guide</h3><p>Lower my Bills, End the Bombs has a point of view. It looks at two themes: affordability (health care and housing) and foreign policy (the Iran war, Israel/Palestine and AIPAC-linked money). It isn’t a full picture of any candidate. <a href="#method">About this project.</a></p></div></aside>`;
const legendHTML = () => `<p class="lens-key" aria-label="Color key"><span class="k full">Aligned with this guide’s priorities</span><span class="k partial">Partially aligned</span><span class="k mixed">Mixed</span><span class="k against">Not aligned</span><span class="k none">No record</span></p>`;
const noteHTML = n => `<p class="note">${esc(n)}</p>`;
const houseTitle = r => `U.S. House · ${r.state}-${r.district === 0 ? 'AL' : r.district}`;
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.08 }) : null;
const reveal = root => (root || document).querySelectorAll('.reveal:not(.in)').forEach(el => io ? io.observe(el) : el.classList.add('in'));
const setAsof = meta => {
  const fmt = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  $('#asof').textContent = `Independent spending: FEC filings received through ${fmt(meta?.filingsThrough) || 'the last data refresh'}${meta?.liveCheckedAt ? `, and checked against FEC’s live e-filing feed on ${fmt(meta.liveCheckedAt.slice(0, 10))}` : ''}. Contributions and transfers between committees appear only when a committee files its periodic report, so the newest weeks can lag. Votes through the latest Voteview update.`;
};
fetch('/api/meta').then(r => r.json()).then(setAsof).catch(() => {});
const afterRender = d => {
  reveal(results);
  setAsof(d?.meta);
  const f = $('#focus-col'); if (f) f.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function renderBallot(d) {
  const parts = [`<p class="where">Showing races for <strong>${esc(d.label)}</strong>${d.approx ? ' · approximate area' : ''}</p>`];
  parts.push(legendHTML());
  d.notes.forEach(n => parts.push(noteHTML(n)));
  d.senate.forEach(r => parts.push(race(r, `U.S. Senate · ${r.state}`)));
  d.houses.forEach(r => parts.push(race(r, houseTitle(r) + (d.houses.length > 1 ? ` (${r.districtLabel})` : ''))));
  parts.push(footerHTML());
  results.innerHTML = parts.join('');
}

function renderState(d) {
  const parts = [`<p class="where">All 2026 U.S. House and Senate races in <strong>${esc(d.stateName)}</strong></p>`];
  parts.push(legendHTML());
  d.notes.forEach(n => parts.push(noteHTML(n)));
  d.senate.forEach(r => parts.push(race(r, `U.S. Senate · ${r.state}`)));
  if (d.houseRaces.length) {
    parts.push(`<section class="race"><div class="race-head"><h2>U.S. House · ${esc(d.stateName)}</h2><span class="tag">${d.houseRaces.length} district${d.houseRaces.length > 1 ? 's' : ''}</span></div><ul class="dlist">${d.houseRaces.map(h => `
      <li class="drow" data-key="${esc(h.key)}"><div class="dhead"><strong>${d.houseRaces.length === 1 && h.district === 0 ? 'At-large' : h.district === 0 ? 'At-large' : 'District ' + h.district}</strong>${h.openSeat ? '<span class="tag open">Open seat</span>' : ''}
        <span class="chips">${h.candidates.map(c => `<span class="mini">${esc(c.name)}${c.incumbent ? ' ★' : ''}</span>`).join('')}${h.more ? `<span class="mini">+${h.more} more</span>` : ''}</span>
        <button class="linkbtn" type="button" data-compare="${esc(h.key)}">Compare →</button></div><div class="dbody"></div></li>`).join('')}</ul></section>`);
  }
  parts.push(footerHTML());
  results.innerHTML = parts.join('');
  results.querySelectorAll('[data-compare]').forEach(b => b.addEventListener('click', async () => {
    const li = b.closest('.drow'), body = li.querySelector('.dbody');
    if (body.innerHTML) { body.innerHTML = ''; b.textContent = 'Compare →'; return; }
    b.textContent = 'Loading…';
    const r = await (await fetch('/api/race?key=' + encodeURIComponent(b.dataset.compare))).json();
    body.innerHTML = race(r, houseTitle(r)); reveal(body); b.textContent = 'Hide ↑';
  }));
}

function renderPeople(d) {
  const one = d.matches.length;
  results.innerHTML = one === 1 ? '<div id="detail"></div>' : `<p class="where">${one} matches for <strong>“${esc(d.query)}”</strong></p><ul class="people">${d.matches.map((m, i) => `
    <li><button type="button" class="pcard" data-i="${i}">
      ${m.photo ? `<img class="pphoto" src="${esc(m.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'pphoto ini',textContent:'${esc(initials(m.name))}'}))">` : `<div class="pphoto ini">${esc(initials(m.name))}</div>`}
      <span class="ptext"><strong>${esc(m.name)}</strong><br><span class="sub">${esc(m.office)}</span><br><span class="sub">${esc(m.status)}</span></span><span class="go">View ›</span></button></li>`).join('')}</ul><div id="detail"></div>`;
  const open = async m => {
    const box = $('#detail'); box.innerHTML = `<p class="status"><span class="spinner"></span>Loading…</p>`;
    FOCUS = m.name;
    if (m.raceKey) { const r = await (await fetch('/api/race?key=' + encodeURIComponent(m.raceKey))).json(); box.innerHTML = legendHTML() + race(r, m.office); reveal(box); }
    else {
      const c = await (await fetch('/api/person?bioguide=' + encodeURIComponent(m.bioguide))).json();
      box.innerHTML = race({ candidates: [c] }, m.office, { tags: [m.status] }) + noteHTML('This official is not on the 2026 ballot. Their money and voting record are shown for reference.'); reveal(box);
    }
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const f = $('#focus-col'); if (f) f.scrollIntoView({ inline: 'center', block: 'nearest' });
  };
  results.querySelectorAll('.pcard').forEach(b => b.addEventListener('click', () => open(d.matches[+b.dataset.i])));
  if (one === 1) open(d.matches[0]);
}

function renderNone(d) {
  results.innerHTML = `<div class="status"><strong>${esc(d.message)}</strong><p class="sub" style="margin:8px 0 4px">Try searching for:</p><ul class="tips">${d.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
}

async function runSearch(q) {
  setLocate(false);
  const btn = $('#form button[type=submit]'); btn.disabled = true;
  results.innerHTML = `<p class="status"><span class="spinner"></span>Searching…</p>`;
  FOCUS = null;
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q));
    const d = await res.json();
    ({ ballot: renderBallot, state: renderState, people: renderPeople, none: renderNone }[d.kind] || renderNone)(d);
    afterRender(d);
    if (q) history.replaceState(null, '', '?q=' + encodeURIComponent(q));
  } catch {
    const offline = location.protocol === 'file:' || !location.host;
    renderNone({ message: offline ? 'This page was opened as a file, so search has no server to talk to. Start the app with “npm start” and open http://localhost:3000.' : 'We couldn’t reach the server. If you’re running this locally, make sure “npm start” is still running, then try again.', tips: [] });
  } finally { btn.disabled = false; }
}

const setLocate = on => $('#locate').setAttribute('aria-pressed', String(on));   // black = on, white = off
// "Use my location": the browser asks permission, then we send the coordinates once to look up the districts (nothing is stored)
$('#locate').addEventListener('click', () => {
  const btn = $('#locate');
  if (btn.getAttribute('aria-pressed') === 'true') return setLocate(false);   // second click turns it off
  const fail = message => renderNone({ message, tips: ['Type your address, ZIP code, city or state in the search box', 'Or search for a candidate by name'] });
  if (!navigator.geolocation) return fail('Your browser can’t share its location. Type your address or ZIP code instead.');
  btn.disabled = true; setLocate(true); results.innerHTML = `<p class="status"><span class="spinner"></span>Finding your location…</p>`; results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      FOCUS = null;
      const d = await (await fetch(`/api/locate?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`)).json();
      ({ ballot: renderBallot, none: renderNone }[d.kind] || renderNone)(d);
      afterRender(d); history.replaceState(null, '', location.pathname);
    } catch { setLocate(false); fail('We couldn’t reach the server. Try typing your address or ZIP code.'); }
    btn.disabled = false;
  }, err => {
    btn.disabled = false; setLocate(false);
    fail(err.code === 1 ? 'Location is turned off for this site. Allow it in your browser’s settings, or type your address or ZIP code.' : 'We couldn’t get your location. Type your address or ZIP code instead.');
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
});

$('#form').addEventListener('submit', e => { e.preventDefault(); if (active >= 0 && items[active]) return choose(items[active]); closeSugg(); runSearch($('#addr').value.trim()); });

// ---- type-ahead suggestions (combobox pattern: arrows move, Enter/click choose, Esc closes)
const input = $('#addr'), list = $('#sugg');
let items = [], active = -1, timer = null, reqId = 0;
const hl = (text, q) => { const i = text.toLowerCase().indexOf(q.toLowerCase()); return i < 0 ? esc(text) : esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length)); };
function closeSugg() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
function setActive(i) {
  active = i;
  [...list.children].forEach((li, k) => li.setAttribute('aria-selected', k === i ? 'true' : 'false'));
  if (i >= 0) { input.setAttribute('aria-activedescendant', 'sg' + i); list.children[i].scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
}
function showSugg(q) {
  if (!items.length) return closeSugg();
  list.innerHTML = items.map((it, i) => `<li id="sg${i}" role="option" aria-selected="false" data-i="${i}">
    ${it.type === 'person' ? (it.photo ? `<img class="sp" src="${esc(it.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;sp&quot;>${esc(initials(it.label))}</div>'">` : `<div class="sp">${esc(initials(it.label))}</div>`) : `<div class="sp state">${it.type === 'zip' ? 'ZIP' : esc(it.label.slice(0, 2).toUpperCase())}</div>`}
    <div class="st"><b>${hl(it.label, q)}</b><span>${esc(it.sub)}</span></div></li>`).join('');
  list.hidden = false; input.setAttribute('aria-expanded', 'true'); active = -1;
}
function choose(it) {
  closeSugg();
  if (it.type === 'person') { input.value = it.label; FOCUS = it.match.name; renderPeople({ query: it.label, matches: [it.match] }); afterRender(null); history.replaceState(null, '', '?q=' + encodeURIComponent(it.label)); }
  else { input.value = it.q; runSearch(it.q); }
}
input.addEventListener('input', () => {
  clearTimeout(timer);
  const q = input.value.trim();
  if (q.length < 2) { items = []; return closeSugg(); }
  timer = setTimeout(async () => {
    const id = ++reqId;
    try { const d = await (await fetch('/api/suggest?q=' + encodeURIComponent(q))).json(); if (id !== reqId) return; items = d.suggestions || []; showSugg(q); } catch { closeSugg(); }
  }, 120);
});
input.addEventListener('keydown', e => {
  if (list.hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % items.length); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + items.length) % items.length); }
  else if (e.key === 'Escape') closeSugg();
});
list.addEventListener('mousedown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); choose(items[+li.dataset.i]); } });
input.addEventListener('blur', () => setTimeout(closeSugg, 100));

document.querySelectorAll('[data-example]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); $('#addr').value = a.dataset.example; runSearch(a.dataset.example); }));

const qs = new URLSearchParams(location.search);
const initial = qs.get('q') || qs.get('address');
if (initial) { $('#addr').value = initial; runSearch(initial); }

// ---- collapsible topic rows: opening a topic opens it for every candidate in that race, so the side-by-side stays aligned
function setOpen(raceEl, topic, open) {
  raceEl.querySelectorAll(`.c-sec[data-topic="${topic}"]`).forEach(sec => {
    sec.classList.toggle('open', open);
    sec.querySelector('.sec-head').setAttribute('aria-expanded', open);
    sec.querySelector('.c-detail').hidden = !open;
  });
}
document.addEventListener('click', e => {
  const head = e.target.closest('.sec-head');
  if (head) { const sec = head.closest('.c-sec'); setOpen(head.closest('.race'), sec.dataset.topic, !sec.classList.contains('open')); return; }
  const all = e.target.closest('.expand-all');
  if (all) {
    const race = all.closest('.race'), open = all.dataset.open !== 'true';
    ['health', 'housing', 'iran', 'israel'].forEach(t => setOpen(race, t, open));
    all.dataset.open = open; all.textContent = open ? 'Collapse all' : 'Expand all';
    return;
  }
  // minor candidates (no major party, no record, little money) start collapsed; the button reveals them in the same comparison
  const more = e.target.closest('.more-toggle');
  if (more) {
    const grid = more.previousElementSibling.querySelector('.rgrid'), open = grid.classList.toggle('show-extra');
    more.setAttribute('aria-expanded', open); more.textContent = open ? 'Show fewer' : `Show ${more.dataset.more} more on this ballot`;
  }
});

// floating portraits in the hero: a random handful of the candidates this project endorses (data/endorsed.json). Each one opens that candidate's record.
fetch('/api/featured').then(r => r.json()).then(({ tiles }) => {
  const box = $('#tiles');
  tiles.slice(0, 8).forEach((t, i) => {
    const a = document.createElement('a');
    a.className = `tile t${i}`; a.href = '/?q=' + encodeURIComponent(t.name);
    a.title = `${t.name}: endorsed by this project. See their record.`; a.setAttribute('aria-label', `${t.name}, endorsed by this project. See their record.`);
    const img = new Image(); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = t.photo;
    img.onload = () => { a.appendChild(img); box.appendChild(a); setTimeout(() => a.classList.add('in'), 120 * i); };
    a.addEventListener('click', e => { e.preventDefault(); $('#addr').value = t.name; runSearch(t.name); });
  });
}).catch(() => {});
