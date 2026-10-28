import type { Feature, Geometry } from 'geojson';
import { geoEqualEarth, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import type { Ref } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { colorOf, type ColorAssignment } from '../app/colors';
import type { CountryFile, CountryProps } from '../app/geo';
import type { ViewerLocation } from '../app/project';
import { outcomeForFeature, regionKey, winnersFor, type Evaluation, type RegionOutcome } from '../engine/evaluate';
import type { SelectionStep } from '../engine/select';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

export const MAP_WIDTH = 960;
export const MAP_HEIGHT = 470;

/** Steps where no banner targeted the place: drawn lighter. */
export const INDIRECT_STEPS: ReadonlySet<SelectionStep> = new Set(['regulation', 'fallback', 'default', 'page', 'cookiesVersion']);

interface MapItem {
  id: string;
  country: string;
  /** Key of the outcome used to color it ("FR", "CA-QC"). */
  outcomeKey: string;
  /** The feature's own key ("CA-ON"), for selection and highlights. */
  ownKey: string;
  parentKey: string | null;
  name: { en: string; fr: string };
  d: string;
  isSubdivision: boolean;
  /** A split country's own shape, drawn under its subdivisions only to catch the pointer in coastline slivers. */
  underlay: boolean;
  centroid: [number, number];
}

export interface HoverInfo {
  item: MapItem;
  outcome: RegionOutcome | undefined;
  x: number;
  y: number;
}

export interface MapViewProps {
  world: Array<Feature<Geometry, CountryProps>>;
  splits: CountryFile[];
  evaluation: Evaluation;
  colors: ColorAssignment;
  language: string | 'all';
  /** Banner to emphasize (hovered or isolated in the legend). */
  focus: string | null;
  /** Region keys to emphasize (from a finding). */
  highlight: string[] | null;
  selected: string | null;
  viewer: ViewerLocation | null;
  ariaLabel: string;
  onSelect: (key: string) => void;
  svgRef?: Ref<SVGSVGElement>;
}

const patternId = (winners: Array<string | null>) =>
  'hatch-' + winners.map((w) => (w ?? 'none').replace(/[^a-zA-Z0-9]/g, '')).join('-');

export function MapView(props: MapViewProps) {
  const { t, ui, c } = useI18n();
  const { world, splits, evaluation, colors, language, focus, highlight, selected, viewer } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const localSvgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const pinRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Geometry: computed once per map data.
  const { items, splitCountries } = useMemo(() => {
    const projection = geoEqualEarth().fitExtent(
      [
        [6, 6],
        [MAP_WIDTH - 6, MAP_HEIGHT - 6],
      ],
      { type: 'FeatureCollection', features: world },
    );
    const path = geoPath(projection);
    const out: MapItem[] = [];
    const splitCountries = new Set(splits.map((s) => s.country));
    for (const f of world) {
      const d = path(f);
      if (!d) continue;
      const cc = f.properties.id;
      out.push({
        id: `c-${cc}`,
        country: cc,
        outcomeKey: cc,
        ownKey: cc,
        parentKey: null,
        name: { en: f.properties.en, fr: f.properties.fr },
        d,
        isSubdivision: false,
        underlay: splitCountries.has(cc),
        centroid: path.centroid(f) as [number, number],
      });
    }
    for (const file of splits) {
      if (!splitCountries.has(file.country)) continue;
      file.features.forEach((f, i) => {
        const d = path(f);
        if (!d) return;
        const code = f.properties.code ?? null;
        const parent = f.properties.parent ?? null;
        out.push({
          id: `s-${file.country}-${code ?? i}-${i}`,
          country: file.country,
          outcomeKey: '', // resolved per evaluation below
          ownKey: code ? regionKey(file.country, code) : file.country,
          parentKey: parent ? regionKey(file.country, parent) : null,
          name: { en: f.properties.en, fr: f.properties.fr ?? f.properties.en },
          d,
          isSubdivision: true,
          underlay: false,
          centroid: path.centroid(f) as [number, number],
        });
      });
    }
    return { items: out, splitCountries };
  }, [world, splits]);

  // Outcome per item for the current evaluation.
  const resolved = useMemo(
    () =>
      items.map((item) => {
        if (!item.isSubdivision) return { item, outcome: evaluation.regions.get(item.country) };
        const [, code] = item.ownKey.split('-');
        const [, parent] = item.parentKey?.split('-') ?? [];
        return { item, outcome: outcomeForFeature(evaluation, item.country, code, parent) };
      }),
    [items, evaluation],
  );

  // Fills.
  const { fills, patterns } = useMemo(() => {
    const patterns = new Map<string, Array<string | null>>();
    const fills = resolved.map(({ outcome }) => {
      if (!outcome) return { fill: 'var(--no-data)', indirect: false, winners: [] as Array<string | null> };
      const winners = winnersFor(outcome, language);
      const indirect = INDIRECT_STEPS.has(outcome.step);
      if (winners.length === 1) return { fill: colorOf(colors, winners[0]), indirect, winners };
      const id = patternId(winners);
      patterns.set(id, winners);
      return { fill: `url(#${id})`, indirect, winners };
    });
    return { fills, patterns };
  }, [resolved, language, colors]);

  const highlightSet = useMemo(() => (highlight ? new Set(highlight) : null), [highlight]);
  const isDimmed = (index: number) => {
    const { item, outcome } = resolved[index];
    if (item.underlay) return false;
    if (focus) return !fills[index].winners.includes(focus);
    if (highlightSet) {
      return !(
        highlightSet.has(item.ownKey) ||
        (item.parentKey && highlightSet.has(item.parentKey)) ||
        (outcome && highlightSet.has(outcome.key))
      );
    }
    return false;
  };

  // Zoom & pan.
  useEffect(() => {
    const svg = localSvgRef.current;
    if (!svg) return;
    const behavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 14])
      .translateExtent([
        [0, 0],
        [MAP_WIDTH, MAP_HEIGHT],
      ])
      .on('zoom', (event) => {
        const tr = event.transform;
        gRef.current?.setAttribute('transform', tr.toString());
        if (pinRef.current) {
          const [x, y] = (pinRef.current.dataset.at ?? '0,0').split(',').map(Number);
          pinRef.current.setAttribute('transform', `translate(${tr.applyX(x)},${tr.applyY(y)})`);
        }
        setHover(null);
      });
    zoomRef.current = behavior;
    select(svg).call(behavior).on('dblclick.zoom', null);
    return () => {
      select(svg).on('.zoom', null);
    };
  }, []);

  const zoomBy = (factor: number) => {
    const svg = localSvgRef.current;
    if (svg && zoomRef.current) select(svg).transition().duration(250).call(zoomRef.current.scaleBy, factor);
  };
  const resetZoom = () => {
    const svg = localSvgRef.current;
    if (svg && zoomRef.current) select(svg).transition().duration(300).call(zoomRef.current.transform, zoomIdentity);
  };

  // Viewer pin position (subdivision if drawn, else country).
  const pin = useMemo(() => {
    if (!viewer?.country) return null;
    const sub = viewer.region
      ? items.find((i) => i.isSubdivision && (i.ownKey === `${viewer.country}-${viewer.region}` || i.parentKey === `${viewer.country}-${viewer.region}`))
      : undefined;
    const item = sub ?? items.find((i) => !i.isSubdivision && i.country === viewer.country);
    if (!item || !Number.isFinite(item.centroid[0])) return null;
    return item.centroid;
  }, [items, viewer]);

  // Keep the pin where it belongs when it changes after a zoom (before paint, so it never jumps).
  useLayoutEffect(() => {
    const svg = localSvgRef.current;
    if (!svg || !pinRef.current || !pin) return;
    const tr = (svg as unknown as { __zoom?: typeof zoomIdentity }).__zoom ?? zoomIdentity;
    pinRef.current.setAttribute('transform', `translate(${tr.applyX(pin[0])},${tr.applyY(pin[1])})`);
  }, [pin]);

  const selectedItems = useMemo(() => {
    if (!selected) return [];
    const isSub = selected.includes('-');
    return items.filter((i) =>
      isSub ? i.ownKey === selected || i.parentKey === selected : i.country === selected && !i.isSubdivision,
    );
  }, [items, selected]);

  const onPointerMove = (event: PointerEvent) => {
    const target = event.target as Element | null;
    const index = target?.getAttribute?.('data-index');
    const box = containerRef.current?.getBoundingClientRect();
    if (index == null || !box) {
      if (hover) setHover(null);
      return;
    }
    const { item, outcome } = resolved[Number(index)];
    setHover({ item, outcome, x: event.clientX - box.left, y: event.clientY - box.top });
  };

  const onClick = (event: MouseEvent) => {
    const index = (event.target as Element | null)?.getAttribute?.('data-index');
    if (index == null) return;
    const { item } = resolved[Number(index)];
    // Visitors are located by first-level region: a department simulates a visitor in its region.
    props.onSelect(item.isSubdivision ? (item.parentKey ?? item.ownKey) : item.country);
  };

  const paths = useMemo(
    () =>
      resolved.map(({ item }, index) => (
        <path
          key={item.id}
          data-index={index}
          data-key={item.ownKey}
          d={item.d}
          class={`region${item.isSubdivision ? ' sub' : ''}${item.underlay ? ' underlay' : ''}${fills[index].indirect ? ' indirect' : ''}${isDimmed(index) ? ' dimmed' : ''}`}
          style={item.underlay ? undefined : { fill: fills[index].fill }}
        />
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved, fills, focus, highlightSet],
  );

  const hoverName = hover ? (ui === 'fr' ? hover.item.name.fr : hover.item.name.en) : '';
  const viewerKey = viewer?.country ? (viewer.region ? `${viewer.country}-${viewer.region}` : viewer.country) : null;
  const isViewerItem = (item: MapItem) =>
    Boolean(viewerKey) &&
    (item.ownKey === viewerKey ||
      item.parentKey === viewerKey ||
      (!item.isSubdivision && item.country === viewer?.country && !splitCountries.has(item.country)));

  return (
    <div class="map" ref={containerRef}>
      <svg
        ref={(el) => {
          localSvgRef.current = el;
          if (typeof props.svgRef === 'function') props.svgRef(el);
          else if (props.svgRef) (props.svgRef as { current: SVGSVGElement | null }).current = el;
        }}
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        role="img"
        aria-label={props.ariaLabel}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
      >
        <defs>
          {[...patterns.entries()].map(([id, winners]) => (
            <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={winners.length * 3} height={winners.length * 3} patternTransform="rotate(45)">
              {winners.map((w, i) => (
                <rect key={i} x={i * 3} y={0} width={3} height={winners.length * 3} style={{ fill: colorOf(colors, w) }} />
              ))}
            </pattern>
          ))}
        </defs>
        <rect class="ocean" x={0} y={0} width={MAP_WIDTH} height={MAP_HEIGHT} />
        <g ref={gRef}>
          <g class="regions">{paths}</g>
          <g class="selection" aria-hidden="true">
            {selectedItems.map((i) => (
              <path key={i.id} d={i.d} class="selected" />
            ))}
            {hover && <path d={hover.item.d} class="hovered" />}
          </g>
        </g>
        {pin && (
          <g ref={pinRef} class="pin" data-at={`${pin[0]},${pin[1]}`} transform={`translate(${pin[0]},${pin[1]})`} aria-hidden="true">
            <circle r={9} class="pin-halo" />
            <circle r={4.5} class="pin-dot" />
          </g>
        )}
      </svg>

      <div class="map-zoom" role="group" aria-label={t.map.title}>
        <button type="button" class="icon-button" onClick={() => zoomBy(1.6)} title={t.map.zoomIn} aria-label={t.map.zoomIn}>
          <Icon name="plus" />
        </button>
        <button type="button" class="icon-button" onClick={() => zoomBy(1 / 1.6)} title={t.map.zoomOut} aria-label={t.map.zoomOut}>
          <Icon name="minus" />
        </button>
        <button type="button" class="icon-button" onClick={resetZoom} title={t.map.reset} aria-label={t.map.reset}>
          <Icon name="reset" />
        </button>
      </div>

      {hover && (
        <MapTooltip
          x={hover.x}
          y={hover.y}
          width={containerRef.current?.clientWidth ?? 0}
          name={hover.item.isSubdivision ? `${hoverName}, ${c.country(hover.item.country)}` : hoverName}
          outcome={hover.outcome}
          evaluation={evaluation}
          colors={colors}
          language={language}
          isViewer={isViewerItem(hover.item)}
        />
      )}
    </div>
  );
}

function MapTooltip(props: {
  x: number;
  y: number;
  width: number;
  name: string;
  outcome: RegionOutcome | undefined;
  evaluation: Evaluation;
  colors: ColorAssignment;
  language: string | 'all';
  isViewer: boolean;
}) {
  const { t, c } = useI18n();
  const { outcome } = props;
  // Group languages by winner: "fr → EU FR", "en, other → EU EN".
  const rows: Array<{ winner: string | null; languages: string[] }> = [];
  if (outcome) {
    const langs = props.language === 'all' ? props.evaluation.languages : [props.language];
    for (const lang of langs) {
      const [winner] = winnersFor(outcome, lang);
      const row = rows.find((r) => r.winner === winner);
      if (row) row.languages.push(lang);
      else rows.push({ winner, languages: [lang] });
    }
  }
  const left = Math.min(props.x + 14, Math.max(8, props.width - 280));
  return (
    <div class="map-tooltip" style={{ left: `${left}px`, top: `${props.y + 14}px` }} role="tooltip">
      <div class="tt-title">{props.name}</div>
      <div class="tt-meta">
        {outcome?.regulation ? c.regulation(outcome.regulation) : t.map.noRegulation}
        {outcome && <> · {t.steps[outcome.step]}</>}
      </div>
      <ul class="tt-rows">
        {rows.map((r) => (
          <li key={r.winner ?? 'none'}>
            <span class="line-key" style={{ background: colorOf(props.colors, r.winner) }} />
            <strong>{c.config(r.winner)}</strong>
            {props.language === 'all' && rows.length > 1 && <span class="tt-langs">{r.languages.map((l) => c.language(l)).join(', ')}</span>}
          </li>
        ))}
      </ul>
      {outcome?.abTests.map((ab) => (
        <div class="tt-note" key={ab.testId}>
          {t.map.abNote(ab.testId)}
        </div>
      ))}
      {props.isViewer && <div class="tt-note">{t.map.youAreHere}</div>}
      <div class="tt-hint">{t.map.clickHint}</div>
    </div>
  );
}
