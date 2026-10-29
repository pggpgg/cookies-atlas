import { describe, expect, it } from 'vitest';
import { csvRows, tableRows } from '../src/app/table';
import { evaluateProject } from '../src/engine/evaluate';
import type { AxeptioConfig, AxeptioProject } from '../src/engine/types';
import { buildCopyContext, MESSAGES, type PlaceNames } from '../src/i18n';
import { csvSeparator, toCsv } from '../src/lib/csv';

const NOW = Date.parse('2026-10-28T12:00:00Z');

describe('CSV text', () => {
  it('quotes what needs quoting, with CRLF line ends and a BOM for Excel', () => {
    const csv = toCsv([
      ['a', 'b, c', 'say "hi"'],
      ['line\nbreak', ' padded', ''],
    ]);
    expect(csv).toBe('﻿a,"b, c","say ""hi"""\r\n"line\nbreak"," padded",\r\n');
  });

  it('uses semicolons when asked, and quotes them instead of commas', () => {
    expect(toCsv([['a;b', 'c,d']], ';')).toBe('﻿"a;b";c,d\r\n');
  });

  it("never lets a banner name run as a spreadsheet formula", () => {
    expect(toCsv([['=HYPERLINK("x")', '+1', '-2', '@A1', 'CA-QC']])).toBe('﻿"\'=HYPERLINK(""x"")",\'+1,\'-2,\'@A1,CA-QC\r\n');
  });

  it('picks the separator Excel expects for the locale', () => {
    expect(csvSeparator('en-US')).toBe(',');
    expect(csvSeparator('fr-CA')).toBe(';');
    expect(csvSeparator('de-DE')).toBe(';');
  });
});

describe('table export rows', () => {
  const cfg = (identifier: string, fields: Partial<AxeptioConfig> = {}): AxeptioConfig => ({
    identifier,
    name: identifier.toUpperCase(),
    steps: [{ name: 'welcome' }],
    ...fields,
  });
  const project: AxeptioProject = {
    client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'world' } },
    cookies: [
      cfg('qc-fr', { country: ['CA'], subdivision: ['CA-QC'], regulation: 'loi25', language: 'fr' }),
      cfg('qc-en', { country: ['CA'], subdivision: ['CA-QC'], regulation: 'loi25', language: 'en', settings: { consentMode: 'opt_out' } }),
      cfg('world', { language: 'en', regulation: 'ccpa', settings: { displayMode: 'hide', consentMode: 'opt_out' } }),
    ],
  };
  const names: PlaceNames = {
    country: () => undefined,
    region: (cc, code, ui) => (cc === 'CA' && code === 'QC' ? (ui === 'fr' ? 'Québec' : 'Quebec') : undefined),
    isSplit: (cc) => cc === 'CA' || cc === 'US',
  };
  const evaluation = evaluateProject(project, { mode: 'actual', visitor: { now: NOW } });
  const configs = new Map(project.cookies!.map((c) => [c.identifier, c]));
  const rowsFor = (ui: 'en' | 'fr', language: string) => {
    const c = buildCopyContext(ui, project, names);
    return csvRows(tableRows(evaluation, language, c), { language, configs, t: MESSAGES[ui], c });
  };

  it('has one line per place and banner, with the banner modes', () => {
    const rows = rowsFor('en', 'all');
    expect(rows[0]).toEqual(['Code', 'Country', 'Region', 'Visitor languages', 'Banner', 'Display mode', 'Consent mode', 'How the SDK picks it', 'Regulation of the place', 'Banner ID']);
    const quebec = rows.filter((r) => r[0] === 'CA-QC');
    expect(quebec).toEqual([
      ['CA-QC', 'Canada', 'Quebec', 'French, other languages', 'QC-FR', 'Shown', 'Opt-in', 'Region match', 'Law 25 (Québec)', 'qc-fr'],
      ['CA-QC', 'Canada', 'Quebec', 'English', 'QC-EN', 'Shown', 'Opt-out', 'Region match', 'Law 25 (Québec)', 'qc-en'],
    ]);
    const japan = rows.find((r) => r[0] === 'JP')!;
    expect(japan.slice(2, 7)).toEqual(['', 'All', 'WORLD', 'Hidden', 'Opt-out']);
    // Canada itself is drawn by region: its own line is for the regions no banner targets.
    expect(rows.find((r) => r[0] === 'CA')![2]).toBe('Other regions');
  });

  it('follows the language picked on the map, in the interface language', () => {
    const rows = rowsFor('fr', 'en');
    expect(rows[0][0]).toBe('Code');
    expect(rows[0][3]).toBe('Langues des visiteurs');
    expect(rows.filter((r) => r[0] === 'CA-QC')).toEqual([
      ['CA-QC', 'Canada', 'Québec', 'Anglais', 'QC-EN', 'Affiché', 'Opt-out', 'Match par région', expect.any(String), 'qc-en'],
    ]);
  });
});
