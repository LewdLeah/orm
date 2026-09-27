import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import type { RuntimeQueryable } from '../src/types';
import {
  brinScopes,
  type FakeTsQuery,
  fakeTsQuery,
  fullTextScopes,
  type ScopedContract,
} from './scopes-fixture';

declare const runtime: RuntimeQueryable;
declare const context: ExecutionContext<ScopedContract>;

const q = fakeTsQuery('hello');

const db = orm({ runtime, context, scopes: [fullTextScopes, brinScopes] });

test('a scope exists under the authored index name, from contract index data alone', () => {
  expectTypeOf(db.public.Post.scopes).toHaveProperty('search');
  expectTypeOf(db.public.Post.scopes.search.fulltext).toBeFunction();
  expectTypeOf(db.public.Post.scopes.search.fulltext).parameter(0).toEqualTypeOf<FakeTsQuery>();
  expectTypeOf<keyof typeof db.public.Post.scopes>().toEqualTypeOf<
    'search' | 'where' | 'published' | 'byViews'
  >();
});

test('the physical name of a wire-named index is not a scope', () => {
  // @ts-expect-error the scope is named by the authored prefix, not the hashed name
  db.public.Post.scopes.search_0a1b2c3d;
});

test('an index whose kind has no contribution offers no scope', () => {
  // @ts-expect-error a plain btree index matches no contribution
  db.public.Post.scopes.posts_user_id_idx;
});

test('operations read the literal index data', () => {
  expectTypeOf(db.public.Post.scopes.search.language).toEqualTypeOf<'english'>();
  expectTypeOf(db.public.Post.scopes.where.language).toEqualTypeOf<'simple'>();
  db.public.Post.scopes.search.fulltext(q, { only: 'title' });
  // @ts-expect-error views is not a column of the index
  db.public.Post.scopes.search.fulltext(q, { only: 'views' });
  // @ts-expect-error a plain string is not a query
  db.public.Post.scopes.search.fulltext('hello');
});

test('each contribution supplies the operations of its own index kind', () => {
  expectTypeOf(db.public.Post.scopes.byViews.between).toBeFunction();
  // @ts-expect-error fulltext belongs to the full-text contribution
  db.public.Post.scopes.byViews.fulltext(q);
  // @ts-expect-error between belongs to the brin contribution
  db.public.Post.scopes.search.between(1, 2);
});

test('a scope operation returns the collection of the model', async () => {
  const rows = await db.public.Post.scopes.search
    .fulltext(q)
    .where((p) => p.views.gt(1))
    .select('id', 'title')
    .limit(10)
    .all();
  expectTypeOf(rows).toEqualTypeOf<{ id: number; title: string }[]>();

  const selectedFirst = await db.public.Post.select('id').scopes.search.fulltext(q).all();
  expectTypeOf(selectedFirst).toEqualTypeOf<{ id: number }[]>();

  db.public.Post.scopes.search
    .fulltext(q)
    // @ts-expect-error nope is not a field of Post
    .where((p) => p.nope.eq(1));
});

test('the scope is present on chained collections', () => {
  db.public.Post.where((p) => p.userId.eq(1))
    .scopes.search.fulltext(q)
    .orderBy((p) => p.id.desc())
    .scopes.search.fulltext(q)
    .scopes.byViews.between(1, 2)
    .limit(1);
  db.public.Post.where({ id: 1 }).scopes.search.fulltext(q);
});

test('the scope is present inside an include refinement', async () => {
  const users = await db.public.User.select('id')
    .include('posts', (posts) => posts.scopes.search.fulltext(q).select('id', 'title').limit(3))
    .all();
  expectTypeOf(users).toEqualTypeOf<{ id: number; posts: { id: number; title: string }[] }[]>();

  db.public.User.include('posts', (posts) => posts.scopes.search.fulltext(q));
  db.public.User.include('posts', (posts) =>
    // @ts-expect-error missing is not a scope of Post
    posts.scopes.missing.fulltext(q),
  );
});

test('direct placement exists only when the name is free', () => {
  expectTypeOf(db.public.Post.where).toBeFunction();
  expectTypeOf(db.public.Post.where).not.toHaveProperty('fulltext');
  expectTypeOf(db.public.Post.scopes.where.fulltext).toBeFunction();
  // @ts-expect-error where is the collection method, not the scope
  db.public.Post.where.fulltext(q);
});

test('a model with no such index has an empty scopes object', () => {
  // biome-ignore lint/complexity/noBannedTypes: the empty object type is the assertion
  expectTypeOf(db.public.User.scopes).toEqualTypeOf<{}>();
  expectTypeOf<keyof typeof db.public.User.scopes>().toBeNever();
  // @ts-expect-error User has no index with a contribution
  db.public.User.scopes.search;
  // @ts-expect-error and nothing is placed directly
  db.public.User.search;
});

test('a client built without contributions has no scopes', () => {
  const plain = orm({ runtime, context });
  expectTypeOf<keyof typeof plain.public.Post.scopes>().toBeNever();
  // @ts-expect-error no contribution, no scope
  plain.public.Post.search;
});

class PostCollection extends Collection<ScopedContract, 'Post'> {
  published() {
    return this.where((post) => post.views.gte(100));
  }
}

const custom = orm({
  runtime,
  context,
  collections: { Post: PostCollection },
  scopes: [fullTextScopes, brinScopes],
});

test('a custom collection class keeps its members and gains scopes', () => {
  expectTypeOf(custom.public.Post.published).toBeFunction();
  expectTypeOf(custom.public.Post.published).not.toHaveProperty('fulltext');
  expectTypeOf(custom.public.Post.scopes.published.fulltext).toBeFunction();
  // @ts-expect-error published is the custom method, not the scope
  custom.public.Post.published.fulltext(q);

  custom.public.Post.scopes.search.fulltext(q).published();
  custom.public.Post.scopes.search.fulltext(q).scopes.search.fulltext(q).limit(1);
  custom.public.Post.scopes.search.fulltext(q).where({ id: 1 });
});

test('chaining a builder method on a custom collection loses the scopes', () => {
  // @ts-expect-error where() on a custom class returns the base Collection with default state
  custom.public.Post.where({ id: 1 }).search;
});

class ScopedPostCollection extends Collection<
  import('../src/types').ContractWithScopes<ScopedContract, readonly [typeof fullTextScopes]>,
  'Post'
> {
  relevant(query: FakeTsQuery) {
    return this.scopes.search.fulltext(query).limit(5);
  }
}

test('a custom class that names the contributions in its contract type can use scopes inside', () => {
  const scoped = orm({
    runtime,
    context,
    collections: { Post: ScopedPostCollection },
    scopes: [fullTextScopes],
  });
  scoped.public.Post.relevant(q).scopes.search.fulltext(q);
  scoped.public.Post.where({ id: 1 }).scopes.search.fulltext(q);
});
