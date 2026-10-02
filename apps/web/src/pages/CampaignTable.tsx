import { ROLE_LABELS, type CampaignDetail } from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { Avatar } from '../components/Avatar';
import { ScreenLink } from '../components/ScreenLink';
import { ConfirmButton, ErrorNote } from '../components/ui';
import { rememberCampaign } from '../current-campaign';
import { keys, useCharacters, useMe } from '../queries';
import { useCampaignOutlet } from './CampaignPage';

/** La mesa: quién juega, cómo invitar, la pantalla y los ajustes de la campaña. */
export function CampaignTable() {
  const { campaign } = useCampaignOutlet();
  const isMaster = campaign.role === 'master';
  return (
    <div className="table-grid">
      <Members campaign={campaign} />
      {isMaster && campaign.inviteCode && <Invite campaign={campaign} />}
      {isMaster && campaign.screenToken && (
        <ScreenLink campaignId={campaign.id} token={campaign.screenToken} />
      )}
      {isMaster && <MasterTools campaign={campaign} />}
    </div>
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
  const characters = useCharacters(campaign.id).data ?? [];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMaster = campaign.role === 'master';

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(campaign.id, userId),
    onSuccess: async (_, userId) => {
      if (userId === me?.user?.id) {
        rememberCampaign(null);
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
      <h2 id="members-heading">Quién juega</h2>
      <ul className="member-list">
        {campaign.members.map((member) => {
          const theirs = characters.filter((character) => character.ownerId === member.userId);
          return (
            <li key={member.userId}>
              <Avatar name={member.displayName} />
              <span className="member-name">
                <strong>{member.displayName}</strong>{' '}
                <span className="muted">@{member.username}</span>
                {theirs.length > 0 && (
                  <span className="member-characters">
                    Juega con {theirs.map((character) => character.name).join(', ')}
                  </span>
                )}
              </span>
              <span className="member-actions">
                <span className={`badge role-${member.role}`}>{ROLE_LABELS[member.role]}</span>
                {isMaster && member.role === 'player' && (
                  <ConfirmButton
                    confirmLabel="¿Echar?"
                    onConfirm={() => remove.mutate(member.userId)}
                    disabled={remove.isPending}
                    small
                  >
                    Echar
                  </ConfirmButton>
                )}
              </span>
            </li>
          );
        })}
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
      rememberCampaign(null);
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
