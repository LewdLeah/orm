---
changes:
  - id: ts-defaults-encoded-by-codec
    summary: |
      `defineContract` from the Postgres and SQLite packages now encodes every literal `.default(value)` through the column's codec. The literal is the codec's input type. TypeScript checks it for fields built inside the `defineContract` factory, and the build fails with `CONTRACT.DEFAULT_INVALID` for a value the codec refuses. Pass a value of the codec's input type, or choose the field preset whose codec takes the value you have.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.default\(\s*(?!now\(\)|autoincrement\(\)|sql`)'
---

## `ts-defaults-encoded-by-codec`

A TypeScript contract used to store the value passed to `.default(value)` as it stood. The column's codec now encodes it, so the value must be the codec's input type. For a field built inside the `defineContract` factory, `.default()` is typed with that input type, so a wrong value is a type error in `contract.ts`. PSL contracts, `.default(now())`, `.default(autoincrement())` and `` .default(sql`...`) `` are not affected.

What now fails, on Postgres:

```typescript
// before: emitted, although the codec of field.dateTime() holds a Temporal.Instant
createdAt: field.dateTime().default('2024-01-01T00:00:00Z'),
```

```text
CONTRACT.DEFAULT_INVALID: Field "Event.createdAt" has a default that its codec refuses: Codec 'pg/timestamptz-temporal@1' encodes a Temporal.Instant, but received a string.
```

1. Search your contract files for `.default(` with a literal argument.
2. Type-check the contract file, then run `prisma contract emit`. TypeScript reports a default of the wrong type; the emit reports each default the codec refuses, with its model and field.
3. For each one, either pass the codec's type or change the preset:

| You have | Write |
| --- | --- |
| an ISO 8601 string | `field.temporal.timestamptzString().default('2024-01-01T00:00:00Z')` |
| a JavaScript `Date` | `field.temporal.timestamptzJsDate().default(new Date('2024-01-01T00:00:00Z'))` |
| a `Temporal.Instant` | `field.dateTime().default(Temporal.Instant.from('2024-01-01T00:00:00Z'))` |

Changing the preset changes the column's codec, and so the type your queries read and write for that field. On SQLite, `field.temporal.datetime()` takes a `Date`. `field.bigint()` takes a `bigint` and `field.bytes()` takes a `Uint8Array`.

On Node 24 there is no global `Temporal`. A contract file that creates a `Temporal` value must load an implementation itself, for example with `import 'temporal-polyfill/full/global'` as its first import.

A default the codec accepts can be stored in a different form than before:

| Default | Stored before | Stored now |
| --- | --- | --- |
| `field.bigint().default(1)` (also SQLite `bigintColumn`) | `1` | `"1"` |
| `field.bytes().default('x')` | `"x"` | `"eA=="` (base64) |
| SQLite `blobColumn` with `.default('x')` | `"x"` | `"78"` (hex) |

A contract with such a default emits a different `contract.json` and a different storage hash. Re-emit the contract and review the diff of `contract.json`.
