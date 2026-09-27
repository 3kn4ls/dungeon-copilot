import {
  loginRequestSchema,
  registerRequestSchema,
  type AuthResponse,
  type MeResponse,
  type PublicUser,
} from '@dungeon-copilot/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hashPassword, verifyPassword } from '../auth/password';
import {
  SESSION_COOKIE,
  SESSION_DURATION_MS,
  createSession,
  deleteSession,
  findSession,
} from '../auth/sessions';
import type { AppContext } from '../context';
import { isUniqueViolation } from '../db/errors';
import { users } from '../db/schema';
import { HttpError, forbidden, parseBody, unauthorized } from '../http/errors';

declare module 'fastify' {
  interface FastifyRequest {
    /** Usuario con sesión iniciada, o null. Lo rellena el hook de autenticación. */
    user: PublicUser | null;
  }
}

export function requireUser(request: FastifyRequest): PublicUser {
  if (!request.user) throw unauthorized();
  return request.user;
}

const WRONG_CREDENTIALS = 'Usuario o contraseña incorrectos';

/** La petición llegó por HTTPS, directamente o a través de un proxy (Traefik en k3s, por ejemplo). */
function isHttps(request: FastifyRequest): boolean {
  const forwarded = request.headers['x-forwarded-proto'];
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return request.protocol === 'https' || proto === 'https';
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Fiarse de X-Forwarded-Proto es seguro aquí: quien lo falsee solo cambia su propia cookie.
  const cookieOptions = (request: FastifyRequest) =>
    ({
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.cookieSecure === 'auto' ? isHttps(request) : ctx.cookieSecure,
      maxAge: SESSION_DURATION_MS / 1000,
    }) as const;

  const startSession = async (reply: FastifyReply, userId: string) => {
    const token = await createSession(ctx.db, userId);
    reply.setCookie(SESSION_COOKIE, token, cookieOptions(reply.request));
  };

  // Hash de relleno: el login tarda lo mismo exista o no el usuario.
  let dummyHash: Promise<string> | undefined;

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await findSession(ctx.db, token);
    if (!session) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return;
    }
    request.user = session.user;
    if (session.renewed) reply.setCookie(SESSION_COOKIE, token, cookieOptions(request));
  });

  app.get('/api/auth/me', async (request): Promise<MeResponse> => {
    return { user: request.user, registrationOpen: ctx.allowRegistration };
  });

  app.post('/api/auth/register', async (request, reply) => {
    if (!ctx.allowRegistration) {
      throw forbidden('El registro de cuentas nuevas está cerrado en este servidor');
    }
    const body = parseBody(registerRequestSchema, request.body, 'Revisa los datos de la cuenta');
    const passwordHash = await hashPassword(body.password, ctx.passwordParams);

    let user: PublicUser | undefined;
    try {
      [user] = await ctx.db
        .insert(users)
        .values({ username: body.username, displayName: body.displayName, passwordHash })
        .returning({ id: users.id, username: users.username, displayName: users.displayName });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, 'Ese nombre de usuario ya existe');
      throw error;
    }
    if (!user) throw new Error('La base de datos no devolvió el usuario creado');

    await startSession(reply, user.id);
    return reply.status(201).send({ user } satisfies AuthResponse);
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = parseBody(loginRequestSchema, request.body, 'Faltan datos para entrar');
    const [row] = await ctx.db.select().from(users).where(eq(users.username, body.username));
    if (!row) {
      dummyHash ??= hashPassword('contraseña de relleno', ctx.passwordParams);
      await verifyPassword(body.password, await dummyHash);
      throw new HttpError(401, WRONG_CREDENTIALS);
    }
    if (!(await verifyPassword(body.password, row.passwordHash))) {
      throw new HttpError(401, WRONG_CREDENTIALS);
    }

    await startSession(reply, row.id);
    const user: PublicUser = { id: row.id, username: row.username, displayName: row.displayName };
    return { user } satisfies AuthResponse;
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(ctx.db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });
}
