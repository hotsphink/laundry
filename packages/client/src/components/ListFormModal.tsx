import { type Component, createSignal, createEffect, createMemo, For, Show } from "solid-js";
import { compileFormat, FORMAT_VERSION, type Board, type FormatSpec, type Item, type List } from "@listr/shared";
import Modal from "./Modal.js";
import FormatEditor, { CollapsibleFormatEditor, formatHasErrors, rankSampleItems } from "./FormatEditor.js";
import { brokenListsMessage, listOverridesForBoard, type ListOverride } from "./BoardFormModal.js";
import { db } from "../db/database.js";
import { itemsWithOverlay } from "../db/overlay.js";
import type { FinishedDisplay } from "../db/sections.js";
import { finishedDisplay, setFinishedDisplay } from "../store/finishedDisplay.js";
import { listAttributes } from "../store/localListAttributes.js";

export interface ListFormData {
  name: string;
  board_id: string;
  /** null = use the board's format. */
  format: FormatSpec | null;
  /** A new format for the list's board, if it was edited here. */
  board_format?: FormatSpec;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: ListFormData) => void;
  boards: Board[];
  initial?: List;
  defaultBoardId?: string | null;
}

let seq = 0;

const ListFormModal: Component<Props> = (props) => {
  const uid = `list-form-${++seq}`;
  const [name, setName] = createSignal("");
  const [boardId, setBoardId] = createSignal("");
  const [formatOverride, setFormatOverride] = createSignal("");
  const [overrideFormat, setOverrideFormat] = createSignal(false);
  const [formatError, setFormatError] = createSignal<string | null>(null);
  const [sampleItems, setSampleItems] = createSignal<Item[]>([]);
  const [finished, setFinished] = createSignal<FinishedDisplay>("mixed");
  // Edits to the board's format, for the board they were made on.
  const [boardEdit, setBoardEdit] = createSignal<{ boardId: string; text: string } | null>(null);
  const [boardFormatError, setBoardFormatError] = createSignal<string | null>(null);
  const [otherOverrides, setOtherOverrides] = createSignal<ListOverride[]>([]);

  createEffect(() => {
    if (props.open) {
      setName(props.initial?.name ?? "");
      setBoardId(props.initial?.board_id ?? props.defaultBoardId ?? props.boards[0]?.id ?? "");
      setOverrideFormat(props.initial?.format != null);
      setFormatOverride(props.initial?.format?.text ?? "");
      setFormatError(null);
      setBoardEdit(null);
      setBoardFormatError(null);
      setSampleItems([]);
      setFinished(props.initial ? finishedDisplay(props.initial.id) : "mixed");
      const list = props.initial;
      const board = list && props.boards.find((b) => b.id === list.board_id);
      if (list) {
        db.items.where("list_id").equals(list.id).toArray()
          .then((items) => board ? itemsWithOverlay(board, items) : items)
          .then((items) => setSampleItems(rankSampleItems(items)))
          .catch(console.error);
      }
    }
  });

  const selectedBoard = () => props.boards.find((b) => b.id === boardId());

  /** The board's format text, including any edits made here. */
  const boardFormatText = () => {
    const edit = boardEdit();
    return edit && edit.boardId === boardId() ? edit.text : (selectedBoard()?.format.text ?? "[title]");
  };
  const boardFormatChanged = () => {
    const board = selectedBoard();
    return !!board && boardFormatText() !== board.format.text;
  };

  // Other lists' formats build on the board's, so watch for edits that break them.
  createEffect(() => {
    const board = selectedBoard();
    setOtherOverrides([]);
    if (props.open && board) listOverridesForBoard(board).then(setOtherOverrides).catch(console.error);
  });
  const brokenLists = createMemo(() => {
    const board = selectedBoard();
    if (!board || !boardFormatChanged()) return [];
    return otherOverrides()
      .filter((l) => l.id !== props.initial?.id && l.okBefore && compileFormat(l.text, board.schema, boardFormatText()).hasErrors)
      .map((l) => l.name);
  });
  const hasTodo = () => selectedBoard()?.schema.some((a) => a.type === "todo") ?? false;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!name().trim() || !boardId()) return;
    const board = selectedBoard();
    if (boardFormatChanged() && formatHasErrors(boardFormatText(), board?.schema ?? [])) {
      setBoardFormatError("Fix the errors in the board's format before saving.");
      return;
    }
    if (overrideFormat() && formatHasErrors(formatOverride(), board?.schema ?? [], boardFormatText())) {
      setFormatError("Fix the errors in the format before saving.");
      return;
    }
    const broken = brokenLists();
    if (broken.length > 0 && !confirm(`${brokenListsMessage(broken)} Save anyway?`)) return;
    if (props.initial && hasTodo()) setFinishedDisplay(props.initial.id, finished());
    props.onSave({
      name: name().trim(),
      board_id: boardId(),
      format: overrideFormat() ? { version: FORMAT_VERSION, text: formatOverride() } : null,
      board_format: boardFormatChanged() ? { version: FORMAT_VERSION, text: boardFormatText() } : undefined,
    });
  };

  return (
    <Modal open={props.open} onClose={props.onClose}>
      <h2>{props.initial ? "Edit List" : "New List"}</h2>
      <form onSubmit={handleSubmit}>
        <div class="form-field">
          <label class="field-label" for={`${uid}-name`}>Name</label>
          <input
            id={`${uid}-name`}
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            autofocus
          />
        </div>
        <div class="form-field">
          <label class="field-label" for={`${uid}-board`}>Board</label>
          <select
            id={`${uid}-board`}
            value={boardId()}
            onChange={(e) => setBoardId(e.currentTarget.value)}
          >
            <For each={props.boards}>
              {(board) => <option value={board.id}>{board.name}</option>}
            </For>
          </select>
        </div>
        <Show when={selectedBoard()}>
          {(board) => (
            <div class="form-field">
              <label class="check-label">
                <input
                  type="checkbox"
                  checked={overrideFormat()}
                  onChange={(e) => {
                    setOverrideFormat(e.currentTarget.checked);
                    if (e.currentTarget.checked && !formatOverride()) {
                      setFormatOverride(boardFormatText().split("\n")[0]);
                    }
                  }}
                />
                Override board format
              </label>
              <Show when={overrideFormat()}>
                <div class="field-hint">
                  Replaces the board's first line. The board's directives and definitions still
                  apply, and definitions here add to or replace them.
                </div>
              </Show>
              <Show when={overrideFormat()}>
                <label class="sr-only" for={`${uid}-format`}>Format</label>
                <FormatEditor
                  id={`${uid}-format`}
                  value={formatOverride()}
                  onInput={(v) => { setFormatOverride(v); setFormatError(null); }}
                  schema={board().schema}
                  base={boardFormatText()}
                  sampleItems={sampleItems()}
                  listAttributes={props.initial && listAttributes(props.initial)}
                  placeholder={boardFormatText().split("\n")[0]}
                />
                <Show when={formatError()}>
                  {(err) => <div class="field-error">{err()}</div>}
                </Show>
              </Show>
            </div>
          )}
        </Show>
        <Show when={selectedBoard()}>
          {(board) => (
            <div class="form-field board-format-section">
              <CollapsibleFormatEditor
                label={`Board format (${board().name})`}
                description={
                  (overrideFormat()
                    ? "This list's own format builds on the board's format. "
                    : "This list uses the board's format. ") +
                  "Edits here change the board's format for every list on it, not just this list."
                }
                expanded={boardFormatError() !== null}
                id={`${uid}-board-format`}
                value={boardFormatText()}
                onInput={(v) => { setBoardEdit({ boardId: board().id, text: v }); setBoardFormatError(null); }}
                schema={board().schema}
                sampleItems={sampleItems()}
                listAttributes={props.initial && listAttributes(props.initial)}
                placeholder="[title]"
              />
              <Show when={boardFormatError()}>
                {(err) => <div class="field-error">{err()}</div>}
              </Show>
              <Show when={brokenLists().length > 0}>
                <div class="field-warning" role="status">{brokenListsMessage(brokenLists())}</div>
              </Show>
            </div>
          )}
        </Show>
        <Show when={props.initial && hasTodo()}>
          <div class="form-field">
            <label class="field-label" for={`${uid}-finished`}>Finished items</label>
            <select
              id={`${uid}-finished`}
              value={finished()}
              onChange={(e) => setFinished(e.currentTarget.value as FinishedDisplay)}
            >
              <option value="mixed">In place</option>
              <option value="end">At the end</option>
              <option value="hidden">Hidden</option>
            </select>
            <div class="field-hint">
              Done, cancelled, and skipped items. Applies on this device only and keeps the shared order.
            </div>
          </div>
        </Show>
        <div class="actions">
          <button type="button" class="btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn-primary">
            {props.initial ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ListFormModal;
