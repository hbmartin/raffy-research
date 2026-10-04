export type CopyMember = { id: string; baseKey: string };
export type CopyRelationship = {
  id: string;
  leftSourceId: string;
  rightSourceId: string;
  status: 'suggested' | 'confirmed' | 'separate';
};
export type EquivalenceConflict = {
  type: 'equivalence_conflict';
  message: string;
  blockingReviews: CopyRelationship[];
};

/** Editorial links connect immutable base copy groups. Decisions never split a base. */
export function copyGroups(
  members: CopyMember[],
  relationships: CopyRelationship[]
) {
  const bases = new Map(members.map((member) => [member.id, member.baseKey]));
  const adjacency = new Map<
    string,
    { key: string; review: CopyRelationship }[]
  >();
  for (const key of bases.values()) adjacency.set(key, []);
  for (const review of relationships) {
    const left = bases.get(review.leftSourceId),
      right = bases.get(review.rightSourceId);
    if (review.status !== 'confirmed' || !left || !right) continue;
    adjacency.get(left)!.push({ key: right, review });
    adjacency.get(right)!.push({ key: left, review });
  }
  const identities = new Map<string, string>();
  for (const start of adjacency.keys()) {
    if (identities.has(start)) continue;
    const component = new Set([start]),
      pending = [start];
    for (let i = 0; i < pending.length; i++)
      for (const edge of adjacency.get(pending[i]!) ?? []) {
        if (!component.has(edge.key)) {
          component.add(edge.key);
          pending.push(edge.key);
        }
      }
    const identity = [...component].sort()[0]!;
    for (const key of component) identities.set(key, identity);
  }
  const path = (
    leftId: string,
    rightId: string
  ): CopyRelationship[] | undefined => {
    const left = bases.get(leftId),
      right = bases.get(rightId);
    if (!left || !right || identities.get(left) !== identities.get(right))
      return undefined;
    const pending = [{ key: left, edges: [] as CopyRelationship[] }],
      seen = new Set([left]);
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]!;
      if (item.key === right) return item.edges;
      for (const edge of adjacency.get(item.key) ?? [])
        if (!seen.has(edge.key)) {
          seen.add(edge.key);
          pending.push({ key: edge.key, edges: [...item.edges, edge.review] });
        }
    }
    return undefined;
  };
  const conflicts = relationships
    .filter((review) => review.status === 'separate')
    .flatMap((review) => {
      const connecting = path(review.leftSourceId, review.rightSourceId);
      return connecting
        ? [{ separation: review, confirmations: connecting }]
        : [];
    });
  return {
    memberships: new Map(
      members.map((member) => [member.id, identities.get(member.baseKey)!])
    ),
    conflicts,
  };
}
