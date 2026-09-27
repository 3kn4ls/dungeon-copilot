import type { ApiErrorBody, ApiIssue } from '@dungeon-copilot/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { z } from 'zod';

/** Error con un código HTTP y un mensaje en español que se puede enseñar tal cual. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly issues: ApiIssue[] | undefined;

  constructor(statusCode: number, message: string, issues?: ApiIssue[]) {
    super(message);
    this.statusCode = statusCode;
    this.issues = issues;
  }
}

export const unauthorized = () => new HttpError(401, 'Necesitas iniciar sesión');
export const forbidden = (message: string) => new HttpError(403, message);
export const notFound = (message: string) => new HttpError(404, message);

export function toIssues(error: z.ZodError): ApiIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/** Valida el cuerpo de una petición; si no cuadra, responde 400 con la lista de problemas. */
export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
  message = 'Los datos no son válidos',
): z.output<S> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, message, toIssues(parsed.error));
  return parsed.data;
}

const uuidSchema = z.uuid();

/** Un id mal formado se trata como uno que no existe. */
export function parseId(value: unknown, notFoundMessage: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw notFound(notFoundMessage);
  return parsed.data;
}

const CLIENT_ERROR_MESSAGES: Record<string, string> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'La API solo acepta JSON',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'Falta el cuerpo de la petición',
  FST_ERR_CTP_INVALID_JSON_BODY: 'El cuerpo de la petición no es JSON válido',
  FST_ERR_CTP_BODY_TOO_LARGE: 'La petición es demasiado grande',
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError | HttpError>((error, request, reply) => {
    if (error instanceof HttpError) {
      const body: ApiErrorBody = { error: error.message };
      if (error.issues) body.issues = error.issues;
      return reply.status(error.statusCode).send(body);
    }
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      const message = CLIENT_ERROR_MESSAGES[error.code] ?? 'La petición no es válida';
      return reply.status(statusCode).send({ error: message } satisfies ApiErrorBody);
    }
    request.log.error(error);
    return reply
      .status(500)
      .send({ error: 'Algo ha fallado en el servidor' } satisfies ApiErrorBody);
  });
}
