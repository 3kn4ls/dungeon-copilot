import { HttpError } from '../http/errors';

// Lo común a los dos clientes de Ollama, el que escribe (ollama.ts) y el que decide (decide.ts):
// la petición, con sus cortes, y los errores explicados en español para el máster.

/** Dónde está Ollama y con qué modelo se habla. */
export interface ModelConfig {
  url: string;
  model: string;
  /** Para los modelos en la nube de Ollama. */
  apiKey?: string | undefined;
  /** Cuánto se espera como mucho a una respuesta, si no vale lo de cada cliente. */
  timeoutMs?: number;
}

/** Por qué se cortó: quien preguntó se fue, se agotó el tiempo o se apaga el servidor. */
export type AbortReason = 'caller' | 'timeout' | 'closing' | null;

/** Una petición a la que Ollama ha empezado a responder bien. */
export interface OllamaCall {
  response: Response;
  abortReason(): AbortReason;
  /** Deja de contarla entre las que hay en curso. */
  finish(): void;
}

export interface CallOptions {
  /** Corta la petición cuando quien la pidió ya no espera la respuesta. */
  signal?: AbortSignal | undefined;
  /** Cuánto se espera como mucho a la respuesta entera, si no vale lo de siempre. */
  timeoutMs?: number | undefined;
}

export interface OllamaConnection {
  /**
   * Manda `body` a `path` (como "/api/chat"). Se resuelve cuando Ollama empieza a responder
   * bien; si no, falla con un error que entiende el máster.
   */
  post(path: string, body: unknown, options: CallOptions): Promise<OllamaCall>;
  /** Un corte a mitad de respuesta: por un motivo conocido o porque se cayó la conexión. */
  interrupted(call: OllamaCall, cause: unknown): unknown;
  /** Corta las peticiones en curso, al apagar el servidor. */
  close(): void;
}

export interface ConnectionOptions extends ModelConfig {
  timeoutMs: number;
  /** La variable que elige el modelo, para decir qué cambiar si no lo tiene. */
  modelVariable: 'OLLAMA_MODEL' | 'OLLAMA_DECISION_MODEL';
  /**
   * Los errores propios de un cliente, antes que los de siempre: el mensaje para el máster, o
   * undefined si es uno de los de siempre. `message` es el que manda Ollama; vacío si no manda.
   */
  explain?: (status: number, message: string) => string | undefined;
}

export const aiError = (status: number, message: string, cause?: unknown) =>
  Object.assign(new HttpError(status, message), { cause });

export function connectOllama(options: ConnectionOptions): OllamaConnection {
  const base = options.url.replace(/\/+$/, '');
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

  async function responseError(response: Response): Promise<HttpError> {
    const text = await response.text().catch(() => '');
    let message = '';
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // No es JSON: puede que OLLAMA_URL apunte a otra cosa.
    }
    const explained = options.explain?.(response.status, message);
    if (explained) return aiError(502, explained);
    if (response.status === 404 && /model/i.test(message)) {
      return aiError(
        502,
        `Ollama no tiene el modelo «${options.model}». Descárgalo con «ollama pull ${options.model}» o cambia ${options.modelVariable}.`,
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

  return {
    async post(path, body, call) {
      const closing = new AbortController();
      const timeout = AbortSignal.timeout(call.timeoutMs ?? options.timeoutMs);
      const signals = [closing.signal, timeout];
      if (call.signal) signals.push(call.signal);
      inFlight.add(closing);
      const finish = () => void inFlight.delete(closing);
      // Si quien preguntó se va antes de leer la respuesta, nadie llegará a llamar a finish.
      call.signal?.addEventListener('abort', finish, { once: true });
      const abortReason = (): AbortReason => {
        if (call.signal?.aborted) return 'caller';
        if (closing.signal.aborted) return 'closing';
        if (timeout.aborted) return 'timeout';
        return null;
      };

      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
      let response: Response;
      try {
        response = await fetch(`${base}${path}`, {
          method: 'POST',
          headers,
          signal: AbortSignal.any(signals),
          body: JSON.stringify(body),
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
    },

    interrupted(call, cause) {
      const reason = call.abortReason();
      return reason
        ? connectionError(reason, cause)
        : aiError(502, 'Se cortó la conexión con Ollama', cause);
    },

    close() {
      for (const controller of inFlight) controller.abort();
      inFlight.clear();
    },
  };
}
