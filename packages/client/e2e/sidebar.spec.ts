import { test, expect } from "@playwright/test";
import { clearDatabase, createBoard } from "./helpers.js";

// Unpinned, as a device starts out. Other specs pin it through the config.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("collapsing sidebar on a wide screen", () => {
  test("opens beside the board, collapses after a pick, and can be pinned", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await clearDatabase(page);
    const sidebar = page.locator("#sidebar");
    const menu = page.getByRole("button", { name: "Open menu" });

    await menu.click();
    await expect(sidebar).toBeVisible();
    await createBoard(page, "First");
    await createBoard(page, "Second");

    // Picking a board collapses the sidebar.
    await page.locator(".sidebar-board", { hasText: "Second" }).click();
    await expect(sidebar).toBeHidden();
    await expect(page.locator(".page-header h1")).toHaveText("Second");

    // Open, the board beside it stays usable: no scrim covers it.
    await menu.click();
    await expect(sidebar).toBeVisible();
    await expect(page.locator(".sidebar-backdrop")).toBeHidden();
    await page.getByRole("button", { name: "+ New list" }).click();
    await expect(page.locator(".modal h2")).toHaveText("Edit List");
    await page.keyboard.press("Escape");
    await expect(sidebar).toBeVisible();

    await page.getByRole("button", { name: "Close menu" }).click();
    await expect(sidebar).toBeHidden();

    // Pinned, it stays open after a pick, and across a reload.
    await menu.click();
    await page.getByRole("button", { name: "Keep sidebar open" }).click();
    await page.locator(".sidebar-board", { hasText: "First" }).click();
    await expect(page.locator(".page-header h1")).toHaveText("First");
    await expect(sidebar).toBeVisible();
    await expect(menu).toBeHidden();
    await page.reload();
    await expect(sidebar).toBeVisible();
  });
});
