import type { Question } from '@openquestionbank/schema';

export type QuestionAnswerResponse =
  | { type: 'single_choice'; choiceId: string }
  | { type: 'multiple_choice'; choiceIds: string[] }
  | { type: 'true_false'; value: boolean }
  | { type: 'fill_blank'; valuesByBlankId: Record<string, string> }
  | { type: 'numeric'; value: string; unit?: string }
  | { type: 'short_answer'; value: string };

export type QuestionAnswerEvaluation =
  | {
      status: 'graded';
      isCorrect: boolean;
      earnedScore: number;
      maxScore: number;
    }
  | {
      status: 'manual_review';
      earnedScore: null;
      maxScore: number;
    };

interface DecimalValue {
  coefficient: bigint;
  scale: number;
}

/** 按题目答案规则评分，不保存作答或学习记录 */
export function evaluateQuestionAnswer(
  question: Question,
  response: QuestionAnswerResponse,
): QuestionAnswerEvaluation {
  switch (question.type) {
    case 'single_choice': {
      assertResponseType(response, 'single_choice');
      return createGradedResult(question, response.choiceId === question.answer.choiceId);
    }
    case 'multiple_choice': {
      assertResponseType(response, 'multiple_choice');
      const uniqueResponseIds = new Set(response.choiceIds);
      const correctIds = new Set(question.answer.choiceIds);
      const isCorrect =
        uniqueResponseIds.size === response.choiceIds.length &&
        uniqueResponseIds.size === correctIds.size &&
        [...correctIds].every((choiceId) => uniqueResponseIds.has(choiceId));
      return createGradedResult(question, isCorrect);
    }
    case 'true_false': {
      assertResponseType(response, 'true_false');
      return createGradedResult(question, response.value === question.answer);
    }
    case 'fill_blank': {
      assertResponseType(response, 'fill_blank');
      const values = response.valuesByBlankId;
      const isRecord = typeof values === 'object' && values !== null && !Array.isArray(values);
      const blankIds = new Set(question.answer.blanks.map(({ id }) => id));
      const isCorrect =
        isRecord &&
        Object.keys(values).every((id) => blankIds.has(id)) &&
        question.answer.blanks.every((blank) => {
          const responseValue = values[blank.id];
          if (!Object.hasOwn(values, blank.id) || typeof responseValue !== 'string') {
            return false;
          }
          const actual = normalizeBlankAnswer(
            responseValue,
            blank.caseSensitive ?? false,
            blank.whitespace ?? 'trim',
          );
          return blank.acceptedAnswers.some(
            (accepted) =>
              normalizeBlankAnswer(
                accepted,
                blank.caseSensitive ?? false,
                blank.whitespace ?? 'trim',
              ) === actual,
          );
        });
      return createGradedResult(question, isCorrect);
    }
    case 'numeric': {
      assertResponseType(response, 'numeric');
      const actual = parseDecimal(response.value);
      const expected = requireDecimal(question.answer.value, 'answer.value');
      const absoluteTolerance = requireDecimal(
        question.tolerance?.absolute ?? '0',
        'tolerance.absolute',
      );
      const relativeTolerance = requireDecimal(
        question.tolerance?.relative ?? '0',
        'tolerance.relative',
      );
      const isCorrect =
        actual !== undefined &&
        matchesNumericUnit(question, response.unit) &&
        isWithinTolerance(actual, expected, absoluteTolerance, relativeTolerance);
      return createGradedResult(question, isCorrect);
    }
    case 'short_answer': {
      assertResponseType(response, 'short_answer');
      return { status: 'manual_review', earnedScore: null, maxScore: question.score };
    }
  }
}

function assertResponseType<T extends QuestionAnswerResponse['type']>(
  response: QuestionAnswerResponse,
  type: T,
): asserts response is Extract<QuestionAnswerResponse, { type: T }> {
  if (response.type !== type) {
    throw new TypeError(`作答题型 ${response.type} 与题目题型 ${type} 不匹配`);
  }
}

function createGradedResult(question: Question, isCorrect: boolean): QuestionAnswerEvaluation {
  return {
    status: 'graded',
    isCorrect,
    earnedScore: isCorrect ? question.score : 0,
    maxScore: question.score,
  };
}

/** 按题目的大小写和空白规则标准化填空答案 */
export function normalizeBlankAnswer(
  value: string,
  caseSensitive: boolean,
  whitespace: string,
): string {
  let normalized = value;
  if (whitespace === 'trim') {
    normalized = normalized.trim();
  } else if (whitespace === 'collapse') {
    normalized = normalized.trim().replace(/\s+/gu, ' ');
  }
  return caseSensitive ? normalized : normalized.toLowerCase();
}

function matchesNumericUnit(
  question: Extract<Question, { type: 'numeric' }>,
  responseUnit: string | undefined,
): boolean {
  const rule = question.unitRule;
  if (rule?.mode === 'ignored') {
    return true;
  }

  const acceptedUnits = new Set([
    ...(question.answer.unit === undefined ? [] : [question.answer.unit]),
    ...(rule?.acceptedUnits ?? []),
  ]);
  if (rule?.mode === 'required') {
    return responseUnit !== undefined && acceptedUnits.has(responseUnit);
  }
  if (rule?.mode === 'optional') {
    return responseUnit === undefined || acceptedUnits.has(responseUnit);
  }

  return question.answer.unit === undefined
    ? responseUnit === undefined
    : responseUnit === question.answer.unit;
}

function parseDecimal(value: string): DecimalValue | undefined {
  if (value.length > 128 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    return undefined;
  }

  const negative = value.startsWith('-');
  const unsignedValue = negative ? value.slice(1) : value;
  const [integer = '0', fraction = ''] = unsignedValue.split('.');
  const coefficient = BigInt(integer + fraction) * (negative ? -1n : 1n);
  return { coefficient, scale: fraction.length };
}

function requireDecimal(value: string, field: string): DecimalValue {
  const parsed = parseDecimal(value);
  if (!parsed) {
    throw new TypeError(`题目 ${field} 不是有效的十进制字符串`);
  }
  return parsed;
}

function isWithinTolerance(
  actual: DecimalValue,
  expected: DecimalValue,
  absoluteTolerance: DecimalValue,
  relativeTolerance: DecimalValue,
): boolean {
  const relativeToleranceScale = relativeTolerance.scale + expected.scale;
  const comparisonScale = Math.max(
    actual.scale,
    expected.scale,
    absoluteTolerance.scale,
    relativeToleranceScale,
  );
  const difference = absolute(
    rescale(actual, comparisonScale) - rescale(expected, comparisonScale),
  );
  const absoluteLimit = rescale(absoluteTolerance, comparisonScale);
  const relativeLimit = rescale(
    {
      coefficient: relativeTolerance.coefficient * absolute(expected.coefficient),
      scale: relativeToleranceScale,
    },
    comparisonScale,
  );
  return difference <= absoluteLimit || difference <= relativeLimit;
}

function rescale(value: DecimalValue, scale: number): bigint {
  return value.coefficient * 10n ** BigInt(scale - value.scale);
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
