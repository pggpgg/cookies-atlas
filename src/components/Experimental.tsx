/** "Use experimental build": what the ENG-14524 decision tree changes compared with today's SDK. */
import { useState } from 'preact/hooks';
import { colorOf, type ColorAssignment } from '../app/colors';
import type { ChangeGroup } from '../engine/evaluate';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

const VISIBLE = 8;

export const changeId = (g: ChangeGroup) => `${g.before}|${g.after}`;

export function ExperimentalChanges(props: {
  groups: ChangeGroup[];
  colors: ColorAssignment;
  /** Highlighted group id, "all", or null. */
  highlighted: string | null;
  onHighlight: (id: string | null, regions: string[] | null) => void;
}) {
  const { t, c } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const places = new Set(props.groups.flatMap((g) => g.regions)).size;
  const shown = expanded ? props.groups : props.groups.slice(0, VISIBLE);
  const allRegions = [...new Set(props.groups.flatMap((g) => g.regions))];

  return (
    <section class="experimental-strip" role="status">
      <div class="experimental-head">
        <h2>
          <Icon name="info" size={18} /> {t.experimental.title}
        </h2>
        <p>{t.experimental.body(places)}</p>
        <p class="muted">{t.experimental.rules}</p>
      </div>
      {props.groups.length > 0 && (
        <>
          <ul class="change-list">
            {shown.map((g) => {
              const id = changeId(g);
              const active = props.highlighted === id;
              return (
                <li key={id} class={active ? 'active' : undefined}>
                  <span class="change-pair">
                    <span class="swatch" style={{ background: colorOf(props.colors, g.before) }} />
                    <span>{c.config(g.before)}</span>
                    <span class="change-arrow" aria-label="→">
                      →
                    </span>
                    <span class="swatch" style={{ background: colorOf(props.colors, g.after) }} />
                    <strong>{c.config(g.after)}</strong>
                  </span>
                  <span class="change-places">{c.places(g.regions, 6)}</span>
                  <span class="change-languages muted">{t.experimental.languages(c.list(g.languages.map((l) => c.language(l))))}</span>
                  <button type="button" class="text-button small" onClick={() => props.onHighlight(active ? null : id, active ? null : g.regions)}>
                    {active ? t.experimental.clear : t.experimental.showOnMap}
                  </button>
                </li>
              );
            })}
          </ul>
          <div class="change-actions">
            {props.groups.length > VISIBLE && (
              <button type="button" class="text-button small" onClick={() => setExpanded((v) => !v)}>
                {expanded ? '−' : `+${props.groups.length - VISIBLE}`}
              </button>
            )}
            <button
              type="button"
              class="button button-ghost"
              onClick={() => props.onHighlight(props.highlighted === 'all' ? null : 'all', props.highlighted === 'all' ? null : allRegions)}
            >
              <Icon name={props.highlighted === 'all' ? 'eye-off' : 'eye'} size={16} />{' '}
              {props.highlighted === 'all' ? t.experimental.clear : t.experimental.showAll}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
