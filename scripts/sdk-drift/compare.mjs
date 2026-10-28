/**
 * Compares two SDK snapshots (see extract-core.mjs) and renders a Markdown report.
 * Pure functions, no dependencies.
 */

const diffList = (before = [], after = []) => ({
  added: after.filter((x) => !before.includes(x)),
  removed: before.filter((x) => !after.includes(x)),
});

const quote = (values) => values.map((v) => '`' + JSON.stringify(v) + '`').join(', ');

export function compareSnapshots(base, current) {
  const sections = [];
  const push = (title, lines) => {
    if (lines.length) sections.push({ title, lines });
  };

  // Extraction problems
  push(
    'Extraction problems',
    (current.problems ?? []).map((p) => `- ${p}`),
  );

  // Regulation enum
  {
    const lines = [];
    const b = base.regulations ?? {};
    const c = current.regulations ?? {};
    for (const key of new Set([...Object.keys(b), ...Object.keys(c)])) {
      if (!(key in c)) lines.push(`- Removed \`${key}\` (was \`${b[key]}\`)`);
      else if (!(key in b)) lines.push(`- Added \`${key}\` = \`${c[key]}\``);
      else if (b[key] !== c[key]) lines.push(`- \`${key}\`: \`${b[key]}\` → \`${c[key]}\``);
    }
    push('Regulation enum', lines);
  }

  // Region table
  for (const part of ['countries', 'subdivisions']) {
    const lines = [];
    const b = new Map((base.regionTable?.[part] ?? []).map((r) => [r.internalIsoCode, r]));
    const c = new Map((current.regionTable?.[part] ?? []).map((r) => [r.internalIsoCode, r]));
    for (const key of new Set([...b.keys(), ...c.keys()])) {
      const before = b.get(key);
      const after = c.get(key);
      if (!after) lines.push(`- Removed group \`${key}\``);
      else if (!before) lines.push(`- New group \`${key}\` (${after.regulation}): ${after.isoCodes.join(', ')}`);
      else {
        if (before.regulation !== after.regulation) lines.push(`- \`${key}\` regulation: \`${before.regulation}\` → \`${after.regulation}\``);
        const codes = diffList(before.isoCodes, after.isoCodes);
        if (codes.added.length) lines.push(`- \`${key}\` gained ${codes.added.join(', ')}`);
        if (codes.removed.length) lines.push(`- \`${key}\` lost ${codes.removed.join(', ')}`);
      }
    }
    push(`Region table: ${part}`, lines);
  }

  // Geolocation headers
  {
    const lines = [];
    for (const [header, present] of Object.entries(current.headers ?? {})) {
      if (base.headers?.[header] !== present) lines.push(`- \`${header}\`: ${present ? 'now present' : 'no longer found'}`);
    }
    push('Geolocation headers', lines);
  }

  // Code fingerprints
  {
    const lines = [];
    const b = base.blocks ?? {};
    const c = current.blocks ?? {};
    for (const name of new Set([...Object.keys(b), ...Object.keys(c)])) {
      if (!c[name]) {
        lines.push(`- \`${name}\`: not found anymore`);
        continue;
      }
      if (!b[name]) {
        lines.push(`- \`${name}\`: new block`);
        continue;
      }
      if (b[name].hash === c[name].hash) continue;
      lines.push(`- \`${name}\`: code changed (${b[name].tokens} → ${c[name].tokens} tokens)`);
      const lit = diffList(b[name].literals, c[name].literals);
      const prop = diffList(b[name].properties, c[name].properties);
      if (lit.added.length) lines.push(`  - new strings: ${quote(lit.added)}`);
      if (lit.removed.length) lines.push(`  - removed strings: ${quote(lit.removed)}`);
      if (prop.added.length) lines.push(`  - new properties: ${prop.added.map((p) => '`' + p + '`').join(', ')}`);
      if (prop.removed.length) lines.push(`  - removed properties: ${prop.removed.map((p) => '`' + p + '`').join(', ')}`);
    }
    push('Selection code', lines);
  }

  return { changed: sections.length > 0, sections };
}

export function renderReport(diff, meta = {}) {
  const lines = ['## Axeptio SDK drift check', ''];
  if (meta.url) lines.push(`Checked \`${meta.url}\`${meta.date ? ` on ${meta.date}` : ''}.`, '');
  if (!diff.changed) {
    lines.push('No change: the region table, the regulation enum and the selection code match the snapshot.');
    return lines.join('\n') + '\n';
  }
  lines.push(
    'Something Cookies Atlas depends on changed in `sdk.js`. The map may no longer match what the SDK serves.',
    '',
  );
  for (const section of diff.sections) {
    lines.push(`### ${section.title}`, '', ...section.lines, '');
  }
  lines.push(
    '### What to do',
    '',
    '1. Read the changed code in sdk.js (`getCookiesConfig()`, the region table, `resolveABTestFor()`).',
    '2. Port the change to `src/engine/` (and `src/engine/regions.ts` for the table), with a test.',
    '3. Refresh the baseline with `npm run sdk:snapshot`, then commit both.',
    '',
    'If only the fingerprint moved and the logic is the same (a refactor), refreshing the snapshot is enough.',
  );
  return lines.join('\n') + '\n';
}
