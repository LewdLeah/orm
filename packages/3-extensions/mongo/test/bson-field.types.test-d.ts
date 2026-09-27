import type { InferModelRow } from '@internal/mongo-contract';
import type { CreateInput } from '@internal/mongo-orm';
import type { BsonValue } from '@internal/target-mongo/codec-types';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Event: model('Event', {
      collection: 'events',
      fields: {
        _id: field.objectId(),
        raw: field.bson(),
      },
    }),
  },
}));

type RawInput = CreateInput<typeof contract, 'Event'>['raw'];

test('a bson field reads as BsonValue on the no-emit path', () => {
  expectTypeOf<InferModelRow<typeof contract, 'Event'>['raw']>().toEqualTypeOf<BsonValue>();
});

test('a bson field also accepts a native RegExp and a Uint8Array on write, at any depth', () => {
  expectTypeOf<RegExp>().toExtend<RawInput>();
  expectTypeOf<{ pattern: RegExp; bytes: readonly Uint8Array[] }>().toExtend<RawInput>();
  expectTypeOf<BsonValue>().toExtend<RawInput>();
});

test('a bson field does not accept values outside BSON on write', () => {
  expectTypeOf<Map<string, number>>().not.toExtend<RawInput>();
  expectTypeOf<bigint>().not.toExtend<RawInput>();
  expectTypeOf<Int16Array>().not.toExtend<RawInput>();
});
