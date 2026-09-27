import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import { useMe } from '../queries';

export function Layout() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function logout() {
    await api.logout().catch(() => undefined);
    queryClient.clear();
    await navigate('/entrar');
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/campanas" className="brand">
            Dungeon Copilot
          </Link>
          <nav className="nav" aria-label="Principal">
            {me?.user && <NavLink to="/campanas">Campañas</NavLink>}
            <NavLink to="/tirador">Tirador</NavLink>
          </nav>
          <div className="account">
            {me?.user ? (
              <>
                <span className="account-name">{me.user.displayName}</span>
                <button type="button" className="button small" onClick={logout}>
                  Salir
                </button>
              </>
            ) : (
              <Link to="/entrar" className="button small">
                Entrar
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}

/** Pantallas que necesitan sesión: sin ella, lleva a /entrar y vuelve después. */
export function RequireAuth() {
  const { data: me, isPending } = useMe();
  const location = useLocation();
  if (isPending) return <p className="muted loading">Cargando…</p>;
  if (!me?.user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/entrar?next=${next}`} replace />;
  }
  return <Outlet />;
}
