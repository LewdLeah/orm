import { describe, expect, it } from 'vitest';
import { schemaDriftNextActions } from '../../src/orm/db/verification';

const DB_UPDATE = {
  kind: 'run-command',
  label: 'Change the database to match the contract, then sign again',
  command: '{bin} db update',
};

describe('schemaDriftNextActions', () => {
  it('asks a Prisma 6 project to change its schema first, naming the schema path relative to cwd', () => {
    expect(
      schemaDriftNextActions({
        source: { format: 'prisma6', inputs: ['/project/prisma/schema.prisma'] },
        verb: 'sign',
        cwd: '/project',
      }),
    ).toEqual([
      {
        kind: 'user-choice',
        label:
          'Change prisma/schema.prisma to describe the database as it is (Prisma 6 owns this database), re-run contract emit, then sign again',
      },
      {
        kind: 'run-command',
        label: 'Or change the database to match the contract, then sign again',
        command: '{bin} db update',
      },
    ]);
  });

  it('asks a Prisma 7 project to change its schema first, naming Prisma 7', () => {
    expect(
      schemaDriftNextActions({
        source: { format: 'prisma7', inputs: ['/project/schema.prisma'] },
        verb: 'verify',
        cwd: '/project',
      }),
    ).toEqual([
      {
        kind: 'user-choice',
        label:
          'Change schema.prisma to describe the database as it is (Prisma 7 owns this database), re-run contract emit, then verify again',
      },
      {
        kind: 'run-command',
        label: 'Or change the database to match the contract, then verify again',
        command: '{bin} db update',
      },
    ]);
  });

  it('falls back to a generic schema name when the Prisma 6 or 7 source declares no inputs', () => {
    expect(
      schemaDriftNextActions({
        source: { format: 'prisma7', inputs: [] },
        verb: 'sign',
        cwd: '/project',
      })[0],
    ).toEqual({
      kind: 'user-choice',
      label:
        'Change your schema.prisma to describe the database as it is (Prisma 7 owns this database), re-run contract emit, then sign again',
    });
  });

  it('offers db update, then contract infer, to a PSL project', () => {
    expect(
      schemaDriftNextActions({
        source: { format: 'psl', inputs: ['/project/contract.prisma'] },
        verb: 'sign',
        cwd: '/project',
      }),
    ).toEqual([
      DB_UPDATE,
      {
        kind: 'run-command',
        label:
          'Or change the contract to describe the database as it is, then re-emit and sign again',
        command: '{bin} contract infer',
      },
    ]);
  });

  it('offers db update, then a hand edit of the contract, to a TypeScript project', () => {
    expect(
      schemaDriftNextActions({
        source: { format: 'typescript', inputs: [] },
        verb: 'sign',
        cwd: '/project',
      }),
    ).toEqual([
      DB_UPDATE,
      {
        kind: 'user-choice',
        label:
          'Or change the contract to describe the database as it is, re-run contract emit, then sign again',
      },
    ]);
  });

  it('offers db update, then a hand edit of the contract, when the config has no source', () => {
    expect(schemaDriftNextActions({ source: undefined, verb: 'sign', cwd: '/project' })).toEqual([
      DB_UPDATE,
      {
        kind: 'user-choice',
        label:
          'Or change the contract to describe the database as it is, re-run contract emit, then sign again',
      },
    ]);
  });
});
