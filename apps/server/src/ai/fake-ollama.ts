import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Lo que recibe Ollama en /api/chat. */
export interface OllamaChatBody {
  model: string;
  messages: { role: string; content: string }[];
  stream: boolean;
  think?: boolean;
  format?: unknown;
  options?: Record<string, unknown>;
}

/** Cómo contesta el Ollama de mentira a una petición. */
export type FakeReply =
  /** El texto, trozo a trozo. Con `hang`, se queda a medias sin terminar nunca. */
  | { kind: 'chunks'; chunks: string[]; hang?: boolean }
  /** Un error HTTP con el cuerpo que manda Ollama: {"error": "..."}. */
  | { kind: 'error'; status: number; error: string }
  /** Empieza a contestar y falla a mitad, como Ollama cuando se queda sin memoria. */
  | { kind: 'broken'; chunks: string[]; error: string }
  /** No contesta nada: ni cabeceras. */
  | { kind: 'silence' };

export interface FakeOllama {
  url: string;
  /** Peticiones recibidas, en orden. */
  requests: { body: OllamaChatBody; headers: IncomingHttpHeaders }[];
  /** Respuestas para las próximas peticiones, en orden. Sin ninguna, contesta "Hola.". */
  queue(...replies: FakeReply[]): void;
  /** Se resuelve cuando alguien corta una petición antes de que termine. */
  nextAbort(): Promise<void>;
  reset(): void;
  close(): Promise<void>;
}

/** Un Ollama de mentira para los tests: contesta lo que se le pida por /api/chat. */
export async function startFakeOllama(): Promise<FakeOllama> {
  const requests: FakeOllama['requests'] = [];
  let pending: FakeReply[] = [];
  let abortWaiters: (() => void)[] = [];

  const line = (res: ServerResponse, body: object) => res.write(`${JSON.stringify(body)}\n`);
  const message = (model: string, content: string, done: boolean) => ({
    model,
    created_at: new Date().toISOString(),
    message: { role: 'assistant', content },
    done,
    ...(done ? { done_reason: 'stop' } : {}),
  });

  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (data: string) => (raw += data));
    req.on('end', () => {
      res.on('close', () => {
        if (res.writableFinished) return;
        for (const resolve of abortWaiters) resolve();
        abortWaiters = [];
      });
      if (req.method !== 'POST' || req.url !== '/api/chat') {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('404 page not found');
        return;
      }
      const body = JSON.parse(raw) as OllamaChatBody;
      requests.push({ body, headers: req.headers });
      const reply = pending.shift() ?? { kind: 'chunks', chunks: ['Hola.'] };

      switch (reply.kind) {
        case 'silence':
          return;
        case 'error':
          res
            .writeHead(reply.status, { 'content-type': 'application/json' })
            .end(JSON.stringify({ error: reply.error }));
          return;
        case 'broken':
          res.writeHead(200, { 'content-type': 'application/x-ndjson' });
          for (const chunk of reply.chunks) line(res, message(body.model, chunk, false));
          line(res, { error: reply.error });
          res.end();
          return;
        case 'chunks':
          if (!body.stream) {
            res
              .writeHead(200, { 'content-type': 'application/json' })
              .end(JSON.stringify(message(body.model, reply.chunks.join(''), true)));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/x-ndjson' });
          for (const chunk of reply.chunks) line(res, message(body.model, chunk, false));
          if (reply.hang) return;
          line(res, message(body.model, '', true));
          res.end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    queue: (...replies) => void pending.push(...replies),
    nextAbort: () => new Promise((resolve) => abortWaiters.push(resolve)),
    reset() {
      requests.length = 0;
      pending = [];
      abortWaiters = [];
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
