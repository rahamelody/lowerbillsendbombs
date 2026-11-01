// "Who backs the bills": every sponsor and cosponsor of the Medicare for All, Housing Is a Human Right and Block the Bombs acts.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = n => n.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
const partyKey = p => (p || '').split('/')[0];
const partyName = p => ({ D: 'Democrat', R: 'Republican', I: 'Independent' }[partyKey(p)] || p || '');
const seat = m => m.chamber === 'senate' ? `Senate · ${m.state}` : `House · ${m.state}${m.district === 0 ? '-AL' : m.district ? '-' + m.district : ''}`;

let data, current = new URLSearchParams(location.search).get('bill') || 'm4a', chamber = 'all', q = '';

function tabs() {
  $('#tabs').innerHTML = data.bills.map(b => `<button type="button" role="tab" class="bp-tab" aria-selected="${b.key === current}" data-k="${b.key}">${esc(b.title)} <span>${b.count}</span></button>`).join('');
}
function panel() {
  const b = data.bills.find(x => x.key === current) || data.bills[0];
  const needle = q.trim().toLowerCase();
  const rows = b.members.filter(m => (chamber === 'all' || m.chamber === chamber) && (!needle || `${m.name} ${m.state} ${partyName(m.party)}`.toLowerCase().includes(needle)));
  const chips = [['all', `All ${b.count}`], ['house', `House ${b.house}`], ...(b.senate ? [['senate', `Senate ${b.senate}`]] : [])];
  $('#panel').innerHTML = `
    <div class="bp-head">
      <h2>${esc(b.title)}</h2>
      <p>${esc(b.what)} <a href="${esc(b.whatSource.url)}" rel="noopener">${esc(b.whatSource.label)} ↗</a></p>
      <p class="bp-links">${b.links.map(l => `<a href="${esc(l.url)}" rel="noopener">${esc(l.label)} on Congress.gov ↗</a>`).join('')}</p>
    </div>
    <div class="bp-tools">
      <input id="bp-q" type="search" placeholder="Filter by name, state or party" value="${esc(q)}" aria-label="Filter members">
      <div class="bp-chips">${chips.map(([k, l]) => `<button type="button" class="bp-chip" aria-pressed="${chamber === k}" data-c="${k}">${l}</button>`).join('')}</div>
    </div>
    <ul class="bp-list">${rows.map(m => `
      <li><a class="bp-m" href="/?q=${encodeURIComponent(m.name)}">
        ${m.photo ? `<img src="${esc(m.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'bp-ini',textContent:'${esc(initials(m.name))}'}))">` : `<span class="bp-ini">${esc(initials(m.name))}</span>`}
        <span class="bp-t"><strong>${esc(m.name)}</strong><span class="bp-meta"><span class="party ${esc(partyKey(m.party))}">${esc(partyName(m.party))}</span><span class="sub">${esc(seat(m))}</span></span><span class="sub">${esc(m.role)}</span>${m.status !== 'On the 2026 ballot' ? `<span class="sub bp-st">${esc(m.status)}</span>` : ''}</span></a></li>`).join('') || '<li class="bp-none">No members match that filter.</li>'}</ul>`;
  $('#bp-q').addEventListener('input', e => { q = e.target.value; const pos = e.target.selectionStart; panel(); const i = $('#bp-q'); i.focus(); i.setSelectionRange(pos, pos); });
}
document.addEventListener('click', e => {
  const t = e.target.closest('.bp-tab'); if (t) { current = t.dataset.k; chamber = 'all'; history.replaceState(null, '', '?bill=' + current); tabs(); panel(); return; }
  const c = e.target.closest('.bp-chip'); if (c) { chamber = c.dataset.c; panel(); }
});
fetch('/api/bills').then(r => r.json()).then(d => { data = d; if (!d.bills.some(b => b.key === current)) current = d.bills[0].key; tabs(); panel(); })
  .catch(() => { $('#panel').innerHTML = '<p class="status">We couldn’t load the lists. Make sure the app is running and try again.</p>'; });
