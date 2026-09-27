import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { sessions, users } from '../db/schema';
import {
  TEST_PASSWORD,
  TEST_PASSWORD_PARAMS,
  createClient,
  sessionCookie,
  useTestApp,
} from '../testing';

const t = useTestApp();

describe('registro', () => {
  it('crea la cuenta, inicia sesión y no devuelve la contraseña', async () => {
    const client = t.anonymous();
    const response = await client.post('/api/auth/register', {
      username: 'Edu',
      displayName: 'Edu el Máster',
      password: TEST_PASSWORD,
    });

    expect(response.statusCode).toBe(201);
    const { user } = response.json();
    expect(user).toEqual({ id: expect.any(String), username: 'edu', displayName: 'Edu el Máster' });

    const cookie = response.cookies.find((c) => c.name === 'dc_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);

    client.cookie = sessionCookie(response);
    expect((await client.get('/api/auth/me')).json()).toEqual({ user, registrationOpen: true });
  });

  it('marca la cookie como segura cuando la petición llega por HTTPS a través de un proxy', async () => {
    const register = (username: string, headers: Record<string, string>) =>
      t.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers,
        payload: { username, displayName: username, password: TEST_PASSWORD },
      });
    const secure = await register('edu', { 'x-forwarded-proto': 'https' });
    const plain = await register('ana', {});
    expect(secure.cookies.find((c) => c.name === 'dc_session')?.secure).toBe(true);
    expect(plain.cookies.find((c) => c.name === 'dc_session')?.secure).toBeUndefined();
  });

  it('guarda la contraseña cifrada con scrypt', async () => {
    await t.register('edu');
    const [row] = await t.db.select().from(users).where(eq(users.username, 'edu'));
    expect(row?.passwordHash).toMatch(/^scrypt\$1024\$8\$1\$/);
    expect(row?.passwordHash).not.toContain(TEST_PASSWORD);
  });

  it('no permite dos cuentas con el mismo nombre, sin distinguir mayúsculas', async () => {
    await t.register('edu');
    const response = await t.anonymous().post('/api/auth/register', {
      username: ' EDU ',
      displayName: 'Otro Edu',
      password: TEST_PASSWORD,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'Ese nombre de usuario ya existe' });
  });

  it('explica qué campos están mal', async () => {
    const response = await t.anonymous().post('/api/auth/register', {
      username: 'e d',
      displayName: '',
      password: 'corta',
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('Revisa los datos de la cuenta');
    expect(body.issues.map((issue: { path: string }) => issue.path).sort()).toEqual([
      'displayName',
      'password',
      'username',
    ]);
  });

  it('se puede cerrar con ALLOW_REGISTRATION=false', async () => {
    const app = await buildApp({
      db: t.db,
      allowRegistration: false,
      passwordParams: TEST_PASSWORD_PARAMS,
    });
    const client = createClient(app);
    const response = await client.post('/api/auth/register', {
      username: 'edu',
      displayName: 'Edu',
      password: TEST_PASSWORD,
    });
    expect(response.statusCode).toBe(403);
    expect((await client.get('/api/auth/me')).json()).toEqual({
      user: null,
      registrationOpen: false,
    });
  });
});

describe('inicio y cierre de sesión', () => {
  it('entra con usuario y contraseña, sin importar mayúsculas en el usuario', async () => {
    await t.register('edu', 'Edu');
    const client = t.anonymous();
    const response = await client.post('/api/auth/login', {
      username: 'EDU',
      password: TEST_PASSWORD,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ username: 'edu', displayName: 'Edu' });

    client.cookie = sessionCookie(response);
    expect((await client.get('/api/auth/me')).json().user.username).toBe('edu');
  });

  it('da el mismo error si falla la contraseña o si el usuario no existe', async () => {
    await t.register('edu');
    const wrongPassword = await t.anonymous().post('/api/auth/login', {
      username: 'edu',
      password: 'otra-contraseña',
    });
    const unknownUser = await t.anonymous().post('/api/auth/login', {
      username: 'nadie',
      password: TEST_PASSWORD,
    });
    for (const response of [wrongPassword, unknownUser]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Usuario o contraseña incorrectos' });
      expect(sessionCookie(response)).toBeUndefined();
    }
  });

  it('al salir, la cookie deja de servir', async () => {
    const client = await t.register('edu');
    const oldCookie = client.cookie;

    const response = await client.post('/api/auth/logout');
    expect(response.statusCode).toBe(204);
    expect(response.cookies.find((c) => c.name === 'dc_session')?.value).toBe('');

    const reused = createClient(t.app, oldCookie);
    expect((await reused.get('/api/auth/me')).json().user).toBeNull();
    expect((await reused.get('/api/campaigns')).statusCode).toBe(401);
  });

  it('sin sesión, /me responde con user null y las rutas privadas con 401', async () => {
    const client = t.anonymous();
    expect((await client.get('/api/auth/me')).json()).toEqual({
      user: null,
      registrationOpen: true,
    });
    const response = await client.get('/api/campaigns');
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Necesitas iniciar sesión' });
  });

  it('borra una cookie que no corresponde a ninguna sesión', async () => {
    const client = createClient(t.app, 'dc_session=inventada');
    const response = await client.get('/api/auth/me');
    expect(response.json().user).toBeNull();
    expect(response.cookies.find((c) => c.name === 'dc_session')?.value).toBe('');
  });

  it('las sesiones caducadas no sirven', async () => {
    const client = await t.register('edu');
    await t.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await client.get('/api/auth/me')).json().user).toBeNull();
  });

  it('renueva la sesión cuando le queda poco y se sigue usando', async () => {
    const client = await t.register('edu');
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await t.db.update(sessions).set({ expiresAt: soon });

    const response = await client.get('/api/auth/me');
    expect(response.json().user.username).toBe('edu');
    expect(sessionCookie(response)).toBe(client.cookie);

    const [session] = await t.db.select().from(sessions);
    expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  });
});
