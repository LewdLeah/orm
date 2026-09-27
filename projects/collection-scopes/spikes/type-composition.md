# Spike: is the type composition in ADR 256 tractable?

**Date:** 2026-09-27
**Branch:** `spike-collection-scope-types`
**Question:** spec open question 2, "Whether the type-level composition is tractable."

## Answer

**Tractable, with caveats.** All five requirements compile and are covered by type tests that fail when the behaviour breaks. No "type instantiation is excessively deep" error appeared, in the package or in `examples/prisma-8-demo`. Three caveats need a design decision before the slices are sized. They are listed under "Caveats".

## What was built

- `packages/3-extensions/sql-orm-client/src/scopes.ts`: the contribution interface and the type machinery.
- `Collection`, `CollectionTypeState`, `OrmOptions`, `orm()` and the include refinement types carry the contributions.
- The Postgres facade takes a `scopes` option and is generic over it.
- A crude runtime: the collection constructor installs `scopes` and the direct members. A scope operation adds a filter and a default order. An explicit `orderBy` replaces the default order, whether it comes before or after the scope call.
- Tests: `test/scopes.types.test-d.ts` (16 type tests), `test/scopes.test.ts` (4 runtime tests), `test/scopes-fixture.ts` (the fixture contract type and two contributions).
- `demo-probe.test-d.ts.txt` in this folder: the type test that was run inside `examples/prisma-8-demo` against the real contract. It is stored as text so the demo is not changed.

**Index data used.** The fixture is a hand-written contract type. It is the emitted test contract with the `posts` table's `indexes` tuple replaced. The full-text indexes carry `type: 'gin'` and structured fields in the index's existing `options` member: `options: { language, weights }`. The full-text contribution matches on that shape. The emitter was not changed. The runtime test patches the same fields into the contract JSON, and contract hydration accepted them. The demo probe matches the real opaque index on `type: 'gin'` plus `expression`.

## Evidence for each requirement

| Requirement | Result | Test |
| --- | --- | --- |
| (a) Scope existence and name come only from the contract's literal index data | Works. The name is `prefix` when the index has one, otherwise `name`. The hashed physical name is not a scope. | "a scope exists under the authored index name", "the physical name of a wire-named index is not a scope" |
| (b) Operations come from a contribution passed at construction | Works. `orm({ scopes: [fullTextScopes, brinScopes] })`. Two contributions for two index kinds work together with no change to the ORM client. Operations can read the literal index data: `fulltext(q, { only: 'title' })` accepts only columns named in the index's weights. | "operations read the literal index data", "each contribution supplies the operations of its own index kind" |
| (c) The result is the model's collection, on chained collections and in include refinements | Works for the base collection. `.where()`, `.select()`, `.limit()`, `.all()` stay typed, and the row type chosen before the scope call is kept. | "a scope operation returns the collection of the model", "the scope is present on chained collections", "the scope is present inside an include refinement" |
| (d) Direct placement only when the name is free; `scopes.<name>` always | Works. An index named `where` is reachable only as `scopes.where`. An index named `published` on a model whose custom class has `published()` is reachable only as `scopes.published`. | "direct placement exists only when the name is free", "a custom collection class keeps its members and gains scopes" |
| (e) A model with no such index has an empty `scopes` | Works. The type is `{}`. | "a model with no such index has an empty scopes object" |

## Measured cost

Instantiation and type counts are exact and repeat on every run. Check time was noisy because the machine was shared: the unchanged baseline measured between 3.3 s and 9.3 s across eight runs. Treat the times as rough.

**`sql-orm-client` package typecheck (`pnpm typecheck --extendedDiagnostics`)**

| Measurement | Before | After, without the new tests | After, with the new tests |
| --- | --- | --- | --- |
| Instantiations | 1,495,458 | 1,810,704 (+21%) | 1,872,197 (+25%) |
| Types | 240,857 | 265,108 (+10%) | 272,639 (+13%) |
| Memory | about 820 MB | about 870 MB | about 930 MB |
| Check time, best run | 3.30 s | 5.51 s | 4.83 s |

The "without the new tests" column is the cost every existing user pays when no contribution is registered. It splits into two parts:

- Adding `scopeContributions` to the collection state: +104,000 instantiations (+7%).
- Adding the `scopes` member and the direct members to `Collection`: +211,000 instantiations (+14%).

Returning early when the contribution list is empty did not help. It raised the count slightly. The cost comes from the wider intersection type, not from the index lookup.

**`examples/prisma-8-demo` typecheck**

| Measurement | Before | After, demo unchanged | After, with a scope in use |
| --- | --- | --- | --- |
| Instantiations | 732,083 | 774,709 (+5.8%) | 789,170 (+7.8%) |
| Memory | about 590 MB | about 550 MB | about 530 MB |
| Check time, best run | 1.43 s | 2.21 s | 2.24 s |
| Errors | 0 | 0 | 0 |

## Editor readability

These are the types TypeScript prints in an error message, which is close to what a hover shows.

- `db.public.Post.scopes` prints as `{ readonly search: FullTextOperations<{ readonly name: "search_0a1b2c3d"; readonly prefix: "search"; ... }, CollectionImpl<...> & ... >; readonly where: ... }`. It names the contribution's own interface and shows the index literal. It is readable.
- `db.public.Post.scopes.search.fulltext` prints as `(query: FakeTsQuery, options?: { readonly only?: "title" }) => CollectionImpl<ScopedContract, "Post", DefaultModelRow<...>, WithWhereState<...>> & { ...; } & { ...; } & { ...; }`. The parameters are clear. The return type loses the `Collection` alias name and shows an intersection.
- After one more chained call, such as `.limit(1)`, the type prints as `Collection<ScopedContract, "Post", ..., WithWhereState<WithScopeContributions<WithNsId<DefaultCollectionTypeState, "public">, readonly [...]>>>` again.
- `db.public.User.scopes` prints as `{}`.

No conditional types appear in any printed type.

## Existing types that had to change

| Type | Location | Change | How invasive |
| --- | --- | --- | --- |
| `CollectionTypeState` | `sql-orm-client/src/types.ts:161` | New required member `scopeContributions` | Medium. Any code that writes out a whole state type must add the member. One existing test needed it (`test/annotations.types.test-d.ts`). User code that writes a state type breaks the same way. |
| `DefaultCollectionTypeState` | `sql-orm-client/src/types.ts:172` | `scopeContributions: readonly []` | Small |
| `WithScopeContributions` (new) | `sql-orm-client/src/types.ts:175` | Same pattern as `WithNsId` | Small |
| `CollectionState` | `sql-orm-client/src/types.ts:102` | New optional `orderByIsDefault` flag | Small. The query planner was not changed. |
| `CollectionContext` | `sql-orm-client/src/types.ts:203` | New optional `scopeContributions`, so every collection constructor receives the contributions | Small |
| `ModelTableIndexes` (new) | `sql-orm-client/src/types.ts:1097` | Model → table → `indexes` tuple. Reuses the existing `ModelDef` and `ResolvedNsId`. | Small |
| `Collection` | `sql-orm-client/src/collection.ts:2915` | Two more intersection members: `{ scopes }` and a mapped type for direct placement | High. This is the central type and the source of most of the cost. |
| `include` overloads and the nested collection | `sql-orm-client/src/collection.ts:669`, `:732`, `:769` | The refinement collection's state carries the parent's contributions | Small. Three one-line changes. |
| `orderBy` | `sql-orm-client/src/collection.ts:941` | Drops a default order before appending | Small |
| `OrmOptions` | `sql-orm-client/src/orm.ts:25` | Third generic `Scopes` and a `scopes` option | Small. It has a default, so existing calls compile. |
| `ModelCollection` | `sql-orm-client/src/orm.ts:53` | Passes `Scopes` into the state. Wraps a custom class in `CustomCollectionWithScopes`. | Medium |
| `OrmNamespace`, `NamespacedClientMap`, `OrmClient`, `orm()` | `sql-orm-client/src/orm.ts:110`, `:125`, `:133`, `:164` | Pass the `Scopes` generic through | Small, mechanical |
| `PostgresClient`, `PostgresTransactionContext`, `PostgresOptionsBase`, `PostgresOptionsWithContract`, `PostgresOptionsWithContractJson`, `PostgresOptions`, `postgres()` | `postgres/src/runtime/postgres.ts:52` to `:202` | Second generic `Scopes` on all of them | Medium. It is mechanical, but every public facade type gains a generic. The serverless facade and other facades were not changed and need the same work. |

All paths are under `packages/3-extensions/`.

## Caveats

**1. A contribution cannot describe its types by extending the collection class.** The ADR says the owner of an index kind supplies scope operations "by extending the ORM client's collection base class". A class or a mixin function cannot be generic over "the literal index entry of whichever model this is". TypeScript has no higher-kinded types. The spike uses an interface with two input slots that the ORM client fills in: `this['index']` and `this['collection']`. The runtime half can still be done with classes, but the type half must be this interface. The ADR wording should change.

**2. `this` cannot be used inside a nested object type.** Writing `readonly operations: { fulltext(q): this['collection'] }` fails with error TS2526. The contribution author must declare a separate generic interface and pass the slots to it: `readonly operations: FullTextOperations<this['index'], this['collection']>`. This works, and it prints better in the editor.

**3. `postgres<Contract>({ contractJson, scopes })` cannot infer the scopes.** TypeScript does not infer some type arguments when others are given explicitly. The documented pattern for emitted contracts passes `Contract` explicitly, so `Scopes` falls back to its default and the `scopes` option is rejected. The demo probe proves this with `@ts-expect-error`. The options are:
- The user writes both: `postgres<Contract, readonly [typeof fullText]>(...)`. This works today.
- The Postgres facade fixes the target's own contributions in its types, so built-in full-text search needs no inference. Only extension contributions need one of the other options.
- The facade gets a form where the contract type is inferred from a value, or a two-step call.

This problem applies equally to making `extensions` generic, which the spec already plans.

**4. A custom collection class keeps scope types only at the root.** `db.Post.search.fulltext(q).published()` is typed. `db.Post.where(...).search` is not. Builder methods on a custom class return the base `Collection` with the default state, and the class declared that state without contributions. This is the same existing limitation that makes `db.Post.where(...).published()` untyped today. Inside the class body, `this.scopes.search` is also untyped. Both work when the class names the contributions in its state: `extends Collection<Contract, 'Post', Row, WithScopeContributions<DefaultCollectionTypeState, readonly [typeof fullText]>>`. The test "a custom class that names the contributions in its state" shows it. It is verbose. At runtime the scopes are always present.

**5. The alias name is lost in the scope operation's return type.** See "Editor readability". It is cosmetic.

**6. An authored name and a default name look the same.** An unnamed index gets a default `prefix` such as `posts_user_id_idx`. The contract does not record whether the author chose the prefix. A contribution for a kind whose indexes can be unnamed would produce scopes with generated names. Full-text indexes over an expression must be named, so the first delivery is not affected.

**7. `Collection` must be written in a specific form.** The scope types refer back to `Collection`. The first attempt, with helper type aliases, failed with "Type alias 'Collection' circularly references itself" and 685 errors. It compiles only when the `scopes` member and the direct-placement mapped type are written inline in the `Collection` alias, and when the key set is computed without reference to the collection type. This form is fragile. A later refactor that moves these members into a helper alias will break the build.

## Recommended shape for the contribution interface

```ts
interface ScopeOperationsShape {
  readonly index: unknown;      // filled with the literal index entry
  readonly collection: unknown; // filled with the collection type to return
  readonly operations: object;
}

interface CollectionScopeContribution<Match, Shape extends ScopeOperationsShape> {
  matches(index): boolean;                                  // runtime: is this my index kind?
  operations(index, context): Record<string, (...args) => ScopeRefinement>;
  // plus a phantom member that carries Match and Shape
}

interface ScopeRefinement {
  readonly filter: AnyExpression;
  readonly defaultOrderBy?: readonly OrderByItem[];
}
```

- `Match` is a structural type. An index has the scope when its literal type is assignable to `Match`. This keeps the ORM client free of index kinds.
- An operation returns a `ScopeRefinement`, not a collection. The ORM client applies it. The contribution never touches collection internals, and the ORM client owns the default-order rule.
- Pass contributions as a tuple: `scopes: [a, b]`. The `const` type parameter on `orm()` keeps the tuple type.
- Carry the contributions in the collection's type state. It already survives every chained call, as `nsId` does.

## Risks

- **Compile cost for everyone.** About 21% more instantiations in the package and 6% in the demo, with no scope in use. It did not approach any limit. The cost grows with the number of `Collection` types a program creates.
- **The facade inference problem (caveat 3)** affects the user-facing API and should be decided first.
- **Custom collection classes (caveat 4)** are a requirement in the spec ("reachable ... on a custom collection class"). At the root this is met. After a chained call it is met at runtime but not in the types, unless the class names the contributions. Fixing it properly means making builder methods return the custom class type, which is a larger change than this project.
- **Not tested:** `GroupedCollection`, prepared collections, polymorphic variants (`.variant()`), contracts with several namespaces, and the Mongo ORM client.
- **The structured index representation is assumed.** The spike put the fields in `options`. The real representation is still open and changes what `Match` looks like, but not the mechanism.
- **The runtime is throwaway.** It installs members on each instance and uses casts in the fixture. It shows the path works and should not be kept.
