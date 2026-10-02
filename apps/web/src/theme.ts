import { useState } from 'react';

/** El tema de la web: el del sistema, o claro u oscuro fijado a mano. */
export type Theme = 'system' | 'light' | 'dark';

export const THEME_LABELS: Record<Theme, string> = {
  system: 'el del sistema',
  light: 'claro',
  dark: 'oscuro',
};

const KEY = 'theme';

/** Lo guardado en este navegador. Sin almacenamiento (modo privado), el del sistema. */
export function savedTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Sin almacenamiento: el del sistema.
  }
  return 'system';
}

/** Lo fija en <html>: los tokens de styles/tokens.css cambian con data-theme. */
export function applyTheme(theme: Theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme() {
  const [theme, setTheme] = useState(savedTheme);
  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Sin almacenamiento: vale hasta que se recargue.
    }
  }
  return [theme, choose] as const;
}
