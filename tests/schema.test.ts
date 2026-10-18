import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { entitySchemaRefs, schemaDocument } from '../packages/schema/src/index.js';
import { bank, boundarySamples, invalidSamples, questions, validSamples } from './fixtures.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(schemaDocument);

function validatorFor(schemaRef: string) {
  const validator = ajv.getSchema(schemaRef);
  if (!validator) {
    throw new Error(`Schema reference was not registered: ${schemaRef}`);
  }
  return validator;
}

describe('JSON Schema Draft 2020-12', () => {
  it('accepts the schema document itself', () => {
    expect(ajv.validateSchema(schemaDocument)).toBe(true);
  });

  it.each(validSamples)('accepts valid sample: $name', (sample) => {
    const validate = validatorFor(sample.schemaRef);
    expect(validate(sample.value), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it.each(invalidSamples)('rejects invalid sample: $name', (sample) => {
    const validate = validatorFor(sample.schemaRef);
    expect(validate(sample.value)).toBe(false);
    expect(validate.errors).not.toBeNull();
  });

  it.each(boundarySamples)('accepts boundary sample: $name', (sample) => {
    const validate = validatorFor(sample.schemaRef);
    expect(validate(sample.value), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('dispatches each sample through the root entity union', () => {
    const validate = ajv.getSchema(schemaDocument.$id);
    expect(validate).toBeDefined();
    for (const sample of validSamples) {
      expect(validate?.(sample.value), sample.name).toBe(true);
    }
  });

  it('exposes a schema reference for each core entity', () => {
    expect(Object.keys(entitySchemaRefs)).toEqual([
      'bank',
      'topic',
      'knowledge',
      'question',
      'questionGroup',
      'exam',
    ]);
  });

  it('rejects trailing line terminators in constrained strings', () => {
    const validateBank = validatorFor(entitySchemaRefs.bank);
    const validateQuestion = validatorFor(entitySchemaRefs.question);
    const numericQuestion = questions.find((question) => question.type === 'numeric');
    if (!numericQuestion) {
      throw new Error('Missing numeric question fixture');
    }

    for (const lineTerminator of ['\n', '\r', '\u2028', '\u2029']) {
      expect(validateBank({ ...bank, id: `${bank.id}${lineTerminator}` })).toBe(false);
      expect(validateBank({ ...bank, version: `${bank.version}${lineTerminator}` })).toBe(false);
      expect(validateBank({ ...bank, language: `${bank.language}${lineTerminator}` })).toBe(false);
      expect(
        validateBank({
          ...bank,
          paths: { ...bank.paths, topics: `${bank.paths.topics}${lineTerminator}` },
        }),
      ).toBe(false);
      expect(
        validateQuestion({
          ...numericQuestion,
          answer: {
            ...numericQuestion.answer,
            value: `${numericQuestion.answer.value}${lineTerminator}`,
          },
        }),
      ).toBe(false);
    }
  });
});
