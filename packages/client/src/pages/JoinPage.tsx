import { type Component, createMemo, createSignal, createEffect, onCleanup, For, Match, Show, Switch } from "solid-js";
import { useParams, useNavigate, useSearchParams, useLocation } from "@solidjs/router";
import { liveQuery } from "dexie";
import { db } from "../db/database.js";
import { syncClient } from "../sync/SyncClient.js";
import { parseJoinPath, hashServerId, type JoinLinkPayload } from "../sync/joinLink.js";
import { DEFAULT_ENDPOINT } from "../sync/defaultEndpoint.js";
import { endpointStatuses } from "../store/endpointStatuses.js";
import type { EndpointStatus } from "../store/endpointStatuses.js";
import { countUnboundLocalBoards, discardUnboundLocalBoards } from "../db/operations.js";
import { setSidebarOpen } from "../store/sidebarStore.js";
import { serverIdentities } from "../sync/primaryConnection.js";
import { currentNonSafariIosBrowser } from "../utils/iosBrowser.js";
import { currentBrowserLabel } from "../utils/browserLabel.js";

type Step =
  | "invalid"
  | "resolving" // hashing configured endpoints / probing the default, looking for a server_id match
  | "unknown_server" // nothing matched, so offer to add a host by hand
  | "connecting" // matched an endpoint, waiting for the handshake to settle
  | "peeking" // connected, waiting for grant_info
  | "confirm" // grant_info in hand, showing the accept/keep-or-discard screen
  | "extra_confirm" // link already used, confirming this is another browser of whoever used it
  | "joining" // redeem_grant sent, waiting for ok or an error
  | "success"
  | "error";

/** Counts of what a shared key holds. Titles are never sent before joining. */
interface GrantContents {
  boards: number;
  lists: number;
  items: number;
}

interface GrantInfo {
  kind: string;
  greeting: string | null;
  issuerDisplayName: string | null;
  /** Null for a grant that hands over no key, and absent from a pre-v9 server. */
  contents: GrantContents | null;
}

/** Which confirm screen a grant gets. */
type Variant =
  | "device" // another device for the account that made the link
  | "add" // shared boards for a browser that already has an account here
  | "shared" // shared boards for someone new
  | "invite"; // an account with nothing shared yet

/** Stand-in rows for the join preview. The real titles stay private until the
 * link is opened, so these only suggest a list. */
const PREVIEW_ROWS = ["Bananas", "Spinach", "Flamethrower"];

const REASON_MESSAGES: Record<string, string> = {
  already_registered: "This browser already uses Listr, so this kind of link can't be used here. Ask for a share link instead.",
  used: "This link has already been opened as many times as it allows.",
  expired: "This link expired. Ask whoever sent it for a new one.",
  burned: "This link was locked after too many tries. Ask for a new one.",
  not_found: "This link doesn't match anything on this server. Ask for a new one.",
  bad_secret: "This link looks damaged. Try copying it again.",
  extra_device_window: "It's been too long since this link was first opened to add another browser with it. Ask for a new link.",
  extra_device_limit: "This link has already added as many browsers as it can. Ask for a new link.",
  extra_device_unavailable: "This link can't add another browser. Ask for a new link.",
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function describeContents(c: GrantContents): string {
  const parts = [plural(c.lists, "list"), plural(c.items, "item")];
  if (c.boards > 1) parts.unshift(plural(c.boards, "board"));
  return parts.join(" \u00b7 ");
}

const DEVICE_ALREADY_REGISTERED =
  "This browser already has its own account on this server, so a device link can't add it to another account.";

function reasonMessage(reason: string | undefined, fallback: string): string {
  return (reason && REASON_MESSAGES[reason]) || fallback;
}

const JoinPage: Component = () => {
  const params = useParams<{ hash: string; credentials: string }>();
  const [searchParams] = useSearchParams<{ b?: string }>();
  const navigate = useNavigate();
  // Set by the in-app "open a link" flows. Only there is there no tab to
  // close, so only there does the screen offer a way back.
  const location = useLocation<{ fromApp?: boolean }>();
  const fromApp = () => !!location.state?.fromApp;

  const payload = createMemo<JoinLinkPayload | null>(() => parseJoinPath(params.hash, params.credentials));
  /** The board a share link points at, if any. A group share and a plain
   * invite carry none, and go straight to the app. */
  const targetBoardId = () => searchParams.b || null;

  const [step, setStep] = createSignal<Step>("resolving");
  const [endpointId, setEndpointId] = createSignal<string | null>(null);
  const [manualHost, setManualHost] = createSignal("");
  const [manualPort, setManualPort] = createSignal(443);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [errorReason, setErrorReason] = createSignal<string | null>(null);
  const [grantInfo, setGrantInfo] = createSignal<GrantInfo | null>(null);
  const [unboundBoards, setUnboundBoards] = createSignal(0);
  const [keepChoice, setKeepChoice] = createSignal<"keep" | "discard" | null>(null);
  const [linkCopied, setLinkCopied] = createSignal(false);
  const [deviceName, setDeviceName] = createSignal(currentBrowserLabel());
  // A join in a non-Safari iOS browser strands the account in that browser,
  // out of reach of a Home Screen app, which only Safari installs.
  const wrongIosBrowser = currentNonSafariIosBrowser();
  // Endpoints created speculatively while probing, whether the default or a
  // manual-host guess, that turned out NOT to match the link. Clean them up so
  // a failed guess does not linger as a dead row in AdminPage's endpoint
  // list.
  const speculativeEndpointIds = new Set<string>();

  const status = () => (endpointId() ? (endpointStatuses()[endpointId()!] as EndpointStatus | undefined) : undefined);

  /** Whether this client already has an account on the server the link
   * resolved to. A share link is issued as a `guest` grant because the sender
   * cannot know the answer; the server hands over just the key when it is
   * yes, so the screen should not promise an account either. */
  const alreadyRegistered = (): boolean => {
    const serverId = status()?.serverId;
    if (!serverId) return false;
    return serverIdentities().some((i) => i.server_id === serverId && i.state === "active");
  };

  async function cleanupSpeculative(exceptId?: string): Promise<void> {
    for (const id of [...speculativeEndpointIds]) {
      if (id === exceptId) continue;
      await db.sync_endpoints.delete(id).catch(() => {});
      speculativeEndpointIds.delete(id);
    }
  }

  // Resolve identity to route. Try every configured endpoint whose known
  // server_id hashes to the link's hash first, since that means "use my own
  // route to a server I already know", which is the whole reason the link
  // carries no route at all. Fall back to the baked-in default only when
  // nothing matches.
  async function tryConfiguredEndpoints(p: JoinLinkPayload): Promise<string | null> {
    const rows = await db.sync_endpoints.toArray();
    for (const row of rows) {
      if (!row.last_server_id) continue;
      const hash = await hashServerId(row.last_server_id);
      if (hash === p.serverHash) {
        if (!row.enabled) await db.sync_endpoints.update(row.id, { enabled: true });
        return row.id;
      }
    }
    return null;
  }

  async function probeEndpoint(host: string, port: number, secure: boolean): Promise<string> {
    // Reuse an existing row for the same route if one exists, rather than
    // piling up duplicates on repeated attempts. host/port aren't indexed,
    // so this is a plain in-memory scan rather than a Dexie where() query.
    const existing = (await db.sync_endpoints.toArray()).find((e) => e.host === host && e.port === port);
    if (existing) {
      if (!existing.enabled) await db.sync_endpoints.update(existing.id, { enabled: true });
      return existing.id;
    }
    const id = crypto.randomUUID();
    await db.sync_endpoints.add({ id, host, port, secure, enabled: true, last_server_id: null, position: Date.now() });
    speculativeEndpointIds.add(id);
    return id;
  }

  createEffect(() => {
    const p = payload();
    if (!p) { setStep("invalid"); return; }

    let cancelled = false;
    (async () => {
      setStep("resolving");
      const configured = await tryConfiguredEndpoints(p);
      if (cancelled) return;
      if (configured) {
        setEndpointId(configured);
        setStep("connecting");
        return;
      }
      const id = await probeEndpoint(DEFAULT_ENDPOINT.host, DEFAULT_ENDPOINT.port, DEFAULT_ENDPOINT.secure);
      if (cancelled) return;
      setEndpointId(id);
      setStep("connecting");
    })();

    onCleanup(() => { cancelled = true; });
  });

  // Once the resolved endpoint's handshake settles, confirm its server_id
  // matches the link's hash before doing anything else with it. That is what
  // makes "hash matches nothing -> say so" work for the default and
  // manual-host probe paths. A configured-endpoint match is already verified
  // before step becomes "connecting", so it always passes here too.
  createEffect(() => {
    const p = payload();
    const epId = endpointId();
    if (!p || !epId || step() !== "connecting") return;
    const s = status();
    if (!s) return;

    if (s.phase === "variant_mismatch") {
      setErrorMessage(s.message ?? "This server is a different build variant.");
      setStep("unknown_server");
      cleanupSpeculative();
      return;
    }
    if (s.phase === "conflict") {
      setErrorMessage("This host's server identity changed since it was last used — resolve that in Admin first.");
      setStep("unknown_server");
      cleanupSpeculative();
      return;
    }
    if (s.phase === "error" && !s.serverId) {
      setErrorMessage(s.message ?? "Couldn't reach that server.");
      setStep("unknown_server");
      cleanupSpeculative();
      return;
    }
    if (s.serverId) {
      hashServerId(s.serverId).then((hash) => {
        if (hash !== p.serverHash) {
          setErrorMessage("This link is for a server you don't have configured.");
          setStep("unknown_server");
          cleanupSpeculative();
          return;
        }
        // Confirmed: this speculative endpoint, if any, is the real one, so stop tracking it for cleanup.
        speculativeEndpointIds.delete(epId);
        if (s.phase === "needs_grant" || s.phase === "ready") {
          setStep("peeking");
          countUnboundLocalBoards().then(setUnboundBoards);
        }
      });
    }
  });

  // Ask for the grant's details, once per connection. The server answers on
  // the socket that asked, so a reconnect while the reply is in flight loses
  // it; this runs again whenever the connection comes back up, which is the
  // recovery. peek_grant consumes no use of the grant, so asking again costs
  // nothing.
  createEffect(() => {
    const p = payload();
    const epId = endpointId();
    const s = status();
    if (!p || !epId || !s || step() !== "peeking") return;
    if (s.phase !== "needs_grant" && s.phase !== "ready") return;
    try {
      syncClient.peekGrant(epId, p.grantId, p.secret);
    } catch {
      // The connection went away between the status update and this call. The
      // next one brings this effect back around.
    }
  });

  // Receive the peek_grant / redeem_grant reply on the resolved connection.
  createEffect(() => {
    const epId = endpointId();
    if (!epId) return;
    const unsubscribe = syncClient.onGrantReply(epId, (msg) => {
      if (msg.type === "grant_info") {
        setGrantInfo({
          kind: msg.kind,
          greeting: msg.greeting ?? null,
          issuerDisplayName: msg.issuer_display_name ?? null,
          contents: msg.contents ?? null,
        });
        // A device link adds a browser with no account yet. This one has its
        // own, and the server would refuse, so say so instead of offering Join.
        if (msg.kind === "device" && alreadyRegistered()) {
          setErrorReason("already_registered");
          setErrorMessage(DEVICE_ALREADY_REGISTERED);
          setStep("error");
          return;
        }
        setStep("confirm");
      } else if (msg.type === "error") {
        setErrorReason(msg.reason ?? null);
        setErrorMessage(
          msg.reason === "already_registered" && grantInfo()?.kind === "device"
            ? DEVICE_ALREADY_REGISTERED
            : reasonMessage(msg.reason, msg.message ?? "That didn't work."),
        );
        setStep("error");
      }
    });
    onCleanup(unsubscribe);
  });

  // Success: the endpoint reaching "ready" after the join request means the
  // ok reply landed, which is redeem_grant's success path. See
  // SyncClient.onReady.
  createEffect(() => {
    if (step() !== "joining") return;
    const s = status();
    if (s?.phase === "ready") setStep("success");
  });

  // A share link names the board it is for, so watch for that one board to
  // land rather than scanning everything the first sync pulls down, then go
  // straight there. Nothing at this point needs confirming, so a landing
  // screen would only sit between the user and what the link promised.
  createEffect(() => {
    if (step() !== "success") return;
    const boardId = targetBoardId();
    if (!boardId) return;
    let navigated = false;
    const sub = liveQuery(() => db.boards.get(boardId)).subscribe((board) => {
      if (!board || navigated) return;
      navigated = true;
      setSidebarOpen(true);
      navigate(`/board/${board.id}`);
    });
    onCleanup(() => sub.unsubscribe());
  });

  const variant = (): Variant => {
    const info = grantInfo();
    if (info?.kind === "device") return "device";
    if (alreadyRegistered()) return "add";
    return info?.contents ? "shared" : "invite";
  };

  /** What the link hands over, by the name its sender gave it. */
  const offerTitle = () => grantInfo()?.greeting || "a shared list";

  /** A link to a whole group carries no board to open. */
  const isGroup = () => !targetBoardId();

  const sharer = () => grantInfo()?.issuerDisplayName ?? null;

  const sharedLine = () => {
    const name = sharer();
    if (isGroup()) {
      return name
        ? `You and ${name} share these boards, and ${name} will see that you opened them.`
        : "You'll share these boards with whoever sent the link, and they'll see that you opened them.";
    }
    return name
      ? `You and ${name} share this list, and ${name} will see that you opened it.`
      : "You'll share this list with whoever sent the link, and they'll see that you opened it.";
  };

  const doJoin = async () => {
    const p = payload();
    const epId = endpointId();
    if (!p || !epId) return;
    if (unboundBoards() > 0 && keepChoice() === "discard") {
      await discardUnboundLocalBoards();
    }
    // Every device gets a name, so none shows up unnamed in the device list.
    const label = (variant() === "device" && deviceName().trim()) || currentBrowserLabel();
    setStep("joining");
    try {
      syncClient.redeemGrant(epId, p.grantId, p.secret, { label });
    } catch {
      setErrorMessage("Lost the connection to that server before joining. Open the link again.");
      setStep("error");
    }
  };

  /** A used link can still add this browser for whoever used it, if that
   * was this person in another browser. Never offered to a browser that
   * already has an account here, which the server would refuse anyway. */
  const canAddAsExtraDevice = () => errorReason() === "used" && !alreadyRegistered();

  const doExtraDeviceJoin = () => {
    const p = payload();
    const epId = endpointId();
    if (!p || !epId) return;
    setStep("joining");
    try {
      syncClient.redeemGrant(epId, p.grantId, p.secret, { extraDevice: true, label: currentBrowserLabel() });
    } catch {
      setErrorReason(null);
      setErrorMessage("Lost the connection to that server before joining. Open the link again.");
      setStep("error");
    }
  };

  const tryManualHost = async () => {
    const host = manualHost().trim();
    if (!host) return;
    await cleanupSpeculative();
    const secure = !/^(localhost|127\.0\.0\.1)$/i.test(host);
    const id = await probeEndpoint(host, manualPort() || 443, secure);
    setEndpointId(id);
    setErrorMessage(null);
    setStep("connecting");
  };

  /** Whether to steer this join to Safari. Someone already registered here
   * has settled on this browser, so leave them be. */
  const suggestSafari = () => wrongIosBrowser !== null && !alreadyRegistered();

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => setLinkCopied(true), console.error);
  };

  const goHome = () => {
    setSidebarOpen(true);
    navigate("/");
  };

  const goBack = () => navigate(-1);

  return (
    <div class="main receive-page">
      <div class="panel receive-card">
        <Show when={step() === "invalid"}>
          <h2>This link isn't complete</h2>
          <p class="field-hint">Part of it may be missing, so try copying it again.</p>
          <button class="btn-primary" type="button" onClick={goHome}>Go home</button>
        </Show>

        <Show when={step() === "resolving" || step() === "connecting" || step() === "peeking"}>
          <div class="receive-syncing">
            <div class="spinner" />
            <div>Opening link{"\u2026"}</div>
          </div>
        </Show>

        <Show when={step() === "unknown_server"}>
          <h2>Server not found</h2>
          <p class="field-hint">{errorMessage() ?? "This link is for a server you don't have configured."}</p>
          <div class="form-field join-manual-host">
            <label class="field-label" for="join-manual-host">Host</label>
            <input id="join-manual-host" value={manualHost()} onInput={(e) => setManualHost(e.currentTarget.value)} placeholder="hostname" />
            <label class="field-label" for="join-manual-port">Port</label>
            <input id="join-manual-port" type="number" value={manualPort()} onInput={(e) => setManualPort(parseInt(e.currentTarget.value) || 443)} />
          </div>
          <div class="actions actions-center">
            <button class="btn-ghost" type="button" onClick={goHome}>Cancel</button>
            <button class="btn-primary" type="button" disabled={!manualHost().trim()} onClick={tryManualHost}>Try this host</button>
          </div>
        </Show>

        <Show when={step() === "confirm" && grantInfo()}>
          <Switch>
            <Match when={variant() === "device"}>
              <Show when={sharer()}>
                <div class="join-eyebrow">{sharer()}'s lists</div>
              </Show>
              <h2>Add this device</h2>
              <p class="field-hint">It gets all of your boards and stays in sync with your other devices.</p>
              <div class="form-field join-device-name">
                <label class="field-label" for="join-device-name">Name this device</label>
                <input
                  id="join-device-name"
                  value={deviceName()}
                  onInput={(e) => setDeviceName(e.currentTarget.value)}
                  autocomplete="off"
                />
                <div class="field-hint">Only you and whoever runs the sync server see this.</div>
              </div>
            </Match>
            <Match when={variant() === "invite"}>
              <h2>{sharer() ? `${sharer()} invited you to Listr` : "You're invited to Listr"}</h2>
              <Show when={grantInfo()!.greeting}>
                <p class="join-greeting">{grantInfo()!.greeting}</p>
              </Show>
            </Match>
            <Match when={true}>
              <div class="join-eyebrow">{sharer() ? `Shared by ${sharer()}` : "Shared with you"}</div>
              <h2 class="join-title">{offerTitle()}</h2>
              <Show when={grantInfo()!.contents}>
                {(c) => (
                  <div class="join-preview">
                    <div class="field-hint">{describeContents(c())}</div>
                    <ul class="join-preview-rows" aria-hidden="true">
                      <For each={PREVIEW_ROWS}>{(row) => <li>{row}</li>}</For>
                    </ul>
                  </div>
                )}
              </Show>
            </Match>
          </Switch>

          <Show when={unboundBoards() > 0 && variant() !== "add"}>
            <div class="form-field join-keep-choice">
              <div class="field-hint field-hint-lead">
                You already have {plural(unboundBoards(), "board")} in this browser.
              </div>
              <fieldset class="join-keep-options">
                <legend class="sr-only">What to do with the boards already in this browser</legend>
                <label class="check-label">
                  <input type="radio" name="keep-choice" checked={keepChoice() !== "discard"} onChange={() => setKeepChoice("keep")} />
                  Keep them (they stay private)
                </label>
                <label class="check-label">
                  <input type="radio" name="keep-choice" checked={keepChoice() === "discard"} onChange={() => setKeepChoice("discard")} />
                  Remove them
                </label>
              </fieldset>
            </div>
          </Show>

          <Show when={suggestSafari()}>
            <div class="join-browser-warning" role="note">
              <p>
                On iPhone, open this in Safari to add Listr to your Home Screen. Lists opened here stay
                in {wrongIosBrowser}, and a link for one person stops working once it's opened here.
              </p>
              <p class="field-hint">Copy the link, then paste it into Safari's address bar.</p>
            </div>
          </Show>

          <div class="join-actions">
            <Show when={suggestSafari()}>
              <button class="btn-primary join-open" type="button" onClick={copyLink}>
                {linkCopied() ? "Copied!" : "Copy link for Safari"}
              </button>
            </Show>
            <button class={suggestSafari() ? "btn-ghost join-accept" : "btn-primary join-open join-accept"} type="button" onClick={doJoin}>
              {suggestSafari()
                ? "Open here"
                : variant() === "device"
                  ? "Add device"
                  : variant() === "invite"
                    ? "Start using Listr"
                    : variant() === "add"
                      ? "Add to my boards"
                      : `Open ${offerTitle()}`}
            </button>
            <Show when={fromApp()}>
              <button class="btn-ghost" type="button" onClick={goBack}>Not now</button>
            </Show>
          </div>

          <p class="field-hint join-note">
            <Switch>
              <Match when={variant() === "shared"}>{sharedLine()}</Match>
              <Match when={variant() === "add"}>It will appear with your other shared boards.</Match>
              <Match when={variant() === "invite"}>
                {sharer() ? `${sharer()} will see that you joined. ` : ""}Your lists stay private until you share one.
              </Match>
            </Switch>
          </p>
        </Show>

        <Show when={step() === "joining"}>
          <div class="receive-syncing">
            <div class="spinner" />
            <div>{variant() === "device" ? "Adding this device\u2026" : variant() === "invite" ? "Setting up Listr\u2026" : `Opening ${offerTitle()}\u2026`}</div>
          </div>
        </Show>

        <Show when={step() === "success"}>
          <Show when={!targetBoardId()} fallback={
            <div class="receive-syncing">
              <div class="spinner" />
              <div>Opening {offerTitle()}{"\u2026"}</div>
              <div class="field-hint">Waiting for data from the server</div>
            </div>
          }>
            <div class="receive-saved">
              <div class="receive-saved-icon">{"\u2713"}</div>
              <div>You're in!</div>
            </div>
            <div class="actions actions-center">
              <button class="btn-primary" type="button" onClick={goHome}>Go to app</button>
            </div>
          </Show>
        </Show>

        <Show when={step() === "error"}>
          <h2>This link didn't open</h2>
          <p class="field-error" role="alert">{errorMessage()}</p>
          <Show when={canAddAsExtraDevice()}>
            <p class="field-hint">
              Was that you, in another browser, in the last few minutes? Then you can add this browser too.
            </p>
          </Show>
          <div class="actions actions-center">
            <button class="btn-ghost" type="button" onClick={goHome}>Go home</button>
            <Show when={canAddAsExtraDevice()}>
              <button class="btn-primary" type="button" onClick={() => setStep("extra_confirm")}>
                It was me, in another browser
              </button>
            </Show>
          </div>
        </Show>

        <Show when={step() === "extra_confirm"}>
          <h2>Add this browser?</h2>
          <p>
            This adds this browser to the account of whoever used this link. Only continue if that was you, in
            another browser, in the last 10 minutes.
          </p>
          <p class="field-hint">
            If someone else sent this link to several people, don't continue. Ask them for a link of your own.
            Your other browser will be told about this one.
          </p>
          <div class="actions actions-center">
            <button class="btn-ghost" type="button" onClick={() => setStep("error")}>Back</button>
            <button class="btn-primary" type="button" onClick={doExtraDeviceJoin}>Yes, that was me</button>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default JoinPage;
