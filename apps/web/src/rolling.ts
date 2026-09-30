import {
  NPC_PROFILES,
  checkBonus,
  combineEdges,
  conditionEdges,
  opposedOdds,
  testOdds,
  type Attribute,
  type Edge,
  type OutcomeOdds,
} from '@dungeon-copilot/rules';
import type {
  CharacterView,
  GameRollRequest,
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
