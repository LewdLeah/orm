# ADR 256 — Collection scopes derived from indexes

**Status:** Proposed
**Date:** 2026-09-27
**Builds on:** [ADR 175 — Shared ORM Collection interface](ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md), [ADR 180 — Dot-path field accessor](ADR%20180%20-%20Dot-path%20field%20accessor.md), [ADR 236 — Target-contributed model attributes](ADR%20236%20-%20Target-contributed%20model%20attributes.md)

---

## At a glance

A model declares a full-text index over several fields. The earlier a field appears in `weights`, the more a match in it counts, and fields in a nested list share a weight:

```prisma
model Post {
  id       Int     @id
  userId   Int
  title    String
  subtitle String?
  body     String?

  @@fullTextSearch(search, weights: [[title, subtitle], body])
}
```

The ORM client offers that index as a scope on every collection of the model:

```ts
import { websearchToTsquery } from '@prisma/orm-postgres/target/full-text';

const q = websearchToTsquery(input);

// best matches first
db.Post.search.fulltext(q).limit(10).all();

// chained after other refinements, and ordered explicitly
db.Post.where((p) => p.userId.eq(userId))
  .search.fulltext(q)
  .orderBy((p) => p.id.desc())
  .all();

// inside an include: this user, with their three most relevant posts
db.User.where({ id: userId }).include('posts', (posts) => posts.search.fulltext(q).limit(3));

// the full form, always available whatever the scope is called
db.Post.scopes.search.fulltext(q).limit(10).all();
```

On Postgres the first query lowers to a match against the indexed expression, ordered by rank:

```sql
SELECT ... FROM "public"."post"
WHERE (setweight(to_tsvector('english', "title"), 'A') || setweight(to_tsvector('english', coalesce("subtitle", '')), 'A') || setweight(to_tsvector('english', coalesce("body", '')), 'B')) @@ websearch_to_tsquery('english', $1)
ORDER BY ts_rank(setweight(...) || setweight(...) || setweight(...), websearch_to_tsquery('english', $1)) DESC
LIMIT 10
```

## Decision

**A scope is a named, chainable way into a model's collection that an index makes possible.** Calling a scope operation returns a collection of the same model, narrowed and ordered by the index's own notion of relevance. Everything that works on a collection works on the result.

**The ORM client derives scopes from the model's indexes. The contract declares no scopes.** The contract states storage facts: this table has this index, over these fields, with these weights. The ORM client reads the indexes of a model's table or collection and offers a scope for each index whose kind has scope operations. This is the same kind of derivation the ORM client already performs when it reads a table's primary key and unique constraints to decide row identity and upsert conflict targets.

**A scope's name is the index's authored name, exactly.** The contract records an index's authored name separately from its physical name, so no string transformation is involved. An index authored with `name: "search"` is the scope `search`; an index declared with an exact physical name through `map:` uses that name.

**Scopes live under `scopes` on the collection, and are also placed directly on the collection when the name is free.** `collection.scopes.<name>` always reaches the scope. `collection.<name>` reaches it only when nothing else holds that name. Precedence is: the collection's own members, then members of a custom collection class, then scopes. `scopes` is reserved.

**A scope is available on every collection of its model.** That includes a collection reached by chaining and the collection handed to an `include` refinement. A collection accumulates state and compiles when a terminal method runs, so the position of a scope call in a chain does not change the query.

**A scope operation sets a default order, and an explicit `orderBy` replaces it.** `scopes.search.fulltext(q)` orders by relevance. Adding `orderBy` anywhere in the chain, before or after the scope call, replaces the relevance order.

**The owner of an index kind supplies its scope operations, by extending the ORM client's collection base class.** The ORM client defines an interface for this. A target or extension descriptor may carry a part that satisfies it, and a descriptor that has nothing to offer the ORM omits it. When the ORM client is constructed it composes each model's collection class in this order: the base class, then each contribution, then the user's custom collection class outermost. Because chained collections and include refinements are created from the model's class, contributions are present on all of them.

**Types follow the ORM client's construction, not the emitted contract.** The emitted `contract.d.ts` gives the type system access to the contract's data, including each index as literal types. The ORM client and the contributions derive the collection's type from that data. The contract carries no types that describe one query interface, because the ORM client is an interchangeable component the contract must not be coupled to.

**An index that backs a scope is structured data in the contract.** A scope operation renders its query from the index's fields, weights and language, so the index records those as data and the index expression is rendered from them. An index stored only as an opaque SQL expression cannot back a scope.

### Responsibilities

| Party | Owns |
| --- | --- |
| Contract | The index as structured storage data, with its authored name |
| Target or extension that owns the index kind | The attribute that authors the index, the index's DDL, and the scope operations for that kind |
| ORM client | The `scopes` member, name precedence, composing collection classes, applying a scope's filter and default order, and the collection's types |
| Adapter | Lowering the resulting query, as for any other |

## Why

**Finding entities is the collection's job, not a property of the entity.** "Posts are found by relevance, and the title counts more than the body" is knowledge about how posts are retrieved. It is not an attribute of a post, so it does not belong on the row accessor beside `title` and `body`. The collection is where ways of retrieving a model already live: `where`, `orderBy`, and the methods of custom collection classes.

**The query and the index must agree, and only a shared definition guarantees it.** Postgres uses an expression index only when the query's expression is the same as the indexed one. When a query restates the field list, order, weights or language by hand, any difference silently turns an indexed search into a sequential scan. A scope renders the query from the index's own definition, so the two cannot differ.

**User-chosen names and ORM-chosen names must not be able to break each other.** ADR 180 keeps scalar fields and operators in separate namespaces for this reason. Scope names are chosen by whoever authors the index, and collection methods are chosen by the ORM client. `scopes` guarantees a scope is always reachable, whatever either side adds later. The direct form is a convenience: if a later release of the ORM client adds a method with a scope's name, code using the direct form stops compiling and the fix is to write `scopes.<name>`.

**Relevance order is not a property of the index.** Postgres's GIN index cannot return rows in order; rows matched through it come back in no particular order, and ordering by relevance computes the rank of every matching row and sorts them. MongoDB likewise returns text matches unordered unless the query sorts by the text score. Relevance order is therefore a default the scope operation chooses, which is why a caller can replace it.

## Consequences

- **Several scopes per model on SQL targets, one on MongoDB.** MongoDB permits one text index per collection, so a MongoDB model has at most one text search scope. Postgres permits several indexes and therefore several scopes.
- **MongoDB's placement rule stays inside the ORM client.** MongoDB accepts a text search only in the first stage of a pipeline, together with any other filters. Because a collection compiles at the terminal method, the Mongo ORM client places the text search and the accumulated filters in that first stage regardless of call order. A text search inside a `$lookup` sub-pipeline is accepted, so scopes work inside includes there too.
- **Ordering by relevance costs a sort over every match.** A caller who needs only the matching rows can replace the default order with a cheaper one.
- **Relevance cannot be combined with another sort key.** Replacing is the only interaction between the default order and `orderBy`. Combining them needs a way to refer to the relevance score inside `orderBy`, which this decision does not provide.
- **The Postgres full-text index changes representation.** It records fields, weights and language as data. A contract that declares a full-text index as a hand-written expression index keeps working as an index and offers no scope.
- **Column operations remain.** `fullTextMatches`, `fullTextRank` and `fullTextHeadline` on a single text column are unchanged. `fullTextHeadline` has no scope equivalent, because highlighting needs text and a search document is not text; highlighting stays per column.
- **Two contributions can collide outside `scopes`.** A contribution extends a class and can add any member. Entries under `scopes` cannot collide, because index names are unique within a table.

### Possible extension: a domain name for an index

An index could carry a domain name independent of its storage name, as a model has a name independent of its table's. A scope would use the domain name when present. That name would live in the contract's domain plane and refer to the storage index through the contract's entity coordinates.

## Alternatives considered

- **Declare scopes in the contract's domain plane, mapped to a storage entity.** The domain entry carries nothing beyond a name that the index already has, and the mapping needs entity coordinates to address an index inside a table or collection, which they cannot do. It also makes every ORM client honour a concept that only some of them need.
- **Make each search an aggregate root beside the model's own.** A root is the entry point to an aggregate, one per directly queryable model. A search is another way into the same aggregate, so this gives one model two roots and blurs what being a root means.
- **Offer search only as a starting point, not on every collection.** The collection inside an `include` refinement is created by the ORM client from the relation, not started by the caller, so a starting-point-only scope could never be used there.
- **Put the search document on the row accessor, as `p.search`.** It places something that is not a field in the field namespace, where a model with a field of that name collides with it.
- **Have the query restate the fields and weights.** Any difference from the index silently disables it.
- **Model scope operations as query operations.** A query operation applies to a column or expression and returns a value with a codec. A scope operation applies to a collection and returns a collection.
- **Carry scope types in the emitted contract.** It couples the contract to one query interface.
- **Direct placement only, rejecting colliding names when the contract is built.** The contract does not know the ORM client's member names, and a method added in a later release would make existing contracts fail to load.
- **`scopes` only, with no direct placement.** It is always correct and costs one word per call. The direct form is kept for readability, with `scopes` as the guaranteed path.
- **Relevance as a sort key at the point of the call.** The same two calls in a different order would mean different queries, unlike every other collection refinement.
