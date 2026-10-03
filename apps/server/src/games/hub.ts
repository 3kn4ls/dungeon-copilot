import type { GameEvent, MapPing } from '@dungeon-copilot/shared';

/** Alguien conectado al directo: un miembro en la sala de una partida o la pantalla de la mesa. */
export interface Subscriber {
  campaignId: string;
  /** Partida que sigue. null: la que esté en juego en la campaña (la pantalla de la mesa). */
  gameId: string | null;
  /** null para la pantalla de la mesa, que no tiene sesión iniciada. */
  userId: string | null;
  /** El máster ve también sus notas, las tiradas secretas y todo lo que es en secreto. */
  seesMasterEvents: boolean;
  send(event: GameEvent): void;
  /** Una casilla señalada en el mapa: de paso, sin guardarla. */
  signal(ping: MapPing): void;
  /** Corta la conexión; el navegador volverá a intentarlo y el servidor decidirá si puede. */
  close(): void;
}

/** Si quien está conectado puede ver el evento; `playerId`, el jugador de un evento en secreto. */
function canSee(subscriber: Subscriber, event: GameEvent, playerId: string | null): boolean {
  if (event.visibility === 'public' || subscriber.seesMasterEvents) return true;
  return event.visibility === 'private' && playerId !== null && subscriber.userId === playerId;
}

/**
 * Reparte en vivo lo que pasa en las partidas. Vive en memoria, así que sirve para un solo
 * proceso del servidor; con varias réplicas habría que repartir con LISTEN/NOTIFY de PostgreSQL.
 */
export class GameHub {
  readonly #campaigns = new Map<string, Set<Subscriber>>();

  subscribe(subscriber: Subscriber): () => void {
    let subscribers = this.#campaigns.get(subscriber.campaignId);
    if (!subscribers) {
      subscribers = new Set();
      this.#campaigns.set(subscriber.campaignId, subscribers);
    }
    subscribers.add(subscriber);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0 && this.#campaigns.get(subscriber.campaignId) === subscribers) {
        this.#campaigns.delete(subscriber.campaignId);
      }
    };
  }

  /**
   * Envía el evento a quien siga su partida y pueda verlo. Uno en secreto ("private") llega al
   * máster y al jugador `playerId`.
   */
  publish(campaignId: string, event: GameEvent, playerId: string | null = null): void {
    for (const subscriber of this.#campaigns.get(campaignId) ?? []) {
      if (subscriber.gameId !== null && subscriber.gameId !== event.gameId) continue;
      if (!canSee(subscriber, event, playerId)) continue;
      subscriber.send(event);
    }
  }

  /** Una casilla señalada en el mapa de una partida: la ven todos los que la siguen. */
  signal(campaignId: string, gameId: string, ping: MapPing): void {
    for (const subscriber of this.#campaigns.get(campaignId) ?? []) {
      if (subscriber.gameId !== null && subscriber.gameId !== gameId) continue;
      subscriber.signal(ping);
    }
  }

  /** Corta las conexiones de una campaña, o solo las que cumplan `which`. */
  disconnect(campaignId: string, which: (subscriber: Subscriber) => boolean = () => true): void {
    for (const subscriber of [...(this.#campaigns.get(campaignId) ?? [])]) {
      if (which(subscriber)) subscriber.close();
    }
  }

  disconnectAll(): void {
    for (const campaignId of [...this.#campaigns.keys()]) this.disconnect(campaignId);
  }

  /** Conexiones abiertas; para los tests. */
  get size(): number {
    let size = 0;
    for (const subscribers of this.#campaigns.values()) size += subscribers.size;
    return size;
  }
}
