import {
  DIFFICULTIES,
  NPC_PROFILES,
  checkBonus,
  combineEdges,
  conditionEdges,
  defaultSkillCatalog,
  meleeAttack,
  meleeDefense,
  opposedOdds,
  rangedDifficulty,
  testOdds,
  weaponLabel,
  type Attribute,
  type CharacterBuild,
  type DifficultyLevel,
  type Edge,
  type MapShot,
  type OutcomeOdds,
  type Range,
  type Situation,
} from '@dungeon-copilot/rules';
import {
  SUGGESTION_THRESHOLDS,
  memberName,
  type Blow,
  type BlowRequest,
  type CharacterView,
  type CheckSuggestion,
  type Combat,
  type Combatant,
  type CombatantRef,
  type GameRollRequest,
  type InterventionEvent,
  type InterventionIntent,
  type NpcCombatant,
  type NpcView,
  type RollSideRequest,
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

/** La dificultad de un disparo. Con Disparo certero no cuentan la distancia media ni la cobertura. */
export const shotDifficulty = (shot: Shot, shooter: CharacterView | undefined) =>
  rangedDifficulty({
    targetDexterity: shot.dexterity,
    range: shot.range,
    cover: shot.cover ? 'partial' : 'none',
    targetShield: shot.shield,
    deadeye: shooter?.advancedSkills.includes('deadeye') ?? false,
  });

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

/** Quién ataca a quién, como lo pide el servidor: con cuál de cada grupo, si se sabe. */
export const blowRequest = (blow: Blow): BlowRequest => ({
  attackerId: blow.attacker.id,
  attackerMember: blow.attacker.member,
  defenderId: blow.defender.id,
  defenderMember: blow.defender.member,
});

/**
 * Una tirada ya preparada para el formulario de Tirar: para atender una intervención, para el
 * turno de unos PNJ o al apuntar en el mapa. El máster la retoca si quiere antes de tirarla.
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
 * Un ataque va contra quien ataca, si se sabe; un disparo, con la Destreza del objetivo y, si los
 * dos están en el mapa (`mapShot`), la distancia y la cobertura que salen de él. Con `suggestion`,
 * con lo que sugiere la IA (ver withSuggestion), salvo lo que dice el mapa.
 */
export function interventionPreset(
  intervention: InterventionEvent,
  characters: CharacterView[],
  combat: Combat | null,
  suggestion?: CheckSuggestion,
  mapShot?: MapShot,
): RollPreset | undefined {
  const character = characters.find((c) => c.id === intervention.characterId);
  if (!character) return undefined;
  const target = combat?.order.find((combatant) => combatant.id === intervention.target?.id);
  const fighting = combat?.order.some((combatant) => combatant.id === character.id) ?? false;
  // Si apuntó a uno de un grupo en el mapa, el golpe va a ese.
  const targetRef = intervention.target && target ? intervention.target : undefined;
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
      targetRef && fighting
        ? { attacker: { id: character.id, name: character.name }, defender: targetRef }
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
        opponent: target
          ? named(combatantDraft(target, characters), targetRef?.name)
          : preset.opponent,
      };
    case 'ranged': {
      const shooting: RollPreset = {
        ...preset,
        situation: 'ranged',
        shot: target ? combatantShot(target, characters) : DEFAULT_SHOT,
      };
      const suggested = suggestion ? withSuggestion(shooting, suggestion, target) : shooting;
      if (!mapShot) return suggested;
      return {
        ...suggested,
        shot: { ...suggested.shot, range: mapShot.range, cover: mapShot.cover === 'partial' },
      };
    }
    default:
      return suggestion ? withSuggestion(preset, suggestion, target) : preset;
  }
}

/**
 * La tirada con lo que sugiere la IA: la habilidad más probable y la dificultad; ventaja si encaja
 * su trasfondo; enfrentada contra un rival si alguien se opone (salvo que vaya contra alguien del
 * combate); y en un disparo, la distancia y la cobertura.
 */
function withSuggestion(
  preset: RollPreset,
  suggestion: CheckSuggestion,
  target: Combatant | undefined,
): RollPreset {
  const [best] = suggestion.skills;
  const fits = (suggestion.background ?? 0) >= SUGGESTION_THRESHOLDS.background;
  const actor: SideDraft =
    preset.actor.kind === 'character'
      ? {
          ...preset.actor,
          check: best ? `skill:${best.id}` : preset.actor.check,
          edge: fits ? 'advantage' : preset.actor.edge,
        }
      : preset.actor;
  const opposed = !target && (suggestion.opposed ?? 0) >= SUGGESTION_THRESHOLDS.opposed;
  const { shot } = suggestion;
  return {
    ...preset,
    actor,
    difficulty: suggestion.difficulty ?? preset.difficulty,
    ...(opposed ? { against: 'opposed' as const, opponent: freeDraft('Rival') } : {}),
    shot: shot
      ? { ...preset.shot, range: shot.range, cover: shot.cover >= SUGGESTION_THRESHOLDS.cover }
      : preset.shot,
  };
}

/** Un bando que tira con otro nombre, como «Bandidos 2» en vez de «Bandidos». */
function named(draft: SideDraft, label: string | undefined): SideDraft {
  return draft.kind === 'free' && label ? { ...draft, label } : draft;
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

/** La probabilidad de cada resultado de una tirada preparada, como la calcula Tirar. */
export function presetOdds(preset: RollPreset, characters: CharacterView[]): OutcomeOdds | null {
  const actor = previewCheck(preset.actor, characters);
  if (!actor) return null;
  if (preset.against === 'opposed') {
    const opponent = previewCheck(preset.opponent, characters);
    return opponent && opposedOdds(actor, opponent);
  }
  const { actor: side } = preset;
  const shooter =
    side.kind === 'character' ? characters.find((c) => c.id === side.characterId) : undefined;
  return testOdds(
    actor,
    preset.situation === 'ranged'
      ? shotDifficulty(preset.shot, shooter)
      : DIFFICULTIES[preset.difficulty],
  );
}

/** Quien pelea en el mapa: un personaje o uno de un grupo de PNJ, por su número (`member`). */
export type MapFighter =
  | { kind: 'character'; character: CharacterView }
  | { kind: 'npc'; combatant: NpcCombatant; member: number };

const fighterRef = (fighter: MapFighter): CombatantRef =>
  fighter.kind === 'character'
    ? { id: fighter.character.id, name: fighter.character.name }
    : {
        id: fighter.combatant.id,
        name: memberName(fighter.combatant, fighter.member),
        member: fighter.member,
      };

/** Un ataque que sale de apuntar en el mapa, con su tirada ya preparada. */
export interface MapAttack {
  situation: 'melee' | 'ranged';
  label: string;
  preset: RollPreset;
}

/**
 * Lo que puede hacer en el mapa `from` contra `to`, que está a `shot`: cuerpo a cuerpo si está al
 * lado y, si no y lo ve, disparar con la distancia y la cobertura del mapa. Un personaje dispara si
 * lleva arma a distancia; los PNJ, siempre (lo decide el máster). Si los dos pelean en el combate
 * (`fighting`), la tirada es un golpe que va a ese de su grupo.
 */
export function mapAttacks(
  from: MapFighter,
  to: MapFighter,
  shot: MapShot,
  fighting: boolean,
): MapAttack[] {
  const blow = fighting ? { attacker: fighterRef(from), defender: fighterRef(to) } : undefined;
  const base = {
    against: 'difficulty' as const,
    difficulty: 'normal' as const,
    opponent: freeDraft('Rival'),
    shot: DEFAULT_SHOT,
    secret: false,
    blow,
  };
  const adjacent = shot.distance === 1;

  if (from.kind === 'character' && to.kind === 'npc') {
    const { character } = from;
    const target = fighterRef(to).name;
    if (adjacent) {
      return [
        {
          situation: 'melee',
          label: `Cuerpo a cuerpo, con ${weaponLabel(character.gear.melee)}`,
          preset: {
            ...base,
            actor: attackDraft(character),
            against: 'opposed',
            opponent: named(combatantDraft(to.combatant, []), target),
            situation: 'melee',
            ask: true,
          },
        },
      ];
    }
    const { ranged } = character.gear;
    if (!shot.visible || !ranged) return [];
    return [
      {
        situation: 'ranged',
        label: `Disparar, con ${weaponLabel(ranged)}`,
        preset: {
          ...base,
          actor: characterDraft(character, 'skill:marksmanship'),
          situation: 'ranged',
          shot: {
            dexterity: NPC_PROFILES[to.combatant.profile].dexterity,
            range: shot.range,
            cover: shot.cover === 'partial',
            shield: false,
          },
          ask: true,
        },
      },
    ];
  }

  if (from.kind === 'npc' && to.kind === 'character') {
    const name = fighterRef(from).name;
    const { character } = to;
    if (adjacent) {
      const attack = enemyAttackPreset(from.combatant, character);
      return [
        {
          situation: 'melee',
          label: `${name} ataca a ${character.name}`,
          preset: { ...attack, actor: named(attack.actor, name), blow },
        },
      ];
    }
    if (!shot.visible) return [];
    return [
      {
        situation: 'ranged',
        label: `${name} dispara a ${character.name}`,
        preset: {
          ...base,
          actor: named(combatantDraft(from.combatant, []), name),
          situation: 'ranged',
          shot: {
            ...characterShot(character),
            range: shot.range,
            cover: shot.cover === 'partial',
          },
          // Tira el máster: el personaje no tira nada, solo pone la dificultad.
          ask: false,
        },
      },
    ];
  }
  return [];
}
