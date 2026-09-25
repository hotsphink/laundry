import { type Component, For } from "solid-js";
import { A } from "@solidjs/router";
import { deviceNotices, dismissDeviceNotice } from "../store/deviceNotices.js";

/** Tell this device that another browser joined its account by reusing a
 * spent invite link, so an unexpected one does not go unnoticed. */
const DeviceNotices: Component = () => (
  <For each={deviceNotices()}>
    {(notice) => (
      <div class="device-notice" role="status">
        <p>
          <strong>{notice.label ?? "A new browser"}</strong> was added to your account at{" "}
          {new Date(notice.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}, using the invite link
          you joined with. If that wasn't you, tell whoever sent you the link. Your devices are listed
          in <A href="/admin">Admin</A>.
        </p>
        <button class="btn-ghost btn-xs" type="button" onClick={() => dismissDeviceNotice(notice.client_id)}>
          Dismiss
        </button>
      </div>
    )}
  </For>
);

export default DeviceNotices;
