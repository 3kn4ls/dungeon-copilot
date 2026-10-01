import { randomUUID } from 'node:crypto';
import {
  NPC_PROFILES,
  conditionEdges,
  initiativeEdge,
  rollInitiative,
  type Random,
} from '@dungeon-copilot/rules';
import {
  COMBAT_EVENT_KINDS,
  currentCombat,
  type Blow,
  type BlowRequest,
  type Combat,
  type Combatant,
  type CombatantRef,
  type joinCombatSchema,
} from '@dungeon-copilot/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Executor, Transaction } from '../db';
import { gameEvents, npcs } from '../db/schema';
import { HttpError, notFound } from '../http/errors';
import { CHARACTER_NOT_HERE, findRollingCharacters, toEvent, type FoundGame } from './events';
import type { RollingCharacter } from './rolls';

// El combate en juego: se calcula con los eventos del combate de la partida, como en la web.

export const NO_COMBAT = 'No hay ningún combate en juego';
const NPC_NOT_HERE = 'Ese PNJ no está en esta campaña';

/** Quien entra en el combate, tal como lo pide el máster. */
type Entering = z.output<typeof joinCombatSchema>['combatants'][number];

/** El combate en juego en una partida, o null si se está narrando. */
export async function findCombat(db: Executor, gameId: string): Promise<Combat | null> {
  const rows = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.gameId, gameId),
        inArray(sql`${gameEvents.payload} ->> 'kind'`, [...COMBAT_EVENT_KINDS]),
      ),
    )
    .orderBy(asc(gameEvents.id));
  return currentCombat(rows.map((row) => toEvent(row, null)));
}

/** El combate en juego: 409 si no hay ninguno. */
export async function requireCombat(db: Executor, gameId: string): Promise<Combat> {
  const combat = await findCombat(db, gameId);
  if (!combat) throw new HttpError(409, NO_COMBAT);
  return combat;
}

const NOT_FIGHTING = 'Quien eliges no está en el combate';

/** Alguien que pelea, contra quien va una intervención: 404 si no está en el combate. */
export async function findCombatTarget(
  db: Executor,
  gameId: string,
  id: string,
): Promise<CombatantRef> {
  const target = (await findCombat(db, gameId))?.order.find((combatant) => combatant.id === id);
  if (!target) throw notFound(NOT_FIGHTING);
  return { id: target.id, name: target.name };
}

/**
 * Quién ataca a quién en una tirada de combate, con sus nombres: 409 si no hay combate y 404 si
 * alguno no está peleando.
 */
export async function findBlow(db: Executor, gameId: string, blow: BlowRequest): Promise<Blow> {
  const combat = await requireCombat(db, gameId);
  const ref = (id: string): CombatantRef => {
    const combatant = combat.order.find((other) => other.id === id);
    if (!combatant) throw notFound(NOT_FIGHTING);
    return { id: combatant.id, name: combatant.name };
  };
  return { attacker: ref(blow.attackerId), defender: ref(blow.defenderId) };
}

/**
 * Quienes entran en el combate, con la iniciativa ya tirada, en el orden en que llegan (los
 * dados, también). Los personajes tienen que ser de la campaña y no estar ya peleando, y los PNJ
 * de la campaña, de ella. `fighting` son quienes ya pelean.
 */
export async function enterCombat(
  tx: Transaction,
  found: FoundGame,
  entering: readonly Entering[],
  fighting: readonly Combatant[],
  random: Random,
): Promise<Combatant[]> {
  const { campaignId } = found.game;
  const ids = entering.flatMap((c) => (c.kind === 'character' ? [c.characterId] : []));
  const fightingIds = fighting.flatMap((c) => (c.kind === 'character' ? [c.id] : []));
  const characters = await findRollingCharacters(tx, campaignId, [...ids, ...fightingIds]);
  for (const id of ids) {
    const character = characters.get(id);
    if (!character) throw notFound(CHARACTER_NOT_HERE);
    if (fightingIds.includes(id)) {
      throw new HttpError(409, `${character.name} ya está en el combate`);
    }
  }
  const npcIds = [
    ...new Set(entering.flatMap((c) => (c.kind === 'npc' && c.npcId ? [c.npcId] : []))),
  ];
  if (npcIds.length > 0) {
    const known = await tx
      .select({ id: npcs.id })
      .from(npcs)
      .where(and(eq(npcs.campaignId, campaignId), inArray(npcs.id, npcIds)));
    if (known.length < npcIds.length) throw notFound(NPC_NOT_HERE);
  }

  // Táctico da ventaja a todo su bando: a los personajes que pelean.
  const tactician = [...characters.values()].find((character) =>
    character.build.advancedSkills.includes('tactician'),
  );
  return entering.map((c) =>
    c.kind === 'character'
      ? characterCombatant(characters.get(c.characterId)!, tactician, random)
      : npcCombatant(c, random),
  );
}

/** Un personaje tira la iniciativa con su Destreza. */
function characterCombatant(
  character: RollingCharacter,
  tactician: RollingCharacter | undefined,
  random: Random,
): Combatant {
  const { build, wounds } = character;
  const bonus = build.attributes.dexterity;
  const notes: string[] = [];
  if (tactician) notes.push(`Ventaja por Táctico (${tactician.name})`);
  // Sin armadura en la ficha, lo único que estorba la iniciativa es una herida grave.
  if (conditionEdges(build, { attribute: 'dexterity' }, { wounds }).includes('disadvantage')) {
    notes.push('Desventaja por su herida grave');
  }
  const { dice, total } = rollInitiative(
    bonus,
    initiativeEdge(build, { wounds }, tactician !== undefined),
    random,
  );
  return {
    kind: 'character',
    id: character.id,
    name: character.name,
    initiative: { dice, bonus, total, notes },
  };
}

/** Unos PNJ tiran la iniciativa con la Destreza de su perfil, una vez por grupo, sean cuantos sean. */
function npcCombatant(entering: Extract<Entering, { kind: 'npc' }>, random: Random): Combatant {
  const bonus = NPC_PROFILES[entering.profile].dexterity;
  const { dice, total } = rollInitiative(bonus, 'none', random);
  return {
    kind: 'npc',
    id: randomUUID(),
    name: entering.name,
    profile: entering.profile,
    count: entering.count,
    npcId: entering.npcId,
    initiative: { dice, bonus, total, notes: [] },
  };
}
