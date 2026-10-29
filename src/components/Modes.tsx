import { useEffect, useRef, useState } from 'preact/hooks';
import { modesOf } from '../engine/modes';
import type { AxeptioConfig } from '../engine/types';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

/** Icon and color of each mode: an eye (shown) or a crossed eye (hidden); a check (opt-in) or an X (opt-out). */
export const displayGlyph = (shown: boolean) => (shown ? { icon: 'eye', tone: 'shown' } : { icon: 'eye-off', tone: 'hidden' });
export const consentGlyph = (optOut: boolean) => (optOut ? { icon: 'close', tone: 'opt-out' } : { icon: 'check', tone: 'opt-in' });

/** One mode icon, without a tooltip. */
export function Glyph({ icon, tone, size = 14 }: { icon: string; tone: string; size?: number }) {
  return (
    <span class={`mode mode-static mode-${tone}`} aria-hidden="true">
      <Icon name={icon} size={size} />
    </span>
  );
}

/** Two icons: whether the banner opens by itself (displayMode) and whether it's opt-in or opt-out (consentMode). */
export function BannerModes({ config }: { config: AxeptioConfig }) {
  const { t } = useI18n();
  const m = modesOf(config);
  const notSet = (value: string | null) => (value === null ? ` ${t.modes.notSet}` : '');
  return (
    <span class="modes">
      <ModeHint
        {...displayGlyph(m.shown)}
        label={m.shown ? t.modes.shown : t.modes.hidden}
        text={(m.shown ? t.modes.shownText : t.modes.hiddenText(m.optOut)) + notSet(m.displayMode)}
        field={t.modes.field('displayMode', m.displayMode, 'show')}
      />
      <ModeHint
        {...consentGlyph(m.optOut)}
        label={m.optOut ? t.modes.optOut : t.modes.optIn}
        text={(m.optOut ? t.modes.optOutText : t.modes.optInText) + notSet(m.consentMode)}
        field={t.modes.field('consentMode', m.consentMode, 'opt_in')}
      />
    </span>
  );
}

/**
 * The same two icons without tooltips, for places that can't host one: the map's hover tooltip,
 * buttons, table cells. The map key explains them.
 */
export function ModeIcons({ config, size = 14 }: { config: AxeptioConfig; size?: number }) {
  const { t } = useI18n();
  const m = modesOf(config);
  const label = `${m.shown ? t.modes.shown : t.modes.hidden}, ${m.optOut ? t.modes.optOut : t.modes.optIn}`;
  return (
    <span class="modes modes-static" role="img" aria-label={label} title={label}>
      <Glyph {...displayGlyph(m.shown)} size={size} />
      <Glyph {...consentGlyph(m.optOut)} size={size} />
    </span>
  );
}

interface Position {
  right: number;
  top?: number;
  bottom?: number;
}

/**
 * An icon with a tooltip on hover and keyboard focus. The tooltip is fixed-positioned so the
 * panel's scrolling can't clip it; it opens below the icon, or above near the bottom of the window.
 */
function ModeHint(props: { icon: string; tone: string; label: string; text: string; field: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const right = Math.max(8, window.innerWidth - r.right - 4);
    setPos(r.bottom + 190 < window.innerHeight ? { right, top: r.bottom + 6 } : { right, bottom: window.innerHeight - r.top + 6 });
  };
  const close = () => setPos(null);

  // A scroll moves the icon away from its fixed tooltip: close it.
  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [pos]);

  return (
    <span
      ref={ref}
      class={`mode mode-${props.tone}`}
      tabIndex={0}
      role="img"
      aria-label={`${props.label}. ${props.text}`}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <Icon name={props.icon} size={16} />
      {pos && (
        <span
          class="mode-tooltip"
          role="tooltip"
          style={{ right: `${pos.right}px`, ...(pos.top !== undefined ? { top: `${pos.top}px` } : { bottom: `${pos.bottom}px` }) }}
        >
          <strong>{props.label}</strong>
          <span>{props.text}</span>
          <code>{props.field}</code>
        </span>
      )}
    </span>
  );
}
