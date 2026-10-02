import type { NpcDraft, NpcView } from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { NpcChat } from '../components/NpcChat';
import { NpcFields, NpcGenerator, NpcSheet, profileText } from '../components/Npcs';
import { ConfirmButton, ErrorNote, QueryState, useDocumentTitle } from '../components/ui';
import { useRememberCampaign } from '../current-campaign';
import { keys, useAiStatus, useCampaign, useNpc, useStoreNpc } from '../queries';

export function NpcPage() {
  const { npcId = '' } = useParams();
  const npc = useNpc(npcId);
  const campaign = useCampaign(npc.data?.campaignId ?? '');
  useRememberCampaign(campaign.data?.id);
  const ai = useAiStatus();
  const [editing, setEditing] = useState(false);
  useDocumentTitle(npc.data?.name);

  if (!npc.data) return <QueryState error={npc.error} />;
  const current = npc.data;

  return (
    <>
      <header className="masthead">
        <Link to={`/campanas/${current.campaignId}`} className="eyebrow back">
          ← {campaign.data?.name ?? 'Campaña'}
        </Link>
        <h1>
          {current.name}{' '}
          {current.profile && <span className="badge">{profileText(current.profile)}</span>}
        </h1>
        {current.concept && <p className="lede">{current.concept}</p>}
      </header>

      <div className="layout layout-main">
        <div className="stack">
          {editing ? (
            <EditNpc npc={current} onDone={() => setEditing(false)} />
          ) : (
            <section className="panel" aria-labelledby="sheet-heading">
              <div className="panel-heading">
                <h2 id="sheet-heading">Ficha</h2>
                <button type="button" className="button small" onClick={() => setEditing(true)}>
                  Editar
                </button>
              </div>
              <NpcSheet npc={current} />
              <p className="hint">Solo tú ves esta ficha.</p>
            </section>
          )}
          <DeleteNpc npc={current} />
        </div>
        {ai.data?.enabled && (
          <aside className="side">
            <section className="panel" aria-labelledby="voice-heading">
              <h2 id="voice-heading">Probar su voz</h2>
              <p className="hint">
                Para ver cómo lo interpreta la IA antes de la partida. Nada de esto llega a la mesa.
              </p>
              <NpcChat key={current.id} npc={current} />
            </section>
          </aside>
        )}
      </div>
    </>
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
      <form
        className="panel"
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
      <section className="panel" aria-labelledby="complete-heading">
        <h2 id="complete-heading">Con ayuda de la IA</h2>
        <NpcGenerator campaignId={npc.campaignId} draft={draft} onDraft={setDraft} keepProfile />
      </section>
    </>
  );
}

function DeleteNpc({ npc }: { npc: NpcView }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const destroy = useMutation({
    mutationFn: () => api.deleteNpc(npc.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: keys.npc(npc.id) });
      await queryClient.invalidateQueries({ queryKey: keys.npcs(npc.campaignId) });
      await navigate(`/campanas/${npc.campaignId}`);
    },
  });
  return (
    <div className="danger-zone">
      <ConfirmButton
        confirmLabel={`¿Borrar a ${npc.name}? Lo que dijo en las partidas se queda`}
        onConfirm={() => destroy.mutate()}
        disabled={destroy.isPending}
      >
        Borrar PNJ
      </ConfirmButton>
      <ErrorNote error={destroy.error} />
    </div>
  );
}
