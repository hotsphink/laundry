/**
 * List attributes that belong to this device rather than the synced List,
 * such as `display`. Formats read them as `list.<key>` like any other list
 * attribute. Losing them only means lists fall back to the schema defaults.
 */
import { createSignal } from "solid-js";
import { LOCAL_LIST_ATTRIBUTES, type List } from "@listr/shared";

const STORAGE_KEY = "local-list-attributes";

type Store = Record<string, Record<string, unknown>>;

function load(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    return raw && typeof raw === "object" ? (raw as Store) : {};
  } catch {
    return {};
  }
}

const [store, setStore] = createSignal(load());

/**
 * A list's attributes as formats see them: the synced ones, with the
 * device-local keys taken from this device only.
 */
export function listAttributes(list: Pick<List, "id" | "attributes">): Record<string, unknown> {
  const out: Record<string, unknown> = { ...list.attributes };
  for (const key of LOCAL_LIST_ATTRIBUTES) delete out[key];
  return { ...out, ...store()[list.id] };
}

export function setLocalListAttribute(listId: string, key: string, value: unknown): void {
  const next = { ...store(), [listId]: { ...store()[listId], [key]: value } };
  setStore(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the value lasts only for this session.
  }
}
