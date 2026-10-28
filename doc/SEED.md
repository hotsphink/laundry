# Listr Seed

This document is the minimal description needed to regenerate Listr. A
regenerated app should have the same functionality, though not the same code,
layout, or wording. Everything that specializes the app (names, hosts, limits,
presets, copy, which optional modules exist) lives in the companion form
`doc/SEED-PARAMS.yaml`. This document refers to its values as `{{path.to.value}}`.

Read the whole seed before writing code. Sections 2 to 6 are the core. Section 7
covers optional modules, each enabled by `{{modules.*}}`. Section 8 lists
acceptance checks that a regenerated app must pass. Most come from bugs and
change requests in the reference app's history, so they encode the decisions
that are easiest to get wrong.

---

## 1. Product

A local-first, Trello-like list manager for personal and family use. It covers
things like a movie watchlist, a shared grocery list, or a to-do list. The
three ideas that set it apart:

1. **Per-board schemas.** Each board defines typed attributes that every item
   in its lists may carry.
2. **A display format language.** Each board has a small templating language
   that decides how one item renders as one line (or a few lines) of styled
   text. A list may override the board's top-level template.
3. **Offline-first with optional multi-device sync and sharing.** Data lives in
   the browser. A self-hostable sync server mirrors it across devices and
   shares boards with other people, using invite links instead of accounts
   with passwords.

The primary target is a phone used one-handed (touch, installed as a PWA). The
desktop is a first-class secondary target for heavier editing, such as format
strings. Supported browsers: Firefox (desktop and Android), Chrome, and Safari
on iOS.

---

## 2. Fixed technology choices

These are part of the seed and are not parameters.

- TypeScript throughout. A pnpm workspace monorepo with three packages:
  - `shared`: types, the format language (parser, static checker, evaluator),
    migrations, and the integration overlay logic. No framework dependency.
    Both client and server use it.
  - `client`: SolidJS with Vite. Dexie.js over IndexedDB. Hash routing, so the
    app works from a static host. DOMPurify sanitizes rendered formats.
    SortableJS handles drag-and-drop. Add `qrcode` and `jsQR` for QR
    share/scan, and a TOML parser for integration configs.
  - `server`: Node.js with `ws` for WebSocket and `better-sqlite3` (WAL mode).
    YAML config. It also serves an operator console frontend (SolidJS/Vite)
    under `/console` (optional module).
- Reactive reads use `createEffect` + Dexie `liveQuery`, re-subscribing when
  route params change. Never capture a param once at creation.
- Sync is JSON over a single WebSocket per server. The conflict policy is
  **document-level last-writer-wins on `updated_at` (ms)**, with tombstones
  (section 5).
- Tests: Vitest for units, Playwright (Firefox first) for e2e. E2e starts its
  own Vite server and throwaway sync server on separate ports, never the
  developer's running servers.
- Production builds emit source maps.

---

## 3. Data model

All entities have `id` (UUID; fall back to a Math.random v4 when
`crypto.randomUUID` is unavailable on insecure origins), `created_at`,
`updated_at`, and `schema_version` (the data-shape version they were authored
under).

- **Space**: a sync key plus a display name. A space is the unit of sharing,
  and every board lives in exactly one. Each user has a **home space** (shown
  as "My Boards") whose key the server issues. Space names travel with the
  server's per-user key list.
- **Board**: `name`, `color`, `after_id`, `space` (its sync key; unset means
  the home space), `schema: AttributeDefinition[]`, `format: {version, text}`,
  `states` (see below), and optional `integrations[]`.
- **List**: `board_id` (required; there are no boardless lists), `name`,
  `after_id`, `format: {version, text} | null` (null inherits the board's), and
  `attributes` for the fixed list schema.
- **Item**: `list_id`, `title` and `state` (first-class fields, never part of
  the schema), `after_id` (see ordering), `attributes` (user-owned values
  only), and optional `choices` (picks from integration options, section 7.3).
- **States**: `Board.states` is null (items cannot be checked off) or an
  ordered list of `{key, label, category, styles[]}`.
  - `category` is `open`, `active` (for example blocked, waiting, in
    progress), or `finished`. All behavior derives from the category.
  - The first entry is the open state, and an unset `Item.state` means it. At
    least one entry must be finished.
  - Keys are fixed once created, so stored values never break. Labels are
    freely editable.
  - `styles` are format style tokens applied to the whole row.
  - Presets (`{{state_presets}}`) make setup one step. Turning on "Items can
    be checked off" applies a preset, which the user may then edit.
  - Deleting a state that items use asks first, then moves them to the open
    state.
  - Integrations never fill `state`.
- **AttributeDefinition**: `key`, `label`, `type`, `default_value`, `options`
  (for enum/tags), `config` (for example integer min/max). Array order is display order. New
  attributes get keys like `field_<n>`. Changing an attribute's type clears its
  default. A default applies only when the value is undefined at creation.
  `auto: on_create timestamp` stamps the creation time.
- **Attribute types**: `{{attribute_types}}`. Storage rules:
  - durations are minutes;
  - dates are `YYYY-MM-DD`, and datetimes use the datetime-local string;
  - tags are `string[]`;
  - empty scalars are null.
- **Set vs unset** is uniform everywhere: `undefined`, `null`, `""`, `[]`, and
  `NaN` are unset. `0` and `false` are set.
- **List settings**: one fixed, non-user-editable schema,
  `{{list_settings}}`, holds every per-list option (brief/verbose display,
  finished-item display, view mode). Each setting is scoped `synced` (stored
  in `List.attributes`) or `device` (stored in localStorage by list id, never
  synced). All are readable by formats as `[list.key]`. The list editor and
  the format preview's toggles are generated from this schema, so a new
  setting needs no new UI code.
- **Asset**: a content-addressed image. `id` is the first 20 hex chars of the
  SHA-256 of its bytes. It also has `mime_type`, `ext`, and `data`. Formats
  reference assets as `hash://<id>.<ext>`, and the client resolves those to
  `blob:` URLs. Enforce `{{limits.max_asset_bytes}}` on the client so an asset
  always fits in one sync frame.

**Ordering.** Boards, lists, and items are each ordered by one mechanism: a
linked list through `after_id` (null means first) within their container.
Boards are ordered within their space, lists within their board, and items
within their list. This keeps a reorder to a few changed records and keeps
concurrent edits mergeable. Boards, lists, and items can all be reordered.
The order of spaces in the sidebar is device state.
- Resolve the order by a depth-first walk from null, so each branch of a fork
  stays contiguous. When two entities claim the same predecessor, order them
  by `created_at`, oldest first.
- Tombstones of ordered entities keep their container id and `after_id`, and
  the walk passes through them as invisible nodes. An entity inserted after
  one that was concurrently deleted lands where the deleted one was.
- Guard against cycles, and append true orphans (an `after_id` that never
  existed in the container) at the end.
- Insert, delete, move, and bulk delete must re-link successors so the chain
  stays intact. Moving to another container (an item to another list, a board
  to another space) is a delete from one chain and an insert into the other.

**Versioning.** On-disk shape changes bump the Dexie version with an
`upgrade()`. Never edit an old version block. Synced shape changes bump
`PROTOCOL_VERSION`, and the server accepts a min..max range. A minimum bump is
a flag day.

---

## 4. Core client behavior

### 4.1 Layout and navigation

Routes: home, `/board/:id`, settings/sync page, `/join/...`, and (dev only) an
in-browser test page.
- Home redirects to the last-viewed board.
- The app remembers the last board, and the list scrolled into view per board,
  across restarts.

**Sidebar.** On narrow screens (at most `{{ui.narrow_breakpoint_px}}`) it is an
overlay. On wide screens it collapses next to the board after a pick, unless
the user pins it open; the pin is per device.

The sidebar is a list of **spaces**, each collapsible, with My Boards first.
- Each space has a header with its name, a Share button, and a menu (Rename,
  Leave space). Its boards follow, then "+ New board" in that space.
- A space holding a single board of the same name renders as one row, so a
  board shared on its own does not show a redundant header.
- **Leave space** removes the space's boards from this account's devices and
  leaves the key on the server. The confirm names the boards. It is not
  offered for My Boards.

Each board row has a color stripe and a "shared" indicator. Its menu offers
Rename (inline), Edit, Share, Clone, Import, Export, and Delete (cascades and
tombstones).

The sidebar footer has New space, Export all, Import, Open a link (scan or
paste), and a sync status dot linking to settings.

**Board page.**
- **Header**: board name, shared indicator, filtered item count, and a menu
  (Edit, Share, Clone, Import, Export, Delete). Double-click on empty header
  space (desktop) or double-tap (touch) opens Edit Board without selecting
  text.
- **Filter**: case-insensitive substring over the title and all effective
  attribute values (integration values included). It resets on board change.
  On mobile it is a toggle-revealed bar.
- **Columns**: one per list. On mobile they scroll horizontally with
  scroll-snap, and a trailing "+ New list" column creates a list and opens its
  editor. On desktop, dragging the background pans the board.
- **Column header**: name, count, a brief/verbose density toggle (the
  `display` list setting), "+" to add at the top, and a menu (Edit, Clear
  finished, Uncheck all, Import, Export, Delete).
- The browser's pull-to-refresh is disabled inside the app.

### 4.2 Items

- Each row shows the rendered format, an integration status badge (7.3), and,
  if the board has states, a checkbox control.
  - Tapping it moves an open or active item to the *first* finished state,
    and a finished item back to the open state.
  - Long-press or right-click offers every state.
  - The row carries its state's styles.
- **Inline add** is always present at the end of every list. The column
  header's "+" adds at the top instead.
  - Enter creates the item and keeps the input open.
  - Pasting several lines creates one item per line, in order.
  - An expand control opens the full item form with the typed title.
  - In a sectioned finished-item display, new items land at the end of the
    open section.
- **Item form**: title plus one editor per schema attribute.
  - Numbers are a decimal text field with no spinners.
  - "Whole Number" (integer) is a number input that rounds its value.
  - Durations accept `1h42m`, `1h42`, `42m`, or `42`.
  - Tags are toggle chips.
  - Enums and the state are selects.
  - Values supplied by an integration appear as styled placeholders with a
    note naming the integration. They are never saved into the item.
  - Values the board cannot show are listed with the reason.
  - Saving requires a non-empty title, or one supplied by an integration.
- **Finished-item display** (device-local, per list): `mixed` (in place),
  `end` (sections in category order: open, active, finished), or `hidden`
  (finished items are hidden).
  - It is display only: the shared chain order never changes because of it.
  - Reordering in the sectioned view maps back to a chain position that
    keeps the item in its own section. Resolve ambiguous cases simply.
  - It appears in the list editor only when the board has states.
- **List actions** for boards with states: "Clear finished" (deletes finished
  items) and "Uncheck all" (returns every item to the open state). This is
  how a shopping list is reused.
- **Deleting several items** always happens in one transaction and one
  batched tombstone push.
- **Undo instead of confirmation.** Deleting, moving, changing state, bulk
  edits, "Clear finished", and "Uncheck all" act at once and show an Undo
  toast for `{{ui.undo_seconds}}` seconds. Undo writes the previous values
  with a new `updated_at` (a delete is undone by re-creating the item, which
  beats its tombstone). Only deleting a board or list, and leaving a space,
  ask for confirmation.

### 4.3 Selection, gestures, drag

**Desktop.**
- Click selects; Ctrl/Cmd-click toggles; Shift-click selects a range over the
  displayed items.
- Double-click edits. Right-click opens the item menu, selecting the item
  first if needed.
  - One item: Edit Item, Choose match (when choices exist).
  - Several items: Edit N items.
  - Always: Move to list, Delete N.
- Every menu entry must do the same thing as its gesture equivalent.

**Touch** (timings in `{{ui.gestures}}`).
- Double-tap edits.
- Long-press anywhere but the drag handle enters **selection mode**.
  - The header becomes a bar: back, "N selected", Edit, Move, Delete.
  - Taps toggle items, and checkboxes replace the drag handles.
  - Selection mode exits when the selection is empty.
  - Display-only checkboxes use `pointer-events: none`.
- The click the browser fires after a long-press is swallowed.

**Keyboard.** Rows are focusable. Enter edits, Space toggles selection, and
Menu or Shift+F10 opens the menu.

**Bulk edit.** Each attribute has an "apply" checkbox, and only checked
attributes are written.

**Move to list.** A tree of all boards. It can create a list inline, appends
moved items in order, and skips items already in the target.

**Drag.**
- Dragging starts only from the handle: delayed on touch, immediate with a
  mouse, with a short vibration at start.
- Items can move across lists within a board. Near a screen edge the board
  snaps to the adjacent column; near a column's top or bottom, the column
  scrolls.
- On touch there is a cancel zone at the top of the screen.
- The new order is applied to the UI synchronously before the async DB write,
  so nothing jumps.
- Cache the data needed for the drag at drag start.

**Touch detection.** Use `'ontouchstart' in window` as the primary check.
Firefox Android reports `maxTouchPoints = 0`.

### 4.4 Board, list, and schema editing

- **New board** starts from a template: each of `{{board_presets}}` or
  Blank. The empty state on first run offers the same choice.
- **Board form**: name, color, space, states, format, attributes, and
  integrations (7.3).
  - Moving a board to another space removes it from the old space's other
    members. The server broadcasts the removal to the old key.
  - A new board's format auto-generates as `[title][" " k1][" " k2]...` until the
    user edits it.
  - Save is blocked by format errors.
  - If an edit breaks a list override that previously compiled, warn and
    require confirmation.
- **Schema editor**: attributes appear as a compact list of one-line
  summaries. Opening a row edits it. Text fields commit on blur, to avoid
  focus theft.
- **List form**: name and board (changing it moves the list).
  - An optional "override board format" field, pre-filled from the board's
    first line.
  - An embedded editor for the **board's** format, clearly labeled as
    belonging to the board. Editing it there does not create an override.
  - The list settings, generated from the list settings schema.
- **Format editors** collapse to their first line until expanded.
  - Diagnostics (with line and column) are debounced.
  - Ctrl/Cmd-Enter saves.
  - A live preview has a sample-item picker and a toggle for each list
    setting. The default sample is the item with the most *effective* (not
    user-owned) values set.
  - Images can be dropped, pasted, or picked. Each becomes an asset plus a
    definition `img<id6>="![alt](hash://...)"`. Remote images need no upload:
    use `![alt](https://...)` directly.
- **Clone board**: named "Clone of X". It is an export followed by an import
  with fresh ids (4.5), so it shares their copy options.
  - It has a space picker that defaults to My Boards, so cloning a shared
    board never shares the clone.

### 4.5 Export, import, and clone (one copy engine)

- **Copy options**, one component shared by Export, Import, and Clone:
  - Lists: none, names only, or with items (the default for export and
    import; clone defaults to names only).
  - Integrations: none, as-is, or all disabled. Export can also include the
    values integrations filled in (default off; these become user values on
    import). Hide integration options when no board in scope has any.
- **Export** scopes are all, board, or list. The file nests boards > lists >
  items in chain order. "All" includes tombstones and every asset. Narrower
  scopes include only the referenced assets.
- **Import** shows a preview of the creates, updates, and deletes. It upserts
  by id, applies tombstones with LWW, and puts imported items first in each
  list. Clone imports with fresh ids instead.
- **Moving to another server** is Export all on the old one, then Import
  after joining the new one.

### 4.6 Per-device state, themes, PWA, diagnostics

- **Device-local state** (localStorage, written defensively):
  - theme, sidebar pin, collapsed spaces;
  - last viewed board and list;
  - device-scoped list settings;
  - dismissed notices.
- **Themes**: `{{ui.themes}}`, using CSS `light-dark()` tokens. Respect
  `prefers-reduced-motion`. Hover styles apply only on `(hover: hover)`.
- **Accessibility**:
  - A skip link; labelled modals.
  - Escape closes only the topmost modal, focus is trapped while open, and it
    returns to the opener on close.
  - Arrow-key navigable context menus; aria-live selection counts.
- **PWA**: a manifest plus a stale-while-revalidate service worker. Register
  it only in production. Non-production builds stamp the cache name so
  updates show up immediately. Settings has "Update now", which clears caches
  and activates the waiting worker. Dev and prod builds use distinct icons and
  titles.
- **Debug console**: `window.{{app.console_global}}` exposes helpers (help,
  raw IndexedDB queries, tables, boards, formats on screen, sync log). A usage
  line prints at startup.

---

## 5. Sync (core)

### 5.1 Model

- **Namespaces.** Every synced record belongs to a space's sync key.
  - Lists and items inherit their board's space. Boards with no space use the
    home key, which the server issues; the client never invents one.
  - "New space" creates a fresh random key (at least 128 bits).
  - **Sharing** always shares a space. Sharing a board that lives in My
    Boards first moves it into a new space named after the board. Sharing a
    board in any other space shares that space, and the dialog names the
    other boards that come along.
- **Keys are bearer capabilities.** Possessing a key is enough to read and
  write its namespace. Grants are how keys reach people; the server's per-user
  key list decides subscriptions and display names, not access.
- **LWW.** An incoming record wins only if its `updated_at` is strictly newer.
  Ties keep the stored copy. Both sides apply the same rule.
  - The server clamps timestamps to at most `{{sync.max_future_skew}}` ahead
    of its own clock.
  - Device-scoped settings are never synced, so the merge has no
    per-field exceptions.
- **Tombstones.** Each is `(entity_type, entity_id, deleted_at)`, plus the
  container id and `after_id` for boards, lists, and items (see Ordering), where
  `deleted_at` is the **current time** at deletion, never derived from
  `updated_at`.
  - A tombstone beats any record with `updated_at <= deleted_at`.
  - An edit made after a delete survives.
  - Tombstones are kept indefinitely.
- **Rekey.** A stale push under a different key moves the stored row to the
  new key without changing its content.
  - This is how a board's lists and items follow it when it is shared: their
    timestamps do not change.
  - Assets follow the records that reference them. The server scans pushed
    JSON for `hash://` ids.
- **Cursors** are server time, per key, so client clock skew cannot lose data.
  - A pull has an entity budget. A key that would overflow it is skipped
    whole, and its cursor does not advance.

### 5.2 Protocol

- **Transport**: JSON frames over WebSocket. Limits: max frame size, a
  per-connection token-bucket rate limit, a per-IP connection cap, and an
  Origin allowlist (`{{server.limits}}`). A missing Origin is allowed for
  non-browser tools.
- **Handshake**:
  1. `hello{protocol_version, client_id, pubkey_jwk, keys[]}`.
  2. `challenge{nonce, server_id, variant, protocol range}`.
  3. `auth{sig}`.
  4. One of `ok{user, home_key, display_name, user_keys, integrations,
     server_time, notices}`, `needs_grant` (the socket stays open to redeem),
     or a typed error that closes the socket.
- **Initial sync**: push everything changed locally since each key's cursor
  (boards, lists, items, assets, tombstones), then `pull{keys:[{key,since}]}`.
  The reply is a `snapshot` with per-key server times.
- **Live updates**: `push_entity` and `push_delete` are broadcast to the other
  sockets on that key. There is no ack.
- **Other messages**: key association and leaving, grant create, peek, and
  redeem, display name, device label, device list, and live fan-out of key
  and device changes to the user's other sockets.
- **Reconnect**: retry every 5 s. When the key set changes, update the live
  connection's subscriptions in place instead of reconnecting.
- **Variant guard**: dev and prod clients and servers refuse each other, and
  the check happens before any credentials are sent.

### 5.3 Identity and grants

- **Devices.** Each device generates a non-extractable ECDSA P-256 keypair on
  first use. `client_id` is its RFC 7638 JWK thumbprint.
  - Auth signs `"<app>-auth-v1" + server_id + nonce + client_id`, where the
    nonce is single-use and short-lived.
  - There are no passwords.
  - Client and server implement the thumbprint independently, and both are
    tested against the RFC vector.
- **Server identity.** The server has a random `server_id`, and the client
  pins it on first use. A changed id puts the endpoint into a `conflict` state
  until the user accepts or disables it.
- **Users.** An invitation tree: each user records who invited them, and the
  first user to connect in bootstrap mode becomes root. Each has a self-chosen
  nickname and a state (active, suspended, or revoked). There are no
  permission flags: every user may sync and invite.
  - Effective state is the worst along the path to the root, so suspending a
    user suspends everyone they invited, and restoring them restores the
    subtree.
  - A device belongs to exactly one user forever.
- **Grants.** A grant is a join link with a 96-bit secret, of which only a
  hash is stored. The sender sets its TTL and use count (one person or anyone
  with the link). There are two kinds:
  - **Invite a person**, optionally to a space (one sync key). A browser with
    no account becomes a new user under the sender and joins the space. A
    browser that already has an account just gains the space.
  - **Add my device**: attaches this browser to the sender's own account.
- **Redemption** is atomic and single-use.
  - Repeated wrong secrets burn the grant.
  - A browser that already has an account is refused a device link, and an
    invite link with no space, *before* the use is counted, with an
    explanation.
  - **Extra device**: a spent invite link may add up to
    `{{sync.extra_devices.max}}` more browsers for its single redeemer within
    `{{sync.extra_devices.window}}`. This is the Firefox-to-Safari case on iOS.
    The user must opt in explicitly ("I already joined in another browser").
    The account's other devices see a dismissible notice.
- **Join link**: `<base>#/join/<6-char hash of server_id>/<grant_id>.<secret>[?b=<board>]`.
  - The link carries the server's identity, never its address.
  - The client resolves the hash against its configured endpoints, then the
    build's default endpoint `{{deploy.default_sync_endpoint}}`, then asks for
    a host.
- **Share flow.**
  - The share action issues exactly **one** grant per share. Guard against
    re-running effects.
  - It shows a QR code and a copyable link, with a choice of one person or
    anyone with the link.
  - The recipient sees the space under its name.
- **Join page.** It is about the *shared list*, not about creating an account.
  - It peeks the grant without consuming a use and shows counts with
    placeholder rows; titles stay private.
  - It asks for a device name, prefilled like "Firefox on Android".
  - It offers to keep or remove boards created before joining.
  - On a non-Safari iOS browser it recommends Safari.
  - On success it waits for the shared board and opens it.
  - "Board not found" explains that boards live per browser and offers
    "Open a link".
- **Open a link** is one dialog, used from the sidebar, the missing-board
  page, and settings: paste or scan in-page (the iOS camera opens links in
  the default browser), then go to the join page.

### 5.4 Endpoints

- A device syncs with **one server identity**. It may configure several
  endpoints (host, port, TLS, enabled) as alternate routes to that server,
  for example a tailnet address and a public one. The first to connect is
  primary and the rest are hot standbys, promoted when it drops.
- An endpoint that reports a different `server_id` from the pinned one does
  not sync (see the `conflict` state). Moving to a different server is done
  with Export all and Import.
- Keep multi-server additive later: records never name a server, and the
  endpoint list stays a list.
- **Settings page**:
  - Identity: nickname and user id.
  - Your devices, renameable, with "this device" marked, and "Add a device".
  - Endpoint cards showing status, server id, and variant/conflict callouts.
  - Resync: reset cursors, push everything, and pull everything.
  - Backup and restore.
  - About: build time, protocol version, Update now.

### 5.5 Server

- **Config**: YAML at `{{deploy.server_config_path}}`, one file per variant.
  Keys:
  - host, port, TLS on/off, cert paths, db path, bootstrap flag;
  - allowed origins;
  - services (AI model families and tiers, integration settings);
  - console settings.
- **Storage**: SQLite with idempotent migrations. Each must be a no-op when
  its target shape already exists. Tables:
  - full JSON snapshots per entity, plus tombstones and assets;
  - asset-to-key links, users, clients, user keys, grants;
  - append-only auth events and redemption records;
  - integration results.
- **Data is plaintext** on the server. TLS protects transport only.
- **Certificates**: check expiry at startup and periodically, and warn within
  `{{deploy.cert_warn_days}}` days. A separate script refreshes certs. The
  server itself contains no provider-specific logic.
- **Admin CLI** (`pnpm auth ...`, dry-run unless `--apply`): bootstrap root,
  list users and keys, issue grant, add or remove key, set state, set
  parent, set budget, reset server id.
- **Redaction**: any field named like key, token, secret, or password is
  scrubbed from logs, errors, and the console, raw and URL-encoded. Sync keys
  appear only as a short prefix.

### 5.6 Usage quotas

Calls that cost the operator money (AI import, integration lookups) are
limited by **subtree quotas**, because anyone may invite.
- Every user has a daily budget per kind of call, covering that user and
  everyone below them in the invitation tree. The default is
  `{{quotas.default_subtree_daily}}`. Only the operator sets per-user budgets,
  via the CLI. The root's budget is the server-wide cap.
- A call is charged to every user on the path from the charged user to the
  root, and is allowed only if all of them have room. Budgets reset each UTC
  day. A call over budget waits for the next day.
- Who is charged:
  - AI import: the requesting user.
  - Integration lookups: the user whose push last changed the item. The server
    records that user on the item row, outside the synced JSON.
  - Periodic refreshes: the item's last editor, as above.
- Charge when a call is dispatched, not when it completes, so parallel calls
  cannot overshoot. Failed calls are not refunded.
- Persist counters in SQLite so a restart does not reset them. Cache each
  user's ancestor path and invalidate it when the tree changes.

---

## 6. Display format language (condensed)

The full reference spec is `doc/FORMAT.md` in the original app. Regenerate the
language from these essentials. Details may differ, but every example in 6.2
must render as described.

### 6.1 Essentials

- **Shape.** A format is a top-level template (line 1), then definitions.
  Blank lines and `#` comments may appear anywhere after line 1.
  - It is stored as `{version, text}`.
  - A list override replaces only line 1. It inherits all of the board's
    definitions, and may add or redefine definitions.
  - Any future per-format setting becomes a reserved definition name (for
    example `tooltip=EXPR`), not new syntax.
- **Placeholders.**
  - `[key]` gives an attribute's default rendering.
  - `[key:variant]` is a typed rendering: `str`, `url`, `upper`, `lower`,
    `stars`, `short` (for durations and dates). An inapplicable variant is an
    error.
  - `[key/fallback]` renders the fallback when the attribute is unset.
  - Affixes: `[" (" notes ")"]` renders ` (x)` when the placeholder renders
    non-empty (including via its fallback) and nothing otherwise. Affixes
    are strings before and after the key and its variant and fallback, and
    they expand placeholders like any string.
  - `[list.key]` reads a list setting, whatever its scope.
- **Literal text and HTML.**
  - Literal text passes through. Markdown links `[text](url)` and images
    `![alt](url)` are supported, and the image URL may be `hash://` for
    assets.
  - A small tag allowlist (`{{format.allowed_tags}}`) survives sanitizing.
  - Attribute values are always HTML-escaped.
  - Sanitizing uses DOMPurify only. Allowed attributes: href, src, alt,
    target, rel, class. Only `fmt-*` classes survive. URL schemes: http,
    https, blob (plus data for images). Links with a target get
    `rel="noopener noreferrer"`.
- **Definitions.**
  - `name=EXPR` defines a derived attribute, used as `[name]`.
  - `name(p1,p2)=EXPR` is parameterized and called as `[name(arg)]` or, in
    expressions, `name(EXPR)`.
  - After line 1, whitespace and newlines carry no meaning. A definition
    ends where the next header (`name=` or `name(params)=`, never `==` or
    `=>`) begins. Bare words are not expressions and `=` never appears
    inside one, so the grammar alone finds the boundary. Any layout parses
    the same, including several definitions on one line.
  - Column 0 is only a recovery hint. When a construct or string is left
    open, the parser reports the error ("missing `end`", "unterminated
    string") at the last column-0 header inside it and resumes there, so
    later definitions still compile. A column-0 header inside an open
    construct that does parse still warns.
  - Defining a name that shadows a schema or builtin attribute is an error.
  - Recursion is detected and reported.
- **Expressions.** Strings are `"..."`, `'...'`, `q( ... )` (expanded), and
  `v( ... )` (verbatim: no placeholders, HTML still sanitized). After `q` or
  `v` comes a run of one repeated delimiter character, a space, the text, a
  space, and the same run closed (`(`/`)`, `<`/`>`, `{`/`}`, `[`/`]`, any
  other character closes itself). So `q{{{ ... }}}` never needs escapes.
  Adjacent expressions concatenate. Constructs:
  - `if COND: ... else: ... end`
  - `match EXPR: case => body. ... else => body. end`, with glob
    prefix/suffix cases
  - `join(sep, ...)`, which drops empty values
  - `style(+a,-b): ... end`, which styles only its body
  - `style(+a,-b) for item`, which styles the whole row wherever it is
    evaluated, including inside definitions. It rewrites no output. The
    row's classes are the board state's styles, then every evaluated `+`,
    then every evaluated `-`, so order of evaluation does not matter.
    `item` is the only scope name for now (see 9).
- **Conditions.**
  - `@key` tests truthiness, or gives the raw typed value inside a
    comparison.
  - `[?key]` and `[?a,?b]` test whether attributes are set.
  - Comparisons `== != < ...`, `AND`/`OR` (mixing them unparenthesized is an
    error), `NOT`, parentheses, `"x" in @tags`, `true`, `false`.
  - Typed literals cover numbers, booleans, and durations like `1h3m`.
  - `[state]` renders the state's label, `[state:str]` its key, and
    `@state == "done"` or `match @state` test it. The checker validates
    state keys against the board's list.
- **Styles.** `{{format.styles}}`. A style `name` maps to CSS class `fmt-name`
  on spans.
- **Values.**
  - At top level, unset values render empty. Never fall back to the bare
    title.
  - Unset booleans count as false.
  - Durations render as "1 hour 26 minutes", or "1h26m" with `:short`.
- **Diagnostics.** The parser recovers from errors and reports every one with
  line and column. Static checks run against the schema: unknown attributes
  (treated as unset at display time), bad variants, and `[?bool]` (warns to
  suggest `@bool`).

### 6.2 Golden examples

The preset formats in `{{board_presets}}` are golden examples. Each must
compile without diagnostics against its preset schema and render as its
`expect` cases say. In addition:

```
[title][extra]

extra=style(+subdued): [" (" notes ")"] end
```
With notes "x", this renders `title (x)`, and the parenthesized part carries
`fmt-subdued`. Without notes it renders `title`.

```
[title][flag]

flag=if @important: style(+bold) for item end
```
With `important` true, the row carries `fmt-bold` and the text is just the
title. With a state whose styles include `subdued`, the row carries both.

```
[title_dpy]

link(text)=if @imdb_id: '<a href="https://www.imdb.com/title/[imdb_id]/">[text]</a>' else: "[text]" end
title_dpy=link([title])
```
Both `title_dpy=link([title])` and `title_dpy="[link([title])]"` work.

```
[a][b]

a=if @title:
  "x"
b="y"
```
This reports one error, "missing `end`", at line 5. `b` still compiles, so
there is no "unknown name" error for `[b]`.

---

## 7. Optional modules

### 7.1 Views (`{{modules.views}}`)

Besides the default list view, a **table** view shows a title column plus
one column per attribute (and the state, if any). Cells use the format
language's typed renderings (`[key:short]`), so there is one renderer.

The view mode is the `view` list setting, scoped per device. On mobile the
switcher lives in a "Display" sheet with the theme picker, not in the header.
Table view stacks lists vertically. The list view scrolls horizontally.

### 7.2 AI screenshot import (`{{modules.ai_import}}`)

- **Scope**: global (makes boards), board (makes lists), or list (makes
  items).
- **Input**: drop, paste, file pick, or camera. Touch devices use the native
  capture input. Non-touch devices with a camera get a live in-page viewfinder.
  - Images are downscaled to `{{ai_import.max_dimension_px}}` and re-encoded
    as JPEG before upload.
- **Endpoint**: the client POSTs to the sync server's `/api/import` with the
  scope and the schema (key, label, type).
  - The endpoint **requires an authenticated, active device**, for example a
    short-lived token issued over the WebSocket session.
  - Each call is charged against subtree quotas (5.6).
- **Server**: prompts the configured vision models for JSON in a fixed shape.
  - It adds per-type hints (duration like "2h21", booleans yes/no, tags as an
    array).
  - The model includes an attribute only when reasonably confident, and
    otherwise leaves the text in the title.
  - Models are tried tier by tier. Models within a tier race, losers are
    aborted, and errors name each failed model with credentials redacted.
- **Preview**:
  - Match boards and lists by case-insensitive name and badge new ones.
  - Mark items whose title already exists as skip. Their values fill only
    empty attributes on the existing item.
  - Let the user uncheck items. Show the raw JSON on request.
- **Order**: after import, items follow the screenshot's order, and the
  reorder is synced.
- **Pending capture**: when offline or when extraction fails, keep the image
  locally with its scope and offer Retry or Discard.

### 7.3 Integrations (`{{modules.integrations}}`)

- **Modules.** Server-side modules look up external data for items. The
  catalog is in `{{integrations.catalog}}`. A module declares:
  - its id, name, and output attributes (key, type, label);
  - a TOML config template with defaults commented out;
  - whether it is active (for example, whether it has an API key);
  - `inputsOf(item)`, which returns null when there is nothing to look up;
  - `run()`, which returns values, internal data, optional choices, a status,
    and an optional refresh time.
- **Remote providers.** A module may also live in a separate service, so
  special-purpose backends (a bug tracker, CI status) can be built and
  deployed independently of the sync server.
  - The sync server's config lists provider URLs
    (`{{integrations.remote_providers}}`).
  - A provider advertises the same descriptor a built-in module does, and
    answers lookups over HTTP with the same inputs and results as `run()`.
  - The runner, overlay, choices, and quotas treat remote and built-in
    modules the same way.
- **Board config**: `integrations[]` entries of `{integration_id, enabled,
  config TOML}`.
  - `attributes.<module_key> = "<board_key>"` maps outputs, and `""` drops
    one.
  - List order is priority.
  - The editor validates TOML, can add missing settings, can add the module's
    attributes to the schema, and warns when a module is inactive or not
    offered.
- **Overlay**:
  - Results are separate synced records keyed `item:module`. They are never
    copied into items.
  - Clients lay them over items at read time. User values always win.
  - Values are coerced to the board's types, and those that cannot be shown
    are reported.
  - Clients never push results.
- **Choices**: an ambiguous lookup returns options plus an `options_key`
  hash.
  - The user's pick is stored on the item, together with any user values the
    pick releases (for example, a typed title kept as the query).
  - A pick with a stale key is ignored.
  - Re-picking is available from the item menu.
- **Runner**:
  - Reruns only when the canonical inputs change.
  - Each module has its own queue, with edits ahead of refreshes, plus
    max concurrency and a timeout.
  - Lookups are charged against subtree quotas (5.6).
  - Errors back off exponentially with a cap, keeping the last good values.
  - Results are discarded if the inputs changed during a call.
  - Periodic refresh follows `refresh_at`.
  - A module may read other modules' overlays, but never its own, with loop
    protection.
  - Broadcast a result only when a synced field changed.
- **Badges**, worst first:
  - processing (with a quota note when waiting);
  - error;
  - no match;
  - "?" to choose a match.

### 7.4 Operator console (`{{modules.operator_console}}`)

A read-only web app served by the sync server at `/console`. It is enabled
only when a password hash (scrypt) is configured.
- **Login**: a cookie session with idle and absolute timeouts and a lockout
  after repeated failures.
- **Protection**: CSRF via a JSON content type plus a same-host Origin, a
  strict CSP, and no CORS.
- **Pages**:
  - **Overview**.
  - **Trust graph**: users, devices, grants, and keys, as an SVG graph with
    detail views and a filterable auth-event log.
  - **Integrations**: queues, budgets, recent runs, and drill-down into
    redacted request and response bodies.
  - **AI import**: tiers listed one per line.
  - **Clients**: live and recent connections, per-connection message logs,
    and pull history.
  - **Ports**: listeners, routes, cert days left, connections per IP, allowed
    origins, and probes of `{{console.external_urls}}`.
- **Live updates**: over SSE with a replay buffer. Every in-memory buffer is
  bounded.
- All mutations go through the admin CLI, never the console.

---

## 8. Acceptance checks

A regenerated app must satisfy all of these, in addition to sections 3 to 7.

### Data and ordering
1. Tapping the checkbox on a board with several finished states always picks
   the first one. "Uncheck all" then reopens every item, and deleting a
   state moves its items to the open state.
2. Sharing a board from My Boards moves only that board into a new space.
   Other members see the space by name, and moving the board out of it again
   removes it from their devices.
3. Deleting an item, or deleting several at once, leaves every survivor
   reachable in the same relative order. Moving an item to the last slot
   works.
4. Deleting several items produces a single transaction and a single
   batched push, not one round trip per item.
5. Two devices inserting after the same item concurrently both keep their
   items, ordered by `created_at`, and each one's following items stay with
   it. If one device deletes an item while another inserts after it, the
   new item lands where the deleted one was, not at the end. The same holds
   for lists and boards.
6. A tombstone's `deleted_at` is the wall-clock time of the delete. A device
   whose cursor is newer than the item's `updated_at` still receives the
   delete.
7. A record with a timestamp far in the future is clamped by the server and
   does not win forever.
8. The order of the shared chain is identical on every device regardless of
   each device's finished-item display. Dragging an item in `end` mode keeps
   it in its section and produces a sensible position in `mixed` mode.

### Device-local state
9. Undoing a delete restores the item on every device, in its old place,
   even after the tombstone has synced.
10. Pasting three lines into the add row creates three items in order.
11. Toggling brief/verbose, finished display, or view mode on one device
   changes nothing on another device.
12. After a restart, the app reopens the last board, scrolled to the last
   list.

### Formats
13. Changing a board or list format, locally or on another device, re-renders
   every visible item with the new format without a reload.
14. A missing top-level attribute renders empty. It never falls back to the
    title.
15. A list override can use board definitions. Editing the board so that an
    override breaks warns before saving.
16. The format preview shows a populated sample on a board whose only item
    has integration values and no user values.
17. Editing the board format from the list editor does not give the list an
    override.

### Items and UI
18. "Edit Item" in the context menu opens the editor exactly as double-click
    does.
19. Number fields have no spinner buttons. Whole Number exists for integer
    use.
20. The full flow of checking off every item on a shared shopping list shows
    no privacy warnings and needs no extra confirmations.
21. Double-clicking empty header space opens Edit Board and selects no text.
    Double-tap does the same on touch.
22. Dragging across lists on a phone works by edge-snapping. Dropping on the
    cancel zone restores the original position and scroll.
23. A desktop without touch gets a live camera view for import, not a file
    dialog.

### Integrations
24. Picking a match on one device never blanks the item on another device,
    including before the other device has received the integration result.
    The title it released is preserved as the query, and the item still
    renders.
25. In the item editor, integration values appear as distinguishable
    placeholders with their source named. Saving without edits stores
    nothing new.
26. Filtering and the preview sample use effective values (overlay included), not just
    user-owned ones.
27. A quota is honored exactly for a user's whole subtree: when a parent
    and a child both make lookups, both draw on the parent's budget, and
    the count survives a server restart. Testing must never hit the real
    external API; use a fake.
28. A remote provider and a built-in module with the same descriptor
    produce the same overlay, choices, and badges.

### Sync and sharing
29. Sharing a board issues exactly one grant per share action, and the first
    share after a board gets its key works.
30. A person who opens a share link in iOS Firefox and then copies the URL
    into Safari can still get in: either "Join with a link" from the
    missing-board page, or "I already joined in another browser" on the
    spent link.
31. A browser that already has an account is refused a device link with a
    clear explanation, and the grant is not spent.
32. A shared board's lists and items move into the new namespace on every
    device, even though only the board's timestamp changed.
33. A dev client never syncs with a prod server, or the reverse, and learns
    this before authenticating.
34. Adding an image larger than the frame limit is rejected on the client
    with a message. It never wedges sync in a reconnect loop.
35. `/api/import` rejects unauthenticated callers.
36. With two routes to one server configured, dropping the primary route
    promotes the standby without losing or duplicating pushes.
37. Inviting a person who already has an account adds the space to that
    account. No second account is created.

### Onboarding and copy (requested, not yet in the reference app)
38. Show a data-visibility notice once, when the user first *creates* data (a
    board, list, or item) in a shared namespace. Never show it for edits such
    as checking off an item. It says that everyone with access sees all changes,
    that data is stored unencrypted on the server, and that only nicknames
    are shown.
39. Onboarding encourages naming each device.
40. The sidebar makes clear that a space is what gets shared. Every space,
    including My Boards, offers "New board".
41. "?" help affordances explain spaces, sharing, and join links: tap
    to open on touch, hover or click on desktop.
42. The share *action* icon differs from the *is shared* indicator icon.
43. "Share" (invite a person) and "Add a device" are labeled so their
    difference is obvious.

### Operations
44. The server warns about certificate expiry at startup and periodically,
    and suggests the refresh script.
45. Production builds have working source maps for remote debugging on a
    phone.
46. E2e tests run against their own servers on their own ports, alongside a
    developer's running dev servers.

---

## 9. Out of scope

- Field-level merge, CRDTs, or operational transforms.
- End-to-end or at-rest encryption.
- Passwords or email accounts. Identity is device keys plus grants.
- Read-only sharing.
- User-defined list settings, `required` enforcement, and auto behaviors
  beyond `on_create` timestamps.
- Importing legacy data shapes. A regenerated app starts at the current
  versions.
- Card view, and fetching remote images into assets.
- Pruning tombstones.
- Integration-driven state changes, such as polling a CI job and moving an
  item to finished when it completes. Planned. Keep `state` a plain field
  and `category` a small enum so this can be added.
- Permission flags on users. Everyone may sync and invite; quotas and
  subtree suspension are the controls.
- More than one sync server per device. Keep the seams in 5.4 so it can be
  added once a need shapes the design. Independent backends belong in
  remote integration providers (7.3).
- Format constructs `cond`, `ifdef`, unscoped `style(...)`, and `tooltip`.
  An implicit "true when everything used is set" conditional may return in
  a different spelling. Formats that use these constructs need to be
  rewritten with `if`.
- Style scopes other than `item`. Planned: `style(...) as NAME: ... end`
  names a scope that inner code targets with `style(...) for NAME`, and
  table view may add a `cell` scope.
