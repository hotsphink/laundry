import { test, expect } from "@playwright/test";
import { clearDatabase, createBoard, createListInBoard } from "./helpers.js";

/**
 * The installed app always launches at "/", which used to open the first
 * board every time. A restart should come back to the board and list this
 * device was showing.
 */

test.describe("last viewed", () => {
  test("a restart returns to the last board, scrolled to the list that was in view", async ({ page }) => {
    await clearDatabase(page);
    await createBoard(page, "First");
    await createBoard(page, "Second");
    for (const name of ["L1", "L2", "L3", "L4", "L5", "L6"]) {
      await createListInBoard(page, name, "Second");
    }

    const view = page.locator(".multi-list-view");
    const l5 = page.locator(".multi-list-column", { hasText: "L5" });
    await l5.evaluate((el) => el.scrollIntoView({ behavior: "instant", inline: "start", block: "nearest" }));
    // Let snapping settle and the debounced save run.
    await page.waitForTimeout(600);
    const before = await view.evaluate((el) => el.scrollLeft);
    expect(before).toBeGreaterThan(0);

    // A restart: the app opens at "/" with nothing in the URL.
    await page.goto("/");
    await page.reload();

    await expect(page.locator(".page-title h1")).toHaveText("Second");
    await expect(page.locator(".multi-list-column", { hasText: "L6" })).toBeVisible();
    await expect.poll(() => view.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    // L5 sits at the start of the view, with L1 scrolled off to the left.
    const viewBox = (await view.boundingBox())!;
    const l1Box = (await page.locator(".multi-list-column", { hasText: "L1" }).boundingBox())!;
    const l5Box = (await l5.boundingBox())!;
    expect(l1Box.x + l1Box.width).toBeLessThanOrEqual(viewBox.x + 1);
    expect(l5Box.x).toBeGreaterThanOrEqual(viewBox.x - 1);
    expect(l5Box.x).toBeLessThan(viewBox.x + l5Box.width / 2);
  });

  test("a remembered board that no longer exists falls back to the first board", async ({ page }) => {
    await clearDatabase(page);
    await createBoard(page, "First");
    await createBoard(page, "Second");
    await page.locator(".sidebar-board", { hasText: "Second" }).click();
    await expect(page.locator(".page-title h1")).toHaveText("Second");

    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("last-viewed") ?? "{}");
      localStorage.setItem("last-viewed", JSON.stringify({ ...state, boardId: "gone" }));
    });
    await page.goto("/");
    await page.reload();
    await expect(page.locator(".page-title h1")).toHaveText("First");
  });
});
