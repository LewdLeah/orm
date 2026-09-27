import type { CodecLookup } from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const refusingJsonb: CodecLookup = {
  get: (id) =>
    id === 'pg/jsonb@1'
      ? {
          id,
          encode: async (value: unknown) => value,
          decode: async (wire: unknown) => wire,
          encodeJson: () => {
            throw new Error('Expected a Money value');
          },
          decodeJson: (json: unknown) => json,
        }
      : undefined,
  targetTypesFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

describe('a literal default the codec refuses', () => {
  it('names the value-object field and carries the codec message', () => {
    expect(() =>
      buildSqlContractFromDefinition(
        {
          warnings: undefined,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          models: [
            {
              modelName: 'Invoice',
              tableName: 'invoice',
              fields: [
                {
                  fieldName: 'id',
                  columnName: 'id',
                  descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
                  nullable: false,
                },
                {
                  fieldName: 'total',
                  columnName: 'total',
                  valueObjectName: 'Money',
                  nullable: false,
                  default: { kind: 'literal', value: 'twelve' },
                },
              ],
              id: { columns: ['id'] },
            },
          ],
          valueObjects: [
            {
              name: 'Money',
              fields: [
                {
                  fieldName: 'amount',
                  columnName: 'amount',
                  descriptor: { codecId: 'pg/int8@1', nativeType: 'int8' },
                  nullable: false,
                },
              ],
            },
          ],
        },
        refusingJsonb,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Field "Invoice.total" has a default that its codec refuses: Expected a Money value',
        meta: {
          modelName: 'Invoice',
          fieldName: 'total',
          codecId: 'pg/jsonb@1',
          reason: 'codec-refused-default',
        },
      }),
    );
  });
});
