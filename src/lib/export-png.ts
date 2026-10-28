/**
 * Exports the current map (whole world, current colors) with a title, legend and footer as a PNG.
 * Colors are resolved from the live SVG, and fonts are embedded so the image matches the app.
 */
import figtree600 from '@fontsource/figtree/files/figtree-latin-600-normal.woff2?url';
import sans400 from '@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff2?url';
import sans600 from '@fontsource/source-sans-3/files/source-sans-3-latin-600-normal.woff2?url';

export interface ExportLegendItem {
  /** CSS color or "pattern" for a hatched swatch. */
  color: string;
  label: string;
  detail?: string;
}

export interface ExportOptions {
  svg: SVGSVGElement;
  title: string;
  subtitle: string;
  legend: ExportLegendItem[];
  keyItems: ExportLegendItem[];
  footer: string;
  fileName: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 1600;
const PAD = 48;

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function fontCss(): Promise<string> {
  const [f600, s400, s600] = await Promise.all([toDataUrl(figtree600), toDataUrl(sans400), toDataUrl(sans600)]);
  const face = (family: string, weight: number, src: string | null) =>
    src ? `@font-face{font-family:'${family}';font-weight:${weight};src:url(${src}) format('woff2');}` : '';
  return face('Figtree', 600, f600) + face('Source Sans 3', 400, s400) + face('Source Sans 3', 600, s600);
}

const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'opacity'] as const;

/** Copies computed paint from the live map onto the clone (CSS variables and classes don't travel). */
function inlinePaint(live: Element, clone: Element) {
  const liveAll = [live, ...live.querySelectorAll('*')];
  const cloneAll = [clone, ...clone.querySelectorAll('*')];
  liveAll.forEach((el, i) => {
    const target = cloneAll[i] as SVGElement | undefined;
    if (!target || !(el instanceof SVGElement)) return;
    const cs = getComputedStyle(el);
    for (const prop of STYLE_PROPS) {
      const value = cs.getPropertyValue(prop);
      if (value) target.style.setProperty(prop, value);
    }
  });
}

function text(x: number, y: number, content: string, size: number, weight: number, color: string, family = 'Source Sans 3') {
  const el = document.createElementNS(SVG_NS, 'text');
  el.setAttribute('x', String(x));
  el.setAttribute('y', String(y));
  el.setAttribute('font-family', `'${family}', system-ui, sans-serif`);
  el.setAttribute('font-size', String(size));
  el.setAttribute('font-weight', String(weight));
  el.setAttribute('fill', color);
  el.textContent = content;
  return el;
}

export async function exportMapPng(options: ExportOptions): Promise<void> {
  const live = options.svg;
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--text-primary').trim() || '#262625';
  const muted = css.getPropertyValue('--text-secondary').trim() || '#52514e';
  const surface = css.getPropertyValue('--surface-1').trim() || '#ffffff';

  // Clone the map, resolve its paint, reset zoom, drop the hover outline and the viewer's pin.
  const mapClone = live.cloneNode(true) as SVGSVGElement;
  inlinePaint(live, mapClone);
  mapClone.querySelectorAll('.hovered, .pin').forEach((n) => n.remove());
  [...mapClone.children].forEach((child) => {
    if (child.tagName.toLowerCase() === 'g') child.removeAttribute('transform');
  });
  const viewBox = live.viewBox.baseVal;
  const mapHeight = Math.round((WIDTH - PAD * 2) * (viewBox.height / viewBox.width));

  // Layout: title, map, legend (3 columns), key, footer.
  const columns = 3;
  const rowHeight = 30;
  const legendRows = Math.ceil(options.legend.length / columns);
  const keyRows = Math.ceil(options.keyItems.length / columns);
  const top = 120;
  const legendTop = top + mapHeight + 40;
  const keyTop = legendTop + legendRows * rowHeight + 24;
  const height = keyTop + keyRows * rowHeight + 70;

  const out = document.createElementNS(SVG_NS, 'svg');
  out.setAttribute('xmlns', SVG_NS);
  out.setAttribute('width', String(WIDTH));
  out.setAttribute('height', String(height));
  out.setAttribute('viewBox', `0 0 ${WIDTH} ${height}`);

  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = await fontCss();
  out.appendChild(style);

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(WIDTH));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', surface);
  out.appendChild(bg);

  out.appendChild(text(PAD, 64, options.title, 34, 600, ink, 'Figtree'));
  out.appendChild(text(PAD, 98, options.subtitle, 20, 400, muted));

  const nested = document.createElementNS(SVG_NS, 'svg');
  nested.setAttribute('x', String(PAD));
  nested.setAttribute('y', String(top));
  nested.setAttribute('width', String(WIDTH - PAD * 2));
  nested.setAttribute('height', String(mapHeight));
  nested.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
  [...mapClone.childNodes].forEach((n) => nested.appendChild(n));
  out.appendChild(nested);

  const colWidth = (WIDTH - PAD * 2) / columns;
  const drawItems = (items: ExportLegendItem[], y0: number) => {
    items.forEach((item, i) => {
      const x = PAD + (i % columns) * colWidth;
      const y = y0 + Math.floor(i / columns) * rowHeight;
      const sw = document.createElementNS(SVG_NS, 'rect');
      sw.setAttribute('x', String(x));
      sw.setAttribute('y', String(y - 15));
      sw.setAttribute('width', '18');
      sw.setAttribute('height', '18');
      sw.setAttribute('rx', '4');
      sw.setAttribute('fill', item.color);
      out.appendChild(sw);
      const label = item.detail ? `${item.label} · ${item.detail}` : item.label;
      out.appendChild(text(x + 28, y, label.length > 52 ? label.slice(0, 51) + '…' : label, 17, 400, ink));
    });
  };
  drawItems(options.legend, legendTop);
  drawItems(options.keyItems, keyTop);

  out.appendChild(text(PAD, height - 28, options.footer, 15, 400, muted));

  const serialized = new XMLSerializer().serializeToString(out);
  const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The map image could not be rendered.'));
      image.src = url;
    });
    const scale = 1.5;
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0, WIDTH, height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('PNG encoding failed');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(png);
    link.download = options.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
