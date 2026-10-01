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
  type Gear,
  type OpposedSide,
  type Random,
  type WoundState,
} from '@dungeon-copilot/rules';
import type {
  Blow,
  GameRoll,
  GameRollPreview,
  GameRollSide,
  RollResponse,
  gameRollSchema,
} from '@dungeon-copilot/shared';
import type { z } from 'zod';
import { HttpError } from '../http/errors';

/**
 * Una tirada de partida tal como llega, ya validada: al momento o pedida por el máster. El golpe
 * (quién ataca a quién) se resuelve aparte, con el combate.
 */
type RollRequest = Omit<z.output<typeof gameRollSchema>, 'secret' | 'blow'>;
type RollSide = RollRequest['actor'];

/** Lo que hace falta de un personaje para tirar por él. */
export interface RollingCharacter {
  id: string;
  name: string;
  build: CharacterBuild;
  wounds: WoundState;
  gear: Gear;
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
  const check = { attribute, skill: skill?.id };
  const wounded = conditionEdges(character.build, check, { wounds: character.wounds });
  const armored = conditionEdges(character.build, check, { armor: character.gear.armor });

  const notes: string[] = [];
  if (wounded.includes('disadvantage')) {
    notes.push(`${character.name} tira con desventaja por su herida grave`);
  }
  if (armored.includes('disadvantage')) {
    notes.push(`${character.name} tira con desventaja por su armadura pesada`);
  }
  if (character.wounds.severity === 'down') notes.push(`${character.name} está fuera de combate`);

  const attributeLabel = ATTRIBUTE_INFO[attribute].label;
  let label = attributeLabel;
  if (skill)
    label = attribute === skill.attribute ? skill.name : `${skill.name} con ${attributeLabel}`;

  return {
    view: { label: character.name, characterId: character.id, check: label },
    check: { bonus: breakdown.bonus, edge: combineEdges(side.edge, ...wounded, ...armored) },
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

/** Una tirada de partida lista para tirar: ya se sabe quién tira, contra qué y con qué. */
export interface PlannedRoll {
  preview: GameRollPreview;
  /** Lo que cambia la ficha sin que nadie lo pida, como la desventaja por herida grave. */
  notes: string[];
  roll(random: Random): RollResponse;
}

/**
 * Prepara una tirada de partida sin tirar los dados: valida lo que se tira y calcula los
 * bonificadores con la ficha de los personajes, con las desventajas por heridas y armadura ya
 * puestas. `characters` trae los personajes que aparecen; `blow`, en combate, quién ataca a quién.
 * Sirve también para pedir una tirada.
 */
export function planGameRoll(
  request: RollRequest,
  characters: ReadonlyMap<string, RollingCharacter>,
  blow?: Blow,
): PlannedRoll {
  const actor = resolveSide(request.actor, characters);
  const combat = blow ? { blow } : {};
  if (request.target.kind === 'difficulty') {
    const { difficulty } = request.target;
    return {
      preview: {
        actor: actor.view,
        target: { kind: 'difficulty', label: difficultyLabel(difficulty) },
        situation: request.situation,
        ...combat,
      },
      notes: actor.notes,
      roll: (random) => ({ kind: 'test', ...resolveTest(actor.check, difficulty, random) }),
    };
  }
  const opponent = resolveSide(request.target.opponent, characters);
  return {
    preview: {
      actor: actor.view,
      target: { kind: 'opposed', ...opponent.view },
      situation: request.situation,
      ...combat,
    },
    notes: [...actor.notes, ...opponent.notes],
    roll: (random) => ({
      kind: 'opposed',
      ...resolveOpposed(actor.check, opponent.check, random),
    }),
  };
}

/**
 * Resuelve una tirada de partida. Los bonificadores de los personajes salen de su ficha y las
 * desventajas por heridas se aplican solas; `characters` trae los personajes que aparecen.
 */
export function resolveGameRoll(
  request: RollRequest,
  characters: ReadonlyMap<string, RollingCharacter>,
  random: Random,
  blow?: Blow,
): GameRoll {
  const plan = planGameRoll(request, characters, blow);
  return { ...plan.preview, notes: plan.notes, result: plan.roll(random) };
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
