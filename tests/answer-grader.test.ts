import { describe, expect, it } from 'vitest';
import type { Question } from '../packages/schema/src/types.js';
import { evaluateQuestionAnswer } from '../packages/core/src/index.js';
import { questions } from './fixtures.js';

function findQuestion<T extends Question['type']>(type: T): Extract<Question, { type: T }> {
  const question = questions.find(
    (candidate): candidate is Extract<Question, { type: T }> => candidate.type === type,
  );
  if (!question) {
    throw new Error(`缺少题型 ${type} 的测试题目`);
  }
  return question;
}

describe('OpenQuestionBank Core 答案评分', () => {
  it('按单选题答案 ID 判分', () => {
    const question = findQuestion('single_choice');

    expect(
      evaluateQuestionAnswer(question, { type: 'single_choice', choiceId: 'choice-a' }),
    ).toMatchObject({ status: 'graded', isCorrect: true, earnedScore: 1, maxScore: 1 });
    expect(
      evaluateQuestionAnswer(question, { type: 'single_choice', choiceId: 'choice-b' }),
    ).toMatchObject({ status: 'graded', isCorrect: false, earnedScore: 0, maxScore: 1 });
  });

  it('多选题按正确选项集合完全匹配且拒绝重复选项', () => {
    const question = findQuestion('multiple_choice');

    expect(
      evaluateQuestionAnswer(question, {
        type: 'multiple_choice',
        choiceIds: ['choice-b', 'choice-a'],
      }),
    ).toMatchObject({ status: 'graded', isCorrect: true, earnedScore: 1 });
    expect(
      evaluateQuestionAnswer(question, {
        type: 'multiple_choice',
        choiceIds: ['choice-a', 'choice-b', 'choice-b'],
      }),
    ).toMatchObject({ status: 'graded', isCorrect: false, earnedScore: 0 });
    expect(
      evaluateQuestionAnswer(question, {
        type: 'multiple_choice',
        choiceIds: ['choice-a'],
      }),
    ).toMatchObject({ isCorrect: false, earnedScore: 0 });
  });

  it('判断题只接受布尔作答', () => {
    const question = findQuestion('true_false');

    expect(evaluateQuestionAnswer(question, { type: 'true_false', value: true })).toMatchObject({
      isCorrect: true,
      earnedScore: 1,
    });
    expect(evaluateQuestionAnswer(question, { type: 'true_false', value: false })).toMatchObject({
      isCorrect: false,
      earnedScore: 0,
    });
  });

  it('填空题应用默认空白和大小写规则，并要求所有空均正确', () => {
    const question = findQuestion('fill_blank');
    const firstBlank = question.answer.blanks[0];
    if (!firstBlank) {
      throw new Error('测试题必须包含填空');
    }
    const normalizedQuestion = {
      ...question,
      answer: {
        blanks: [
          {
            ...firstBlank,
            acceptedAnswers: ['water molecule'],
            whitespace: 'collapse' as const,
            caseSensitive: false,
          },
        ],
      },
    };

    expect(
      evaluateQuestionAnswer(normalizedQuestion, {
        type: 'fill_blank',
        valuesByBlankId: { [firstBlank.id]: ' WATER  \n MOLECULE ' },
      }),
    ).toMatchObject({ isCorrect: true, earnedScore: 1 });

    const caseSensitiveQuestion = {
      ...normalizedQuestion,
      answer: {
        blanks: [{ ...normalizedQuestion.answer.blanks[0]!, caseSensitive: true }],
      },
    };
    expect(
      evaluateQuestionAnswer(caseSensitiveQuestion, {
        type: 'fill_blank',
        valuesByBlankId: { [firstBlank.id]: 'WATER MOLECULE' },
      }),
    ).toMatchObject({ isCorrect: false, earnedScore: 0 });

    const twoBlankQuestion = {
      ...normalizedQuestion,
      answer: {
        blanks: [
          ...normalizedQuestion.answer.blanks,
          { id: 'blank-2', acceptedAnswers: ['silver'] },
        ],
      },
    };
    expect(
      evaluateQuestionAnswer(twoBlankQuestion, {
        type: 'fill_blank',
        valuesByBlankId: { [firstBlank.id]: 'water molecule' },
      }),
    ).toMatchObject({ isCorrect: false, earnedScore: 0 });
  });

  it('数值题使用精确十进制、容差边界和单位规则', () => {
    const question = findQuestion('numeric');
    expect(
      evaluateQuestionAnswer(question, {
        type: 'numeric',
        value: '12.500000000000000000000',
        unit: 'centimeter',
      }),
    ).toMatchObject({ isCorrect: true, earnedScore: 1 });
    expect(
      evaluateQuestionAnswer(question, { type: 'numeric', value: '12.5', unit: 'mm' }),
    ).toMatchObject({ isCorrect: false, earnedScore: 0 });
    expect(
      evaluateQuestionAnswer(question, { type: 'numeric', value: '1e1', unit: 'cm' }),
    ).toMatchObject({ isCorrect: false, earnedScore: 0 });

    const absoluteToleranceQuestion = {
      ...question,
      answer: { value: '0.3', unit: 'cm' },
      tolerance: { absolute: '0.1', relative: '0' },
    };
    expect(
      evaluateQuestionAnswer(absoluteToleranceQuestion, {
        type: 'numeric',
        value: '0.2',
        unit: 'cm',
      }),
    ).toMatchObject({ isCorrect: true });
    expect(
      evaluateQuestionAnswer(absoluteToleranceQuestion, {
        type: 'numeric',
        value: '0.19999',
        unit: 'cm',
      }),
    ).toMatchObject({ isCorrect: false });

    const relativeToleranceQuestion = {
      ...question,
      answer: { value: '1000' },
      tolerance: { absolute: '0', relative: '0.01' },
      unitRule: { mode: 'optional' as const },
    };
    expect(
      evaluateQuestionAnswer(relativeToleranceQuestion, {
        type: 'numeric',
        value: '1010',
      }),
    ).toMatchObject({ isCorrect: true });
    expect(
      evaluateQuestionAnswer(relativeToleranceQuestion, {
        type: 'numeric',
        value: '1010.01',
      }),
    ).toMatchObject({ isCorrect: false });

    const ignoredUnitQuestion = { ...question, unitRule: { mode: 'ignored' as const } };
    expect(
      evaluateQuestionAnswer(ignoredUnitQuestion, {
        type: 'numeric',
        value: '12.5',
        unit: 'any-unit',
      }),
    ).toMatchObject({ isCorrect: true });
  });

  it('简答题交由人工审核，题型不匹配时明确报错', () => {
    const question = findQuestion('short_answer');

    expect(evaluateQuestionAnswer(question, { type: 'short_answer', value: '我的答案' })).toEqual({
      status: 'manual_review',
      earnedScore: null,
      maxScore: 1,
    });
    expect(() => evaluateQuestionAnswer(question, { type: 'true_false', value: true })).toThrow(
      TypeError,
    );
  });
});
