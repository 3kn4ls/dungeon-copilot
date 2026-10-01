import { z } from 'zod';
import { aiError, connectOllama, type ModelConfig, type OllamaCall } from './connection';

// La IA que decide: Nimble, en el Ollama de siempre pero por su propio endpoint. No escribe:
// recibe un texto (`state`) y unas preguntas, y de cada una devuelve la respuesta con sus
// probabilidades. Ollama la sirve desde la 0.35.

/** Una pregunta con opciones: de 2 a 26, de su id a lo que significa. */
export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

/** Una pregunta de sí o no: qué significa cada respuesta, si hace falta aclararlo. */
export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { false: string; true: string };
}

/** Una escala ordenada: de 2 a 26 niveles, de menos a más. */
export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}

export type DecisionQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export interface ChoiceAnswer {
  /** La opción más probable. */
  choice: string;
  /** La probabilidad de cada opción. */
  probabilities: Record<string, number>;
}

export interface NoulAnswer {
  /** La probabilidad de que sea que sí. */
  probability: number;
}

export interface ScoreAnswer {
  /** El nivel esperado, con decimales: de 0 (el primero) al último. */
  score: number;
}

type AnswerTo<Q extends DecisionQuestion> = Q extends ChoiceQuestion
  ? ChoiceAnswer
  : Q extends NoulQuestion
    ? NoulAnswer
    : ScoreAnswer;

export type DecisionQuestions = Record<string, DecisionQuestion>;

export type DecisionAnswers<Q extends DecisionQuestions> = { [K in keyof Q]: AnswerTo<Q[K]> };

export interface DecisionRequest<Q extends DecisionQuestions> {
  /** De qué va: lo que el modelo lee para responder. */
  state: string;
  /** Hasta 64, cada una con su clave. */
  questions: Q;
  /** Corta la petición cuando quien la pidió ya no espera la respuesta. */
  signal?: AbortSignal | undefined;
  /** Cuánto se espera como mucho, si no vale lo de siempre. */
  timeoutMs?: number;
}

/** La IA que decide por el máster. En producción es Nimble en Ollama; en los tests, uno de mentira. */
export interface Decider {
  readonly model: string;
  /** Pregunta y devuelve la respuesta a cada pregunta, con la misma clave. */
  decide<Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionAnswers<Q>>;
  /** Corta las peticiones en curso, al apagar el servidor. */
  close(): void;
}

/**
 * La primera vez Ollama tiene que cargar el modelo, y en una máquina en la que no cabe entero
 * en la GPU tarda cerca de un minuto; después, unos segundos.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

// La respuesta viene de fuera: se exige solo lo que se usa de cada tipo de pregunta.
const ANSWER_SCHEMAS = {
  choice: z.object({ choice: z.string(), probabilities: z.record(z.string(), z.number()) }),
  noul: z.object({ noul: z.number().min(0).max(1) }),
  score: z.object({ score: z.number() }),
};

const responseSchema = z.object({ answers: z.record(z.string(), z.unknown()) });

const NOT_UNDERSTOOD = 'Ollama ha respondido algo que no se entiende';

export function createDecider(config: ModelConfig): Decider {
  const connection = connectOllama({
    ...config,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    modelVariable: 'OLLAMA_DECISION_MODEL',
    explain(status, message) {
      // Un Ollama sin el endpoint contesta un 404 en texto, sin JSON.
      if (status === 404 && !message) {
        return 'Tu Ollama es anterior a la 0.35 y no sabe decidir: actualízalo (o revisa que OLLAMA_URL sea la dirección de Ollama).';
      }
      if (status === 400 && /not supported/i.test(message)) {
        return `El modelo «${config.model}» no sabe decidir: OLLAMA_DECISION_MODEL tiene que ser Nimble («ollama pull nimble»).`;
      }
      return undefined;
    },
  });

  /** Lee las respuestas a las preguntas que se hicieron, cada una según su tipo. */
  function answersOf<Q extends DecisionQuestions>(text: string, questions: Q): DecisionAnswers<Q> {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw aiError(502, NOT_UNDERSTOOD, error);
    }
    const parsed = responseSchema.safeParse(data);
    if (!parsed.success) throw aiError(502, NOT_UNDERSTOOD, parsed.error);
    const answers: Record<string, ChoiceAnswer | NoulAnswer | ScoreAnswer> = {};
    for (const [key, question] of Object.entries(questions)) {
      const raw = parsed.data.answers[key];
      switch (question.type) {
        case 'choice': {
          const answer = ANSWER_SCHEMAS.choice.safeParse(raw);
          if (!answer.success) throw aiError(502, NOT_UNDERSTOOD, answer.error);
          answers[key] = answer.data;
          break;
        }
        case 'noul': {
          const answer = ANSWER_SCHEMAS.noul.safeParse(raw);
          if (!answer.success) throw aiError(502, NOT_UNDERSTOOD, answer.error);
          answers[key] = { probability: answer.data.noul };
          break;
        }
        case 'score': {
          const answer = ANSWER_SCHEMAS.score.safeParse(raw);
          if (!answer.success) throw aiError(502, NOT_UNDERSTOOD, answer.error);
          answers[key] = answer.data;
          break;
        }
      }
    }
    return answers as DecisionAnswers<Q>;
  }

  return {
    model: config.model,

    async decide(request) {
      const call: OllamaCall = await connection.post(
        '/v1/systemone',
        { model: config.model, state: request.state, questions: request.questions },
        request,
      );
      try {
        let text: string;
        try {
          text = await call.response.text();
        } catch (error) {
          throw connection.interrupted(call, error);
        }
        return answersOf(text, request.questions);
      } finally {
        call.finish();
      }
    },

    close() {
      connection.close();
    },
  };
}
