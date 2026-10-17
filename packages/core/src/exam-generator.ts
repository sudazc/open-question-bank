import { createHash } from 'node:crypto';
import type {
  ExamItem,
  GeneratedExamResult,
  GeneratedExamTemplate,
} from '@openquestionbank/schema';
import { getExamRuleCandidates, type ExamRuleCandidate } from './exam-rules.js';
import type { QuestionBankData } from './types.js';

export const examGenerationAlgorithmVersion = '1.0.0' as const;

export type ExamGenerationErrorCode =
  | 'BANK_REQUIRED'
  | 'TEMPLATE_NOT_FOUND'
  | 'EXAM_NOT_TEMPLATE'
  | 'INVALID_RANDOM_SEED'
  | 'INSUFFICIENT_CANDIDATES';

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

  const randomIndex = createRandomIndex(randomSeed);
  const selectedQuestionIds = new Set<string>();
  const selectedGroupIds = new Set<string>();
  const items: ExamItem[] = [];

  exam.rules.forEach((rule, ruleIndex) => {
    const candidates = getExamRuleCandidates(rule, data.questions, data.groups)
      .filter((candidate) => isCandidateAvailable(candidate, selectedQuestionIds, selectedGroupIds))
      .sort(compareCandidateIds);
    if (candidates.length < rule.count) {
      throw new ExamGenerationError(
        'INSUFFICIENT_CANDIDATES',
        `组卷规则 ${ruleIndex + 1} 候选不足：需要 ${rule.count} 个，排除重复题目后仅有 ${candidates.length} 个`,
        ruleIndex,
        rule.count,
        candidates.length,
      );
    }

    for (const candidate of shuffle(candidates, randomIndex).slice(0, rule.count)) {
      if (candidate.unit === 'question') {
        selectedQuestionIds.add(candidate.question.id);
        items.push({
          kind: 'question',
          questionId: candidate.question.id,
          score: rule.scorePerQuestion,
        });
        continue;
      }

      selectedGroupIds.add(candidate.group.id);
      const groupItems = candidate.questions.map(({ id }) => {
        selectedQuestionIds.add(id);
        return { kind: 'question' as const, questionId: id, score: rule.scorePerQuestion };
      });
      items.push({ kind: 'group', groupId: candidate.group.id, questions: groupItems });
    }
  });

  const result: GeneratedExamResult = {
    id: exam.id,
    title: exam.title,
    mode: 'generated',
    kind: 'result',
    items,
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
