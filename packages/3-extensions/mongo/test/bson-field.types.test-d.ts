import type { InferModelRow } from '@internal/mongo-contract';
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

test('a bson field reads as BsonValue on the no-emit path', () => {
  expectTypeOf<InferModelRow<typeof contract, 'Event'>['raw']>().toEqualTypeOf<BsonValue>();
});
