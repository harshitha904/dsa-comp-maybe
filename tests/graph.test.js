import test from 'node:test';
import assert from 'node:assert/strict';
import { graphEntities, graphEntity, groupGraphCustomers } from '../src/lib/graph-groups.ts';
import { seedData } from '../server/seed.js';

test('legacy persisted customers all remain visible in graph groups', () => {
 const customers = seedData().customers.map(({ entity, ...customer }) => customer);
 const placed = graphEntities.flatMap(entity => groupGraphCustomers(customers, entity));
 assert.equal(placed.length, 18);
 assert.deepEqual(new Set(placed.map(c => c.id)), new Set(customers.map(c => c.id)));
 assert.ok(placed.every(c => graphEntity(c) === 'Unassigned'));
});
test('known owners are preserved; missing and unknown owners are not dropped or guessed', () => {
 const customers = [{id:'1',entity:'SPD'}, {id:'2',entity:'QTS'}, {id:'3',entity:'QTG'}, {id:'4'}, {id:'5',entity:'new-owner'}];
 assert.deepEqual(graphEntities.map(entity => groupGraphCustomers(customers, entity).map(c => c.id)), [['1'],['2'],['3'],['4','5']]);
 assert.equal(customers[3].entity, undefined);
 assert.equal(customers[4].entity, 'new-owner');
});
