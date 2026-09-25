import { test, expect } from "@playwright/test";
import { clearDatabase, setDefaultSyncKey } from "./helpers.js";

/**
 * A board URL with no board behind it. The common way to get here is copying
 * the address out of one browser into another, such as Firefox to Safari on
 * iOS to install the app. The URL carries no credential, so the page has to
 * explain that rather than just say the board is gone.
 */

const MISSING_BOARD = "/#/board/00000000-0000-4000-8000-000000000000";

test.describe("missing board", () => {
  test("a browser with no account explains that boards are per browser", async ({ page }) => {
    await clearDatabase(page);
    await page.goto(MISSING_BOARD);

    await expect(page.locator(".board-missing h2")).toHaveText("This board isn't on this device");
    await expect(page.locator(".board-missing")).toContainText("open the original share link in this browser");

    await page.getByRole("button", { name: "Go home" }).click();
    await expect(page).not.toHaveURL(/#\/board\//);
  });

  test("a browser with an account says the board may be syncing or not shared", async ({ page }) => {
    await clearDatabase(page);
    await setDefaultSyncKey(page, "e2e-missing-board-home");
    // The helper writes around Dexie, so reload for liveQuery to see it.
    await page.goto(MISSING_BOARD);
    await page.reload();

    await expect(page.locator(".board-missing h2")).toHaveText("Board not found");
    await expect(page.locator(".board-missing")).toContainText("not be shared with this account");
  });
});
