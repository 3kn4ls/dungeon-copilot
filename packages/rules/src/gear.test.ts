import { describe, expect, it } from 'vitest';
import { DEFAULT_GEAR, attackWeapon, gearSchema, weaponLabel } from './gear';

describe('equipo', () => {
  it('sin nada más, un arma media y sin armadura ni escudo', () => {
    expect(gearSchema.parse({ melee: { weapon: 'medium' } })).toEqual(DEFAULT_GEAR);
  });

  it('valida las clases de arma y de armadura', () => {
    expect(gearSchema.safeParse({ melee: { weapon: 'huge' } }).success).toBe(false);
    expect(gearSchema.safeParse({ melee: { weapon: 'light' }, armor: 'plate' }).success).toBe(
      false,
    );
    expect(gearSchema.safeParse({ melee: { name: 'x'.repeat(41), weapon: 'light' } }).success).toBe(
      false,
    );
  });

  it('nombra las armas por su nombre y su clase', () => {
    expect(weaponLabel({ name: 'Espada larga', weapon: 'medium' })).toBe('Espada larga (media)');
    expect(weaponLabel({ name: '  ', weapon: 'heavy' })).toBe('Arma pesada');
  });

  it('a distancia ataca con su arma a distancia, si lleva', () => {
    const bow = { name: 'Arco', weapon: 'medium' } as const;
    const gear = {
      ...DEFAULT_GEAR,
      melee: { name: 'Daga', weapon: 'light' as const },
      ranged: bow,
    };
    expect(attackWeapon(gear, true)).toEqual(bow);
    expect(attackWeapon(gear, false).name).toBe('Daga');
    expect(attackWeapon(DEFAULT_GEAR, true)).toEqual(DEFAULT_GEAR.melee);
  });
});
