import {
  ARMOR_CLASSES,
  ARMOR_CLASS_IDS,
  SHIELD_BONUS,
  WEAPON_CLASSES,
  WEAPON_CLASS_IDS,
  weaponLabel,
  type ArmorClass,
  type Gear,
  type GearWeapon,
  type WeaponClass,
} from '@dungeon-copilot/rules';
import { Segmented } from './ui';

/** «Media 2»: la clase del arma con su daño. */
export const WEAPON_OPTIONS: [WeaponClass, string][] = WEAPON_CLASS_IDS.map((id) => [
  id,
  `${WEAPON_CLASSES[id].label} ${WEAPON_CLASSES[id].damage}`,
]);

/** «Ligera −1»: la armadura con lo que resta al daño. */
export const ARMOR_OPTIONS: [ArmorClass, string][] = ARMOR_CLASS_IDS.map((id) => [
  id,
  id === 'none'
    ? ARMOR_CLASSES.none.label
    : `${ARMOR_CLASSES[id].label} −${ARMOR_CLASSES[id].reduction}`,
]);

/** «Armadura ligera», o «Sin armadura». */
export const armorText = (armor: ArmorClass) =>
  armor === 'none'
    ? ARMOR_CLASSES.none.label
    : `Armadura ${ARMOR_CLASSES[armor].label.toLowerCase()}`;

function WeaponEditor(props: {
  label: string;
  placeholder: string;
  weapon: GearWeapon;
  onChange: (weapon: GearWeapon) => void;
}) {
  const { label, placeholder, weapon, onChange } = props;
  return (
    <fieldset className="side-editor">
      <legend className="field-label">{label}</legend>
      <label className="field">
        <span className="field-label">Nombre (opcional)</span>
        <input
          value={weapon.name}
          maxLength={40}
          placeholder={placeholder}
          onChange={(event) => onChange({ ...weapon, name: event.target.value })}
        />
      </label>
      <Segmented
        label="Clase y daño"
        value={weapon.weapon}
        options={WEAPON_OPTIONS}
        onChange={(next) => onChange({ ...weapon, weapon: next })}
      />
    </fieldset>
  );
}

/**
 * Lo que lleva un personaje para pelear: al crearlo y en su ficha. La ambientación pone los
 * nombres; el reglamento solo mira la clase del arma, la armadura y el escudo.
 */
export function GearEditor({ value, onChange }: { value: Gear; onChange: (gear: Gear) => void }) {
  const change = (changes: Partial<Gear>) => onChange({ ...value, ...changes });
  return (
    <div className="stack tight">
      <WeaponEditor
        label="Arma cuerpo a cuerpo"
        placeholder="Espada larga"
        weapon={value.melee}
        onChange={(melee) => change({ melee })}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={value.ranged !== null}
          onChange={(event) =>
            change({ ranged: event.target.checked ? { name: '', weapon: 'medium' } : null })
          }
        />
        Lleva un arma a distancia
      </label>
      {value.ranged && (
        <WeaponEditor
          label="Arma a distancia"
          placeholder="Arco corto"
          weapon={value.ranged}
          onChange={(ranged) => change({ ranged })}
        />
      )}
      <Segmented
        label="Armadura"
        value={value.armor}
        options={ARMOR_OPTIONS}
        onChange={(armor) => change({ armor })}
      />
      {value.armor === 'heavy' && (
        <p className="hint">
          La pesada da desventaja en Sigilo y Acrobacias, salvo con Entrenamiento con armaduras.
        </p>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={value.shield}
          onChange={(event) => change({ shield: event.target.checked })}
        />
        Escudo: +{SHIELD_BONUS} al parar y a la dificultad de acertarle a distancia
      </label>
    </div>
  );
}

/** Lo que lleva, en pocas líneas: en la ficha y al crear el personaje. */
export function GearSummary({ gear }: { gear: Gear }) {
  const weapon = (item: GearWeapon) =>
    `${weaponLabel(item)} · daño ${WEAPON_CLASSES[item.weapon].damage}`;
  return (
    <dl className="gear-summary">
      <div>
        <dt>Cuerpo a cuerpo</dt>
        <dd>{weapon(gear.melee)}</dd>
      </div>
      {gear.ranged && (
        <div>
          <dt>A distancia</dt>
          <dd>{weapon(gear.ranged)}</dd>
        </div>
      )}
      <div>
        <dt>Armadura</dt>
        <dd>
          {armorText(gear.armor)}
          {gear.armor !== 'none' && ` · resta ${ARMOR_CLASSES[gear.armor].reduction} al daño`}
        </dd>
      </div>
      {gear.shield && (
        <div>
          <dt>Escudo</dt>
          <dd>+{SHIELD_BONUS} al parar</dd>
        </div>
      )}
    </dl>
  );
}
