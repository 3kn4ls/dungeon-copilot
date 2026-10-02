import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  EDGE_LABELS,
  NPC_PROFILES,
  OUTCOME_GUIDES,
  OUTCOME_LABELS,
  SITUATION_LABELS,
  SKILL_RANK_LABELS,
  doublesShift,
  opposedOdds,
  successChance,
  testOdds,
  type DifficultyLevel,
  type Edge,
  type Outcome,
  type Situation,
} from '@dungeon-copilot/rules';
import type { RollRequest, RollResponse } from '@dungeon-copilot/shared';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { Dice } from '../components/Dice';
import { OddsBar, formatChance } from '../components/Odds';
import { Segmented, Stepper, useDocumentTitle } from '../components/ui';
import { signed } from '../rules-text';

type Mode = 'test' | 'opposed';

interface HistoryEntry {
  id: number;
  summary: string;
  outcome: Outcome;
}

const EDGES: Edge[] = ['disadvantage', 'none', 'advantage'];
let nextHistoryId = 0;
const SITUATIONS: Situation[] = ['test', 'melee', 'ranged'];

/** Lee un número de la URL si está dentro de los límites; si no, usa el valor por defecto. */
function numberParam(
  params: URLSearchParams,
  name: string,
  min: number,
  max: number,
  fallback: number,
) {
  const value = Number(params.get(name));
  return params.has(name) && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

export function RollerPage() {
  // La ficha enlaza aquí con el atributo y la habilidad ya puestos.
  const [params] = useSearchParams();
  const label = params.get('etiqueta');
  useDocumentTitle('Tirador');
  const [mode, setMode] = useState<Mode>('test');
  const [situation, setSituation] = useState<Situation>('test');
  const [attribute, setAttribute] = useState(() => numberParam(params, 'atributo', 1, 5, 3));
  const [rank, setRank] = useState(() => numberParam(params, 'habilidad', 0, 3, 1));
  const [modifier, setModifier] = useState(0);
  const [edge, setEdge] = useState<Edge>(() =>
    params.get('desventaja') === '1' ? 'disadvantage' : 'none',
  );
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('normal');
  const [opponentBonus, setOpponentBonus] = useState(NPC_PROFILES.soldier.bonus);
  const [opponentEdge, setOpponentEdge] = useState<Edge>('none');
  const [result, setResult] = useState<RollResponse | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bonus = attribute + rank + modifier;
  const odds = useMemo(
    () =>
      mode === 'test'
        ? testOdds({ bonus, edge }, DIFFICULTIES[difficulty])
        : opposedOdds({ bonus, edge }, { bonus: opponentBonus, edge: opponentEdge }),
    [mode, bonus, edge, difficulty, opponentBonus, opponentEdge],
  );

  function changeMode(next: Mode) {
    setMode(next);
    setSituation(next === 'test' ? 'test' : 'melee');
  }

  async function roll() {
    const request: RollRequest =
      mode === 'test'
        ? { kind: 'test', check: { bonus, edge }, difficulty: DIFFICULTIES[difficulty] }
        : {
            kind: 'opposed',
            actor: { bonus, edge },
            opponent: { bonus: opponentBonus, edge: opponentEdge },
          };
    setPending(true);
    setError(null);
    try {
      const response = await api.roll(request);
      setResult(response);
      setHistory((previous) => [
        { id: ++nextHistoryId, summary: describe(response), outcome: response.outcome },
        ...previous.slice(0, 7),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo tirar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <header className="masthead">
        <p className="eyebrow">Sin partida</p>
        <h1>Tirador</h1>
        <p className="lede">
          {label
            ? `Tirada de ${label}.`
            : '2d6 + atributo + habilidad contra una dificultad o contra la tirada del rival.'}{' '}
          Mira la probabilidad de cada resultado antes de tirar.
        </p>
      </header>

      <div className="roller">
        <section className="panel composer" aria-labelledby="roll-heading">
          <h2 id="roll-heading" className="visually-hidden">
            Tirada
          </h2>
          <div className="composer-grid">
            <Segmented
              label="Contra"
              value={mode}
              options={[
                ['test', 'Una dificultad'],
                ['opposed', 'Un rival'],
              ]}
              onChange={changeMode}
            />
            <Segmented
              label="Situación"
              value={situation}
              options={SITUATIONS.map((s) => [s, SITUATION_LABELS[s]])}
              onChange={setSituation}
            />

            <div className="steppers">
              <Stepper label="Atributo" value={attribute} min={1} max={5} onChange={setAttribute} />
              <Stepper
                label="Habilidad"
                value={rank}
                min={0}
                max={3}
                onChange={setRank}
                hint={SKILL_RANK_LABELS[rank]}
              />
              <Stepper
                label="Modificador"
                value={modifier}
                min={-3}
                max={3}
                onChange={setModifier}
                format={signed}
              />
            </div>

            <Segmented
              label="Tu tirada"
              value={edge}
              options={EDGES.map((e) => [e, EDGE_LABELS[e]])}
              onChange={setEdge}
            />

            {mode === 'test' ? (
              <div className="field wide">
                <span className="field-label">Dificultad</span>
                <div className="chips" role="group" aria-label="Dificultad">
                  {(Object.keys(DIFFICULTIES) as DifficultyLevel[]).map((level) => (
                    <button
                      key={level}
                      type="button"
                      className="chip"
                      aria-pressed={difficulty === level}
                      onClick={() => setDifficulty(level)}
                    >
                      {DIFFICULTY_LABELS[level]}{' '}
                      <strong className="num">{DIFFICULTIES[level]}</strong>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="opponent wide">
                <span className="field-label">Rival (tira el máster)</span>
                <div className="chips">
                  {Object.values(NPC_PROFILES).map((profile) => (
                    <button
                      key={profile.label}
                      type="button"
                      className="chip"
                      aria-pressed={opponentBonus === profile.bonus}
                      onClick={() => setOpponentBonus(profile.bonus)}
                    >
                      {profile.label} <strong className="num">{signed(profile.bonus)}</strong>
                    </button>
                  ))}
                </div>
                <div className="steppers">
                  <Stepper
                    label="Bonificador del rival"
                    value={opponentBonus}
                    min={0}
                    max={12}
                    onChange={setOpponentBonus}
                    format={signed}
                  />
                </div>
                <Segmented
                  label="Tirada del rival"
                  value={opponentEdge}
                  options={EDGES.map((e) => [e, EDGE_LABELS[e]])}
                  onChange={setOpponentEdge}
                />
              </div>
            )}
          </div>

          <div className="composer-foot">
            <div className="composer-summary" aria-live="polite">
              <p>
                Tiras <strong className="num">{signed(bonus)}</strong>{' '}
                {mode === 'test'
                  ? `contra ${DIFFICULTY_LABELS[difficulty].toLowerCase()} (${DIFFICULTIES[difficulty]})`
                  : `contra un rival con ${signed(opponentBonus)}`}
                {edge !== 'none' && `, con ${EDGE_LABELS[edge].toLowerCase()}`}:{' '}
                <strong>{formatChance(successChance(odds))}</strong> de conseguirlo.
              </p>
              <OddsBar odds={odds} legend />
            </div>
            <button type="button" className="roll-button" onClick={roll} disabled={pending}>
              {pending ? 'Tirando…' : 'Tirar'}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>

        <div className="side">
          <section className="panel" aria-labelledby="result-heading" aria-live="polite">
            <h2 id="result-heading">Resultado</h2>
            {result ? (
              <RollResult result={result} situation={situation} />
            ) : (
              <p className="muted">Todavía no has tirado.</p>
            )}
          </section>

          {history.length > 0 && (
            <section className="panel" aria-labelledby="history-heading">
              <h2 id="history-heading">Historial</h2>
              <ol className="history">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <span className={`swatch outcome-${entry.outcome}`} />
                    {entry.summary}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function describe(result: RollResponse): string {
  const label = OUTCOME_LABELS[result.outcome];
  if (result.kind === 'test') {
    return `${result.roller.total} contra ${result.difficulty}: ${label}`;
  }
  return `${result.actor.total} contra ${result.opponent.total} del rival: ${label}`;
}

function RollResult({ result, situation }: { result: RollResponse; situation: Situation }) {
  const shift =
    result.kind === 'test'
      ? doublesShift(result.roller.dice.kept)
      : doublesShift(result.actor.dice.kept) - doublesShift(result.opponent.dice.kept);

  return (
    <div className="result">
      <p className={`outcome outcome-text-${result.outcome}`}>{OUTCOME_LABELS[result.outcome]}</p>
      {result.kind === 'test' ? (
        <div className="rollers">
          <Dice label="Tú" dice={result.roller.dice} total={result.roller.total} big />
          <p className="versus">
            contra <strong>{result.difficulty}</strong>
          </p>
        </div>
      ) : (
        <div className="rollers">
          <Dice label="Tú" dice={result.actor.dice} total={result.actor.total} big />
          <p className="versus">contra</p>
          <Dice label="Rival" dice={result.opponent.dice} total={result.opponent.total} big />
        </div>
      )}
      <p className="margin">
        Margen <strong>{signed(result.margin)}</strong>
        {shift !== 0 && (
          <>
            {' '}
            · los dobles {shift > 0 ? 'suben' : 'bajan'} el resultado{' '}
            {Math.abs(shift) === 1 ? 'un escalón' : `${Math.abs(shift)} escalones`}
          </>
        )}
      </p>
      <p className="guide">{OUTCOME_GUIDES[situation][result.outcome]}</p>
    </div>
  );
}
