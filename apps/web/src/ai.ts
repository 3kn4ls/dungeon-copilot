import { useEffect, useRef, useState } from 'react';
import type { AiTextOptions } from './api';

/**
 * Un texto que la IA escribe en directo, como el resumen o la descripción de una escena. Al
 * desmontar, para lo que estuviera a medias.
 */
export function useAiText() {
  /** Lo que lleva escrito la IA; null si no está escribiendo. */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  /**
   * Pide el texto y devuelve el terminado. Si el máster la para, devuelve lo que llegó a
   * escribir, que puede servir (o nada); si falla, null y el error queda en `error`.
   */
  async function write(ask: (options: AiTextOptions) => Promise<string>): Promise<string | null> {
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    setError(null);
    setPending('');
    let partial = '';
    try {
      return await ask({
        signal: current.signal,
        onText: (next) => {
          partial = next;
          setPending(next);
        },
      });
    } catch (caught) {
      if (current.signal.aborted) return partial.trim();
      setError(caught);
      return null;
    } finally {
      if (request.current === current) {
        request.current = null;
        setPending(null);
      }
    }
  }

  return {
    pending,
    writing: pending !== null,
    error,
    write,
    stop: () => request.current?.abort(),
  };
}
