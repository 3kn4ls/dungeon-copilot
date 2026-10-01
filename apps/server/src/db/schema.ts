import {
  DEFAULT_GEAR,
  type Attributes,
  type Gear,
  type NpcProfile,
  type Severity,
} from '@dungeon-copilot/rules';
import type {
  GameEventPayload,
  GameEventVisibility,
  GameStatus,
  MemberRole,
} from '@dungeon-copilot/shared';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Siempre en minúsculas. */
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 del token de la cookie: si se filtra la base de datos, los tokens no sirven. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /** Código que el máster comparte para que los jugadores se unan. */
  inviteCode: text('invite_code').notNull().unique(),
  /**
   * Enlace de la pantalla de la mesa, para una tele sin sesión iniciada: da acceso a lo
   * público de la partida en juego. Lo genera la base de datos (122 bits aleatorios).
   */
  screenToken: text('screen_token')
    .notNull()
    .unique()
    .default(sql`replace(gen_random_uuid()::text, '-', '')`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const campaignMembers = pgTable(
  'campaign_members',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<MemberRole>().notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.campaignId, table.userId] }),
    index('campaign_members_user_id_idx').on(table.userId),
  ],
);

export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    background: text('background').notNull().default(''),
    attributes: jsonb('attributes').$type<Attributes>().notNull(),
    /** Rango de cada habilidad básica aprendida, por id. */
    skills: jsonb('skills').$type<Record<string, number>>().notNull(),
    advancedSkills: jsonb('advanced_skills').$type<string[]>().notNull(),
    scratches: integer('scratches').notNull().default(0),
    severity: text('severity').$type<Severity>().notNull().default('none'),
    /** Lo que lleva para pelear: arma cuerpo a cuerpo, arma a distancia, armadura y escudo. */
    gear: jsonb('gear').$type<Gear>().notNull().default(DEFAULT_GEAR),
    luck: integer('luck').notNull(),
    xp: integer('xp').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('characters_campaign_id_idx').on(table.campaignId)],
);

/** Personajes no jugadores de una campaña. Son del máster: los jugadores no los ven. */
export const npcs = pgTable(
  'npcs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    concept: text('concept').notNull().default(''),
    appearance: text('appearance').notNull().default(''),
    personality: text('personality').notNull().default(''),
    speech: text('speech').notNull().default(''),
    goals: text('goals').notNull().default(''),
    secrets: text('secrets').notNull().default(''),
    /** Perfil del reglamento para tirar por él; null si no pelea. */
    profile: text('profile').$type<NpcProfile>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('npcs_campaign_id_idx').on(table.campaignId)],
);

/** Una partida: la sesión de juego que el máster abre dentro de una campaña. */
export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** Número de partida dentro de la campaña: 1, 2, 3... */
    number: integer('number').notNull(),
    title: text('title').notNull().default(''),
    status: text('status').$type<GameStatus>().notNull().default('open'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Resumen de lo que pasó, que el máster escribe al terminar. Es público. */
    recap: text('recap').notNull().default(''),
  },
  (table) => [
    uniqueIndex('games_campaign_number_idx').on(table.campaignId, table.number),
    // Como mucho una partida abierta por campaña.
    uniqueIndex('games_one_open_idx')
      .on(table.campaignId)
      .where(sql`${table.status} = 'open'`),
  ],
);

/** Registro de la partida: lo que se revela, se tira o se anota. De él sale el resumen. */
export const gameEvents = pgTable(
  'game_events',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    visibility: text('visibility').$type<GameEventVisibility>().notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * En un evento en secreto ("private"), el jugador que lo ve además del máster. Si se borra
     * su cuenta, solo lo ve el máster.
     */
    playerId: uuid('player_id').references(() => users.id, { onDelete: 'set null' }),
    payload: jsonb('payload').$type<GameEventPayload>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('game_events_game_id_idx').on(table.gameId, table.id)],
);
