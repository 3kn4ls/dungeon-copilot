import { Readable } from 'node:stream';
import type { AiTextChunk } from '@dungeon-copilot/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../http/errors';
import type { Ai, AiRequest } from './ollama';

const AI_DISABLED =
  'La IA no está configurada: el servidor necesita OLLAMA_URL y OLLAMA_MODEL para usar Ollama';

/** La IA del servidor, o un 503 si no tiene. */
export function requireAi(ai: Ai | null): Ai {
  if (!ai) throw new HttpError(503, AI_DISABLED);
  return ai;
}

/**
 * Señal que se corta cuando la web deja de esperar la respuesta (el máster pulsa «Parar» o
 * se va): así Ollama deja de escribir algo que nadie va a leer.
 */
export function abortWhenGone(request: FastifyRequest, reply: FastifyReply): AbortController {
  const controller = new AbortController();
  reply.raw.on('close', () => controller.abort());
  // Si se fue mientras se consultaba la base de datos, "close" ya pasó y no volverá a avisar.
  if (request.raw.socket.destroyed) controller.abort();
  return controller;
}

const ndjson = (chunk: AiTextChunk) => `${JSON.stringify(chunk)}\n`;

export interface AiTextOptions {
  ai: Ai;
  request: Omit<AiRequest, 'signal'>;
  /** Lo que se puede enseñar del texto a medio escribir. */
  visible: (text: string) => string;
  /** El texto terminado, listo para guardar. Vacío si la IA no ha dicho nada. */
  finish: (text: string) => string;
  /** Lo que se apunta en el registro del servidor si la respuesta se corta. */
  cutMessage: string;
}

/**
 * Responde con lo que escribe la IA según lo escribe, una línea JSON por trozo (ver
 * AiTextChunk). Lo que falla antes de empezar (Ollama apagado, sin el modelo...) es un error
 * normal de la API; lo que falla después llega como la última línea.
 */
export async function sendAiText(
  request: FastifyRequest,
  reply: FastifyReply,
  options: AiTextOptions,
): Promise<FastifyReply> {
  const controller = abortWhenGone(request, reply);
  let chunks: AsyncIterable<string>;
  try {
    chunks = await options.ai.stream({ ...options.request, signal: controller.signal });
  } catch (error) {
    // Nadie espera ya la respuesta: no hay a quién contestar.
    if (controller.signal.aborted) return reply.hijack();
    throw error;
  }

  async function* lines(): AsyncGenerator<string> {
    let full = '';
    let shown = '';
    try {
      for await (const chunk of chunks) {
        full += chunk;
        const visible = options.visible(full);
        if (visible.length > shown.length) {
          yield ndjson({ type: 'delta', text: visible.slice(shown.length) });
          shown = visible;
        }
      }
      const text = options.finish(full);
      yield ndjson(
        text
          ? { type: 'done', text }
          : { type: 'error', error: 'La IA no ha dicho nada. Prueba otra vez.' },
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      const cause = error instanceof HttpError ? (error.cause ?? error) : error;
      request.log.warn({ err: cause }, options.cutMessage);
      const message = error instanceof HttpError ? error.message : 'Se cortó la respuesta de la IA';
      yield ndjson({ type: 'error', error: message });
    }
  }

  return reply
    .header('content-type', 'application/x-ndjson; charset=utf-8')
    .header('cache-control', 'no-cache')
    .header('x-accel-buffering', 'no')
    .send(Readable.from(lines()));
}
