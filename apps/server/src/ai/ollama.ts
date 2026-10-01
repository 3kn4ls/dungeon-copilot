import { aiError, connectOllama, type ModelConfig, type OllamaCall } from './connection';

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
  /** Cuánto se espera como mucho a la respuesta entera, si no vale lo de siempre. */
  timeoutMs?: number;
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

export function createOllama(config: ModelConfig): Ai {
  const connection = connectOllama({
    ...config,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    modelVariable: 'OLLAMA_MODEL',
  });

  function start(request: AiRequest, stream: boolean): Promise<OllamaCall> {
    return connection.post(
      '/api/chat',
      {
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
      },
      request,
    );
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
  async function* read(call: OllamaCall): AsyncGenerator<string> {
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
          throw connection.interrupted(call, error);
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
          throw connection.interrupted(call, error);
        }
        return contentOf(text).text;
      } finally {
        call.finish();
      }
    },

    close() {
      connection.close();
    },
  };
}
