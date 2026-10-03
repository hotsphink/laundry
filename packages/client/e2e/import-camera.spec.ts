import { test, expect } from "@playwright/test";
import { clearDatabase, createBoard, setupSyncConfig, mockImportRoute } from "./helpers.js";

// Firefox's fake camera, granted without a prompt.
test.use({
  launchOptions: {
    firefoxUserPrefs: {
      "media.navigator.streams.fake": true,
      "media.navigator.permission.disabled": true,
    },
  },
});

test.describe("import camera", () => {
  test.beforeEach(async ({ page }) => {
    await clearDatabase(page);
  });

  test("a device without touch takes the import photo from a live camera view", async ({ page }) => {
    await createBoard(page, "Movies");
    await setupSyncConfig(page);
    await mockImportRoute(page, {
      boards: [{ name: "Movies", lists: [{ name: "Watchlist", items: [{ title: "Inception" }] }] }],
    });
    // Routes run newest first, so this sees the upload before the mock answers it.
    let uploaded = "";
    await page.route("**/api/import", (route) => {
      uploaded = route.request().postData() ?? "";
      return route.fallback();
    });

    await page.locator(".sidebar-item", { hasText: "Import" }).click();
    const modal = page.locator(".modal");
    await modal.getByRole("button", { name: "Take photo" }).click();
    await expect(modal.locator(".import-dropzone")).toBeHidden();
    const shutter = modal.getByRole("button", { name: "Take photo" });
    await expect(shutter).toBeEnabled();
    await shutter.click();

    await expect(modal.locator(".import-preview")).toBeVisible({ timeout: 10_000 });
    expect(uploaded).toContain("image/jpeg");
    await expect(modal.getByLabel("Camera preview")).toHaveCount(0);
  });

  test("cancelling the camera returns to the drop zone", async ({ page }) => {
    await createBoard(page, "Movies");
    await page.locator(".sidebar-item", { hasText: "Import" }).click();
    const modal = page.locator(".modal");
    await modal.getByRole("button", { name: "Take photo" }).click();
    await expect(modal.getByLabel("Camera preview")).toBeVisible();
    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal.locator(".import-dropzone")).toBeVisible();
    await expect(modal.getByLabel("Camera preview")).toHaveCount(0);
  });
});
