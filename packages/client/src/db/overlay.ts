import { computeOverlay, orderResults, withOverlay, type Board, type Item } from "@listr/shared";
import { db } from "./database.js";
import { boardAttributeMaps } from "../utils/integrationConfig.js";

/** The items as readers see them, with the board's integration values overlaid. */
export async function itemsWithOverlay(board: Pick<Board, "integrations" | "schema">, items: Item[]): Promise<Item[]> {
  if (!items.length) return items;
  const results = await db.integration_results.where("item_id").anyOf(items.map((i) => i.id)).toArray();
  if (!results.length) return items;
  const maps = boardAttributeMaps(board);
  return items.map((item) => {
    const own = orderResults(results.filter((r) => r.item_id === item.id), board.integrations);
    return withOverlay(item, computeOverlay(item, own, board.schema, maps));
  });
}
