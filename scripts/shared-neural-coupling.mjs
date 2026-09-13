/** Records one fixed neurally generated shared-coupling run. Explicit manual invocation only:
 *   node scripts/shared-neural-coupling.mjs
 * It runs no network, no browser and no GPU. The companion test recomputes the same run. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runSharedNeuralCoupling } from '../server/shared-neural-coupling.js';

const result = await runSharedNeuralCoupling();
writeFileSync(fileURLToPath(new URL('../research/results/shared-neural-coupling.json', import.meta.url)),
  `${JSON.stringify(result, null, 1)}\n`);
console.log(JSON.stringify(result.measurement, null, 1));
