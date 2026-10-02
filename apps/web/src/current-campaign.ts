import { useEffect, useSyncExternalStore } from 'react';

/**
 * La última campaña que se ha visitado, para llevar a ella (y a su partida en juego) desde la
 * navegación. Se recuerda en este navegador.
 */
const KEY = 'campaign';
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let current = read();

export function rememberCampaign(id: string | null) {
  if (id === current) return;
  current = id;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Sin almacenamiento: vale hasta que se recargue.
  }
  listeners.forEach((listener) => listener());
}

/** Las páginas de una campaña la recuerdan en cuanto la tienen cargada. */
export function useRememberCampaign(id: string | undefined) {
  useEffect(() => {
    if (id) rememberCampaign(id);
  }, [id]);
}

export function useCurrentCampaignId(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
