import { createHash } from 'node:crypto';
import type {
  ExamItem,
  GeneratedExamResult,
  GeneratedExamTemplate,
  SelectionRule,
} from '@openquestionbank/schema';
import {
  estimateExamRuleEvaluationWork,
  getExamRuleCandidates,
  maximumExamRuleEvaluationWork,
  type ExamRuleCandidate,
} from './exam-rules.js';
import type { QuestionBankData } from './types.js';

export const examGenerationAlgorithmVersion = '1.2.0' as const;

const maximumExamSearchCombinations = 100_000;
const maximumExamSearchWork = 5_000_000;

interface PlannedRule {
  rule: SelectionRule;
  ruleIndex: number;
  candidates: ExamRuleCandidate[];
}

interface RuleSearchFrame {
  position: number;
  rule: SelectionRule;
  ruleIndex: number;
  candidates: ExamRuleCandidate[];
  combinationIndices: number[];
  selected: ExamRuleCandidate[] | undefined;
}

interface RuleSearchFailure {
  position: number;
  ruleIndex: number;
  requiredCount: number;
  availableCount: number;
}

export type ExamGenerationErrorCode =
  | 'BANK_REQUIRED'
  | 'TEMPLATE_NOT_FOUND'
  | 'EXAM_NOT_TEMPLATE'
  | 'INVALID_RANDOM_SEED'
  | 'INSUFFICIENT_CANDIDATES'
  | 'SEARCH_LIMIT_REACHED'
  | 'RULE_WORK_LIMIT_REACHED';

export class ExamGenerationError extends Error {
  constructor(
    readonly code: ExamGenerationErrorCode,
    message: string,
    readonly ruleIndex?: number,
    readonly requiredCount?: number,
    readonly availableCount?: number,
  ) {
    super(message);
    this.name = 'ExamGenerationError';
  }
}

/** 按模板和随机种子生成可复现的试卷结果 */
export function generateExam(
  data: QuestionBankData,
  templateId: string,
  randomSeed: string,
): GeneratedExamResult {
  if (!data.bank) {
    throw new ExamGenerationError('BANK_REQUIRED', '生成试卷要求题库包含有效的 Bank 实体');
  }
  if (randomSeed.trim().length === 0 || [...randomSeed].length > 128) {
    throw new ExamGenerationError('INVALID_RANDOM_SEED', '随机种子必须为 1 至 128 个非空字符');
  }

  const exam = data.exams.find(({ id }) => id === templateId);
  if (!exam) {
    throw new ExamGenerationError('TEMPLATE_NOT_FOUND', `未找到试卷模板：${templateId}`);
  }
  if (!isGeneratedExamTemplate(exam)) {
    throw new ExamGenerationError('EXAM_NOT_TEMPLATE', `试卷 ${templateId} 不是规则组卷模板`);
  }
  if (estimateExamRuleEvaluationWork(exam.rules, data.questions, data.groups) === undefined) {
    throw new ExamGenerationError(
      'RULE_WORK_LIMIT_REACHED',
      `规则组卷候选检查量超过安全上限 ${maximumExamRuleEvaluationWork} 个工作单位`,
    );
  }

  const randomIndex = createRandomIndex(randomSeed);
  const selectedQuestionIds = new Set<string>();
  const selectedGroupIds = new Set<string>();
  const itemsByRule: ExamItem[][] = exam.rules.map(() => []);
  let searchWork = 0;
  const consumeSearchWork = (work: number): void => {
    if (work > maximumExamSearchWork - searchWork) {
      throw new ExamGenerationError(
        'SEARCH_LIMIT_REACHED',
        `组卷搜索候选检查工作量超过 ${maximumExamSearchWork} 个工作单位，未能确认规则组合是否可行；请缩小规则范围或拆分试卷模板`,
      );
    }
    searchWork += work;
  };
  const plannedRules: PlannedRule[] = exam.rules
    .map((rule, ruleIndex) => ({
      rule,
      ruleIndex,
      candidates: shuffle(
        getExamRuleCandidates(rule, data.questions, data.groups).sort(compareCandidateIds),
        randomIndex,
      ),
    }))
    .sort(
      (left, right) =>
        left.candidates.length - left.rule.count - (right.candidates.length - right.rule.count) ||
        left.ruleIndex - right.ruleIndex,
    );

  let bestFailure: RuleSearchFailure | undefined;
  const recordFailure = (failure: RuleSearchFailure): void => {
    if (
      bestFailure === undefined ||
      failure.position > bestFailure.position ||
      (failure.position === bestFailure.position &&
        failure.availableCount < bestFailure.availableCount)
    ) {
      bestFailure = failure;
    }
  };
  const createSearchFrame = (position: number): RuleSearchFrame | undefined => {
    const plannedRule = plannedRules[position];
    if (!plannedRule) {
      return undefined;
    }

    const candidates: ExamRuleCandidate[] = [];
    for (const candidate of plannedRule.candidates) {
      consumeSearchWork(1 + candidateQuestionCount(candidate));
      if (isCandidateAvailable(candidate, selectedQuestionIds, selectedGroupIds)) {
        candidates.push(candidate);
      }
    }
    if (candidates.length < plannedRule.rule.count) {
      recordFailure({
        position,
        ruleIndex: plannedRule.ruleIndex,
        requiredCount: plannedRule.rule.count,
        availableCount: candidates.length,
      });
      return undefined;
    }

    consumeSearchWork(plannedRule.rule.count);
    return {
      position,
      rule: plannedRule.rule,
      ruleIndex: plannedRule.ruleIndex,
      candidates,
      combinationIndices: Array.from({ length: plannedRule.rule.count }, (_, index) => index),
      selected: undefined,
    };
  };

  const searchFrames: RuleSearchFrame[] = [];
  let searchAttempts = 0;
  let solved = plannedRules.length === 0;
  if (!solved) {
    const firstFrame = createSearchFrame(0);
    if (firstFrame) {
      searchFrames.push(firstFrame);
    }
  }

  while (searchFrames.length > 0) {
    const frame = searchFrames.at(-1);
    if (!frame) {
      break;
    }

    if (frame.selected) {
      consumeSearchWork(candidateSelectionWork(frame.selected, 2));
      for (const candidate of frame.selected) {
        unselectCandidate(candidate, selectedQuestionIds, selectedGroupIds);
      }
      itemsByRule[frame.ruleIndex] = [];
      frame.selected = undefined;
      if (!advanceCombination(frame.combinationIndices, frame.candidates.length)) {
        searchFrames.pop();
        continue;
      }
    }

    searchAttempts += 1;
    if (searchAttempts > maximumExamSearchCombinations) {
      throw new ExamGenerationError(
        'SEARCH_LIMIT_REACHED',
        `组卷搜索超过 ${maximumExamSearchCombinations} 个候选组合，未能确认规则组合是否可行；请缩小规则范围或拆分试卷模板`,
      );
    }

    const selection: ExamRuleCandidate[] = [];
    consumeSearchWork(frame.combinationIndices.length);
    for (const index of frame.combinationIndices) {
      const candidate = frame.candidates[index];
      if (!candidate) {
        throw new Error(`无法读取组卷候选：${index}`);
      }
      selection.push(candidate);
    }

    consumeSearchWork(candidateSelectionWork(selection, 3));
    if (!canSelectCandidates(selection, selectedQuestionIds, selectedGroupIds)) {
      recordFailure({
        position: frame.position,
        ruleIndex: frame.ruleIndex,
        requiredCount: frame.rule.count,
        availableCount: Math.max(0, frame.candidates.length - 1),
      });
      if (!advanceCombination(frame.combinationIndices, frame.candidates.length)) {
        searchFrames.pop();
      }
      continue;
    }

    consumeSearchWork(candidateSelectionWork(selection, 2));
    for (const candidate of selection) {
      selectCandidate(candidate, selectedQuestionIds, selectedGroupIds);
    }
    frame.selected = selection;
    consumeSearchWork(candidateSelectionWork(selection, 2));
    itemsByRule[frame.ruleIndex] = selection.map((candidate) =>
      createExamItem(candidate, frame.rule),
    );

    if (frame.position + 1 === plannedRules.length) {
      solved = true;
      break;
    }

    const nextFrame = createSearchFrame(frame.position + 1);
    if (nextFrame) {
      searchFrames.push(nextFrame);
    }
  }

  if (!solved) {
    const failure = bestFailure ?? {
      ruleIndex: 0,
      requiredCount: 0,
      availableCount: 0,
    };
    throw new ExamGenerationError(
      'INSUFFICIENT_CANDIDATES',
      `组卷规则 ${failure.ruleIndex + 1} 候选不足：需要 ${failure.requiredCount} 个，排除重复题目后仅有 ${failure.availableCount} 个`,
      failure.ruleIndex,
      failure.requiredCount,
      failure.availableCount,
    );
  }

  const result: GeneratedExamResult = {
    id: exam.id,
    title: exam.title,
    mode: 'generated',
    kind: 'result',
    items: itemsByRule.flat(),
    randomSeed,
    bankVersion: data.bank.version,
    algorithmVersion: examGenerationAlgorithmVersion,
    ...(exam.description === undefined ? {} : { description: exam.description }),
    ...(exam.durationMinutes === undefined ? {} : { durationMinutes: exam.durationMinutes }),
    ...(exam.extensions === undefined ? {} : { extensions: exam.extensions }),
  };
  return result;
}

function isGeneratedExamTemplate(
  exam: QuestionBankData['exams'][number],
): exam is GeneratedExamTemplate {
  return 'rules' in exam;
}

function isCandidateAvailable(
  candidate: ExamRuleCandidate,
  selectedQuestionIds: ReadonlySet<string>,
  selectedGroupIds: ReadonlySet<string>,
): boolean {
  if (candidate.unit === 'question') {
    return !selectedQuestionIds.has(candidate.question.id);
  }
  return (
    !selectedGroupIds.has(candidate.group.id) &&
    candidate.questions.every(({ id }) => !selectedQuestionIds.has(id))
  );
}

function candidateQuestionCount(candidate: ExamRuleCandidate): number {
  return candidate.unit === 'group' ? candidate.questions.length : 0;
}

function candidateSelectionWork(
  candidates: readonly ExamRuleCandidate[],
  questionPasses: number,
): number {
  let work = candidates.length;
  for (const candidate of candidates) {
    work += candidateQuestionCount(candidate) * questionPasses;
  }
  return work;
}

function canSelectCandidates(
  candidates: readonly ExamRuleCandidate[],
  selectedQuestionIds: ReadonlySet<string>,
  selectedGroupIds: ReadonlySet<string>,
): boolean {
  const candidateQuestionIds = new Set<string>();
  const candidateGroupIds = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.unit === 'question') {
      if (
        selectedQuestionIds.has(candidate.question.id) ||
        candidateQuestionIds.has(candidate.question.id)
      ) {
        return false;
      }
      candidateQuestionIds.add(candidate.question.id);
      continue;
    }

    if (
      selectedGroupIds.has(candidate.group.id) ||
      candidateGroupIds.has(candidate.group.id) ||
      candidate.questions.some(
        ({ id }) => selectedQuestionIds.has(id) || candidateQuestionIds.has(id),
      )
    ) {
      return false;
    }
    candidateGroupIds.add(candidate.group.id);
    for (const { id } of candidate.questions) {
      candidateQuestionIds.add(id);
    }
  }
  return true;
}

function selectCandidate(
  candidate: ExamRuleCandidate,
  selectedQuestionIds: Set<string>,
  selectedGroupIds: Set<string>,
): void {
  if (candidate.unit === 'question') {
    selectedQuestionIds.add(candidate.question.id);
    return;
  }

  selectedGroupIds.add(candidate.group.id);
  for (const { id } of candidate.questions) {
    selectedQuestionIds.add(id);
  }
}

function unselectCandidate(
  candidate: ExamRuleCandidate,
  selectedQuestionIds: Set<string>,
  selectedGroupIds: Set<string>,
): void {
  if (candidate.unit === 'question') {
    selectedQuestionIds.delete(candidate.question.id);
    return;
  }

  selectedGroupIds.delete(candidate.group.id);
  for (const { id } of candidate.questions) {
    selectedQuestionIds.delete(id);
  }
}

function createExamItem(candidate: ExamRuleCandidate, rule: SelectionRule): ExamItem {
  if (candidate.unit === 'question') {
    return {
      kind: 'question',
      questionId: candidate.question.id,
      score: rule.scorePerQuestion,
    };
  }

  return {
    kind: 'group',
    groupId: candidate.group.id,
    questions: candidate.questions.map(({ id }) => ({
      kind: 'question',
      questionId: id,
      score: rule.scorePerQuestion,
    })),
  };
}

function advanceCombination(indices: number[], candidateCount: number): boolean {
  for (let index = indices.length - 1; index >= 0; index -= 1) {
    const currentIndex = indices[index];
    const maximumIndex = candidateCount - indices.length + index;
    if (currentIndex === undefined || currentIndex >= maximumIndex) {
      continue;
    }
    indices[index] = currentIndex + 1;
    for (let nextIndex = index + 1; nextIndex < indices.length; nextIndex += 1) {
      const previousIndex = indices[nextIndex - 1];
      if (previousIndex === undefined) {
        throw new Error(`无法继续枚举组卷候选组合：${nextIndex}`);
      }
      indices[nextIndex] = previousIndex + 1;
    }
    return true;
  }
  return false;
}

function compareCandidateIds(left: ExamRuleCandidate, right: ExamRuleCandidate): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function shuffle<T>(items: readonly T[], randomIndex: (maximum: number) => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1);
    const current = shuffled[index];
    const targetItem = shuffled[target];
    if (current !== undefined && targetItem !== undefined) {
      shuffled[index] = targetItem;
      shuffled[target] = current;
    }
  }
  return shuffled;
}

function createRandomIndex(seed: string): (maximum: number) => number {
  const seedDigest = createHash('sha256').update(seed, 'utf8').digest();
  let counter = 0;
  let block = Buffer.alloc(0);
  let offset = 0;

  const nextUint32 = (): number => {
    if (offset + 4 > block.length) {
      const counterBytes = Buffer.alloc(4);
      counterBytes.writeUInt32BE(counter);
      counter += 1;
      block = createHash('sha256').update(seedDigest).update(counterBytes).digest();
      offset = 0;
    }
    const value = block.readUInt32BE(offset);
    offset += 4;
    return value;
  };

  return (maximum) => {
    const range = 0x1_0000_0000;
    const limit = Math.floor(range / maximum) * maximum;
    let value = nextUint32();
    while (value >= limit) {
      value = nextUint32();
    }
    return value % maximum;
  };
}
