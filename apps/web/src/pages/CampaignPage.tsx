import { LUCK_PER_SESSION, SEVERITY_LABELS } from '@dungeon-copilot/rules';
import { ROLE_LABELS, gameName, type CampaignDetail } from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { profileText } from '../components/Npcs';
import { ScreenLink } from '../components/ScreenLink';
import { ConfirmButton, ErrorNote, QueryState, useDocumentTitle } from '../components/ui';
import { keys, useCampaign, useCharacters, useGames, useMe, useNpcs } from '../queries';

export function CampaignPage() {
  const { campaignId = '' } = useParams();
  const campaign = useCampaign(campaignId);
  useDocumentTitle(campaign.data?.name);

  if (!campaign.data) return <QueryState error={campaign.error} />;
  const detail = campaign.data;
  const isMaster = detail.role === 'master';

  return (
    <>
      <header className="masthead">
        <Link to="/campanas" className="eyebrow back">
          ← Campañas
        </Link>
        <h1>
          {detail.name}{' '}
          <span className={`badge role-${detail.role}`}>{ROLE_LABELS[detail.role]}</span>
        </h1>
        {detail.description && <p className="lede prewrap">{detail.description}</p>}
      </header>

      <div className="layout layout-main">
        <div className="stack">
          <Games campaign={detail} />
          <Characters campaignId={detail.id} />
          {isMaster && <Npcs campaignId={detail.id} />}
        </div>
        <div className="side">
          {isMaster && detail.inviteCode && <Invite campaign={detail} />}
          {isMaster && detail.screenToken && (
            <ScreenLink campaignId={detail.id} token={detail.screenToken} />
          )}
          <Members campaign={detail} />
          {isMaster && <MasterTools campaign={detail} />}
        </div>
      </div>
    </>
  );
}

const gameDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

function Games({ campaign }: { campaign: CampaignDetail }) {
  const games = useGames(campaign.id);
  const isMaster = campaign.role === 'master';
  if (!games.data) return <QueryState error={games.error} />;
  const open = games.data.find((game) => game.status === 'open');
  const past = games.data.filter((game) => game.status === 'closed');

  return (
    <section className="panel" aria-labelledby="games-heading">
      <h2 id="games-heading">Partidas</h2>
      {open ? (
        <Link to={`/partidas/${open.id}`} className="card live-card">
          <span className="card-title">
            {gameName(open)} <span className="badge live">En juego</span>
          </span>
          <span className="card-meta">
            {open.title ? `Partida ${open.number} · ` : ''}Empezó el {gameDate(open.openedAt)}
          </span>
          <span className="button primary">Entrar en la sala</span>
        </Link>
      ) : isMaster ? (
        <OpenGame campaignId={campaign.id} />
      ) : (
        <p className="muted">
          No hay ninguna partida en juego. Cuando el máster abra una, aparecerá aquí.
        </p>
      )}
      {past.length > 0 && (
        <>
          <h3>Anteriores</h3>
          <ul className="game-list">
            {past.map((game) => (
              <li key={game.id}>
                <Link to={`/partidas/${game.id}`}>{gameName(game)}</Link>
                <span className="muted">{gameDate(game.openedAt)}</span>
                {game.recap && <p className="game-recap">{game.recap}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
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

function Characters({ campaignId }: { campaignId: string }) {
  const characters = useCharacters(campaignId);
  return (
    <section className="panel" aria-labelledby="characters-heading">
      <div className="panel-heading">
        <h2 id="characters-heading">Personajes</h2>
        <Link to={`/campanas/${campaignId}/personajes/nuevo`} className="button primary small">
          Crear personaje
        </Link>
      </div>
      {characters.data ? (
        characters.data.length > 0 ? (
          <ul className="card-list">
            {characters.data.map((character) => (
              <li key={character.id}>
                <Link to={`/personajes/${character.id}`} className="card">
                  <span className="card-title">{character.name}</span>
                  <span className="card-text">
                    {character.background || 'Sin trasfondo'} · de {character.ownerName}
                  </span>
                  <span className="card-meta">
                    {SEVERITY_LABELS[character.wounds.severity]} · Rasguños{' '}
                    {character.wounds.scratches}/{character.wounds.scratchBoxes} · Suerte{' '}
                    {character.luck} · {character.xp} PX
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Aún no hay personajes. Cada jugador crea el suyo aquí.</p>
        )
      ) : (
        <QueryState error={characters.error} />
      )}
    </section>
  );
}

/** Los PNJ de la campaña. Solo los ve el máster: la mesa los conoce cuando hablan. */
function Npcs({ campaignId }: { campaignId: string }) {
  const npcs = useNpcs(campaignId);
  return (
    <section className="panel" aria-labelledby="npcs-heading">
      <div className="panel-heading">
        <h2 id="npcs-heading">PNJ</h2>
        <Link to={`/campanas/${campaignId}/pnj/nuevo`} className="button primary small">
          Crear PNJ
        </Link>
      </div>
      {npcs.data ? (
        npcs.data.length > 0 ? (
          <ul className="card-list">
            {npcs.data.map((npc) => (
              <li key={npc.id}>
                <Link to={`/pnj/${npc.id}`} className="card">
                  <span className="card-title">
                    {npc.name}
                    {npc.profile && <span className="badge">{profileText(npc.profile)}</span>}
                  </span>
                  {npc.concept && <span className="card-text">{npc.concept}</span>}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            Aún no hay PNJ. Solo los ves tú; en la sala hablas por su boca, con ayuda de la IA.
          </p>
        )
      ) : (
        <QueryState error={npcs.error} />
      )}
    </section>
  );
}

function Invite({ campaign }: { campaign: CampaignDetail }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const regenerate = useMutation({
    mutationFn: () => api.regenerateInviteCode(campaign.id),
    onSuccess: (inviteCode) => {
      queryClient.setQueryData<CampaignDetail>(keys.campaign(campaign.id), (old) =>
        old ? { ...old, inviteCode } : old,
      );
    },
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(campaign.inviteCode ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso para el portapapeles: el código sigue a la vista para copiarlo a mano.
    }
  }

  return (
    <section className="panel" aria-labelledby="invite-heading">
      <h2 id="invite-heading">Invitar jugadores</h2>
      <p className="muted">Pásales este código para que se unan desde su cuenta.</p>
      <p className="invite-code num" aria-label={`Código ${campaign.inviteCode}`}>
        {campaign.inviteCode}
      </p>
      <div className="actions">
        <button type="button" className="button" onClick={copy}>
          {copied ? 'Copiado' : 'Copiar'}
        </button>
        <ConfirmButton
          confirmLabel="¿Seguro? El viejo dejará de valer"
          onConfirm={() => regenerate.mutate()}
          disabled={regenerate.isPending}
        >
          Cambiar código
        </ConfirmButton>
      </div>
      <ErrorNote error={regenerate.error} />
    </section>
  );
}

function Members({ campaign }: { campaign: CampaignDetail }) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMaster = campaign.role === 'master';

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(campaign.id, userId),
    onSuccess: async (_, userId) => {
      if (userId === me?.user?.id) {
        queryClient.removeQueries({ queryKey: keys.campaign(campaign.id) });
        await queryClient.invalidateQueries({ queryKey: keys.campaigns, exact: true });
        await navigate('/campanas');
      } else {
        await queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) });
      }
    },
  });

  return (
    <section className="panel" aria-labelledby="members-heading">
      <h2 id="members-heading">Mesa</h2>
      <ul className="member-list">
        {campaign.members.map((member) => (
          <li key={member.userId}>
            <span>
              {member.displayName} <span className="muted">@{member.username}</span>
            </span>
            <span className="member-actions">
              <span className={`badge role-${member.role}`}>{ROLE_LABELS[member.role]}</span>
              {isMaster && member.role === 'player' && (
                <ConfirmButton
                  confirmLabel="¿Echar?"
                  onConfirm={() => remove.mutate(member.userId)}
                  disabled={remove.isPending}
                >
                  Echar
                </ConfirmButton>
              )}
            </span>
          </li>
        ))}
      </ul>
      {!isMaster && me?.user && (
        <ConfirmButton
          confirmLabel="¿Seguro? Tus personajes se quedan aquí"
          onConfirm={() => remove.mutate(me.user!.id)}
          disabled={remove.isPending}
        >
          Salir de la campaña
        </ConfirmButton>
      )}
      <ErrorNote error={remove.error} />
    </section>
  );
}

function MasterTools({ campaign }: { campaign: CampaignDetail }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const save = useMutation({
    mutationFn: () => api.updateCampaign(campaign.id, { name, description }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(keys.campaign(campaign.id), updated);
      await queryClient.invalidateQueries({ queryKey: keys.campaigns, exact: true });
      setEditing(false);
    },
  });
  const destroy = useMutation({
    mutationFn: () => api.deleteCampaign(campaign.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: keys.campaign(campaign.id) });
      await queryClient.invalidateQueries({ queryKey: keys.campaigns, exact: true });
      await navigate('/campanas');
    },
  });

  return (
    <section className="panel" aria-labelledby="tools-heading">
      <h2 id="tools-heading">Ajustes de la campaña</h2>
      {editing ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label className="field">
            <span className="field-label">Nombre</span>
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">De qué va</span>
            <textarea
              rows={4}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <ErrorNote error={save.error} />
          <div className="actions">
            <button type="submit" className="button primary" disabled={save.isPending}>
              Guardar
            </button>
            <button type="button" className="button" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              setName(campaign.name);
              setDescription(campaign.description);
              setEditing(true);
            }}
          >
            Editar nombre y descripción
          </button>
          <ConfirmButton
            confirmLabel="¿Borrar con todos sus personajes?"
            onConfirm={() => destroy.mutate()}
            disabled={destroy.isPending}
          >
            Borrar campaña
          </ConfirmButton>
        </div>
      )}
      <ErrorNote error={destroy.error} />
    </section>
  );
}
