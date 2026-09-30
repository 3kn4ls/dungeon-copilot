import { USE_LIMIT_LABELS, limitedSkills } from '@dungeon-copilot/rules';
import {
  currentScene,
  isSpent,
  type CharacterView,
  type GameDetail,
  type GameEvent,
  type SpentAbilities,
} from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { refreshCharacters, useStoreGameEvent } from '../queries';
import { ErrorNote } from './ui';

/** En qué escena estáis, si el máster ha empezado alguna. */
export function SceneLine({ events }: { events: readonly GameEvent[] }) {
  const scene = currentScene(events);
  if (!scene) return null;
  return (
    <p className="scene-line">
      Escena: <strong>{scene.title}</strong>
    </p>
  );
}

/**
 * El máster empieza una escena nueva: termina la anterior, lo de una vez por escena vuelve y, si
 * quiere, los personajes recuperan el aliento. En pleno combate no se puede.
 */
export function SceneControl(props: {
  game: GameDetail;
  fighting: boolean;
  /** Acaba de empezar: por ejemplo, para describirla. */
  onStarted: () => void;
}) {
  const { game, fighting, onStarted } = props;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [recover, setRecover] = useState(true);
  const queryClient = useQueryClient();
  const storeEvent = useStoreGameEvent(game.id);
  const start = useMutation({
    mutationFn: () => api.startScene(game.id, { title, recover }),
    onSuccess: (event) => {
      storeEvent(event);
      if (event.kind === 'scene' && event.recovered.length > 0) {
        refreshCharacters(queryClient, game.campaignId);
      }
      setOpen(false);
      setTitle('');
      setRecover(true);
      onStarted();
    },
  });

  if (fighting) return null;
  if (!open) {
    return (
      <div className="actions">
        <button type="button" className="button small" onClick={() => setOpen(true)}>
          Nueva escena
        </button>
      </div>
    );
  }
  return (
    <form
      className="combat-form stack tight"
      onSubmit={(event) => {
        event.preventDefault();
        start.mutate();
      }}
    >
      <h3>Nueva escena</h3>
      <p className="muted">
        Termina la escena anterior: lo que se usa una vez por escena vuelve a estar disponible.
      </p>
      <label className="field">
        <span className="field-label">Título</span>
        <input
          required
          maxLength={120}
          placeholder="El camino del norte"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={recover}
          onChange={(event) => setRecover(event.target.checked)}
        />
        Recuperan el aliento: se borran los rasguños de todos los personajes
      </label>
      <ErrorNote error={start.error} />
      <div className="actions">
        <button type="submit" className="button primary" disabled={start.isPending}>
          Empezar la escena
        </button>
        <button type="button" className="button" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/**
 * Las técnicas de una vez por escena o por sesión de unos personajes: si les quedan y, a quien
 * puede usarlas (su jugador o el máster), un botón para gastarlas. Esquiva prodigiosa se gasta al
 * recibir un golpe.
 */
export function LimitedAbilities(props: {
  game: GameDetail;
  characters: CharacterView[];
  spent: SpentAbilities;
  /** Si quien mira puede gastarlas: las de sus personajes o, el máster, las de todos. */
  canUse: boolean;
  /** Se ve el nombre del personaje delante: cuando hay varios. */
  named?: boolean;
}) {
  const { game, characters, spent, canUse, named = false } = props;
  const storeEvent = useStoreGameEvent(game.id);
  const use = useMutation({
    mutationFn: (body: { characterId: string; skill: string }) => api.useAbility(game.id, body),
    onSuccess: storeEvent,
  });
  const rows = characters.flatMap((character) =>
    limitedSkills(character.advancedSkills).map((skill) => ({ character, skill })),
  );
  if (rows.length === 0) return null;

  return (
    <div className="stack tight">
      <ul className="abilities">
        {rows.map(({ character, skill }) => {
          const gone = isSpent(spent, character.id, skill.id);
          return (
            <li key={`${character.id}:${skill.id}`} className={gone ? 'spent' : undefined}>
              <span>
                {named && <strong>{character.name}: </strong>}
                {skill.name}{' '}
                <span className="muted">· {USE_LIMIT_LABELS[skill.limit].toLowerCase()}</span>
              </span>
              {gone ? (
                <span className="badge">
                  Usada en esta {skill.limit === 'scene' ? 'escena' : 'sesión'}
                </span>
              ) : skill.id === 'uncanny-dodge' ? (
                <span className="muted">Se gasta al recibir un golpe</span>
              ) : (
                canUse && (
                  <button
                    type="button"
                    className="button small"
                    disabled={use.isPending}
                    title={skill.description}
                    onClick={() => use.mutate({ characterId: character.id, skill: skill.id })}
                  >
                    Usar
                  </button>
                )
              )}
            </li>
          );
        })}
      </ul>
      <ErrorNote error={use.error} />
    </div>
  );
}
