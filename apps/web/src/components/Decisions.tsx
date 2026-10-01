import { DIFFICULTY_LABELS, defaultSkillCatalog, type Range } from '@dungeon-copilot/rules';
import {
  SPELL_EFFECT_LABELS,
  SUGGESTION_THRESHOLDS,
  type CheckSuggestion,
  type InterventionIntent,
} from '@dungeon-copilot/shared';
import { percent } from '../rolling';

// Lo que sugiere la IA que decide (Nimble). Solo sugiere: el máster aplica lo que quiera, y si la
// IA tarda o falla, todo sigue como sin ella.

const RANGE_LABELS: Record<Range, string> = { short: 'corta', medium: 'media', long: 'larga' };

/** Lo que sabe la web de una sugerencia que ha pedido: si llega, ha llegado o ha fallado. */
export interface Asked<T> {
  data: T | undefined;
  error: unknown;
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'No se ha podido preguntar a la IA';

/** Lo que dice la sugerencia de una tirada, además de con qué tira. */
function checkNotes(suggestion: CheckSuggestion, intent: InterventionIntent): string[] {
  const { difficulty, shot } = suggestion;
  const notes: string[] = [];
  if (difficulty) {
    const effect = intent === 'spell' && difficulty !== 'heroic' && SPELL_EFFECT_LABELS[difficulty];
    notes.push(
      effect
        ? `Efecto ${effect.toLowerCase()} (${DIFFICULTY_LABELS[difficulty]})`
        : DIFFICULTY_LABELS[difficulty],
    );
  }
  if ((suggestion.background ?? 0) >= SUGGESTION_THRESHOLDS.background) {
    notes.push('Ventaja: encaja con su trasfondo');
  }
  if ((suggestion.opposed ?? 0) >= SUGGESTION_THRESHOLDS.opposed) {
    notes.push('Alguien se opone: enfrentada');
  }
  if (shot) {
    const cover = shot.cover >= SUGGESTION_THRESHOLDS.cover ? ', con cobertura' : '';
    notes.push(`Distancia ${RANGE_LABELS[shot.range]}${cover}`);
  }
  if ((suggestion.needsRoll ?? 1) < SUGGESTION_THRESHOLDS.needsRoll) {
    notes.push('Quizá no haga falta tirar');
  }
  return notes;
}

/**
 * Qué tirada sugiere la IA para una intervención, encima de la tirada ya preparada: las
 * habilidades más probables (con un toque se cambia a otra) y lo demás que sugiere. Si llegó
 * después de que el máster tocara la tirada, no se aplica sola: con `onApply`.
 */
export function CheckHint(props: {
  asked: Asked<CheckSuggestion>;
  intent: InterventionIntent;
  /** Con qué tira ahora quien actúa: "skill:stealth". */
  check: string | undefined;
  /** Ya se ha aplicado a la tirada. */
  applied: boolean;
  onSkill: (skill: string) => void;
  onApply: () => void;
}) {
  const { asked, intent, check, applied, onSkill, onApply } = props;
  if (asked.error) {
    return <p className="suggestion-note">Sin sugerencia de la IA: {errorText(asked.error)}</p>;
  }
  const suggestion = asked.data;
  if (!suggestion) {
    return <p className="suggestion-note">La IA está pensando qué tirada pedir…</p>;
  }
  const notes = checkNotes(suggestion, intent);
  return (
    <div className="suggestion">
      <span className="field-label" id="check-hint-label">
        {applied ? 'Preparada con lo que sugiere la IA' : 'La IA sugiere'}
      </span>
      {suggestion.skills.length > 0 && (
        <div className="chips" role="group" aria-labelledby="check-hint-label">
          {suggestion.skills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              className="chip"
              aria-pressed={check === `skill:${skill.id}`}
              onClick={() => onSkill(skill.id)}
            >
              {defaultSkillCatalog.get(skill.id)?.name ?? skill.id} {percent(skill.probability)}
            </button>
          ))}
        </div>
      )}
      {notes.length > 0 && <p className="hint">{notes.join(' · ')}</p>}
      {!applied && (
        <div className="actions">
          <button type="button" className="button small" onClick={onApply}>
            Aplicar la sugerencia
          </button>
        </div>
      )}
    </div>
  );
}
