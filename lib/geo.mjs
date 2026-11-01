// Location lookups used by search: Census address/coordinate geocoder, ZIP -> districts, free-text place -> point.
const UA = { 'user-agent': 'election-hub/0.1 (civic info project)' };
const FIPS = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY' };

const cache = new Map();
async function cached(key, fn) { if (cache.has(key)) return cache.get(key); const v = await fn(); cache.set(key, v); if (cache.size > 2000) cache.delete(cache.keys().next().value); return v; }
const IN_BROWSER = typeof window !== 'undefined';   // the static site runs this same file in the visitor's browser
/** the Census geocoder sends no CORS headers but supports JSONP, which is how a browser can call it */
const jsonp = url => new Promise((resolve, reject) => {
  const cb = 'cb' + Math.random().toString(36).slice(2), s = document.createElement('script');
  const done = () => { delete window[cb]; s.remove(); };
  window[cb] = d => { done(); resolve(d); };
  s.onerror = () => { done(); reject(new Error('jsonp failed')); };
  setTimeout(() => { if (window[cb]) { done(); reject(new Error('jsonp timeout')); } }, 12000);
  s.src = url.replace('format=json', 'format=jsonp') + '&callback=' + cb;
  document.head.append(s);
});
async function getJSON(url, opts = {}, tries = 2) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      if (IN_BROWSER && url.includes('geocoding.geo.census.gov')) return await jsonp(url);
      const r = await fetch(url, { ...opts, headers: { ...(IN_BROWSER ? {} : UA), ...(opts.headers || {}) }, signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return await r.json();
    }
    catch (e) { err = e; await new Promise(r => setTimeout(r, 500)); }
  }
  throw err;
}

function parseCensus(m) {
  const g = m.geographies;
  const cdLayer = Object.entries(g).find(([k]) => /Congressional Districts/.test(k))?.[1]?.[0];
  const field = cdLayer && Object.keys(cdLayer).find(k => /^CD\d+$/.test(k));
  return { state: g.States?.[0]?.STUSAB, district: cdLayer ? Number(cdLayer[field]) : null, county: g.Counties?.[0]?.NAME };
}

/** Full street address -> {state, district, matchedAddress} or null. */
export const censusAddress = address => cached('a:' + address.toLowerCase(), async () => {
  const j = await getJSON(`https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`);
  const m = j.result?.addressMatches?.[0];
  return m ? { ...parseCensus(m), matchedAddress: m.matchedAddress } : null;
});

/** lat/lon -> {state, district}. */
const fetchPoint = async (lat, lon) => {
  const j = await getJSON(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`);
  const g = j.result?.geographies; if (!g) return null;
  return parseCensus({ geographies: g });
};
export const censusPoint = (lat, lon) => cached(`p:${(+lat).toFixed(4)},${(+lon).toFixed(4)}`, () => fetchPoint(lat, lon));
/** same lookup for a visitor's own device location: never cached, so precise coordinates aren't kept in memory */
export const censusPointFresh = fetchPoint;

/** 5-digit ZIP -> { place, state, districts:[numbers, centroid district first] } or null. */
export const zipLookup = zip => cached('z:' + zip, async () => {
  let z;
  try { z = await getJSON(`https://api.zippopotam.us/us/${zip}`); } catch { return null; }
  const place = z.places?.[0]; if (!place) return null;
  const home = await censusPoint(place.latitude, place.longitude).catch(() => null);
  const state = place['state abbreviation'];
  const districts = new Set(home?.district != null ? [home.district] : []);
  try {   // every congressional district the ZIP's boundary touches
    const zc = await getJSON(`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query?where=${encodeURIComponent(`ZCTA5='${zip}'`)}&returnGeometry=true&outSR=4326&geometryPrecision=4&f=json`);
    const geom = zc.features?.[0]?.geometry;
    if (geom) {
      const body = new URLSearchParams({ geometry: JSON.stringify({ rings: geom.rings, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPolygon', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'STATE,CD120', returnGeometry: 'false', f: 'json' });
      const cd = await getJSON('https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query', { method: 'POST', body });
      for (const f of cd.features || []) if (FIPS[f.attributes.STATE] === state) districts.add(Number(f.attributes.CD120));
    }
  } catch { /* centroid district alone is still useful */ }
  return { place: `${place['place name']}, ${state}`, state, districts: [...districts] };
});

/** Free text ("Ann Arbor, MI", "Main St Detroit") -> {label, state, district} via OpenStreetMap, then the Census point lookup. */
export const placeLookup = q => cached('pl:' + q.toLowerCase(), async () => {
  const j = await getJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&countrycodes=us&limit=1&addressdetails=1`);
  const hit = j[0]; if (!hit) return null;
  const pt = await censusPoint(hit.lat, hit.lon).catch(() => null);
  if (!pt?.state) return null;
  return { ...pt, label: hit.display_name.split(',').slice(0, 3).join(',').trim(), exact: ['house', 'building', 'residential', 'yes'].includes(hit.type) };
});
