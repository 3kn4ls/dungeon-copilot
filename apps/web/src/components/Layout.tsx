import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import { rememberCampaign, useCurrentCampaignId } from '../current-campaign';
import { useCampaigns, useMe } from '../queries';
import { THEME_LABELS, useTheme, type Theme } from '../theme';
import { Icon, type IconName } from './Icon';

/**
 * El armazón: el raíl de navegación a la izquierda (abajo en el móvil) y la página. La campaña y
 * su sala salen cuando se ha visitado una campaña de la que se es miembro.
 */
export function Layout() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const campaignId = useCurrentCampaignId();
  // Sale si sigue siendo miembro: la lista dice también si tiene una partida en juego.
  const campaign = useCampaigns(!!me?.user).data?.find((summary) => summary.id === campaignId);

  async function logout() {
    await api.logout().catch(() => undefined);
    rememberCampaign(null);
    queryClient.clear();
    await navigate('/entrar');
  }

  return (
    <div className="shell">
      <nav className="rail" aria-label="Principal">
        <Link to="/campanas" className="rail-brand" aria-label="Dungeon Copilot: tus campañas">
          DC
        </Link>
        {me?.user && <RailLink to="/campanas" end icon="campaigns" label="Campañas" />}
        {campaign && (
          <RailLink
            to={`/campanas/${campaign.id}`}
            icon="campaign"
            label="Campaña"
            title={campaign.name}
          />
        )}
        {campaign?.openGameId && (
          <RailLink
            to={`/partidas/${campaign.openGameId}`}
            icon="room"
            label="Sala"
            title={`La partida en juego de ${campaign.name}`}
          />
        )}
        <RailLink to="/tirador" icon="dice" label="Tirador" />
        <span className="rail-spacer" />
        <ThemeButton />
        {me?.user ? (
          <button
            type="button"
            className="rail-item"
            title={`Has entrado como ${me.user.displayName}`}
            onClick={logout}
          >
            <Icon name="exit" />
            <span>Salir</span>
          </button>
        ) : (
          <RailLink to="/entrar" icon="enter" label="Entrar" />
        )}
      </nav>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}

function RailLink(props: {
  to: string;
  icon: IconName;
  label: string;
  title?: string;
  end?: boolean;
}) {
  return (
    <NavLink to={props.to} end={props.end} className="rail-item" title={props.title}>
      <Icon name={props.icon} />
      <span>{props.label}</span>
    </NavLink>
  );
}

const NEXT_THEME: Record<Theme, Theme> = { system: 'dark', dark: 'light', light: 'system' };
const THEME_ICONS: Record<Theme, IconName> = { system: 'system', dark: 'moon', light: 'sun' };

/** Pasa por los tres temas: el del sistema, oscuro y claro. */
function ThemeButton() {
  const [theme, setTheme] = useTheme();
  const next = NEXT_THEME[theme];
  return (
    <button
      type="button"
      className="rail-item"
      aria-label={`Tema: ${THEME_LABELS[theme]}. Cambiar a ${THEME_LABELS[next]}`}
      title={`Tema: ${THEME_LABELS[theme]}`}
      onClick={() => setTheme(next)}
    >
      <Icon name={THEME_ICONS[theme]} />
      <span>Tema</span>
    </button>
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
