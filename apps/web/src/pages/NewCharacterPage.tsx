import {
  ATTRIBUTES,
  ATTRIBUTE_INFO,
  ATTRIBUTE_MIN,
  CREATION,
  DEFAULT_GEAR,
  SKILL_RANK_LABELS,
  defaultSkillCatalog,
  scratchBoxes,
  unmetRequirements,
  validateNewCharacter,
  type Attributes,
  type CharacterBuild,
  type Gear,
} from '@dungeon-copilot/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { GearEditor, GearSummary } from '../components/Gear';
import { Icon } from '../components/Icon';
import { ErrorNote, QueryState, Stepper, useDocumentTitle } from '../components/ui';
import { keys, useCampaign, useStoreCharacter } from '../queries';
import { requirementText, signed, sum } from '../rules-text';

const START: Attributes = { strength: 2, dexterity: 2, charisma: 2, intelligence: 2, endurance: 2 };

const STEPS = ['Quién es', 'Atributos', 'Habilidades', 'Técnica y equipo'] as const;

/**
 * Crear un personaje en cuatro pasos, con el reparto del reglamento: lo que falta o sobra se ve
 * en cada paso y en el resumen, que deja crearlo en cuanto todo cuadra.
 */
export function NewCharacterPage() {
  const { campaignId = '' } = useParams();
  const campaign = useCampaign(campaignId);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [background, setBackground] = useState('');
  const [attributes, setAttributes] = useState<Attributes>(START);
  const [skills, setSkills] = useState<Record<string, number>>({});
  const [advanced, setAdvanced] = useState<string | null>(null);
  const [gear, setGear] = useState<Gear>(DEFAULT_GEAR);
  const queryClient = useQueryClient();
  const storeCharacter = useStoreCharacter();
  const navigate = useNavigate();
  useDocumentTitle('Nuevo personaje');

  const build: CharacterBuild = {
    name: name.trim(),
    background: background.trim(),
    attributes,
    skills: Object.fromEntries(Object.entries(skills).filter(([, rank]) => rank > 0)),
    advancedSkills: advanced ? [advanced] : [],
  };
  const pointsLeft = CREATION.attributePoints - sum(attributes);
  const ranksLeft = CREATION.skillRanks - sum(skills);
  const problems = [
    ...(build.name ? [] : ['Ponle un nombre']),
    ...validateNewCharacter(build).map((issue) => issue.message),
  ];
  // Un paso está listo cuando lo suyo cuadra; la técnica es opcional.
  const ready = [build.name !== '', pointsLeft === 0, ranksLeft === 0, problems.length === 0];
  const chosenAdvanced = advanced ? defaultSkillCatalog.get(advanced) : undefined;

  const create = useMutation({
    mutationFn: () => api.createCharacter(campaignId, { ...build, gear }),
    onSuccess: async (character) => {
      storeCharacter(character);
      await queryClient.invalidateQueries({ queryKey: keys.characters(campaignId) });
      await navigate(`/personajes/${character.id}`, { replace: true });
    },
  });

  if (!campaign.data) return <QueryState error={campaign.error} />;

  return (
    <>
      <header className="masthead">
        <Link to={`/campanas/${campaignId}/personajes`} className="eyebrow back">
          ← {campaign.data.name}
        </Link>
        <h1>Nuevo personaje</h1>
      </header>

      <ol className="steps" aria-label="Pasos">
        {STEPS.map((title, index) => (
          <li key={title}>
            <button
              type="button"
              aria-current={index === step ? 'step' : undefined}
              className={ready[index] ? 'done' : undefined}
              onClick={() => setStep(index)}
            >
              <span className="step-mark" aria-hidden="true">
                {ready[index] ? <Icon name="check" size={16} /> : index + 1}
              </span>
              {title}
            </button>
          </li>
        ))}
      </ol>

      <div className="creation">
        <section className="panel" aria-label={STEPS[step]}>
          {step === 0 && (
            <div className="stack">
              <label className="field">
                <span className="field-label">Nombre</span>
                <input
                  required
                  maxLength={80}
                  value={name}
                  placeholder="Kael"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Trasfondo</span>
                <input
                  maxLength={200}
                  placeholder="Mercenario de la Compañía Libre"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                />
                <span className="hint">
                  De dónde viene, en una frase. Cuando encaje con lo que intenta, el máster le da
                  ventaja.
                </span>
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="stack tight">
              <p className={pointsLeft === 0 ? 'points done' : 'points'}>
                <strong className="num">{pointsLeft}</strong> de {CREATION.attributePoints} puntos
                por repartir · de {ATTRIBUTE_MIN} a {CREATION.attributeMaxAtCreation} en cada uno
              </p>
              <ul className="allocation">
                {ATTRIBUTES.map((attribute) => {
                  const info = ATTRIBUTE_INFO[attribute];
                  const value = attributes[attribute];
                  return (
                    <li key={attribute}>
                      <span>
                        <span className="skill-name">
                          {info.label} <span className="abbr">{info.abbreviation}</span>
                        </span>
                        <span className="hint">{info.description}</span>
                      </span>
                      <Stepper
                        label={info.label}
                        hideLabel
                        value={value}
                        min={ATTRIBUTE_MIN}
                        max={Math.min(
                          CREATION.attributeMaxAtCreation,
                          value + Math.max(0, pointsLeft),
                        )}
                        onChange={(next) => setAttributes({ ...attributes, [attribute]: next })}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {step === 2 && (
            <div className="stack tight">
              <p className={ranksLeft === 0 ? 'points done' : 'points'}>
                <strong className="num">{ranksLeft}</strong> de {CREATION.skillRanks} rangos por
                repartir · como mucho {CREATION.skillRankMaxAtCreation} en cada habilidad
              </p>
              <div className="allocation-groups">
                {ATTRIBUTES.map((attribute) => {
                  const info = ATTRIBUTE_INFO[attribute];
                  const value = attributes[attribute];
                  return (
                    <section key={attribute} aria-label={info.label}>
                      <h3>
                        {info.label} <span className="num">{value}</span>
                      </h3>
                      <ul className="allocation">
                        {defaultSkillCatalog.byAttribute(attribute).basic.map((skill) => {
                          const rank = skills[skill.id] ?? 0;
                          return (
                            <li key={skill.id}>
                              <span>
                                <span className="skill-name">{skill.name}</span>
                                <span className="hint">
                                  {SKILL_RANK_LABELS[rank]} · tira con {signed(value + rank)}
                                </span>
                              </span>
                              <RankControl
                                label={skill.name}
                                value={rank}
                                max={Math.min(
                                  CREATION.skillRankMaxAtCreation,
                                  rank + Math.max(0, ranksLeft),
                                )}
                                onChange={(next) => setSkills({ ...skills, [skill.id]: next })}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="stack">
              <fieldset className="advanced-list">
                <legend className="field-label">
                  Una técnica, si cumple sus requisitos (opcional)
                </legend>
                <div className="technique-options">
                  {/* Primero las que ya cumple; las demás, con lo que les falta. */}
                  {defaultSkillCatalog.skills
                    .filter((skill) => skill.tier === 'advanced')
                    .map((skill) => ({
                      skill,
                      unmet: unmetRequirements(skill, build, defaultSkillCatalog),
                    }))
                    .sort((a, b) => Number(a.unmet.length > 0) - Number(b.unmet.length > 0))
                    .map(({ skill, unmet }) => {
                      const chosen = advanced === skill.id;
                      return (
                        <label
                          key={skill.id}
                          className={`advanced-option${unmet.length > 0 ? ' locked' : ''}`}
                        >
                          <input
                            type="radio"
                            name="advanced"
                            checked={chosen}
                            disabled={unmet.length > 0 && !chosen}
                            onChange={() => setAdvanced(skill.id)}
                          />
                          <span>
                            <span className="skill-name">{skill.name}</span>
                            <span className="hint">{skill.description}</span>
                            <span className={unmet.length > 0 ? 'hint unmet' : 'hint'}>
                              {unmet.length > 0 ? unmet.join(' · ') : requirementText(skill)}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                </div>
                {advanced && (
                  <button type="button" className="link-button" onClick={() => setAdvanced(null)}>
                    Sin técnica
                  </button>
                )}
              </fieldset>
              <section className="stack tight" aria-labelledby="gear-heading">
                <h3 id="gear-heading">Qué lleva</h3>
                <p className="hint">
                  Con esto se preparan sus ataques, sus defensas y el daño que hace y recibe. Se
                  puede cambiar después en su ficha.
                </p>
                <GearEditor value={gear} onChange={setGear} />
              </section>
            </div>
          )}

          <div className="wizard-nav">
            {step > 0 && (
              <button type="button" className="button" onClick={() => setStep(step - 1)}>
                Atrás
              </button>
            )}
            {step < STEPS.length - 1 && (
              <button type="button" className="button primary" onClick={() => setStep(step + 1)}>
                Siguiente: {STEPS[step + 1]}
              </button>
            )}
          </div>
        </section>

        <aside className="panel summary" aria-labelledby="summary-heading">
          <p className="eyebrow">Así queda</p>
          <h2 id="summary-heading">{build.name || 'Tu personaje'}</h2>
          {build.background && <p className="muted">{build.background}</p>}
          <dl className="attribute-row">
            {ATTRIBUTES.map((attribute) => (
              <div key={attribute}>
                <dt>
                  <abbr title={ATTRIBUTE_INFO[attribute].label}>
                    {ATTRIBUTE_INFO[attribute].abbreviation}
                  </abbr>
                </dt>
                <dd>{attributes[attribute]}</dd>
              </div>
            ))}
          </dl>
          <dl className="tally">
            <div>
              <dt>Habilidades</dt>
              <dd>
                {Object.entries(build.skills)
                  .map(([id, rank]) => `${defaultSkillCatalog.get(id)?.name ?? id} ${rank}`)
                  .join(', ') || <span className="muted">Ninguna todavía</span>}
              </dd>
            </div>
            <div>
              <dt>Técnica</dt>
              <dd>{chosenAdvanced?.name ?? <span className="muted">Ninguna</span>}</dd>
            </div>
            <div>
              <dt>Rasguños que aguanta</dt>
              <dd className="num">{scratchBoxes(build)}</dd>
            </div>
          </dl>
          <GearSummary gear={gear} />

          {problems.length > 0 ? (
            <ul className="problems">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : (
            ranksLeft > 0 && (
              <p className="hint">Puedes crearlo ya, pero te quedan rangos sin repartir.</p>
            )
          )}

          <ErrorNote error={create.error} />
          <button
            type="button"
            className="button primary"
            disabled={problems.length > 0 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creando…' : 'Crear personaje'}
          </button>
        </aside>
      </div>
    </>
  );
}

function RankControl(props: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const { label, value, max, onChange } = props;
  return (
    <div className="rank-control">
      <button
        type="button"
        aria-label={`Bajar ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <output className="num" aria-label={`${label}: rango ${value}`}>
        {value}
      </output>
      <button
        type="button"
        aria-label={`Subir ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}
