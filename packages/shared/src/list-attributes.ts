// Attributes of a List itself, as opposed to its items. The schema is fixed;
// users cannot define their own yet. Formats refer to them as `list.<key>`.

import type { AttributeDefinition, List } from "./types.js";

export type ListDisplay = "brief" | "verbose";

export const LIST_SCHEMA: AttributeDefinition[] = [
  {
    key: "display",
    label: "Display",
    type: "enum",
    required: true,
    default_value: "brief",
    options: ["brief", "verbose"],
    position: 0,
  },
];

/** Keys stored per device instead of on the synced List. */
export const LOCAL_LIST_ATTRIBUTES: readonly string[] = ["display"];

/** Prefix that names a list attribute in a format, eg `[list.display]`. */
export const LIST_ATTR_PREFIX = "list.";

/** A list attribute's value, or the schema default when unset. */
export function listAttribute(attributes: Record<string, unknown> | undefined, key: string): unknown {
  const v = attributes?.[key];
  if (v !== undefined && v !== null) return v;
  return LIST_SCHEMA.find((d) => d.key === key)?.default_value;
}

export function listDisplay(attributes: Record<string, unknown> | undefined): ListDisplay {
  return listAttribute(attributes, "display") === "verbose" ? "verbose" : "brief";
}
