/**
 * Imprime en Markdown las tablas de probabilidades del reglamento (docs/reglas.md),
 * calculadas de forma exacta con el propio motor.
 *
 *   pnpm --filter @dungeon-copilot/rules tabla
 */
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  NPC_PROFILES,
  fullSuccessChance,
  opposedOdds,
  successChance,
  testOdds,
  type DifficultyLevel,
  type OutcomeOdds,
} from '../src/index';

const pct = (value: number) => {
  if (value > 0 && value < 0.005) return '<1%';
  if (value < 1 && value > 0.995) return '>99%';
  return `${Math.round(value * 100)}%`;
};
const cell = (odds: OutcomeOdds) => `${pct(successChance(odds))} (${pct(fullSuccessChance(odds))})`;

const bonuses = [2, 3, 4, 5, 6, 7, 8];
const levels = Object.keys(DIFFICULTIES) as DifficultyLevel[];

console.log('### Pruebas contra dificultad\n');
console.log('Éxito de cualquier tipo y, entre paréntesis, éxito pleno o crítico.\n');
console.log(
  `| Bonificador | ${levels.map((l) => `${DIFFICULTY_LABELS[l]} (${DIFFICULTIES[l]})`).join(' | ')} |`,
);
console.log(`| --- | ${levels.map(() => '---').join(' | ')} |`);
for (const bonus of bonuses) {
  console.log(
    `| +${bonus} | ${levels.map((l) => cell(testOdds({ bonus }, DIFFICULTIES[l]))).join(' | ')} |`,
  );
}

console.log('\n### Ventaja y desventaja contra dificultad Normal\n');
console.log('| Bonificador | Desventaja | Normal | Ventaja |');
console.log('| --- | --- | --- | --- |');
for (const bonus of bonuses) {
  const row = (['disadvantage', 'none', 'advantage'] as const).map((edge) =>
    cell(testOdds({ bonus, edge }, DIFFICULTIES.normal)),
  );
  console.log(`| +${bonus} | ${row.join(' | ')} |`);
}

console.log('\n### Tiradas enfrentadas\n');
console.log('Desde quien actúa, según la diferencia de bonificadores.\n');
console.log('| Diferencia | Pifia | Fallo | Con coste | Pleno | Crítico | Éxito total |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (let diff = -4; diff <= 4; diff++) {
  const odds = opposedOdds({ bonus: 5 + diff }, { bonus: 5 });
  const label = diff > 0 ? `+${diff}` : `${diff}`;
  console.log(
    `| ${label} | ${pct(odds.fumble)} | ${pct(odds.failure)} | ${pct(odds.partial)} | ${pct(odds.success)} | ${pct(odds.critical)} | ${pct(successChance(odds))} |`,
  );
}

console.log('\n### Un PJ típico (+5) contra cada perfil de PNJ\n');
console.log('| Perfil | Ataca el PJ | Ataca el PNJ |');
console.log('| --- | --- | --- |');
for (const profile of Object.values(NPC_PROFILES)) {
  const pcAttacks = opposedOdds({ bonus: 5 }, { bonus: profile.bonus });
  const npcAttacks = opposedOdds({ bonus: profile.bonus }, { bonus: 5 });
  console.log(
    `| ${profile.label} (+${profile.bonus}) | ${cell(pcAttacks)} | ${cell(npcAttacks)} |`,
  );
}
