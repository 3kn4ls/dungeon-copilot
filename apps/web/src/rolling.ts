import {
  NPC_PROFILES,
  checkBonus,
  combineEdges,
  conditionEdges,
  defaultSkillCatalog,
  meleeAttack,
  meleeDefense,
  opposedOdds,
  testOdds,
  type Attribute,
  type CharacterBuild,
  type DifficultyLevel,
  type Edge,
  type OutcomeOdds,
  type Range,
  type Situation,
} from '@dungeon-copilot/rules';
import type {
  Blow,
  CharacterView,
  Combat,
  Combatant,
  GameRollRequest,
  InterventionEvent,
  InterventionIntent,
  NpcCombatant,
  NpcView,
  RollSideRequest,
} from '@dungeon-copilot/shared';

/** Lado de una tirada mientras se prepara: un personaje o algo que describe el máster. */
export type SideDraft =
  | { kind: 'character'; characterId: string; check: string; modifier: number; edge: Edge }
  | { kind: 'free'; label: string; bonus: number; edge: Edge; npcId?: string };

/** "skill:athletics" o "attribute:strength": con qué tira el personaje. */
export function parseCheck(check: string): { skill?: string; attribute?: Attribute } {
  const [type, id = ''] = check.split(':');
  return type === 'skill' ? { skill: id } : { attribute: id as Attribute };
}

/** Por defecto, la habilidad en la que el personaje tiene más rango. */
export function defaultCheck(character: CharacterView): string {
  const best = Object.entries(character.skills).sort((a, b) => b[1] - a[1])[0];
  return best ? `skill:${best[0]}` : 'attribute:strength';
}

export function characterDraft(
  character: CharacterView,
  check?: string,
  extra: { modifier?: number; edge?: Edge } = {},
): SideDraft {
  return {
    kind: 'character',
    characterId: character.id,
    check: check ?? defaultCheck(character),
    modifier: extra.modifier ?? 0,
    edge: extra.edge ?? 'none',
  };
}

/** Lo que dice el reglamento de un personaje de la mesa. */
export function buildOf(character: CharacterView): CharacterBuild {
  const { name, background, attributes, skills, advancedSkills } = character;
  return { name, background, attributes, skills, advancedSkills };
}

export const freeDraft = (label: string): SideDraft => ({
  kind: 'free',
  label,
  bonus: NPC_PROFILES.soldier.bonus,
  edge: 'none',
});

/** Un PNJ de la campaña tira con el bonificador de su perfil (o el de soldado, si no pelea). */
export const npcDraft = (npc: NpcView): SideDraft => ({
  kind: 'free',
  label: npc.name,
  bonus: NPC_PROFILES[npc.profile ?? 'soldier'].bonus,
  edge: 'none',
  npcId: npc.id,
});

export function toSideRequest(draft: SideDraft): RollSideRequest {
  if (draft.kind === 'free') {
    return { kind: 'free', label: draft.label, bonus: draft.bonus, edge: draft.edge };
  }
  return {
    kind: 'character',
    characterId: draft.characterId,
    ...parseCheck(draft.check),
    modifier: draft.modifier,
    edge: draft.edge,
  };
}

export interface SideCheck {
  bonus: number;
  edge: Edge;
  /** Tira con desventaja por una herida grave. */
  wounded: boolean;
  /** Tira con desventaja por su armadura pesada. */
  armored: boolean;
}

/**
 * Bonificador y ventaja con los que tira un bando, como los calculará el servidor con la ficha
 * de ahora. null si el personaje no está en la lista.
 */
export function sideCheck(side: RollSideRequest, characters: CharacterView[]): SideCheck | null {
  if (side.kind === 'free') {
    return { bonus: side.bonus, edge: side.edge ?? 'none', wounded: false, armored: false };
  }
  const character = characters.find((c) => c.id === side.characterId);
  if (!character) return null;
  const build = buildOf(character);
  const breakdown = checkBonus(build, {
    skill: side.skill,
    attribute: side.attribute,
    modifier: side.modifier ?? 0,
  });
  const check = { attribute: breakdown.attribute, skill: side.skill };
  const wounded = conditionEdges(build, check, { wounds: character.wounds });
  const armored = conditionEdges(build, check, { armor: character.gear.armor });
  return {
    bonus: breakdown.bonus,
    edge: combineEdges(side.edge ?? 'none', ...wounded, ...armored),
    wounded: wounded.includes('disadvantage'),
    armored: armored.includes('disadvantage'),
  };
}

export const previewCheck = (draft: SideDraft, characters: CharacterView[]) =>
  sideCheck(toSideRequest(draft), characters);

/** Probabilidad de cada resultado de una tirada ya preparada, o null si falta algún personaje. */
export function rollOdds(
  roll: Pick<GameRollRequest, 'actor' | 'target'>,
  characters: CharacterView[],
): OutcomeOdds | null {
  const actor = sideCheck(roll.actor, characters);
  if (!actor) return null;
  if (roll.target.kind === 'difficulty') return testOdds(actor, roll.target.difficulty);
  const opponent = sideCheck(roll.target.opponent, characters);
  return opponent && opposedOdds(actor, opponent);
}

export const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Atributo + rango en una habilidad básica, sin nada más. */
function skillBonus(character: CharacterView, skill: string): number {
  const attribute = defaultSkillCatalog.get(skill)?.attribute;
  return (attribute ? character.attributes[attribute] : 0) + (character.skills[skill] ?? 0);
}

/** Con qué ataca cuerpo a cuerpo, según el arma de su ficha: Esgrima si es ligera. */
export const meleeCheck = (character: CharacterView) =>
  `skill:${meleeAttack(buildOf(character), character.gear.melee.weapon).skill}`;

/** Un personaje que ataca cuerpo a cuerpo con su arma: con desventaja si es pesada y le pesa. */
export function attackDraft(character: CharacterView): SideDraft {
  const attack = meleeAttack(buildOf(character), character.gear.melee.weapon);
  return characterDraft(character, `skill:${attack.skill}`, {
    edge: combineEdges(...attack.edges),
  });
}

/**
 * Un personaje que se defiende cuerpo a cuerpo, como mejor le vaya: parando con su arma (el escudo
 * suma) o esquivando con Acrobacias (la armadura pesada estorba). Una desventaja cuenta como −2.
 */
export function defenseDraft(character: CharacterView): SideDraft {
  const build = buildOf(character);
  const { weapon } = character.gear.melee;
  const parry = meleeDefense(build, 'parry', { weapon, shield: character.gear.shield });
  const dodge = meleeDefense(build, 'dodge', {});
  const armored = conditionEdges(
    build,
    { attribute: 'dexterity', skill: 'acrobatics' },
    { armor: character.gear.armor },
  );
  const worth = (skill: string, modifier: number, edges: readonly Edge[]) =>
    skillBonus(character, skill) + modifier - (edges.includes('disadvantage') ? 2 : 0);
  const parrying = worth(parry.skill, parry.modifier, parry.edges);
  const dodging = worth(dodge.skill, dodge.modifier, armored);
  if (dodging > parrying) return characterDraft(character, `skill:${dodge.skill}`);
  return characterDraft(character, `skill:${parry.skill}`, {
    modifier: parry.modifier,
    edge: combineEdges(...parry.edges),
  });
}

/** Un bando para tirar contra quien pelea: los PNJ, con su perfil; un personaje, defendiéndose. */
export function combatantDraft(combatant: Combatant, characters: CharacterView[]): SideDraft {
  if (combatant.kind === 'npc') {
    return {
      kind: 'free',
      label: combatant.name,
      bonus: NPC_PROFILES[combatant.profile].bonus,
      edge: 'none',
      npcId: combatant.npcId,
    };
  }
  const character = characters.find((c) => c.id === combatant.id);
  return character ? defenseDraft(character) : freeDraft(combatant.name);
}

/** De qué depende la dificultad de un disparo, salvo quién dispara. */
export interface Shot {
  /** La Destreza del objetivo. */
  dexterity: number;
  range: Range;
  cover: boolean;
  shield: boolean;
}

export const DEFAULT_SHOT: Shot = { dexterity: 2, range: 'short', cover: false, shield: false };

/** Cómo es de difícil dispararle a quien pelea: con su Destreza y, si es un personaje, su escudo. */
function combatantShot(combatant: Combatant, characters: CharacterView[]): Shot {
  if (combatant.kind === 'npc') {
    return { ...DEFAULT_SHOT, dexterity: NPC_PROFILES[combatant.profile].dexterity };
  }
  const character = characters.find((c) => c.id === combatant.id);
  return character ? characterShot(character) : DEFAULT_SHOT;
}

/** Disparar a un personaje: con su Destreza y su escudo, si lleva. */
const characterShot = (character: CharacterView): Shot => ({
  ...DEFAULT_SHOT,
  dexterity: character.attributes.dexterity,
  shield: character.gear.shield,
});

/**
 * Una tirada ya preparada para el formulario de Tirar: para atender una intervención o para el
 * turno de unos PNJ. El máster la retoca si quiere antes de pedirla o tirarla.
 */
export interface RollPreset {
  actor: SideDraft;
  against: 'difficulty' | 'opposed';
  difficulty: DifficultyLevel;
  opponent: SideDraft;
  situation: Situation;
  shot: Shot;
  /** Que la haga el jugador del personaje que tira o que se defiende. */
  ask: boolean;
  secret: boolean;
  /** En combate, quién ataca a quién: a quién irá el daño del golpe. */
  blow?: Blow | undefined;
}

/** Con qué tira, de entrada, quien ha intervenido: lo más probable según lo que quiere hacer. */
const INTENT_CHECKS: Record<InterventionIntent, (character: CharacterView) => string> = {
  speak: () => 'skill:persuasion',
  // Su mejor habilidad.
  act: defaultCheck,
  ask: () => 'skill:perception',
  attack: meleeCheck,
  melee: meleeCheck,
  ranged: () => 'skill:marksmanship',
  spell: () => 'skill:arcana',
};

/**
 * La tirada que pide, de entrada, una intervención: la hace su jugador, y en secreto si lo era.
 * Un ataque va contra quien ataca, si se sabe; un disparo, con la Destreza del objetivo.
 */
export function interventionPreset(
  intervention: InterventionEvent,
  characters: CharacterView[],
  combat: Combat | null,
): RollPreset | undefined {
  const character = characters.find((c) => c.id === intervention.characterId);
  if (!character) return undefined;
  const target = combat?.order.find((combatant) => combatant.id === intervention.target?.id);
  const fighting = combat?.order.some((combatant) => combatant.id === character.id) ?? false;
  const preset: RollPreset = {
    actor: characterDraft(character, INTENT_CHECKS[intervention.intent](character)),
    against: 'difficulty',
    difficulty: 'normal',
    opponent: freeDraft('Rival'),
    situation: 'test',
    shot: DEFAULT_SHOT,
    ask: true,
    secret: intervention.visibility === 'private',
    blow:
      target && fighting
        ? {
            attacker: { id: character.id, name: character.name },
            defender: { id: target.id, name: target.name },
          }
        : undefined,
  };
  switch (intervention.intent) {
    case 'attack':
    case 'melee':
      return {
        ...preset,
        actor: attackDraft(character),
        against: 'opposed',
        situation: 'melee',
        opponent: target ? combatantDraft(target, characters) : preset.opponent,
      };
    case 'ranged':
      return {
        ...preset,
        situation: 'ranged',
        shot: target ? combatantShot(target, characters) : DEFAULT_SHOT,
      };
    default:
      return preset;
  }
}

/** Unos PNJ atacan cuerpo a cuerpo a un personaje: se defiende su jugador, con lo que mejor se le dé. */
export function enemyAttackPreset(enemy: NpcCombatant, target: CharacterView): RollPreset {
  return {
    actor: combatantDraft(enemy, []),
    against: 'opposed',
    difficulty: 'normal',
    opponent: defenseDraft(target),
    situation: 'melee',
    shot: characterShot(target),
    ask: true,
    secret: false,
    blow: {
      attacker: { id: enemy.id, name: enemy.name },
      defender: { id: target.id, name: target.name },
    },
  };
}
