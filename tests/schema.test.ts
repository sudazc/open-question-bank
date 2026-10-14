import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { entitySchemaRefs, schemaDocument } from '../packages/schema/src/index.js';
import { boundarySamples, invalidSamples, validSamples } from './fixtures.js';

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
});
