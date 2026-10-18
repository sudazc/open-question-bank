import type { Question, QuestionGroup, SelectionRule } from '@openquestionbank/schema';

export type ExamRuleCandidate =
  | { unit: 'question'; id: string; question: Question }
  | { unit: 'group'; id: string; group: QuestionGroup; questions: Question[] };

export const maximumExamRuleEvaluationWork = 1_000_000;

/** 预估单份规则试卷的候选检查量是否处于安全上限内 */
export function estimateExamRuleEvaluationWork(
  rules: readonly SelectionRule[],
  questions: readonly Question[],
  groups: readonly QuestionGroup[],
  maximumWork = maximumExamRuleEvaluationWork,
): number | undefined {
  if (maximumWork === 0) {
    const hasCandidateWork = rules.some((rule) => {
      if (rule.filters?.topicIds?.length === 0) {
        return false;
      }
      return (
        questions.length > 0 ||
        (rule.unit === 'group' && groups.length > 0) ||
        (rule.filters?.topicIds?.length ?? 0) > 0
      );
    });
    return hasCandidateWork ? undefined : 0;
  }

  let hasQuestionTopicFilter = false;
  let hasGroupTopicFilter = false;
  let hasGroupRule = false;
  for (const rule of rules) {
    if (rule.filters?.topicIds?.length === 0) {
      continue;
    }
    if (rule.unit === 'group') {
      hasGroupRule = true;
      hasGroupTopicFilter ||= (rule.filters?.topicIds?.length ?? 0) > 0;
    } else {
      hasQuestionTopicFilter ||= (rule.filters?.topicIds?.length ?? 0) > 0;
    }
  }
  const questionTopicIdCount = hasQuestionTopicFilter
    ? questions.reduce((total, question) => total + question.topicIds.length, 0)
    : 0;
  const groupTopicIdCount = hasGroupTopicFilter
    ? groups.reduce((total, group) => total + group.topicIds.length, 0)
    : 0;
  const groupQuestionIdCount = hasGroupRule
    ? groups.reduce((total, group) => total + group.questionIds.length, 0)
    : 0;
  let totalWork = 0;

  for (const rule of rules) {
    if (rule.filters?.topicIds?.length === 0) {
      continue;
    }
    let ruleWork = questions.length;
    if (rule.unit === 'group') {
      ruleWork += groups.length + groupQuestionIdCount;
    }
    const topicIds = rule.filters?.topicIds;
    if (topicIds && topicIds.length > 0) {
      ruleWork +=
        topicIds.length + (rule.unit === 'question' ? questionTopicIdCount : groupTopicIdCount);
    }
    if (ruleWork > maximumWork - totalWork) {
      return undefined;
    }
    totalWork += ruleWork;
  }
  return totalWork;
}

/** 按组卷规则筛选可用题目或完整题组 */
export function getExamRuleCandidates(
  rule: SelectionRule,
  questions: readonly Question[],
  groups: readonly QuestionGroup[],
): ExamRuleCandidate[] {
  const filters = rule.filters;
  const topicIdSet = filters?.topicIds === undefined ? undefined : new Set(filters.topicIds);
  if (topicIdSet?.size === 0) {
    return [];
  }
  if (rule.unit === 'question') {
    return questions
      .filter((question) => {
        const matchesTopic = !topicIdSet || question.topicIds.some((id) => topicIdSet.has(id));
        const matchesType =
          !filters?.questionTypes || filters.questionTypes.includes(question.type);
        const matchesDifficulty =
          filters?.difficulty === undefined || question.difficulty === filters.difficulty;
        return matchesTopic && matchesType && matchesDifficulty;
      })
      .map((question) => ({ unit: 'question', id: question.id, question }));
  }

  const questionsById = new Map(questions.map((question) => [question.id, question]));
  return groups.flatMap((group) => {
    const matchesTopic = !topicIdSet || group.topicIds.some((id) => topicIdSet.has(id));
    if (!matchesTopic) {
      return [];
    }

    const members = group.questionIds.map((id) => questionsById.get(id));
    if (members.some((question) => question === undefined)) {
      return [];
    }
    const memberQuestions = members.filter(
      (question): question is Question => question !== undefined,
    );
    const matchesType =
      !filters?.questionTypes ||
      memberQuestions.every((question) => filters.questionTypes?.includes(question.type));
    const matchesDifficulty =
      filters?.difficulty === undefined ||
      memberQuestions.every((question) => question.difficulty === filters.difficulty);
    return matchesType && matchesDifficulty
      ? [{ unit: 'group', id: group.id, group, questions: memberQuestions }]
      : [];
  });
}
