import {
  ATTRIBUTE_INFO,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  checkBonus,
  combineEdges,
  conditionEdges,
  defaultSkillCatalog,
  rerollOpposed,
  rerollTest,
  resolveOpposed,
  resolveTest,
  type Check,
  type CharacterBuild,
  type DifficultyLevel,
  type OpposedSide,
  type Random,
  type WoundState,
} from '@dungeon-copilot/rules';
import type { GameRoll, GameRollSide, RollResponse, gameRollSchema } from '@dungeon-copilot/shared';
import type { z } from 'zod';
import { HttpError } from '../http/errors';

type RollRequest = z.output<typeof gameRollSchema>;
type RollSide = RollRequest['actor'];

/** Lo que hace falta de un personaje para tirar por él. */
export interface RollingCharacter {
  id: string;
  name: string;
  build: CharacterBuild;
  wounds: WoundState;
}

interface ResolvedSide {
  view: GameRollSide;
  check: Check;
  notes: string[];
}

export function difficultyLabel(difficulty: number): string {
  const level = (Object.keys(DIFFICULTIES) as DifficultyLevel[]).find(
    (key) => DIFFICULTIES[key] === difficulty,
  );
  return level ? `${DIFFICULTY_LABELS[level]} (${difficulty})` : `Dificultad ${difficulty}`;
}

function resolveCharacterSide(
  side: Extract<RollSide, { kind: 'character' }>,
  character: RollingCharacter,
): ResolvedSide {
  const skill = side.skill === undefined ? undefined : defaultSkillCatalog.get(side.skill);
  if (side.skill !== undefined && !skill) {
    throw new HttpError(400, 'Esa habilidad no existe', [
      { path: 'skill', message: `No hay ninguna habilidad "${side.skill}"` },
    ]);
  }
  if (skill && skill.tier !== 'basic') {
    throw new HttpError(400, `${skill.name} es avanzada: se tira con su habilidad básica`);
  }
  const attribute = side.attribute ?? skill?.attribute;
  if (!attribute) throw new HttpError(400, 'Elige una habilidad o un atributo para la tirada');

  const breakdown = checkBonus(character.build, {
    skill: skill?.id,
    attribute,
    modifier: side.modifier,
  });
  const imposed = conditionEdges(
    character.build,
    { attribute, skill: skill?.id },
    { wounds: character.wounds },
  );

  const notes: string[] = [];
  // Sin armadura en la ficha, la única desventaja impuesta es la de la herida grave.
  if (imposed.includes('disadvantage')) {
    notes.push(`${character.name} tira con desventaja por su herida grave`);
  }
  if (character.wounds.severity === 'down') notes.push(`${character.name} está fuera de combate`);

  const attributeLabel = ATTRIBUTE_INFO[attribute].label;
  let check = attributeLabel;
  if (skill)
    check = attribute === skill.attribute ? skill.name : `${skill.name} con ${attributeLabel}`;

  return {
    view: { label: character.name, characterId: character.id, check },
    check: { bonus: breakdown.bonus, edge: combineEdges(side.edge, ...imposed) },
    notes,
  };
}

function resolveSide(
  side: RollSide,
  characters: ReadonlyMap<string, RollingCharacter>,
): ResolvedSide {
  if (side.kind === 'free') {
    return {
      view: { label: side.label },
      check: { bonus: side.bonus, edge: side.edge },
      notes: [],
    };
  }
  const character = characters.get(side.characterId);
  if (!character) throw new Error(`Falta el personaje ${side.characterId} para tirar`);
  return resolveCharacterSide(side, character);
}

/**
 * Resuelve una tirada de partida. Los bonificadores de los personajes salen de su ficha y las
 * desventajas por heridas se aplican solas; `characters` trae los personajes que aparecen.
 */
export function resolveGameRoll(
  request: RollRequest,
  characters: ReadonlyMap<string, RollingCharacter>,
  random: Random,
): GameRoll {
  const actor = resolveSide(request.actor, characters);
  if (request.target.kind === 'difficulty') {
    const { difficulty } = request.target;
    return {
      actor: actor.view,
      target: { kind: 'difficulty', label: difficultyLabel(difficulty) },
      situation: request.situation,
      notes: actor.notes,
      result: { kind: 'test', ...resolveTest(actor.check, difficulty, random) },
    };
  }
  const opponent = resolveSide(request.target.opponent, characters);
  return {
    actor: actor.view,
    target: { kind: 'opposed', ...opponent.view },
    situation: request.situation,
    notes: [...actor.notes, ...opponent.notes],
    result: { kind: 'opposed', ...resolveOpposed(actor.check, opponent.check, random) },
  };
}

/**
 * Repite con Suerte los dados de un bando de la tirada del evento `of`: mismo bonificador, misma
 * ventaja o desventaja y el mismo objetivo. Los dados del otro bando se quedan; cuenta la nueva.
 */
export function rerollGameRoll(
  roll: GameRoll,
  of: number,
  side: OpposedSide,
  random: Random,
): GameRoll {
  const result: RollResponse =
    roll.result.kind === 'test'
      ? { kind: 'test', ...rerollTest(roll.result, random) }
      : { kind: 'opposed', ...rerollOpposed(roll.result, side, random) };
  return { ...roll, result, reroll: { of, side, sides: [...(roll.reroll?.sides ?? []), side] } };
}
