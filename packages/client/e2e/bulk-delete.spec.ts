import { test, expect } from "@playwright/test";
import { clearDatabase, createBoard, createListInBoard, addItemToList, readStore } from "./helpers.js";

test("deleting more than three selected items keeps the survivors in order", async ({ page }) => {
  await clearDatabase(page);
  await createBoard(page, "Chores");
  await createListInBoard(page, "Today", "Chores");
  const titles = ["a", "b", "c", "d", "e", "f", "g"];
  for (const t of titles) await addItemToList(page, t);

  const rows = page.locator(".list-view-item:not(.inline-add-item)");
  const texts = rows.locator(".formatted-text");
  await expect(rows).toHaveCount(7);
  for (const t of ["a", "c", "d", "g"]) {
    await rows.filter({ has: page.getByText(t, { exact: true }) }).focus();
    await page.keyboard.press(" ");
  }
  await expect(rows.and(page.locator(".selected"))).toHaveCount(4);

  page.once("dialog", (d) => d.accept());
  await rows.filter({ has: page.getByText("g", { exact: true }) }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete 4 items" }).click();
  await expect(texts).toHaveText(["b", "e", "f"]);

  const tombstones = await readStore<{ entity_id: string }>(page, "tombstones");
  expect(tombstones).toHaveLength(4);
  await page.reload();
  await expect(texts).toHaveText(["b", "e", "f"]);
});
