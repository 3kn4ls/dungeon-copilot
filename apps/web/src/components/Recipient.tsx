import type { CharacterView, InterventionEvent } from '@dungeon-copilot/shared';
import { useState } from 'react';

/**
 * A quién va lo que enseña el máster: a toda la mesa ('') o, en secreto, a un personaje (su
 * id). Si responde a una intervención en secreto, por defecto va en secreto a ese personaje;
 * lo que elija el máster vale mientras responda a la misma. Devuelve el valor, cómo cambiarlo y
 * cómo volver a toda la mesa.
 */
export function useRecipient(answering: InterventionEvent | undefined) {
  const [choice, setChoice] = useState<{ answering: number | null; to: string }>({
    answering: null,
    to: '',
  });
  const current = answering?.id ?? null;
  const fallback = answering?.visibility === 'private' ? answering.characterId : '';
  const to = choice.answering === current ? choice.to : fallback;
  return [
    to,
    (next: string) => setChoice({ answering: current, to: next }),
    () => setChoice({ answering: null, to: '' }),
  ] as const;
}

/** Para elegir si lo que enseña el máster lo ve toda la mesa o solo un personaje. */
export function RecipientSelect(props: {
  characters: CharacterView[];
  value: string;
  onChange: (to: string) => void;
}) {
  const { characters, value, onChange } = props;
  const chosen = characters.find((character) => character.id === value);
  if (characters.length === 0) return null;
  return (
    <label className="field">
      <span className="field-label">Para</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Toda la mesa</option>
        {characters.map((character) => (
          <option key={character.id} value={character.id}>
            Solo {character.name}, en secreto
          </option>
        ))}
      </select>
      {chosen && (
        <span className="hint">
          Solo lo veréis tú y quien juega con {chosen.name}: no sale en la pantalla.
        </span>
      )}
    </label>
  );
}
