import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import type { RuntimeQueryable } from '../src/types';
import { brinScopes, fakeTsQuery, fullTextScopes, type ScopedContract } from './scopes-fixture';

declare const runtime: RuntimeQueryable;
declare const context: ExecutionContext<ScopedContract>;

const q = fakeTsQuery('hello');

const db = orm({ runtime, context, scopes: [fullTextScopes, brinScopes] });

test('direct placement exists only when the name is free', () => {
  expectTypeOf(db.public.Post.search.fulltext).toBeFunction();
  expectTypeOf(db.public.Post.where).toBeFunction();
  expectTypeOf(db.public.Post.where).not.toHaveProperty('fulltext');
  expectTypeOf(db.public.Post.scopes.where.fulltext).toBeFunction();
  // @ts-expect-error where is the collection method, not the scope
  db.public.Post.where.fulltext(q);
});

test('direct placement is present on chained collections and include refinements', async () => {
  db.public.Post.where({ id: 1 })
    .search.fulltext(q)
    .orderBy((p) => p.id.desc())
    .byViews.between(1, 2)
    .limit(1);
  const users = await db.public.User.select('id')
    .include('posts', (posts) => posts.search.fulltext(q).select('id', 'title').limit(3))
    .all();
  expectTypeOf(users).toEqualTypeOf<{ id: number; posts: { id: number; title: string }[] }[]>();
});

test('a model with no such index has nothing placed directly', () => {
  // @ts-expect-error User has no index with a contribution
  db.public.User.search;
});

class PostCollection extends Collection<ScopedContract, 'Post'> {
  published() {
    return this.where((post) => post.views.gte(100));
  }
}

test('a custom class member keeps its name at the root', () => {
  const custom = orm({
    runtime,
    context,
    collections: { Post: PostCollection },
    scopes: [fullTextScopes, brinScopes],
  });
  expectTypeOf(custom.public.Post.published).toBeFunction();
  expectTypeOf(custom.public.Post.published).not.toHaveProperty('fulltext');
  custom.public.Post.search.fulltext(q).limit(1);
});
