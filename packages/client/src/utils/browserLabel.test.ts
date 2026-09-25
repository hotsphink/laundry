import { describe, it, expect } from "vitest";
import { browserLabel } from "./browserLabel.js";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPHONE_FIREFOX =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/142.0 Mobile/15E148 Safari/605.1.15";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.7258.76 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_FIREFOX =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/142.0 Safari/605.1.15";
const ANDROID_FIREFOX = "Mozilla/5.0 (Android 15; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0";

describe("browserLabel", () => {
  it("names the browser and platform", () => {
    expect(browserLabel(IPHONE_SAFARI, true)).toBe("Safari on iPhone");
    expect(browserLabel(IPHONE_FIREFOX, true)).toBe("Firefox on iPhone");
    expect(browserLabel(IPHONE_CHROME, true)).toBe("Chrome on iPhone");
    expect(browserLabel(IPAD_DESKTOP_FIREFOX, true)).toBe("Firefox on iPad");
    expect(browserLabel(ANDROID_FIREFOX, true)).toBe("Firefox on Android");
  });
});
