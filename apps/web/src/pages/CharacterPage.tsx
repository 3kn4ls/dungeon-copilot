import {
  ATTRIBUTES,
  ATTRIBUTE_INFO,
  ATTRIBUTE_MAX,
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
  type Advance,
  type Attribute,
  type CharacterBuild,
  type Gear,
} from '@dungeon-copilot/rules';
import type { CharacterView, DamageResponse } from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { GearEditor, GearSummary } from '../components/Gear';
import { ConfirmButton, ErrorNote, QueryState, Stepper, useDocumentTitle } from '../components/ui';
import { useRememberCampaign } from '../current-campaign';
import { keys, useCampaign, useCharacter, useStoreCharacter } from '../queries';
import { requirementText, signed } from '../rules-text';

function toBuild(character: CharacterView): CharacterBuild {
  const { name, background, attributes, skills, advancedSkills } = character;
  return { name, background, attributes, skills, advancedSkills };
}

/** Desventajas que impone el estado del personaje, como una herida grave en tiradas físicas. */
function woundEdges(character: CharacterView, attribute: Attribute, skill?: string) {
  return conditionEdges(toBuild(character), { attribute, skill }, { wounds: character.wounds });
}

/** Enlace al tirador con el bonificador ya puesto. */
function rollLink(
  character: CharacterView,
  attribute: Attribute,
  rank: number,
  label: string,
  skill?: string,
) {
  const params = new URLSearchParams({
    atributo: String(character.attributes[attribute]),
    habilidad: String(rank),
    etiqueta: `${character.name}: ${label}`,
  });
  if (woundEdges(character, attribute, skill).includes('disadvantage')) {
    params.set('desventaja', '1');
  }
  return `/tirador?${params}`;
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
  useDocumentTitle(character.data?.name);

  if (!character.data) return <QueryState error={character.error} />;
  const sheet = character.data;

  return (
    <>
      <header className="masthead">
        <Link to={`/campanas/${sheet.campaignId}`} className="eyebrow back">
          ← {campaign.data?.name ?? 'Campaña'}
        </Link>
        <Identity sheet={sheet} actions={actions} />
      </header>

      <div className="layout layout-main">
        <div className="stack">
          <Attributes sheet={sheet} />
          <Skills sheet={sheet} />
        </div>
        <div className="side">
          <Wounds sheet={sheet} actions={actions} />
          <Equipment sheet={sheet} actions={actions} />
          <Luck sheet={sheet} actions={actions} />
          <Experience sheet={sheet} actions={actions} />
        </div>
      </div>

      {sheet.canEdit && <Advances sheet={sheet} actions={actions} />}
      {sheet.canEdit && <DeleteCharacter sheet={sheet} />}
    </>
  );
}

function Identity({ sheet, actions }: { sheet: CharacterView; actions: SheetActions }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sheet.name);
  const [background, setBackground] = useState(sheet.background);

  if (!editing) {
    return (
      <>
        <h1>{sheet.name}</h1>
        <p className="lede">
          {sheet.background || 'Sin trasfondo'} · de {sheet.ownerName}
        </p>
        {sheet.canEdit && (
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
        )}
      </>
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

function Attributes({ sheet }: { sheet: CharacterView }) {
  return (
    <section className="panel" aria-labelledby="attributes-heading">
      <h2 id="attributes-heading">Atributos</h2>
      <ul className="attribute-tiles">
        {ATTRIBUTES.map((attribute) => {
          const info = ATTRIBUTE_INFO[attribute];
          return (
            <li key={attribute}>
              <Link
                to={rollLink(sheet, attribute, 0, info.label)}
                className="attribute-tile"
                title={`Tirar ${info.label}`}
              >
                <span className="abbr">{info.abbreviation}</span>
                <span className="attribute-value num">{sheet.attributes[attribute]}</span>
                <span className="hint">{info.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Skills({ sheet }: { sheet: CharacterView }) {
  const learned = defaultSkillCatalog.skills.filter(
    (skill) => skill.tier === 'basic' && (sheet.skills[skill.id] ?? 0) > 0,
  );
  const advanced = sheet.advancedSkills
    .map((id) => defaultSkillCatalog.get(id))
    .filter((skill) => skill !== undefined);

  return (
    <section className="panel" aria-labelledby="skills-heading">
      <h2 id="skills-heading">Habilidades</h2>
      {learned.length > 0 ? (
        <ul className="sheet-skills">
          {learned.map((skill) => {
            const rank = sheet.skills[skill.id] ?? 0;
            const bonus = sheet.attributes[skill.attribute] + rank;
            return (
              <li key={skill.id}>
                <span>
                  <span className="skill-name">{skill.name}</span>
                  <span className="hint">
                    {SKILL_RANK_LABELS[rank]} · {ATTRIBUTE_INFO[skill.attribute].abbreviation}
                  </span>
                </span>
                <Link
                  to={rollLink(sheet, skill.attribute, rank, skill.name, skill.id)}
                  className="button small"
                  aria-label={`Tirar ${skill.name} con ${signed(bonus)}`}
                >
                  Tirar {signed(bonus)}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">Sin habilidades entrenadas.</p>
      )}
      <p className="hint">Para lo que no ha entrenado, tira solo con el atributo.</p>

      {advanced.length > 0 && (
        <>
          <h3>Avanzadas</h3>
          <ul className="sheet-advanced">
            {advanced.map((skill) => (
              <li key={skill.id}>
                <span className="skill-name">{skill.name}</span>
                <span className="hint">{skill.description}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Wounds({ sheet, actions }: { sheet: CharacterView; actions: SheetActions }) {
  const [amount, setAmount] = useState(1);
  const { scratches, scratchBoxes, severity } = sheet.wounds;
  const level = SEVERITIES.indexOf(severity);

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
        (woundEdges(sheet, 'strength').length > 0 ? (
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
      <div className="pips" aria-label={`${sheet.luck} de ${LUCK_PER_SESSION}`}>
        {Array.from({ length: LUCK_PER_SESSION }, (_, index) => (
          <span key={index} className={index < sheet.luck ? 'pip filled' : 'pip'} />
        ))}
      </div>
      <p className="hint">Un punto repite una tirada propia o evita una muerte.</p>
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
      await navigate(`/campanas/${sheet.campaignId}`);
    },
  });
  return (
    <div className="danger-zone">
      <ConfirmButton
        confirmLabel={`¿Borrar a ${sheet.name} para siempre?`}
        onConfirm={() => destroy.mutate()}
        disabled={destroy.isPending}
      >
        Borrar personaje
      </ConfirmButton>
      <ErrorNote error={destroy.error} />
    </div>
  );
}
