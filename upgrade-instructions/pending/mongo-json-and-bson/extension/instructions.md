---
changes:
  - id: mongo-bson-codec-added
    summary: |
      Mongo collection validators now read a codec's whole `targetTypes` list, not only its first
      entry: one entry gives `bsonType: '<entry>'`, several give `bsonType: [...entries]`. A codec
      that declared more than one BSON type had only the first enforced; it now has all of them.
    detection:
      glob: "packages/3-extensions/**"
      matches:
        - 'targetTypes\s*:\s*\[[^\]]*,'
---

## `mongo-bson-codec-added`

The Mongo validator derivation reads every entry of a codec descriptor's `targetTypes`. For a list field the list applies to `items`, and a nullable field prepends `'null'` unless the list already has it. An empty list still gives an unconstrained validator (`{}`).

For each Mongo codec descriptor in the extension whose `targetTypes` has more than one entry, check that every entry is a BSON type the codec's `encode` can produce, because each one is now admitted by the validator. Remove any entry the codec does not write. Then re-emit the extension's contracts and any test fixtures; their validators list every entry.
