import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { compareSnapshots, renderReport } from '../scripts/sdk-drift/compare.mjs';
import { extractSdkSnapshot } from '../scripts/sdk-drift/extract-core.mjs';

const baseline = JSON.parse(fs.readFileSync(new URL('../sdk-snapshot/snapshot.json', import.meta.url), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(baseline));

// A tiny stand-in for sdk.js with the same shapes the extractor looks for.
const fakeSdk = (table = '{internalIsoCode:"EU",isoCodes:["FR","DE"],regulation:Nn.g.Gpdr}', body = 'return e.countryCode') =>
  [
    'f=function(e){return e.Gpdr="gpdr",e.Ccpa="ccpa",e}({});',
    `var $o={countries:[${table}],subdivisions:[{internalIsoCode:"CA-QC",countryIsoCode:"CA",isoCodes:["CA-QC"],regulation:Nn.g.Ccpa}]};`,
    'const Ho=function(e,t){return t};function Yo(){}',
    `class X{getCookiesConfig(){var e="UNKNOWN";${body}}resolveABTestFor(e,t,n){return null}}`,
    'const yr="axeptio_ab";function br(){}',
    'pageMatch(e){return 1}startService(){}',
    '"X-Viewer-Country" "X-Viewer-Country-Region"',
  ].join('');

describe('SDK drift check', () => {
  it('reports no change against itself', () => {
    const diff = compareSnapshots(baseline, clone());
    expect(diff.changed).toBe(false);
    expect(renderReport(diff)).toContain('No change');
  });

  it('reports region table changes in plain words', () => {
    const current = clone();
    current.regionTable.countries[0].isoCodes.push('IS');
    current.regionTable.countries.push({ internalIsoCode: 'AU', isoCodes: ['AU'], regulation: 'app' });
    const report = renderReport(compareSnapshots(baseline, current));
    expect(report).toContain('`EU` gained IS');
    expect(report).toContain('New group `AU` (app): AU');
  });

  it('reports selection code changes with the new strings', () => {
    const current = clone();
    current.blocks.getCookiesConfig = { ...current.blocks.getCookiesConfig, hash: 'deadbeef', literals: [...current.blocks.getCookiesConfig.literals, 'province'] };
    const diff = compareSnapshots(baseline, current);
    expect(diff.changed).toBe(true);
    expect(renderReport(diff)).toContain('new strings: `"province"`');
  });

  it('extracts the enum, the table and stable fingerprints from a bundle', () => {
    const a = extractSdkSnapshot(fakeSdk());
    expect(a.problems).toEqual([]);
    expect(a.regulations).toEqual({ Gpdr: 'gpdr', Ccpa: 'ccpa' });
    expect(a.regionTable.countries).toEqual([{ internalIsoCode: 'EU', isoCodes: ['FR', 'DE'], regulation: 'gpdr' }]);
    expect(a.regionTable.subdivisions[0].regulation).toBe('ccpa');
    // Renaming minified variables doesn't move the fingerprint...
    const renamed = extractSdkSnapshot(fakeSdk(undefined, 'return t.countryCode'));
    expect(renamed.blocks.getCookiesConfig.hash).toBe(a.blocks.getCookiesConfig.hash);
    // ...but changing the logic does.
    const changed = extractSdkSnapshot(fakeSdk(undefined, 'return e.subdivisionCode'));
    expect(changed.blocks.getCookiesConfig.hash).not.toBe(a.blocks.getCookiesConfig.hash);
  });

  it('flags a bundle it cannot read', () => {
    const snapshot = extractSdkSnapshot('nothing to see here');
    expect(snapshot.problems.length).toBeGreaterThan(3);
    expect(compareSnapshots(baseline, snapshot).changed).toBe(true);
  });
});
