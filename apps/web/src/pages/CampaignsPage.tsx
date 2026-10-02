import { INVITE_CODE_LENGTH, ROLE_LABELS } from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { Emblem } from '../components/Emblem';
import { Icon } from '../components/Icon';
import { ErrorNote, QueryState, useDocumentTitle } from '../components/ui';
import { keys, useCampaigns } from '../queries';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function CampaignsPage() {
  const campaigns = useCampaigns();
  useDocumentTitle('Campañas');

  return (
    <>
      <header className="masthead">
        <p className="eyebrow">Dungeon Copilot</p>
        <h1>Tus campañas</h1>
        <p className="lede">
          El máster crea la campaña y comparte su código; los jugadores se unen con él y crean ahí
          sus personajes.
        </p>
      </header>

      <div className="layout layout-main">
        <section aria-labelledby="campaigns-heading" className="stack">
          <h2 id="campaigns-heading" className="visually-hidden">
            Campañas
          </h2>
          {campaigns.data ? (
            campaigns.data.length > 0 ? (
              <ul className="campaign-grid">
                {campaigns.data.map((campaign) => (
                  <li
                    key={campaign.id}
                    className={campaign.openGameId ? 'campaign-card live' : 'campaign-card'}
                  >
                    <div className="campaign-card-top">
                      <Emblem name={campaign.name} />
                      <span className="badges">
                        <span className={`badge role-${campaign.role}`}>
                          {ROLE_LABELS[campaign.role]}
                        </span>
                        {campaign.openGameId && <span className="badge live">En juego</span>}
                      </span>
                    </div>
                    <h3>
                      {/* Toda la tarjeta lleva a la campaña; el botón de la sala va encima. */}
                      <Link to={`/campanas/${campaign.id}`} className="stretched">
                        {campaign.name}
                      </Link>
                    </h3>
                    {campaign.description && <p className="card-text">{campaign.description}</p>}
                    <p className="card-meta">
                      {plural(campaign.memberCount, 'persona', 'personas')} ·{' '}
                      {plural(campaign.characterCount, 'personaje', 'personajes')}
                    </p>
                    {campaign.openGameId && (
                      <Link to={`/partidas/${campaign.openGameId}`} className="button primary">
                        <Icon name="room" size={18} />
                        Entrar en la sala
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="panel empty">
                <p>Todavía no tienes campañas.</p>
                <p className="muted">
                  Crea una si vas a dirigir, o únete con el código que te pase tu máster.
                </p>
              </div>
            )
          ) : (
            <QueryState error={campaigns.error} />
          )}
        </section>

        <div className="side">
          <CreateCampaign />
          <JoinCampaign />
        </div>
      </div>
    </>
  );
}

function CreateCampaign() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => api.createCampaign({ name, description }),
    onSuccess: async (campaign) => {
      queryClient.setQueryData(keys.campaign(campaign.id), campaign);
      await queryClient.invalidateQueries({ queryKey: keys.campaigns, exact: true });
      await navigate(`/campanas/${campaign.id}`);
    },
  });

  return (
    <form
      className="panel"
      aria-labelledby="create-heading"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <h2 id="create-heading">Crear campaña</h2>
      <label className="field">
        <span className="field-label">Nombre</span>
        <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">De qué va (opcional)</span>
        <textarea
          rows={3}
          maxLength={5000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <ErrorNote error={create.error} />
      <button type="submit" className="button primary" disabled={create.isPending}>
        Crear y ser su máster
      </button>
    </form>
  );
}

function JoinCampaign() {
  const [code, setCode] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const join = useMutation({
    mutationFn: () => api.joinCampaign({ inviteCode: code }),
    onSuccess: async (campaign) => {
      await queryClient.invalidateQueries({ queryKey: keys.campaigns });
      await navigate(`/campanas/${campaign.id}`);
    },
  });

  return (
    <form
      className="panel"
      aria-labelledby="join-heading"
      onSubmit={(event) => {
        event.preventDefault();
        join.mutate();
      }}
    >
      <h2 id="join-heading">Unirse con código</h2>
      <label className="field">
        <span className="field-label">Código que te ha pasado el máster</span>
        <input
          className="code-input"
          required
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={INVITE_CODE_LENGTH + 2}
          placeholder="K7PX3M"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </label>
      <ErrorNote error={join.error} />
      <button type="submit" className="button" disabled={join.isPending}>
        Unirse
      </button>
    </form>
  );
}
