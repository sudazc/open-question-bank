import type { Question, QuestionGroup, SelectionRule } from '@openquestionbank/schema';

export type ExamRuleCandidate =
  | { unit: 'question'; id: string; question: Question }
  | { unit: 'group'; id: string; group: QuestionGroup; questions: Question[] };

/** 按组卷规则筛选可用题目或完整题组 */
export function getExamRuleCandidates(
  rule: SelectionRule,
  questions: readonly Question[],
  groups: readonly QuestionGroup[],
): ExamRuleCandidate[] {
  const filters = rule.filters;
  if (rule.unit === 'question') {
    return questions
      .filter((question) => {
        const matchesTopic =
          !filters?.topicIds || filters.topicIds.some((id) => question.topicIds.includes(id));
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
    const matchesTopic =
      !filters?.topicIds || filters.topicIds.some((id) => group.topicIds.includes(id));
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
