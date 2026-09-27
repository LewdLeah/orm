import 'temporal-polyfill/full/global';
import { describe, expect, it } from 'vitest';
import { defineContract, type ScalarFieldBuilder } from '../../src/exports/contract-builder';

type PostgresField = Parameters<NonNullable<Parameters<typeof defineContract>[1]>>[0]['field'];
type AnyFieldBuilder = ScalarFieldBuilder;

function storedDefault(build: (field: PostgresField) => AnyFieldBuilder): unknown {
  const contract = defineContract({}, ({ field, model }) => ({
    models: {
      Event: model('Event', {
        fields: { id: field.id.uuidv4String(), at: build(field) },
      }),
    },
  }));
  return contract.storage.namespaces['public']?.entries.table?.['Event']?.columns['at']?.default;
}

type DefaultArgument = Parameters<ScalarFieldBuilder['default']>[0];

function untypedDefault(value: Temporal.Instant): DefaultArgument {
  return value as unknown as DefaultArgument;
}

function refusal(build: (field: PostgresField) => AnyFieldBuilder): unknown {
  try {
    storedDefault(build);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('postgres defineContract encodes literal defaults through the column codec', () => {
  describe('field.dateTime()', () => {
    it('refuses a date-only string, naming the model, field and codec', () => {
      expect(refusal((field) => field.dateTime().default('2024-01-01'))).toMatchObject({
        code: 'CONTRACT.DEFAULT_INVALID',
        message: expect.stringMatching(/"Event\.at".*pg\/timestamptz-temporal@1/s),
        meta: {
          modelName: 'Event',
          fieldName: 'at',
          codecId: 'pg/timestamptz-temporal@1',
        },
        cause: expect.any(Error),
      });
    });

    it('refuses an ISO timestamp string', () => {
      expect(refusal((field) => field.dateTime().default('2024-01-01T00:00:00Z'))).toMatchObject({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: { modelName: 'Event', fieldName: 'at' },
      });
    });

    it('stores the text the codec produces for a Temporal.Instant', () => {
      expect(
        storedDefault((field) =>
          field.dateTime().default(untypedDefault(Temporal.Instant.from('2024-01-01T00:00:00Z'))),
        ),
      ).toEqual({ kind: 'literal', value: '2024-01-01T00:00:00Z' });
    });
  });

  it('stores a Date given to field.temporal.timestamptzJsDate()', () => {
    expect(
      storedDefault((field) =>
        field.temporal.timestamptzJsDate().default(new Date('2024-01-01T00:00:00Z')),
      ),
    ).toEqual({ kind: 'literal', value: '2024-01-01T00:00:00.000Z' });
  });

  it('stores an ISO string given to field.temporal.timestamptzString()', () => {
    expect(
      storedDefault((field) => field.temporal.timestamptzString().default('2024-01-01T00:00:00Z')),
    ).toEqual({ kind: 'literal', value: '2024-01-01T00:00:00Z' });
  });

  it('refuses a fractional number on a bigint column', () => {
    expect(refusal((field) => field.bigint().default(1.5))).toMatchObject({
      code: 'CONTRACT.DEFAULT_INVALID',
      meta: { modelName: 'Event', fieldName: 'at', codecId: 'pg/int8@1' },
    });
  });

  it('says which element of a list default the codec refused', () => {
    expect(refusal((field) => field.bigint().many().default([1, 1.5]))).toMatchObject({
      code: 'CONTRACT.DEFAULT_INVALID',
      message: expect.stringContaining('element 2'),
      meta: { modelName: 'Event', fieldName: 'at', codecId: 'pg/int8@1' },
    });
  });

  it('keeps a caller-supplied codecLookup', () => {
    const contract = defineContract(
      {
        codecLookup: {
          get: () => undefined,
          targetTypesFor: () => undefined,
          renderOutputTypeFor: () => undefined,
        },
      },
      ({ field, model }) => ({
        models: {
          Event: model('Event', {
            fields: { id: field.id.uuidv4String(), at: field.dateTime().default('2024-01-01') },
          }),
        },
      }),
    );
    expect(
      contract.storage.namespaces['public']?.entries.table?.['Event']?.columns['at']?.default,
    ).toEqual({ kind: 'literal', value: '2024-01-01' });
  });
});
