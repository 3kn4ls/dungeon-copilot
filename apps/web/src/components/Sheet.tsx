import {
  ARMOR_CLASSES,
  ATTRIBUTES,
  ATTRIBUTE_INFO,
  LUCK_PER_SESSION,
  SEVERITY_LABELS,
  defaultSkillCatalog,
  weaponLabel,
  type Gear,
} from '@dungeon-copilot/rules';
import type { CharacterView } from '@dungeon-copilot/shared';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { signed } from '../rules-text';
import { Avatar, toneOf } from './Avatar';

/** Los rombos de Suerte, pequeños. */
export function LuckPips({ luck }: { luck: number }) {
  return (
    <span className="pips small" role="img" aria-label={`Suerte: ${luck} de ${LUCK_PER_SESSION}`}>
      {Array.from({ length: LUCK_PER_SESSION }, (_, i) => (
        <i key={i} className={i < luck ? 'pip filled' : 'pip'} />
      ))}
    </span>
  );
}

/** Las casillas de rasguño en miniatura y cómo está: sin heridas, herido, grave… */
export function WoundsMini({ wounds }: { wounds: CharacterView['wounds'] }) {
  return (
    <span className="wounds-mini">
      <span
        className="mini-boxes"
        role="img"
        aria-label={`Rasguños: ${wounds.scratches} de ${wounds.scratchBoxes}`}
      >
        {Array.from({ length: wounds.scratchBoxes }, (_, i) => (
          <i key={i} className={i < wounds.scratches ? 'marked' : undefined} />
        ))}
      </span>
      <span className={wounds.severity === 'none' ? 'severity' : 'severity hurt'}>
        {SEVERITY_LABELS[wounds.severity]}
      </span>
    </span>
  );
}

/** «Espada larga (media) · Arco corto (media) · armadura ligera · escudo». */
export function gearLine(gear: Gear): string {
  return [
    weaponLabel(gear.melee),
    gear.ranged && weaponLabel(gear.ranged),
    gear.armor !== 'none' && `armadura ${ARMOR_CLASSES[gear.armor].label.toLowerCase()}`,
    gear.shield && 'escudo',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Los cinco atributos en fila, con su abreviatura. */
export function AttributeRow({ attributes }: { attributes: CharacterView['attributes'] }) {
  return (
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
  );
}

/**
 * La ficha de un personaje en pequeño, para tenerla a mano en la sala: atributos, cómo está, sus
 * habilidades entrenadas con lo que suman y su equipo.
 */
export function MiniSheet({ character }: { character: CharacterView }) {
  const learned = defaultSkillCatalog.skills.filter(
    (skill) => skill.tier === 'basic' && (character.skills[skill.id] ?? 0) > 0,
  );
  return (
    <section
      className="panel mini-sheet"
      style={{ '--tone': toneOf(character.id) } as CSSProperties}
      aria-label={`Ficha de ${character.name}`}
    >
      <div className="party-head">
        <Avatar name={character.name} id={character.id} size="large" />
        <span className="party-name">
          <Link to={`/personajes/${character.id}`}>{character.name}</Link>
          <span className="muted">{character.background || 'Sin trasfondo'}</span>
        </span>
        <LuckPips luck={character.luck} />
      </div>
      <AttributeRow attributes={character.attributes} />
      <WoundsMini wounds={character.wounds} />
      {learned.length > 0 && (
        <ul className="skill-chips" aria-label="Habilidades">
          {learned.map((skill) => (
            <li key={skill.id}>
              {skill.name}{' '}
              <strong className="num">
                {signed(character.attributes[skill.attribute] + (character.skills[skill.id] ?? 0))}
              </strong>
            </li>
          ))}
        </ul>
      )}
      <p className="party-gear">{gearLine(character.gear)}</p>
      <Link to={`/personajes/${character.id}`} className="button small">
        Abrir la ficha entera
      </Link>
    </section>
  );
}
