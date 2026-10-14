import schemaDocument from './schema/1.0.0/oqb.schema.json' with { type: 'json' };

export { schemaDocument };
export * from './types.js';

export const schemaVersion = '1.0.0' as const;

export const entitySchemaRefs = {
  bank: `${schemaDocument.$id}#/$defs/Bank`,
  topic: `${schemaDocument.$id}#/$defs/Topic`,
  knowledge: `${schemaDocument.$id}#/$defs/Knowledge`,
  question: `${schemaDocument.$id}#/$defs/Question`,
  questionGroup: `${schemaDocument.$id}#/$defs/QuestionGroup`,
  exam: `${schemaDocument.$id}#/$defs/Exam`,
} as const;
