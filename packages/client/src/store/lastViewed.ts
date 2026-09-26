/**
 * The board this device last showed, and the list in view on each board, so a
 * restart (the installed app always launches at "/") returns to them rather
 * than to the first board. Per device by design, so it lives in localStorage.
 * Losing it only means starting at the first board again.
 */

const STORAGE_KEY = "last-viewed";

interface LastViewed {
  boardId: string | null;
  /** board id -> id of the list last in view on that board */
  lists: Record<string, string>;
}

function load(): LastViewed {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<LastViewed> | null;
    return {
      boardId: typeof raw?.boardId === "string" ? raw.boardId : null,
      lists: raw?.lists && typeof raw.lists === "object" ? raw.lists : {},
    };
  } catch {
    return { boardId: null, lists: {} };
  }
}

const state = load();

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the position just isn't remembered.
  }
}

export function lastBoardId(): string | null {
  return state.boardId;
}

export function lastListId(boardId: string): string | null {
  return state.lists[boardId] ?? null;
}

export function rememberBoard(boardId: string): void {
  if (state.boardId === boardId) return;
  state.boardId = boardId;
  save();
}

export function rememberList(boardId: string, listId: string): void {
  if (state.lists[boardId] === listId) return;
  state.lists[boardId] = listId;
  save();
}
