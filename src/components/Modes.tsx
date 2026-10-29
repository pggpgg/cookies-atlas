import { useEffect, useRef, useState } from 'preact/hooks';
import { modesOf } from '../engine/modes';
import type { AxeptioConfig } from '../engine/types';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

/** Two icons: whether the banner opens by itself (displayMode) and whether it's opt-in or opt-out (consentMode). */
export function BannerModes({ config }: { config: AxeptioConfig }) {
  const { t } = useI18n();
  const m = modesOf(config);
  const notSet = (value: string | null) => (value === null ? ` ${t.modes.notSet}` : '');
  return (
    <span class="modes">
      <ModeHint
        icon={m.shown ? 'eye' : 'eye-off'}
        tone={m.shown ? 'shown' : 'hidden'}
        label={m.shown ? t.modes.shown : t.modes.hidden}
        text={(m.shown ? t.modes.shownText : t.modes.hiddenText(m.optOut)) + notSet(m.displayMode)}
        field={t.modes.field('displayMode', m.displayMode, 'show')}
      />
      <ModeHint
        icon={m.optOut ? 'close' : 'check'}
        tone={m.optOut ? 'opt-out' : 'opt-in'}
        label={m.optOut ? t.modes.optOut : t.modes.optIn}
        text={(m.optOut ? t.modes.optOutText : t.modes.optInText) + notSet(m.consentMode)}
        field={t.modes.field('consentMode', m.consentMode, 'opt_in')}
      />
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
