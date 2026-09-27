import type { DiceRoll } from '@dungeon-copilot/rules';

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
          <span key={i} className={kept ? 'die' : 'die discarded'} aria-label={`Dado: ${face}`}>
            {face}
          </span>
        ))}
      </div>
      <span className="dice-total">= {total}</span>
    </div>
  );
}
