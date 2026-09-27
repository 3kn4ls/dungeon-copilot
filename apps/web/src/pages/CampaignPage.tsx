import { SEVERITY_LABELS } from '@dungeon-copilot/rules';
import { ROLE_LABELS, type CampaignDetail } from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { ConfirmButton, ErrorNote, QueryState, useDocumentTitle } from '../components/ui';
import { keys, useCampaign, useCharacters, useMe } from '../queries';

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
        <Characters campaignId={detail.id} />
        <div className="side">
          {isMaster && detail.inviteCode && <Invite campaign={detail} />}
          <Members campaign={detail} />
          {isMaster && <MasterTools campaign={detail} />}
        </div>
      </div>
    </>
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
