import { create } from 'zustand';

/** The app's color theme: light, dark, or following the system setting. */
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'figma-clone:theme';

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export const useTheme = create<{ choice: ThemeChoice }>(() => ({ choice: read() }));

/** Applies the theme to the page (CSS variables switch on data-theme). */
export function applyTheme(choice = useTheme.getState().choice): void {
  document.documentElement.dataset.theme = choice;
}

export function setTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // storage unavailable: applies for this session
  }
  useTheme.setState({ choice });
  applyTheme(choice);
}

/** Whether the app is showing dark colors right now. */
export function isDark(): boolean {
  const c = useTheme.getState().choice;
  return c === 'dark' || (c === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/** Light → dark → system → light. */
export const nextTheme = (c: ThemeChoice): ThemeChoice => (c === 'light' ? 'dark' : c === 'dark' ? 'system' : 'light');
export const themeLabel = (c: ThemeChoice) => (c === 'light' ? 'Light' : c === 'dark' ? 'Dark' : 'System');
