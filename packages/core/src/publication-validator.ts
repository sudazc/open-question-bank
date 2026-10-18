import type {
  Exam,
  Knowledge,
  Question,
  QuestionGroup,
  ReviewInfo,
  SourceInfo,
} from '@openquestionbank/schema';
import type { Diagnostic, DiagnosticSeverity } from './diagnostics.js';
import type { LocatedEntity, LocatedQuestionBank } from './types.js';

export type ValidationMode = 'draft' | 'strict' | 'release';

const unresolvedAuthorizationValues = new Set([
  'tbd',
  'tbd not for publication',
  'todo',
  'to be determined',
  'unknown',
  'n a',
  '待确认',
  '待定',
  '未确认',
  '未授权',
  '不得发布',
  '暂不发布',
]);

interface PublicationIssue {
  code: string;
  message: string;
  fieldPath: string;
  suggestion: string;
}

/** 按校验模式检查内容发布资格，并在 release 模式裁剪不可发布内容 */
export function applyPublicationPolicy(
  bank: LocatedQuestionBank,
  mode: ValidationMode,
  diagnostics: Diagnostic[],
): LocatedQuestionBank {
  if (mode === 'draft') {
    return bank;
  }

  const severity: DiagnosticSeverity = mode === 'strict' ? 'error' : 'warning';
  const bankLicense = bank.bank?.value.license;
  if (!hasDeclaredAuthorizationValue(bankLicense)) {
    diagnostics.push({
      code: 'OQB-LICENSE-004',
      severity: 'error',
      message: 'Bank.license 不能留空或使用待确认占位值',
      file: bank.bank?.file ?? 'bank.yaml',
      ...(bank.bank === undefined ? {} : { entityId: bank.bank.value.id }),
      fieldPath: 'license',
      suggestion: '确认题库的实际发布许可证；尚未确认时保留 draft 模式',
    });
  }
  const eligibleKnowledge = collectEligible(bank.knowledge, bankLicense, severity, diagnostics);
  const eligibleQuestions = collectEligible(bank.questions, bankLicense, severity, diagnostics);
  const eligibleGroups = collectEligible(bank.groups, bankLicense, severity, diagnostics);

  if (mode === 'strict') {
    return bank;
  }

  return filterReleaseContent(
    bank,
    eligibleKnowledge,
    eligibleQuestions,
    eligibleGroups,
    diagnostics,
  );
}

function collectEligible<T extends { id: string; source: SourceInfo; review: ReviewInfo }>(
  entities: readonly LocatedEntity<T>[],
  bankLicense: string | undefined,
  severity: DiagnosticSeverity,
  diagnostics: Diagnostic[],
): Set<LocatedEntity<T>> {
  const eligible = new Set<LocatedEntity<T>>();
  for (const entity of entities) {
    const issues = getPublicationIssues(entity.value, bankLicense);
    if (issues.length === 0) {
      eligible.add(entity);
      continue;
    }
    for (const issue of issues) {
      diagnostics.push({
        code: issue.code,
        severity,
        message: issue.message,
        file: entity.file,
        entityId: entity.value.id,
        fieldPath: issue.fieldPath,
        suggestion: issue.suggestion,
      });
    }
  }
  return eligible;
}

function getPublicationIssues(
  value: { source: SourceInfo; review: ReviewInfo },
  bankLicense: string | undefined,
): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  if (value.review.status !== 'approved') {
    issues.push({
      code: 'OQB-REVIEW-001',
      message: `审核状态必须为 approved，当前为 ${value.review.status}`,
      fieldPath: 'review.status',
      suggestion: '完成内容审核后再将审核状态设为 approved',
    });
  }
  if (!hasDeclaredAuthorizationValue(bankLicense)) {
    issues.push({
      code: 'OQB-LICENSE-004',
      message: 'Bank.license 未明确声明题库发布许可证',
      fieldPath: 'bank.license',
      suggestion: '在 bank.yaml 中声明题库发布许可证',
    });
  }

  if (value.source.type === 'unknown') {
    issues.push({
      code: 'OQB-LICENSE-001',
      message: '来源类型为 unknown，无法确认发布授权',
      fieldPath: 'source.type',
      suggestion: '确认内容权利来源，并更新 source.type 与授权信息',
    });
  } else if (value.source.type !== 'original') {
    if (!hasDeclaredAuthorizationValue(value.source.license)) {
      issues.push({
        code: 'OQB-LICENSE-002',
        message: '非原创来源必须明确声明来源许可证或授权依据',
        fieldPath: 'source.license',
        suggestion: '填写来源许可证或明确的授权依据，不要仅凭资料公开认定可转载',
      });
    }
    if (!hasDeclaredAuthorizationValue(value.source.attribution)) {
      issues.push({
        code: 'OQB-LICENSE-003',
        message: '非原创来源缺少发布所需的署名信息',
        fieldPath: 'source.attribution',
        suggestion: '填写作者、来源或许可证要求的署名信息',
      });
    }
  }
  return issues;
}

function hasDeclaredAuthorizationValue(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false;
  }
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_.,:;：；/\\-]+/g, ' ');
  return !unresolvedAuthorizationValues.has(normalized);
}

function filterReleaseContent(
  bank: LocatedQuestionBank,
  eligibleKnowledge: Set<LocatedEntity<Knowledge>>,
  eligibleQuestions: Set<LocatedEntity<Question>>,
  eligibleGroups: Set<LocatedEntity<QuestionGroup>>,
  diagnostics: Diagnostic[],
): LocatedQuestionBank {
  const allKnowledgeIds = entityIds(bank.knowledge);
  const allQuestionIds = entityIds(bank.questions);
  const allGroupIds = entityIds(bank.groups);
  const eligibleExams = new Set(bank.exams);
  pruneUnavailableKnowledge(eligibleKnowledge, allKnowledgeIds, diagnostics);
  let changed: boolean;

  do {
    changed = false;
    const retainedKnowledgeIds = entityIds([...eligibleKnowledge]);
    for (const entity of eligibleKnowledge) {
      const unavailableId = firstUnavailableReference(
        [...entity.value.prerequisiteIds, ...entity.value.relatedIds],
        allKnowledgeIds,
        retainedKnowledgeIds,
      );
      if (unavailableId) {
        eligibleKnowledge.delete(entity);
        addDependencyDiagnostic(
          diagnostics,
          entity,
          'OQB-REF-010',
          'prerequisiteIds / relatedIds',
          '知识',
          unavailableId,
        );
        changed = true;
      }
    }

    const retainedKnowledgeIdsAfterPruning = entityIds([...eligibleKnowledge]);
    for (const entity of eligibleQuestions) {
      const unavailableId = firstUnavailableReference(
        entity.value.knowledgeIds,
        allKnowledgeIds,
        retainedKnowledgeIdsAfterPruning,
      );
      if (unavailableId) {
        eligibleQuestions.delete(entity);
        addDependencyDiagnostic(
          diagnostics,
          entity,
          'OQB-REF-010',
          'knowledgeIds',
          '知识',
          unavailableId,
        );
        changed = true;
      }
    }

    const retainedQuestionIds = entityIds([...eligibleQuestions]);
    for (const entity of eligibleGroups) {
      const unavailableId = firstUnavailableReference(
        entity.value.questionIds,
        allQuestionIds,
        retainedQuestionIds,
      );
      if (unavailableId) {
        eligibleGroups.delete(entity);
        addDependencyDiagnostic(
          diagnostics,
          entity,
          'OQB-REF-010',
          'questionIds',
          '题目',
          unavailableId,
        );
        changed = true;
      }
    }

    const retainedQuestionIdsAfterPruning = entityIds([...eligibleQuestions]);
    const retainedGroupIds = entityIds([...eligibleGroups]);
    for (const entity of eligibleExams) {
      const unavailable = firstUnavailableExamReference(
        entity.value,
        allQuestionIds,
        retainedQuestionIdsAfterPruning,
        allGroupIds,
        retainedGroupIds,
      );
      if (unavailable) {
        eligibleExams.delete(entity);
        diagnostics.push({
          code: 'OQB-REF-010',
          severity: 'warning',
          message: `${unavailable.label} ${unavailable.id} 未纳入 release 内容，试卷已一并排除`,
          file: entity.file,
          entityId: entity.value.id,
          fieldPath: unavailable.fieldPath,
          suggestion: '将试卷调整为只引用 release 内容，或先完成相关内容的审核与授权',
        });
        changed = true;
      }
    }
  } while (changed);

  const retainedQuestionIds = entityIds([...eligibleQuestions]);
  for (const entity of bank.groups) {
    if (eligibleGroups.has(entity)) {
      continue;
    }
    const retainedMemberCount = entity.value.questionIds.filter((id) =>
      retainedQuestionIds.has(id),
    ).length;
    if (retainedMemberCount === 0) {
      continue;
    }
    diagnostics.push({
      code: 'OQB-GROUP-004',
      severity: 'warning',
      message: `题组 ${entity.value.id} 未纳入 release，但 ${retainedMemberCount} 道可发布子题将作为独立题目保留，共享材料不会导出`,
      file: entity.file,
      entityId: entity.value.id,
      fieldPath: 'questionIds',
      suggestion:
        '确认这些子题脱离共享材料后仍可独立作答；若依赖材料，请完成题组的审核和授权，或将相关子题一并排除',
    });
  }

  return {
    ...bank,
    knowledge: bank.knowledge.filter((entity) => eligibleKnowledge.has(entity)),
    questions: bank.questions.filter((entity) => eligibleQuestions.has(entity)),
    groups: bank.groups.filter((entity) => eligibleGroups.has(entity)),
    exams: bank.exams.filter((entity) => eligibleExams.has(entity)),
  };
}

function pruneUnavailableKnowledge(
  eligibleKnowledge: Set<LocatedEntity<Knowledge>>,
  allKnowledgeIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): void {
  const retainedKnowledgeIds = entityIds([...eligibleKnowledge]);
  const retainedCounts = countEntityIds([...eligibleKnowledge]);
  const dependentsByKnowledgeId = new Map<string, LocatedEntity<Knowledge>[]>();

  for (const entity of eligibleKnowledge) {
    for (const dependencyId of [...entity.value.prerequisiteIds, ...entity.value.relatedIds]) {
      if (!allKnowledgeIds.has(dependencyId)) {
        continue;
      }
      const dependents = dependentsByKnowledgeId.get(dependencyId);
      if (dependents) {
        dependents.push(entity);
      } else {
        dependentsByKnowledgeId.set(dependencyId, [entity]);
      }
    }
  }

  const pendingIds = [...allKnowledgeIds].filter((id) => !retainedKnowledgeIds.has(id));
  for (let index = 0; index < pendingIds.length; index += 1) {
    const unavailableId = pendingIds[index];
    if (unavailableId === undefined) {
      continue;
    }
    for (const dependent of dependentsByKnowledgeId.get(unavailableId) ?? []) {
      if (!eligibleKnowledge.delete(dependent)) {
        continue;
      }
      const dependentId = dependent.value.id;
      const remainingCount = (retainedCounts.get(dependentId) ?? 1) - 1;
      retainedCounts.set(dependentId, remainingCount);
      if (remainingCount === 0) {
        retainedCounts.delete(dependentId);
        retainedKnowledgeIds.delete(dependentId);
        pendingIds.push(dependentId);
      }
      const firstUnavailableId = firstUnavailableReference(
        [...dependent.value.prerequisiteIds, ...dependent.value.relatedIds],
        allKnowledgeIds,
        retainedKnowledgeIds,
      );
      addDependencyDiagnostic(
        diagnostics,
        dependent,
        'OQB-REF-010',
        'prerequisiteIds / relatedIds',
        '知识',
        firstUnavailableId ?? unavailableId,
      );
    }
  }
}

function firstUnavailableReference(
  references: readonly string[],
  allIds: ReadonlySet<string>,
  retainedIds: ReadonlySet<string>,
): string | undefined {
  return references.find((id) => allIds.has(id) && !retainedIds.has(id));
}

function firstUnavailableExamReference(
  exam: Exam,
  allQuestionIds: ReadonlySet<string>,
  retainedQuestionIds: ReadonlySet<string>,
  allGroupIds: ReadonlySet<string>,
  retainedGroupIds: ReadonlySet<string>,
): { id: string; label: string; fieldPath: string } | undefined {
  if (!('items' in exam)) {
    return undefined;
  }
  for (const [itemIndex, item] of exam.items.entries()) {
    if (item.kind === 'question') {
      if (allQuestionIds.has(item.questionId) && !retainedQuestionIds.has(item.questionId)) {
        return {
          id: item.questionId,
          label: '题目',
          fieldPath: `items[${itemIndex}].questionId`,
        };
      }
      continue;
    }
    if (allGroupIds.has(item.groupId) && !retainedGroupIds.has(item.groupId)) {
      return { id: item.groupId, label: '题组', fieldPath: `items[${itemIndex}].groupId` };
    }
    for (const [questionIndex, question] of item.questions.entries()) {
      if (
        allQuestionIds.has(question.questionId) &&
        !retainedQuestionIds.has(question.questionId)
      ) {
        return {
          id: question.questionId,
          label: '题目',
          fieldPath: `items[${itemIndex}].questions[${questionIndex}].questionId`,
        };
      }
    }
  }
  return undefined;
}

function addDependencyDiagnostic<T extends { id: string }>(
  diagnostics: Diagnostic[],
  entity: LocatedEntity<T>,
  code: string,
  fieldPath: string,
  targetLabel: string,
  targetId: string,
): void {
  diagnostics.push({
    code,
    severity: 'warning',
    message: `引用的${targetLabel} ${targetId} 未纳入 release 内容，实体已一并排除`,
    file: entity.file,
    entityId: entity.value.id,
    fieldPath,
    suggestion: '调整引用关系，或先完成目标内容的审核与授权',
  });
}

function entityIds<T extends { id: string }>(entities: readonly LocatedEntity<T>[]): Set<string> {
  return new Set(entities.map(({ value }) => value.id));
}

function countEntityIds<T extends { id: string }>(
  entities: readonly LocatedEntity<T>[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { value } of entities) {
    counts.set(value.id, (counts.get(value.id) ?? 0) + 1);
  }
  return counts;
}
