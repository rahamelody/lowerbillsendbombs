// Static (GitHub Pages) mode: answers the app's /api/ calls in the browser from data/site.json, so no server is needed.
// Search, suggestions and location lookups reuse the exact same code the Node server runs (lib/search.mjs).
import { createSearch } from './lib/search.mjs';

const realFetch = window.fetch.bind(window);
const ready = realFetch(new URL('data/site.json', document.baseURI)).then(r => r.json()).then(d => {
  const { races, offBallot } = d;
  const s = createSearch({ races, offBallot, enrich: r => r });   // the data file is already enriched
  const featured = () => {
    const ids = new Set(d.endorsed), seen = new Set(), pool = [];
    for (const c of [...Object.values(races).flatMap(r => r.candidates), ...offBallot]) {
      const id = c.bioguide || c.fecId || c.name;
      if (!ids.has(id) || !c.photo || seen.has(id)) continue;
      const rec = c.record, tiers = ['health', 'housing', 'iran', 'israel'].map(t => rec[t].badge?.tier).filter(Boolean);
      if (!tiers.length || !tiers.every(t => t === 'full' || t === 'partial') || rec.money.tier === 'against') continue;   // same guard as the server
      seen.add(id); pool.push(c);
    }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return { tiles: pool.slice(0, 8).map(c => ({ photo: c.photo, name: c.name })) };
  };
  return {
    '/api/search': async q => ({ ...(await s.search(q.get('q') ?? q.get('address'))), meta: d.meta }),
    '/api/locate': async q => ({ ...(await s.locate(q.get('lat'), q.get('lon'))), meta: d.meta }),
    '/api/suggest': q => ({ suggestions: s.suggest(q.get('q')) }),
    '/api/race': q => races[q.get('key')] || null,
    '/api/person': q => offBallot.find(x => x.bioguide === q.get('bioguide')) || null,
    '/api/featured': () => featured(),
    '/api/meta': () => ({ ...d.meta, refresh: { enabled: false } }),
    '/api/bills': () => d.bills,
  };
});

window.fetch = async (input, init) => {
  const u = new URL(typeof input === 'string' ? input : input.url, document.baseURI);
  if (!u.pathname.includes('/api/')) return realFetch(input, init);
  const routes = await ready, handler = routes['/api/' + u.pathname.split('/api/')[1]];
  const body = handler ? await handler(u.searchParams) : null;
  return new Response(JSON.stringify(body ?? { error: 'not found' }), { status: body == null ? 404 : 200, headers: { 'content-type': 'application/json' } });
};
