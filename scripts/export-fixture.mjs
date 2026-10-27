import { mkdirSync, writeFileSync } from 'node:fs';
import { seedData } from '../server/seed.js';
const fixture = seedData(new Date('2026-10-28T00:00:00+08:00'));
mkdirSync('output/data', { recursive: true });
writeFileSync('output/data/synthetic-fixture.json', JSON.stringify({notice:'Entirely synthetic illustrative data. Not Lives Group records.', ...fixture}, null, 2));
for (const collection of ['orders','customers','products']) {
 const rows=fixture[collection]; const keys=Object.keys(rows[0]);
 const escape=x=>'"'+String(Array.isArray(x)?x.join('; '):x??'').replaceAll('"','""')+'"';
 writeFileSync(`output/data/${collection}.csv`,[keys.join(','),...rows.map(r=>keys.map(k=>escape(r[k])).join(','))].join('\n')+'\n');
}
console.log('Exported labelled synthetic JSON fixture and three CSV files to output/data.');
