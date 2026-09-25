import { test, expect } from "@playwright/test";
import { addSyncEndpoint, clearDatabase, readStore } from "./helpers.js";
import { startTestSyncServer, type TestSyncServer } from "./syncServer.js";

/**
 * The guest-link path (auth-design.md 7), end to end against a real sync
 * server: a texted URL, a browser with no identity and no configured endpoint,
 * and a rendered result. It is the flow with the most first-run state in the
 * app, and none of it can be exercised client-only, since peek_grant,
 * redeem_grant and the resulting `ok` are all WebSocket round trips.
 *
 * These run serially and share one throwaway server (syncServer.ts), because
 * standing one up costs a couple of seconds and every test here wants the same
 * one. Each test still gets its own browser context, so the client side is
 * always cold unless a test deliberately seeds it.
 *
 * Regression coverage this exists for: reaching `needs_grant` writes
 * server_identity, and that write used to reconnect every endpoint, killing the
 * connection JoinPage had just sent peek_grant on. The reply was dropped and
 * the join screen hung on "Looking up your invite" forever. Any test here that
 * gets past the invite screen would have caught it.
 */

const GUEST_KEY_COLD = "e2e-guest-key-cold";
const GUEST_KEY_WARM = "e2e-guest-key-warm";
const SHARE_KEY = "e2e-share-key";
const GUEST_KEY_IOS = "e2e-guest-key-ios";
const GUEST_KEY_EXTRA = "e2e-guest-key-extra";

test.describe.configure({ mode: "serial" });

let server: TestSyncServer;
/** Spent by the warm-client test, then reused to check single-use. */
let spentGuestLink = "";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await startTestSyncServer();
});

test.afterAll(async () => {
  await server?.stop();
});

test.describe("guest links", () => {
  test("a cold client offers to add a host, then joins and adopts the shared key", async ({ page }) => {
    // The cold path probes the baked-in default endpoint first, which is not
    // this throwaway server, so allow for that round trip (or its 10s connect
    // timeout when the default is unreachable) before the host prompt appears.
    test.setTimeout(90_000);
    const link = server.issueGrant({
      kind: "guest",
      payload: GUEST_KEY_COLD,
      greeting: "Dad's shopping list",
    });

    await clearDatabase(page);
    await page.goto(link);

    // Nothing configured and the default is a different server, so this is
    // 7.3 a-bis's third outcome: say the server is unknown, offer a host.
    await expect(page.locator(".receive-card h2")).toHaveText("Server not found", { timeout: 40_000 });
    await page.locator(".join-manual-host input").first().fill("localhost");
    await page.locator('.join-manual-host input[type="number"]').fill(String(server.port));
    await page.getByRole("button", { name: "Try this host" }).click();

    await expect(page.locator(".receive-card h2")).toHaveText("You're invited", { timeout: 30_000 });
    await expect(page.locator(".offer-name")).toContainText("Dad's shopping list");

    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.locator(".receive-saved")).toContainText("You're in!", { timeout: 30_000 });

    // Redeeming the grant is only half of it: the payload key is what makes
    // the shared list reachable, rather than just creating an account.
    const keys = await readStore<{ key: string }>(page, "shared_keys");
    expect(keys.map((k) => k.key)).toContain(GUEST_KEY_COLD);

    // The route that worked is kept, with the server it turned out to be, so
    // the next link for this server needs no prompt at all.
    const endpoints = await readStore<{ host: string; port: number; last_server_id: string }>(page, "sync_endpoints");
    expect(endpoints).toContainEqual(
      expect.objectContaining({ host: "localhost", port: server.port, last_server_id: server.serverId }),
    );
  });

  test("a client that already knows the server joins with no host prompt, and a share link then adds a second key", async ({ page }) => {
    test.setTimeout(90_000);
    const guestLink = server.issueGrant({ kind: "guest", payload: GUEST_KEY_WARM, greeting: "Groceries" });
    spentGuestLink = guestLink;

    await clearDatabase(page);
    await addSyncEndpoint(page, {
      host: "localhost",
      port: server.port,
      secure: false,
      lastServerId: server.serverId,
    });
    await page.goto(guestLink);

    // 7.3 a-bis's second outcome: the link names an identity this client can
    // already resolve to a route of its own, so it is never asked for a host.
    await expect(page.locator(".receive-card h2")).toHaveText("You're invited", { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Try this host" })).toHaveCount(0);
    await expect(page.locator(".join-browser-warning")).toHaveCount(0);
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.locator(".receive-saved")).toContainText("You're in!", { timeout: 30_000 });

    // A share grant hands one more key to a user who already exists, so this
    // one is redeemed on a connection that is already `ready` rather than one
    // parked in needs_grant.
    const shareLink = server.issueGrant({ kind: "share", payload: SHARE_KEY, greeting: "Packing list" });
    await page.goto(shareLink);
    await expect(page.locator(".receive-card h2")).toHaveText("You're invited", { timeout: 30_000 });
    await expect(page.locator(".offer-name")).toContainText("Packing list");
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.locator(".receive-saved")).toContainText("You're in!", { timeout: 30_000 });

    const keys = await readStore<{ key: string }>(page, "shared_keys");
    expect(keys.map((k) => k.key)).toEqual(expect.arrayContaining([GUEST_KEY_WARM, SHARE_KEY]));
  });

  // On iOS, a join in Firefox strands the account in Firefox, where Safari,
  // the only browser that installs the app, cannot see it.
  test("an iOS browser other than Safari suggests Safari before joining", async ({ browser }) => {
    test.setTimeout(90_000);
    const link = server.issueGrant({ kind: "guest", payload: GUEST_KEY_IOS, greeting: "Chores" });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/142.0 Mobile/15E148 Safari/605.1.15",
    });
    try {
      const page = await context.newPage();
      await clearDatabase(page);
      await addSyncEndpoint(page, {
        host: "localhost",
        port: server.port,
        secure: false,
        lastServerId: server.serverId,
      });
      await page.goto(link);

      await expect(page.locator(".receive-card h2")).toHaveText("You're invited", { timeout: 30_000 });
      await expect(page.locator(".join-browser-warning")).toContainText("Open this link in Safari instead");
      await expect(page.locator(".join-browser-warning")).toContainText("in Firefox");
      await expect(page.getByRole("button", { name: "Copy link for Safari" })).toBeVisible();

      // Still possible to join here, for someone who means to.
      await page.getByRole("button", { name: "Join here anyway" }).click();
      await expect(page.locator(".receive-saved")).toContainText("You're in!", { timeout: 30_000 });
    } finally {
      await context.close();
    }
  });

  // Joined in one browser, then opened the app in another, the way an iPhone
  // user moves from Firefox to Safari to install it. The second browser
  // pastes the spent link on the missing-board page, says it already joined,
  // and lands on the same account. The first browser is told.
  test("a spent link adds a second browser to the account that spent it", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const link = server.issueGrant({ kind: "guest", payload: GUEST_KEY_EXTRA, greeting: "Errands" });
    const route = { host: "localhost", port: server.port, secure: false, lastServerId: server.serverId };

    await clearDatabase(page);
    await addSyncEndpoint(page, route);
    await page.goto(link);
    await expect(page.locator(".receive-card h2")).toHaveText("You're invited", { timeout: 30_000 });
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.locator(".receive-saved")).toContainText("You're in!", { timeout: 30_000 });
    await page.getByRole("button", { name: "Go to app" }).click();
    const [firstIdentity] = await readStore<{ user_id: string }>(page, "server_identity");

    const secondContext = await browser.newContext();
    try {
      const second = await secondContext.newPage();
      await clearDatabase(second);
      await addSyncEndpoint(second, route);
      // The URL that gets copied between browsers: a board, with nothing behind it here.
      await second.goto("/#/board/00000000-0000-4000-8000-000000000000");
      await second.getByRole("button", { name: "Join with a link" }).click();
      await second.locator("#join-link-input").fill(`${new URL(second.url()).origin}${link}`);
      await second.getByRole("button", { name: "Use" }).click();

      await expect(second.locator(".receive-card h2")).toHaveText("Couldn't join", { timeout: 30_000 });
      await expect(second.locator(".field-error")).toHaveText("This link has already been used.");
      await second.getByRole("button", { name: "I already joined in another browser" }).click();
      await expect(second.locator(".receive-card h2")).toHaveText("Add this browser?");
      await second.getByRole("button", { name: "Yes, that was me" }).click();
      await expect(second.locator(".receive-saved")).toContainText("You're in!", { timeout: 30_000 });

      const [secondIdentity] = await readStore<{ user_id: string }>(second, "server_identity");
      expect(secondIdentity.user_id).toBe(firstIdentity.user_id);
      const keys = await readStore<{ key: string }>(second, "shared_keys");
      expect(keys.map((k) => k.key)).toContain(GUEST_KEY_EXTRA);

      // The first browser, still connected, hears about it right away.
      await expect(page.locator(".device-notice")).toContainText("was added to your account", { timeout: 30_000 });
      await page.locator(".device-notice").getByRole("button", { name: "Dismiss" }).click();
      await expect(page.locator(".device-notice")).toHaveCount(0);
    } finally {
      await secondContext.close();
    }
  });

  // A device link cannot move a browser off the account it already has, so
  // the join screen says so instead of offering a Join the server refuses.
  test("a browser with its own account is told a device link can't add it", async ({ page }) => {
    test.setTimeout(90_000);
    const guestLink = server.issueGrant({ kind: "guest", payload: "e2e-guest-key-device", greeting: "Mine" });
    await clearDatabase(page);
    await addSyncEndpoint(page, { host: "localhost", port: server.port, secure: false, lastServerId: server.serverId });
    await page.goto(guestLink);
    await expect(page.locator(".receive-card h2")).toHaveText("You're invited", { timeout: 30_000 });
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.locator(".receive-saved")).toContainText("You're in!", { timeout: 30_000 });

    await page.goto(server.issueGrant({ kind: "device" }));
    await expect(page.locator(".receive-card h2")).toHaveText("Couldn't join", { timeout: 30_000 });
    await expect(page.locator(".field-error")).toContainText("already has its own account");
    await expect(page.getByRole("button", { name: "I already joined in another browser" })).toHaveCount(0);
  });

  test("a guest link that someone else already used fails with a message saying so", async ({ page }) => {
    test.setTimeout(90_000);
    expect(spentGuestLink, "the previous test should have spent a guest link").not.toBe("");

    await clearDatabase(page);
    await addSyncEndpoint(page, {
      host: "localhost",
      port: server.port,
      secure: false,
      lastServerId: server.serverId,
    });
    await page.goto(spentGuestLink);

    // uses_remaining is the security control the 24h TTL deliberately leaves
    // to it (7.3b), and being told plainly is what makes it tamper-evident.
    await expect(page.locator(".receive-card h2")).toHaveText("Couldn't join", { timeout: 30_000 });
    await expect(page.locator(".field-error")).toHaveText("This link has already been used.");
  });
});
