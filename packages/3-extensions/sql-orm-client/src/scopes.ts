import type { AnyExpression, OrderByItem } from '@internal/sql-relational-core/ast';

/**
 * The type-level half of a contribution. TypeScript has no higher-kinded
 * types, so the operations are written against two input slots that the ORM
 * client fills in: `index` is the literal index entry from the contract and
 * `collection` is the collection type every operation returns.
 */
export interface ScopeOperationsShape {
  readonly index: unknown;
  readonly collection: unknown;
  readonly operations: object;
}

export interface ScopeRefinement {
  readonly filter: AnyExpression;
  readonly defaultOrderBy?: readonly OrderByItem[];
}

export interface ScopeOperationContext {
  readonly tableName: string;
  readonly namespaceId: string;
  readonly modelName: string;
}

export type ScopeOperationImplementations = Readonly<
  Record<string, (...args: never[]) => ScopeRefinement>
>;

declare const scopeContributionTypes: unique symbol;

export interface CollectionScopeContribution<
  Match = unknown,
  Shape extends ScopeOperationsShape = ScopeOperationsShape,
> {
  matches(index: Readonly<Record<string, unknown>>): boolean;
  operations(
    index: Readonly<Record<string, unknown>>,
    context: ScopeOperationContext,
  ): ScopeOperationImplementations;
  readonly [scopeContributionTypes]?: { readonly match: Match; readonly shape: Shape };
}

export type AnyScopeContribution = CollectionScopeContribution<unknown, ScopeOperationsShape>;

export function defineCollectionScopes<Match, Shape extends ScopeOperationsShape>(contribution: {
  matches(index: Readonly<Record<string, unknown>>): boolean;
  operations(
    index: Readonly<Record<string, unknown>>,
    context: ScopeOperationContext,
  ): ScopeOperationImplementations;
}): CollectionScopeContribution<Match, Shape> {
  return contribution;
}

type ApplyShape<Shape extends ScopeOperationsShape, Index, Coll> = (Shape & {
  readonly index: Index;
  readonly collection: Coll;
})['operations'];

export type IndexMatchesAny<Contributions, Index> = Contributions extends readonly [
  infer Head,
  ...infer Tail,
]
  ? Head extends CollectionScopeContribution<infer Match, ScopeOperationsShape>
    ? Index extends Match
      ? true
      : IndexMatchesAny<Tail, Index>
    : IndexMatchesAny<Tail, Index>
  : false;

export type ScopeOperationsFor<Contributions, Index, Coll> = Contributions extends readonly [
  infer Head,
  ...infer Tail,
]
  ? Head extends CollectionScopeContribution<infer Match, infer Shape>
    ? Index extends Match
      ? ApplyShape<Shape, Index, Coll> & ScopeOperationsFor<Tail, Index, Coll>
      : ScopeOperationsFor<Tail, Index, Coll>
    : ScopeOperationsFor<Tail, Index, Coll>
  : unknown;

export type AuthoredIndexName<Index> = Index extends { readonly prefix: infer P extends string }
  ? P
  : Index extends { readonly name: infer N extends string }
    ? N
    : never;

export type ScopeNamesOfIndexes<Indexes, Contributions> = Indexes extends readonly unknown[]
  ? Indexes[number] extends infer Index
    ? Index extends unknown
      ? ScopeKey<Contributions, Index>
      : never
    : never
  : never;

type ScopeKey<Contributions, Index> =
  IndexMatchesAny<Contributions, Index> extends true
    ? string extends AuthoredIndexName<Index>
      ? never
      : AuthoredIndexName<Index>
    : never;

export type ScopesOfIndexes<Indexes, Contributions, Coll> = Indexes extends readonly unknown[]
  ? {
      readonly [Index in Indexes[number] as ScopeKey<Contributions, Index>]: ScopeOperationsFor<
        Contributions,
        Index,
        Coll
      >;
    }
  : Record<never, never>;

export function authoredIndexName(index: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof index['prefix'] === 'string') return index['prefix'];
  if (typeof index['name'] === 'string') return index['name'];
  return undefined;
}
