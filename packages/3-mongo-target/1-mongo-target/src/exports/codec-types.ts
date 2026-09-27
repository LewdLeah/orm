import type { JsonValue } from '@internal/contract/types';

export type Vector<N extends number = number> = readonly number[] & {
  readonly __vectorLength?: N;
};

/**
 * A BSON scalar as the driver reads it. Structural, because values come from the driver's own copy of `bson`, not the classes this package imports.
 */
export type BsonScalar =
  | string
  | number
  | boolean
  | null
  | Date
  | { readonly _bsontype: 'ObjectId'; toHexString(): string }
  | { readonly _bsontype: 'Long'; toBigInt(): bigint }
  | { readonly _bsontype: 'Decimal128'; toString(): string }
  | { readonly _bsontype: 'Binary'; value(): Uint8Array; readonly sub_type: number }
  | { readonly _bsontype: 'BSONRegExp'; readonly pattern: string; readonly options: string }
  | { readonly _bsontype: 'Timestamp'; toBigInt(): bigint }
  | { readonly _bsontype: 'Int32'; valueOf(): number }
  | { readonly _bsontype: 'Double'; valueOf(): number };

/**
 * Any BSON value: a scalar, an array of values, or a document of values.
 */
export type BsonValue =
  | BsonScalar
  | ReadonlyArray<BsonValue>
  | { readonly [key: string]: BsonValue };

/**
 * What a `Bson` field accepts on write: any `BsonValue`, and also a native `RegExp` and a `Uint8Array` or `Buffer`, which the driver writes as BSON regex and binData subtype 0.
 */
export type BsonInputValue =
  | BsonScalar
  | RegExp
  | Uint8Array
  | ReadonlyArray<BsonInputValue>
  | { readonly [key: string]: BsonInputValue };

export type CodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/double@1': { readonly input: number; readonly output: number };
  readonly 'mongo/int32@1': { readonly input: number; readonly output: number };
  readonly 'mongo/bool@1': { readonly input: boolean; readonly output: boolean };
  readonly 'mongo/date@1': { readonly input: Date; readonly output: Date };
  readonly 'mongo/vector@1': {
    readonly input: readonly number[];
    readonly output: readonly number[];
  };
  readonly 'mongo/int64@1': { readonly input: bigint; readonly output: bigint };
  readonly 'mongo/decimal128@1': { readonly input: string; readonly output: string };
  readonly 'mongo/binary@1': { readonly input: Uint8Array; readonly output: Uint8Array };
  readonly 'mongo/json@1': { readonly input: JsonValue; readonly output: JsonValue };
  readonly 'mongo/bson@1': { readonly input: BsonInputValue; readonly output: BsonValue };
};
