/**
 * In-memory record of recent sync traffic, for inspection from the web
 * console (see debugConsole.ts). Not persisted.
 */

export interface SyncLogEntry {
  /** Local wall-clock time of the event. */
  at: number;
  dir: "in" | "out";
  entity_type: string;
  id: string;
  updated_at?: number;
  /** For incoming entities: whether the local copy was replaced. */
  outcome?: "applied" | "ignored-older" | "deleted" | "kept";
  /** updated_at of the local copy when an incoming entity arrived. */
  local_updated_at?: number;
  /** Extra detail, such as the format text of a board or list. */
  note?: string;
}

const MAX_ENTRIES = 1000;
const entries: SyncLogEntry[] = [];

/** Server clock minus local clock, in ms, per endpoint, from the last handshake. */
export const clockOffsets = new Map<string, number>();

/** Summarize the parts of an entity worth seeing in the log. */
function noteFor(entityType: string, data: any): string | undefined {
  if ((entityType === "board" || entityType === "list") && data && "format" in data) {
    return `format=${JSON.stringify(data.format?.text ?? null)}`;
  }
  if (entityType === "item" && data?.title !== undefined) return `title=${JSON.stringify(data.title)}`;
  return undefined;
}

export function logSync(
  dir: "in" | "out",
  entityType: string,
  data: any,
  outcome?: SyncLogEntry["outcome"],
  existing?: { updated_at?: number } | null,
): void {
  entries.push({
    at: Date.now(),
    dir,
    entity_type: entityType,
    id: String(data?.id ?? data),
    updated_at: typeof data?.updated_at === "number" ? data.updated_at : undefined,
    outcome,
    local_updated_at: existing?.updated_at,
    note: noteFor(entityType, data),
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function syncLogEntries(): readonly SyncLogEntry[] {
  return entries;
}
