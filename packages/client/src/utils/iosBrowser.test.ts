import { describe, it, expect } from "vitest";
import { nonSafariIosBrowser } from "./iosBrowser.js";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPHONE_FIREFOX =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/142.0 Mobile/15E148 Safari/605.1.15";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.7258.76 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_FIREFOX =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/142.0 Safari/605.1.15";
const ANDROID_FIREFOX = "Mozilla/5.0 (Android 15; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0";
const ANDROID_GOOGLE_APP =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/139.0 Mobile Safari/537.36 GSA/16.0";

describe("nonSafariIosBrowser", () => {
  it("names third-party iOS browsers", () => {
    expect(nonSafariIosBrowser(IPHONE_FIREFOX, true)).toBe("Firefox");
    expect(nonSafariIosBrowser(IPHONE_CHROME, true)).toBe("Chrome");
  });

  it("returns null for Safari", () => {
    expect(nonSafariIosBrowser(IPHONE_SAFARI, true)).toBeNull();
  });

  it("treats a touch Mac UA as iPadOS", () => {
    expect(nonSafariIosBrowser(IPAD_DESKTOP_FIREFOX, true)).toBe("Firefox");
    expect(nonSafariIosBrowser(IPAD_DESKTOP_FIREFOX, false)).toBeNull();
  });

  it("ignores other platforms, even with an iOS-looking token", () => {
    expect(nonSafariIosBrowser(ANDROID_FIREFOX, true)).toBeNull();
    expect(nonSafariIosBrowser(ANDROID_GOOGLE_APP, true)).toBeNull();
  });
});
