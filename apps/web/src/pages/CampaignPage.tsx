import { LUCK_PER_SESSION } from '@dungeon-copilot/rules';
import {
  ROLE_LABELS,
  gameName,
  type CampaignDetail,
  type CharacterView,
  type GameSummary,
} from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router';
import { api } from '../api';
import { Avatar, toneOf } from '../components/Avatar';
import { Emblem } from '../components/Emblem';
import { Icon } from '../components/Icon';
import { AttributeRow, LuckPips, WoundsMini } from '../components/Sheet';
import { ErrorNote, QueryState, useDocumentTitle } from '../components/ui';
import { useRememberCampaign } from '../current-campaign';
import { keys, useCampaign, useCharacters, useGames, useMe } from '../queries';

/** Lo que la campaña pasa a sus pestañas. */
interface CampaignOutlet {
  campaign: CampaignDetail;
}

export const useCampaignOutlet = () => useOutletContext<CampaignOutlet>();

/**
 * La campaña: su cabecera (con la partida en juego, si la hay) y sus pestañas, cada una con su
 * ruta: Crónica, Personajes, PNJ y Mapas (solo el máster) y Mesa.
 */
export function CampaignPage() {
  const { campaignId = '' } = useParams();
  const campaign = useCampaign(campaignId);
  const games = useGames(campaignId);
  useRememberCampaign(campaign.data?.id);
  useDocumentTitle(campaign.data?.name);

  if (!campaign.data) return <QueryState error={campaign.error} />;
  const detail = campaign.data;
  const open = games.data?.find((game) => game.status === 'open');
  const base = `/campanas/${detail.id}`;

  return (
    <>
      <header className="campaign-head">
        <Emblem name={detail.name} large />
        <div className="campaign-title">
          <Link to="/campanas" className="eyebrow back">
            ← Campañas
          </Link>
          <h1>
            {detail.name}{' '}
            <span className={`badge role-${detail.role}`}>{ROLE_LABELS[detail.role]}</span>
          </h1>
          {detail.description && <p className="lede prewrap">{detail.description}</p>}
        </div>
        {open && (
          <div className="campaign-live">
            <span className="badge live">{gameName(open)}, en juego</span>
            <Link to={`/partidas/${open.id}`} className="button primary">
              <Icon name="room" size={18} />
              Entrar en la sala
            </Link>
          </div>
        )}
      </header>

      <nav className="tabs" aria-label="Secciones de la campaña">
        <NavLink to={base} end>
          <Icon name="chronicle" size={18} />
          Crónica
        </NavLink>
        <NavLink to={`${base}/personajes`}>
          <Icon name="characters" size={18} />
          Personajes
        </NavLink>
        {detail.role === 'master' && (
          <>
            <NavLink to={`${base}/pnj`}>
              <Icon name="npcs" size={18} />
              PNJ
            </NavLink>
            <NavLink to={`${base}/mapas`}>
              <Icon name="map" size={18} />
              Mapas
            </NavLink>
          </>
        )}
        <NavLink to={`${base}/mesa`}>
          <Icon name="campaign" size={18} />
          Mesa
        </NavLink>
      </nav>

      <Outlet context={{ campaign: detail } satisfies CampaignOutlet} />
    </>
  );
}

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

/** Las partidas, de la última a la primera, con lo que pasó en cada una. */
export function CampaignChronicle() {
  const { campaign } = useCampaignOutlet();
  const games = useGames(campaign.id);
  const isMaster = campaign.role === 'master';
  if (!games.data) return <QueryState error={games.error} />;
  const open = games.data.find((game) => game.status === 'open');

  return (
    <div className="chronicle">
      <section aria-labelledby="chronicle-heading">
        <h2 id="chronicle-heading" className="visually-hidden">
          Crónica
        </h2>
        {games.data.length > 0 ? (
          <ol className="timeline">
            {games.data.map((game) => (
              <ChronicleEntry key={game.id} game={game} isMaster={isMaster} />
            ))}
          </ol>
        ) : (
          <div className="panel empty">
            <p>Aún no habéis jugado ninguna partida.</p>
            <p className="muted">
              {isMaster
                ? 'Ábrela aquí al lado cuando empecéis.'
                : 'Cuando el máster abra una, aparecerá aquí.'}
            </p>
          </div>
        )}
      </section>
      {isMaster && (
        <aside className="side">
          <section className="panel" aria-labelledby="open-heading">
            <h2 id="open-heading">Abrir partida</h2>
            {open ? (
              <p className="muted">
                Ya hay una en juego. Termínala desde la sala para abrir la siguiente.
              </p>
            ) : (
              <OpenGame campaignId={campaign.id} />
            )}
          </section>
        </aside>
      )}
    </div>
  );
}

function ChronicleEntry({ game, isMaster }: { game: GameSummary; isMaster: boolean }) {
  const live = game.status === 'open';
  return (
    <li className={live ? 'timeline-item live' : 'timeline-item'}>
      <span className="timeline-mark num" aria-hidden="true">
        {game.number}
      </span>
      <div className="timeline-body">
        <p className="eyebrow">
          Partida {game.number} · {longDate(game.openedAt)}
        </p>
        <h3>
          <Link to={`/partidas/${game.id}`}>{gameName(game)}</Link>{' '}
          {live && <span className="badge live">En juego</span>}
        </h3>
        {live ? (
          <Link to={`/partidas/${game.id}`} className="button primary">
            <Icon name="room" size={18} />
            Entrar en la sala
          </Link>
        ) : game.recap ? (
          <p className="recap-text prewrap">{game.recap}</p>
        ) : (
          <p className="muted">
            Sin resumen.{isMaster ? ' Puedes escribirlo desde la partida.' : ''}
          </p>
        )}
      </div>
    </li>
  );
}

function OpenGame({ campaignId }: { campaignId: string }) {
  const [title, setTitle] = useState('');
  const [refillLuck, setRefillLuck] = useState(true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const open = useMutation({
    mutationFn: () => api.openGame(campaignId, { title, refillLuck }),
    onSuccess: async (game) => {
      // Al abrir se recarga la Suerte: las fichas guardadas ya no están al día.
      await queryClient.invalidateQueries({ queryKey: keys.campaign(campaignId) });
      void queryClient.invalidateQueries({ queryKey: ['characters'] });
      void queryClient.invalidateQueries({ queryKey: keys.campaigns, exact: true });
      await navigate(`/partidas/${game.id}`);
    },
  });

  return (
    <form
      className="stack tight"
      onSubmit={(event) => {
        event.preventDefault();
        open.mutate();
      }}
    >
      <p className="muted">
        Abre la sala de la partida: los jugadores verán en vivo lo que enseñes y las tiradas.
      </p>
      <label className="field">
        <span className="field-label">Título (opcional)</span>
        <input
          value={title}
          maxLength={100}
          placeholder="La cripta del rey olvidado"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={refillLuck}
          onChange={(e) => setRefillLuck(e.target.checked)}
        />
        Todos los personajes empiezan con {LUCK_PER_SESSION} de Suerte
      </label>
      <ErrorNote error={open.error} />
      <button type="submit" className="button primary" disabled={open.isPending}>
        Abrir partida
      </button>
    </form>
  );
}

/** Los personajes de la campaña, cada uno con su color, sus atributos y cómo está. */
export function CampaignCharacters() {
  const { campaign } = useCampaignOutlet();
  const characters = useCharacters(campaign.id);
  const { data: me } = useMe();

  return (
    <section className="stack" aria-labelledby="characters-heading">
      <div className="section-head">
        <h2 id="characters-heading" className="visually-hidden">
          Personajes
        </h2>
        <p className="muted">
          Cada jugador crea aquí el suyo. Las fichas las cambian su dueño y el máster.
        </p>
        <Link to={`/campanas/${campaign.id}/personajes/nuevo`} className="button primary">
          <Icon name="plus" size={18} />
          Crear personaje
        </Link>
      </div>
      {characters.data ? (
        characters.data.length > 0 ? (
          <ul className="character-grid">
            {characters.data.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                mine={character.ownerId === me?.user?.id}
              />
            ))}
          </ul>
        ) : (
          <div className="panel empty">
            <p>Aún no hay personajes.</p>
          </div>
        )
      ) : (
        <QueryState error={characters.error} />
      )}
    </section>
  );
}

function CharacterCard({ character, mine }: { character: CharacterView; mine: boolean }) {
  const { wounds, luck } = character;
  return (
    <li className="character-card" style={{ '--tone': toneOf(character.id) } as CSSProperties}>
      <div className="character-card-top">
        <Avatar name={character.name} id={character.id} size="large" />
        <div>
          <h3>
            <Link to={`/personajes/${character.id}`} className="stretched">
              {character.name}
            </Link>
          </h3>
          <p className="muted">
            {character.background || 'Sin trasfondo'} · {mine ? 'tuyo' : character.ownerName}
          </p>
        </div>
      </div>
      <AttributeRow attributes={character.attributes} />
      <div className="character-card-state">
        <WoundsMini wounds={wounds} />
        <LuckPips luck={luck} />
        <span className="muted">{character.xp} PX</span>
      </div>
    </li>
  );
}
