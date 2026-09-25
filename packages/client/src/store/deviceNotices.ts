import { createSignal } from "solid-js";

/**
 * Browsers added to this account by reusing a spent invite link. The server
 * reports them live (`device_added`) and again in every `ok` for a week, so a
 * device that was offline still hears. Dismissals are remembered per browser,
 * so each notice shows once. Losing that memory only means seeing one again.
 */
export interface DeviceNotice {
  client_id: string;
  label: string | null;
  at: number;
}

const STORAGE_KEY = "dismissed-device-notices";

function loadDismissed(): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

const dismissed = loadDismissed();
const [deviceNotices, setDeviceNotices] = createSignal<DeviceNotice[]>([]);

export { deviceNotices };

export function addDeviceNotices(incoming: DeviceNotice[]): void {
  const current = deviceNotices();
  const fresh = incoming.filter(
    (n) => typeof n?.client_id === "string" && !dismissed.has(n.client_id) && !current.some((c) => c.client_id === n.client_id),
  );
  if (fresh.length) setDeviceNotices([...current, ...fresh]);
}

export function dismissDeviceNotice(clientId: string): void {
  dismissed.add(clientId);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
  } catch {
    // Storage unavailable: the notice may come back next session.
  }
  setDeviceNotices(deviceNotices().filter((n) => n.client_id !== clientId));
}
