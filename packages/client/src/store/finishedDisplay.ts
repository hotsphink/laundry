/**
 * Where each list shows its finished items on this device. Per device by
 * design, so other devices keep their own arrangement of the shared order.
 * Losing it only means lists show finished items in place again.
 */
import { createSignal } from "solid-js";
import { FINISHED_DISPLAYS, type FinishedDisplay } from "../db/sections.js";

const STORAGE_KEY = "finished-display";

function load(): Record<string, FinishedDisplay> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Record<string, unknown> | null;
    const out: Record<string, FinishedDisplay> = {};
    if (raw && typeof raw === "object") {
      for (const [listId, mode] of Object.entries(raw)) {
        if (FINISHED_DISPLAYS.includes(mode as FinishedDisplay)) out[listId] = mode as FinishedDisplay;
      }
    }
    return out;
  } catch {
    return {};
  }
}

const [modes, setModes] = createSignal(load());

export function finishedDisplay(listId: string): FinishedDisplay {
  return modes()[listId] ?? "mixed";
}

export function setFinishedDisplay(listId: string, mode: FinishedDisplay): void {
  if (finishedDisplay(listId) === mode) return;
  const next = { ...modes() };
  if (mode === "mixed") delete next[listId];
  else next[listId] = mode;
  setModes(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the choice lasts only for this session.
  }
}
