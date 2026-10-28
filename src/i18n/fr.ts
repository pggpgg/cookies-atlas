import type { Finding, UnreachableTarget } from '../engine/diagnostics';
import type { CopyContext, FindingCopy, Messages } from './types';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// Le texte évite les articles devant les noms de pays (« la France », « les États-Unis ») : ils
// apparaissent entre parenthèses, après un deux-points, ou derrière « ce pays » / « cet endroit ».

/** Où sont localisés les visiteurs d’un code inatteignable : « la région Île-de-France (FR-IDF) », « le pays Porto Rico (PR) ». */
const located = (u: UnreachableTarget, c: CopyContext) =>
  u.instead.level === 'country' ? `le pays ${c.country(u.instead.key)} (${u.instead.key})` : `la région ${c.regionWithCode(u.instead.key)}`;
const unreachableMoves = (list: UnreachableTarget[], c: CopyContext) =>
  c.list(list.map((u) => `les visiteurs de ${u.value} sont localisés dans ${located(u, c)}`));
/** Un code de région suivi de son nom, sans article : « FR-75 (Paris) ». */
const zone = (key: string, c: CopyContext) => {
  const name = c.regionName(key);
  return name ? `${key} (${name})` : key;
};
const unreachableFix = (list: UnreachableTarget[], c: CopyContext) =>
  `Ciblez ${c.list(list.map((u) => `${located(u, c)} au lieu de ${u.value}`))}.`;

function finding(f: Finding, c: CopyContext): FindingCopy {
  const d = f.data as Record<string, any>;
  switch (f.kind) {
    case 'geolocation-off':
      return {
        title: 'Le location-based display est désactivé',
        mechanism: `Sans lui, le SDK ignore d’où viennent les visiteurs. Il sert le bandeau fixé par le cookiesVersion du site, sinon un bandeau dont les règles de pages matchent la page, sinon le premier bandeau de votre liste (${c.config(d.defaultConfig)}).`,
        fix: 'Activez le Location-based display dans Mes bandeaux, puis choisissez un bandeau de fallback. La carte montre ce que ça donnerait.',
      };
    case 'visibility-empty':
      return {
        title: 'La visibilité du bandeau le cache partout',
        mechanism: 'La visibilité du bandeau est activée avec une liste de pays vide : le SDK ne sert aucun bandeau, à personne.',
        fix: 'Ajoutez les pays où le bandeau doit s’afficher, ou désactivez la visibilité du bandeau.',
      };
    case 'visibility-restricted':
      return {
        title: `Le bandeau s’affiche seulement dans ${d.allowed.length} ${plural(d.allowed.length, 'pays', 'pays')}`,
        mechanism: `La visibilité du bandeau est activée : hors des pays permis (${c.places(d.allowed, 8)}), les visiteurs n’ont aucun bandeau, avant même le location-based display.`,
        fix: 'Vérifiez que chaque pays où vous devez obtenir le consentement est dans la liste.',
      };
    case 'fallback-invalid':
      return {
        title: 'Le bandeau de fallback n’existe pas',
        mechanism: `Le location-based display pointe vers le fallback ${d.fallbackId}, qui ne fait pas partie des bandeaux publiés. Les visiteurs qu’aucun bandeau ne cible reçoivent plutôt le premier bandeau de votre liste.`,
        fix: 'Choisissez un bandeau existant comme fallback, puis publiez.',
      };
    case 'fallback-missing':
      return {
        title: 'Aucun bandeau de fallback',
        mechanism: `${d.regionCount} ${plural(d.regionCount, 'pays ne matche', 'pays ne matchent')} aucun bandeau. Sans fallback, le SDK leur sert le premier bandeau de votre liste (${c.config(d.defaultConfig)}).`,
        fix: 'Choisissez un bandeau de fallback dans Location-based display. Dans le doute, prenez un bandeau opt-in.',
      };
    case 'dead-config': {
      const name = c.config(f.configs[0]);
      const by = c.config(d.by);
      const home = d.home ? c.place(d.home) : '';
      const pages = d.hasPageRules ? ' Il a des règles de pages : il peut quand même s’afficher sur les pages qui matchent, quand aucun bandeau ne matche la localisation.' : '';
      const mechanisms: Record<string, string> = {
        order: `Là où il est listé (${home}), il est à égalité avec ${by}, qui a la même langue (${c.language(d.language)}) et vient avant dans votre liste. Le SDK garde le premier, donc ${name} ne gagne jamais.`,
        specificity: `Là où il est listé (${home}), ${by} gagne à une étape antérieure. Le SDK regarde d’abord les bandeaux qui ciblent la région, puis ceux qui listent un seul pays, puis ceux qui en listent plusieurs.`,
        regulation: `Là où il est listé (${home}), ${by} correspond à la réglementation du visiteur et pas ${name} : le SDK écarte ${name}.`,
        untargeted: 'Il ne liste aucun pays ni aucune région qui puisse matcher un visiteur, et ne gagne jamais le match par réglementation ni le fallback.',
        unreachable: d.unreachable
          ? `Il cible seulement ${c.list((d.unreachable as UnreachableTarget[]).map((u) => zone(u.value, c)))}, et Axeptio localise les visiteurs seulement par pays et par région de premier niveau : ${unreachableMoves(d.unreachable, c)}.`
          : '',
        unknown: 'Il ne gagne nulle part, dans aucune langue.',
      };
      const fixes: Record<string, string> = {
        order: `Supprimez-le si c’est un reste, ou changez sa langue ou ses pays pour qu’il ne chevauche plus ${by}.`,
        specificity: `S’il doit gagner à cet endroit (${home}), retirez cet endroit de ${by}, ou ciblez-le plus précisément avec ${name}.`,
        regulation: `Si ce bandeau vise cet endroit (${home}), donnez-lui la même réglementation que ${by}.`,
        untargeted: 'Listez les pays visés, ou supprimez-le.',
        unreachable: d.unreachable ? unreachableFix(d.unreachable, c) : '',
        unknown: 'Vérifiez ses pays, sa région et sa langue.',
      };
      return { title: `${name} ne s’affiche jamais`, mechanism: mechanisms[d.reason] + pages, fix: fixes[d.reason] };
    }
    case 'over-capture': {
      const many = d.capturing.length > 1;
      const capturing = c.configs(d.capturing);
      const country = c.country(d.country);
      const intended = `${d.intended.length > 1 ? 'les régions' : 'la région'} ${c.places(d.intended)}`;
      const competitor = d.competitor ? c.config(d.competitor) : null;
      const regs = (d.regulations ?? []) as string[];
      const keeps = `${intended} ${d.intended.length > 1 ? 'gardent leurs' : many ? 'garde ses' : 'garde son'} ${many ? 'bandeaux' : 'bandeau'}, puisque le match par région passe en premier`;
      const add =
        regs.length > 1
          ? `Ajoutez des bandeaux qui listent seulement ce pays (${country}), un par réglementation (${c.regulations(regs)})`
          : regs.length === 1
            ? `Ajoutez un bandeau qui liste seulement ce pays (${country}), avec la réglementation ${c.regulation(regs[0])}`
            : `Ajoutez un bandeau qui liste seulement ce pays (${country})`;
      const created = regs.length > 1 ? 'les nouveaux bandeaux' : 'le nouveau bandeau';
      const title = `${capturing} ${many ? 's’affichent' : 's’affiche'} aussi dans le reste du pays (${country})`;
      if (d.step === 'multi-country') {
        return {
          title,
          mechanism: `${many ? 'Ils ciblent' : 'Il cible'} ${intended}, mais ${many ? 'listent' : 'liste'} aussi ce pays parmi d’autres. Ailleurs au pays, aucun bandeau ne cible la région du visiteur et aucun ne liste ce pays seul : le SDK choisit donc parmi les bandeaux qui le listent avec d’autres pays, et ${many ? 'ce sont eux qui gagnent' : 'c’est lui qui gagne'}.`,
          fix: `${add}. Les bandeaux à pays unique passent avant ceux qui listent plusieurs pays : le reste du pays reçoit ${created}, et ${keeps}.`,
        };
      }
      return {
        title,
        mechanism:
          `${many ? 'Ils ciblent' : 'Il cible'} ${intended}, mais ne ${many ? 'listent' : 'liste'} que ce pays. Ailleurs au pays, aucun bandeau ne cible la région du visiteur : le SDK passe donc aux bandeaux qui listent seulement ce pays, et ${many ? 'ce sont eux qui gagnent' : 'c’est lui qui gagne'}.` +
          (competitor ? ` ${competitor} liste aussi ce pays, mais avec d’autres : il passe seulement après.` : ''),
        fix:
          regs.length > 0
            ? `${add}${competitor ? ` (par exemple, séparez ${competitor} en un bandeau par pays)` : ''}. Entre bandeaux qui listent seulement ce pays, le SDK préfère celui dont la réglementation correspond à la région du visiteur : le reste du pays reçoit ${created}, et ${keeps}.`
            : `${add} pour chaque langue ${many ? 'qu’ils utilisent' : 'qu’il utilise'}, au-dessus ${many ? 'd’eux' : 'de lui'} dans votre liste. Sans réglementation à préférer dans ce pays, le SDK départage selon la langue du visiteur, puis selon l’ordre de la liste, et ${keeps}.`,
      };
    }
    case 'regulation-mismatch': {
      const places = c.places(f.regions);
      const configs = c.configs(f.configs);
      const theirs = d.configRegulation ? c.regulation(d.configRegulation) : 'aucune réglementation';
      const one = f.regions.length === 1;
      const how = d.targeted
        ? `parce que ${f.configs.length > 1 ? 'ces bandeaux listent' : 'ce bandeau liste'} ${one ? 'cet endroit' : 'ces endroits'}`
        : `parce qu’aucun bandeau ne cible ${one ? 'cet endroit' : 'ces endroits'} : ${one ? 'il reçoit' : 'ils reçoivent'} le ${c.list((d.steps as string[]).map((s) => c.step(s as any).toLowerCase()))}`;
      const short = c.places(f.regions, 3);
      const banner: Record<string, string> = {
        'opt-out': 'un bandeau opt-out',
        none: 'un bandeau sans réglementation',
        unknown: 'un bandeau à la réglementation inconnue',
      };
      const manyConfigs = f.configs.length > 1;
      const built = d.configRegulation
        ? `${manyConfigs ? 'prévus' : 'prévu'} pour la réglementation ${theirs}`
        : `qui ${manyConfigs ? 'n’ont' : 'n’a'} aucune réglementation`;
      const law = `${(d.regulations as string[]).length > 1 ? 'des réglementations' : 'de la réglementation'} ${c.regulations(d.regulations)}`;
      // The title already names the places when they all fit in it.
      const lead = places === short ? (one ? 'Cet endroit relève' : 'Ces endroits relèvent') : `${places} : ${one ? 'cet endroit relève' : 'ces endroits relèvent'}`;
      return {
        title:
          f.severity === 'error'
            ? `${short} : ${banner[d.configKind] ?? banner['opt-out']} là où le consentement passe d’abord`
            : `${short} : ${d.configRegulation ? `un bandeau prévu pour la réglementation ${theirs}` : banner.none}`,
        mechanism: `${lead} ${law}, mais ${one ? 'reçoit' : 'reçoivent'} ${configs}, ${built}, ${how}.`,
        fix:
          f.severity === 'error'
            ? 'Ajoutez un bandeau avec la bonne réglementation qui liste ces endroits. Si vous préférez garder un seul bandeau pour le reste du monde, faites de votre fallback un bandeau opt-in.'
            : 'Correct si c’est voulu. Sinon, ajoutez des bandeaux avec la réglementation correspondante pour ces endroits.',
      };
    }
    case 'shadowed-listing': {
      const shadowed = c.configs(d.shadowed);
      const winners = c.configs(d.winners);
      const places = c.places(f.regions);
      const many = d.shadowed.length > 1;
      const reasons: Record<string, string> = {
        specificity: `${winners} ${d.winners.length > 1 ? 'gagnent' : 'gagne'} à une étape antérieure : un bandeau à pays unique passe avant ceux qui listent plusieurs pays.`,
        order: `${c.config(d.by)} a la même langue et vient avant dans votre liste.`,
        regulation: `${c.config(d.by)} correspond à la réglementation du visiteur à cet endroit.`,
        untargeted: `${winners} ${d.winners.length > 1 ? 'gagnent' : 'gagne'} à cet endroit.`,
        unknown: `${winners} ${d.winners.length > 1 ? 'gagnent' : 'gagne'} à cet endroit.`,
      };
      const oneWinner = d.winners.length === 1;
      return {
        title: `${places} : ${shadowed} ${many ? 'y sont listés' : 'y est listé'} sans jamais s’y afficher`,
        mechanism: reasons[d.reason] ?? reasons.unknown,
        fix: `Retirez ${f.regions.length > 1 ? 'ces endroits' : 'cet endroit'} de ${shadowed} pour garder la config lisible, ou modifiez ${winners} ${oneWinner ? 's’il ne doit' : 's’ils ne doivent'} pas gagner là.`,
      };
    }
    case 'order-tie':
      return {
        title: `${c.config(f.configs[1])} perd contre ${c.config(f.configs[0])} à ${f.regions.length} ${plural(f.regions.length, 'endroit', 'endroits')}`,
        mechanism: `Les deux sont en ${c.language(d.language)}. Quand ils sont à égalité (${c.places(f.regions)}), le SDK garde le premier de votre liste.`,
        fix: 'Séparez leurs pays, ou supprimez celui dont vous n’avez pas besoin.',
      };
    case 'regulation-capture':
      return {
        title: `${d.count} ${plural(d.count, 'pays que vous ne listez pas reçoit', 'pays que vous ne listez pas reçoivent')} ${c.configs(f.configs)}`,
        mechanism: `${d.count > 1 ? 'Ces pays relèvent' : 'Ce pays relève'} de la réglementation ${c.regulation(d.regulation)} dans la table d’Axeptio (${c.places(f.regions)}). Aucun bandeau ne ${d.count > 1 ? 'les' : 'le'} liste, alors le SDK choisit parmi vos bandeaux ${c.regulation(d.regulation)}, selon la langue du visiteur.`,
        fix: 'Normal si vous voulez un seul bandeau pour toute la réglementation. Listez ces pays dans un bandeau s’ils ont besoin du leur.',
      };
    case 'subdivision-format': {
      const suggestion = (d.suggestions as Array<string | null>).filter(Boolean)[0];
      return {
        title: `Le code de région ${c.list(d.values)} n’est pas au format PAYS-RÉGION`,
        mechanism: `Le SDK compare des régions écrites comme CA-QC (pays, tiret, région). ${c.list(d.values)} ne matche jamais, donc ${c.configs(f.configs)} ${f.configs.length > 1 ? 'matchent' : 'matche'} seulement par pays, ce qui couvre tout le pays.`,
        fix: suggestion ? `Utilisez plutôt ${suggestion}.` : 'Écrivez la région au format PAYS-RÉGION, par exemple CA-QC.',
      };
    }
    case 'unreachable-subdivision': {
      const list = d.unreachable as UnreachableTarget[];
      const values = c.list(list.map((u) => u.value));
      const many = list.length > 1;
      return {
        title: `${values} ne ${many ? 'correspondent' : 'correspond'} à aucun visiteur`,
        mechanism: `${c.configs(f.configs)} ${f.configs.length > 1 ? 'ciblent' : 'cible'} ${many ? 'ces régions' : 'cette région'}, mais Axeptio localise les visiteurs seulement par pays et par région de premier niveau : ${unreachableMoves(list, c)}. ${many ? 'Ces codes ne matchent' : 'Ce code ne matche'} jamais.`,
        fix: unreachableFix(list, c),
      };
    }
    case 'unknown-country': {
      const suggestion = (d.suggestions as Array<string | null>).filter(Boolean)[0];
      return {
        title: `Code de pays inconnu : ${c.list(d.values)}`,
        mechanism: `Axeptio compare des codes de pays ISO 3166-1. ${c.list(d.values)} ne correspond à aucun visiteur, donc ${c.config(f.configs[0])} ne couvre pas ce pays.`,
        fix: suggestion ? `Utilisez plutôt ${suggestion}.` : 'Utilisez le code ISO du pays.',
      };
    }
    case 'unknown-regulation':
      return {
        title: `Réglementation inconnue : « ${d.value} »`,
        mechanism: `Le SDK connaît seulement gpdr, uk_gdpr, fadp, ccpa, gpp, lgpd et loi25 (oui, le RGPD s’écrit gpdr). ${c.config(f.configs[0])} ne gagne jamais la préférence de réglementation.`,
        fix: d.suggestion ? `Mettez sa réglementation à ${d.suggestion}.` : 'Choisissez une des réglementations ci-dessus.',
      };
    case 'invalid-page-rule':
      return d.problem === 'malformed'
        ? {
            title: `Règle de page mal formée dans ${c.config(f.configs[0])}`,
            mechanism: 'Une de ses règles de pages est mal formée. Quand le SDK se rabat sur les règles de pages, il plante et peut n’afficher aucun bandeau.',
            fix: 'Supprimez la règle ou donnez-lui une URL, puis publiez.',
          }
        : {
            title: `Règle de page invalide : ${d.url}`,
            mechanism: 'Cette expression régulière est invalide. Quand le SDK se rabat sur les règles de pages, il plante et peut n’afficher aucun bandeau.',
            fix: 'Corrigez le motif, ou désactivez l’option regex de cette règle.',
          };
    case 'ab-test':
      return {
        title: `Le test A/B ${d.testId} est en cours`,
        mechanism: `Les visiteurs qui reçoivent un de ses bandeaux sont répartis entre ${c.configs(f.configs)}${d.endDate ? ` jusqu’au ${c.date(d.endDate)}` : ''}. La carte montre le bandeau avant cette répartition.`,
      };
    default:
      return { title: f.kind, mechanism: '' };
  }
}

export const fr: Messages = {
  locale: 'fr-CA',
  article: (name) => name,
  app: {
    title: 'Cookies Atlas',
    tagline: 'Quel bandeau Axeptio s’affiche dans chaque pays, et pourquoi.',
    sourceNote: 'Lit le fichier public du projet publié. Rien n’est conservé.',
    repo: 'Code source sur GitHub',
    sdkDate: (date) => `La logique de sélection reproduit le SDK d’Axeptio en date du ${date}.`,
  },
  input: {
    label: 'ID de projet Axeptio',
    placeholder: 'ID de projet, ex. 691245e5b48e4a03c7b9c5c5',
    submit: 'Voir la carte',
    invalid: 'Un ID de projet compte 24 caractères (0-9 et a-f), comme 691245e5b48e4a03c7b9c5c5.',
    recent: 'Projets récents',
    example: 'Essayer avec le site d’Axeptio',
    clearRecent: 'Effacer',
  },
  load: {
    loading: 'Chargement du projet publié…',
    notFound: 'Aucun projet publié avec cet ID. Vérifiez l’ID, et que le projet a été publié au moins une fois.',
    network: 'Impossible de joindre Axeptio. Vérifiez votre connexion et réessayez.',
    invalid: 'Ce fichier ne ressemble pas à un projet Axeptio.',
    empty: 'Ce projet n’a encore aucun bandeau publié.',
    retry: 'Réessayer',
  },
  theme: { label: 'Thème', light: 'Clair', dark: 'Sombre', system: 'Système' },
  uiLanguage: 'Langue',
  summary: {
    published: (date) => `Publié le ${date}`,
    geoOn: 'Location-based display activé',
    geoOff: 'Location-based display désactivé',
    fallback: (name) => `Fallback : ${name}`,
    noFallback: 'Aucun fallback',
    banners: (n) => `${n} ${plural(n, 'bandeau', 'bandeaux')}`,
    visibility: (n) => `Affiché dans ${n} pays seulement`,
    you: 'Vous',
    youGet: (place, banner) => `Votre position : ${place}. Vous recevez ${banner}`,
    youNoBanner: (place) => `Votre position : ${place}. Vous ne recevez aucun bandeau`,
    youUnknown: 'Axeptio n’a pas pu déterminer votre position',
    copyId: 'Copier l’ID du projet',
    copied: 'Copié',
    openAdmin: 'Ouvrir dans Axeptio',
  },
  geoOff: {
    title: 'Le location-based display est désactivé',
    body: (banner, hasPageRules) =>
      `Pour l’instant, la géographie ne compte pas : tous les visiteurs reçoivent ${banner}${hasPageRules ? ' (ou un bandeau limité à la page visitée)' : ''}, sauf si le site en fixe un autre avec cookiesVersion.`,
    preview: 'Aperçu avec le location-based display activé',
    today: 'Aujourd’hui',
    fix: 'Pour l’utiliser : Mes bandeaux → Location-based display, puis choisissez un bandeau de fallback.',
  },
  map: {
    title: 'Carte',
    language: 'Langue du visiteur',
    allLanguages: 'Toutes',
    otherLanguages: 'Autre',
    reset: 'Recentrer',
    zoomIn: 'Zoom avant',
    zoomOut: 'Zoom arrière',
    export: 'Exporter en PNG',
    exporting: 'Export…',
    copyLink: 'Copier le lien',
    linkCopied: 'Lien copié',
    ariaLabel: (project) => `Carte du monde du bandeau qu’Axeptio sert dans chaque pays pour ${project}. L’onglet Tableau donne la même information.`,
    previewBadge: 'Aperçu : location-based display activé',
    todayBadge: 'Aujourd’hui : location-based display désactivé',
    keyTitle: 'Comment lire la carte',
    keySolid: 'Un bandeau cible cet endroit',
    keyLight: 'Atteint indirectement (réglementation, fallback ou défaut)',
    keyStriped: 'Dépend de la langue du visiteur',
    keyNone: 'Aucun bandeau',
    keyYou: 'Vous êtes ici',
    clickHint: 'Cliquez pour simuler un visiteur ici',
    noRegulation: 'Aucune loi dans la table d’Axeptio',
    howLabel: 'Comment',
    abNote: (testId) => `Le test A/B ${testId} peut changer le bandeau`,
    youAreHere: 'Vous êtes ici',
    rest: (country) => `${country} (autres régions)`,
  },
  tabs: { banners: 'Bandeaux', simulator: 'Simulateur', diagnostics: 'Diagnostic', table: 'Tableau' },
  legend: {
    intro: 'Chaque couleur est un bandeau. Survolez pour voir où il s’affiche, cliquez pour l’isoler.',
    lists: (n) => `liste ${n} pays`,
    listsNothing: 'ne liste aucun pays',
    regionsTargeted: (n) => `${n} ${plural(n, 'région', 'régions')}`,
    wins: (countries, regions) => {
      const parts = [countries ? `${countries} pays` : '', regions ? `${regions} ${plural(regions, 'région', 'régions')}` : ''].filter(Boolean);
      return parts.length ? `affiché dans ${parts.join(' et ')}` : 'affiché nulle part';
    },
    notDefault: (hasPageRules) => `affiché seulement si le site le fixe avec cookiesVersion${hasPageRules ? ', ou sur les pages que ses règles matchent' : ''}`,
    neverShown: 'Jamais affiché',
    fallback: 'Fallback',
    abTest: 'Test A/B',
    otherBanners: (n) => `${n} ${plural(n, 'autre bandeau', 'autres bandeaux')}`,
    isolate: 'Isoler sur la carte',
    clearIsolation: 'Afficher tous les bandeaux',
    noBanner: 'Aucun bandeau',
    admin: 'Modifier dans Axeptio',
  },
  simulator: {
    intro: 'Choisissez un endroit et un visiteur. Les étapes du SDK s’affichent en dessous, dans l’ordre.',
    region: 'Position du visiteur',
    country: 'Pays',
    subregion: 'Région',
    anyRegion: 'Toute région',
    loadingRegions: 'Chargement des régions…',
    browserLanguage: 'Langue du navigateur',
    pageLanguage: 'Langue de la page (html lang)',
    logic: 'Langue utilisée pour le tie-break',
    logicBrowser: 'Langue du navigateur (par défaut)',
    logicHtml: 'Langue de la page (useDocumentLang)',
    logicHint: 'Un site peut déclarer useDocumentLang dans les additional axeptio settings pour départager selon la langue de la page plutôt que celle du navigateur.',
    siteSettings: 'Réglages du site',
    cookiesVersion: 'cookiesVersion fixé par le site',
    cookiesVersionHint: 'Utilisé seulement quand le location-based display ne trouve rien.',
    pagePath: 'Chemin de la page',
    pagePathHint: 'Pour les bandeaux limités à certaines pages. Par défaut : /.',
    result: 'Ce visiteur reçoit',
    resultNone: 'Aucun bandeau',
    resultHidden: 'Masqué par la visibilité du bandeau',
    viaFallback: 'par le fallback',
    why: 'Pourquoi',
    copyScenario: 'Copier le lien de ce scénario',
    pickRegion: 'Choisissez un pays, ou cliquez sur la carte.',
    unknownCountry: 'Position inconnue',
  },
  trace: {
    language: (source, raw, key) =>
      source === 'document'
        ? `Le tie-break utilise la langue de la page (useDocumentLang) : ${raw ? `« ${raw} »` : 'vide'}${key ? ` → ${key}` : ''}.`
        : `Le tie-break utilise la langue du navigateur : ${raw ? `« ${raw} »` : 'aucune'}${key ? ` → ${key}` : ''}.`,
    regulation: (place, regulation, c) =>
      regulation
        ? `Selon la table d’Axeptio, cet endroit (${place}) relève de la réglementation ${c.regulation(regulation)}.`
        : `Selon la table d’Axeptio, cet endroit (${place}) n’a aucune réglementation.`,
    visibility: (allowed, passed, c) =>
      passed
        ? `La visibilité du bandeau est activée (${c.places(allowed, 6)}) : ce visiteur est admis.`
        : allowed.length
          ? `La visibilité du bandeau est activée (${c.places(allowed, 6)}) : ce visiteur n’a aucun bandeau.`
          : 'La visibilité du bandeau est activée sans aucun pays : personne n’a de bandeau.',
    geolocation: (enabled, forced) =>
      enabled
        ? 'Le location-based display est activé.'
        : forced
          ? 'Le location-based display est désactivé, simulé comme activé.'
          : 'Le location-based display est désactivé : la position est ignorée.',
    candidates: (e, regulation, c) => {
      const labels = {
        subdivision: (n: number) =>
          n ? `${n} ${plural(n, 'bandeau cible', 'bandeaux ciblent')} la région ${e.key}` : `Aucun bandeau ne cible la région ${e.key ?? ''}`.trim(),
        'single-country': (n: number) =>
          n ? `${n} ${plural(n, 'bandeau à pays unique liste', 'bandeaux à pays unique listent')} ${e.key}` : `Aucun bandeau à pays unique ne liste ${e.key ?? 'ce pays'}`,
        'multi-country': (n: number) =>
          n ? `${n} ${plural(n, 'bandeau liste', 'bandeaux listent')} ${e.key} parmi d’autres pays` : `Aucun bandeau ne liste ${e.key ?? 'ce pays'}`,
        regulation: (n: number) =>
          n ? `${n} ${plural(n, 'bandeau utilise', 'bandeaux utilisent')} ${c.regulation(e.key)}` : `Aucun bandeau n’utilise ${c.regulation(e.key)}`,
      };
      let text = labels[e.step](e.matched.length);
      if (e.matched.length > 1 && e.step !== 'regulation') {
        if (e.regulationApplied) text += ` ; garde ${c.configs(e.preferred)} pour ${c.regulation(regulation)}`;
        else if (regulation) text += ` ; aucun n’utilise ${c.regulation(regulation)}, tous restent en lice`;
      }
      if (e.winner && e.tieBreak) {
        const lang = e.tieBreak.language ? c.language(e.tieBreak.language) : null;
        if (!e.tieBreak.byOrder) text += ` ; le tie-break de langue (${lang}) choisit ${c.config(e.winner)}`;
        else if (e.tieBreak.languageMatches.length > 1) text += ` ; plusieurs sont en ${lang}, le premier de la liste gagne : ${c.config(e.winner)}`;
        else text += ` ; aucun n’est en ${lang ?? 'langue du visiteur'}, le premier de la liste gagne : ${c.config(e.winner)}`;
      } else if (e.winner) {
        text += ` : ${c.config(e.winner)}`;
      }
      return text + '.';
    },
    stop: 'Aucune réglementation pour cet endroit : le match par position s’arrête ici.',
    fallback: (configId, found, c) =>
      found
        ? `Rien n’a matché : le bandeau de fallback ${c.config(configId)} est utilisé.`
        : configId
          ? `Rien n’a matché, et le fallback ${configId} n’existe pas.`
          : 'Rien n’a matché, et il n’y a pas de bandeau de fallback.',
    nonGeo: (e, c) => {
      if (e.strategy === 'cookiesVersion') return `Le site fixe cookiesVersion « ${e.cookiesVersion} » : ${c.config(e.winner)}.`;
      const pinned = e.cookiesVersion && !e.cookiesVersionMatched ? `cookiesVersion « ${e.cookiesVersion} » ne correspond à aucun bandeau. ` : '';
      if (e.strategy === 'page') return `${pinned}${c.config(e.winner)} a une règle de page qui matche ${e.pagePath}.`;
      if (e.strategy === 'default') {
        const excluded = e.excludedByPages.length ? ` (${c.configs(e.excludedByPages)} ${e.excludedByPages.length > 1 ? 'sont limités' : 'est limité'} à d’autres pages)` : '';
        return `${pinned}Premier bandeau de votre liste : ${c.config(e.winner)}${excluded}.`;
      }
      return `${pinned}Aucun bandeau disponible.`;
    },
    abTest: (testId, variants, c) => `Le test A/B ${testId} peut le remplacer par ${c.configs(variants)} (réparti par visiteur).`,
  },
  steps: {
    visibility: 'Masqué (visibilité du bandeau)',
    subdivision: 'Match par région',
    'single-country': 'Match pays unique',
    'multi-country': 'Match multi-pays',
    regulation: 'Match par réglementation',
    fallback: 'Bandeau de fallback',
    cookiesVersion: 'Fixé par cookiesVersion',
    page: 'Règle de page',
    default: 'Premier bandeau (défaut)',
    none: 'Aucun bandeau',
  },
  regulations: {
    gpdr: 'RGPD',
    uk_gdpr: 'RGPD UK',
    fadp: 'nLPD (Suisse)',
    ccpa: 'CCPA',
    gpp: 'lois des États américains (GPP)',
    lgpd: 'LGPD (Brésil)',
    loi25: 'Loi 25 (Québec)',
  },
  diagnostics: {
    intro: 'Ce que la carte révèle, du plus grave au moins grave. Chaque point explique comment le SDK décide et quoi changer.',
    previewNote: 'Le location-based display est désactivé : ces constats décrivent ce qui arriverait une fois activé.',
    none: 'Rien à signaler : chaque bandeau s’affiche là où il doit.',
    severity: { error: 'Problème', warning: 'À vérifier', info: 'Note' },
    why: 'Pourquoi :',
    fix: 'Correctif :',
    showOnMap: 'Voir sur la carte',
    finding,
  },
  table: {
    intro: 'Chaque endroit de la carte, avec le bandeau reçu selon la langue du visiteur.',
    filter: 'Filtrer les endroits ou les bandeaux',
    place: 'Endroit',
    regulation: 'Réglementation',
    how: 'Comment',
    banner: 'Bandeau selon la langue',
    none: 'Aucun',
    rows: (n) => `${n} ${plural(n, 'endroit', 'endroits')}`,
  },
  bookmarklet: {
    title: 'Favori',
    body: 'Glissez ce bouton dans votre barre de favoris. Sur n’importe quel site qui utilise Axeptio, cliquez dessus pour ouvrir sa carte.',
    linkLabel: 'Cookies Atlas',
    notFound: 'Cookies Atlas : aucun projet Axeptio trouvé sur cette page.',
  },
  empty: {
    title: 'Quel bandeau s’affiche dans chaque pays ?',
    body: 'Collez un ID de projet Axeptio pour voir, sur une carte, quel bandeau le SDK sert dans chaque pays et région, pourquoi, et ce qui semble mal configuré.',
    steps: [
      'L’ID du projet se trouve dans l’admin d’Axeptio (en bas à gauche), ou dans axeptioSettings.clientId sur le site.',
      'La carte suit les règles du SDK : région, puis bandeaux à pays unique, puis multi-pays, puis réglementation, puis fallback.',
      'Partagez le lien : il garde le projet, la langue et le visiteur simulé.',
    ],
  },
  footer: {
    disclaimer: 'Cookies Atlas rejoue les règles de sélection du SDK. Pour un cas critique, revérifiez depuis la vraie position.',
  },
};
