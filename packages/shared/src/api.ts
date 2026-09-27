/** Un problema concreto de una petición: qué campo y qué le pasa. */
export interface ApiIssue {
  path: string;
  message: string;
}

/** Cuerpo de todas las respuestas de error de la API. */
export interface ApiErrorBody {
  error: string;
  issues?: ApiIssue[];
}
