// Display-only grouping of a list's items into open and finished sections. The
// shared after_id chain stays the single source of order: each section shows
// its items in chain order, and a drop inside a section maps back to a chain
// position that keeps that order.

/** Where finished (done, cancelled, skipped) items appear in a list. */
export type FinishedDisplay = "mixed" | "end" | "hidden";

export const FINISHED_DISPLAYS: readonly FinishedDisplay[] = ["mixed", "end", "hidden"];

/**
 * Arrange chain-ordered items for display. "end" moves finished items after
 * the open ones and "hidden" drops them. Both keep chain order within each
 * section.
 */
export function sectionedOrder<T>(ordered: T[], isOpen: (t: T) => boolean, mode: FinishedDisplay): T[] {
  if (mode === "mixed") return ordered;
  const open = ordered.filter(isOpen);
  if (mode === "hidden") return open;
  return open.concat(ordered.filter((t) => !isOpen(t)));
}

/**
 * Index in `display` after which to show the inline-add row whose chain
 * predecessor is `afterId`: just after the nearest open, displayed item at or
 * before `afterId` in `chain`. Returns -1 for the top.
 */
export function dummyDisplayIndex<T extends { id: string }>(
  chain: T[],
  display: T[],
  isOpen: (t: T) => boolean,
  afterId: string | null,
): number {
  if (afterId === null) return -1;
  const displayIdx = new Map(display.map((t, i) => [t.id, i]));
  let i = chain.findIndex((t) => t.id === afterId);
  if (i === -1) return display.length - 1;
  for (; i >= 0; i--) {
    const idx = displayIdx.get(chain[i].id);
    if (idx !== undefined && isOpen(chain[i])) return idx;
  }
  return -1;
}

/**
 * Map a drop in a sectioned display to the moved item's new after_id.
 *
 * `display` is the order shown before the drop and may contain `moved`.
 * `predId` is the id shown just before the drop point, or null for the top.
 * The moved item stays in its own section: it follows the nearest item of that
 * section shown before the drop point, or else goes just before the first one.
 * A virtual item (the inline-add row) stands in for its after_id.
 */
export function sectionedDropAfterId<T extends { id: string; after_id: string | null }>(
  display: T[],
  isOpen: (t: T) => boolean,
  moved: T,
  predId: string | null,
  isVirtual: (t: T) => boolean = () => false,
): string | null {
  const rest = display.filter((t) => t.id !== moved.id);
  const dropIdx = predId === null ? 0 : rest.findIndex((t) => t.id === predId) + 1;
  const section = isOpen(moved);
  const same = (t: T) => isOpen(t) === section;

  let result: string | null;
  const anchor = rest.slice(0, dropIdx).findLast(same);
  if (anchor) {
    result = isVirtual(anchor) ? anchor.after_id : anchor.id;
  } else {
    const first = rest.find(same);
    if (!first) {
      // Alone in its section: stay put, or follow the drop point when arriving from another list.
      if (rest.length < display.length) return moved.after_id;
      const pred = rest[dropIdx - 1];
      return pred === undefined ? null : isVirtual(pred) ? pred.after_id : pred.id;
    }
    result = first.after_id;
  }
  return result === moved.id ? moved.after_id : result;
}
