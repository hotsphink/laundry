/**
 * Debugging helpers exposed on `window.listr` for use from the web console.
 * Every helper prints a table and also returns its data.
 */
import { upgradeBoardRecord, type Board, type List } from "@listr/shared";
import { db } from "./db/database.js";
import { syncClient } from "./sync/SyncClient.js";
import { syncStatus, syncStatusMessage } from "./sync/syncStore.js";
import { clockOffsets, syncLogEntries } from "./sync/syncLog.js";
import { PROTOCOL_VERSION } from "./sync/protocol.js";

/** What the board page currently has in memory, for comparison with the DB. */
export interface ViewSnapshot {
  board: Board | undefined;
  /** The board format text the page compiled. */
  boardFormat: string;
  lists: List[];
}

let viewProvider: (() => ViewSnapshot) | null = null;

/** Let the board page expose its in-memory state. Returns an unregister function. */
export function registerDebugView(provider: () => ViewSnapshot): () => void {
  viewProvider = provider;
  return () => { if (viewProvider === provider) viewProvider = null; };
}

const iso = (ts: number | undefined | null): string =>
  typeof ts === "number" && ts > 0 ? new Date(ts).toISOString() : String(ts);

const firstLine = (text: string | undefined | null): string =>
  text == null ? "(board)" : text.split("\n")[0];

async function findBoard(which?: string): Promise<Board | undefined> {
  if (!which) {
    const id = viewProvider?.().board?.id;
    return id ? db.boards.get(id) : undefined;
  }
  const exact = await db.boards.get(which);
  if (exact) return exact;
  const needle = which.toLowerCase();
  return (await db.boards.toArray()).find((b) => b.name.toLowerCase().includes(needle));
}

const USAGE = `listr debug helpers (most return promises; use \`await\`):
  listr.help()               show this message
  listr.db                   the Dexie database, e.g.
                               await listr.db.items.where("list_id").equals(id).toArray()
  listr.q(table, pred?)      dump a table, optionally filtered by pred(row)
  listr.tables()             list table names and row counts
  listr.boards()             boards with updated_at and first format line
  listr.formats(board?)      full board format and every list override (board = id or
                               name substring; default: the board on screen)
  listr.view()               compare the on-screen board's in-memory format with the DB
  listr.sync()               connection status, endpoints, per-key sync cursors, clock skew
  listr.log(filter?)         recent sync traffic this session (filter = id, type or text)
  listr.time(ts)             convert a timestamp to ISO
  listr.info()               build time, variant, protocol, service worker
If list items look like they use an old format, run listr.view() and
listr.formats(), then listr.log("format") before reloading.`;

async function q(table: string, pred?: (row: any) => boolean): Promise<any[]> {
  const t = db.table(table);
  const rows = pred ? await t.filter(pred).toArray() : await t.toArray();
  console.table(rows);
  return rows;
}

async function tables(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of db.tables) out[t.name] = await t.count();
  console.table(out);
  return out;
}

async function boards() {
  const rows = (await db.boards.orderBy("position").toArray()).map((b) => ({
    id: b.id,
    name: b.name,
    updated_at: iso(b.updated_at),
    sync_key: b.sync_key,
    format: firstLine(upgradeBoardRecord(b).format?.text),
  }));
  console.table(rows);
  return rows;
}

async function formats(which?: string) {
  const board = await findBoard(which);
  if (!board) {
    console.warn(which ? `No board matches ${JSON.stringify(which)}` : "No board on screen. Pass a board id or name.");
    return undefined;
  }
  const lists = await db.lists.where("board_id").equals(board.id).sortBy("position");
  const boardFormat = upgradeBoardRecord(board).format?.text;
  console.log(`Board ${JSON.stringify(board.name)} (${board.id}) updated_at ${iso(board.updated_at)}\n${boardFormat}`);
  const rows = lists.map((l) => ({
    id: l.id,
    name: l.name,
    updated_at: iso(l.updated_at),
    override: l.format ? l.format.text : "(uses board)",
  }));
  console.table(rows);
  return { board: { id: board.id, name: board.name, updated_at: board.updated_at, format: boardFormat }, lists: rows };
}

async function view() {
  if (!viewProvider) {
    console.warn("No board page is open.");
    return undefined;
  }
  const mem = viewProvider();
  if (!mem.board) {
    console.warn("The board page has not loaded a board.");
    return undefined;
  }
  const dbBoard = await db.boards.get(mem.board.id);
  const dbFormat = dbBoard ? upgradeBoardRecord(dbBoard).format?.text : undefined;
  const rows: Record<string, unknown>[] = [{
    what: `board ${mem.board.name}`,
    mem_updated_at: iso(mem.board.updated_at),
    db_updated_at: iso(dbBoard?.updated_at),
    mem_format: firstLine(mem.boardFormat),
    db_format: firstLine(dbFormat),
    stale: mem.boardFormat !== dbFormat || mem.board.updated_at !== dbBoard?.updated_at,
  }];
  const dbLists = new Map((await db.lists.where("board_id").equals(mem.board.id).toArray()).map((l) => [l.id, l]));
  for (const l of mem.lists) {
    const d = dbLists.get(l.id);
    rows.push({
      what: `list ${l.name}`,
      mem_updated_at: iso(l.updated_at),
      db_updated_at: iso(d?.updated_at),
      mem_format: l.format ? firstLine(l.format.text) : "(board)",
      db_format: d?.format ? firstLine(d.format.text) : "(board)",
      stale: (l.format?.text ?? null) !== (d?.format?.text ?? null) || l.updated_at !== d?.updated_at,
    });
  }
  console.table(rows);
  if (rows.some((r) => r.stale)) console.warn("The page is showing data that differs from IndexedDB.");
  return rows;
}

async function sync() {
  const status = { status: syncStatus(), message: syncStatusMessage(), now: iso(Date.now()) };
  console.log("Sync status:", status);
  const offsets = [...clockOffsets].map(([server_id, ms]) => ({ server_id, server_minus_local_ms: ms }));
  if (offsets.length) {
    console.log("Clock offsets (from handshake, includes network latency):");
    console.table(offsets);
  }
  const endpoints = await db.sync_endpoints.toArray();
  console.table(endpoints);
  const cursors = (await db.key_sync_state.toArray()).map((k) => ({ key: k.key, last_sync_at: iso(k.last_sync_at) }));
  console.table(cursors);
  return { ...status, primaryServerId: syncClient.getPrimaryServerId(), offsets, endpoints, cursors };
}

function log(filter?: string) {
  const needle = filter?.toLowerCase();
  const rows = syncLogEntries()
    .filter((e) => !needle || [e.id, e.entity_type, e.dir, e.outcome, e.note].some((v) => v?.toLowerCase().includes(needle)))
    .map((e) => ({
      at: iso(e.at),
      dir: e.dir,
      type: e.entity_type,
      id: e.id,
      updated_at: iso(e.updated_at),
      outcome: e.outcome ?? "",
      local_updated_at: e.local_updated_at === undefined ? "" : iso(e.local_updated_at),
      note: e.note ?? "",
    }));
  console.table(rows);
  return rows;
}

function info() {
  const out = {
    build_time: __BUILD_TIME__,
    variant: __VARIANT__,
    protocol: PROTOCOL_VERSION,
    service_worker: navigator.serviceWorker?.controller?.scriptURL ?? null,
  };
  console.log(out);
  return out;
}

function help(): void {
  console.info(USAGE);
}

export function installDebugConsole(): void {
  (window as any).listr = {
    help, db, q, tables, boards, formats, view, sync, log, info,
    time: (ts: number) => iso(ts),
  };
  help();
}
