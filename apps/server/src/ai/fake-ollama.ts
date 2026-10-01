import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DecisionQuestion } from './decide';

/** Lo que recibe Ollama en /api/chat. */
export interface OllamaChatBody {
  model: string;
  messages: { role: string; content: string }[];
  stream: boolean;
  think?: boolean;
  format?: unknown;
  options?: Record<string, unknown>;
}

/** Lo que recibe Ollama en /v1/systemone, la IA que decide. */
export interface OllamaDecisionBody {
  model: string;
  state: string;
  questions: Record<string, DecisionQuestion>;
}

/**
 * Lo que responde la IA que decide a una pregunta, en corto: la probabilidad de cada opción de un
 * `choice` (las que falten, 0), la de que sí en un `noul` o el nivel esperado de un `score`.
 */
export type FakeAnswer = { choice: Record<string, number> } | { noul: number } | { score: number };

/** Cómo contesta el Ollama de mentira a una pregunta para la IA que decide. */
export type FakeDecision =
  /** Estas respuestas; las preguntas que no estén, como sin nada en cola. */
  | { kind: 'answers'; answers: Record<string, FakeAnswer> }
  /** Un error HTTP con el cuerpo que manda Ollama: {"error": "..."}. */
  | { kind: 'error'; status: number; error: string }
  /** Este cuerpo tal cual, con un 200: lo que no cumple lo esperado. */
  | { kind: 'raw'; body: string }
  /** No contesta nada: ni cabeceras. */
  | { kind: 'silence' };

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
  /** Peticiones recibidas en /api/chat, en orden. */
  requests: { body: OllamaChatBody; headers: IncomingHttpHeaders }[];
  /** Preguntas recibidas en /v1/systemone, en orden. */
  decisions: { body: OllamaDecisionBody; headers: IncomingHttpHeaders }[];
  /** Respuestas para las próximas peticiones, en orden. Sin ninguna, contesta "Hola.". */
  queue(...replies: FakeReply[]): void;
  /**
   * Respuestas para las próximas preguntas, en orden. Sin ninguna, elige la primera opción de
   * cada `choice`, dice que no a cada `noul` y el primer nivel de cada `score`.
   */
  queueDecision(...replies: FakeDecision[]): void;
  /** Se resuelve cuando alguien corta una petición antes de que termine. */
  nextAbort(): Promise<void>;
  reset(): void;
  close(): Promise<void>;
}

/** Una respuesta como las de /v1/systemone, para una pregunta. */
function decisionAnswer(question: DecisionQuestion, fake: FakeAnswer | undefined): object {
  switch (question.type) {
    case 'choice': {
      const ids = Object.keys(question.criteria);
      const given = fake && 'choice' in fake ? fake.choice : { [ids[0] ?? '']: 1 };
      const probabilities = Object.fromEntries(ids.map((id) => [id, given[id] ?? 0]));
      const choice = ids.reduce(
        (best, id) => ((probabilities[id] ?? 0) > (probabilities[best] ?? 0) ? id : best),
        ids[0] ?? '',
      );
      return { type: 'choice', choice, probabilities, confidence: 0.9 };
    }
    case 'noul':
      return { type: 'noul', noul: fake && 'noul' in fake ? fake.noul : 0 };
    case 'score': {
      const score = fake && 'score' in fake ? fake.score : 0;
      const legend = Object.fromEntries(question.criteria.map((label, index) => [index, label]));
      const probabilities = Object.fromEntries(
        question.criteria.map((_, index) => [index, index === Math.round(score) ? 1 : 0]),
      );
      return { type: 'score', score, legend, probabilities, confidence: 0.9 };
    }
  }
}

/**
 * Un Ollama de mentira para los tests: contesta lo que se le pida por /api/chat, la IA que
 * escribe, y por /v1/systemone, la que decide.
 */
export async function startFakeOllama(): Promise<FakeOllama> {
  const requests: FakeOllama['requests'] = [];
  const decisions: FakeOllama['decisions'] = [];
  let pending: FakeReply[] = [];
  let pendingDecisions: FakeDecision[] = [];
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
      if (req.method === 'POST' && req.url === '/v1/systemone') {
        const body = JSON.parse(raw) as OllamaDecisionBody;
        decisions.push({ body, headers: req.headers });
        const reply = pendingDecisions.shift() ?? { kind: 'answers', answers: {} };
        switch (reply.kind) {
          case 'silence':
            return;
          case 'error':
            res
              .writeHead(reply.status, { 'content-type': 'application/json' })
              .end(JSON.stringify({ error: reply.error }));
            return;
          case 'raw':
            res.writeHead(200, { 'content-type': 'application/json' }).end(reply.body);
            return;
          case 'answers': {
            const answers = Object.fromEntries(
              Object.entries(body.questions).map(([key, question]) => [
                key,
                decisionAnswer(question, reply.answers[key]),
              ]),
            );
            res
              .writeHead(200, { 'content-type': 'application/json' })
              .end(JSON.stringify({ model: body.model, answers, usage: {} }));
            return;
          }
        }
      }
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
    decisions,
    queue: (...replies) => void pending.push(...replies),
    queueDecision: (...replies) => void pendingDecisions.push(...replies),
    nextAbort: () => new Promise((resolve) => abortWaiters.push(resolve)),
    reset() {
      requests.length = 0;
      decisions.length = 0;
      pending = [];
      pendingDecisions = [];
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
