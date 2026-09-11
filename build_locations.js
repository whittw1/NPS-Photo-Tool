#!/usr/bin/env node
/**
 * build_locations.js — NPS Photo Collector
 *
 * Builds nps_locations.json — { "Park Name": [ {n, t, d, lat, lng}, … ] } —
 * from three public NPS GIS services. No API key is required (the NPS Data
 * API at api.nps.gov needs one; these ArcGIS services do not).
 *
 *   1. NPS Boundary Centroids (Land Resources Division, ArcGIS Online)
 *      → the master list of park units: UNIT_CODE, UNIT_NAME, REGION.
 *   2. NPS Public Points of Interest (mapservices.nps.gov / NationalDatasets)
 *      → visitor centers, campgrounds, picnic areas, trailheads, marinas,
 *        dump stations, parking lots, … Site-level features only: per-item
 *        clutter (campsites, benches, signs, mile markers…) and natural
 *        features (peaks, lakes, waterfalls…) are dropped — see POI_EXCLUDE.
 *   3. NPS Public Buildings (mapservices.nps.gov / NationalDatasets)
 *      → the facility inventory: offices, maintenance shops, warehouses,
 *        housing, water/sewage treatment, pump houses, fuel, … (polygon
 *        centroids; decommissioned / excess / inactive buildings dropped).
 *
 * Each location: n = name, t = type, d = park alpha code (e.g. "YELL"),
 * lat/lng = WGS84 rounded to 6 decimals. The app shows "n — d" and the
 * export filename becomes MMDDYY_<n>_<d>_NNNN.jpg. A park unit with no mapped
 * facilities gets its boundary centroid as a single "Park Unit" location so
 * every unit stays selectable / GPS-detectable.
 *
 * Also regenerates the REGION_MAP literal in index.html (between the
 * "// REGION_MAP:BEGIN" and "// REGION_MAP:END" markers) using the seven NPS
 * regions carried by the boundary data: AKR, IMR, MWR, NCR, NER, PWR, SER.
 *
 * Raw service responses are cached in ./nps_raw/ (git-ignored) so the type
 * filters can be tuned without re-downloading; pass --refresh to re-fetch.
 *
 * Run: node build_locations.js [--refresh]      (Node 18+, built-in fetch)
 * Then bump CACHE_NAME in sw.js so field devices pick up the new data.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT  = __dirname;
const OUT_JSON   = path.join(REPO_ROOT, 'nps_locations.json');
const WWW_JSON   = path.join(REPO_ROOT, 'www', 'nps_locations.json');
const INDEX_HTML = path.join(REPO_ROOT, 'index.html');
const RAW_DIR    = path.join(REPO_ROOT, 'nps_raw');
const REFRESH    = process.argv.includes('--refresh');

const UNITS_URL = 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/0/query';
const POI_URL   = 'https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_POIs_Geographic/FeatureServer/0/query';
const BLDG_URL  = 'https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Buildings_Geographic/FeatureServer/0/query';

const REGION_LABELS = {
  AKR: 'AKR — Alaska',
  IMR: 'IMR — Intermountain',
  MWR: 'MWR — Midwest',
  NCR: 'NCR — National Capital',
  NER: 'NER — Northeast',
  PWR: 'PWR — Pacific West',
  SER: 'SER — Southeast',
};
const OTHER_REGION = 'OTH — Other / Unassigned';

const PAGE = 2000; // maxRecordCount on all three services

// POI types that are not audit-relevant "locations" (normalized: lowercase,
// single-spaced). Anything not listed here is kept as long as it has a name.
const POI_EXCLUDE = new Set([
  // per-item clutter: individual sites, furnishings, markers, signs
  'campsite', 'backcountry campsite', 'primitive campsite',
  'mile marker', 'trail marker', 'bench', 'picnic table', 'grill', 'campfire ring',
  'bike rack', 'bicycle rack', 'waste bin', 'litter receptacle', 'trash',
  'fire hydrant', 'fire extinguisher', 'flag pole', 'cattle guard', 'steps', 'gate', 'fence',
  'food box / food cache', 'food locker', 'bearbox', 'firewood', 'electrical hookup',
  'wheelchair accessible', 'accessible', 'parking - disabled', 'telephone', 'wi-fi', 'webcam', 'atm',
  'fountain', 'water fointain', 'drinking fountain', 'brochure box', 'trail register',
  'information board', 'information map', 'sign', 'regulatory sign', 'trail sign', 'directional sign',
  'place sign', 'location sign', 'gateway sign', 'historic marker', 'battlefield marker',
  'interpretive sign', 'interpretive exhibit', 'exhibit / wayside', 'exhibit', 'wayside',
  'sculpture', 'totem pole', 'cannon', 'artillery', 'grave', 'tree',
  'buoy', 'mooring', 'navigation aid', 'beacon', 'air nav aid', 'anchorage', 'wreck', 'boat',
  'bridge', 'tunnel',
  // natural features
  'peak', 'summit', 'ridge', 'mountain pass (saddle / gap)', 'mountain pass', 'gap', 'valley', 'hollow', 'hill',
  'cliff', 'bluff', 'cape', 'cove', 'bay', 'bight', 'sound', 'basin', 'lake', 'creek', 'stream', 'branch',
  'slough', 'swamp', 'wetland', 'spring', 'waterfall', 'falls', 'cascade', 'rapids', 'arch', 'geyser',
  'thermal pool', 'cave', 'cave entrance', 'sinkhole', 'crater', 'volcano (crater)', 'lava flow', 'hoodoo',
  'rock formation', 'dune', 'glacier', 'island', 'grove', 'forest', 'woods', 'natural feature',
  // linear routes and road-side points
  'junction', 'pullout', 'turnout', 'roadside pullout', 'roadside pull-off', 'pull-off', 'trail', 'road', 'track',
  'all-terrain vehicle trail', 'cross-country ski trail', 'motorized trail', 'bicycle trail',
  'four-wheel drive trail', 'downhill ski trail', 'self guiding trail', 'driving tour',
  // gazetteer-style named places (not facilities)
  'locale', 'populated place', 'town', 'area', 'park area',
]);
const POI_STATUS_EXCLUDE  = new Set(['planned', 'proposed', 'removed', 'demolished', 'abandoned', 'closed']);
const BLDG_STATUS_EXCLUDE = new Set(['decommissioned', 'excess', 'inactive', 'demolished', 'removed', 'planned', 'proposed', 'abandoned']);

const clean  = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const norm   = s => clean(s).toLowerCase();
const round6 = v => Math.round(v * 1e6) / 1e6;
const isNum  = v => typeof v === 'number' && isFinite(v);

function cleanBldgType(raw) {
  const t = clean(raw).replace(/^bldg\.?\s*/i, '').replace(/\s*\(gsf\)\s*$/i, '').replace(/\s+/g, ' ').trim();
  return t || 'Building';
}
function cleanPoiType(raw) {
  const t = clean(raw);
  const n = t.toLowerCase();
  if (!n || n === 'none' || n === '<null>' || n === 'null' || n === 'poi') return 'Point of Interest';
  return t;
}

// Name resolution: primary name → map label → alternate name. Some regions
// (the Midwest especially) publish most of their geometry with no POINAME /
// BLDGNAME but a usable MAPLABEL. Features with no name in any field are still
// kept when their TYPE identifies a real facility, labelled "<Type> (unnamed)"
// so the auditor knows to add detail; untyped/generic unnamed features drop.
const UNNAMED_KEEP_TYPES = new Set([
  // POI types
  'visitor center', 'visitor contact station', 'campground', 'rv campground', 'group campground', 'picnic area',
  'picnic shelter', 'boat launch', 'boat ramp', 'marina', 'dock', 'canoe / kayak access', 'trailhead', 'parking lot',
  'parking', 'office', 'administrative office', 'headquarters', 'park headquarters', 'ranger station',
  'entrance station', 'fee booth', 'potable water', 'drinking water', 'water - drinking/potable', 'dump station',
  'sanitary disposal station', 'gas station', 'lodge', 'lodging', 'cabin', 'historic building', 'amphitheater',
  'museum', 'fire station', 'store', 'restaurant', 'food service', 'lighthouse', 'monument', 'memorial',
  // cleaned building types (see cleanBldgType)
  'service shop maintenance', 'sewage treatment', 'water treatment', 'pump house well house', 'power generation',
  'warehouse chemical', 'warehouse fire cache', 'warehouse explosive', 'auto service refueling',
  'law enforcement center', 'comfort stations/restrooms', 'comfort stations', 'vault toilets/pit toilets',
  'housing single family', 'housing multi- family plex', 'housing cabin', 'housing apartment', 'housing mobile home',
  'housing garage', 'housing support building', 'dormitories/ barracks', 'lodge/motel/hotel',
  'warehouse shed outbuilding', 'warehouse equipment vehicle', 'warehouse warehouse', 'barn stable', 'greenhouse',
  'laundry', 'dining hall cafeteria', 'retail store', 'museum repository', 'cultural center',
  'communications systems', 'laboratory', 'clinic', 'training center', 'school environmental education',
  'gymnasium', 'auditorium', 'post office', 'library', 'animal shelter', 'multi-purpose',
]);
function featureName(candidates, type) {
  for (const c of candidates) { const v = clean(c); if (v) return v; }
  if (UNNAMED_KEEP_TYPES.has(norm(type))) return `${type} (unnamed)`;
  return '';
}

async function fetchJSON(url, attempt = 1) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    return j;
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise(res => setTimeout(res, 1500 * attempt));
    return fetchJSON(url, attempt + 1);
  }
}

// Page through an ArcGIS query endpoint (resultOffset / resultRecordCount),
// caching the merged feature array under nps_raw/<label>.json.
async function fetchAll(baseUrl, params, label) {
  const cacheFile = path.join(RAW_DIR, label + '.json');
  if (!REFRESH && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    console.log(`  ${label}: ${cached.length} records (cached in nps_raw/, use --refresh to re-download)`);
    return cached;
  }
  const out = [];
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({
      where: '1=1', f: 'json', orderByFields: 'OBJECTID',
      resultRecordCount: String(PAGE), resultOffset: String(offset), ...params,
    });
    const j = await fetchJSON(baseUrl + '?' + qs.toString());
    const feats = j.features || [];
    out.push(...feats);
    process.stdout.write(`\r  ${label}: ${out.length} records…`);
    if (feats.length < PAGE) break;
    offset += PAGE;
  }
  process.stdout.write('\n');
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

function patchRegionMap(map) {
  if (!fs.existsSync(INDEX_HTML)) return false;
  const src = fs.readFileSync(INDEX_HTML, 'utf8');
  const begin = '// REGION_MAP:BEGIN', end = '// REGION_MAP:END';
  const i = src.indexOf(begin), j = src.indexOf(end);
  if (i < 0 || j < 0 || j < i) return false;
  const lines = Object.entries(map).map(([label, names]) => `  ${JSON.stringify(label)}: ${JSON.stringify(names)},`);
  const block = `${begin}\nconst REGION_MAP = {\n${lines.join('\n')}\n};\n`;
  fs.writeFileSync(INDEX_HTML, src.slice(0, i) + block + src.slice(j));
  return true;
}

(async () => {
  // ---- 1. Park units --------------------------------------------------------
  console.log('Park units (NPS Boundary Centroids)…');
  const unitFeats = await fetchAll(UNITS_URL, {
    outFields: 'UNIT_CODE,UNIT_NAME,REGION,STATE,UNIT_TYPE', outSR: '4326', returnGeometry: 'true',
  }, 'units');
  const normName = s => norm(s).replace(/[^a-z0-9]+/g, '');
  const units = {};       // code -> unit (aliases point at the canonical unit)
  const unitsByName = {}; // normalized name -> unit
  for (const f of unitFeats) {
    const a = f.attributes || {};
    const code = clean(a.UNIT_CODE).toUpperCase();
    const name = clean(a.UNIT_NAME);
    if (!code || !name || units[code]) continue;
    // The boundary data lists a few units twice under spelling variants
    // ("National Capital Parks-East" / "National Capital Parks - East"):
    // alias the second code to the first unit so they form one park.
    const existing = unitsByName[normName(name)];
    if (existing) { units[code] = existing; continue; }
    const g = f.geometry || {};
    units[code] = { code, name, region: clean(a.REGION).toUpperCase(), state: clean(a.STATE), type: clean(a.UNIT_TYPE), lat: g.y, lng: g.x };
    unitsByName[normName(name)] = units[code];
  }
  console.log(`  ${Object.keys(unitsByName).length} park units (${Object.keys(units).length} unit codes)`);

  const parks = {};       // "Park Name" -> [ {n,t,d,lat,lng} ]
  const parkRegion = {};  // "Park Name" -> region code
  const stats = { poi: { total: 0, kept: 0, synthetic: 0, unnamed: 0, type: 0, status: 0, noUnit: 0 },
                  bldg: { total: 0, kept: 0, synthetic: 0, unnamed: 0, status: 0, noUnit: 0 }, centroidOnly: 0 };

  // Map a feature's unit code to the master park list. Features whose code is
  // not an LRD unit (sub-unit codes like NACE vs NACE-East, PARA, SEATTLE) are
  // matched on normalized park name so "National Capital Parks-East" and
  // "National Capital Parks - East" land in the same park; otherwise fall back
  // to the feature's own UNITNAME (e.g. regional offices that are not units).
  const fallbackUnits = {}; // code (or normalized name) -> canonical {name, code, region}
  function registerFallback(rawCode, rawUnitName, rawRegion) {
    const code = clean(rawCode).toUpperCase();
    if (units[code] || unitsByName[normName(rawUnitName)]) return;
    const name = clean(rawUnitName);
    if (!name) return;
    const key = code || normName(name);
    const cur = fallbackUnits[key];
    // Shortest spelling wins ("National Capital Parks-East" over "… Parks - East").
    if (!cur || name.length < cur.name.length) fallbackUnits[key] = { name, code, region: clean(rawRegion).toUpperCase() };
  }
  function resolvePark(rawCode, rawUnitName, rawRegion) {
    const code = clean(rawCode).toUpperCase();
    const u = units[code] || unitsByName[normName(rawUnitName)];
    if (u) return { name: u.name, code: u.code, region: u.region };
    const name = clean(rawUnitName);
    if (!name) return null;
    return fallbackUnits[code || normName(name)] || { name, code, region: clean(rawRegion).toUpperCase() };
  }
  function addLoc(park, n, t, lat, lng) {
    if (!park || !n || !isNum(lat) || !isNum(lng)) return false;
    if (!parks[park.name]) { parks[park.name] = []; parkRegion[park.name] = park.region; }
    parks[park.name].push({ n, t, d: park.code, lat: round6(lat), lng: round6(lng) });
    return true;
  }

  // ---- 2. Points of interest ----------------------------------------------
  console.log('Points of interest (NPS_Public_POIs)…');
  const poiFeats = await fetchAll(POI_URL, {
    outFields: 'POINAME,MAPLABEL,POIALTNAME,POITYPE,POISTATUS,ISEXTANT,UNITCODE,UNITNAME,REGIONCODE', outSR: '4326', returnGeometry: 'true',
  }, 'pois');
  console.log('Buildings (NPS_Public_Buildings, polygon centroids)…');
  const bldgFeats = await fetchAll(BLDG_URL, {
    outFields: 'BLDGNAME,MAPLABEL,BLDGALTNAME,BLDGTYPE,BLDGSTATUS,ISEXTANT,UNITCODE,UNITNAME,REGIONCODE', outSR: '4326',
    returnGeometry: 'false', returnCentroid: 'true',
  }, 'buildings');
  // Pre-pass: pick one canonical name per non-LRD unit code (sub-units such as
  // PARA or NACE appear with several UNITNAME spellings across features).
  for (const f of poiFeats)  { const a = f.attributes || {}; registerFallback(a.UNITCODE, a.UNITNAME, a.REGIONCODE); }
  for (const f of bldgFeats) { const a = f.attributes || {}; registerFallback(a.UNITCODE, a.UNITNAME, a.REGIONCODE); }

  for (const f of poiFeats) {
    const a = f.attributes || {};
    stats.poi.total++;
    if (POI_EXCLUDE.has(norm(a.POITYPE))) { stats.poi.type++; continue; }
    const t = cleanPoiType(a.POITYPE);
    const n = featureName([a.POINAME, a.MAPLABEL, a.POIALTNAME], t);
    if (!n) { stats.poi.unnamed++; continue; }
    if (POI_STATUS_EXCLUDE.has(norm(a.POISTATUS)) || norm(a.ISEXTANT) === 'false') { stats.poi.status++; continue; }
    const park = resolvePark(a.UNITCODE, a.UNITNAME, a.REGIONCODE);
    if (!park) { stats.poi.noUnit++; continue; }
    const g = f.geometry || {};
    if (addLoc(park, n, t, g.y, g.x)) { stats.poi.kept++; if (n.endsWith(' (unnamed)')) stats.poi.synthetic++; }
  }
  console.log(`  kept ${stats.poi.kept} (${stats.poi.synthetic} typed-but-unnamed) — dropped ${stats.poi.type} excluded types, ${stats.poi.unnamed} unnamed, ${stats.poi.status} non-existing, ${stats.poi.noUnit} without a park`);

  // ---- 3. Buildings --------------------------------------------------------
  for (const f of bldgFeats) {
    const a = f.attributes || {};
    stats.bldg.total++;
    const t = cleanBldgType(a.BLDGTYPE);
    const n = featureName([a.BLDGNAME, a.MAPLABEL, a.BLDGALTNAME], t);
    if (!n) { stats.bldg.unnamed++; continue; }
    if (BLDG_STATUS_EXCLUDE.has(norm(a.BLDGSTATUS)) || norm(a.ISEXTANT) === 'false') { stats.bldg.status++; continue; }
    const park = resolvePark(a.UNITCODE, a.UNITNAME, a.REGIONCODE);
    if (!park) { stats.bldg.noUnit++; continue; }
    const c = f.centroid || {};
    if (addLoc(park, n, t, c.y, c.x)) { stats.bldg.kept++; if (n.endsWith(' (unnamed)')) stats.bldg.synthetic++; }
  }
  console.log(`  kept ${stats.bldg.kept} (${stats.bldg.synthetic} typed-but-unnamed) — dropped ${stats.bldg.unnamed} unnamed, ${stats.bldg.status} decommissioned/excess/inactive, ${stats.bldg.noUnit} without a park`);

  // ---- 4. Units with nothing mapped → boundary centroid --------------------
  for (const u of Object.values(unitsByName)) {
    if (parks[u.name] && parks[u.name].length) continue;
    if (addLoc({ name: u.name, code: u.code, region: u.region }, u.name, 'Park Unit', u.lat, u.lng)) stats.centroidOnly++;
  }
  console.log(`  ${stats.centroidOnly} units had no mapped facilities — added their boundary centroid`);

  // ---- 5. Dedupe + sort (same rule as the USFS build) ----------------------
  for (const p of Object.keys(parks)) {
    const seen = new Set();
    parks[p] = parks[p].filter(loc => {
      const key = `${loc.n}|${loc.lat.toFixed(3)}|${loc.lng.toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    parks[p].sort((a, b) => a.n.localeCompare(b.n));
  }

  // ---- 6. Region map ---------------------------------------------------------
  const byRegion = {};
  for (const p of Object.keys(parks).sort()) {
    const label = REGION_LABELS[parkRegion[p]] || OTHER_REGION;
    (byRegion[label] = byRegion[label] || []).push(p);
  }
  const regionMap = {};
  for (const label of [...Object.values(REGION_LABELS), OTHER_REGION]) if (byRegion[label]) regionMap[label] = byRegion[label];

  // ---- 7. Write ---------------------------------------------------------------
  const parkNames = Object.keys(parks).sort();
  const ordered = {};
  for (const p of parkNames) ordered[p] = parks[p];
  const json = JSON.stringify(ordered);
  fs.writeFileSync(OUT_JSON, json);
  console.log(`\nWrote nps_locations.json (${(json.length / 1024).toFixed(0)} KB)`);
  if (fs.existsSync(path.dirname(WWW_JSON))) { fs.writeFileSync(WWW_JSON, json); console.log('Wrote www/nps_locations.json'); }

  let total = 0;
  for (const [label, names] of Object.entries(regionMap)) {
    const n = names.reduce((s, p) => s + parks[p].length, 0);
    total += n;
    console.log(`  ${label}: ${names.length} parks, ${n} locations`);
  }
  console.log(`Total: ${parkNames.length} parks, ${total} locations`);

  if (patchRegionMap(regionMap)) console.log('Updated REGION_MAP in index.html');
  else console.log('REGION_MAP markers not found in index.html — paste this:\n' + JSON.stringify(regionMap, null, 1));
})().catch(e => { console.error('\nBuild failed:', e); process.exit(1); });
