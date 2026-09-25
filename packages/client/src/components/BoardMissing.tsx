import { type Component, createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { serverIdentities } from "../sync/primaryConnection.js";
import { setSidebarOpen } from "../store/sidebarStore.js";
import JoinLinkModal from "./JoinLinkModal.js";

/**
 * Shown for a board URL whose board is not in this browser's database. The
 * usual cause is a URL copied from another browser, which carries no
 * credential and no data. Each browser is a separate device, so say that
 * rather than implying the board is gone.
 */
const BoardMissing: Component = () => {
  const navigate = useNavigate();
  const hasAccount = () => serverIdentities().some((i) => i.state === "active");
  const [joinOpen, setJoinOpen] = createSignal(false);

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
            <p>You can also paste or scan that link here, even if you already joined with it somewhere else.</p>
          </>
        }
      >
        <h2>Board not found</h2>
        <p>It may still be syncing, or it may not be shared with this account.</p>
      </Show>
      <div class="actions actions-center">
        <button class={hasAccount() ? "btn-primary" : "btn-ghost"} type="button" onClick={goHome}>Go home</button>
        <Show when={!hasAccount()}>
          <button class="btn-primary" type="button" onClick={() => setJoinOpen(true)}>Join with a link</button>
        </Show>
      </div>
      <JoinLinkModal open={joinOpen()} onClose={() => setJoinOpen(false)} />
    </div>
  );
};

export default BoardMissing;
