import type { CSSProperties } from 'react';

/** Los colores de personaje que hay en styles/tokens.css (--pc-1 a --pc-6). */
const TONES = 6;

/** El color de un personaje: siempre el mismo para el mismo id, en cualquier pantalla. */
export function toneOf(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `var(--pc-${(Math.abs(hash) % TONES) + 1})`;
}

/**
 * La inicial en un círculo. Con `id`, el color de ese personaje; sin él, neutro (PNJ y
 * personas de la mesa).
 */
export function Avatar(props: { name: string; id?: string; size?: 'small' | 'large' }) {
  const { name, id, size } = props;
  return (
    <span
      className={size ? `avatar ${size}` : 'avatar'}
      style={id ? ({ '--tone': toneOf(id) } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
