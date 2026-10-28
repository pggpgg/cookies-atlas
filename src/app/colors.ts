/**
 * Banner colors. Categorical slots come from the validated data-viz palette (fixed order,
 * never cycled): each banner keeps its slot whatever the filters, in project order.
 * Past 8 banners shown on the map, the 8th slot becomes a neutral "other banners" swatch
 * and the legend's isolate gives each one back its identity.
 */
import type { Evaluation } from '../engine/evaluate';
import type { AxeptioProject } from '../engine/types';

export const SLOT_COUNT = 8;

/** CSS variable holding a slot's color (defined per theme in styles.css). */
export const slotVar = (slot: number | 'other') => (slot === 'other' ? 'var(--series-other)' : `var(--series-${slot + 1})`);

export interface ColorAssignment {
  slotOf: Map<string, number | 'other'>;
  /** Banners sharing the neutral "other" swatch. */
  others: string[];
}

/** Assigns slots to banners that win somewhere in any of the given evaluations, in project order. */
export function assignColors(project: AxeptioProject, evaluations: Evaluation[]): ColorAssignment {
  const shown = (project.cookies ?? [])
    .map((c) => c.identifier)
    .filter((id) => evaluations.some((e) => (e.wins.get(id)?.size ?? 0) > 0));
  const slotOf = new Map<string, number | 'other'>();
  const others: string[] = [];
  const direct = shown.length > SLOT_COUNT ? SLOT_COUNT - 1 : SLOT_COUNT;
  shown.forEach((id, i) => {
    if (i < direct) slotOf.set(id, i);
    else {
      slotOf.set(id, 'other');
      others.push(id);
    }
  });
  return { slotOf, others };
}

export const colorOf = (assignment: ColorAssignment, id: string | null | undefined): string =>
  id ? slotVar(assignment.slotOf.get(id) ?? 'other') : 'var(--no-banner)';
