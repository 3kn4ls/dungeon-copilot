import {
  NPC_PROFILE_IDS,
  compareInitiative,
  type DiceRoll,
  type NpcHarm,
  type NpcProfile,
} from '@dungeon-copilot/rules';
import { z } from 'zod';
import { answersSchema, type Floor, type GameEvent, type GameEventKind } from './games';

// El combate por rondas. Empieza con `combatStarted`, que trae quién pelea en el orden de
// iniciativa; el turno pasa con `turn`; quien se une o sale cambia el orden con `combatJoined` y
// `combatLeft`, y `combatEnded` lo termina. Los golpes a los PNJ (`damage`) llevan la cuenta de
// su daño y, si caen todos, los sacan del orden. Mientras dura, la palabra es de quien tiene el
// turno (del máster, en el de los PNJ).

/** Lo que sacó en la iniciativa quien pelea, al entrar en el combate. */
export interface Initiative {
  dice: DiceRoll;
  /** Su Destreza: la del personaje o la del perfil de los PNJ. */
  bonus: number;
  total: number;
  /** Por qué tiró con ventaja o desventaja: Táctico, una herida grave. */
  notes: string[];
}

/**
 * Quien pelea: un personaje de la campaña (con su id) o PNJ que lleva el máster, uno solo o un
 * grupo («Bandidos», tres), con el perfil con el que tiran.
 */
export type Combatant =
  | { kind: 'character'; id: string; name: string; initiative: Initiative }
  | {
      kind: 'npc';
      id: string;
      name: string;
      profile: NpcProfile;
      /** Cuántos son, si es un grupo. Sin él, uno (así eran los combates de antes). */
      count?: number;
      /** Si es un PNJ de la campaña. */
      npcId?: string;
      initiative: Initiative;
    };

export type NpcCombatant = Combatant & { kind: 'npc' };

/** Cuántos son unos PNJ que pelean. */
export const groupSize = (combatant: NpcCombatant): number => combatant.count ?? 1;

/** Quien pelea, dicho para la mesa: «Garrick» o, si es un grupo, «Bandidos (3)». */
export function groupLabel(combatant: Combatant): string {
  if (combatant.kind !== 'npc' || groupSize(combatant) === 1) return combatant.name;
  return `${combatant.name} (${groupSize(combatant)})`;
}

/** Alguien del combate, con el nombre que tenía entonces. */
export interface CombatantRef {
  id: string;
  name: string;
}

/** Un combate en juego. */
export interface Combat {
  /** El evento con el que empezó. */
  startedAt: number;
  round: number;
  /** A quién le toca: su sitio en `order`. */
  turn: number;
  /** Quien pelea, de mayor a menor iniciativa. */
  order: Combatant[];
  /** El daño de los PNJ que ya han recibido algún golpe, por su id en el combate. */
  harm: Record<string, NpcHarm>;
}

/** Cómo queda el combate tras un cambio: el orden, la ronda y a quién le toca. */
export type CombatPosition = Pick<Combat, 'order' | 'round' | 'turn'>;

const combatantSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('character'), characterId: z.uuid('Elige un personaje') }),
  z.object({
    kind: z.literal('npc'),
    /** «Brunilda», «3 bandidos». */
    name: z
      .string()
      .trim()
      .min(1, 'Di quién pelea')
      .max(80, 'El nombre no puede pasar de 80 caracteres'),
    profile: z.enum(NPC_PROFILE_IDS, 'Elige su perfil: esbirro, soldado, veterano o campeón'),
    /** Cuántos son: cada uno aguanta lo de su perfil. */
    count: z
      .number('Di cuántos son')
      .int('Di cuántos son')
      .min(1, 'Al menos tiene que ser uno')
      .max(20, 'Un grupo es de 20 como mucho')
      .default(1),
    /** Si es un PNJ de la campaña. */
    npcId: z.uuid('Elige un PNJ').optional(),
  }),
]);

export type CombatantRequest = z.input<typeof combatantSchema>;

/** Quienes entran en el combate de una vez: cada personaje, una sola. */
const combatantsSchema = (min: number, message: string) =>
  z
    .array(combatantSchema)
    .min(min, message)
    .max(20, 'Como mucho entran 20 de una vez')
    .refine((list) => {
      const ids = list.flatMap((c) => (c.kind === 'character' ? [c.characterId] : []));
      return new Set(ids).size === ids.length;
    }, 'Un personaje no puede entrar dos veces en el combate');

/** El máster empieza un combate: quién pelea. El servidor tira la iniciativa por todos. */
export const startCombatSchema = z.object({
  combatants: combatantsSchema(2, 'Un combate necesita al menos a dos: elige quién pelea').refine(
    (list) => list.some((c) => c.kind === 'character'),
    'En el combate tiene que pelear al menos un personaje',
  ),
  answers: answersSchema,
});

export type StartCombatRequest = z.input<typeof startCombatSchema>;

/** Se unen al combate refuerzos, o un personaje que llega tarde. Tiran la iniciativa al llegar. */
export const joinCombatSchema = z.object({
  combatants: combatantsSchema(1, 'Elige quién se une al combate'),
  answers: answersSchema,
});

export type JoinCombatRequest = z.input<typeof joinCombatSchema>;

/** Sale del combate alguien que cae o huye. */
export const leaveCombatSchema = z.object({
  combatantId: z.uuid('Elige quién sale del combate'),
});

export type LeaveCombatRequest = z.input<typeof leaveCombatSchema>;

/**
 * Termina un turno: el de `combatantId` en la ronda `round`, tal como lo ve quien lo termina. Si
 * ya ha pasado, no se pasa otro.
 */
export const nextTurnSchema = z.object({
  round: z.number('Di en qué ronda estáis').int().positive(),
  combatantId: z.uuid('Di de quién es el turno que termina'),
});

export type NextTurnRequest = z.input<typeof nextTurnSchema>;

export const endCombatSchema = z.object({
  /** Recuperar el aliento: se borran los rasguños de los personajes que siguen en el combate. */
  recover: z.boolean().default(true),
});

export type EndCombatRequest = z.input<typeof endCombatSchema>;

/**
 * Alguien recibe un golpe: un personaje de la campaña (su ficha) o PNJ del combate (el id de su
 * sitio en el orden). `roll`: la tirada del golpe, si sale de una. Con `dodge`, el personaje gasta
 * Esquiva prodigiosa y el daño se queda en 1.
 */
export const dealDamageSchema = z.object({
  targetId: z.uuid('Elige quién recibe el golpe'),
  amount: z
    .number('Di cuánto daño')
    .int('El daño es un número entero')
    .min(1, 'El daño mínimo es 1')
    .max(20, 'El daño no puede pasar de 20'),
  roll: z.number().int().positive().optional(),
  dodge: z.boolean().default(false),
});

export type DealDamageRequest = z.input<typeof dealDamageSchema>;

/** Los eventos que lee el combate: los suyos y los golpes, que llevan la cuenta del daño. */
export const COMBAT_EVENT_KINDS = [
  'combatStarted',
  'turn',
  'combatJoined',
  'combatLeft',
  'combatEnded',
  'damage',
] as const satisfies GameEventKind[];

export type CombatEvent = GameEvent & { kind: (typeof COMBAT_EVENT_KINDS)[number] };

export const isCombatEvent = (event: GameEvent): event is CombatEvent =>
  (COMBAT_EVENT_KINDS as readonly GameEventKind[]).includes(event.kind);

/**
 * Si el evento cambia de quién es el turno o quién pelea: entonces la palabra pasa a quien tiene
 * el turno. Un golpe solo la cambia si con él caen todos y salen del orden.
 */
function changesTurn(event: GameEvent): boolean {
  if (event.kind === 'damage') return event.position !== undefined;
  return isCombatEvent(event);
}

const without = (harm: Combat['harm'], id: string): Combat['harm'] =>
  Object.fromEntries(Object.entries(harm).filter(([other]) => other !== id));

/** El combate tras un evento más; los que no son del combate no lo cambian. */
function stepCombat(combat: Combat | null, event: GameEvent): Combat | null {
  switch (event.kind) {
    case 'combatStarted':
      return { startedAt: event.id, order: event.order, round: 1, turn: 0, harm: {} };
    case 'turn':
      return combat && { ...combat, round: event.round, turn: event.turn };
    case 'combatJoined':
      return combat && { ...combat, order: event.order, round: event.round, turn: event.turn };
    case 'combatLeft':
      return (
        combat && {
          ...combat,
          order: event.order,
          round: event.round,
          turn: event.turn,
          harm: without(combat.harm, event.left.id),
        }
      );
    case 'damage': {
      const { target, position } = event;
      if (!combat || target.kind !== 'npc') return combat;
      if (position) return { ...combat, ...position, harm: without(combat.harm, target.id) };
      return { ...combat, harm: { ...combat.harm, [target.id]: target.harm } };
    }
    case 'combatEnded':
      return null;
    default:
      return combat;
  }
}

/** El combate en juego tras estos eventos, o null si no hay ninguno: se está narrando. */
export function currentCombat(events: readonly GameEvent[]): Combat | null {
  return events.reduce<Combat | null>(stepCombat, null);
}

/** A quién le toca. */
export function turnOf(combat: Combat): Combatant {
  const combatant = combat.order[combat.turn];
  if (!combatant) throw new Error(`En el combate no hay nadie en el sitio ${combat.turn}`);
  return combatant;
}

/** La palabra en un turno: la tiene el personaje al que le toca; en el de los PNJ, el máster. */
function turnFloor(combat: Combat): Floor {
  const current = turnOf(combat);
  return current.kind === 'character'
    ? { kind: 'character', characterId: current.id, name: current.name }
    : { kind: 'master' };
}

/**
 * Quién tiene la palabra tras estos eventos: a quien se la dio el máster la última vez o, si
 * después ha cambiado el turno o quién pelea, quien tiene el turno. Al acabar el combate, vuelve
 * al máster.
 */
export function currentFloor(events: readonly GameEvent[]): Floor {
  let floor: Floor = { kind: 'master' };
  let combat: Combat | null = null;
  for (const event of events) {
    combat = stepCombat(combat, event);
    if (event.kind === 'floor') floor = event.floor;
    else if (changesTurn(event)) floor = combat ? turnFloor(combat) : { kind: 'master' };
  }
  return floor;
}

/** El turno siguiente: el de quien va después o, tras el último, el primero de otra ronda. */
export function nextTurn(combat: Combat): Pick<Combat, 'round' | 'turn'> {
  return combat.turn + 1 < combat.order.length
    ? { round: combat.round, turn: combat.turn + 1 }
    : { round: combat.round + 1, turn: 0 };
}

/**
 * Para ordenar a quien pelea como dice el reglamento: de mayor a menor iniciativa, los empates
 * para los PJ y, entre iguales, primero el de más Destreza.
 */
export function byInitiative(a: Combatant, b: Combatant): number {
  const entry = (combatant: Combatant) => ({
    total: combatant.initiative.total,
    character: combatant.kind === 'character',
    dexterity: combatant.initiative.bonus,
  });
  return compareInitiative(entry(a), entry(b));
}

/**
 * El combate con quienes se unen, cada uno en su sitio según su iniciativa. El turno sigue siendo
 * de quien lo tenía: quien entra por delante empieza a actuar en la ronda siguiente.
 */
export function joinCombat(combat: Combat, joined: readonly Combatant[]): CombatPosition {
  const current = turnOf(combat);
  const order = [...combat.order, ...joined].sort(byInitiative);
  return { order, round: combat.round, turn: order.indexOf(current) };
}

/** El combate sin quien sale. Si era su turno, le toca al siguiente. */
export function leaveCombat(combat: Combat, id: string): CombatPosition {
  const index = combat.order.findIndex((combatant) => combatant.id === id);
  const order = combat.order.filter((combatant) => combatant.id !== id);
  const { round, turn } = combat;
  if (index < 0 || index > turn) return { order, round, turn };
  if (index < turn) return { order, round, turn: turn - 1 };
  return turn < order.length ? { order, round, turn } : { order, round: round + 1, turn: 0 };
}
