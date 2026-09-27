import { NPC_PROFILES, NPC_PROFILE_IDS, type NpcProfile } from '@dungeon-copilot/rules';
import { NPC_LIMITS, type NpcDraft, type NpcView } from '@dungeon-copilot/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAiStatus } from '../queries';
import { signed } from '../rules-text';
import { ErrorNote } from './ui';

export const emptyNpc = (): NpcDraft => ({
  name: '',
  concept: '',
  appearance: '',
  personality: '',
  speech: '',
  goals: '',
  secrets: '',
  profile: null,
});

type TextField = 'appearance' | 'personality' | 'speech' | 'goals' | 'secrets';

const TEXT_FIELDS: { key: TextField; label: string; placeholder: string; hint?: string }[] = [
  {
    key: 'appearance',
    label: 'Aspecto',
    placeholder: 'Cincuentona, con brazos de herrero y el delantal lleno de manchas',
  },
  {
    key: 'personality',
    label: 'Carácter',
    placeholder: 'Desconfiada con los forasteros y generosa con quien paga',
  },
  {
    key: 'speech',
    label: 'Cómo habla',
    placeholder: 'Deprisa y con refranes; llama «cariño» a todo el mundo',
  },
  {
    key: 'goals',
    label: 'Qué quiere',
    placeholder: 'Saldar la deuda que tiene con el gremio de ladrones',
  },
  {
    key: 'secrets',
    label: 'Qué oculta',
    placeholder: 'Esconde en el sótano a un desertor de la guardia',
    hint: 'La IA lo sabe, pero el PNJ no lo cuenta sin motivo.',
  },
];

/** "Veterano +6", para las listas y las tiradas. */
export const profileText = (profile: NpcProfile) =>
  `${NPC_PROFILES[profile].label} ${signed(NPC_PROFILES[profile].bonus)}`;

/** Campos de un PNJ, para crearlo o cambiarlo. */
export function NpcFields({
  value,
  onChange,
}: {
  value: NpcDraft;
  onChange: (value: NpcDraft) => void;
}) {
  const set = <K extends keyof NpcDraft>(key: K, next: NpcDraft[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <>
      <label className="field">
        <span className="field-label">Nombre</span>
        <input
          required
          maxLength={NPC_LIMITS.name}
          value={value.name}
          placeholder="Brunilda"
          onChange={(e) => set('name', e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">Quién es</span>
        <input
          maxLength={NPC_LIMITS.concept}
          value={value.concept}
          placeholder="Posadera del Ciervo Blanco"
          onChange={(e) => set('concept', e.target.value)}
        />
      </label>
      {TEXT_FIELDS.map((field) => (
        <label key={field.key} className="field">
          <span className="field-label">{field.label}</span>
          <textarea
            rows={2}
            maxLength={NPC_LIMITS.text}
            value={value[field.key]}
            placeholder={field.placeholder}
            onChange={(e) => set(field.key, e.target.value)}
          />
          {field.hint && <span className="hint">{field.hint}</span>}
        </label>
      ))}
      <label className="field">
        <span className="field-label">Si hay pelea</span>
        <select
          value={value.profile ?? 'none'}
          onChange={(e) =>
            set('profile', e.target.value === 'none' ? null : (e.target.value as NpcProfile))
          }
        >
          <option value="none">No pelea</option>
          {NPC_PROFILE_IDS.map((id) => (
            <option key={id} value={id}>
              {profileText(id)}: {NPC_PROFILES[id].description}
            </option>
          ))}
        </select>
        <span className="hint">Con un perfil, tiras por él en la sala con su bonificador.</span>
      </label>
    </>
  );
}

const hasContent = (draft: NpcDraft) =>
  draft.profile !== null ||
  Object.entries(draft).some(([key, value]) => key !== 'profile' && String(value).trim() !== '');

/**
 * La IA inventa el PNJ o completa lo que falte: lo que el máster ya haya escrito se respeta.
 * No guarda nada; el resultado vuelve al formulario para revisarlo.
 */
export function NpcGenerator({
  campaignId,
  draft,
  onDraft,
  keepProfile = false,
}: {
  campaignId: string;
  draft: NpcDraft;
  onDraft: (draft: NpcDraft) => void;
  /** El PNJ ya existe: su «Si hay pelea» se respeta aunque sea «No pelea». */
  keepProfile?: boolean;
}) {
  const ai = useAiStatus();
  const [idea, setIdea] = useState('');
  const generate = useMutation({
    mutationFn: () => {
      // En un PNJ nuevo, «No pelea» es lo que viene puesto, no algo decidido: elige la IA.
      const { profile, ...rest } = draft;
      const decided = profile === null && !keepProfile ? rest : draft;
      return api.generateNpc(campaignId, { idea, draft: decided });
    },
    onSuccess: onDraft,
  });

  if (!ai.data) return null;
  if (!ai.data.enabled) {
    return (
      <p className="hint">
        Con Ollama configurado en el servidor, la IA puede inventar el PNJ o completar lo que falte.
      </p>
    );
  }
  const completing = hasContent(draft);
  return (
    <div className="stack tight">
      <label className="field">
        <span className="field-label">Idea para la IA (opcional)</span>
        <input
          maxLength={500}
          value={idea}
          placeholder="Una posadera que esconde algo"
          onChange={(e) => setIdea(e.target.value)}
        />
      </label>
      <p className="hint">
        {completing
          ? 'Rellenará lo que falte y respetará lo que ya has escrito.'
          : 'Se inventará el PNJ entero. Después puedes cambiar lo que quieras.'}
      </p>
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={generate.isPending}
          onClick={() => generate.mutate()}
        >
          {generate.isPending ? 'Pensando…' : completing ? 'Completar con IA' : 'Inventar con IA'}
        </button>
      </div>
      {generate.isPending && (
        <p className="hint">Con un modelo en tu propio servidor puede tardar un poco.</p>
      )}
      <ErrorNote error={generate.error} />
    </div>
  );
}

/** La ficha de un PNJ para consultarla: solo lo que tiene rellenado. */
export function NpcSheet({ npc }: { npc: NpcView }) {
  const rows: [string, string][] = [
    ['Aspecto', npc.appearance],
    ['Carácter', npc.personality],
    ['Cómo habla', npc.speech],
    ['Qué quiere', npc.goals],
    ['Qué oculta', npc.secrets],
  ];
  const filled = rows.filter(([, value]) => value.trim() !== '');
  return (
    <dl className="npc-sheet">
      {filled.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className="prewrap">{value}</dd>
        </div>
      ))}
      <div>
        <dt>Si hay pelea</dt>
        <dd>{npc.profile ? profileText(npc.profile) : 'No pelea'}</dd>
      </div>
    </dl>
  );
}
