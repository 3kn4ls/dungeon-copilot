import { z } from 'zod';
import { ARMOR_CLASS_IDS, WEAPON_CLASSES, WEAPON_CLASS_IDS } from './combat';

// Lo que lleva un personaje para pelear, tal como lo apunta su ficha. La ambientación pone los
// nombres («Espada larga», «Arco corto»); el reglamento solo mira la clase del arma, la armadura
// y si lleva escudo.

const weaponSchema = z.object({
  /** Cómo la llama la ambientación. Vacío si da igual. */
  name: z.string().trim().max(40, 'El nombre del arma no puede pasar de 40 caracteres').default(''),
  weapon: z.enum(WEAPON_CLASS_IDS, 'Elige si el arma es ligera, media o pesada'),
});

export const gearSchema = z.object({
  /** Con qué pelea cuerpo a cuerpo. */
  melee: weaponSchema,
  /** Con qué dispara o qué lanza, si lleva algo. */
  ranged: weaponSchema.nullable().default(null),
  armor: z.enum(ARMOR_CLASS_IDS, 'Elige la armadura: ninguna, ligera o pesada').default('none'),
  /** Suma +1 al parar y a la dificultad de acertarle a distancia. */
  shield: z.boolean().default(false),
});

export type Gear = z.infer<typeof gearSchema>;
export type GearWeapon = Gear['melee'];

/** Lo que lleva un personaje mientras su jugador no diga otra cosa: un arma media y nada más. */
export const DEFAULT_GEAR: Gear = {
  melee: { name: '', weapon: 'medium' },
  ranged: null,
  armor: 'none',
  shield: false,
};

/** «Espada larga (media)» o, sin nombre, «Arma media». */
export function weaponLabel(weapon: GearWeapon): string {
  const kind = WEAPON_CLASSES[weapon.weapon].label.toLowerCase();
  const name = weapon.name.trim();
  return name ? `${name} (${kind})` : `Arma ${kind}`;
}

/** El arma con la que ataca: la de distancia si dispara (o, si no lleva, la de cuerpo a cuerpo). */
export function attackWeapon(gear: Gear, ranged: boolean): GearWeapon {
  return (ranged ? gear.ranged : null) ?? gear.melee;
}
