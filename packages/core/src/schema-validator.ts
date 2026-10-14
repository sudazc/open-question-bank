import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import {
  entitySchemaRefs,
  schemaDocument,
  type Bank,
  type Exam,
  type Knowledge,
  type Question,
  type QuestionGroup,
  type Topic,
} from '@openquestionbank/schema';
import type { Diagnostic } from './diagnostics.js';

export type EntityKind = 'bank' | 'topic' | 'knowledge' | 'question' | 'questionGroup' | 'exam';

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(schemaDocument);

const validators: { [K in EntityKind]: ValidateFunction<EntityTypeMap[K]> } = {
  bank: ajv.compile<Bank>({ $ref: entitySchemaRefs.bank }),
  topic: ajv.compile<Topic>({ $ref: entitySchemaRefs.topic }),
  knowledge: ajv.compile<Knowledge>({ $ref: entitySchemaRefs.knowledge }),
  question: ajv.compile<Question>({ $ref: entitySchemaRefs.question }),
  questionGroup: ajv.compile<QuestionGroup>({ $ref: entitySchemaRefs.questionGroup }),
  exam: ajv.compile<Exam>({ $ref: entitySchemaRefs.exam }),
};

export interface EntityTypeMap {
  bank: Bank;
  topic: Topic;
  knowledge: Knowledge;
  question: Question;
  questionGroup: QuestionGroup;
  exam: Exam;
}

export function validateEntity<K extends EntityKind>(
  kind: K,
  value: unknown,
  file: string,
): { valid: true; value: EntityTypeMap[K] } | { valid: false; diagnostics: Diagnostic[] } {
  const validator = validators[kind];
  if (validator(value)) {
    return { valid: true, value };
  }

  return {
    valid: false,
    diagnostics: (validator.errors ?? []).map((error) => toDiagnostic(error, value, file)),
  };
}

function toDiagnostic(error: ErrorObject, value: unknown, file: string): Diagnostic {
  const fieldPath = pointerToPath(error.instancePath);
  const entityId = isRecord(value) && typeof value.id === 'string' ? value.id : undefined;
  return {
    code: 'OQB-SCHEMA-001',
    severity: 'error',
    message: `${fieldPath || '$'} ${error.message ?? '不符合 Schema 1.0 结构'}`,
    file,
    ...(entityId === undefined ? {} : { entityId }),
    ...(fieldPath === '' ? {} : { fieldPath }),
    suggestion: '根据 JSON Schema Draft 2020-12 诊断修正字段结构',
  };
}

function pointerToPath(pointer: string): string {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .map((segment) => (/^\d+$/.test(segment) ? `[${segment}]` : segment))
    .join('.')
    .replaceAll('.[', '[');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
