/**
 * The type-level half of a contribution. TypeScript has no higher-kinded types, so the operations are written against two input slots that the ORM client fills in: `index` is the literal index entry from the contract and `collection` is the collection type every operation returns. `match` is the structural type an index entry must be assignable to.
 */
export interface ScopeOperationsShape {
  readonly match: unknown;
  readonly index: unknown;
  readonly collection: unknown;
  readonly operations: object;
}

/**
 * Registry of collection scope contributions, keyed by contribution id. A contributing package adds its entry by declaration merging.
 */
// biome-ignore lint/suspicious/noEmptyInterface: contributions are added by declaration merging
export interface CollectionScopeRegistry {}

type RegistryIds = keyof CollectionScopeRegistry;

type MatchingIds<Index> = {
  [Id in RegistryIds]: Index extends CollectionScopeRegistry[Id]['match' &
    keyof CollectionScopeRegistry[Id]]
    ? Id
    : never;
}[RegistryIds];

type ApplyShape<Shape, Index, Coll> = Shape & {
  readonly index: Index;
  readonly collection: Coll;
} extends { readonly operations: infer Operations }
  ? Operations
  : never;

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

export type ScopeOperationsFor<Index, Coll> = UnionToIntersection<
  MatchingIds<Index> extends infer Id
    ? Id extends RegistryIds
      ? ApplyShape<CollectionScopeRegistry[Id], Index, Coll>
      : never
    : never
>;

export type AuthoredIndexName<Index> = Index extends { readonly prefix: infer P extends string }
  ? P
  : Index extends { readonly name: infer N extends string }
    ? N
    : never;

type ScopeKey<Index> = [MatchingIds<Index>] extends [never]
  ? never
  : string extends AuthoredIndexName<Index>
    ? never
    : AuthoredIndexName<Index>;

export type ScopeNamesOfIndexes<Indexes> = Indexes extends readonly unknown[]
  ? Indexes[number] extends infer Index
    ? Index extends unknown
      ? ScopeKey<Index>
      : never
    : never
  : never;

export type ScopesOfIndexes<Indexes, Coll> = Indexes extends readonly unknown[]
  ? {
      readonly [Index in Indexes[number] as ScopeKey<Index>]: ScopeOperationsFor<Index, Coll>;
    }
  : Record<never, never>;

export function authoredIndexName(index: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof index['prefix'] === 'string') return index['prefix'];
  if (typeof index['name'] === 'string') return index['name'];
  return undefined;
}
