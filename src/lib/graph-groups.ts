// Persisted snapshots may predate entity ownership. Never invent an owner or
// discard those records: keep them visible in an explicit fallback group.
export const graphEntities = ['SPD', 'QTS', 'QTG', 'Unassigned'] as const;
export type GraphEntity = typeof graphEntities[number];
export function graphEntity(customer: { entity?: string }): GraphEntity {
 return graphEntities.slice(0, 3).includes(customer.entity as GraphEntity)
  ? customer.entity as GraphEntity : 'Unassigned';
}
export function groupGraphCustomers<T extends { entity?: string }>(customers: T[], entity: GraphEntity): T[] {
 return customers.filter(customer => graphEntity(customer) === entity);
}
