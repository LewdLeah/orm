import { describe, expect, it } from 'vitest';
import { schemaDriftNextActions } from '../../src/orm/db/verification';

const DB_UPDATE = {
  kind: 'run-command',
  label: 'Change the database to match the contract, then sign again',
  command: '{bin} db update',
};

const HAND_EDIT = {
  kind: 'user-choice',
  label:
    'Or change the contract to describe the database as it is, re-run contract emit, then sign again',
};

describe('schemaDriftNextActions', () => {
  it('asks a Prisma 6 project to change its schema first if Prisma 6 still manages the database', () => {
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
          'If Prisma 6 still manages this database, change prisma/schema.prisma to describe it as it is, re-run contract emit, then sign again',
      },
      {
        kind: 'run-command',
        label:
          'Or, if Prisma 8 manages it, change the database to match the contract, then sign again',
        command: '{bin} db update',
      },
    ]);
  });

  it('names Prisma 7 for a Prisma 7 source', () => {
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
          'If Prisma 7 still manages this database, change schema.prisma to describe it as it is, re-run contract emit, then verify again',
      },
      {
        kind: 'run-command',
        label:
          'Or, if Prisma 8 manages it, change the database to match the contract, then verify again',
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
        'If Prisma 7 still manages this database, change your schema.prisma to describe it as it is, re-run contract emit, then sign again',
    });
  });

  it('offers db update, then contract infer into the one PSL source file', () => {
    expect(
      schemaDriftNextActions({
        source: { format: 'psl', inputs: ['/project/prisma/contract.prisma'] },
        verb: 'sign',
        cwd: '/project',
      }),
    ).toEqual([
      DB_UPDATE,
      {
        kind: 'run-command',
        label:
          'Or replace prisma/contract.prisma with a contract inferred from the database, then re-emit and sign again',
        command: '{bin} contract infer --output prisma/contract.prisma',
      },
    ]);
  });

  it('offers a hand edit instead of contract infer when the PSL source has several files', () => {
    expect(
      schemaDriftNextActions({
        source: { format: 'psl', inputs: ['/project/a.prisma', '/project/b.prisma'] },
        verb: 'sign',
        cwd: '/project',
      }),
    ).toEqual([DB_UPDATE, HAND_EDIT]);
  });

  it('offers a hand edit instead of contract infer when the PSL source declares no inputs', () => {
    expect(
      schemaDriftNextActions({ source: { format: 'psl' }, verb: 'sign', cwd: '/project' }),
    ).toEqual([DB_UPDATE, HAND_EDIT]);
  });

  it('offers db update, then a hand edit of the contract, to a TypeScript project', () => {
    expect(
      schemaDriftNextActions({
        source: { format: 'typescript', inputs: [] },
        verb: 'sign',
        cwd: '/project',
      }),
    ).toEqual([DB_UPDATE, HAND_EDIT]);
  });

  it('offers db update, then a hand edit of the contract, when the config has no source', () => {
    expect(schemaDriftNextActions({ source: undefined, verb: 'sign', cwd: '/project' })).toEqual([
      DB_UPDATE,
      HAND_EDIT,
    ]);
  });
});
