# Lower my Bills, End the Bombs

An openly progressive 2026 voter guide (pro-Palestinian rights, against the Iran war, for Medicare for All). Search an address, ZIP, state or candidate to see the House and Senate races, AIPAC-linked money, and records on Israel/Palestine and the Iran war. Green/red coloring reflects that point of view and is stated on the site.

```
npm run build-data   # refresh data/ (nominees, votes, FEC money, joined races) — no API keys needed
npm start            # http://localhost:3000
```

## Data sources
| What | Source |
|---|---|
| Address → state + congressional district | Census Bureau geocoder (120th Congress layer) |
| Nominees | Wikipedia per-state 2026 election pages (`scripts/build-nominees.mjs`), matched to FEC candidate ids |
| AIPAC PAC direct contributions | FEC bulk `pas2` files, committee C00797670 |
| United Democracy Project spending | FEC bulk `independent_expenditure_*.csv`, committee C00799031 |
| Votes | Voteview bulk CSVs; the curated roll calls live in `data/key-votes.json` |
| Incumbent ids | unitedstates/congress-legislators |
| Public statements (non-voters) | `data/statements.json` — hand-curated, every entry needs a source URL |

Add or remove tracked committees in `data/committees.json`; add roll calls to `data/key-votes.json` (`kind`: `end-war`, `aid`, `support`, `restrict`).

## Known gaps
- Louisiana (4 districts) and one Massachusetts district failed nominee parsing.
- Nominee lists are scraped from Wikipedia; some races use "nominee" bullet lists rather than a results box (flagged in the UI).
- Amendment votes (e.g. NDAA/appropriations amendments on Israel aid) aren't included; Voteview doesn't carry amendment text.
- Spending routed through unaffiliated-sounding PACs, individual AIPAC-bundled donors, and other pro-Israel groups are not counted.

## Keeping the money data fresh
- **Automatic:** while the server is running, it refreshes the money data itself every day at 5:00 am local time (set `REFRESH_HOUR=7` to change, `AUTO_REFRESH=0` to turn off), and also catches up at startup if the data is more than a day old. It reloads in place, with no restart. A failed run is retried hourly (up to 3 times) while the old data keeps serving. Status: `GET /api/meta` -> `refresh`.
- `npm run refresh` (~20 s): pulls the newest FEC filings from OpenFEC's raw e-filing feed for UDP and the groups it funds, merges anything newer than the bulk files, and rebuilds the races. Needs `FEC_API_KEY` in `.env` (free: https://api.data.gov/signup/). The key is only ever sent to api.open.fec.gov and `.env` is git-ignored.
- `npm run build-data`: the full rebuild (nominees, votes, cosponsors, money, races, photos); downloads fresh FEC bulk files.
- Limits: independent spending (ads, mailers) is public within ~24 hours. Money moved between committees appears only in a committee's next periodic report, so late-October transfers aren't public until after the election.

## State legislators (LegiScan)
`npm run build-state` (needs `LEGISCAN_API_KEY` in `.env`, free at https://legiscan.com/legiscan) finds our candidates who are state legislators and records their sponsorships and floor votes on bills whose title matches a strict rule (single-payer, tenant protections/social housing, ending funding of settlement activity, penalizing boycotts of Israel). Study requests, ceremonial resolutions, budget/omnibus bills and technical amendments never count. Output: `data/state-records.json`; edit the rules at the top of `scripts/build-state-records.mjs`.

## Filling gaps in the important races
- `npm run build-important`: lists the races that matter most from the forecasters' ratings that Wikipedia tabulates (House: any Toss-up/Tilt/Lean; Senate: any Likely or closer) -> `data/important-races.json`.
- `npm run find-sites`: tries the usual campaign-domain patterns for candidates in those races who have no site, and accepts a site only if the page names the candidate, their state, and reads like a campaign site -> `data/sites-discovered.json`. Hand-verified sites in `data/sites-manual.json` always win; news/government hosts are never treated as campaign sites.
- `npm run build-quotes`: finds sites, then crawls them (home page, issue pages, and one level of sub-pages under /issues, /priorities, /platform...) for verbatim statements on the four issues. A label is only assigned when a narrow phrase rule in `lib/stance.mjs` matches; every label is backed by the quote shown first.
