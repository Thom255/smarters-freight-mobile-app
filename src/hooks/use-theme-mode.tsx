/**
 * Theme mode preference: 'system' follows the OS, or the user can pin
 * light/dark. The choice is persisted and drives every themed component.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { getItem, setItem } from '@/lib/storage';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'smarters.themeMode';

export type ThemeModeValue = {
  /** The user's choice. */
  mode: ThemeMode;
  /** The concrete scheme in use right now. */
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => Promise<void>;
};

const ThemeModeContext = createContext<ThemeModeValue | null>(null);

function resolve(scheme: string | null | undefined, mode: ThemeMode): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return scheme === 'dark' ? 'dark' : 'light';
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    let active = true;

    getItem(STORAGE_KEY)
      .then((value) => {
        if (active && isThemeMode(value)) {
          setModeState(value);
        }
      })
      .catch(() => {
        // Unreadable storage — keep the 'system' default.
      });

    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback(async (next: ThemeMode) => {
    setModeState(next);
    await setItem(STORAGE_KEY, next);
  }, []);

  const resolved = resolve(systemScheme, mode);

  const value = useMemo<ThemeModeValue>(
    () => ({ mode, resolved, setMode }),
    [mode, resolved, setMode],
  );

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

/**
 * Reads the current theme mode. Falls back to the OS scheme when used
 * outside a `ThemeModeProvider`.
 */
export function useThemeMode(): ThemeModeValue {
  const context = useContext(ThemeModeContext);
  const systemScheme = useColorScheme();

  const fallback = useMemo<ThemeModeValue>(
    () => ({
      mode: 'system',
      resolved: resolve(systemScheme, 'system'),
      setMode: async () => {},
    }),
    [systemScheme],
  );

  return context ?? fallback;
}
