---
changes:
  - id: mongo-json-field-semantics
    summary: |
      A Mongo `Json` field now admits only JSON values. Its collection validator lists the
      JSON-representable BSON types, and a document whose `Json` field holds a `Date`, `ObjectId`,
      `Decimal128`, `Binary`, or another non-JSON BSON value at any depth fails to decode.
---

## `mongo-json-field-semantics`

This change has no detection pattern: whether a `Json` field holds non-JSON values depends on the data, which a search of the source cannot see.

A Mongo `Json` field (`field.json()` in TypeScript) means a JSON value, no more. Its validator admits BSON `object`, `array`, `string`, `double`, `int`, `long`, `bool` and `null`. Reading a document fails with `RUNTIME.DECODE_FAILED` when the field holds a `Date`, `ObjectId`, `Decimal128`, `Binary`, regular expression, timestamp, or a 64-bit integer outside the safe-integer range, at any depth; the message names the path inside the field. Writing such a value fails with `RUNTIME.ENCODE_FAILED`.

For each Mongo `Json` field whose documents hold such values, change its type to `Bson` in PSL (`field.bson()` in TypeScript), which admits any BSON value. Then run `prisma contract emit` and `prisma db update` so each collection's validator matches the contract.
