import { type Component, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { serverIdentities } from "../sync/primaryConnection.js";
import { setSidebarOpen } from "../store/sidebarStore.js";

/**
 * Shown for a board URL whose board is not in this browser's database. The
 * usual cause is a URL copied from another browser, which carries no
 * credential and no data. Each browser is a separate device, so say that
 * rather than implying the board is gone.
 */
const BoardMissing: Component = () => {
  const navigate = useNavigate();
  const hasAccount = () => serverIdentities().some((i) => i.state === "active");

  const goHome = () => {
    setSidebarOpen(true);
    navigate("/");
  };

  return (
    <div class="empty-state board-missing">
      <Show
        when={hasAccount()}
        fallback={
          <>
            <h2>This board isn't on this device</h2>
            <p>
              Each browser keeps its own copy of your boards, so a board address copied from another browser
              won't open here. If this board was shared with you, open the original share link in this browser.
            </p>
          </>
        }
      >
        <h2>Board not found</h2>
        <p>It may still be syncing, or it may not be shared with this account.</p>
      </Show>
      <button class="btn-primary" type="button" onClick={goHome}>Go home</button>
    </div>
  );
};

export default BoardMissing;
