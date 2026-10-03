import type { GameEvent, MapPing } from '@dungeon-copilot/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GameHub, Subscriber } from './hub';

/** Cada cuánto se manda un comentario vacío para que ningún proxy corte la conexión por inactividad. */
const HEARTBEAT_MS = 25_000;
/** Cuánto espera el navegador antes de reconectar si se corta. */
const RETRY_MS = 3_000;

export interface EventStreamOptions {
  hub: GameHub;
  subscriber: Omit<Subscriber, 'send' | 'signal' | 'close'>;
  /** Último evento que tiene el cliente; se le envía lo posterior antes de pasar al directo. */
  after: number;
  /** Eventos posteriores a `after`, del más antiguo al más reciente. */
  catchUp(after: number): Promise<GameEvent[]>;
  /** Tras enviar un evento que cumpla esto se cierra el directo (el cierre de la partida). */
  isLast?(event: GameEvent): boolean;
}

/** Último evento recibido: la cabecera Last-Event-ID al reconectar o ?after= la primera vez. */
export function lastEventId(request: FastifyRequest<{ Querystring: { after?: string } }>): number {
  const header = request.headers['last-event-id'];
  let after = 0;
  for (const value of [Array.isArray(header) ? header[0] : header, request.query.after]) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > after) after = parsed;
  }
  return after;
}

/**
 * Abre un directo con Server-Sent Events: primero lo que el cliente se perdió y luego lo que
 * vaya pasando. Se suscribe antes de consultar la base de datos y guarda lo que llega mientras
 * tanto, así no se pierde nada entre la consulta y el directo; los repetidos se descartan por id.
 * Las casillas señaladas van aparte (`event: ping`), sin id: no se guardan ni se recuperan.
 */
export function openEventStream(
  request: FastifyRequest,
  reply: FastifyReply,
  options: EventStreamOptions,
): void {
  const { raw } = reply;
  reply.hijack();
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    // Que nginx u otro proxy no acumule los eventos antes de reenviarlos.
    'x-accel-buffering': 'no',
  });
  raw.write(`retry: ${RETRY_MS}\n\n`);

  const sent = new Set<number>();
  let pending: GameEvent[] | null = [];
  let ended = false;
  let unsubscribe = () => {};
  const heartbeat = setInterval(() => raw.write(': ping\n\n'), HEARTBEAT_MS);

  const end = () => {
    if (ended) return;
    ended = true;
    unsubscribe();
    clearInterval(heartbeat);
    raw.end();
  };

  const write = (event: GameEvent) => {
    if (ended || sent.has(event.id)) return;
    sent.add(event.id);
    raw.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    if (options.isLast?.(event)) end();
  };

  const signal = (ping: MapPing) => {
    if (!ended) raw.write(`event: ping\ndata: ${JSON.stringify(ping)}\n\n`);
  };

  raw.on('close', end);
  raw.on('error', end);
  unsubscribe = options.hub.subscribe({
    ...options.subscriber,
    send: (event) => (pending ? pending.push(event) : write(event)),
    signal,
    close: end,
  });
  // Si el cliente se fue antes de llegar aquí, "close" ya pasó y no volverá a avisar.
  if (request.raw.socket.destroyed) end();

  options.catchUp(options.after).then(
    (events) => {
      for (const event of events) write(event);
      const live = pending ?? [];
      pending = null;
      for (const event of live) write(event);
    },
    (error: unknown) => {
      request.log.error(error, 'No se pudo recuperar lo que se perdió el directo');
      end();
    },
  );
}
