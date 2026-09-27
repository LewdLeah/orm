import { describe, expect, it } from 'vitest';
import { defineContract, type ScalarFieldBuilder } from '../../src/exports/contract-builder';

type SqliteField = Parameters<NonNullable<Parameters<typeof defineContract>[1]>>[0]['field'];
type AnyFieldBuilder = ScalarFieldBuilder;

function storedDefault(build: (field: SqliteField) => AnyFieldBuilder): unknown {
  const contract = defineContract({}, ({ field, model }) => ({
    models: {
      Event: model('Event', {
        fields: { id: field.id.uuidv4String(), at: build(field) },
      }),
    },
  }));
  const [namespace] = Object.values(contract.storage.namespaces);
  return namespace?.entries.table?.['Event']?.columns['at']?.default;
}

describe('sqlite defineContract encodes literal defaults through the column codec', () => {
  it('stores the ISO text of a Date given to field.temporal.datetime()', () => {
    expect(
      storedDefault((field) => field.temporal.datetime().default(new Date('2024-01-01T00:00:00Z'))),
    ).toEqual({ kind: 'literal', value: '2024-01-01T00:00:00.000Z' });
  });

  it('refuses a string given to field.temporal.datetime()', () => {
    expect(() =>
      storedDefault((field) => field.temporal.datetime().default('2024-01-01T00:00:00Z')),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: expect.objectContaining({
          modelName: 'Event',
          fieldName: 'at',
          codecId: 'sqlite/datetime@1',
        }),
      }),
    );
  });
});
