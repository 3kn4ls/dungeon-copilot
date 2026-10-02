import {
  ATTRIBUTES,
  ATTRIBUTE_INFO,
  ATTRIBUTE_MAX,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  EDGE_LABELS,
  LUCK_PER_SESSION,
  SEVERITIES,
  SEVERITY_LABELS,
  SKILL_RANK_LABELS,
  SKILL_RANK_MAX,
  XP_AWARDS,
  conditionEdges,
  defaultSkillCatalog,
  hasPhysicalDisadvantage,
  planAdvance,
  testOdds,
  type Advance,
  type Attribute,
  type CharacterBuild,
  type DifficultyLevel,
  type Edge,
  type Gear,
} from '@dungeon-copilot/rules';
import type { CharacterView, DamageResponse } from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { Avatar, toneOf } from '../components/Avatar';
import { GearEditor, GearSummary } from '../components/Gear';
import { OddsBar } from '../components/Odds';
import { ConfirmButton, ErrorNote, QueryState, Stepper, useDocumentTitle } from '../components/ui';
import { useRememberCampaign } from '../current-campaign';
import { keys, useCampaign, useCharacter, useStoreCharacter } from '../queries';
import { requirementText, signed } from '../rules-text';

function toBuild(character: CharacterView): CharacterBuild {
  const { name, background, attributes, skills, advancedSkills } = character;
  return { name, background, attributes, skills, advancedSkills };
}

/** Una tirada de la ficha: un atributo y, si se elige, una de sus habilidades. */
interface Check {
  attribute: Attribute;
  skill?: string;
}

/** Desventajas por su estado: una herida grave en lo físico, la armadura pesada en lo sigiloso. */
function checkEdges(character: CharacterView, check: Check) {
  const build = toBuild(character);
  const wounded = conditionEdges(build, check, { wounds: character.wounds }).length > 0;
  const armored = conditionEdges(build, check, { armor: character.gear.armor }).length > 0;
  const edge: Edge = wounded || armored ? 'disadvantage' : 'none';
  return {
    edge,
    reasons: [...(wounded ? ['herida grave'] : []), ...(armored ? ['armadura pesada'] : [])],
  };
}

/** Enlace al tirador con el bonificador (y la desventaja) ya puestos. */
function rollLink(character: CharacterView, check: Check, label: string) {
  const rank = check.skill ? (character.skills[check.skill] ?? 0) : 0;
  const params = new URLSearchParams({
    atributo: String(character.attributes[check.attribute]),
    habilidad: String(rank),
    etiqueta: `${character.name}: ${label}`,
  });
  if (checkEdges(character, check).edge === 'disadvantage') params.set('desventaja', '1');
  return `/tirador?${params}`;
}

/** Lo primero que se ve al abrir la ficha: su habilidad con más bonificador. */
function bestCheck(character: CharacterView): Check {
  const learned = defaultSkillCatalog.skills.filter(
    (skill) => skill.tier === 'basic' && (character.skills[skill.id] ?? 0) > 0,
  );
  const best = learned.sort(
    (a, b) =>
      character.attributes[b.attribute] +
      (character.skills[b.id] ?? 0) -
      (character.attributes[a.attribute] + (character.skills[a.id] ?? 0)),
  )[0];
  return best ? { attribute: best.attribute, skill: best.id } : { attribute: 'strength' };
}

type Panel = 'wounds' | 'luck' | 'xp' | 'advances' | 'identity' | 'gear';

/** Todas las acciones de la ficha comparten estado: una a la vez, y el error sale en su panel. */
function useSheetActions() {
  const storeCharacter = useStoreCharacter();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [lethal, setLethal] = useState(false);
  const mutation = useMutation({
    mutationFn: (run: () => Promise<DamageResponse>) => run(),
    onSuccess: ({ character, lethal }) => {
      storeCharacter(character);
      setLethal(lethal);
    },
  });
  return {
    pending: mutation.isPending,
    lethal,
    dismissLethal: () => setLethal(false),
    errorFor: (name: Panel) => (panel === name ? mutation.error : null),
    run(name: Panel, action: () => Promise<CharacterView | DamageResponse>) {
      setPanel(name);
      mutation.mutate(async () => {
        const result = await action();
        return 'character' in result ? result : { character: result, lethal: false };
      });
    },
  };
}

type SheetActions = ReturnType<typeof useSheetActions>;

export function CharacterPage() {
  const { characterId = '' } = useParams();
  const character = useCharacter(characterId);
  const campaign = useCampaign(character.data?.campaignId ?? '');
  useRememberCampaign(campaign.data?.id);
  const actions = useSheetActions();
  const [check, setCheck] = useState<Check | null>(null);
  useDocumentTitle(character.data?.name);

  if (!character.data) return <QueryState error={character.error} />;
  const sheet = character.data;
  const selected = check ?? bestCheck(sheet);

  return (
    <div className="sheet-page" style={{ '--tone': toneOf(sheet.id) } as CSSProperties}>
      <header className="sheet-head">
        <Link to={`/campanas/${sheet.campaignId}/personajes`} className="eyebrow back">
          ← {campaign.data?.name ?? 'Campaña'}
        </Link>
        <div className="sheet-identity">
          <Avatar name={sheet.name} id={sheet.id} size="xlarge" />
          <Identity sheet={sheet} actions={actions} />
        </div>
      </header>

      <div className="sheet">
        <Attributes sheet={sheet} selected={selected} onSelect={setCheck} />
        <Skills sheet={sheet} selected={selected} onSelect={setCheck} />
        <div className="sheet-grid">
          <Wounds sheet={sheet} actions={actions} />
          <Techniques sheet={sheet} />
          <Equipment sheet={sheet} actions={actions} />
          <Luck sheet={sheet} actions={actions} />
          <Experience sheet={sheet} actions={actions} />
        </div>
        {sheet.canEdit && <Advances sheet={sheet} actions={actions} />}
        {sheet.canEdit && <DeleteCharacter sheet={sheet} />}
      </div>
    </div>
  );
}

function Identity({ sheet, actions }: { sheet: CharacterView; actions: SheetActions }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sheet.name);
  const [background, setBackground] = useState(sheet.background);

  if (!editing) {
    return (
      <div className="sheet-name">
        <h1>{sheet.name}</h1>
        <p className="lede">{sheet.background || 'Sin trasfondo'}</p>
        <p className="muted">
          Juega {sheet.ownerName}
          {sheet.canEdit && (
            <>
              {' · '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setName(sheet.name);
                  setBackground(sheet.background);
                  setEditing(true);
                }}
              >
                Cambiar nombre o trasfondo
              </button>
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <form
      className="panel identity-form"
      onSubmit={(event) => {
        event.preventDefault();
        actions.run('identity', async () => {
          const updated = await api.updateCharacter(sheet.id, { name, background });
          setEditing(false);
          return updated;
        });
      }}
    >
      <label className="field">
        <span className="field-label">Nombre</span>
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Trasfondo</span>
        <input maxLength={200} value={background} onChange={(e) => setBackground(e.target.value)} />
      </label>
      <ErrorNote error={actions.errorFor('identity')} />
      <div className="actions">
        <button type="submit" className="button primary" disabled={actions.pending}>
          Guardar
        </button>
        <button type="button" className="button" onClick={() => setEditing(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Attributes(props: {
  sheet: CharacterView;
  selected: Check;
  onSelect: (check: Check) => void;
}) {
  const { sheet, selected, onSelect } = props;
  return (
    <section className="panel" aria-labelledby="attributes-heading">
      <h2 id="attributes-heading">Atributos</h2>
      <ul className="attribute-tiles">
        {ATTRIBUTES.map((attribute) => {
          const info = ATTRIBUTE_INFO[attribute];
          const chosen = selected.attribute === attribute && !selected.skill;
          return (
            <li key={attribute}>
              <button
                type="button"
                className="attribute-tile"
                aria-pressed={chosen}
                onClick={() => onSelect({ attribute })}
              >
                <span className="abbr">{info.abbreviation}</span>
                <span className="attribute-value">{sheet.attributes[attribute]}</span>
                <span className="attribute-label">{info.label}</span>
                <span className="hint">{info.description}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Todas las habilidades básicas por atributo, con su rango y lo que suma al tirar. */
function Skills(props: {
  sheet: CharacterView;
  selected: Check;
  onSelect: (check: Check) => void;
}) {
  const { sheet, selected, onSelect } = props;
  return (
    <section className="panel" aria-labelledby="skills-heading">
      <h2 id="skills-heading">Habilidades</h2>
      <div className="skill-columns">
        {ATTRIBUTES.map((attribute) => {
          const { basic } = defaultSkillCatalog.byAttribute(attribute);
          return (
            <div key={attribute} className="skill-column">
              <h3>
                {ATTRIBUTE_INFO[attribute].label}{' '}
                <span className="num">{sheet.attributes[attribute]}</span>
              </h3>
              <ul>
                {basic.map((skill) => {
                  const rank = sheet.skills[skill.id] ?? 0;
                  return (
                    <li key={skill.id}>
                      <button
                        type="button"
                        className={rank > 0 ? 'skill-button' : 'skill-button untrained'}
                        aria-pressed={selected.skill === skill.id}
                        aria-label={`${skill.name}: ${SKILL_RANK_LABELS[rank]}, tira con ${signed(sheet.attributes[attribute] + rank)}`}
                        onClick={() => onSelect({ attribute, skill: skill.id })}
                      >
                        <span>{skill.name}</span>
                        <Rank value={rank} />
                        <strong className="num">
                          {signed(sheet.attributes[attribute] + rank)}
                        </strong>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <CheckOdds sheet={sheet} check={selected} />
    </section>
  );
}

function Rank({ value }: { value: number }) {
  return (
    <span className="rank" aria-hidden="true">
      {Array.from({ length: SKILL_RANK_MAX }, (_, i) => (
        <i key={i} className={i < value ? 'on' : undefined} />
      ))}
    </span>
  );
}

/** Lo elegido en la ficha contra cada dificultad: la probabilidad de cada resultado. */
function CheckOdds({ sheet, check }: { sheet: CharacterView; check: Check }) {
  const [level, setLevel] = useState<DifficultyLevel>('normal');
  const skill = check.skill ? defaultSkillCatalog.get(check.skill) : undefined;
  const label = skill?.name ?? ATTRIBUTE_INFO[check.attribute].label;
  const rank = check.skill ? (sheet.skills[check.skill] ?? 0) : 0;
  const untrained = check.skill !== undefined && rank === 0;
  const bonus = sheet.attributes[check.attribute] + rank;
  const { edge, reasons } = checkEdges(sheet, check);
  const odds = testOdds({ bonus, edge }, DIFFICULTIES[level]);
  const difficulties = Object.keys(DIFFICULTIES) as DifficultyLevel[];

  return (
    <div className="check-odds" aria-live="polite">
      <p className="check-title">
        <strong>
          {label} {signed(bonus)}
        </strong>{' '}
        contra
      </p>
      <div className="chips" role="group" aria-label="Dificultad">
        {difficulties.map((difficulty) => (
          <button
            key={difficulty}
            type="button"
            className="chip"
            aria-pressed={level === difficulty}
            onClick={() => setLevel(difficulty)}
          >
            {DIFFICULTY_LABELS[difficulty]}{' '}
            <strong className="num">{DIFFICULTIES[difficulty]}</strong>
          </button>
        ))}
      </div>
      <OddsBar odds={odds} legend />
      {edge !== 'none' && (
        <p className="hint unmet">
          {EDGE_LABELS[edge]} por {reasons.join(' y ')}.
        </p>
      )}
      <p className="hint">
        {untrained && 'Sin entrenar: tira solo con el atributo. '}
        <Link to={rollLink(sheet, check, label)}>Tirarla en el tirador</Link>
      </p>
    </div>
  );
}

/** Las habilidades avanzadas: lo que hacen y si se gastan (una vez por escena o por sesión). */
function Techniques({ sheet }: { sheet: CharacterView }) {
  const techniques = sheet.advancedSkills
    .map((id) => defaultSkillCatalog.get(id))
    .filter((skill) => skill?.tier === 'advanced');
  return (
    <section className="panel" aria-labelledby="techniques-heading">
      <h2 id="techniques-heading">Técnicas</h2>
      {techniques.length > 0 ? (
        <ul className="technique-list">
          {techniques.map((skill) => (
            <li key={skill.id}>
              <strong>{skill.name}</strong>
              {skill.limit && (
                <span className="badge">
                  Una vez por {skill.limit === 'scene' ? 'escena' : 'sesión'}
                </span>
              )}
              <p className="hint">{skill.description}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Ninguna todavía. Se aprenden con experiencia.</p>
      )}
    </section>
  );
}

function Wounds({ sheet, actions }: { sheet: CharacterView; actions: SheetActions }) {
  const [amount, setAmount] = useState(1);
  const { scratches, scratchBoxes, severity } = sheet.wounds;
  const level = SEVERITIES.indexOf(severity);
  const physical = checkEdges(sheet, { attribute: 'strength' }).edge === 'disadvantage';

  return (
    <section className="panel" aria-labelledby="wounds-heading">
      <h2 id="wounds-heading">Heridas</h2>
      <div className="field">
        <span className="field-label">
          Rasguños {scratches} de {scratchBoxes}
        </span>
        <div className="boxes" aria-hidden="true">
          {Array.from({ length: scratchBoxes }, (_, index) => (
            <span key={index} className={index < scratches ? 'box marked' : 'box'} />
          ))}
        </div>
      </div>
      <ol className="severity-track" aria-label="Gravedad">
        {SEVERITIES.map((step, index) => (
          <li
            key={step}
            className={index === level ? 'current' : index < level ? 'passed' : undefined}
            aria-current={index === level ? 'step' : undefined}
          >
            {SEVERITY_LABELS[step]}
          </li>
        ))}
      </ol>
      {hasPhysicalDisadvantage(sheet.wounds) &&
        (physical ? (
          <p className="hint unmet">Desventaja en tiradas de Fuerza, Destreza y Aguante.</p>
        ) : (
          <p className="hint">Imparable: la herida no le da desventaja.</p>
        ))}

      {actions.lethal && (
        <div className="alert" role="alert">
          <p>
            <strong>Golpe mortal.</strong> {sheet.name} muere salvo que gaste un punto de Suerte.
          </p>
          <div className="actions">
            {sheet.luck > 0 && (
              <button
                type="button"
                className="button primary"
                disabled={actions.pending}
                onClick={() =>
                  actions.run('wounds', () =>
                    api.updateCharacter(sheet.id, { luck: sheet.luck - 1 }),
                  )
                }
              >
                Gastar Suerte y seguir con vida
              </button>
            )}
            <button type="button" className="button" onClick={actions.dismissLethal}>
              Entendido
            </button>
          </div>
        </div>
      )}

      {sheet.canEdit && (
        <>
          <div className="damage-row">
            <Stepper label="Daño" value={amount} min={1} max={10} onChange={setAmount} />
            <button
              type="button"
              className="button"
              disabled={actions.pending}
              onClick={() => actions.run('wounds', () => api.damage(sheet.id, { amount }))}
            >
              Recibir daño
            </button>
          </div>
          <div className="actions">
            <button
              type="button"
              className="button small"
              disabled={actions.pending || scratches === 0}
              onClick={() =>
                actions.run('wounds', () => api.recover(sheet.id, { kind: 'scratches' }))
              }
            >
              Recuperar el aliento
            </button>
            <button
              type="button"
              className="button small"
              disabled={actions.pending || severity === 'none'}
              onClick={() =>
                actions.run('wounds', () => api.recover(sheet.id, { kind: 'severity' }))
              }
            >
              Descansar: mejora un nivel
            </button>
          </div>
          <ErrorNote error={actions.errorFor('wounds')} />
        </>
      )}
    </section>
  );
}

/** Lo que lleva para pelear: sale por defecto al atacar, parar y recibir un golpe. */
function Equipment({ sheet, actions }: { sheet: CharacterView; actions: SheetActions }) {
  const [draft, setDraft] = useState<Gear | null>(null);
  return (
    <section className="panel" aria-labelledby="gear-heading">
      <h2 id="gear-heading">Equipo</h2>
      {draft ? (
        <form
          className="stack tight"
          onSubmit={(event) => {
            event.preventDefault();
            actions.run('gear', async () => {
              const character = await api.updateCharacter(sheet.id, { gear: draft });
              setDraft(null);
              return character;
            });
          }}
        >
          <GearEditor value={draft} onChange={setDraft} />
          <div className="actions">
            <button type="submit" className="button primary small" disabled={actions.pending}>
              Guardar
            </button>
            <button type="button" className="button small" onClick={() => setDraft(null)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <>
          <GearSummary gear={sheet.gear} />
          <p className="hint">Sale por defecto al atacar, al parar y al recibir un golpe.</p>
          {sheet.canEdit && (
            <button type="button" className="link-button" onClick={() => setDraft(sheet.gear)}>
              Cambiar el equipo
            </button>
          )}
        </>
      )}
      <ErrorNote error={actions.errorFor('gear')} />
    </section>
  );
}

function Luck({ sheet, actions }: { sheet: CharacterView; actions: SheetActions }) {
  const setLuck = (luck: number) =>
    actions.run('luck', () => api.updateCharacter(sheet.id, { luck }));
  return (
    <section className="panel" aria-labelledby="luck-heading">
      <h2 id="luck-heading">Suerte</h2>
      <div className="pips" role="img" aria-label={`${sheet.luck} de ${LUCK_PER_SESSION}`}>
        {Array.from({ length: LUCK_PER_SESSION }, (_, index) => (
          <span key={index} className={index < sheet.luck ? 'pip filled' : 'pip'} />
        ))}
      </div>
      <p className="hint">
        Un punto repite una tirada propia o evita una muerte. Vuelve a {LUCK_PER_SESSION} al empezar
        cada partida.
      </p>
      {sheet.canEdit && (
        <div className="actions">
          <button
            type="button"
            className="button small"
            disabled={actions.pending || sheet.luck === 0}
            onClick={() => setLuck(sheet.luck - 1)}
          >
            Gastar un punto
          </button>
          <button
            type="button"
            className="button small"
            disabled={actions.pending || sheet.luck === LUCK_PER_SESSION}
            onClick={() => setLuck(LUCK_PER_SESSION)}
          >
            Nueva sesión: llenar
          </button>
        </div>
      )}
      <ErrorNote error={actions.errorFor('luck')} />
    </section>
  );
}

function Experience({ sheet, actions }: { sheet: CharacterView; actions: SheetActions }) {
  const [custom, setCustom] = useState(1);
  const award = (amount: number) => actions.run('xp', () => api.awardXp(sheet.id, { amount }));
  return (
    <section className="panel" aria-labelledby="xp-heading">
      <h2 id="xp-heading">Experiencia</h2>
      <p className="xp-total">
        <strong className="num">{sheet.xp}</strong> PX para gastar
      </p>
      {sheet.canAwardXp && (
        <>
          <div className="actions">
            <button
              type="button"
              className="button small"
              disabled={actions.pending}
              onClick={() => award(XP_AWARDS.perSession)}
            >
              Fin de sesión {signed(XP_AWARDS.perSession)}
            </button>
            <button
              type="button"
              className="button small"
              disabled={actions.pending}
              onClick={() => award(XP_AWARDS.perMilestone)}
            >
              Hito {signed(XP_AWARDS.perMilestone)}
            </button>
          </div>
          <div className="damage-row">
            <Stepper
              label="Otra cantidad"
              value={custom}
              min={-10}
              max={10}
              format={signed}
              onChange={(value) => setCustom(value === 0 ? (custom > 0 ? -1 : 1) : value)}
            />
            <button
              type="button"
              className="button small"
              disabled={actions.pending}
              onClick={() => award(custom)}
            >
              {custom > 0 ? 'Dar' : 'Quitar'}
            </button>
          </div>
        </>
      )}
      <ErrorNote error={actions.errorFor('xp')} />
    </section>
  );
}

interface AdvanceOption {
  key: string;
  label: string;
  detail: string;
  advance: Advance;
}

/** Mejoras de un atributo y sus habilidades. Lo que ya está al máximo no aparece. */
function advanceOptions(sheet: CharacterView, attribute: Attribute): AdvanceOption[] {
  const info = ATTRIBUTE_INFO[attribute];
  const value = sheet.attributes[attribute];
  const { basic, advanced } = defaultSkillCatalog.byAttribute(attribute);
  const options: AdvanceOption[] = [];
  if (value < ATTRIBUTE_MAX) {
    options.push({
      key: attribute,
      label: `${info.label} ${value} → ${value + 1}`,
      detail: 'Atributo',
      advance: { kind: 'raiseAttribute', attribute },
    });
  }
  for (const skill of basic) {
    const rank = sheet.skills[skill.id] ?? 0;
    if (rank >= SKILL_RANK_MAX) continue;
    options.push({
      key: skill.id,
      label: `${skill.name} ${rank} → ${rank + 1}`,
      detail: SKILL_RANK_LABELS[rank + 1] ?? '',
      advance: { kind: 'raiseSkill', skill: skill.id },
    });
  }
  return [
    ...options,
    ...advanced
      .filter((skill) => !sheet.advancedSkills.includes(skill.id))
      .map((skill): AdvanceOption => ({
        key: skill.id,
        label: `Aprender ${skill.name}`,
        detail: requirementText(skill),
        advance: { kind: 'learnAdvanced', skill: skill.id },
      })),
  ];
}

/** La tienda de experiencia: cada mejora con su precio, y por qué no se puede si no se puede. */
function Advances({ sheet, actions }: { sheet: CharacterView; actions: SheetActions }) {
  const build = toBuild(sheet);
  return (
    <details className="panel advances">
      <summary>
        <h2>Gastar experiencia</h2>
        <span className="muted">Tiene {sheet.xp} PX</span>
      </summary>
      <ErrorNote error={actions.errorFor('advances')} />
      <div className="advance-groups">
        {ATTRIBUTES.map((attribute) => (
          <section key={attribute} aria-label={ATTRIBUTE_INFO[attribute].label}>
            <h3>{ATTRIBUTE_INFO[attribute].label}</h3>
            <ul className="advance-list">
              {advanceOptions(sheet, attribute).map((option) => {
                const plan = planAdvance(build, option.advance);
                // En rojo lo que el reglamento no permite; en gris, lo que solo espera a tener PX.
                const detail = !plan.ok
                  ? plan.errors.join(' · ')
                  : plan.cost > sheet.xp
                    ? `Faltan ${plan.cost - sheet.xp} PX`
                    : option.detail;
                return (
                  <li key={option.key}>
                    <span>
                      <span className="skill-name">{option.label}</span>
                      <span className={plan.ok ? 'hint' : 'hint unmet'}>{detail}</span>
                    </span>
                    {plan.ok && (
                      <button
                        type="button"
                        className="button small"
                        disabled={actions.pending || plan.cost > sheet.xp}
                        onClick={() =>
                          actions.run('advances', () => api.advance(sheet.id, option.advance))
                        }
                      >
                        {plan.cost} PX
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

function DeleteCharacter({ sheet }: { sheet: CharacterView }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const destroy = useMutation({
    mutationFn: () => api.deleteCharacter(sheet.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: keys.character(sheet.id) });
      await queryClient.invalidateQueries({ queryKey: keys.characters(sheet.campaignId) });
      await navigate(`/campanas/${sheet.campaignId}/personajes`);
    },
  });
  return (
    <div className="danger-zone">
      <ConfirmButton
        confirmLabel={`¿Borrar a ${sheet.name} para siempre?`}
        onConfirm={() => destroy.mutate()}
        disabled={destroy.isPending}
        quiet
      >
        Borrar personaje
      </ConfirmButton>
      <ErrorNote error={destroy.error} />
    </div>
  );
}
