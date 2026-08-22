// Регрессия P0: демография жителей обязана попадать в сейв и возвращаться при загрузке.
// История: integrate.js вызывал POP.populationSerialize/populationRestore — таких
// экспортов нет (модуль отдаёт serialize/restore), из-за чего в сейв тихо писался
// pop:null и возрасты/сословия/семьи терялись при каждой загрузке.
// Запуск: node app/tests/test-save-population.mjs
import { Simulation } from '../src/core/simulation.js';
import * as POP from '../src/core/systems/wire_population.js';

let ok = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const runDays = (sim, days) => { for (let i = 0; i < days * 4; i++) sim.tick(0.25); };

console.log('\n--- круг сохранения демографии ---');
{
  const s1 = new Simulation(777);
  t('wirePopulationInstall отработал в конструкторе', !!s1.pop);
  runDays(s1, 60);

  const snap1 = JSON.stringify(POP.serialize(s1));
  t('модуль населения отдал состояние', snap1.length > 2, 'пустой снимок');

  const json = JSON.stringify(s1.serialize());
  const data = JSON.parse(json);
  t('в сейве есть sys.pop и он не null', !!data.sys && data.sys.pop != null,
    data.sys ? 'sys.pop отсутствует' : 'sys отсутствует');

  const r = Simulation.deserialize(json);
  t('сейв читается без ошибок', r.ok === true, r.reason || '');
  if (r.ok) {
    const snap2 = JSON.stringify(POP.serialize(r.sim));
    t('демография пережила круг сейва бит-в-бит', snap2 === snap1);
  }
}

console.log(`\nИтого: ${ok} прошло, ${fail} упало`);
process.exit(fail ? 1 : 0);
