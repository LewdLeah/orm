import {
  Binary,
  BSON,
  BSONRegExp,
  BSONSymbol,
  Code,
  DBRef,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
} from 'bson';
import { describe, expect, it } from 'vitest';
import { MONGO_BSON_CODEC_ID } from '../src/core/codec-ids';
import { mongoBsonCodec, mongoDescriptorById, mongoStandardCodecs } from '../src/core/codecs';
import type { BsonValue } from '../src/exports/codec-types';

function notBson(value: unknown): BsonValue {
  return value as BsonValue;
}

function encodeRefusal(received: string, path: string) {
  return expect.objectContaining({
    code: 'RUNTIME.ENCODE_FAILED',
    message: `mongo/bson@1 value must be a BSON value; received ${received} at ${path}`,
  });
}

const scalars: ReadonlyArray<readonly [string, BsonValue]> = [
  ['string', 'text'],
  ['number', 1.5],
  ['boolean', true],
  ['null', null],
  ['Date', new Date(0)],
  ['ObjectId', new ObjectId('64b7f0c2a1b2c3d4e5f60718')],
  ['Long', Long.fromBigInt(2n ** 60n)],
  ['Decimal128', Decimal128.fromString('1234.5600')],
  ['Binary', new Binary(new Uint8Array(16).fill(7), 4)],
  ['BSONRegExp', new BSONRegExp('^a', 'i')],
  ['Timestamp', new Timestamp({ t: 1, i: 2 })],
  ['Int32', new Int32(7)],
  ['Double', new Double(2.5)],
];

describe('mongoBsonCodec encode', () => {
  it.each(scalars)(
    'passes a %s nested in an object and an array through unchanged',
    async (_, value) => {
      const document = notBson({ outer: { items: [0, { value }] } });
      const encoded = await mongoBsonCodec.encode(document, {});
      expect(encoded).toBe(document);
    },
  );

  it.each([
    ['undefined', undefined],
    ['bigint', 1n],
    ['symbol', Symbol('s')],
    ['function', () => 1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['BSONSymbol', new BSONSymbol('s')],
    ['Code', new Code('x')],
    ['DBRef', new DBRef('c', new ObjectId())],
    ['MinKey', new MinKey()],
    ['MaxKey', new MaxKey()],
  ])('refuses %s nested in an object and an array, naming the path', async (received, value) => {
    await expect(
      mongoBsonCodec.encode(notBson({ outer: { items: [0, { value }] } }), {}),
    ).rejects.toThrow(encodeRefusal(received, 'outer.items.1.value'));
  });

  it('says "the root" when the value itself is not BSON', async () => {
    await expect(mongoBsonCodec.encode(notBson(undefined), {})).rejects.toThrow(
      encodeRefusal('undefined', 'the root'),
    );
  });
});

describe('mongoBsonCodec decode', () => {
  it('returns the wire value unchanged, whatever it holds', async () => {
    const wire = notBson({
      id: new ObjectId(),
      code: new Code('x'),
      big: Long.fromBigInt(2n ** 60n),
      promoted: 42,
      nested: [new MinKey(), { at: new Date(0) }],
    });
    expect(await mongoBsonCodec.decode(wire, {})).toBe(wire);
  });
});

describe('mongoBsonCodec JSON form', () => {
  it.each(scalars)(
    'round-trips a %s through canonical Extended JSON to the same BSON',
    (_, value) => {
      const document = { value, list: [value] };
      const json = mongoBsonCodec.encodeJson(notBson(document));
      expect(JSON.parse(JSON.stringify(json))).toEqual(json);
      const decoded = mongoBsonCodec.decodeJson(json);
      expect(BSON.serialize(decoded as BSON.Document)).toEqual(BSON.serialize(document));
    },
  );

  it('writes canonical, not relaxed, Extended JSON', () => {
    expect(mongoBsonCodec.encodeJson(notBson({ n: new Int32(1), d: new Date(0) }))).toEqual({
      n: { $numberInt: '1' },
      d: { $date: { $numberLong: '0' } },
    });
  });
});

describe('mongo/bson@1 descriptor', () => {
  it('declares no BSON type, no traits and no renderers', () => {
    const descriptor = mongoDescriptorById(MONGO_BSON_CODEC_ID);
    expect(descriptor).toMatchObject({
      codecId: 'mongo/bson@1',
      dataType: 'mongo/bson',
      targetTypes: [],
      traits: [],
    });
    expect(descriptor).not.toHaveProperty('renderOutputType');
    expect(descriptor).not.toHaveProperty('renderValueLiteral');
  });

  it('is registered in the standard codec set', () => {
    expect(mongoStandardCodecs.map((codec) => codec.id)).toContain(MONGO_BSON_CODEC_ID);
  });
});
