import { describe, it, expect } from "vitest";
import { dummyDisplayIndex, sectionedDropAfterId, sectionedOrder } from "./sections.js";
import { reorderByAfterId, resolveChain } from "./operations.js";

type T = { id: string; after_id: string | null };

// Items named with a leading "x" are finished; the rest are open.
const isOpen = (t: { id: string }) => !t.id.startsWith("x");

function chain(ids: string[]): T[] {
  return ids.map((id, i) => ({ id, after_id: i === 0 ? null : ids[i - 1] }));
}

// Drop `movedId` after display entry `predId`, apply to the chain, and return the new sectioned display.
function dropAndShow(ids: string[], movedId: string, predId: string | null): string[] {
  const items = chain(ids);
  const display = sectionedOrder(items, isOpen, "end");
  const moved = items.find((t) => t.id === movedId)!;
  const newAfterId = sectionedDropAfterId(display, isOpen, moved, predId);
  const updates = reorderByAfterId(items, movedId, newAfterId);
  const m = new Map(updates.map((u) => [u.id, u.after_id]));
  const next = resolveChain(items.map((t) => ({ ...t, after_id: m.has(t.id) ? m.get(t.id)! : t.after_id })));
  return sectionedOrder(next, isOpen, "end").map((t) => t.id);
}

describe("sectionedOrder", () => {
  const items = chain(["a", "x1", "b", "x2", "c"]);
  it("keeps chain order when mixed", () => {
    expect(sectionedOrder(items, isOpen, "mixed").map((t) => t.id)).toEqual(["a", "x1", "b", "x2", "c"]);
  });
  it("moves finished items to the end in chain order", () => {
    expect(sectionedOrder(items, isOpen, "end").map((t) => t.id)).toEqual(["a", "b", "c", "x1", "x2"]);
  });
  it("hides finished items", () => {
    expect(sectionedOrder(items, isOpen, "hidden").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("sectionedDropAfterId", () => {
  const ids = ["x0", "a", "x1", "b", "x2", "x3", "c", "x4"];

  it("lands every in-section drop exactly where it was dropped", () => {
    const display = sectionedOrder(chain(ids), isOpen, "end").map((t) => t.id);
    for (const moved of ids) {
      const rest = display.filter((id) => id !== moved);
      const lo = rest.findIndex((id) => isOpen({ id }) === isOpen({ id: moved }));
      const count = rest.filter((id) => isOpen({ id }) === isOpen({ id: moved })).length;
      for (let pos = lo; pos <= lo + count; pos++) {
        const predId = pos === 0 ? null : rest[pos - 1];
        const expected = rest.toSpliced(pos, 0, moved);
        expect(dropAndShow(ids, moved, predId), `${moved} after ${predId}`).toEqual(expected);
      }
    }
  });

  it("clamps a drop into the other section to the nearest edge of its own", () => {
    // Open item dropped among finished items goes to the end of the open section.
    expect(dropAndShow(ids, "a", "x2")).toEqual(["b", "c", "a", "x0", "x1", "x2", "x3", "x4"]);
    // Finished item dropped at the very top goes to the start of the finished section.
    expect(dropAndShow(ids, "x3", null)).toEqual(["a", "b", "c", "x3", "x0", "x1", "x2", "x4"]);
  });

  it("places a finished item at the head of its section just before the first one", () => {
    const items = chain(["a", "x1", "b", "x2"]);
    const display = sectionedOrder(items, isOpen, "end");
    const x2 = items.find((t) => t.id === "x2")!;
    expect(sectionedDropAfterId(display, isOpen, x2, "b")).toBe("a");
  });

  it("returns the current after_id when the item is alone in its section", () => {
    const items = chain(["a", "x1", "b"]);
    const display = sectionedOrder(items, isOpen, "end");
    const x1 = items.find((t) => t.id === "x1")!;
    expect(sectionedDropAfterId(display, isOpen, x1, null)).toBe("a");
  });

  it("resolves a virtual anchor to its after_id", () => {
    const items = chain(["a", "x1", "b"]);
    const dummy = { id: "dummy", after_id: "x1" };
    const display = [items[0], dummy, items[2], items[1]];
    const b = items[2];
    expect(sectionedDropAfterId(display, isOpen, b, "dummy", (t) => t.id === "dummy")).toBe("x1");
  });

  it("handles an item from another list", () => {
    const items = chain(["a", "x1", "b"]);
    const display = sectionedOrder(items, isOpen, "end");
    const incoming = { id: "n", after_id: "elsewhere" };
    expect(sectionedDropAfterId(display, isOpen, incoming, "x1")).toBe("b");
    expect(sectionedDropAfterId(display, isOpen, incoming, null)).toBe(null);
  });

  it("follows the drop point when an item from another list has no section to join", () => {
    const items = chain(["a", "b"]);
    const incoming = { id: "x9", after_id: "elsewhere" };
    expect(sectionedDropAfterId(items, isOpen, incoming, "a")).toBe("a");
    expect(sectionedDropAfterId(items, isOpen, incoming, null)).toBe(null);
  });
});

describe("dummyDisplayIndex", () => {
  const items = chain(["a", "x1", "b", "x2"]);
  const display = sectionedOrder(items, isOpen, "end");
  it("follows the nearest open item at or before its after_id", () => {
    expect(dummyDisplayIndex(items, display, isOpen, "x2")).toBe(1);
    expect(dummyDisplayIndex(items, display, isOpen, "x1")).toBe(0);
    expect(dummyDisplayIndex(items, display, isOpen, "b")).toBe(1);
  });
  it("goes to the top with no open predecessor", () => {
    expect(dummyDisplayIndex(chain(["x1", "a"]), sectionedOrder(chain(["x1", "a"]), isOpen, "end"), isOpen, "x1")).toBe(-1);
    expect(dummyDisplayIndex(items, display, isOpen, null)).toBe(-1);
  });
});
