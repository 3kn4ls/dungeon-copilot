import { NPC_PROFILES, type NpcProfile } from '@dungeon-copilot/rules';
import { describe, expect, it } from 'vitest';
import {
  byInitiative,
  currentCombat,
  currentFloor,
  endCombatSchema,
  joinCombat,
  leaveCombat,
  nextTurn,
  nextTurnSchema,
  startCombatSchema,
  turnOf,
  type Combat,
  type Combatant,
} from './combat';
import { settledEvents, type GameEvent, type GameEventPayload } from './games';

const KAEL = '8b9f2a4e-1c2d-4e5f-9a8b-7c6d5e4f3a2b';
const MIRA = '1f0e2d3c-4b5a-4968-8776-655443322110';
const BANDITS = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const WOLVES = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';

const event = (id: number, payload: GameEventPayload): GameEvent => ({
  ...payload,
  id,
  gameId: 'partida',
  visibility: 'public',
  authorName: 'Edu',
  createdAt: '2026-09-30T20:00:00.000Z',
});

const initiative = (total: number, bonus: number) => ({
  dice: { rolled: [3, 4], kept: [3, 4] as const, edge: 'none' as const },
  bonus,
  total,
  notes: [],
});

const pc = (id: string, name: string, total: number, dexterity = 3): Combatant => ({
  kind: 'character',
  id,
  name,
  initiative: initiative(total, dexterity),
});

const npc = (
  id: string,
  name: string,
  total: number,
  profile: NpcProfile = 'minion',
): Combatant => ({
  kind: 'npc',
  id,
  name,
  profile,
  initiative: initiative(total, NPC_PROFILES[profile].dexterity),
});

const kael = pc(KAEL, 'Kael', 8);
const mira = pc(MIRA, 'Mira', 11);
const bandits = npc(BANDITS, '3 bandidos', 9);

/** Mira (11), los bandidos (9) y Kael (8), en la ronda y el turno que se diga. */
const fight = (round = 1, turn = 0): Combat => ({
  startedAt: 1,
  round,
  turn,
  order: [mira, bandits, kael],
});

const names = (combatants: readonly Combatant[]) => combatants.map((c) => c.name);

describe('empezar un combate', () => {
  it('pelean al menos dos, y al menos un personaje', () => {
    const parsed = startCombatSchema.parse({
      combatants: [
        { kind: 'character', characterId: KAEL },
        { kind: 'npc', name: ' 3 bandidos ', profile: 'minion' },
      ],
    });
    expect(parsed.combatants[1]).toEqual({ kind: 'npc', name: '3 bandidos', profile: 'minion' });

    const alone = startCombatSchema.safeParse({
      combatants: [{ kind: 'character', characterId: KAEL }],
    });
    expect(alone.error?.issues.map((issue) => issue.message)).toEqual([
      'Un combate necesita al menos a dos: elige quién pelea',
    ]);
    const npcsOnly = startCombatSchema.safeParse({
      combatants: [
        { kind: 'npc', name: 'Lobos', profile: 'soldier' },
        { kind: 'npc', name: 'Osos', profile: 'veteran' },
      ],
    });
    expect(npcsOnly.error?.issues.map((issue) => issue.message)).toEqual([
      'En el combate tiene que pelear al menos un personaje',
    ]);
  });

  it('cada personaje entra una vez, y los PNJ con nombre y perfil', () => {
    const twice = startCombatSchema.safeParse({
      combatants: [
        { kind: 'character', characterId: KAEL },
        { kind: 'character', characterId: KAEL },
      ],
    });
    expect(twice.error?.issues.map((issue) => issue.message)).toEqual([
      'Un personaje no puede entrar dos veces en el combate',
    ]);
    const nameless = startCombatSchema.safeParse({
      combatants: [
        { kind: 'character', characterId: KAEL },
        { kind: 'npc', name: ' ' },
      ],
    });
    expect(nameless.error?.issues.map((issue) => issue.message)).toEqual([
      'Di quién pelea',
      'Elige su perfil: esbirro, soldado, veterano o campeón',
    ]);
  });

  it('al terminar se recupera el aliento si no se dice otra cosa', () => {
    expect(endCombatSchema.parse({})).toEqual({ recover: true });
    expect(endCombatSchema.parse({ recover: false })).toEqual({ recover: false });
  });

  it('para pasar el turno hay que decir cuál termina', () => {
    expect(nextTurnSchema.safeParse({ round: 2, combatantId: KAEL }).success).toBe(true);
    expect(nextTurnSchema.safeParse({ combatantId: KAEL }).success).toBe(false);
    expect(nextTurnSchema.safeParse({ round: 0, combatantId: KAEL }).success).toBe(false);
  });
});

describe('el orden de iniciativa', () => {
  it('de mayor a menor; los empates, para los PJ; entre iguales, más Destreza', () => {
    const wolves = npc(WOLVES, 'Lobos', 8, 'soldier');
    const order = [wolves, kael, bandits, mira, pc('tor', 'Tor', 8, 4)].sort(byInitiative);
    expect(names(order)).toEqual(['Mira', '3 bandidos', 'Tor', 'Kael', 'Lobos']);
  });
});

describe('el combate en juego', () => {
  const started = event(2, { kind: 'combatStarted', order: [mira, bandits, kael] });

  it('sin combate se narra, y la palabra la da el máster', () => {
    const events = [
      event(1, { kind: 'opened', number: 1, title: '', luckRefilled: true }),
      event(2, { kind: 'floor', floor: { kind: 'table' } }),
    ];
    expect(currentCombat(events)).toBeNull();
    expect(currentFloor(events)).toEqual({ kind: 'table' });
  });

  it('empieza en la ronda 1 y la palabra es de quien tiene el turno', () => {
    const events = [event(1, { kind: 'floor', floor: { kind: 'table' } }), started];
    expect(currentCombat(events)).toEqual({
      startedAt: 2,
      round: 1,
      turn: 0,
      order: fight().order,
    });
    expect(currentFloor(events)).toEqual({ kind: 'character', characterId: MIRA, name: 'Mira' });
  });

  it('en el turno de los PNJ, la palabra es del máster', () => {
    const events = [
      started,
      event(3, { kind: 'turn', round: 1, turn: 1, combatant: { id: BANDITS, name: '3 bandidos' } }),
    ];
    expect(turnOf(currentCombat(events)!).name).toBe('3 bandidos');
    expect(currentFloor(events)).toEqual({ kind: 'master' });
  });

  it('el máster puede dar la palabra a otro hasta que pasa el turno', () => {
    const events = [
      started,
      event(3, { kind: 'floor', floor: { kind: 'character', characterId: KAEL, name: 'Kael' } }),
    ];
    expect(currentFloor(events)).toEqual({ kind: 'character', characterId: KAEL, name: 'Kael' });
    const next = event(4, {
      kind: 'turn',
      round: 1,
      turn: 1,
      combatant: { id: BANDITS, name: '3 bandidos' },
    });
    expect(currentFloor([...events, next])).toEqual({ kind: 'master' });
  });

  it('quien se une o sale cambia el orden, la ronda y el turno', () => {
    const wolves = npc(WOLVES, 'Lobos', 10, 'soldier');
    const events = [
      started,
      event(3, { kind: 'combatJoined', joined: [wolves], ...joinCombat(fight(), [wolves]) }),
      event(4, {
        kind: 'combatLeft',
        left: { id: MIRA, name: 'Mira' },
        order: [wolves, bandits, kael],
        round: 1,
        turn: 0,
      }),
    ];
    expect(currentCombat(events)).toEqual({
      startedAt: 2,
      round: 1,
      turn: 0,
      order: [wolves, bandits, kael],
    });
    expect(currentFloor(events)).toEqual({ kind: 'master' });
  });

  it('al terminar se vuelve a narrar y la palabra vuelve al máster', () => {
    const events = [started, event(3, { kind: 'combatEnded', rounds: 1, recovered: [] })];
    expect(currentCombat(events)).toBeNull();
    expect(currentFloor(events)).toEqual({ kind: 'master' });
  });

  it('empezar un combate puede atender a quien atacó', () => {
    const attack = event(1, {
      kind: 'intervention',
      characterId: KAEL,
      name: 'Kael',
      intent: 'attack',
      text: 'Le tiro la jarra',
    });
    const events = [
      attack,
      event(2, { kind: 'combatStarted', order: [kael, bandits], answers: 1 }),
    ];
    expect(settledEvents(events).get(1)).toBe('answered');
  });
});

describe('los turnos', () => {
  it('pasan en orden y, tras el último, empieza otra ronda', () => {
    expect(nextTurn(fight(1, 0))).toEqual({ round: 1, turn: 1 });
    expect(nextTurn(fight(1, 2))).toEqual({ round: 2, turn: 0 });
  });

  it('quien se une ocupa su sitio y el turno sigue con quien lo tenía', () => {
    // Es el turno de los bandidos (9): los lobos (10) actuarán en la ronda siguiente.
    const wolves = npc(WOLVES, 'Lobos', 10, 'soldier');
    const joined = joinCombat(fight(1, 1), [wolves]);
    expect(names(joined.order)).toEqual(['Mira', 'Lobos', '3 bandidos', 'Kael']);
    expect(joined).toMatchObject({ round: 1, turn: 2 });
    // Tor (7) va después de Kael: aún actúa en esta ronda.
    const late = joinCombat(fight(1, 1), [pc('tor', 'Tor', 7)]);
    expect(names(late.order)).toEqual(['Mira', '3 bandidos', 'Kael', 'Tor']);
    expect(late).toMatchObject({ round: 1, turn: 1 });
  });

  it('si sale quien tiene el turno, le toca al siguiente', () => {
    expect(leaveCombat(fight(1, 1), BANDITS)).toEqual({ order: [mira, kael], round: 1, turn: 1 });
    // Era el último: empieza otra ronda.
    expect(leaveCombat(fight(1, 2), KAEL)).toEqual({ order: [mira, bandits], round: 2, turn: 0 });
  });

  it('si sale otro, el turno sigue con quien lo tenía', () => {
    expect(leaveCombat(fight(1, 1), MIRA)).toEqual({ order: [bandits, kael], round: 1, turn: 0 });
    expect(leaveCombat(fight(1, 1), KAEL)).toEqual({ order: [mira, bandits], round: 1, turn: 1 });
  });
});
