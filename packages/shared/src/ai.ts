/** Si el servidor tiene IA (Ollama) y con qué modelo. */
export interface AiStatus {
  enabled: boolean;
  model: string | null;
}

/**
 * Lo que escribe la IA llega en directo, una línea JSON por trozo: "delta" con el texto nuevo
 * según lo escribe, y al final "done" con el texto entero ya limpio, o "error".
 */
export type AiTextChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: string };
