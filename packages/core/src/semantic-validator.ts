import type {
  Exam,
  ExamItem,
  Knowledge,
  Question,
  QuestionGroup,
  Topic,
} from '@openquestionbank/schema';
import { decodeMarkdownBackslashEscapes, maskMarkdownCode } from './asset-validator.js';
import type { Diagnostic } from './diagnostics.js';
import { getExamRuleCandidates } from './exam-rules.js';
import { decodeHtmlCharacterReferences } from './html-entities.js';
import type { LocatedEntity, LocatedQuestionBank } from './types.js';

/** 检查结构有效实体之间的引用、树关系、答案关系和组卷关系 */
export function validateSemantics(bank: LocatedQuestionBank, diagnostics: Diagnostic[]): void {
  const topics = uniqueEntityMap(bank.topics, 'Topic', diagnostics);
  const knowledge = uniqueEntityMap(bank.knowledge, 'Knowledge', diagnostics);
  const questions = uniqueEntityMap(bank.questions, 'Question', diagnostics);
  const groups = uniqueEntityMap(bank.groups, 'QuestionGroup', diagnostics);
  const exams = uniqueEntityMap(bank.exams, 'Exam', diagnostics);

  validateSourceUrls(bank, diagnostics);
  validateTopicReferences(bank, topics, knowledge, diagnostics);
  validateKnowledgeReferences(knowledge, diagnostics);
  validateQuestionReferences(topics, knowledge, questions, diagnostics);
  validateQuestionGroupReferences(topics, questions, groups, diagnostics);
  validateExamReferences(bank, questions, groups, exams, diagnostics);
  validateMarkdownReferences(bank, topics, knowledge, questions, exams, diagnostics);
  detectTopicCycles([...topics.values()], topics, diagnostics);
  detectKnowledgePrerequisiteCycles([...knowledge.values()], knowledge, diagnostics);
}

/** 检查非原创来源的链接信息 */
function validateSourceUrls(bank: LocatedQuestionBank, diagnostics: Diagnostic[]): void {
  for (const entity of [...bank.knowledge, ...bank.questions, ...bank.groups]) {
    const source = entity.value.source;
    if (source.url !== undefined) {
      const url = parseHttpUrl(source.url);
      if (
        (url !== undefined && (url.username !== '' || url.password !== '')) ||
        hasUrlAuthorityCredentials(source.url)
      ) {
        diagnostics.push({
          code: 'OQB-SOURCE-003',
          severity: 'error',
          message: '来源 URL 不得包含用户名或密码',
          file: entity.file,
          entityId: entity.value.id,
          fieldPath: 'source.url',
          suggestion: '移除 URL 中的用户名和密码，改用不含访问凭据的来源地址',
        });
      } else if (!url) {
        diagnostics.push({
          code: 'OQB-SOURCE-002',
          severity: 'warning',
          message: '来源链接不是有效的 HTTP 或 HTTPS URL',
          file: entity.file,
          entityId: entity.value.id,
          fieldPath: 'source.url',
          suggestion: '将 source.url 改为完整的 http:// 或 https:// 地址',
        });
      }
      continue;
    }
    if (source.type !== 'original') {
      diagnostics.push({
        code: 'OQB-SOURCE-001',
        severity: 'warning',
        message: '非原创来源缺少来源链接，难以核实题目或资料出处',
        file: entity.file,
        entityId: entity.value.id,
        fieldPath: 'source.url',
        suggestion: '填写可访问来源的完整 HTTP 或 HTTPS URL',
      });
    }
  }
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function hasUrlAuthorityCredentials(value: string): boolean {
  const authority = /^(?:[a-z][a-z\d+.-]*:)?[\\/]{2}([^/?#\\]*)/i.exec(value.trim())?.[1];
  return authority !== undefined && authority.lastIndexOf('@') > 0;
}

type EntityMap<T> = Map<string, LocatedEntity<T>>;

function uniqueEntityMap<T extends { id: string }>(
  entities: readonly LocatedEntity<T>[],
  label: string,
  diagnostics: Diagnostic[],
): EntityMap<T> {
  const result: EntityMap<T> = new Map();
  for (const entity of entities) {
    const existing = result.get(entity.value.id);
    if (existing) {
      diagnostics.push({
        code: 'OQB-REF-002',
        severity: 'error',
        message: `${label} ID 重复：${entity.value.id}`,
        file: entity.file,
        entityId: entity.value.id,
        fieldPath: 'id',
        suggestion: `为每个 ${label} 分配唯一且稳定的 ID`,
      });
    } else {
      result.set(entity.value.id, entity);
    }
  }
  return result;
}

function validateTopicReferences(
  bank: LocatedQuestionBank,
  topics: EntityMap<Topic>,
  knowledge: EntityMap<Knowledge>,
  diagnostics: Diagnostic[],
): void {
  for (const topic of topics.values()) {
    if (topic.value.parentId) {
      checkReference(
        topic.file,
        topic.value.id,
        'parentId',
        topic.value.parentId,
        topics,
        '考点父级',
        diagnostics,
      );
    }
  }
  for (const note of knowledge.values()) {
    checkTopicIds(note.file, note.value.id, 'topicIds', note.value.topicIds, topics, diagnostics);
  }
  for (const exam of bank.exams) {
    const value = exam.value;
    if (!('rules' in value)) {
      continue;
    }
    value.rules.forEach((rule, ruleIndex) => {
      for (const topicId of rule.filters?.topicIds ?? []) {
        checkReference(
          exam.file,
          value.id,
          `rules[${ruleIndex}].filters.topicIds`,
          topicId,
          topics,
          '组卷规则考点',
          diagnostics,
        );
      }
    });
  }
}

function validateKnowledgeReferences(
  knowledge: EntityMap<Knowledge>,
  diagnostics: Diagnostic[],
): void {
  for (const note of knowledge.values()) {
    for (const id of note.value.prerequisiteIds) {
      checkReference(
        note.file,
        note.value.id,
        'prerequisiteIds',
        id,
        knowledge,
        '前置知识',
        diagnostics,
      );
    }
    for (const id of note.value.relatedIds) {
      checkReference(
        note.file,
        note.value.id,
        'relatedIds',
        id,
        knowledge,
        '关联知识',
        diagnostics,
      );
    }
  }
}

function validateQuestionReferences(
  topics: EntityMap<Topic>,
  knowledge: EntityMap<Knowledge>,
  questions: EntityMap<Question>,
  diagnostics: Diagnostic[],
): void {
  for (const question of questions.values()) {
    const value = question.value;
    if (value.type === 'single_choice') {
      validateUniqueNestedIds(
        question.file,
        value.id,
        'choices',
        value.choices.map(({ id }) => id),
        diagnostics,
      );
      const choiceIds = new Set(value.choices.map(({ id }) => id));
      if (!choiceIds.has(value.answer.choiceId)) {
        addDiagnostic(
          diagnostics,
          question.file,
          value.id,
          'OQB-QUESTION-001',
          `答案选项不存在：${value.answer.choiceId}`,
          'answer.choiceId',
          '将答案 ID 设置为 choices 中已定义的选项 ID',
        );
      }
    } else if (value.type === 'multiple_choice') {
      validateUniqueNestedIds(
        question.file,
        value.id,
        'choices',
        value.choices.map(({ id }) => id),
        diagnostics,
      );
      const choiceIds = new Set(value.choices.map(({ id }) => id));
      for (const choiceId of value.answer.choiceIds) {
        if (!choiceIds.has(choiceId)) {
          addDiagnostic(
            diagnostics,
            question.file,
            value.id,
            'OQB-QUESTION-001',
            `答案选项不存在：${choiceId}`,
            'answer.choiceIds',
            '将所有答案 ID 设置为 choices 中已定义的选项 ID',
          );
        }
      }
    } else if (value.type === 'fill_blank') {
      validateUniqueNestedIds(
        question.file,
        value.id,
        'answer.blanks',
        value.answer.blanks.map(({ id }) => id),
        diagnostics,
      );
      validateFillBlankPlaceholders(
        question.file,
        value.id,
        value.stem,
        value.answer.blanks,
        diagnostics,
      );
    } else if (value.type === 'short_answer' && value.answer.rubric) {
      validateUniqueNestedIds(
        question.file,
        value.id,
        'answer.rubric',
        value.answer.rubric.map(({ id }) => id),
        diagnostics,
      );
    } else if (value.type === 'numeric' && value.unitRule?.mode === 'required') {
      if (!value.answer.unit) {
        addDiagnostic(
          diagnostics,
          question.file,
          value.id,
          'OQB-SCORE-001',
          'unitRule.mode 为 required 时必须提供标准答案单位',
          'answer.unit',
          '填写 answer.unit，并按需在 unitRule.acceptedUnits 中声明等价单位',
        );
      } else if (
        value.unitRule.acceptedUnits &&
        !value.unitRule.acceptedUnits.includes(value.answer.unit)
      ) {
        addDiagnostic(
          diagnostics,
          question.file,
          value.id,
          'OQB-SCORE-002',
          'acceptedUnits 必须包含标准答案单位',
          'unitRule.acceptedUnits',
          '将 answer.unit 加入 acceptedUnits，或移除该别名列表',
        );
      }
    }

    for (const topicId of value.topicIds) {
      checkReference(question.file, value.id, 'topicIds', topicId, topics, '题目考点', diagnostics);
    }
    for (const knowledgeId of value.knowledgeIds) {
      checkReference(
        question.file,
        value.id,
        'knowledgeIds',
        knowledgeId,
        knowledge,
        '题目知识点',
        diagnostics,
      );
    }
  }
}

function validateFillBlankPlaceholders(
  file: string,
  questionId: string,
  stem: string,
  blanks: readonly { id: string }[],
  diagnostics: Diagnostic[],
): void {
  const answerBlankIds = new Set(blanks.map(({ id }) => id));
  const placeholderCounts = new Map<string, number>();
  const pattern = /\{\{([^{}\r\n]*)\}\}/g;
  for (const match of maskMarkdownCode(stem).matchAll(pattern)) {
    const id = match[1] ?? '';
    placeholderCounts.set(id, (placeholderCounts.get(id) ?? 0) + 1);
  }

  for (const [id, count] of placeholderCounts) {
    if (!answerBlankIds.has(id)) {
      addDiagnostic(
        diagnostics,
        file,
        questionId,
        'OQB-QUESTION-005',
        `题干中的填空占位符没有对应答案空项：{{${id}}}`,
        'stem',
        '将占位符 ID 与 answer.blanks 中的 ID 对齐',
      );
    }
    if (count > 1) {
      addDiagnostic(
        diagnostics,
        file,
        questionId,
        'OQB-QUESTION-007',
        `题干中的填空占位符重复：{{${id}}}`,
        'stem',
        '确保每个答案空项的占位符在题干中只出现一次',
      );
    }
  }

  blanks.forEach(({ id }, index) => {
    if (!placeholderCounts.has(id)) {
      addDiagnostic(
        diagnostics,
        file,
        questionId,
        'OQB-QUESTION-006',
        `答案空项在题干中没有占位符：${id}`,
        `answer.blanks[${index}].id`,
        `在题干中添加 {{${id}}}`,
      );
    }
  });
}

function validateQuestionGroupReferences(
  topics: EntityMap<Topic>,
  questions: EntityMap<Question>,
  groups: EntityMap<QuestionGroup>,
  diagnostics: Diagnostic[],
): void {
  const membership = new Map<string, LocatedEntity<QuestionGroup>>();
  for (const group of groups.values()) {
    for (const topicId of group.value.topicIds) {
      checkReference(
        group.file,
        group.value.id,
        'topicIds',
        topicId,
        topics,
        '题组考点',
        diagnostics,
      );
    }
    for (const questionId of group.value.questionIds) {
      checkReference(
        group.file,
        group.value.id,
        'questionIds',
        questionId,
        questions,
        '题组子题',
        diagnostics,
      );
      const existingGroup = membership.get(questionId);
      if (existingGroup) {
        addDiagnostic(
          diagnostics,
          group.file,
          group.value.id,
          'OQB-GROUP-001',
          `题目 ${questionId} 已属于题组 ${existingGroup.value.id}`,
          'questionIds',
          'V1 中每道题最多属于一个题组',
        );
      } else {
        membership.set(questionId, group);
      }
    }
  }
}

function validateExamReferences(
  bank: LocatedQuestionBank,
  questions: EntityMap<Question>,
  groups: EntityMap<QuestionGroup>,
  exams: EntityMap<Exam>,
  diagnostics: Diagnostic[],
): void {
  const questionValues = [...questions.values()].map(({ value }) => value);
  const groupValues = [...groups.values()].map(({ value }) => value);
  for (const exam of exams.values()) {
    const value = exam.value;
    if ('items' in value) {
      if (
        bank.bank &&
        value.mode === 'generated' &&
        value.kind === 'result' &&
        value.bankVersion !== bank.bank.value.version
      ) {
        diagnostics.push({
          code: 'OQB-VERSION-001',
          severity: 'warning',
          message: `已生成试卷记录的题库版本 ${value.bankVersion} 与当前题库版本 ${bank.bank.value.version} 不一致`,
          file: exam.file,
          entityId: value.id,
          fieldPath: 'bankVersion',
          suggestion:
            '确认该试卷结果是否仍适用于当前题库；需要当前版本试卷时，可从规则模板重新生成',
        });
      }

      const seenQuestions = new Set<string>();
      const seenGroups = new Set<string>();
      value.items.forEach((item, itemIndex) => {
        validateExamItem(
          exam,
          item,
          itemIndex,
          questions,
          groups,
          seenQuestions,
          seenGroups,
          diagnostics,
        );
      });
      continue;
    }

    value.rules.forEach((rule, ruleIndex) => {
      const matchingCandidates = getExamRuleCandidates(rule, questionValues, groupValues);
      reportInsufficientCandidates(
        exam,
        ruleIndex,
        rule.count,
        matchingCandidates.length,
        rule.unit === 'question' ? '题目' : '题组',
        diagnostics,
      );
    });
  }
}

function validateExamItem(
  exam: LocatedEntity<Exam>,
  item: ExamItem,
  itemIndex: number,
  questions: EntityMap<Question>,
  groups: EntityMap<QuestionGroup>,
  seenQuestions: Set<string>,
  seenGroups: Set<string>,
  diagnostics: Diagnostic[],
): void {
  const field = `items[${itemIndex}]`;
  if (item.kind === 'question') {
    checkReference(
      exam.file,
      exam.value.id,
      `${field}.questionId`,
      item.questionId,
      questions,
      '试卷题目',
      diagnostics,
    );
    if (seenQuestions.has(item.questionId)) {
      addDiagnostic(
        diagnostics,
        exam.file,
        exam.value.id,
        'OQB-EXAM-001',
        `试卷重复选入题目：${item.questionId}`,
        `${field}.questionId`,
        '删除重复题目或替换为其他题目',
      );
    }
    seenQuestions.add(item.questionId);
    return;
  }

  checkReference(
    exam.file,
    exam.value.id,
    `${field}.groupId`,
    item.groupId,
    groups,
    '试卷题组',
    diagnostics,
  );
  if (seenGroups.has(item.groupId)) {
    addDiagnostic(
      diagnostics,
      exam.file,
      exam.value.id,
      'OQB-EXAM-002',
      `试卷重复选入题组：${item.groupId}`,
      `${field}.groupId`,
      '每份试卷只选入一次同一题组',
    );
  }
  seenGroups.add(item.groupId);
  const group = groups.get(item.groupId);
  const groupQuestionIds = new Set(group?.value.questionIds ?? []);
  const includedIds = new Set<string>();
  item.questions.forEach((questionItem, questionIndex) => {
    const questionField = `${field}.questions[${questionIndex}].questionId`;
    checkReference(
      exam.file,
      exam.value.id,
      questionField,
      questionItem.questionId,
      questions,
      '试卷题组子题',
      diagnostics,
    );
    if (!groupQuestionIds.has(questionItem.questionId)) {
      addDiagnostic(
        diagnostics,
        exam.file,
        exam.value.id,
        'OQB-GROUP-002',
        `题目 ${questionItem.questionId} 不属于题组 ${item.groupId}`,
        questionField,
        '仅在题组试卷项中列出该题组的子题',
      );
    }
    if (includedIds.has(questionItem.questionId) || seenQuestions.has(questionItem.questionId)) {
      addDiagnostic(
        diagnostics,
        exam.file,
        exam.value.id,
        'OQB-EXAM-001',
        `试卷重复选入题目：${questionItem.questionId}`,
        questionField,
        '删除重复题目或替换为其他题目',
      );
    }
    includedIds.add(questionItem.questionId);
    seenQuestions.add(questionItem.questionId);
  });
  if (group) {
    const missingIds = group.value.questionIds.filter((id) => !includedIds.has(id));
    if (missingIds.length > 0) {
      addDiagnostic(
        diagnostics,
        exam.file,
        exam.value.id,
        'OQB-GROUP-003',
        `试卷题组项未完整包含子题：${missingIds.join(', ')}`,
        `${field}.questions`,
        '将题组的全部 questionIds 加入 questions，并为每题设置分值',
      );
    }
  }
}

function reportInsufficientCandidates(
  exam: LocatedEntity<Exam>,
  ruleIndex: number,
  requested: number,
  available: number,
  unit: string,
  diagnostics: Diagnostic[],
): void {
  if (available >= requested) {
    return;
  }
  addDiagnostic(
    diagnostics,
    exam.file,
    exam.value.id,
    'OQB-EXAM-003',
    `第 ${ruleIndex + 1} 条规则需要 ${requested} 个${unit}，按当前筛选条件仅有 ${available} 个`,
    `rules[${ruleIndex}]`,
    '补充符合条件的题目或题组，或调整规则数量与筛选条件',
  );
}

function validateMarkdownReferences(
  bank: LocatedQuestionBank,
  topics: EntityMap<Topic>,
  knowledge: EntityMap<Knowledge>,
  questions: EntityMap<Question>,
  exams: EntityMap<Exam>,
  diagnostics: Diagnostic[],
): void {
  const targets = { topic: topics, knowledge, question: questions, exam: exams };
  for (const note of bank.knowledge) {
    checkMarkdownValue(note.file, note.value.id, 'body', note.value.body, targets, diagnostics);
  }
  for (const question of bank.questions) {
    checkMarkdownValue(
      question.file,
      question.value.id,
      'stem',
      question.value.stem,
      targets,
      diagnostics,
    );
    if (question.value.explanation !== undefined) {
      checkMarkdownValue(
        question.file,
        question.value.id,
        'explanation',
        question.value.explanation,
        targets,
        diagnostics,
      );
    }
  }
  for (const group of bank.groups) {
    checkMarkdownValue(
      group.file,
      group.value.id,
      'passage',
      group.value.passage,
      targets,
      diagnostics,
    );
  }
  for (const exam of bank.exams) {
    if (exam.value.description !== undefined) {
      checkMarkdownValue(
        exam.file,
        exam.value.id,
        'description',
        exam.value.description,
        targets,
        diagnostics,
      );
    }
  }
}

type MarkdownTargetKind = 'topic' | 'knowledge' | 'question' | 'exam';

function checkMarkdownValue(
  file: string,
  entityId: string,
  field: string,
  text: string,
  targets: Record<MarkdownTargetKind, ReadonlyMap<string, unknown>>,
  diagnostics: Diagnostic[],
): void {
  const pattern = /\boqb:\/\/([^\s<>"'`)\]]*)/gi;
  const visibleText = decodeHtmlCharacterReferences(
    decodeMarkdownBackslashEscapes(maskMarkdownCode(text)),
  );
  for (const match of visibleText.matchAll(pattern)) {
    const reference = match[1] ?? '';
    const parsedReference =
      /^(topic|knowledge|question|exam)\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/.exec(reference);
    const kind = parsedReference?.[1] as MarkdownTargetKind | undefined;
    const id = parsedReference?.[2];
    if (!kind || !id) {
      addDiagnostic(
        diagnostics,
        file,
        entityId,
        'OQB-REF-004',
        `Markdown 内部引用格式无效：oqb://${reference}`,
        field,
        '使用 oqb://topic/{id}、oqb://knowledge/{id}、oqb://question/{id} 或 oqb://exam/{id}',
      );
      continue;
    }
    if (targets[kind].has(id)) {
      continue;
    }
    addDiagnostic(
      diagnostics,
      file,
      entityId,
      'OQB-REF-003',
      `Markdown 内部引用目标不存在：oqb://${kind}/${id}`,
      field,
      '确认引用中的实体类型与稳定 ID',
    );
  }
}

function detectTopicCycles(
  topics: LocatedEntity<Topic>[],
  topicMap: EntityMap<Topic>,
  diagnostics: Diagnostic[],
): void {
  detectCycles(
    topics,
    topicMap,
    ({ parentId }) => (parentId ? [parentId] : []),
    (topic, cycle) => {
      addDiagnostic(
        diagnostics,
        topic.file,
        topic.value.id,
        'OQB-TOPIC-001',
        `考点父级形成循环：${cycle.join(' → ')}`,
        'parentId',
        '调整 parentId，使每个考点最多沿父级回溯到根节点',
      );
    },
  );
}

function detectKnowledgePrerequisiteCycles(
  notes: LocatedEntity<Knowledge>[],
  noteMap: EntityMap<Knowledge>,
  diagnostics: Diagnostic[],
): void {
  detectCycles(
    notes,
    noteMap,
    ({ prerequisiteIds }) => prerequisiteIds,
    (note, cycle) => {
      addDiagnostic(
        diagnostics,
        note.file,
        note.value.id,
        'OQB-KNOWLEDGE-001',
        `知识前置依赖形成循环：${cycle.join(' → ')}`,
        'prerequisiteIds',
        '调整 prerequisiteIds，使前置知识关系构成有向无环图',
      );
    },
  );
}

interface CycleFrame<T> {
  entity: LocatedEntity<T>;
  dependencies: readonly string[];
  nextIndex: number;
}

function detectCycles<T extends { id: string }>(
  entities: readonly LocatedEntity<T>[],
  entityMap: EntityMap<T>,
  getDependencies: (value: T) => readonly string[],
  reportCycle: (entity: LocatedEntity<T>, cycle: readonly string[]) => void,
): void {
  const state = new Map<string, 'visiting' | 'visited'>();
  const activePath: string[] = [];
  const activePathIndexes = new Map<string, number>();

  for (const entity of entities) {
    if (state.has(entity.value.id)) {
      continue;
    }

    state.set(entity.value.id, 'visiting');
    activePathIndexes.set(entity.value.id, activePath.length);
    activePath.push(entity.value.id);
    const stack: CycleFrame<T>[] = [
      { entity, dependencies: getDependencies(entity.value), nextIndex: 0 },
    ];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) {
        break;
      }
      const dependencyId = frame.dependencies[frame.nextIndex];
      if (dependencyId === undefined) {
        state.set(frame.entity.value.id, 'visited');
        activePathIndexes.delete(frame.entity.value.id);
        activePath.pop();
        stack.pop();
        continue;
      }
      frame.nextIndex += 1;

      const dependency = entityMap.get(dependencyId);
      if (!dependency) {
        continue;
      }
      if (state.get(dependencyId) === 'visiting') {
        const cycleStart = activePathIndexes.get(dependencyId);
        if (cycleStart !== undefined) {
          reportCycle(frame.entity, [...activePath.slice(cycleStart), dependencyId]);
        }
        continue;
      }
      if (state.get(dependencyId) === 'visited') {
        continue;
      }

      state.set(dependencyId, 'visiting');
      activePathIndexes.set(dependencyId, activePath.length);
      activePath.push(dependencyId);
      stack.push({
        entity: dependency,
        dependencies: getDependencies(dependency.value),
        nextIndex: 0,
      });
    }
  }
}

function checkTopicIds(
  file: string,
  entityId: string,
  field: string,
  ids: readonly string[],
  topics: EntityMap<Topic>,
  diagnostics: Diagnostic[],
): void {
  for (const id of ids) {
    checkReference(file, entityId, field, id, topics, '考点', diagnostics);
  }
}

function checkReference<T>(
  file: string,
  entityId: string,
  field: string,
  targetId: string,
  targets: EntityMap<T>,
  label: string,
  diagnostics: Diagnostic[],
): void {
  if (!targets.has(targetId)) {
    addDiagnostic(
      diagnostics,
      file,
      entityId,
      'OQB-REF-001',
      `${label}引用目标不存在：${targetId}`,
      field,
      '确认引用目标的实体类型和 ID，或补充目标实体',
    );
  }
}

function validateUniqueNestedIds(
  file: string,
  entityId: string,
  field: string,
  ids: readonly string[],
  diagnostics: Diagnostic[],
): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      addDiagnostic(
        diagnostics,
        file,
        entityId,
        'OQB-QUESTION-004',
        `嵌套 ID 重复：${id}`,
        `${field}[${index}].id`,
        '为同一实体内的选项、填空或评分项分配唯一 ID',
      );
    } else {
      seen.add(id);
    }
  });
}

function addDiagnostic(
  diagnostics: Diagnostic[],
  file: string,
  entityId: string,
  code: string,
  message: string,
  fieldPath: string,
  suggestion: string,
): void {
  diagnostics.push({
    code,
    severity: 'error',
    message,
    file,
    entityId,
    fieldPath,
    suggestion,
  });
}
