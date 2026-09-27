#!/usr/bin/env node
// Lists the functions that the NPS and USFS apps' index.html both define but
// whose code differs. Shared code is meant to stay textually identical, so each
// name printed is either a fix still to port (USFS_PORT.md) or agency-specific
// on purpose. Reads both files; changes nothing.
// Usage: node scripts/sibling-diff.js [path to the USFS-Photo-Tool folder]
const fs = require('fs'), path = require('path');
const npsFile = path.join(__dirname, '..', 'index.html');
const usfsFile = path.join(process.argv[2] || path.join(__dirname, '..', '..', 'USFS-Photo-Tool'), 'index.html');

// Top-level functions: from `function name(` at the start of a line to the
// first line that is just `}`, which is how every function in these files ends.
function functions(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n'), out = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/);
    if (!m) continue;
    let j = i;
    while (j < lines.length && !(j > i && lines[j] === '}') && !(j === i && /}\s*$/.test(lines[i]))) j++;
    out[m[1]] = { line: i + 1, body: lines.slice(i, j + 1).join('\n') };
  }
  return out;
}

if (!fs.existsSync(usfsFile)) { console.error('No USFS index.html at ' + usfsFile + ' (pass the folder as an argument).'); process.exit(1); }
const nps = functions(npsFile), usfs = functions(usfsFile);
const shared = Object.keys(nps).filter(n => usfs[n]);
const differ = shared.filter(n => nps[n].body !== usfs[n].body);
console.log(`${shared.length} functions in both apps: ${shared.length - differ.length} identical, ${differ.length} different.`);
console.log(`${Object.keys(nps).length - shared.length} only in NPS, ${Object.keys(usfs).length - shared.length} only in USFS.\n`);
for (const n of differ.sort()) console.log(`  ${n.padEnd(28)} NPS index.html:${nps[n].line}  USFS index.html:${usfs[n].line}`);
