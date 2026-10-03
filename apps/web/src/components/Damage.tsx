import {
  COST_BLOW,
  DAMAGE_CAP_LABELS,
  NPC_PROFILES,
  UNHARMED,
  WEAPON_CLASSES,
  attackExtras,
  attackWeapon,
  combatBlows,
  hitDamage,
  memberDamage,
  weaponLabel,
  type ArmorClass,
  type DamagePart,
  type Outcome,
  type WeaponClass,
} from '@dungeon-copilot/rules';
import {
  groupSize,
  isSpent,
  memberName,
  type CharacterView,
  type Combat,
  type GameDetail,
  type GameEvent,
  type NpcCombatant,
  type SpentAbilities,
} from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { refreshCharacters, useEnemyDecision, useMe, useStoreGameEvent } from '../queries';
import { buildOf } from '../rolling';
import { signed } from '../rules-text';
import { MoraleAdvice } from './Decisions';
import { struckName } from './GameEvents';
import { ARMOR_OPTIONS, WEAPON_OPTIONS } from './Gear';
import { ConfirmButton, ErrorNote, Segmented, Stepper } from './ui';

export type DamageEvent = GameEvent & { kind: 'damage' };

/** Quien da un golpe: un personaje (con su equipo), unos PNJ (con su perfil) o nadie (a mano). */
export type Striker =
  { kind: 'character'; character: CharacterView } | { kind: 'npc'; combatant: NpcCombatant } | null;

/** Alguien que puede recibir un golpe: del combate o, fuera de él, un personaje de la mesa. */
export interface Candidate {
  id: string;
  name: string;
  /** Su ficha, si es un personaje. */
  character?: CharacterView | undefined;
  /** Si son PNJ del combate, quiénes son y el daño que lleva cada uno del grupo. */
  npc?: { combatant: NpcCombatant; members: number[] } | undefined;
}

/** A quién se le puede dar un golpe: a quien pelea o, sin combate, a los personajes. */
export function candidatesOf(combat: Combat | null, characters: CharacterView[]): Candidate[] {
  if (!combat) return characters.map((character) => ({ ...character, character }));
  return combat.order.map((combatant) => ({
    id: combatant.id,
    name: combatant.name,
    character:
      combatant.kind === 'character'
        ? characters.find((character) => character.id === combatant.id)
        : undefined,
    npc:
      combatant.kind === 'npc'
        ? {
            combatant,
            members: memberDamage(
              combatant.profile,
              groupSize(combatant),
              combat.harm[combatant.id] ?? UNHARMED,
            ),
          }
        : undefined,
  }));
}

/** Quien da el golpe, por su id: un personaje de la mesa o unos PNJ del combate. */
function strikerOf(
  id: string | undefined,
  combat: Combat | null,
  characters: CharacterView[],
): Striker {
  if (id === undefined) return null;
  const character = characters.find((other) => other.id === id);
  if (character) return { kind: 'character', character };
  const combatant = combat?.order.find((other) => other.id === id);
  return combatant?.kind === 'npc' ? { kind: 'npc', combatant } : null;
}

/** «Espada larga (media) 2 · Crítico +1 · Armadura ligera −1». */
const partsText = (parts: DamagePart[]) =>
  parts
    .map(
      (part, index) =>
        `${part.label} ${index === 0 ? part.value : signed(part.value).replace('-', '−')}`,
    )
    .join(' · ');

/**
 * Para aplicar un golpe: propone el daño con lo que dice el reglamento (el arma de la ficha o el
 * daño del perfil, el crítico, las técnicas y la armadura de quien lo recibe) y el máster lo
 * retoca si hace falta. Sin `striker`, el daño se pone a mano.
 */
export function DamageForm(props: {
  game: GameDetail;
  /** Qué golpe es: «Golpe de Kael a Garrick», «Garrick le devuelve el golpe». */
  title: string;
  striker: Striker;
  /** A quién va, si se sabe; si no, se elige entre `candidates`. */
  targetId?: string | undefined;
  /** Si va a uno de un grupo y se sabe a cuál (se apuntó en el mapa). */
  member?: number | undefined;
  candidates: Candidate[];
  critical?: boolean;
  /** El resultado de la tirada del golpe: Golpe demoledor depende de él. */
  outcome?: Outcome;
  /** Es un disparo: cuenta el arma a distancia. */
  ranged?: boolean;
  /** Lo que suma o resta la tirada, como el coste de un éxito con coste. */
  extras?: DamagePart[];
  /** A distancia, un éxito con coste puede costar 1 de daño. */
  lessOnCost?: boolean;
  /** La tirada de la que sale el golpe. */
  roll?: number | undefined;
  spent: SpentAbilities;
  onDone?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
}) {
  const { game, striker, candidates, critical = false, outcome = 'success' } = props;
  const queryClient = useQueryClient();
  const storeEvent = useStoreGameEvent(game.id);
  const [chosen, setChosen] = useState(props.targetId ?? '');
  const sheetWeapon =
    striker?.kind === 'character'
      ? attackWeapon(striker.character.gear, props.ranged ?? false)
      : null;
  const [weapon, setWeapon] = useState<WeaponClass | null>(sheetWeapon?.weapon ?? null);
  const [surprise, setSurprise] = useState(false);
  const [less, setLess] = useState(false);
  // La armadura y Esquiva prodigiosa son de quien recibe el golpe: si cambia, vuelven a su ficha.
  const [armorChoice, setArmorChoice] = useState<{ targetId: string; armor: ArmorClass } | null>(
    null,
  );
  const [dodgeFor, setDodgeFor] = useState<string | null>(null);
  const [override, setOverride] = useState<{ inputs: string; amount: number } | null>(null);
  // A cuál de un grupo: el que se elige o, si no, al que se apuntó (o el que sigue peleando).
  const [memberChoice, setMemberChoice] = useState<{
    targetId: string;
    member: number | undefined;
  } | null>(null);

  const targetId = props.targetId ?? chosen;
  const target = props.candidates.find((candidate) => candidate.id === targetId);
  const group = target?.npc && groupSize(target.npc.combatant) > 1 ? target.npc : undefined;
  const member =
    memberChoice?.targetId === targetId
      ? memberChoice.member
      : targetId === props.targetId
        ? props.member
        : undefined;
  const toughness = group ? NPC_PROFILES[group.combatant.profile].toughness : 0;
  const targetName =
    group && member !== undefined ? memberName(group.combatant, member) : target?.name;
  const sheet = target?.character;
  const armor =
    armorChoice?.targetId === targetId ? armorChoice.armor : (sheet?.gear.armor ?? 'none');
  const canDodge =
    sheet !== undefined &&
    sheet.advancedSkills.includes('uncanny-dodge') &&
    !isSpent(props.spent, sheet.id, 'uncanny-dodge');
  const dodging = canDodge && dodgeFor === targetId;
  const canSneak =
    striker?.kind === 'character' && striker.character.advancedSkills.includes('sneak-attack');

  let source: DamagePart | null = null;
  if (striker?.kind === 'character' && weapon) {
    const name = weapon === sheetWeapon?.weapon ? sheetWeapon.name : '';
    source = { label: weaponLabel({ name, weapon }), value: WEAPON_CLASSES[weapon].damage };
  }
  if (striker?.kind === 'npc') {
    const profile = NPC_PROFILES[striker.combatant.profile];
    source = { label: profile.label, value: profile.damage };
  }
  const extras = [
    ...(props.extras ?? []),
    ...(striker?.kind === 'character' && weapon
      ? attackExtras(buildOf(striker.character), weapon, outcome, surprise)
      : []),
    ...(less ? [{ label: 'Coste: 1 menos', value: -1 }] : []),
  ];
  const damage =
    source &&
    hitDamage({ source, critical, extras, armor: sheet ? armor : 'none', dodge: dodging });
  // Lo retocado vale mientras no cambie nada de lo que da el daño.
  const inputs = JSON.stringify([targetId, weapon, surprise, armor, less]);
  const amount = dodging
    ? 1
    : override?.inputs === inputs
      ? override.amount
      : (damage?.amount ?? 1);

  const apply = useMutation({
    mutationFn: () =>
      api.dealDamage(game.id, {
        targetId,
        member: group ? member : undefined,
        amount,
        roll: props.roll,
        dodge: dodging,
      }),
    onSuccess: (event) => {
      storeEvent(event);
      if (event.kind === 'damage' && event.target.kind === 'character') {
        refreshCharacters(queryClient, game.campaignId);
      }
      props.onDone?.();
    },
  });

  return (
    <div className="damage-form stack tight">
      <p className="field-label">{props.title}</p>
      {props.targetId === undefined && (
        <label className="field">
          <span className="field-label">A quién</span>
          <select value={chosen} onChange={(event) => setChosen(event.target.value)}>
            <option value="">Elige a quién</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {group && (
        <label className="field">
          <span className="field-label">A cuál de {group.combatant.name}</span>
          <select
            value={member ?? ''}
            onChange={(event) =>
              setMemberChoice({
                targetId,
                member: event.target.value === '' ? undefined : Number(event.target.value),
              })
            }
          >
            <option value="">Al que sigue peleando: el más herido</option>
            {group.members.map((taken, index) =>
              taken >= toughness ? null : (
                <option key={index} value={index}>
                  {memberName(group.combatant, index)}
                  {taken > 0 ? ` (lleva ${taken} de ${toughness})` : ''}
                </option>
              ),
            )}
          </select>
        </label>
      )}
      {striker?.kind === 'character' && weapon && (
        <Segmented
          label={`Arma de ${striker.character.name}`}
          value={weapon}
          options={WEAPON_OPTIONS}
          onChange={setWeapon}
        />
      )}
      {canSneak && (
        <label className="check">
          <input
            type="checkbox"
            checked={surprise}
            onChange={(event) => setSurprise(event.target.checked)}
          />
          Por sorpresa: Ataque furtivo +2
        </label>
      )}
      {source && sheet && (
        <Segmented
          label={`Armadura de ${sheet.name}`}
          value={armor}
          options={ARMOR_OPTIONS}
          onChange={(next) => setArmorChoice({ targetId, armor: next })}
        />
      )}
      {props.lessOnCost && (
        <label className="check">
          <input
            type="checkbox"
            checked={less}
            onChange={(event) => setLess(event.target.checked)}
          />
          Coste: hace 1 de daño menos
        </label>
      )}
      {canDodge && (
        <label className="check">
          <input
            type="checkbox"
            checked={dodging}
            onChange={(event) => setDodgeFor(event.target.checked ? targetId : null)}
          />
          {sheet.name} gasta Esquiva prodigiosa: el daño se queda en 1
        </label>
      )}
      {damage && (
        <p className="damage-breakdown">
          {partsText(damage.parts)} → <strong>{damage.amount}</strong>
          {damage.capped && <span className="muted"> ({DAMAGE_CAP_LABELS[damage.capped]})</span>}
        </p>
      )}
      <div className="damage-row">
        {!dodging && (
          <Stepper
            label="Daño"
            value={amount}
            min={1}
            max={20}
            onChange={(value) => setOverride({ inputs, amount: value })}
          />
        )}
        <button
          type="button"
          className="button primary"
          disabled={!target || apply.isPending}
          onClick={() => apply.mutate()}
        >
          {target ? `Aplicar ${amount} de daño a ${targetName}` : 'Aplicar el daño'}
        </button>
        {props.onCancel && (
          <button type="button" className="link-button" onClick={props.onCancel}>
            Cancelar
          </button>
        )}
      </div>
      <ErrorNote error={apply.error} />
    </div>
  );
}

/** Un golpe que el máster puede aplicar o no, como el coste de un éxito con coste. */
function OptionalBlow({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="actions">
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          {label}
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Los golpes de una tirada de combate, bajo la tirada en la sala del máster: el impacto de quien
 * actúa y, si el resultado lo da, el golpe de vuelta de su rival. Lo aplicado ya no se ofrece.
 */
export function RollDamage(props: {
  game: GameDetail;
  event: GameEvent & { kind: 'roll' };
  /** Los golpes ya aplicados de esta tirada. */
  applied: DamageEvent[];
  combat: Combat | null;
  characters: CharacterView[];
  spent: SpentAbilities;
}) {
  const { game, event, applied, combat, characters, spent } = props;
  const { roll } = event;
  const blows = combatBlows(roll.situation, roll.result.outcome);
  if (!blows.hit && !blows.counter) return null;

  const attackerId = roll.blow?.attacker.id ?? roll.actor.characterId;
  const defenderId =
    roll.blow?.defender.id ??
    (roll.target.kind === 'opposed' ? roll.target.characterId : undefined);
  const attackerName = roll.blow?.attacker.name ?? roll.actor.label;
  const defenderName =
    roll.blow?.defender.name ?? (roll.target.kind === 'opposed' ? roll.target.label : undefined);
  const candidates = candidatesOf(combat, characters);
  const hitDone = defenderId
    ? applied.some((blow) => blow.target.id === defenderId)
    : applied.some((blow) => blow.target.id !== attackerId);
  const counterDone = attackerId ? applied.some((blow) => blow.target.id === attackerId) : false;
  // Si el blanco ya no está (cayó y salió del combate), se elige a mano.
  const known = (id: string | undefined) =>
    id !== undefined && candidates.some((candidate) => candidate.id === id) ? id : undefined;

  return (
    <div className="roll-damage stack tight">
      {applied.map((blow) => (
        <p key={blow.id} className="muted">
          Aplicado: {blow.amount} de daño a {struckName(blow.target)}.
        </p>
      ))}
      {blows.hit && !hitDone && (
        <DamageForm
          game={game}
          title={
            defenderName ? `Golpe de ${attackerName} a ${defenderName}` : `Golpe de ${attackerName}`
          }
          striker={strikerOf(attackerId, combat, characters)}
          targetId={known(defenderId)}
          member={roll.blow?.defender.member}
          candidates={candidates}
          critical={blows.critical}
          outcome={roll.result.outcome}
          ranged={roll.situation === 'ranged'}
          lessOnCost={blows.lessOnCost}
          roll={event.id}
          spent={spent}
        />
      )}
      {blows.counter && attackerId && defenderName && !counterDone && (
        <OptionalBlow
          label={
            blows.counter === 'cost'
              ? `Coste: ${defenderName} le devuelve el golpe (su daño −1)`
              : `${attackerName} queda expuesto: ${defenderName} le golpea`
          }
        >
          <DamageForm
            game={game}
            title={`Golpe de ${defenderName} a ${attackerName}`}
            striker={strikerOf(defenderId, combat, characters)}
            targetId={known(attackerId)}
            member={roll.blow?.attacker.member}
            candidates={candidates}
            extras={blows.counter === 'cost' ? [COST_BLOW] : []}
            roll={event.id}
            spent={spent}
          />
        </OptionalBlow>
      )}
    </div>
  );
}

/** Daño a mano: una trampa, un hechizo, una caída o un golpe que no salió de una tirada. */
export function ManualDamage(props: {
  game: GameDetail;
  combat: Combat | null;
  characters: CharacterView[];
  spent: SpentAbilities;
}) {
  const [key, setKey] = useState<number | null>(null);
  if (key === null) {
    return (
      <div className="actions">
        <button type="button" className="link-button" onClick={() => setKey(Date.now())}>
          Aplicar daño a mano
        </button>
      </div>
    );
  }
  return (
    <DamageForm
      key={key}
      game={props.game}
      title="Daño a mano: una trampa, un hechizo, una caída"
      striker={null}
      candidates={candidatesOf(props.combat, props.characters)}
      spent={props.spent}
      onDone={() => setKey(null)}
      onCancel={() => setKey(null)}
    />
  );
}

/**
 * Bajo el golpe que deja a un personaje fuera de combate: si es mortal, su jugador (o el máster)
 * gasta Suerte para seguir con vida; con Imparable sin usar, aguanta en pie un turno más.
 */
export function FallenActions(props: {
  game: GameDetail;
  event: DamageEvent;
  characters: CharacterView[];
  spent: SpentAbilities;
  /** Ya ha gastado Suerte para salvarse de este golpe. */
  survived: boolean;
}) {
  const { game, event, characters, spent, survived } = props;
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const storeEvent = useStoreGameEvent(game.id);
  const onSuccess = (shown: GameEvent) => {
    storeEvent(shown);
    refreshCharacters(queryClient, game.campaignId);
  };
  const survive = useMutation({
    mutationFn: () => api.survive(game.id, event.id),
    onSuccess,
    onError: () => refreshCharacters(queryClient, game.campaignId),
  });
  const stand = useMutation({
    mutationFn: (characterId: string) =>
      api.useAbility(game.id, { characterId, skill: 'unstoppable' }),
    onSuccess,
  });
  const { target } = event;
  const character = characters.find((other) => other.id === target.id);
  if (target.kind !== 'character' || !character) return null;
  const mine = game.role === 'master' || character.ownerId === me?.user?.id;
  if (!mine) return null;
  const lethal = target.lethal && !survived;
  const unstoppable =
    target.after.severity === 'down' &&
    character.advancedSkills.includes('unstoppable') &&
    !isSpent(spent, character.id, 'unstoppable');
  if (!lethal && !unstoppable) return null;

  return (
    <div className="luck-row">
      {lethal &&
        (character.luck > 0 ? (
          <ConfirmButton
            small
            confirmLabel="¿Gastar 1 de Suerte?"
            disabled={survive.isPending}
            onConfirm={() => survive.mutate()}
          >
            Gastar Suerte y seguir con vida
          </ConfirmButton>
        ) : (
          <p className="muted">A {character.name} no le queda Suerte.</p>
        ))}
      {unstoppable && (
        <button
          type="button"
          className="button small"
          disabled={stand.isPending}
          onClick={() => stand.mutate(character.id)}
        >
          Imparable: aguanta en pie hasta el final de su siguiente turno
        </button>
      )}
      <ErrorNote error={survive.error ?? stand.error} />
    </div>
  );
}

/**
 * Bajo el golpe que tumba a uno de un grupo de PNJ que sigue en pie, lo que sugiere la IA de su
 * moral: si puede que huyan o se rindan, con un botón para sacarlos del combate. Solo para el
 * máster; mientras la IA piensa, o si falla, no dice nada.
 */
export function MoraleHint(props: { game: GameDetail; combat: Combat; event: DamageEvent }) {
  const { game, combat, event } = props;
  const storeEvent = useStoreGameEvent(game.id);
  const fighting = combat.order.find((combatant) => combatant.id === event.target.id);
  const enemy = fighting?.kind === 'npc' ? fighting : undefined;
  const advice = useEnemyDecision(game.id, enemy?.id, `golpe:${event.id}`, false);
  const leave = useMutation({
    mutationFn: (combatantId: string) => api.leaveCombat(game.id, { combatantId }),
    onSuccess: storeEvent,
  });
  if (!enemy || !advice.data) return null;
  return (
    <>
      <MoraleAdvice
        decision={advice.data}
        enemy={enemy}
        leaving={leave.isPending}
        onLeave={() => leave.mutate(enemy.id)}
      />
      <ErrorNote error={leave.error} />
    </>
  );
}

/**
 * El golpe tras el que se pregunta por la moral de unos PNJ: el último a PNJ del combate en juego,
 * si tumba a uno y el grupo sigue peleando.
 */
export function moraleBlow(
  events: readonly GameEvent[],
  combat: Combat | null,
): number | undefined {
  if (!combat) return undefined;
  const last = events.findLast(
    (event): event is DamageEvent =>
      event.kind === 'damage' && event.target.kind === 'npc' && event.id > combat.startedAt,
  );
  if (last?.target.kind !== 'npc' || !last.target.fell) return undefined;
  const standing = last.target.count - last.target.harm.down;
  const fighting = combat.order.some((combatant) => combatant.id === last.target.id);
  return standing > 0 && fighting ? last.id : undefined;
}
