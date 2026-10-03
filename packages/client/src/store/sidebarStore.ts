import { createSignal } from "solid-js";

export const [sidebarOpen, setSidebarOpen] = createSignal(false);

/**
 * Whether the sidebar stays open as a column on a wide screen instead of
 * collapsing once a board is picked. Per device. A narrow screen ignores it.
 */
const PINNED_KEY = "sidebar-pinned";

function loadPinned(): boolean {
  try {
    return localStorage.getItem(PINNED_KEY) === "true";
  } catch {
    return false;
  }
}

const [pinned, setPinned] = createSignal(loadPinned());
export const sidebarPinned = pinned;

export function setSidebarPinned(value: boolean): void {
  setPinned(value);
  try {
    localStorage.setItem(PINNED_KEY, String(value));
  } catch {
    // Storage unavailable: the choice lasts only for this session.
  }
}
