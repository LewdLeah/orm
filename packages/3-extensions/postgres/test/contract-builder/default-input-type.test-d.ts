import { int8Column, textColumn } from '@internal/adapter-postgres/column-types';
import { test } from 'vitest';
import { defineContract, enumType, member, now, sql } from '../../src/exports/contract-builder';

const Level = enumType(
  'Level',
  { codecId: 'pg/int4@1' as const, nativeType: 'int4' },
  member('Low', 1),
  member('High', 10),
);
const BigLevel = enumType(
  'BigLevel',
  { codecId: 'pg/int8@1' as const, nativeType: 'int8' },
  member('Low', 1n),
);

const handWritten = { codecId: 'app/custom@1', nativeType: 'text' } as const;

test('.default() takes the input type of the field codec', () => {
  defineContract({ enums: { Level, BigLevel } }, ({ field, model }) => {
    const types = {
      Counter: {
        kind: 'codec-instance',
        codecId: 'pg/int8@1',
        nativeType: 'int8',
        typeParams: {},
      },
    } as const;
    return {
      models: {
        Accepted: model('Accepted', {
          fields: {
            id: field.id.uuidv4String(),
            instant: field.dateTime().default(Temporal.Instant.from('2024-01-01T00:00:00Z')),
            big: field.bigint().default(1n),
            bytes: field.bytes().default(new Uint8Array([120])),
            text: field.text().default('x'),
            jsDate: field.temporal.timestamptzJsDate().default(new Date()),
            isoString: field.temporal.timestamptzString().default('2024-01-01T00:00:00Z'),
            generatedNow: field.dateTime().default(now()),
            rawSql: field.text().default(sql`'x'`),
            optionalThenDefault: field.bigint().optional().default(1n),
            list: field.bigint().many().default([1n, 2n]),
            level: field.namedType(Level).default(Level.members.Low),
            bigLevel: field.namedType(BigLevel).default(BigLevel.members.Low),
            column: field.column(int8Column).default(1n),
            namedType: field.namedType(types.Counter).default(1n),
            handWritten: field.column(handWritten).default('anything JSON'),
          },
        }),
        Refused: model('Refused', {
          fields: {
            id: field.id.uuidv4String(),
            // @ts-expect-error pg/timestamptz-temporal@1 takes a Temporal.Instant, not a string
            instant: field.dateTime().default('2024-01-01'),
            // @ts-expect-error pg/text@1 takes a string, not a number
            text: field.text().default(1),
            // @ts-expect-error a list field takes an array
            list: field.bigint().many().default(1n),
            // @ts-expect-error an enum field takes one of its member values
            level: field.namedType(Level).default(2),
            // @ts-expect-error pg/text@1 takes a string, not a number
            column: field.column(textColumn).default(1),
            // @ts-expect-error pg/int8@1 takes a bigint, not a string
            namedType: field.namedType(types.Counter).default('1'),
          },
        }),
      },
      types,
    };
  });
});
