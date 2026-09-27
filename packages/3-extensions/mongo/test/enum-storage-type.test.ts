import mongoAdapter from '@internal/adapter-mongo/control';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { createControlStack } from '@internal/framework-components/control';
import { interpretPslDocumentToMongoContract } from '@internal/mongo-contract-psl';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
});

function interpret(schema: string) {
  const { document, sources } = parse(schema, 'schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToMongoContract({
    documents: [document],
    symbolTable,
    sources,
    scalarTypeCodecIds: new Map(
      [...collectScalarTypeConstructors(stack.authoringContributions.type)].map(
        ([name, output]) => [name, output.codecId],
      ),
    ),
    controlMutationDefaults: stack.controlMutationDefaults,
    codecLookup: stack.codecLookup,
    authoringContributions: stack.authoringContributions,
  });
}

describe('a Mongo enum over a codec without exactly one storage type', () => {
  it.each([
    ['mongo/json@1', 8],
    ['mongo/bson@1', 0],
  ])(
    'refuses @@type("%s"), which declares %i storage types, at the @@type argument',
    (codecId, count) => {
      const typeAttribute = `@@type("${codecId}")`;
      const schema = `enum Shape {\n  ${typeAttribute}\n  a\n}\n`;
      const result = interpret(schema);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const start = schema.indexOf(`"${codecId}"`);
      expect(result.failure.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `Enum "Shape": codec "${codecId}" declares ${count} storage types; an enum needs exactly one.`,
          span: expect.objectContaining({
            start: expect.objectContaining({ offset: start }),
            end: expect.objectContaining({ offset: start + codecId.length + 2 }),
          }),
        }),
      ]);
    },
  );
});
