#!/usr/bin/env node
/**
 * SDK drift check.
 *
 *   node scripts/sdk-drift/run.mjs --compare sdk-snapshot/snapshot.json --out drift
 *       Downloads sdk.js, compares it with the snapshot, writes drift/current.json and drift/report.md,
 *       and sets the GitHub Actions output `changed=true|false`.
 *   node scripts/sdk-drift/run.mjs --write sdk-snapshot/snapshot.json
 *       Refreshes the baseline (after porting any logic change to src/engine).
 *
 *   --source path/to/sdk.js   use a local copy instead of downloading
 */
import fs from 'node:fs';
import path from 'node:path';
import { compareSnapshots, renderReport } from './compare.mjs';
import { extractSdkSnapshot } from './extract-core.mjs';

const SDK_URL = 'https://static.axept.io/sdk.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--')) {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key.slice(2)] = next;
        i++;
      } else args[key.slice(2)] = true;
    }
  }
  return args;
}

async function loadSource(args) {
  if (args.source) return fs.readFileSync(args.source, 'utf8');
  const res = await fetch(SDK_URL, { headers: { 'user-agent': 'cookies-atlas-drift-check' } });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  return res.text();
}

const args = parseArgs(process.argv.slice(2));
if (!args.write && !args.compare) {
  console.error('Usage: run.mjs --compare <snapshot.json> [--out <dir>] | --write <snapshot.json> [--source sdk.js]');
  process.exit(64);
}

const source = await loadSource(args);
const snapshot = extractSdkSnapshot(source);

if (args.write) {
  fs.mkdirSync(path.dirname(args.write), { recursive: true });
  fs.writeFileSync(args.write, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Wrote ${args.write} (${snapshot.problems.length} extraction problems).`);
  if (snapshot.problems.length) console.log(snapshot.problems.map((p) => `- ${p}`).join('\n'));
  process.exit(snapshot.problems.length ? 1 : 0);
}

const baseline = JSON.parse(fs.readFileSync(args.compare, 'utf8'));
const diff = compareSnapshots(baseline, snapshot);
const report = renderReport(diff, { url: args.source ? args.source : SDK_URL, date: new Date().toISOString().slice(0, 10) });

if (args.out) {
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, 'current.json'), JSON.stringify(snapshot, null, 2) + '\n');
  fs.writeFileSync(path.join(args.out, 'report.md'), report);
}
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${diff.changed}\n`);
console.log(report);
