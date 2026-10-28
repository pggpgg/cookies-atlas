/**
 * Extracts the parts of Axeptio's sdk.js that Cookies Atlas depends on:
 * the regulation enum, the region table and fingerprints of the code that
 * picks a cookie configuration.
 *
 * This file must stay a single pure function with no imports and no Node or
 * DOM APIs: the exact same source runs in Node (CI drift check) and pasted in
 * a browser console (to capture a baseline when Node can't reach the CDN).
 */
export function extractSdkSnapshot(source) {
  const problems = [];

  const fnv = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };

  // Finds the index of the bracket closing the one at `open`, skipping string literals.
  const matchBracket = (src, open) => {
    const pairs = { '{': '}', '[': ']', '(': ')' };
    const stack = [];
    for (let i = open; i < src.length; i++) {
      const ch = src[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        i++;
        while (i < src.length && src[i] !== ch) {
          if (src[i] === '\\') i++;
          i++;
        }
        continue;
      }
      if (pairs[ch]) stack.push(pairs[ch]);
      else if (ch === '}' || ch === ']' || ch === ')') {
        if (stack.pop() !== ch) return -1;
        if (stack.length === 0) return i;
      }
    }
    return -1;
  };

  const KEYWORDS = new Set([
    'if', 'in', 'do', 'for', 'let', 'new', 'try', 'var', 'of', 'get', 'set', 'case', 'else', 'null', 'this',
    'true', 'void', 'with', 'break', 'catch', 'class', 'const', 'false', 'super', 'throw', 'while', 'delete',
    'return', 'switch', 'typeof', 'default', 'finally', 'continue', 'function', 'instanceof', 'undefined',
    'async', 'await', 'NaN', 'Set', 'Map', 'Date', 'Math', 'JSON',
  ]);
  const TOKEN_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[A-Za-z_$][\w$]*|\d[\w.]*|\s+|[^\s\w$]/g;

  // Minified local names change on every build. Replace short identifiers that are
  // neither property accesses nor object keys by "_" so only real logic changes move the hash.
  const fingerprint = (code) => {
    const tokens = (code.match(TOKEN_RE) || []).filter((t) => !/^\s+$/.test(t));
    const out = [];
    const literals = new Set();
    const properties = new Set();
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const prev = i > 0 ? tokens[i - 1] : '';
      const next = i + 1 < tokens.length ? tokens[i + 1] : '';
      if (t[0] === '"' || t[0] === "'" || t[0] === '`') {
        literals.add(t.slice(1, -1));
        out.push(t);
        continue;
      }
      if (/^[A-Za-z_$]/.test(t)) {
        const isProperty = prev === '.';
        const isKey = (prev === '{' || prev === ',') && next === ':';
        if (isProperty || isKey) {
          if (t.length > 1) properties.add(t);
          out.push(t);
          continue;
        }
        if (t.length <= 3 && !KEYWORDS.has(t)) {
          out.push('_');
          continue;
        }
      }
      out.push(t);
    }
    const normalized = out.join(' ');
    return {
      hash: fnv(normalized),
      tokens: out.length,
      literals: [...literals].sort(),
      properties: [...properties].sort(),
    };
  };

  // 1. Regulation enum: e.Gpdr="gpdr",e.UkGdpr="uk_gdpr",...
  const regulations = {};
  const enumAt = source.indexOf('.Gpdr="');
  if (enumAt < 0) {
    problems.push('Regulation enum not found (anchor .Gpdr=")');
  } else {
    const start = source.lastIndexOf('function(', enumAt);
    const end = source.indexOf('}', enumAt);
    const body = source.slice(start, end);
    const re = /[\w$]+\.([\w$]+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(body))) regulations[m[1]] = m[2];
    if (Object.keys(regulations).length === 0) problems.push('Regulation enum is empty');
  }

  // 2. Region table: {countries:[{internalIsoCode:...,isoCodes:[...],regulation:Nn.g.Gpdr},...],subdivisions:[...]}
  let regionTable = null;
  let tableEnd = -1;
  const tableAnchor = source.indexOf('countries:[{internalIsoCode:');
  if (tableAnchor < 0) {
    problems.push('Region table not found (anchor countries:[{internalIsoCode:)');
  } else {
    const open = source.lastIndexOf('{', tableAnchor);
    tableEnd = matchBracket(source, open);
    if (tableEnd < 0) {
      problems.push('Region table: unbalanced brackets');
    } else {
      const literal = source.slice(open, tableEnd + 1);
      const json = literal
        .replace(/regulation:([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g, (_, ref) => 'regulation:"' + ref.split('.').pop() + '"')
        .replace(/([{,])([A-Za-z_$][\w$]*):/g, '$1"$2":');
      try {
        const raw = JSON.parse(json);
        const resolve = (key) => (key in regulations ? regulations[key] : 'UNRESOLVED:' + key);
        regionTable = {
          countries: (raw.countries || []).map((c) => ({
            internalIsoCode: c.internalIsoCode,
            isoCodes: c.isoCodes,
            regulation: resolve(c.regulation),
          })),
          subdivisions: (raw.subdivisions || []).map((s) => ({
            internalIsoCode: s.internalIsoCode,
            countryIsoCode: s.countryIsoCode,
            isoCodes: s.isoCodes,
            regulation: resolve(s.regulation),
          })),
        };
        const extraKeys = Object.keys(raw).filter((k) => k !== 'countries' && k !== 'subdivisions');
        if (extraKeys.length) problems.push('Region table has new top-level keys: ' + extraKeys.join(', '));
      } catch (err) {
        problems.push('Region table could not be parsed: ' + err.message);
      }
    }
  }

  // 3. Code fingerprints.
  const blocks = {};
  const methodBlock = (name, signature) => {
    const at = source.indexOf(signature);
    if (at < 0) {
      problems.push(name + ': not found (anchor ' + signature + ')');
      return;
    }
    const open = source.indexOf('{', at + signature.length - 1);
    const close = matchBracket(source, open);
    if (close < 0) {
      problems.push(name + ': unbalanced brackets');
      return;
    }
    blocks[name] = fingerprint(source.slice(at, close + 1));
  };
  methodBlock('getCookiesConfig', 'getCookiesConfig(){');
  methodBlock('resolveABTestFor', 'resolveABTestFor(e,t,n){');

  // Helpers declared right after the region table (regulationFor, langKey, byLang, sameRegulation, preferRegulation).
  if (tableEnd > 0) {
    const stop = source.indexOf(';function ', tableEnd);
    if (stop < 0 || stop - tableEnd > 4000) problems.push('geoHelpers: end marker not found near the region table');
    else blocks.geoHelpers = fingerprint(source.slice(tableEnd + 1, stop));
  }

  // A/B test targeting helpers live right after the "axeptio_ab" cookie name.
  const abAt = source.indexOf('"axeptio_ab"');
  if (abAt < 0) problems.push('abTargeting: anchor "axeptio_ab" not found');
  else blocks.abTargeting = fingerprint(source.slice(abAt, abAt + 2400));

  const pageAt = source.indexOf('pageMatch(e){');
  if (pageAt < 0) problems.push('pageMatch: not found');
  else {
    const stop = source.indexOf('startService(', pageAt);
    blocks.pageMatch = fingerprint(source.slice(pageAt, stop > pageAt && stop - pageAt < 1500 ? stop : pageAt + 600));
  }

  const headers = {
    'X-Viewer-Country': source.includes('"X-Viewer-Country"'),
    'X-Viewer-Country-Region': source.includes('"X-Viewer-Country-Region"'),
  };
  if (!headers['X-Viewer-Country'] || !headers['X-Viewer-Country-Region']) problems.push('Geolocation headers changed');

  return { regulations, regionTable, headers, blocks, problems };
}
