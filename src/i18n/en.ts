import type { Finding, UnreachableTarget } from '../engine/diagnostics';
import type { CopyContext, FindingCopy, Messages } from './types';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Names that take "the" inside a sentence: the United States, the Netherlands, the Cayman Islands... */
const TAKES_THE =
  /^(United |Republic |Democratic |Central African |Dominican |Czech Republic|Federated |Holy See|Netherlands|Philippines|Bahamas|Gambia|Maldives|Seychelles|Comoros|Vatican)|( Islands| Isles)$/;

/** Where visitors in an unreachable code are located: "Île-de-France (FR-IDF)", "the country Puerto Rico (PR)". */
const located = (u: UnreachableTarget, c: CopyContext) =>
  u.instead.level === 'country' ? `the country ${c.country(u.instead.key)} (${u.instead.key})` : c.regionWithCode(u.instead.key);
const unreachableMoves = (list: UnreachableTarget[], c: CopyContext) =>
  c.list(list.map((u) => `visitors in ${u.value} are located in ${located(u, c)}`));
const unreachableFix = (list: UnreachableTarget[], c: CopyContext) =>
  `Target ${c.list(list.map((u) => `${located(u, c)} instead of ${u.value}`))}.`;

function finding(f: Finding, c: CopyContext): FindingCopy {
  const d = f.data as Record<string, any>;
  switch (f.kind) {
    case 'geolocation-off':
      return {
        title: 'Location-based display is off',
        mechanism: `Without it, the SDK ignores where visitors are. It serves the banner the site pins with cookiesVersion, else a banner whose page rules match the page, else the first banner in your list (${c.config(d.defaultConfig)}).`,
        fix: 'Turn on Location-based display in My banners, then pick a fallback banner. The map shows what that would give.',
      };
    case 'visibility-empty':
      return {
        title: 'Banner visibility hides the banner everywhere',
        mechanism: 'Banner visibility is on with an empty country list, so the SDK returns no banner for anyone.',
        fix: 'Add the countries where the banner must show, or turn banner visibility off.',
      };
    case 'visibility-restricted':
      return {
        title: `The banner only shows in ${d.allowed.length} ${plural(d.allowed.length, 'country', 'countries')}`,
        mechanism: `Banner visibility is on: visitors outside ${c.placesIn(d.allowed, 8)} get no banner at all, before location-based display even runs.`,
        fix: 'Check that every country where you need consent is in the list.',
      };
    case 'fallback-invalid':
      return {
        title: "The fallback banner doesn't exist",
        mechanism: `Location-based display points to the fallback ${d.fallbackId}, which isn't among the published banners. Visitors no banner targets get the first banner in your list instead.`,
        fix: 'Pick an existing banner as the fallback, then publish.',
      };
    case 'fallback-missing':
      return {
        title: 'No fallback banner',
        mechanism: `${d.regionCount} ${plural(d.regionCount, 'country matches', 'countries match')} no banner. Without a fallback, the SDK gives them the first banner in your list (${c.config(d.defaultConfig)}).`,
        fix: 'Pick a fallback banner in Location-based display. When in doubt, use an opt-in one.',
      };
    case 'dead-config': {
      const name = c.config(f.configs[0]);
      const by = c.config(d.by);
      const home = d.home ? c.placeIn(d.home) : '';
      const pages = d.hasPageRules ? ' It has page rules, so it can still show on matching pages when no banner matches the visitor’s location.' : '';
      const mechanisms: Record<string, string> = {
        order: `In ${home}, it ties with ${by}, which uses the same language (${c.language(d.language)}) and comes first in your list. The SDK keeps the first one, so ${name} never wins.`,
        specificity: `In ${home}, ${by} wins at an earlier step. The SDK checks banners targeting the region first, then banners listing a single country, then banners listing several.`,
        regulation: `In ${home}, ${by} matches the visitor's regulation and ${name} doesn't, so the SDK sets ${name} aside.`,
        untargeted: "It doesn't list any country or region a visitor can match, and never wins the regulation match or the fallback.",
        unreachable: d.unreachable
          ? `It only targets ${c.list((d.unreachable as UnreachableTarget[]).map((u) => c.regionWithCode(u.value)))}, and Axeptio locates visitors by country and first-level region only: ${unreachableMoves(d.unreachable, c)}.`
          : '',
        unknown: 'It never wins, in any country, for any language.',
      };
      const fixes: Record<string, string> = {
        order: `Delete it if it's a leftover, or change its language or countries so it no longer overlaps ${by}.`,
        specificity: `If it should win in ${home}, remove ${home} from ${by}, or target ${home} more precisely with ${name}.`,
        regulation: `If it's meant for ${home}, give it the same regulation as ${by}.`,
        untargeted: 'List the countries it is meant for, or delete it.',
        unreachable: d.unreachable ? unreachableFix(d.unreachable, c) : '',
        unknown: 'Check its countries, region and language.',
      };
      return { title: `${name} is never shown`, mechanism: mechanisms[d.reason] + pages, fix: fixes[d.reason] };
    }
    case 'over-capture': {
      const n = d.capturing.length;
      const they = (one: string, many: string) => plural(n, one, many);
      const capturing = c.configs(d.capturing);
      const country = c.countryIn(d.country);
      const intended = c.placesIn(d.intended);
      const competitor = d.competitor ? c.config(d.competitor) : null;
      const regs = (d.regulations ?? []) as string[];
      const keeps = `${intended} ${plural(d.intended.length, 'keeps its', 'keep their')} ${they('banner', 'banners')}, since region matches come first`;
      const add =
        regs.length > 1
          ? `Add banners listing only ${country}, one per regulation (${c.regulations(regs)})`
          : regs.length === 1
            ? `Add a banner listing only ${country}, with the ${c.regulation(regs[0])} regulation`
            : `Add a banner listing only ${country}`;
      const created = plural(Math.max(regs.length, 1), 'the new one', 'the new ones');
      if (d.step === 'multi-country') {
        return {
          title: `${capturing} also ${they('shows', 'show')} in the rest of ${country}`,
          mechanism: `${they('It targets', 'They target')} ${intended}, but ${they('it also lists', 'they also list')} ${country} among other countries. Elsewhere in ${country}, no banner targets the visitor's region and none lists ${country} alone, so the SDK picks among banners listing it with others, and ${they('this one wins', 'these win')}.`,
          fix: `${add}. Banners listing a single country come before banners listing several, so the rest of ${country} gets ${created}; ${keeps}.`,
        };
      }
      return {
        title: `${capturing} also ${they('shows', 'show')} in the rest of ${country}`,
        mechanism:
          `${they('It targets', 'They target')} ${intended}, but ${they('it lists', 'they list')} ${country} as ${they('its', 'their')} only country. Elsewhere in ${country}, no banner targets the visitor's region, so the SDK moves on to banners listing only ${country}, and ${they('this one wins', 'these win')}.` +
          (competitor ? ` ${competitor} lists ${country} too, but among other countries, so it only comes after.` : ''),
        fix:
          regs.length > 0
            ? `${add}${competitor ? ` (for example, split ${competitor} into one banner per country)` : ''}. Among banners listing only ${country}, the SDK prefers the one whose regulation matches the visitor's region, so the rest of ${country} gets ${created}; ${keeps}.`
            : `${add} for each language ${they('it uses', 'they use')}, above ${they('it', 'them')} in your list. With no regulation to prefer in ${country}, the SDK breaks the tie by visitor language, then by list order; ${keeps}.`,
      };
    }
    case 'regulation-mismatch': {
      const places = c.placesIn(f.regions);
      const configs = c.configs(f.configs);
      const theirs = d.configRegulation ? c.regulation(d.configRegulation) : 'no regulation';
      const built = d.configRegulation ? `built for ${theirs}` : plural(f.configs.length, 'which has no regulation', 'which have no regulation');
      const one = f.regions.length === 1;
      const how = d.targeted
        ? `because ${plural(f.configs.length, 'it lists', 'they list')} ${one ? 'it' : 'them'}`
        : `because no banner targets ${one ? 'it' : 'them'}, so ${one ? 'it gets' : 'they get'} the ${c.list((d.steps as string[]).map((s) => c.step(s as any).toLowerCase()))}`;
      const short = cap(c.placesIn(f.regions, 3));
      const banner: Record<string, string> = {
        'opt-out': 'an opt-out banner',
        none: 'a banner with no regulation',
        unknown: 'a banner with an unknown regulation',
      };
      return {
        title:
          f.severity === 'error'
            ? `${short} ${one ? 'gets' : 'get'} ${banner[d.configKind] ?? banner['opt-out']} where consent comes first`
            : `${short} ${one ? 'gets' : 'get'} ${d.configRegulation ? `a banner built for ${theirs}` : banner.none}`,
        mechanism: `${cap(places)} ${one ? 'falls' : 'fall'} under ${c.regulations(d.regulations)}, but ${one ? 'gets' : 'get'} ${configs}, ${built}, ${how}.`,
        fix:
          f.severity === 'error'
            ? `Add a banner with the right regulation that lists these places. If you'd rather keep one banner for the rest of the world, make your fallback an opt-in banner.`
            : 'Fine if it’s intentional. Otherwise, add banners with the matching regulation for these places.',
      };
    }
    case 'shadowed-listing': {
      const shadowed = c.configs(d.shadowed);
      const winners = c.configs(d.winners);
      const places = c.placesIn(f.regions);
      const reasons: Record<string, string> = {
        specificity: `${winners} ${plural(d.winners.length, 'wins', 'win')} there at an earlier step: a banner listing a single country beats banners listing several.`,
        order: `${c.config(d.by)} uses the same language and comes first in your list.`,
        regulation: `${c.config(d.by)} matches the visitor's regulation there.`,
        untargeted: `${winners} ${plural(d.winners.length, 'wins', 'win')} there.`,
        unknown: `${winners} ${plural(d.winners.length, 'wins', 'win')} there.`,
      };
      return {
        title: `${shadowed} ${plural(d.shadowed.length, 'lists', 'list')} ${places} but never ${plural(d.shadowed.length, 'shows', 'show')} there`,
        mechanism: reasons[d.reason] ?? reasons.unknown,
        fix: `Remove ${places} from ${shadowed} to keep the setup readable, or change ${winners} if ${plural(d.winners.length, 'it', 'they')} shouldn't win there.`,
      };
    }
    case 'order-tie':
      return {
        title: `${c.config(f.configs[1])} loses to ${c.config(f.configs[0])} in ${f.regions.length} ${plural(f.regions.length, 'place', 'places')}`,
        mechanism: `Both use ${c.language(d.language)}. When they tie (${c.places(f.regions)}), the SDK keeps the first one in your list.`,
        fix: 'Make their countries distinct, or delete the one you don’t need.',
      };
    case 'regulation-capture':
      return {
        title: `${d.count} ${plural(d.count, 'country you don’t list gets', 'countries you don’t list get')} ${c.configs(f.configs)}`,
        mechanism: `${cap(c.placesIn(f.regions))} ${plural(d.count, 'falls', 'fall')} under ${c.regulation(d.regulation)} in Axeptio's table. No banner lists ${plural(d.count, 'it', 'them')}, so the SDK picks among your ${c.regulation(d.regulation)} banners, by visitor language.`,
        fix: 'Expected if you want one banner for the whole regulation. List these countries in a banner if they need their own.',
      };
    case 'subdivision-format': {
      const suggestion = (d.suggestions as Array<string | null>).filter(Boolean)[0];
      return {
        title: `Region code ${c.list(d.values)} isn't in the COUNTRY-REGION format`,
        mechanism: `The SDK compares regions written like CA-QC (country, dash, region). ${c.list(d.values)} never matches, so ${c.configs(f.configs)} only ${plural(f.configs.length, 'matches', 'match')} by country, which covers the whole country.`,
        fix: suggestion ? `Use ${suggestion} instead.` : 'Write the region as COUNTRY-REGION, for example CA-QC.',
      };
    }
    case 'unreachable-subdivision': {
      const list = d.unreachable as UnreachableTarget[];
      const values = c.list(list.map((u) => u.value));
      return {
        title: `${values} never ${plural(list.length, 'matches', 'match')} a visitor`,
        mechanism: `${c.configs(f.configs)} ${plural(f.configs.length, 'targets', 'target')} ${plural(list.length, 'this region', 'these regions')}, but Axeptio locates visitors by country and first-level region only: ${unreachableMoves(list, c)}. ${plural(list.length, 'This code', 'These codes')} never ${plural(list.length, 'matches', 'match')}.`,
        fix: unreachableFix(list, c),
      };
    }
    case 'unknown-country': {
      const suggestion = (d.suggestions as Array<string | null>).filter(Boolean)[0];
      return {
        title: `Unknown country code ${c.list(d.values)}`,
        mechanism: `Axeptio compares ISO 3166-1 country codes. ${c.list(d.values)} never matches a visitor, so ${c.config(f.configs[0])} doesn't cover that country.`,
        fix: suggestion ? `Use ${suggestion} instead.` : "Use the country's ISO code.",
      };
    }
    case 'unknown-regulation':
      return {
        title: `Unknown regulation “${d.value}”`,
        mechanism: `The SDK only knows gpdr, uk_gdpr, fadp, ccpa, gpp, lgpd and loi25 (yes, GDPR is spelled gpdr). ${c.config(f.configs[0])} never wins the regulation preference.`,
        fix: d.suggestion ? `Set its regulation to ${d.suggestion}.` : 'Pick one of the regulations above.',
      };
    case 'invalid-page-rule':
      return d.problem === 'malformed'
        ? {
            title: `Malformed page rule in ${c.config(f.configs[0])}`,
            mechanism: 'One of its page rules is malformed. When the SDK falls back to page rules, it throws an error and may show no banner at all.',
            fix: 'Delete the rule or give it a URL, then publish.',
          }
        : {
            title: `Broken page rule ${d.url}`,
            mechanism: 'This regular expression is invalid. When the SDK falls back to page rules, it throws an error and may show no banner at all.',
            fix: 'Fix the pattern, or turn off the regex option for this rule.',
          };
    case 'ab-test':
      return {
        title: `A/B test ${d.testId} is running`,
        mechanism: `Visitors who get one of its banners are split between ${c.configs(f.configs)}${d.endDate ? ` until ${c.date(d.endDate)}` : ''}. The map shows the banner before the split.`,
      };
    default:
      return { title: f.kind, mechanism: '' };
  }
}

export const en: Messages = {
  locale: 'en',
  article: (name) => (TAKES_THE.test(name) ? `the ${name}` : name),
  app: {
    title: 'Cookies Atlas',
    tagline: 'See which Axeptio banner each country gets, and why.',
    sourceNote: 'Reads the public, published project file. Nothing is stored.',
    repo: 'Source on GitHub',
    sdkDate: (date) => `Selection logic mirrors Axeptio's SDK as of ${date}.`,
  },
  input: {
    label: 'Axeptio project ID',
    placeholder: 'Project ID, e.g. 691245e5b48e4a03c7b9c5c5',
    submit: 'Show map',
    invalid: 'A project ID is 24 characters (0-9 and a-f), like 691245e5b48e4a03c7b9c5c5.',
    recent: 'Recent projects',
    example: "Try Axeptio's own site",
    clearRecent: 'Clear',
  },
  load: {
    loading: 'Loading the published project…',
    notFound: 'No published project with this ID. Check the ID, and that the project was published at least once.',
    network: "Couldn't reach Axeptio. Check your connection and try again.",
    invalid: "This file doesn't look like an Axeptio project.",
    empty: 'This project has no published banner yet.',
    retry: 'Try again',
  },
  theme: { label: 'Theme', light: 'Light', dark: 'Dark', system: 'System' },
  uiLanguage: 'Language',
  summary: {
    published: (date) => `Published ${date}`,
    geoOn: 'Location-based display on',
    geoOff: 'Location-based display off',
    fallback: (name) => `Fallback: ${name}`,
    noFallback: 'No fallback',
    banners: (n) => `${n} ${plural(n, 'banner', 'banners')}`,
    visibility: (n) => `Shown in ${n} ${plural(n, 'country', 'countries')} only`,
    you: 'You',
    youGet: (place, banner) => `You're seen in ${place} and get ${banner}`,
    youNoBanner: (place) => `You're seen in ${place} and get no banner`,
    youUnknown: "Axeptio couldn't tell where you are",
    copyId: 'Copy project ID',
    copied: 'Copied',
    openAdmin: 'Open in Axeptio',
  },
  geoOff: {
    title: 'Location-based display is off',
    body: (banner, hasPageRules) =>
      `Right now geography doesn't matter: every visitor gets ${banner}${hasPageRules ? ' (or a banner restricted to the page they are on)' : ''}, unless the site pins another one with cookiesVersion.`,
    preview: 'Preview with location-based display on',
    today: 'Today',
    fix: 'To use it: My banners → Location-based display, then pick a fallback banner.',
  },
  map: {
    title: 'Map',
    language: 'Visitor language',
    allLanguages: 'All',
    otherLanguages: 'Other',
    reset: 'Reset view',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    export: 'Export PNG',
    exporting: 'Exporting…',
    copyLink: 'Copy link',
    linkCopied: 'Link copied',
    ariaLabel: (project) => `World map of the banner Axeptio serves in each country for ${project}. The Table tab lists the same information.`,
    previewBadge: 'Preview: location-based display on',
    todayBadge: 'Today: location-based display off',
    keyTitle: 'How to read the map',
    keySolid: 'A banner targets this place',
    keyLight: 'Reached indirectly (regulation, fallback or default)',
    keyStriped: 'Depends on the visitor’s language',
    keyNone: 'No banner',
    keyYou: 'You are here',
    clickHint: 'Click to simulate a visitor here',
    noRegulation: "No privacy law in Axeptio's table",
    howLabel: 'How',
    abNote: (testId) => `A/B test ${testId} may swap the banner`,
    youAreHere: 'You are here',
    rest: (country) => `${country} (other regions)`,
  },
  tabs: { banners: 'Banners', simulator: 'Simulator', diagnostics: 'Diagnostics', table: 'Table' },
  legend: {
    intro: 'Each color is one banner. Hover to highlight where it shows, click to isolate it.',
    lists: (n) => `lists ${n} ${plural(n, 'country', 'countries')}`,
    listsNothing: 'lists no country',
    regionsTargeted: (n) => `${n} ${plural(n, 'region', 'regions')}`,
    wins: (countries, regions) => {
      const parts = [
        countries ? `${countries} ${plural(countries, 'country', 'countries')}` : '',
        regions ? `${regions} ${plural(regions, 'region', 'regions')}` : '',
      ].filter(Boolean);
      return parts.length ? `shown in ${parts.join(' and ')}` : 'shown nowhere';
    },
    notDefault: (hasPageRules) => `shown only when the site pins it with cookiesVersion${hasPageRules ? ', or on pages its rules match' : ''}`,
    neverShown: 'Never shown',
    fallback: 'Fallback',
    abTest: 'A/B test',
    otherBanners: (n) => `${n} other ${plural(n, 'banner', 'banners')}`,
    isolate: 'Isolate on the map',
    clearIsolation: 'Show all banners',
    noBanner: 'No banner',
    admin: 'Edit in Axeptio',
  },
  simulator: {
    intro: 'Pick a place and a visitor. The SDK’s steps show up below, in order.',
    region: 'Visitor location',
    country: 'Country',
    subregion: 'Region',
    anyRegion: 'Any region',
    loadingRegions: 'Loading regions…',
    browserLanguage: 'Browser language',
    pageLanguage: 'Page language (html lang)',
    logic: 'Language used for tie-breaks',
    logicBrowser: 'Browser language (default)',
    logicHtml: 'Page language (useDocumentLang)',
    logicHint: 'Sites can set useDocumentLang in the Axeptio settings to tie-break on the page language instead of the browser’s.',
    siteSettings: 'Site settings',
    cookiesVersion: 'cookiesVersion pinned by the site',
    cookiesVersionHint: 'Only used when location-based display finds nothing.',
    pagePath: 'Page path',
    pagePathHint: 'For banners restricted to pages. Defaults to /.',
    result: 'This visitor gets',
    resultNone: 'No banner',
    resultHidden: 'Hidden by banner visibility',
    viaFallback: 'through the fallback',
    why: 'Why',
    copyScenario: 'Copy link to this scenario',
    pickRegion: 'Pick a country, or click the map.',
    unknownCountry: 'Unknown location',
  },
  trace: {
    language: (source, raw, key) =>
      source === 'document'
        ? `Tie-breaks use the page language (useDocumentLang): ${raw ? `“${raw}”` : 'empty'}${key ? ` → ${key}` : ''}.`
        : `Tie-breaks use the browser language: ${raw ? `“${raw}”` : 'none'}${key ? ` → ${key}` : ''}.`,
    regulation: (place, regulation, c) =>
      regulation
        ? `${cap(place)} falls under ${c.regulation(regulation)} in Axeptio's table.`
        : `${cap(place)} has no regulation in Axeptio's table.`,
    visibility: (allowed, passed, c) =>
      passed
        ? `Banner visibility is on (${c.places(allowed, 6)}): this visitor is allowed.`
        : allowed.length
          ? `Banner visibility is on (${c.places(allowed, 6)}): this visitor gets no banner.`
          : 'Banner visibility is on with no country: nobody gets a banner.',
    geolocation: (enabled, forced) =>
      enabled
        ? 'Location-based display is on.'
        : forced
          ? 'Location-based display is off, previewed as on.'
          : 'Location-based display is off: location is ignored.',
    candidates: (e, regulation, c) => {
      const labels = {
        subdivision: (n: number) =>
          n ? `${n} ${plural(n, 'banner targets', 'banners target')} the region ${e.key}` : `No banner targets the region ${e.key ?? ''}`.trim(),
        'single-country': (n: number) =>
          n ? `${n} single-country ${plural(n, 'banner lists', 'banners list')} ${e.key}` : `No single-country banner lists ${e.key ?? 'this country'}`,
        'multi-country': (n: number) =>
          n ? `${n} ${plural(n, 'banner lists', 'banners list')} ${e.key} among other countries` : `No banner lists ${e.key ?? 'this country'}`,
        regulation: (n: number) =>
          n ? `${n} ${plural(n, 'banner uses', 'banners use')} ${c.regulation(e.key)}` : `No banner uses ${c.regulation(e.key)}`,
      };
      let text = labels[e.step](e.matched.length);
      if (e.matched.length > 1 && e.step !== 'regulation') {
        if (e.regulationApplied) text += `; kept ${c.configs(e.preferred)} for ${c.regulation(regulation)}`;
        else if (regulation) text += `; none uses ${c.regulation(regulation)}, so all stay in the running`;
      }
      if (e.winner && e.tieBreak) {
        const lang = e.tieBreak.language ? c.language(e.tieBreak.language) : null;
        if (!e.tieBreak.byOrder) text += `; language tie-break (${lang}) picks ${c.config(e.winner)}`;
        else if (e.tieBreak.languageMatches.length > 1) text += `; several use ${lang}, the first in the list wins: ${c.config(e.winner)}`;
        else text += `; none uses ${lang ?? 'the visitor’s language'}, the first in the list wins: ${c.config(e.winner)}`;
      } else if (e.winner) {
        text += `: ${c.config(e.winner)}`;
      }
      return text + '.';
    },
    stop: "No regulation for this place, so location-based matching stops here.",
    fallback: (configId, found, c) =>
      found ? `Nothing matched: the fallback banner ${c.config(configId)} is used.` : configId ? `Nothing matched, and the fallback ${configId} doesn't exist.` : 'Nothing matched, and there is no fallback banner.',
    nonGeo: (e, c) => {
      if (e.strategy === 'cookiesVersion') return `The site pins cookiesVersion “${e.cookiesVersion}”: ${c.config(e.winner)}.`;
      const pinned = e.cookiesVersion && !e.cookiesVersionMatched ? `cookiesVersion “${e.cookiesVersion}” matches no banner. ` : '';
      if (e.strategy === 'page') return `${pinned}${c.config(e.winner)} has a page rule matching ${e.pagePath}.`;
      if (e.strategy === 'default') {
        const excluded = e.excludedByPages.length ? ` (${c.configs(e.excludedByPages)} ${plural(e.excludedByPages.length, 'is', 'are')} limited to other pages)` : '';
        return `${pinned}First banner in your list: ${c.config(e.winner)}${excluded}.`;
      }
      return `${pinned}No banner is available.`;
    },
    abTest: (testId, variants, c) => `A/B test ${testId} may swap it for ${c.configs(variants)} (split per visitor).`,
  },
  steps: {
    visibility: 'Hidden (banner visibility)',
    subdivision: 'Region match',
    'single-country': 'Single-country match',
    'multi-country': 'Multi-country match',
    regulation: 'Regulation match',
    fallback: 'Fallback banner',
    cookiesVersion: 'Pinned by cookiesVersion',
    page: 'Page rule',
    default: 'First banner (default)',
    none: 'No banner',
  },
  regulations: {
    gpdr: 'GDPR',
    uk_gdpr: 'UK GDPR',
    fadp: 'nFADP (Switzerland)',
    ccpa: 'CCPA',
    gpp: 'US state laws (GPP)',
    lgpd: 'LGPD (Brazil)',
    loi25: 'Law 25 (Québec)',
  },
  diagnostics: {
    intro: 'What the map reveals, worst first. Each finding explains how the SDK decides and what to change.',
    previewNote: 'Location-based display is off, so these findings describe what would happen once you turn it on.',
    none: 'Nothing to flag: every banner shows where it should.',
    severity: { error: 'Problem', warning: 'Check', info: 'Note' },
    why: 'Why:',
    fix: 'Fix:',
    showOnMap: 'Show on map',
    finding,
  },
  table: {
    intro: 'Every place the map can show, with the banner each visitor language gets.',
    filter: 'Filter places or banners',
    place: 'Place',
    regulation: 'Regulation',
    how: 'How',
    banner: 'Banner by language',
    none: 'None',
    rows: (n) => `${n} ${plural(n, 'place', 'places')}`,
  },
  bookmarklet: {
    title: 'Bookmarklet',
    body: 'Drag this button to your bookmarks bar. On any site using Axeptio, click it to open that site’s map.',
    linkLabel: 'Cookies Atlas',
    notFound: 'Cookies Atlas: no Axeptio project found on this page.',
  },
  empty: {
    title: 'Which banner does each country get?',
    body: 'Paste an Axeptio project ID to see, on a map, which banner the SDK serves in every country and region, why, and what looks misconfigured.',
    steps: [
      'The project ID is in the Axeptio admin (bottom left), or in the site’s axeptioSettings.clientId.',
      'The map follows the SDK’s own rules: region, then single-country, then multi-country banners, then regulation, then fallback.',
      'Share the link: it keeps the project, the language and the simulated visitor.',
    ],
  },
  footer: {
    disclaimer: 'Cookies Atlas replays the SDK’s selection rules. For a critical case, double-check from the real location.',
  },
};
