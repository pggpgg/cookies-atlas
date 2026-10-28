/**
 * Runs Axeptio's own selection code, cut out of sdk.js, in an isolated `vm` context, so the
 * engine can be compared with the real thing (tests/sdk-live.test.mjs, weekly drift workflow).
 *
 * Only three small slices are evaluated: the region table with its helpers, getCookiesConfig()
 * and pageMatch(). `document` and `window` are fakes the caller controls per visitor.
 */
import vm from 'node:vm';
import { extractSdkSnapshot } from './extract-core.mjs';

function matchBracket(src, open) {
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
}

export function buildSdkHarness(source) {
  const anchor = source.indexOf('countries:[{internalIsoCode:');
  if (anchor < 0) throw new Error('Region table not found in sdk.js');
  const tableStart = source.lastIndexOf('var ', anchor);
  const helpersEnd = source.indexOf(';function ', anchor);
  const helpers = source.slice(tableStart, helpersEnd + 1);

  const methodStart = source.indexOf('getCookiesConfig(){');
  if (methodStart < 0) throw new Error('getCookiesConfig() not found in sdk.js');
  const methodEnd = matchBracket(source, source.indexOf('{', methodStart));
  const method = source.slice(methodStart, methodEnd + 1);

  const pageStart = source.indexOf('pageMatch(e){');
  const pageEnd = source.indexOf('startService(', pageStart);
  if (pageStart < 0 || pageEnd < 0) throw new Error('pageMatch() not found in sdk.js');
  const pageMatch = source.slice(pageStart, pageEnd);

  // The table refers to the regulation enum through a module object (e.g. Nn.g.Gpdr).
  const enumRef = helpers.match(/regulation:([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.[A-Za-z_$][\w$]*/);
  if (!enumRef) throw new Error('Regulation enum reference not found');
  const { regulations } = extractSdkSnapshot(source);
  // The helper getCookiesConfig() calls to get the visitor's regulation.
  const regulationFn = method.match(/=([A-Za-z_$][\w$]*)\(this\.settings\.countryCode,this\.settings\.subdivisionCode\)/);
  if (!regulationFn) throw new Error('Regulation helper not found in getCookiesConfig()');

  const env = {
    document: { documentElement: { lang: '' } },
    window: { navigator: { language: 'en' }, location: { pathname: '/', search: '' } },
  };
  const context = vm.createContext({
    [enumRef[1]]: { [enumRef[2]]: { ...regulations } },
    document: env.document,
    window: env.window,
  });
  const api = vm.runInContext(
    `${helpers}\n;({ getCookiesConfig: function ${method}, pageMatch: function ${pageMatch}, regulationFor: ${regulationFn[1]} })`,
    context,
    { timeout: 5000 },
  );

  return {
    /** What the real SDK returns for a visitor: the config identifier (or null) and the fallback flag. */
    select(project, visitor) {
      env.document.documentElement.lang = visitor.documentLanguage ?? '';
      env.window.navigator.language = visitor.browserLanguage ?? undefined;
      env.window.location.pathname = visitor.pagePath ?? '/';
      env.window.location.search = '';
      const ctx = {
        settings: {
          countryCode: visitor.countryCode,
          subdivisionCode: visitor.subdivisionCode,
          useDocumentLang: Boolean(visitor.useDocumentLang),
          cookiesVersion: visitor.cookiesVersion ?? undefined,
          isFallback: false,
        },
        config: project,
        activeABTest: null,
        resolveABTestFor: () => null,
        _applyPostSelectionTransforms: (config) => config,
        pageMatch: api.pageMatch,
      };
      const config = api.getCookiesConfig.call(ctx);
      return { id: config ? config.identifier : null, isFallback: ctx.settings.isFallback };
    },
    regulationFor: (country, subdivision) => api.regulationFor(country, subdivision),
  };
}
