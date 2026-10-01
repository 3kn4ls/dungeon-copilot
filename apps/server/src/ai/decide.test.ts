import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from '../http/errors';
import { createDecider, type Decider } from './decide';
import { startFakeOllama, type FakeOllama } from './fake-ollama';

let ollama: FakeOllama;
let decider: Decider;

beforeAll(async () => {
  ollama = await startFakeOllama();
  decider = createDecider({ url: `${ollama.url}/`, model: 'nimble' });
});
beforeEach(() => ollama.reset());
afterAll(() => ollama.close());

const questions = {
  skill: {
    type: 'choice' as const,
    instructions: '¿Con qué habilidad tira?',
    criteria: { stealth: 'Sigilo', athletics: 'Atletismo', perception: 'Percepción' },
  },
  opposed: {
    type: 'noul' as const,
    instructions: '¿Alguien se opone?',
    criteria: { false: 'Nadie', true: 'Alguien' },
  },
  difficulty: {
    type: 'score' as const,
    instructions: '¿Cómo de difícil es?',
    criteria: ['Fácil', 'Normal', 'Difícil'],
  },
};
const state = 'Kael se esconde tras las cajas.';

/** El error con el que falla una promesa, para mirarlo con calma. */
async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un error');
}

describe('cliente de la IA que decide', () => {
  it('manda el modelo, el texto y las preguntas, y lee cada respuesta según su tipo', async () => {
    ollama.queueDecision({
      kind: 'answers',
      answers: {
        skill: { choice: { stealth: 0.72, athletics: 0.18, perception: 0.1 } },
        opposed: { noul: 0.3 },
        difficulty: { score: 1.4 },
      },
    });
    const answers = await decider.decide({ state, questions });
    expect(answers).toEqual({
      skill: {
        choice: 'stealth',
        probabilities: { stealth: 0.72, athletics: 0.18, perception: 0.1 },
      },
      opposed: { probability: 0.3 },
      difficulty: { score: 1.4 },
    });

    const [request] = ollama.decisions;
    expect(request?.body).toEqual({ model: 'nimble', state, questions });
    expect(request?.headers.authorization).toBeUndefined();
  });

  it('manda la clave de Ollama si la hay', async () => {
    const cloud = createDecider({ url: ollama.url, model: 'nimble', apiKey: 'secreta' });
    await cloud.decide({ state, questions: { opposed: questions.opposed } });
    expect(ollama.decisions[0]?.headers.authorization).toBe('Bearer secreta');
  });

  it('explica qué hacer si falta el modelo, Ollama es antiguo o el modelo no sabe decidir', async () => {
    ollama.queueDecision({
      kind: 'error',
      status: 404,
      error: 'model "nimble" not found, try pulling it first',
    });
    const missing = await failure(decider.decide({ state, questions }));
    expect(missing).toBeInstanceOf(HttpError);
    expect(missing).toMatchObject({
      statusCode: 502,
      message:
        'Ollama no tiene el modelo «nimble». Descárgalo con «ollama pull nimble» o cambia OLLAMA_DECISION_MODEL.',
    });

    // Un Ollama anterior a la 0.35 no tiene el endpoint: contesta un 404 en texto.
    const old = createDecider({ url: `${ollama.url}/antiguo`, model: 'nimble' });
    expect(await failure(old.decide({ state, questions }))).toMatchObject({
      statusCode: 502,
      message:
        'Tu Ollama es anterior a la 0.35 y no sabe decidir: actualízalo (o revisa que OLLAMA_URL sea la dirección de Ollama).',
    });

    ollama.queueDecision({
      kind: 'error',
      status: 400,
      error:
        'model "qwen2.5:7b" is not supported by System One; use a local Nimble or Tev GGUF model',
    });
    const writer = createDecider({ url: ollama.url, model: 'qwen2.5:7b' });
    expect(await failure(writer.decide({ state, questions }))).toMatchObject({
      statusCode: 502,
      message:
        'El modelo «qwen2.5:7b» no sabe decidir: OLLAMA_DECISION_MODEL tiene que ser Nimble («ollama pull nimble»).',
    });

    ollama.queueDecision({ kind: 'error', status: 401, error: 'unauthorized' });
    expect(await failure(decider.decide({ state, questions }))).toMatchObject({
      statusCode: 502,
      message: 'Ollama no acepta la clave: revisa OLLAMA_API_KEY.',
    });

    ollama.queueDecision({
      kind: 'error',
      status: 400,
      error: 'question "skill": criteria must contain 2–26 candidates',
    });
    expect(await failure(decider.decide({ state, questions }))).toMatchObject({
      statusCode: 502,
      message: 'Ollama ha fallado: question "skill": criteria must contain 2–26 candidates',
    });
  });

  it('no se fía de una respuesta que no cumple lo esperado', async () => {
    const replies = [
      'esto no es JSON',
      JSON.stringify({ model: 'nimble' }),
      // Falta una respuesta.
      JSON.stringify({
        answers: {
          skill: { type: 'choice', choice: 'stealth', probabilities: { stealth: 1 } },
          opposed: { type: 'noul', noul: 0.2 },
        },
      }),
      // Una probabilidad que no es un número.
      JSON.stringify({
        answers: {
          skill: { type: 'choice', choice: 'stealth', probabilities: { stealth: 1 } },
          opposed: { type: 'noul', noul: 'mucho' },
          difficulty: { type: 'score', score: 1 },
        },
      }),
    ];
    for (const body of replies) {
      ollama.queueDecision({ kind: 'raw', body });
      expect(await failure(decider.decide({ state, questions }))).toMatchObject({
        statusCode: 502,
        message: 'Ollama ha respondido algo que no se entiende',
      });
    }
  });

  it('solo exige lo que usa: el resto de la respuesta puede cambiar', async () => {
    ollama.queueDecision({
      kind: 'raw',
      body: JSON.stringify({
        answers: {
          opposed: { noul: 0.9, algo: 'nuevo' },
          otra: { type: 'noul', noul: 0.1 },
        },
      }),
    });
    expect(await decider.decide({ state, questions: { opposed: questions.opposed } })).toEqual({
      opposed: { probability: 0.9 },
    });
  });

  it('se rinde si Ollama tarda demasiado', async () => {
    const slow = createDecider({ url: ollama.url, model: 'nimble', timeoutMs: 100 });
    ollama.queueDecision({ kind: 'silence' });
    expect(await failure(slow.decide({ state, questions }))).toMatchObject({ statusCode: 504 });

    // Una pregunta puede esperar menos que el resto.
    ollama.queueDecision({ kind: 'silence' });
    expect(await failure(decider.decide({ state, questions, timeoutMs: 100 }))).toMatchObject({
      statusCode: 504,
    });
  });

  it('corta la pregunta cuando quien la hizo deja de esperar', async () => {
    ollama.queueDecision({ kind: 'silence' });
    const controller = new AbortController();
    const aborted = ollama.nextAbort();
    const asking = failure(decider.decide({ state, questions, signal: controller.signal }));
    await expect.poll(() => ollama.decisions.length).toBe(1);
    controller.abort();
    await aborted;
    // No es un error de Ollama: nadie espera ya la respuesta.
    expect(await asking).not.toBeInstanceOf(HttpError);
  });

  it('al apagar corta las preguntas en curso', async () => {
    const closing = createDecider({ url: ollama.url, model: 'nimble' });
    ollama.queueDecision({ kind: 'silence' });
    const pending = failure(closing.decide({ state, questions }));
    await expect.poll(() => ollama.decisions.length).toBe(1);
    closing.close();
    expect(await pending).toMatchObject({ statusCode: 503 });
  });
});
