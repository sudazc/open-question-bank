import { hasBlockingDiagnostics, type Diagnostic } from './diagnostics.js';
import { validateContentSecurity } from './content-security-validator.js';
import { buildEntityIndex, type EntityIndex } from './entity-index.js';
import {
  loadQuestionBank,
  type LoadOptions,
  type ParsedEntity,
  type ParsedQuestionBank,
} from './loader.js';
import { applyPublicationPolicy, type ValidationMode } from './publication-validator.js';
import { validateContentQuality } from './quality-validator.js';
import { validateSemantics } from './semantic-validator.js';
import { validateEntity, type EntityKind, type EntityTypeMap } from './schema-validator.js';
import type { LocatedEntity, LocatedQuestionBank, QuestionBankData } from './types.js';

export type { ValidationMode } from './publication-validator.js';

export interface ValidationOptions {
  mode?: ValidationMode;
}

export interface DirectoryValidationOptions extends LoadOptions, ValidationOptions {}

export interface ValidationResult {
  valid: boolean;
  data: QuestionBankData;
  index: EntityIndex;
  diagnostics: Diagnostic[];
}

/** 校验已读取的题库结构与实体关系并构建查询索引 */
export function validateQuestionBank(
  parsed: ParsedQuestionBank,
  options: ValidationOptions = {},
): ValidationResult {
  const diagnostics = [...parsed.diagnostics];
  const located: LocatedQuestionBank = {
    topics: validateRecords(parsed.topics, 'topic', diagnostics),
    knowledge: validateRecords(parsed.knowledge, 'knowledge', diagnostics),
    questions: validateRecords(parsed.questions, 'question', diagnostics),
    groups: validateRecords(parsed.groups, 'questionGroup', diagnostics),
    exams: validateRecords(parsed.exams, 'exam', diagnostics),
  };
  if (parsed.bank) {
    const [bank] = validateRecords([parsed.bank], 'bank', diagnostics);
    if (bank) {
      located.bank = bank;
    }
  }

  const mode = options.mode ?? 'draft';
  const publishable = applyPublicationPolicy(located, mode, diagnostics);
  if (mode === 'release') {
    removeExcludedAssetDiagnostics(located, publishable, diagnostics);
  }
  validateContentSecurity(publishable, diagnostics);
  validateContentQuality(publishable, diagnostics);
  validateSemantics(publishable, diagnostics);
  const data: QuestionBankData = {
    ...(publishable.bank === undefined ? {} : { bank: publishable.bank.value }),
    topics: publishable.topics.map(({ value }) => value),
    knowledge: publishable.knowledge.map(({ value }) => value),
    questions: publishable.questions.map(({ value }) => value),
    groups: publishable.groups.map(({ value }) => value),
    exams: publishable.exams.map(({ value }) => value),
  };

  return {
    valid: !hasBlockingDiagnostics(diagnostics),
    data,
    index: buildEntityIndex(data),
    diagnostics,
  };
}

/** 从题库目录读取、解析并完成 P1 Core 校验 */
export async function validateQuestionBankDirectory(
  rootDir: string,
  options: DirectoryValidationOptions = {},
): Promise<ValidationResult> {
  const { mode, ...loadOptions } = options;
  const parsed = await loadQuestionBank(rootDir, loadOptions);
  return validateQuestionBank(parsed, mode === undefined ? {} : { mode });
}

function validateRecords<K extends EntityKind>(
  records: readonly ParsedEntity[],
  kind: K,
  diagnostics: Diagnostic[],
): Array<LocatedEntity<EntityTypeMap[K]>> {
  const validated: Array<LocatedEntity<EntityTypeMap[K]>> = [];
  for (const record of records) {
    const result = validateEntity(kind, record.value, record.file);
    if (result.valid) {
      validated.push({ value: result.value, file: record.file });
    } else {
      diagnostics.push(...result.diagnostics);
    }
  }
  return validated;
}

function removeExcludedAssetDiagnostics(
  original: LocatedQuestionBank,
  publishable: LocatedQuestionBank,
  diagnostics: Diagnostic[],
): void {
  const retained = new Set([
    ...publishable.knowledge,
    ...publishable.questions,
    ...publishable.groups,
  ]);
  const excludedKeys = new Set(
    [...original.knowledge, ...original.questions, ...original.groups]
      .filter((entity) => !retained.has(entity))
      .map(({ file, value }) => JSON.stringify([file, value.id])),
  );
  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    const diagnostic = diagnostics[index];
    if (
      diagnostic?.code.startsWith('OQB-ASSET-') &&
      diagnostic.entityId !== undefined &&
      excludedKeys.has(JSON.stringify([diagnostic.file, diagnostic.entityId]))
    ) {
      diagnostics.splice(index, 1);
    }
  }
}
