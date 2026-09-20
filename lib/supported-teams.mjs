// Identity snapshot verified against both public provider records, not feed paths.
// Homestream: private configured team catalog.
// ESPN: https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000
// On 2026-09-13 both returned HTTP 200; school/location and mascot names agreed.
export const SUPPORTED_TEAMS_VERSION = '2026-09-13';
export const SUPPORTED_TEAMS_VERIFIED_AT = '2026-09-13T02:22:36Z';
export const SUPPORTED_TEAMS = Object.freeze([
  { id: '150', name: 'Duke', homestreamId: '2903e5f6-960e-4954-a3ec-f7754e78660f' },
  { id: '59', name: 'Georgia Tech', homestreamId: '410422f0-663f-4e3d-82e2-787d954ae29d' },
  { id: '258', name: 'Virginia', homestreamId: 'b3c33c46-a9e4-4e3b-9d5a-4fefb625f14c' },
  { id: '2', name: 'Auburn', homestreamId: 'ffacbef1-e8a5-4872-9401-eff97cdf2c9c' }
].map(Object.freeze));
