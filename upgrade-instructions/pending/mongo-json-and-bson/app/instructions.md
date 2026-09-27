---
changes:
  - id: mongo-json-field-semantics
    summary: |
      A Mongo `Json` field now admits only JSON values. Its collection validator lists the
      JSON-representable BSON types, which changes the validator and `storageHash` of every Mongo
      contract with a `Json` field, and a document whose `Json` field holds a `Date`, `ObjectId`,
      `Decimal128`, `Binary`, or another non-JSON BSON value at any depth fails to decode.
---

## `mongo-json-field-semantics`

This change has no detection pattern: which `Json` fields hold non-JSON values depends on the data, which a search of the source cannot see.

A Mongo `Json` field (`field.json()` in TypeScript) means a JSON value, no more. Its validator admits BSON `object`, `array`, `string`, `double`, `int`, `long`, `bool` and `null`. Reading a document fails with `RUNTIME.DECODE_FAILED` when the field holds a `Date`, `ObjectId`, `Decimal128`, `Binary`, regular expression, timestamp, or a 64-bit integer outside the safe-integer range, at any depth; the message names the path inside the field. Writing such a value fails with `RUNTIME.ENCODE_FAILED`.

1. For each Mongo `Json` field whose documents hold such values, change its type to `Bson` in PSL (`field.bson()` in TypeScript), which admits any BSON value.
2. Run `prisma contract emit`. Every Mongo contract with a `Json` field changes: its validator lists the JSON types and its `storageHash` moves, whether or not step 1 changed anything.
3. Run `prisma db update` so each collection's validator matches the contract.
