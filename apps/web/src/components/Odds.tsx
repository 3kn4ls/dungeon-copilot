import { OUTCOMES, OUTCOME_LABELS, successChance, type OutcomeOdds } from '@dungeon-copilot/rules';

/** «72%», sin redondear a 0% ni a 100% lo que solo es muy raro o casi seguro. */
export function formatChance(value: number): string {
  if (value > 0 && value < 0.005) return '<1%';
  if (value < 1 && value > 0.995) return '>99%';
  return `${Math.round(value * 100)}%`;
}

/**
 * Las cinco bandas de resultado, de pifia a crítico, en una sola barra a escala. Con `legend`,
 * debajo, cada resultado con su probabilidad, del mejor al peor.
 */
export function OddsBar({ odds, legend = false }: { odds: OutcomeOdds; legend?: boolean }) {
  return (
    <div className="odds">
      <div
        className="odds-bar"
        role="img"
        aria-label={`${formatChance(successChance(odds))} de conseguirlo`}
      >
        {OUTCOMES.map((outcome) => (
          <span
            key={outcome}
            className={`segment outcome-${outcome}`}
            style={{ flexGrow: odds[outcome] }}
            title={`${OUTCOME_LABELS[outcome]}: ${formatChance(odds[outcome])}`}
          />
        ))}
      </div>
      {legend && (
        <ul className="odds-legend">
          {[...OUTCOMES].reverse().map((outcome) => (
            <li key={outcome}>
              <span className={`swatch outcome-${outcome}`} />
              {OUTCOME_LABELS[outcome]}{' '}
              <strong className="num">{formatChance(odds[outcome])}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
