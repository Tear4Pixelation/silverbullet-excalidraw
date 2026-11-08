// Theme resolution for all modes (widget, document editor, fullscreen modal).
//
// SilverBullet v2's source of truth is `<html data-theme="dark|light">` on the host
// page. All iframes the plug runs in (code widgets, panels/modals, document editors)
// are same-origin, so the host element can be read and observed directly. The iframe's
// own `data-theme` is a fallback: SB only pushes live updates to panels, and the
// document editor's live `set-theme` message is computed from `uiOptions.darkMode`,
// which is `undefined` (=> "light") when SB follows the OS preference.
//
// Fallback chain: explicit override -> host data-theme -> iframe data-theme
//                 -> clientStore darkMode -> prefers-color-scheme.

export type ThemeName = "dark" | "light";

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function normalizeTheme(value: unknown): ThemeName | undefined {
  if (typeof value !== "string") return undefined;
  const lowered = value.trim().toLowerCase();
  return lowered === "dark" || lowered === "light" ? lowered : undefined;
}

// Host <html> first (if reachable), then this iframe's own <html>.
function themeElements(): HTMLElement[] {
  const elements: HTMLElement[] = [];
  try {
    if (window.parent && window.parent !== window) {
      elements.push(window.parent.document.documentElement);
    }
  } catch {
    // cross-origin parent: fall back to our own document
  }
  elements.push(document.documentElement);
  return elements;
}

export function resolveSpaceTheme(storeTheme?: unknown): ThemeName {
  for (const element of themeElements()) {
    const domTheme = normalizeTheme(element.getAttribute("data-theme"));
    if (domTheme) return domTheme;
  }
  const clientStoreTheme = normalizeTheme(storeTheme);
  if (clientStoreTheme) return clientStoreTheme;
  return window.matchMedia?.(DARK_SCHEME_QUERY).matches ? "dark" : "light";
}

// Calls `onChange` only when SB's resolved theme actually changes, so a manual
// in-editor theme toggle is not overridden by unrelated mutations.
// Stops by itself once `rootElement` is detached (pooled widget iframes are reused).
export function watchSpaceTheme(
  rootElement: HTMLElement,
  onChange: (theme: ThemeName) => void,
  initialTheme?: string,
  storeTheme?: unknown
): () => void {
  // Seeded with the theme the diagram was loaded with, so a change that happened
  // while the file was being read is applied right away (see handleChange() below).
  let lastTheme: string = initialTheme ?? resolveSpaceTheme(storeTheme);
  const observers: MutationObserver[] = [];
  const mediaQuery = window.matchMedia?.(DARK_SCHEME_QUERY);

  const stop = () => {
    observers.forEach((observer) => observer.disconnect());
    mediaQuery?.removeEventListener?.("change", handleChange);
  };

  function handleChange() {
    if (!rootElement.isConnected) {
      stop();
      return;
    }
    const currentTheme = resolveSpaceTheme(storeTheme);
    if (currentTheme === lastTheme) return;
    lastTheme = currentTheme;
    try {
      onChange(currentTheme);
    } catch (error) {
      console.error("Excalidraw: failed to apply theme", error);
    }
  }

  for (const element of themeElements()) {
    const observer = new MutationObserver(handleChange);
    observer.observe(element, { attributes: true, attributeFilter: ["data-theme"] });
    observers.push(observer);
  }
  mediaQuery?.addEventListener?.("change", handleChange);
  handleChange();
  return stop;
}
