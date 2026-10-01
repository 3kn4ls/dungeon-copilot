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
import { ErrorNote, QueryState, Stepper, useDocumentTitle } from '../components/ui';
import { keys, useCampaign, useStoreCharacter } from '../queries';
import { requirementText, signed, sum } from '../rules-text';

const START: Attributes = { strength: 2, dexterity: 2, charisma: 2, intelligence: 2, endurance: 2 };

export function NewCharacterPage() {
  const { campaignId = '' } = useParams();
  const campaign = useCampaign(campaignId);
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
        <Link to={`/campanas/${campaignId}`} className="eyebrow back">
          ← {campaign.data.name}
        </Link>
        <h1>Nuevo personaje</h1>
        <p className="lede">
          Reparte {CREATION.attributePoints} puntos entre los atributos (máximo{' '}
          {CREATION.attributeMaxAtCreation}), {CREATION.skillRanks} rangos entre las habilidades
          básicas (máximo {CREATION.skillRankMaxAtCreation}) y, si cumples sus requisitos, elige{' '}
          {CREATION.advancedSkills} habilidad avanzada.
        </p>
      </header>

      <div className="creation">
        <div className="stack">
          <section className="panel" aria-labelledby="identity-heading">
            <h2 id="identity-heading">Quién es</h2>
            <label className="field">
              <span className="field-label">Nombre</span>
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Trasfondo</span>
              <input
                maxLength={200}
                placeholder="Mercenaria de la Compañía Libre"
                value={background}
                onChange={(e) => setBackground(e.target.value)}
              />
              <span className="hint">
                Una frase. Cuando encaje con lo que intentas, el máster te da ventaja.
              </span>
            </label>
          </section>

          <section className="panel" aria-labelledby="gear-heading">
            <h2 id="gear-heading">Qué lleva</h2>
            <p className="muted">
              Con esto se preparan sus ataques, sus defensas y el daño que hace y recibe. Se puede
              cambiar después en su ficha.
            </p>
            <GearEditor value={gear} onChange={setGear} />
          </section>

          <div className="creation-counter" aria-hidden="true">
            <span className={pointsLeft === 0 ? undefined : 'pending'}>
              Atributos: {pointsLeft === 0 ? 'repartidos' : `quedan ${pointsLeft}`}
            </span>
            <span className={ranksLeft === 0 ? undefined : 'pending'}>
              Rangos: {ranksLeft === 0 ? 'repartidos' : `quedan ${ranksLeft}`}
            </span>
          </div>

          <div className="attribute-grid">
            {ATTRIBUTES.map((attribute) => {
              const info = ATTRIBUTE_INFO[attribute];
              const value = attributes[attribute];
              const { basic, advanced: advancedSkills } =
                defaultSkillCatalog.byAttribute(attribute);
              return (
                <section key={attribute} className="panel attribute-card" aria-label={info.label}>
                  <div className="attribute-head">
                    <div>
                      <h2>
                        {info.label} <span className="abbr">{info.abbreviation}</span>
                      </h2>
                      <p className="hint">{info.description}</p>
                    </div>
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
                  </div>

                  <ul className="skill-list">
                    {basic.map((skill) => {
                      const rank = skills[skill.id] ?? 0;
                      return (
                        <li key={skill.id} className="skill-row">
                          <span>
                            <span className="skill-name">{skill.name}</span>
                            <span className="hint">
                              {SKILL_RANK_LABELS[rank]} · tirada {signed(value + rank)}
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

                  <fieldset className="advanced-list">
                    <legend className="field-label">Avanzadas</legend>
                    {advancedSkills.map((skill) => {
                      const unmet = unmetRequirements(skill, build, defaultSkillCatalog);
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
                  </fieldset>
                </section>
              );
            })}
          </div>
        </div>

        <aside className="panel summary" aria-labelledby="summary-heading">
          <h2 id="summary-heading">{build.name || 'Tu personaje'}</h2>
          <dl className="tally">
            <div>
              <dt>Puntos de atributo</dt>
              <dd className={pointsLeft === 0 ? 'num' : 'num pending'}>
                {pointsLeft === 0 ? 'Repartidos' : `Quedan ${pointsLeft}`}
              </dd>
            </div>
            <div>
              <dt>Rangos de habilidad</dt>
              <dd className={ranksLeft === 0 ? 'num' : 'num pending'}>
                {ranksLeft === 0 ? 'Repartidos' : `Quedan ${ranksLeft}`}
              </dd>
            </div>
            <div>
              <dt>Habilidad avanzada</dt>
              <dd>
                {chosenAdvanced ? (
                  <>
                    {chosenAdvanced.name}{' '}
                    <button type="button" className="link-button" onClick={() => setAdvanced(null)}>
                      quitar
                    </button>
                  </>
                ) : (
                  <span className="muted">Ninguna todavía</span>
                )}
              </dd>
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
