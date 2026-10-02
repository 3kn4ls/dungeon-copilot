import type { NpcDraft, NpcView } from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, Outlet, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { Avatar } from '../components/Avatar';
import { Drawer } from '../components/Drawer';
import { Icon } from '../components/Icon';
import { NpcChat } from '../components/NpcChat';
import { NpcFields, NpcGenerator, NpcSheet, emptyNpc, profileText } from '../components/Npcs';
import { ConfirmButton, ErrorNote, PageMessage, QueryState } from '../components/ui';
import { keys, useAiStatus, useNpc, useNpcs, useStoreNpc } from '../queries';
import { useCampaignOutlet } from './CampaignPage';

/**
 * Los PNJ de la campaña. Solo los ve el máster: la mesa los conoce cuando hablan. Cada uno se
 * abre en un panel lateral (`pnj/:npcId`), y uno nuevo se crea en otro (`pnj/nuevo`).
 */
export function CampaignNpcs() {
  const { campaign } = useCampaignOutlet();
  const isMaster = campaign.role === 'master';
  const npcs = useNpcs(campaign.id, isMaster);

  if (!isMaster) {
    return (
      <PageMessage title="Los PNJ son cosa del máster">
        <p className="muted">Los conocerás en la partida, cuando hablen.</p>
      </PageMessage>
    );
  }

  return (
    <section className="stack" aria-labelledby="npcs-heading">
      <div className="section-head">
        <h2 id="npcs-heading" className="visually-hidden">
          PNJ
        </h2>
        <p className="muted">
          Solo los ves tú. En la sala hablas por su boca, con ayuda de la IA, que sabe lo que
          ocultan pero no lo cuenta sin motivo.
        </p>
        <Link to={`/campanas/${campaign.id}/pnj/nuevo`} className="button primary">
          <Icon name="plus" size={18} />
          Crear PNJ
        </Link>
      </div>
      {npcs.data ? (
        npcs.data.length > 0 ? (
          <ul className="npc-grid">
            {npcs.data.map((npc) => (
              <li key={npc.id}>
                <Link to={`/campanas/${campaign.id}/pnj/${npc.id}`} className="npc-card">
                  <Avatar name={npc.name} size="large" />
                  <span className="npc-card-text">
                    <strong>{npc.name}</strong>
                    {npc.concept && <span className="muted">{npc.concept}</span>}
                  </span>
                  <span className="badges">
                    <span className="badge">
                      {npc.profile ? profileText(npc.profile) : 'No pelea'}
                    </span>
                    {npc.secrets.trim() && (
                      <span className="badge secret">
                        <Icon name="secret" size={14} />
                        Oculta algo
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="panel empty">
            <p>Aún no hay PNJ.</p>
            <p className="muted">Créalos a mano o deja que la IA se los invente.</p>
          </div>
        )
      ) : (
        <QueryState error={npcs.error} />
      )}
      <Outlet context={{ campaign }} />
    </section>
  );
}

/** Un PNJ en el panel lateral: su ficha, editarla, probar su voz con la IA y borrarlo. */
export function NpcDrawer() {
  const { npcId = '' } = useParams();
  const { campaign } = useCampaignOutlet();
  const npc = useNpc(npcId);
  const ai = useAiStatus();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const close = () => void navigate(`/campanas/${campaign.id}/pnj`);
  const current = npc.data;

  return (
    <Drawer
      title={
        current ? (
          <>
            {current.name}{' '}
            {current.profile && <span className="badge">{profileText(current.profile)}</span>}
          </>
        ) : (
          'PNJ'
        )
      }
      onClose={close}
    >
      {!current ? (
        <QueryState error={npc.error} />
      ) : editing ? (
        <EditNpc npc={current} onDone={() => setEditing(false)} />
      ) : (
        <>
          {current.concept && <p className="lede">{current.concept}</p>}
          <NpcSheet npc={current} />
          <div className="actions">
            <button type="button" className="button" onClick={() => setEditing(true)}>
              Editar
            </button>
          </div>
          {ai.data?.enabled && (
            <section className="drawer-section" aria-labelledby="voice-heading">
              <h3 id="voice-heading">Probar su voz</h3>
              <p className="hint">
                Para ver cómo lo interpreta la IA antes de la partida. Nada de esto llega a la mesa.
              </p>
              <NpcChat key={current.id} npc={current} />
            </section>
          )}
          <DeleteNpc npc={current} onDeleted={close} />
        </>
      )}
    </Drawer>
  );
}

function EditNpc({ npc, onDone }: { npc: NpcView; onDone: () => void }) {
  const [draft, setDraft] = useState<NpcDraft>(() => ({
    name: npc.name,
    concept: npc.concept,
    appearance: npc.appearance,
    personality: npc.personality,
    speech: npc.speech,
    goals: npc.goals,
    secrets: npc.secrets,
    profile: npc.profile,
  }));
  const storeNpc = useStoreNpc();
  const save = useMutation({
    mutationFn: () => api.updateNpc(npc.id, draft),
    onSuccess: (updated) => {
      storeNpc(updated);
      onDone();
    },
  });

  return (
    <>
      <section className="drawer-section" aria-labelledby="complete-heading">
        <h3 id="complete-heading">Con ayuda de la IA</h3>
        <NpcGenerator campaignId={npc.campaignId} draft={draft} onDraft={setDraft} keepProfile />
      </section>
      <form
        className="stack"
        aria-label="Editar PNJ"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <NpcFields value={draft} onChange={setDraft} />
        <ErrorNote error={save.error} />
        <div className="actions">
          <button type="submit" className="button primary" disabled={save.isPending}>
            Guardar cambios
          </button>
          <button type="button" className="button" onClick={onDone}>
            Cancelar
          </button>
        </div>
      </form>
    </>
  );
}

function DeleteNpc({ npc, onDeleted }: { npc: NpcView; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const destroy = useMutation({
    mutationFn: () => api.deleteNpc(npc.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: keys.npc(npc.id) });
      await queryClient.invalidateQueries({ queryKey: keys.npcs(npc.campaignId) });
      onDeleted();
    },
  });
  return (
    <div className="danger-zone">
      <ConfirmButton
        confirmLabel={`¿Borrar a ${npc.name}? Lo que dijo en las partidas se queda`}
        onConfirm={() => destroy.mutate()}
        disabled={destroy.isPending}
        quiet
      >
        Borrar PNJ
      </ConfirmButton>
      <ErrorNote error={destroy.error} />
    </div>
  );
}

/** Crear un PNJ, a mano o con la IA, en el panel lateral. Al guardarlo se abre su ficha. */
export function NewNpcDrawer() {
  const { campaign } = useCampaignOutlet();
  const [draft, setDraft] = useState<NpcDraft>(emptyNpc);
  const storeNpc = useStoreNpc();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => api.createNpc(campaign.id, draft),
    onSuccess: async (npc) => {
      storeNpc(npc);
      await navigate(`/campanas/${campaign.id}/pnj/${npc.id}`, { replace: true });
    },
  });

  return (
    <Drawer title="Nuevo PNJ" onClose={() => void navigate(`/campanas/${campaign.id}/pnj`)}>
      <p className="hint">
        Solo tú lo ves. En la sala podrás hablar por su boca, con ayuda de la IA, y enseñar a la
        mesa lo que dice.
      </p>
      <section className="drawer-section" aria-labelledby="ai-heading">
        <h3 id="ai-heading">Con ayuda de la IA</h3>
        <NpcGenerator campaignId={campaign.id} draft={draft} onDraft={setDraft} />
      </section>
      <form
        className="stack"
        aria-label="Datos del PNJ"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <NpcFields value={draft} onChange={setDraft} />
        <ErrorNote error={create.error} />
        <div className="actions">
          <button type="submit" className="button primary" disabled={create.isPending}>
            Guardar PNJ
          </button>
        </div>
      </form>
    </Drawer>
  );
}

/** Los enlaces de antes (`/pnj/:npcId`) llevan al PNJ dentro de su campaña. */
export function NpcRedirect() {
  const { npcId = '' } = useParams();
  const npc = useNpc(npcId);
  if (!npc.data) return <QueryState error={npc.error} />;
  return <Navigate to={`/campanas/${npc.data.campaignId}/pnj/${npc.data.id}`} replace />;
}
