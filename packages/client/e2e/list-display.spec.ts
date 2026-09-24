import { test, expect } from "@playwright/test";
import { clearDatabase, createBoard, createListInBoard, addItemViaModal, readStore } from "./helpers.js";

test("the list header toggles brief and verbose display", async ({ page }) => {
  await clearDatabase(page);
  await createBoard(page, "Movies", [{ key: "genre", label: "Genre" }],
    "[title][more]\n\nmore=if @list.display == \"verbose\": \" ([genre])\" end");
  await createListInBoard(page, "Watch", "Movies");
  await addItemViaModal(page, "Inception", async (modal) => {
    await modal.locator(".form-field").nth(1).locator("input").fill("sci-fi");
  });

  const text = page.locator(".list-view-item:not(.inline-add-item) .formatted-text").first();
  const toggle = page.getByRole("button", { name: "Verbose display for Watch" });
  await expect(text).toHaveText("Inception");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await expect(text).toHaveText("Inception (sci-fi)");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const lists = await readStore<{ attributes?: Record<string, unknown> }>(page, "lists");
  expect(lists[0].attributes).toEqual({ display: "verbose" });

  await page.reload();
  await expect(text).toHaveText("Inception (sci-fi)");
  await page.getByRole("button", { name: "Verbose display for Watch" }).click();
  await expect(text).toHaveText("Inception");
});
