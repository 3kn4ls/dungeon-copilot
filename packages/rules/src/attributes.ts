export const ATTRIBUTES = [
  'strength',
  'dexterity',
  'charisma',
  'intelligence',
  'endurance',
] as const;
export type Attribute = (typeof ATTRIBUTES)[number];
export type Attributes = Record<Attribute, number>;

export interface AttributeInfo {
  label: string;
  abbreviation: string;
  description: string;
}

export const ATTRIBUTE_INFO: Record<Attribute, AttributeInfo> = {
  strength: {
    label: 'Fuerza',
    abbreviation: 'FUE',
    description: 'Golpear con armas medias y pesadas, trepar, cargar, romper.',
  },
  dexterity: {
    label: 'Destreza',
    abbreviation: 'DES',
    description: 'Armas ligeras, disparar, esquivar, sigilo, manos hábiles.',
  },
  charisma: {
    label: 'Carisma',
    abbreviation: 'CAR',
    description: 'Convencer, mentir, intimidar, liderar.',
  },
  intelligence: {
    label: 'Inteligencia',
    abbreviation: 'INT',
    description: 'Percibir, recordar, curar, magia erudita.',
  },
  endurance: {
    label: 'Aguante',
    abbreviation: 'AGU',
    description: 'Resistir daño, fatiga, venenos y miedo. Marca cuántos rasguños soportas.',
  },
};

/** Escala de atributos: 1 flojo, 2 normal, 3 bueno, 4 excelente, 5 legendario. */
export const ATTRIBUTE_MIN = 1;
export const ATTRIBUTE_MAX = 5;
