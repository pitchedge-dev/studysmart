/** Dark mode: persisted in localStorage, applied as a `dark` class on
 *  <html> (Tailwind darkMode: "class"). The layout adds the class before
 *  first paint from the same key, so there is no light flash. */

export const THEME_KEY = "studysmart-theme";

export function getTheme(): "light" | "dark" {
  try {
    return window.localStorage.getItem(THEME_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: "light" | "dark"): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable — the theme just won't persist.
  }
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function toggleTheme(): "light" | "dark" {
  const next = getTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
