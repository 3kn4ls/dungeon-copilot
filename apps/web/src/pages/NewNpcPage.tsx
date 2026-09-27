import type { NpcDraft } from '@dungeon-copilot/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { NpcFields, NpcGenerator, emptyNpc } from '../components/Npcs';
import { ErrorNote, PageMessage, QueryState, useDocumentTitle } from '../components/ui';
import { useCampaign, useStoreNpc } from '../queries';

export function NewNpcPage() {
  const { campaignId = '' } = useParams();
  const campaign = useCampaign(campaignId);
  const [draft, setDraft] = useState<NpcDraft>(emptyNpc);
  const storeNpc = useStoreNpc();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => api.createNpc(campaignId, draft),
    onSuccess: async (npc) => {
      storeNpc(npc);
      await navigate(`/pnj/${npc.id}`, { replace: true });
    },
  });
  useDocumentTitle('Nuevo PNJ');

  if (!campaign.data) return <QueryState error={campaign.error} />;
  const back = (
    <Link to={`/campanas/${campaignId}`} className="eyebrow back">
      ← {campaign.data.name}
    </Link>
  );
  if (campaign.data.role !== 'master') {
    return (
      <PageMessage title="Los PNJ son cosa del máster">
        <p className="muted">Los conocerás en la partida, cuando hablen.</p>
        {back}
      </PageMessage>
    );
  }

  return (
    <>
      <header className="masthead">
        {back}
        <h1>Nuevo PNJ</h1>
        <p className="lede">
          Solo tú lo ves. En la sala podrás hablar por su boca, con ayuda de la IA, y enseñar a la
          mesa lo que dice.
        </p>
      </header>

      <div className="layout layout-main npc-editor">
        <form
          className="panel"
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
        <aside className="side">
          <section className="panel" aria-labelledby="ai-heading">
            <h2 id="ai-heading">Con ayuda de la IA</h2>
            <NpcGenerator campaignId={campaignId} draft={draft} onDraft={setDraft} />
          </section>
        </aside>
      </div>
    </>
  );
}
