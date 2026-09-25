/**
 * A short device label such as "Safari on iPhone", so an account's device
 * list, and the notice its other devices get, can say which browser joined.
 */
export function browserLabel(ua: string, hasTouch: boolean): string {
  const browser =
    /FxiOS\/|Firefox\//.test(ua) ? "Firefox"
    : /EdgiOS\/|Edg\//.test(ua) ? "Edge"
    : /CriOS\/|Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Browser";
  const platform =
    /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && hasTouch) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Macintosh/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : null;
  return platform ? `${browser} on ${platform}` : browser;
}

/** browserLabel for the running page. */
export function currentBrowserLabel(): string {
  return browserLabel(navigator.userAgent, "ontouchstart" in window);
}
