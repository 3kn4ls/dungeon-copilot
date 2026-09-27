import { createServer } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from '../http/errors';
import { startFakeOllama, type FakeOllama } from './fake-ollama';
import { createOllama, type Ai } from './ollama';

let ollama: FakeOllama;
let ai: Ai;
const messages = [{ role: 'user' as const, content: 'Hola' }];

beforeAll(async () => {
  ollama = await startFakeOllama();
  ai = createOllama({ url: `${ollama.url}/`, model: 'qwen2.5:7b' });
});
beforeEach(() => ollama.reset());
afterAll(() => ollama.close());

async function collect(chunks: AsyncIterable<string>): Promise<string[]> {
  const list: string[] = [];
  for await (const chunk of chunks) list.push(chunk);
  return list;
}

/** El error con el que falla una promesa, para mirarlo con calma. */
async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un error');
}

/** Un puerto en el que no escucha nadie. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === 'string') throw new Error('Sin puerto');
  return address.port;
}

describe('cliente de Ollama', () => {
  it('pide la respuesta en directo y la devuelve a trozos', async () => {
    ollama.queue({ kind: 'chunks', chunks: ['¿Qué ', 'queréis, ', 'cariño?'] });
    const chunks = await ai.stream({ messages, temperature: 0.8, maxTokens: 400 });
    expect(await collect(chunks)).toEqual(['¿Qué ', 'queréis, ', 'cariño?']);

    const [request] = ollama.requests;
    expect(request?.body).toEqual({
      model: 'qwen2.5:7b',
      messages,
      stream: true,
      think: false,
      options: { num_ctx: 8192, temperature: 0.8, num_predict: 400 },
    });
    expect(request?.headers.authorization).toBeUndefined();
  });

  it('pide la respuesta entera con un formato JSON y la clave de la nube', async () => {
    const cloud = createOllama({ url: ollama.url, model: 'gpt-oss:120b', apiKey: 'secreta' });
    ollama.queue({ kind: 'chunks', chunks: ['{"name":', '"Odo"}'] });
    const format = { type: 'object' };
    expect(await cloud.complete({ messages, format })).toBe('{"name":"Odo"}');
    const [request] = ollama.requests;
    expect(request?.body).toMatchObject({ model: 'gpt-oss:120b', stream: false, format });
    expect(request?.headers.authorization).toBe('Bearer secreta');
  });

  it('explica qué hacer si falta el modelo o la clave no vale', async () => {
    ollama.queue({ kind: 'error', status: 404, error: "model 'qwen2.5:7b' not found" });
    const missing = await failure(ai.stream({ messages }));
    expect(missing).toBeInstanceOf(HttpError);
    expect(missing).toMatchObject({
      statusCode: 502,
      message:
        'Ollama no tiene el modelo «qwen2.5:7b». Descárgalo con «ollama pull qwen2.5:7b» o cambia OLLAMA_MODEL.',
    });

    ollama.queue({ kind: 'error', status: 401, error: 'unauthorized' });
    expect(await failure(ai.complete({ messages }))).toMatchObject({
      statusCode: 502,
      message: 'Ollama no acepta la clave: revisa OLLAMA_API_KEY.',
    });

    ollama.queue({ kind: 'error', status: 500, error: 'model requires more system memory' });
    expect(await failure(ai.complete({ messages }))).toMatchObject({
      statusCode: 502,
      message: 'Ollama ha fallado: model requires more system memory',
    });
  });

  it('avisa si la dirección no es la de Ollama o no hay nadie escuchando', async () => {
    const elsewhere = createOllama({ url: `${ollama.url}/otra-cosa`, model: 'x' });
    expect(await failure(elsewhere.complete({ messages }))).toMatchObject({
      statusCode: 502,
      message:
        'Ollama respondió con un error (404). Revisa que OLLAMA_URL sea la dirección de Ollama.',
    });

    const nobody = createOllama({ url: `http://127.0.0.1:${await closedPort()}`, model: 'x' });
    expect(await failure(nobody.stream({ messages }))).toMatchObject({
      statusCode: 502,
      message:
        'No se pudo conectar con Ollama. Revisa que esté en marcha y la dirección de OLLAMA_URL.',
    });
  });

  it('se rinde si Ollama tarda demasiado', async () => {
    const slow = createOllama({ url: ollama.url, model: 'x', timeoutMs: 100 });
    ollama.queue({ kind: 'silence' });
    expect(await failure(slow.stream({ messages }))).toMatchObject({ statusCode: 504 });

    // También si se queda callado a mitad de respuesta.
    ollama.queue({ kind: 'chunks', chunks: ['Eh…'], hang: true });
    const chunks = await slow.stream({ messages });
    expect(await failure(collect(chunks))).toMatchObject({ statusCode: 504 });

    // Una petición puede esperar más, o menos, que el resto.
    const patient = createOllama({ url: ollama.url, model: 'x', timeoutMs: 60_000 });
    ollama.queue({ kind: 'silence' });
    const hurried = patient.stream({ messages, timeoutMs: 100 });
    expect(await failure(hurried)).toMatchObject({ statusCode: 504 });
  });

  it('pasa el error si Ollama falla a mitad de respuesta', async () => {
    ollama.queue({ kind: 'broken', chunks: ['Te diré'], error: 'out of memory' });
    const seen: string[] = [];
    const chunks = await ai.stream({ messages });
    const error = await failure(
      (async () => {
        for await (const chunk of chunks) seen.push(chunk);
      })(),
    );
    expect(seen).toEqual(['Te diré']);
    expect(error).toMatchObject({ statusCode: 502, message: 'Ollama ha fallado: out of memory' });
  });

  it('corta la petición cuando quien la pidió deja de esperar', async () => {
    ollama.queue({ kind: 'chunks', chunks: ['Bla, ', 'bla'], hang: true });
    const controller = new AbortController();
    const aborted = ollama.nextAbort();
    const chunks = await ai.stream({ messages, signal: controller.signal });
    const reading = failure(collect(chunks));
    controller.abort();
    await aborted;
    // No es un error de Ollama: nadie espera ya la respuesta.
    expect(await reading).not.toBeInstanceOf(HttpError);
  });

  it('deja de leer si quien lee para antes de tiempo', async () => {
    ollama.queue({ kind: 'chunks', chunks: ['Uno. ', 'Dos. '], hang: true });
    const aborted = ollama.nextAbort();
    for await (const chunk of await ai.stream({ messages })) {
      expect(chunk).toBe('Uno. ');
      break;
    }
    await aborted;
  });

  it('al apagar corta las peticiones en curso', async () => {
    const closing = createOllama({ url: ollama.url, model: 'x' });
    ollama.queue({ kind: 'silence' });
    const pending = failure(closing.stream({ messages }));
    closing.close();
    expect(await pending).toMatchObject({ statusCode: 503 });
  });
});
