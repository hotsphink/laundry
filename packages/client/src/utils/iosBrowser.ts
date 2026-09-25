/**
 * Detect an iOS browser other than Safari. On iOS, each browser keeps its own
 * storage, and a Home Screen app is installed from Safari. So a join link
 * redeemed in, say, Firefox leaves the account and boards in Firefox, out of
 * reach of the app the user probably wants.
 */

/** UA token -> the name to show. First match wins. */
const NON_SAFARI_TOKENS: [RegExp, string][] = [
  [/FxiOS\//, "Firefox"],
  [/CriOS\//, "Chrome"],
  [/EdgiOS\//, "Edge"],
  [/OPiOS\/|OPT\//, "Opera"],
  [/DuckDuckGo\/|Ddg\//, "DuckDuckGo"],
  [/GSA\//, "the Google app"],
  [/FBAN\/|FBAV\//, "Facebook"],
  [/Instagram/, "Instagram"],
];

/** Whether the UA is an iPhone, iPod or iPad. iPadOS reports a Mac UA by
 * default, so a Mac UA on a touch device counts too. */
export function isIos(ua: string, hasTouch: boolean): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && hasTouch);
}

/** The display name of the non-Safari iOS browser `ua` belongs to, or null
 * for Safari, a non-iOS platform, or an unrecognized browser. */
export function nonSafariIosBrowser(ua: string, hasTouch: boolean): string | null {
  if (!isIos(ua, hasTouch)) return null;
  for (const [re, name] of NON_SAFARI_TOKENS) {
    if (re.test(ua)) return name;
  }
  return null;
}

/** nonSafariIosBrowser for the running page. */
export function currentNonSafariIosBrowser(): string | null {
  if (typeof navigator === "undefined") return null;
  return nonSafariIosBrowser(navigator.userAgent, typeof window !== "undefined" && "ontouchstart" in window);
}
