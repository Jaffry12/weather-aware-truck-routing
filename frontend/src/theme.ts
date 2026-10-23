export type Theme = "light" | "dark";

const STORAGE_KEY = "wtr-theme";

/** The theme index.html already applied before first paint (saved choice, else the system setting). */
export const initialTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the choice just won't persist.
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b1220" : "#f5f7fb");
}
