import type { OllamaConfig } from '../config';
import { HttpError } from '../http/errors';

/** Un mensaje de la conversación con el modelo. */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  messages: AiMessage[];
  /** Corta la petición cuando quien la pidió ya no espera la respuesta. */
  signal?: AbortSignal;
  temperature?: number;
  /** Tope de tokens de la respuesta. */
  maxTokens?: number;
  /** JSON Schema: la respuesta será un JSON que lo cumple. */
  format?: object;
}

/** La IA que escribe por el máster. En producción es Ollama; en los tests, uno de mentira. */
export interface Ai {
  readonly model: string;
  /**
   * Pide una respuesta y la devuelve a trozos según la escribe el modelo. La promesa se
   * resuelve cuando Ollama empieza a responder: los errores de conexión, de modelo o de clave
   * llegan antes de contestar nada a la web.
   */
  stream(request: AiRequest): Promise<AsyncIterable<string>>;
  /** Pide una respuesta y la devuelve entera. */
  complete(request: AiRequest): Promise<string>;
  /** Corta las peticiones en curso, al apagar el servidor. */
  close(): void;
}

/** Ollama tarda en cargar un modelo grande la primera vez; más que esto ya no es normal. */
const DEFAULT_TIMEOUT_MS = 180_000;
/** Contexto de sobra para la campaña, la ficha del PNJ y la conversación. */
const CONTEXT_TOKENS = 8192;

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

type AbortReason = 'caller' | 'timeout' | 'closing' | null;

interface Call {
  response: Response;
  /** Por qué se cortó: quien preguntó se fue, se agotó el tiempo o se apaga el servidor. */
  abortReason(): AbortReason;
  finish(): void;
}

const aiError = (status: number, message: string, cause?: unknown) =>
  Object.assign(new HttpError(status, message), { cause });

export function createOllama(config: OllamaConfig & { timeoutMs?: number }): Ai {
  const endpoint = `${config.url.replace(/\/+$/, '')}/api/chat`;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const inFlight = new Set<AbortController>();

  /** Traduce un fallo de la conexión a un error que entienda el máster. */
  function connectionError(reason: AbortReason, cause: unknown): unknown {
    switch (reason) {
      case 'caller':
        return cause;
      case 'timeout':
        return aiError(
          504,
          'Ollama ha tardado demasiado en responder. Puede que el modelo sea demasiado grande para su máquina.',
          cause,
        );
      case 'closing':
        return aiError(503, 'El servidor se está apagando', cause);
      default:
        return aiError(
          502,
          'No se pudo conectar con Ollama. Revisa que esté en marcha y la dirección de OLLAMA_URL.',
          cause,
        );
    }
  }

  /** Un corte a mitad de respuesta: por un motivo conocido o porque se cayó la conexión. */
  function interrupted(call: Call, cause: unknown): unknown {
    const reason = call.abortReason();
    return reason
      ? connectionError(reason, cause)
      : aiError(502, 'Se cortó la conexión con Ollama', cause);
  }

  async function responseError(response: Response): Promise<HttpError> {
    const text = await response.text().catch(() => '');
    let message = '';
    try {
      message = (JSON.parse(text) as OllamaChunk).error ?? '';
    } catch {
      // No es JSON: puede que OLLAMA_URL apunte a otra cosa.
    }
    if (response.status === 404 && /model/i.test(message)) {
      return aiError(
        502,
        `Ollama no tiene el modelo «${config.model}». Descárgalo con «ollama pull ${config.model}» o cambia OLLAMA_MODEL.`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      return aiError(502, 'Ollama no acepta la clave: revisa OLLAMA_API_KEY.');
    }
    if (!message) {
      return aiError(
        502,
        `Ollama respondió con un error (${response.status}). Revisa que OLLAMA_URL sea la dirección de Ollama.`,
      );
    }
    return aiError(502, `Ollama ha fallado: ${message}`);
  }

  async function start(request: AiRequest, stream: boolean): Promise<Call> {
    const closing = new AbortController();
    const timeout = AbortSignal.timeout(timeoutMs);
    const signals = [closing.signal, timeout];
    if (request.signal) signals.push(request.signal);
    inFlight.add(closing);
    const finish = () => void inFlight.delete(closing);
    const abortReason = (): AbortReason => {
      if (request.signal?.aborted) return 'caller';
      if (closing.signal.aborted) return 'closing';
      if (timeout.aborted) return 'timeout';
      return null;
    };

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        signal: AbortSignal.any(signals),
        body: JSON.stringify({
          model: config.model,
          messages: request.messages,
          stream,
          // Pensar antes de hablar solo hace esperar más al máster.
          think: false,
          ...(request.format ? { format: request.format } : {}),
          options: {
            num_ctx: CONTEXT_TOKENS,
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            ...(request.maxTokens === undefined ? {} : { num_predict: request.maxTokens }),
          },
        }),
      });
    } catch (error) {
      finish();
      throw connectionError(abortReason(), error);
    }
    if (!response.ok) {
      const error = await responseError(response);
      finish();
      throw error;
    }
    return { response, abortReason, finish };
  }

  function contentOf(line: string): { text: string; done: boolean } {
    let chunk: OllamaChunk;
    try {
      chunk = JSON.parse(line) as OllamaChunk;
    } catch (error) {
      throw aiError(502, 'Ollama ha respondido algo que no se entiende', error);
    }
    if (chunk.error) throw aiError(502, `Ollama ha fallado: ${chunk.error}`);
    return { text: chunk.message?.content ?? '', done: chunk.done === true };
  }

  /** Lee la respuesta de Ollama: un objeto JSON por línea con el siguiente trozo de texto. */
  async function* read(call: Call): AsyncGenerator<string> {
    const body = call.response.body;
    if (!body) {
      call.finish();
      return;
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    try {
      while (!finished) {
        let result: Awaited<ReturnType<typeof reader.read>>;
        try {
          result = await reader.read();
        } catch (error) {
          throw interrupted(call, error);
        }
        if (result.done) {
          buffer += decoder.decode();
          finished = true;
        } else {
          buffer += decoder.decode(result.value, { stream: true });
        }
        const lines = buffer.split('\n');
        buffer = finished ? '' : (lines.pop() ?? '');
        for (const line of lines) {
          if (!line.trim()) continue;
          const { text, done } = contentOf(line);
          if (text) yield text;
          if (done) finished = true;
        }
      }
    } finally {
      // Si quien lee para antes de tiempo, se corta la petición para liberar a Ollama.
      await reader.cancel().catch(() => undefined);
      call.finish();
    }
  }

  return {
    model: config.model,

    async stream(request) {
      return read(await start(request, true));
    },

    async complete(request) {
      const call = await start(request, false);
      try {
        let text: string;
        try {
          text = await call.response.text();
        } catch (error) {
          throw interrupted(call, error);
        }
        return contentOf(text).text;
      } finally {
        call.finish();
      }
    },

    close() {
      for (const controller of inFlight) controller.abort();
      inFlight.clear();
    },
  };
}
