import { test, expect, type Page } from "@playwright/test";
import { clearDatabase, createBoard, createListInBoard, addItemToList } from "./helpers.js";

const titles = (page: Page) =>
  page.locator(".list-view-item:not(.inline-add-item) .formatted-text");

async function setFinished(page: Page, label: string) {
  await page.getByRole("button", { name: "Actions for list Chores" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const modal = page.locator(".modal");
  await modal.getByLabel("Finished items").selectOption({ label });
  await modal.getByRole("button", { name: "Save" }).click();
  await modal.waitFor({ state: "hidden" });
}

test("finished items can move to the end or hide without changing the shared order", async ({ page }) => {
  await clearDatabase(page);
  await createBoard(page, "Home", [{ key: "todo", label: "Todo", type: "todo" }], "[title]");
  await createListInBoard(page, "Chores", "Home");
  for (const t of ["Dishes", "Laundry", "Trash"]) await addItemToList(page, t);
  await expect(titles(page)).toHaveText(["Dishes", "Laundry", "Trash"]);

  await page.getByRole("button", { name: /^Dishes: .*toggle done/ }).click();
  await expect(page.locator(".list-view-item.todo-done")).toHaveCount(1);

  await setFinished(page, "At the end");
  await expect(titles(page)).toHaveText(["Laundry", "Trash", "Dishes"]);

  // Drag Trash to the top of the open section.
  const handle = page.locator(".list-view-item").filter({ hasText: "Trash" }).locator(".drag-handle");
  const hb = (await handle.boundingBox())!;
  const tb = (await page.locator(".list-view-item").filter({ hasText: "Laundry" }).boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - 4, { steps: 3 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 2, { steps: 12 });
  await page.mouse.up();
  await expect(titles(page)).toHaveText(["Trash", "Laundry", "Dishes"]);

  // The setting survives a reload.
  await page.reload();
  await expect(titles(page)).toHaveText(["Trash", "Laundry", "Dishes"]);

  // In place, Trash sits just before Laundry and after the finished Dishes.
  await setFinished(page, "In place");
  await expect(titles(page)).toHaveText(["Dishes", "Trash", "Laundry"]);

  await setFinished(page, "Hidden");
  await expect(titles(page)).toHaveText(["Trash", "Laundry"]);
});
