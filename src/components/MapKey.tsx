import { useState } from 'preact/hooks';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { consentGlyph, displayGlyph, Glyph } from './Modes';

const OPEN_KEY = 'cookies-atlas:map-key-open';

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * How to read the map: the fills, the visitor pin and the banner mode icons. It sits above the
 * panel, so it stays visible on every tab; it can be folded away, and remembers that per browser.
 */
export function MapKey() {
  const { t } = useI18n();
  const [open, setOpen] = useState(readOpen);

  const onToggle = (event: Event) => {
    const next = (event.currentTarget as HTMLDetailsElement).open;
    if (next === open) return;
    setOpen(next);
    try {
      if (next) window.localStorage.removeItem(OPEN_KEY);
      else window.localStorage.setItem(OPEN_KEY, '0');
    } catch {
      /* optional */
    }
  };

  return (
    <details class="map-key" open={open} onToggle={onToggle}>
      <summary>
        <h2>{t.map.keyTitle}</h2>
        <span class="map-key-chevron">
          <Icon name="chevron" size={16} />
        </span>
      </summary>
      {/* Ordered so the short items share lines. */}
      <ul class="key-items">
        <li>
          <span class="key-swatch key-solid" />
          {t.map.keySolid}
        </li>
        <li>
          <span class="key-swatch key-none" />
          {t.map.keyNone}
        </li>
        <li>
          <span class="key-swatch key-light" />
          {t.map.keyLight}
        </li>
        <li>
          <span class="key-swatch key-striped" />
          {t.map.keyStriped}
        </li>
        <li>
          <span class="key-pin" />
          {t.map.keyYou}
        </li>
      </ul>
      <ul class="key-items key-modes">
        <li>
          <Glyph {...displayGlyph(true)} size={15} />
          {t.modes.shown}
        </li>
        <li>
          <Glyph {...displayGlyph(false)} size={15} />
          {t.modes.hidden}
        </li>
        <li>
          <Glyph {...consentGlyph(false)} size={15} />
          {t.modes.optIn}
        </li>
        <li>
          <Glyph {...consentGlyph(true)} size={15} />
          {t.modes.optOut}
        </li>
      </ul>
    </details>
  );
}
