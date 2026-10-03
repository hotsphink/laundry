import { type Component, For, Index, Show, Switch, Match, createSignal } from "solid-js";
import type { AttributeDefinition, AttributeType } from "@listr/shared";
import { parseDecimal } from "./AttributeEditor.js";

export const ATTRIBUTE_TYPES: { value: AttributeType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "integer", label: "Whole Number" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & Time" },
  { value: "boolean", label: "Yes/No" },
  { value: "todo", label: "Todo" },
  { value: "enum", label: "Select" },
  { value: "tags", label: "Tags" },
  { value: "url", label: "URL" },
  { value: "duration", label: "Duration" },
];

interface Props {
  schema: AttributeDefinition[];
  onChange: (schema: AttributeDefinition[]) => void;
}

const TODO_DEFAULT_LABELS: Record<string, string> = { done: "Done", cancelled: "Cancel", skipped: "Skip" };

/** One line describing an attribute's key, type, options and default. */
function summarize(attr: AttributeDefinition): string {
  const parts = [`[${attr.key}]`, ATTRIBUTE_TYPES.find((t) => t.value === attr.type)?.label ?? attr.type];
  if ((attr.type === "enum" || attr.type === "tags") && attr.options?.length) parts.push(attr.options.join(", "));
  const d = attr.default_value;
  if (d != null && d !== "" && !(attr.type === "boolean" && d === false)) {
    const shown = attr.type === "boolean" ? "Yes" : attr.type === "todo" ? TODO_DEFAULT_LABELS[String(d)] ?? String(d) : String(d);
    parts.push(`default ${shown}`);
  }
  return parts.join(" \u00b7 ");
}

/**
 * The board's attributes as a compact list, one line each. Editing expands a
 * row into its fields; a new attribute starts expanded.
 */
const SchemaEditor: Component<Props> = (props) => {
  const [open, setOpen] = createSignal<Set<number>>(new Set());
  const isOpen = (i: number) => open().has(i);
  const toggle = (i: number) => setOpen((prev) => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  const addAttribute = () => {
    const pos = props.schema.length;
    setOpen((prev) => new Set(prev).add(pos));
    props.onChange([
      ...props.schema,
      {
        key: `field_${pos}`,
        label: "",
        type: "text",
        required: false,
        position: pos,
      },
    ]);
  };

  const updateAt = (index: number, updates: Partial<AttributeDefinition>) => {
    const updated = props.schema.map((attr, i) =>
      i === index ? { ...attr, ...updates } : attr,
    );
    props.onChange(updated);
  };

  const removeAt = (index: number) => {
    // Keep the open rows open as the ones after the removed row shift up.
    setOpen((prev) => new Set([...prev].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))));
    props.onChange(props.schema.filter((_, i) => i !== index));
  };

  const removeButton = (attr: () => AttributeDefinition, i: number) => (
    <button
      type="button"
      class="btn-icon"
      onClick={() => removeAt(i)}
      title="Remove attribute"
      aria-label={`Remove attribute ${attr().label || attr().key || i + 1}`}
    >
      <span aria-hidden="true">×</span>
    </button>
  );

  return (
    <div>
      <div class="schema-list">
      <Index each={props.schema}>
        {(attr, i) => (
          <Show
            when={isOpen(i)}
            fallback={
              <div class="schema-entry schema-entry-collapsed">
                <button
                  type="button"
                  class="btn-bare schema-summary"
                  aria-expanded="false"
                  aria-label={`Edit attribute ${attr().label || attr().key}`}
                  onClick={() => toggle(i)}
                >
                  <span class="schema-summary-name">{attr().label || attr().key}</span>
                  <span class="schema-summary-detail">{summarize(attr())}</span>
                </button>
                {removeButton(attr, i)}
              </div>
            }
          >
          <div class="schema-entry schema-entry-open">
            {/* Row 1 on mobile: collapse + key + label + delete. display:contents on desktop. */}
            <div class="schema-entry-main">
              <button
                type="button"
                class="btn-icon btn-icon-sm btn-icon-quiet schema-collapse"
                aria-expanded="true"
                aria-label={`Done editing attribute ${attr().label || attr().key}`}
                title="Done editing"
                onClick={() => toggle(i)}
              >
                <span aria-hidden="true">{"\u25be"}</span>
              </button>
              <input
                class="schema-key"
                placeholder="Key"
                aria-label="Attribute key, used in format strings"
                title="Attribute key (used in format strings)"
                value={attr().key}
                onBlur={(e) => updateAt(i, { key: e.currentTarget.value })}
              />
              <input
                placeholder="Label"
                aria-label="Display label, shown in table headers and forms"
                title="Display label (shown in table headers and forms)"
                value={attr().label}
                onBlur={(e) => updateAt(i, { label: e.currentTarget.value })}
              />
              {removeButton(attr, i)}
            </div>
            {/* Row 2 on mobile: type + options + default. display:contents on desktop. */}
            <div class="schema-entry-detail">
              <select
                class="schema-type"
                aria-label="Attribute type"
                title="Attribute type"
                value={attr().type}
                onChange={(e) => {
                  const newType = e.currentTarget.value as AttributeType;
                  updateAt(i, { type: newType, default_value: undefined });
                }}
              >
                <For each={ATTRIBUTE_TYPES}>
                  {(t) => <option value={t.value}>{t.label}</option>}
                </For>
              </select>
              {(attr().type === "enum" || attr().type === "tags") && (
                <input
                  class="schema-options"
                  placeholder="opt1, opt2, ..."
                  aria-label="Options, comma separated"
                  title="Options (comma-separated)"
                  value={(attr().options ?? []).join(", ")}
                  onBlur={(e) =>
                    updateAt(i, {
                      options: e.currentTarget.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              )}
              <div class="schema-default-wrap">
                <DefaultValueInput
                  type={attr().type}
                  value={attr().default_value}
                  options={attr().options}
                  onChange={(v) => updateAt(i, { default_value: v })}
                />
              </div>
            </div>
          </div>
          </Show>
        )}
      </Index>
      </div>
      <button type="button" class="btn-ghost" onClick={addAttribute}>
        + Add attribute
      </button>
    </div>
  );
};

interface DefaultValueInputProps {
  type: AttributeType;
  value: unknown;
  options?: string[];
  onChange: (value: unknown) => void;
}

const DefaultValueInput: Component<DefaultValueInputProps> = (props) => {
  return (
    <Switch fallback={
      <input
        placeholder="empty"
        aria-label="Default value for new items"
        title="Default value for new items"
        value={props.value != null ? String(props.value) : ""}
        onBlur={(e) => props.onChange(e.currentTarget.value || undefined)}
      />
    }>
      <Match when={props.type === "url"}>
        <input
          placeholder="https://..."
          aria-label="Default value for new items"
        title="Default value for new items"
          value={props.value != null ? String(props.value) : ""}
          onBlur={(e) => props.onChange(e.currentTarget.value || undefined)}
        />
      </Match>
      <Match when={props.type === "number"}>
        <input
          inputmode="decimal"
          placeholder="(none)"
          aria-label="Default value for new items"
          title="Default value for new items"
          value={props.value != null ? String(props.value) : ""}
          onBlur={(e) => {
            const v = parseDecimal(e.currentTarget.value);
            if (v !== null) props.onChange(Number.isNaN(v) ? undefined : v);
            else e.currentTarget.value = props.value != null ? String(props.value) : "";
          }}
        />
      </Match>
      <Match when={props.type === "integer"}>
        <input
          type="number"
          step="1"
          placeholder="(none)"
          aria-label="Default value for new items"
          title="Default value for new items"
          value={props.value != null ? Number(props.value) : ""}
          onBlur={(e) => {
            const v = e.currentTarget.valueAsNumber;
            props.onChange(Number.isNaN(v) ? undefined : Math.round(v));
          }}
        />
      </Match>
      <Match when={props.type === "boolean"}>
        <select
          aria-label="Default value for new items"
        title="Default value for new items"
          value={props.value === true ? "true" : "false"}
          onChange={(e) => props.onChange(e.currentTarget.value === "true")}
        >
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </Match>
      <Match when={props.type === "enum"}>
        <select
          aria-label="Default value for new items"
        title="Default value for new items"
          value={props.value != null ? String(props.value) : ""}
          onChange={(e) => props.onChange(e.currentTarget.value || undefined)}
        >
          <option value="">(none)</option>
          <For each={props.options ?? []}>
            {(opt) => <option value={opt}>{opt}</option>}
          </For>
        </select>
      </Match>
      <Match when={props.type === "date" || props.type === "datetime"}>
        <input
          type={props.type === "datetime" ? "datetime-local" : "date"}
          aria-label="Default value for new items"
        title="Default value for new items"
          value={props.value != null ? String(props.value) : ""}
          onChange={(e) => props.onChange(e.currentTarget.value || undefined)}
        />
      </Match>
      <Match when={props.type === "todo"}>
        <select
          aria-label="Default state for new items"
        title="Default state for new items"
          value={props.value != null ? String(props.value) : "default"}
          onChange={(e) => props.onChange(e.currentTarget.value === "default" ? undefined : e.currentTarget.value)}
        >
          <option value="default">Todo</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancel</option>
          <option value="skipped">Skip</option>
        </select>
      </Match>
      <Match when={props.type === "duration"}>
        <input
          type="number"
          placeholder="(none)"
          aria-label="Default value for new items, in minutes"
          title="Default value for new items (in minutes)"
          value={props.value != null ? Number(props.value) : ""}
          min="0"
          onBlur={(e) => {
            const v = e.currentTarget.valueAsNumber;
            props.onChange(isNaN(v) ? undefined : v);
          }}
        />
      </Match>
    </Switch>
  );
};

export default SchemaEditor;
