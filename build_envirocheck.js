#!/usr/bin/env node
/**
 * build_envirocheck.js — NPS Photo Collector
 *
 * Parses the NPS Environmental Audit Program EnviroCheck Sheets (.docx) into
 * envirocheck_checklists.json — the searchable index behind the app's question
 * picker. NPS audits are run off these sheets, not the Forest Service Team
 * Guide, so this file replaces the USFS app's build_citations.js.
 *
 * Output shape is deliberately the same {c, s, d, r} the USFS app uses, so the
 * search, chips, recents and result rendering in index.html stay unchanged:
 *   c = question code, "<TOPIC>.<NN>" (e.g. UO.05) — the chips filter on the
 *       part before the first dot, so the topic abbreviation must not contain one
 *   s = "<Topic>: <Section> · <Priority>"  (shown as the small label on a result)
 *   d = the checklist question itself
 *   r = the bracketed regulatory citation(s), e.g. "40 CFR 279.22(c)"
 *
 * Source: the sheets live in SharePoint, not in this repo (they are NPS
 * documents). Point SRC_DIR at a local copy and re-run after any sheet update,
 * then bump CACHE_NAME in sw.js.
 *
 * Run: node build_envirocheck.js [path/to/EnviroCheck Sheets]
 * Needs only Node and the system `unzip` — no npm dependencies.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC_DIR = process.argv[2] || '/Users/whittw/Library/CloudStorage/MountainDuck-HGSOneDrive/My Files/SharePoint - HGS Project Files/NPS/Reference Documents/NPS EnviroCheck Sheets';
const REPO_ROOT = __dirname;
const OUT_JSON = path.join(REPO_ROOT, 'envirocheck_checklists.json');
const WWW_JSON = path.join(REPO_ROOT, 'www', 'envirocheck_checklists.json');

// Filename fragment → { code, topic }. The code is what shows in reports and
// what the topic chips filter on, so keep them short and distinct.
const TOPICS = [
  ['AirQuality',                'AQ',    'Air Quality'],
  ['E-purchasing',              'EPP',   'Environmentally Preferable Purchasing'],
  ['EmergencyPlanning',         'EPR',   'Emergency Planning and Reporting'],
  ['FuelStorageMgmt',           'FSM',   'Fuel Storage Management'],
  ['HazardCommunication',       'HC',    'Hazard Communication'],
  ['HazardousMaterials',        'HM',    'Hazardous Materials and Toxic Substances'],
  ['HazardousWaste',            'HW',    'Hazardous Waste Management'],
  ['IntegratedPestMgmt',        'IPM',   'Integrated Pest Management'],
  ['LabChems',                  'LAB',   'Laboratory Chemicals'],
  ['OzoneDepletingSubstances',  'ODS',   'Ozone Depleting Substances'],
  ['RespiratoryProtection',     'RP',    'Respiratory Protection'],
  ['SolidWaste',                'SW',    'Solid Waste Management'],
  ['SPCC',                      'SPCC',  'Spill Prevention, Control and Countermeasure'],
  ['StormWater',                'STW',   'Storm Water Management'],
  ['Universal Waste',           'UW',    'Universal Waste Management'],
  ['UsedOil',                   'UO',    'Used Oil Management'],
  ['WasteWater',                'WW',    'Wastewater Management'],
];

// Paragraphs that introduce a checklist table but are not section names.
const NOT_A_SECTION = /^(\(?Y\/N\/NA\)?|Priority|CHECKLIST LIMITATIONS|GUIDANCE FOR AUDITORS|NOTE:|Auditors:)/i;
// Guidance that trails a question; kept out of the question text itself.
const GUIDANCE = /\b(NOTE:|NOTES:|Auditors?:|GUIDANCE FOR AUDITORS|CHECKLIST LIMITATIONS)/;

const clean = s => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const unesc = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, '&');

function topicFor(file) {
  const hit = TOPICS.find(([frag]) => file.toLowerCase().includes(frag.toLowerCase()));
  return hit ? { code: hit[1], topic: hit[2] } : null;
}

function documentXml(file) {
  return execFileSync('unzip', ['-p', file, 'word/document.xml'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
}

// Text of one <w:p>, with tabs and breaks flattened to spaces.
function paraText(xml) {
  const runs = xml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
  return clean(unesc(runs.map(r => r.replace(/<[^>]+>/g, '')).join('')));
}

// Cells of one <w:tr>; paragraphs inside a cell are joined with "; " so the
// bulleted sub-requirements under a question stay readable on one line.
function rowCells(trXml) {
  return (trXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(tc => {
    const paras = (tc.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\/>/g) || []).map(paraText).filter(Boolean);
    return paras.join('; ');
  });
}

function parseSheet(file) {
  const meta = topicFor(path.basename(file));
  if (!meta) { console.warn('  ! no topic mapping for', path.basename(file)); return []; }
  const body = documentXml(file);
  const blocks = body.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\/>/g) || [];

  const out = [];
  let section = '';
  let lastPara = '';
  let counter = 0;

  for (const block of blocks) {
    if (!block.startsWith('<w:tbl>')) {
      const t = paraText(block);
      if (t && t.length <= 90 && !NOT_A_SECTION.test(t)) lastPara = t;
      continue;
    }
    // A checklist table. Its header row is [section name | (Y/N/NA) | Priority],
    // which names the section far more reliably than the surrounding prose; the
    // paragraph before the table is the fallback.
    if (lastPara) { section = lastPara; lastPara = ''; }

    for (const tr of block.match(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g) || []) {
      const cells = rowCells(tr);
      if (cells.length < 2) continue;
      if (cells.some(c => /^\(?\s*Y\s*\/\s*N\s*\/\s*NA\s*\)?$/i.test(clean(c)))) {
        const head = clean(cells[0]);
        if (head && !/^P\d$/.test(head) && !/^priority$/i.test(head) && head.length <= 90) section = head;
        continue;  // header row, not a question
      }
      const priority = (cells.find(c => /^P\d$/.test(clean(c))) || '').trim();
      // The question is the longest cell; the number, if typed rather than
      // auto-numbered by Word, sits in the first cell.
      const qCell = cells.slice().sort((a, b) => b.length - a.length)[0] || '';
      const question = clean(qCell);
      if (question.length < 25) continue;                    // header/spacer row
      if (NOT_A_SECTION.test(question)) continue;
      if (!/\?|\bAre\b|\bIs\b|\bDo(es)?\b|\bHas\b|\bHave\b|\bWhen\b|\bIf\b/.test(question)) continue;

      const literal = clean(cells[0]).match(/^(\d+)\.?$/);
      const num = literal ? parseInt(literal[1], 10) : ++counter;
      if (literal) counter = num;

      // Bracketed regulatory citations, pulled out of the question text.
      const cites = [];
      let text = question.replace(/\[([^\]]+)\]/g, (_, c) => { cites.push(clean(c)); return ' '; });
      // Drop trailing auditor guidance / notes.
      const g = text.search(GUIDANCE);
      if (g > 40) text = text.slice(0, g);
      text = clean(text).replace(/^[;\s]+|[;\s]+$/g, '');
      if (text.length > 400) text = text.slice(0, 397).replace(/[\s;,]+\S*$/, '') + '…';
      if (!text) continue;

      out.push({
        c: `${meta.code}.${String(num).padStart(2, '0')}`,
        s: `${meta.topic}: ${section || 'Checklist'}${priority ? ' · ' + priority : ''}`,
        d: text,
        r: cites.join('; '),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
if (!fs.existsSync(SRC_DIR)) {
  console.error('EnviroCheck sheet folder not found:\n  ' + SRC_DIR + '\nPass the folder as the first argument.');
  process.exit(1);
}
const files = fs.readdirSync(SRC_DIR).filter(f => f.toLowerCase().endsWith('.docx') && !f.startsWith('~$')).sort();
console.log(`Parsing ${files.length} EnviroCheck sheets from\n  ${SRC_DIR}\n`);

let all = [];
for (const f of files) {
  const recs = parseSheet(path.join(SRC_DIR, f));
  const withCite = recs.filter(r => r.r).length;
  console.log(`  ${f.replace(/_NPS.*|_Enviro.*/i, '').padEnd(30)} ${String(recs.length).padStart(4)} questions  (${withCite} with a citation)`);
  all = all.concat(recs);
}

// Collapse byte-identical repeats (a question repeated in two sections).
const seen = new Set();
const deduped = [];
for (const r of all) {
  const key = `${r.c}|${r.d}`;
  if (seen.has(key)) continue;
  seen.add(key);
  deduped.push(r);
}

const payload = JSON.stringify(deduped);
fs.writeFileSync(OUT_JSON, payload);
console.log(`\nTotal: ${all.length} questions, ${deduped.length} after dedupe`);
console.log(`Wrote envirocheck_checklists.json (${(payload.length / 1024).toFixed(0)} KB)`);
if (fs.existsSync(path.dirname(WWW_JSON))) {
  fs.writeFileSync(WWW_JSON, payload);
  console.log('Wrote www/envirocheck_checklists.json');
}
