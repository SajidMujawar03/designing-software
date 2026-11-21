import { Monitor, Moon, Sun } from 'lucide-react';
import { nextTheme, setTheme, themeLabel, useTheme } from '../theme';

/** Cycles the app theme: light, dark, match the system. */
export function ThemeSwitch({ className = '', role }: { className?: string; role?: string }) {
  const choice = useTheme((s) => s.choice);
  const Icon = choice === 'light' ? Sun : choice === 'dark' ? Moon : Monitor;
  return (
    <button
      type="button"
      role={role}
      className={className}
      title={`Theme: ${themeLabel(choice)} (click to change)`}
      aria-label={`Theme: ${themeLabel(choice)}. Change theme`}
      onClick={() => setTheme(nextTheme(choice))}
    >
      <Icon size={12} /> Theme: {themeLabel(choice)}
    </button>
  );
}
