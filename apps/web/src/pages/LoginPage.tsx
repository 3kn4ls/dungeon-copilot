import type { MeResponse } from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { ErrorNote, Segmented, useDocumentTitle } from '../components/ui';
import { keys, useMe } from '../queries';

type Mode = 'login' | 'register';

/** Solo se vuelve a rutas de esta web, nunca a otra dirección. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/campanas';
}

export function LoginPage() {
  const { data: me } = useMe();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  useDocumentTitle(mode === 'login' ? 'Entrar' : 'Crear cuenta');

  const registrationOpen = me?.registrationOpen ?? true;
  const activeMode: Mode = registrationOpen ? mode : 'login';

  const submit = useMutation({
    mutationFn: () =>
      activeMode === 'login'
        ? api.login({ username, password })
        : api.register({ username, displayName, password }),
    onSuccess: async ({ user }) => {
      queryClient.setQueryData<MeResponse>(keys.me, { user, registrationOpen });
      await navigate(next, { replace: true });
    },
  });

  if (me?.user) return <Navigate to={next} replace />;

  return (
    <div className="auth">
      <header className="masthead">
        <p className="eyebrow">Dungeon Copilot</p>
        <h1>{activeMode === 'login' ? 'Entrar' : 'Crear cuenta'}</h1>
        <p className="lede">
          {activeMode === 'login'
            ? 'Con tu usuario y contraseña. Sin correo, sin complicaciones.'
            : 'Solo un nombre de usuario, el nombre que verá la mesa y una contraseña.'}
        </p>
      </header>

      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          submit.mutate();
        }}
      >
        {registrationOpen ? (
          <Segmented
            label="¿Tienes cuenta?"
            value={activeMode}
            options={[
              ['login', 'Ya tengo cuenta'],
              ['register', 'Soy nuevo'],
            ]}
            onChange={(value) => {
              setMode(value);
              submit.reset();
            }}
          />
        ) : (
          <p className="muted">El registro de cuentas nuevas está cerrado en este servidor.</p>
        )}

        <label className="field">
          <span className="field-label">Usuario</span>
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        {activeMode === 'register' && (
          <label className="field">
            <span className="field-label">Nombre que verán los demás</span>
            <input
              name="displayName"
              autoComplete="nickname"
              required
              maxLength={60}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        )}

        <label className="field">
          <span className="field-label">Contraseña</span>
          <input
            name="password"
            type="password"
            autoComplete={activeMode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={activeMode === 'register' ? 8 : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {activeMode === 'register' && <span className="hint">Al menos 8 caracteres.</span>}
        </label>

        <ErrorNote error={submit.error} />

        <button type="submit" className="button primary" disabled={submit.isPending}>
          {submit.isPending ? 'Un momento…' : activeMode === 'login' ? 'Entrar' : 'Crear cuenta'}
        </button>
      </form>
    </div>
  );
}
