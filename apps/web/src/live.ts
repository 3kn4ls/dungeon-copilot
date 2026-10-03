import type { GameEvent, MapPing } from '@dungeon-copilot/shared';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';

/** Estado del directo, para enseñar si lo que se ve está al día. */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'ended';

export const LIVE_STATUS_LABELS: Record<LiveStatus, string> = {
  connecting: 'Conectando…',
  live: 'En directo',
  reconnecting: 'Reconectando…',
  ended: 'Sin directo',
};

/**
 * Escucha un directo del servidor (Server-Sent Events). Al conectar pide lo posterior a
 * `after`; si la conexión se corta, el navegador reconecta solo y el servidor le envía lo que
 * se perdió a partir del último evento recibido.
 */
export function useLiveEvents(options: {
  /** null: no conectar (por ejemplo, en una partida terminada). */
  url: string | null;
  /** Último evento que ya se tiene. Solo cuenta al conectar. */
  after: number;
  onEvent: (event: GameEvent) => void;
  /** Tras un evento que cumpla esto, se deja de escuchar (el cierre de la partida). */
  endsWith?: (event: GameEvent) => boolean;
  /** El servidor ya no deja conectar: han echado a quien mira o ha cambiado el enlace. */
  onRefused?: () => void;
  /** Alguien señala una casilla del mapa. No es un evento: no se guarda ni se recupera. */
  onPing?: (ping: MapPing) => void;
}): LiveStatus {
  const { url, after, onEvent, endsWith, onRefused, onPing } = options;
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const handleEvent = useEffectEvent((event: GameEvent) => {
    onEvent(event);
    return endsWith?.(event) ?? false;
  });
  const handlePing = useEffectEvent((ping: MapPing) => onPing?.(ping));
  const handleRefused = useEffectEvent(() => onRefused?.());
  const initialAfter = useEffectEvent(() => after);

  useEffect(() => {
    if (!url) return;
    const source = new EventSource(`${url}?after=${initialAfter()}`);
    source.onopen = () => setStatus('live');
    source.onmessage = (message: MessageEvent<string>) => {
      if (handleEvent(JSON.parse(message.data) as GameEvent)) {
        source.close();
        setStatus('ended');
      }
    };
    source.addEventListener('ping', (message: MessageEvent<string>) => {
      handlePing(JSON.parse(message.data) as MapPing);
    });
    source.onerror = () => {
      // Cerrado del todo: el servidor respondió con un error en vez de con el directo.
      if (source.readyState === EventSource.CLOSED) {
        setStatus('ended');
        handleRefused();
      } else {
        setStatus('reconnecting');
      }
    };
    return () => source.close();
  }, [url]);

  return url ? status : 'ended';
}

/** Cuánto se ve una casilla señalada. */
const PING_MS = 2400;

/** Una casilla señalada mientras se ve. */
export interface ShownPing extends MapPing {
  key: number;
}

let pingCount = 0;

/** Las casillas señaladas que llegan por el directo: cada una se ve un momento y se va. */
export function usePings(): [ShownPing[], (ping: MapPing) => void] {
  const [pings, setPings] = useState<ShownPing[]>([]);
  const add = useCallback((ping: MapPing) => {
    const key = pingCount++;
    setPings((shown) => [...shown, { ...ping, key }]);
    setTimeout(() => setPings((shown) => shown.filter((other) => other.key !== key)), PING_MS);
  }, []);
  return [pings, add];
}
