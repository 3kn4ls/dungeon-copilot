import type { DiceRoll } from '@dungeon-copilot/rules';

/** Qué casillas de la rejilla de 3×3 lleva punto en cada cara. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function Dice(props: { label: string; dice: DiceRoll; total: number; big?: boolean }) {
  const { label, dice, total, big } = props;
  // Marca como descartado el dado que no cuenta cuando hay ventaja o desventaja.
  const remaining = [...dice.kept];
  const faces = dice.rolled.map((face) => {
    const index = remaining.indexOf(face);
    if (index === -1) return { face, kept: false };
    remaining.splice(index, 1);
    return { face, kept: true };
  });

  return (
    <div className={big ? 'dice big' : 'dice'}>
      <span className="dice-label">{label}</span>
      <div className="faces">
        {faces.map(({ face, kept }, i) => (
          <span
            key={i}
            role="img"
            className={kept ? 'die' : 'die discarded'}
            aria-label={kept ? `Dado: ${face}` : `Dado descartado: ${face}`}
          >
            {Array.from({ length: 9 }, (_, cell) => (
              <i key={cell} className={PIPS[face]?.includes(cell) ? 'on' : undefined} />
            ))}
          </span>
        ))}
      </div>
      <span className="dice-total">= {total}</span>
    </div>
  );
}
