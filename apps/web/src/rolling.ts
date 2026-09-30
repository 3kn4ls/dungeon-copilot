import {
  NPC_PROFILES,
  checkBonus,
  combineEdges,
  conditionEdges,
  defaultSkillCatalog,
  opposedOdds,
  testOdds,
  type Attribute,
  type DifficultyLevel,
  type Edge,
  type OutcomeOdds,
  type Range,
  type Situation,
} from '@dungeon-copilot/rules';
import type {
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

export function characterDraft(character: CharacterView, check?: string): SideDraft {
  return {
    kind: 'character',
    characterId: character.id,
    check: check ?? defaultCheck(character),
    modifier: 0,
    edge: 'none',
  };
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
}

/**
 * Bonificador y ventaja con los que tira un bando, como los calculará el servidor con la ficha
 * de ahora. null si el personaje no está en la lista.
 */
export function sideCheck(side: RollSideRequest, characters: CharacterView[]): SideCheck | null {
  if (side.kind === 'free') return { bonus: side.bonus, edge: side.edge ?? 'none', wounded: false };
  const character = characters.find((c) => c.id === side.characterId);
  if (!character) return null;
  const build = {
    name: character.name,
    background: character.background,
    attributes: character.attributes,
    skills: character.skills,
    advancedSkills: character.advancedSkills,
  };
  const breakdown = checkBonus(build, {
    skill: side.skill,
    attribute: side.attribute,
    modifier: side.modifier ?? 0,
  });
  const imposed = conditionEdges(
    build,
    { attribute: breakdown.attribute, skill: side.skill },
    { wounds: character.wounds },
  );
  return {
    bonus: breakdown.bonus,
    edge: combineEdges(side.edge ?? 'none', ...imposed),
    wounded: imposed.includes('disadvantage'),
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

/** De entre estas habilidades, con la que más suma el personaje; con empate, la primera. */
function bestOf(character: CharacterView, ...skills: string[]): string {
  const best = skills.reduce((a, b) =>
    skillBonus(character, b) > skillBonus(character, a) ? b : a,
  );
  return `skill:${best}`;
}

/** Para atacar cuerpo a cuerpo sin saber su arma: con Armas cuerpo a cuerpo o Esgrima, lo mejor. */
export const meleeCheck = (character: CharacterView) =>
  bestOf(character, 'melee-weapons', 'fencing');

/** Para defenderse: parar con su arma o esquivar con Acrobacias, lo que mejor se le dé. */
export const defenseCheck = (character: CharacterView) =>
  bestOf(character, 'melee-weapons', 'fencing', 'acrobatics');

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
  return character ? characterDraft(character, defenseCheck(character)) : freeDraft(combatant.name);
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

/** La Destreza de quien pelea: la del personaje o la de su perfil. */
function combatantDexterity(combatant: Combatant, characters: CharacterView[]): number {
  if (combatant.kind === 'npc') return NPC_PROFILES[combatant.profile].dexterity;
  return (
    characters.find((c) => c.id === combatant.id)?.attributes.dexterity ?? DEFAULT_SHOT.dexterity
  );
}

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
  const preset: RollPreset = {
    actor: characterDraft(character, INTENT_CHECKS[intervention.intent](character)),
    against: 'difficulty',
    difficulty: 'normal',
    opponent: freeDraft('Rival'),
    situation: 'test',
    shot: DEFAULT_SHOT,
    ask: true,
    secret: intervention.visibility === 'private',
  };
  switch (intervention.intent) {
    case 'attack':
    case 'melee':
      return {
        ...preset,
        against: 'opposed',
        situation: 'melee',
        opponent: target ? combatantDraft(target, characters) : preset.opponent,
      };
    case 'ranged':
      return {
        ...preset,
        situation: 'ranged',
        shot: target
          ? { ...DEFAULT_SHOT, dexterity: combatantDexterity(target, characters) }
          : DEFAULT_SHOT,
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
    opponent: characterDraft(target, defenseCheck(target)),
    situation: 'melee',
    shot: { ...DEFAULT_SHOT, dexterity: target.attributes.dexterity },
    ask: true,
    secret: false,
  };
}
