import type {
  Bank,
  Exam,
  Knowledge,
  Question,
  QuestionBase,
  QuestionGroup,
  ReviewInfo,
  SourceInfo,
  Topic,
} from '../packages/schema/src/types.js';
import { entitySchemaRefs } from '../packages/schema/src/index.js';

export interface SchemaCase {
  name: string;
  schemaRef: string;
  value: unknown;
}

const source: SourceInfo = { type: 'original' };
const review: ReviewInfo = { status: 'draft' };

export const bank: Bank = {
  schemaVersion: '1.0.0',
  id: 'bank-general',
  name: '通用题库示例',
  version: '1.0.0',
  language: 'zh-CN',
  license: 'CC-BY-4.0',
  maintainers: [{ name: 'OpenQuestionBank 示例维护者' }],
  paths: {
    topics: 'topics',
    knowledge: 'knowledge',
    questions: 'questions',
    groups: 'groups',
    exams: 'exams',
    assets: 'assets',
  },
};

export const topic: Topic = {
  id: 'topic-foundations',
  name: '基础知识',
  order: 0,
};

export const knowledge: Knowledge = {
  id: 'knowledge-foundations',
  title: '基础知识',
  body: '使用 Markdown 编写正文，公式示例：$a^2 + b^2 = c^2$。\n\n![三角形示意图](assets/triangle.svg)',
  topicIds: ['topic-foundations'],
  prerequisiteIds: [],
  relatedIds: [],
  tags: ['基础'],
  assets: ['assets/triangle.svg'],
  source,
  review,
};

const questionBase: QuestionBase = {
  id: 'question-example',
  stem: '以下哪项符合题目要求？',
  explanation: '这是用于 Schema 测试的通用解析。',
  topicIds: ['topic-foundations'],
  knowledgeIds: ['knowledge-foundations'],
  difficulty: '入门',
  tags: [],
  score: 1,
  source,
  review,
};

export const questions: Question[] = [
  {
    ...questionBase,
    id: 'question-single-choice',
    type: 'single_choice',
    choices: [
      { id: 'choice-a', text: '选项 A' },
      { id: 'choice-b', text: '选项 B' },
    ],
    answer: { choiceId: 'choice-a' },
  },
  {
    ...questionBase,
    id: 'question-multiple-choice',
    type: 'multiple_choice',
    choices: [
      { id: 'choice-a', text: '选项 A' },
      { id: 'choice-b', text: '选项 B' },
    ],
    answer: { choiceIds: ['choice-a', 'choice-b'] },
  },
  {
    ...questionBase,
    id: 'question-true-false',
    type: 'true_false',
    answer: true,
  },
  {
    ...questionBase,
    id: 'question-fill-blank',
    stem: '水的化学式是 {{blank-1}}。',
    type: 'fill_blank',
    answer: {
      blanks: [{ id: 'blank-1', acceptedAnswers: ['H2O'] }],
    },
  },
  {
    ...questionBase,
    id: 'question-numeric',
    stem: '计算结果是多少？',
    type: 'numeric',
    answer: { value: '12.5', unit: 'cm' },
    tolerance: { absolute: '0.1', relative: '0' },
    unitRule: { mode: 'required', acceptedUnits: ['cm', 'centimeter'] },
  },
  {
    ...questionBase,
    id: 'question-short-answer',
    stem: '简述该概念。',
    type: 'short_answer',
    answer: {
      referenceAnswer: '参考答案',
      rubric: [{ id: 'criterion-main', description: '说明主要概念', score: 1 }],
    },
  },
];

export const questionGroup: QuestionGroup = {
  id: 'group-example',
  title: '阅读材料',
  passage: '这是共享材料，只在题组中保存一次。',
  questionIds: ['question-single-choice'],
  topicIds: ['topic-foundations'],
  source,
  review,
};

export const exams: Exam[] = [
  {
    id: 'exam-fixed',
    title: '固定试卷',
    mode: 'fixed',
    items: [
      { kind: 'question', questionId: 'question-true-false', score: 1 },
      {
        kind: 'group',
        groupId: 'group-example',
        questions: [{ kind: 'question', questionId: 'question-single-choice', score: 2 }],
      },
    ],
  },
  {
    id: 'exam-template',
    title: '规则组卷模板',
    mode: 'generated',
    kind: 'template',
    rules: [
      {
        unit: 'question',
        count: 2,
        scorePerQuestion: 1,
        filters: { topicIds: ['topic-foundations'], questionTypes: ['single_choice'] },
      },
    ],
  },
  {
    id: 'exam-generated-result',
    title: '已生成试卷',
    mode: 'generated',
    kind: 'result',
    items: [{ kind: 'question', questionId: 'question-single-choice', score: 1 }],
    randomSeed: 'seed-2026-01',
    bankVersion: '1.0.0',
    algorithmVersion: '1.0.0',
  },
];

export const validSamples: SchemaCase[] = [
  { name: 'Bank', schemaRef: entitySchemaRefs.bank, value: bank },
  { name: 'Topic', schemaRef: entitySchemaRefs.topic, value: topic },
  { name: 'Knowledge', schemaRef: entitySchemaRefs.knowledge, value: knowledge },
  ...questions.map((value) => ({
    name: `Question/${value.type}`,
    schemaRef: entitySchemaRefs.question,
    value,
  })),
  { name: 'QuestionGroup', schemaRef: entitySchemaRefs.questionGroup, value: questionGroup },
  ...exams.map((value) => ({
    name: `Exam/${value.mode}${'kind' in value ? `/${value.kind}` : ''}`,
    schemaRef: entitySchemaRefs.exam,
    value,
  })),
];

export const invalidSamples: SchemaCase[] = [
  {
    name: 'Bank invalid SemVer',
    schemaRef: entitySchemaRefs.bank,
    value: { ...bank, version: '1.0' },
  },
  {
    name: 'Bank path traversal',
    schemaRef: entitySchemaRefs.bank,
    value: { ...bank, paths: { ...bank.paths, assets: '../outside' } },
  },
  {
    name: 'Topic negative order',
    schemaRef: entitySchemaRefs.topic,
    value: { ...topic, order: -1 },
  },
  {
    name: 'Topic path-like ID',
    schemaRef: entitySchemaRefs.topic,
    value: { ...topic, id: '../topic' },
  },
  {
    name: 'Knowledge invalid review state',
    schemaRef: entitySchemaRefs.knowledge,
    value: { ...knowledge, review: { status: 'needs_review' } },
  },
  {
    name: 'Knowledge duplicate tags',
    schemaRef: entitySchemaRefs.knowledge,
    value: { ...knowledge, tags: ['重复', '重复'] },
  },
  {
    name: 'Question/single_choice wrong answer shape',
    schemaRef: entitySchemaRefs.question,
    value: { ...questions[0], answer: 'choice-a' },
  },
  {
    name: 'Question/multiple_choice empty answer set',
    schemaRef: entitySchemaRefs.question,
    value: {
      ...questions[1],
      answer: { choiceIds: [] },
    },
  },
  {
    name: 'Question/true_false string answer',
    schemaRef: entitySchemaRefs.question,
    value: { ...questions[2], answer: 'true' },
  },
  {
    name: 'Question/fill_blank empty blanks',
    schemaRef: entitySchemaRefs.question,
    value: { ...questions[3], answer: { blanks: [] } },
  },
  {
    name: 'Question/numeric negative tolerance',
    schemaRef: entitySchemaRefs.question,
    value: { ...questions[4], tolerance: { absolute: '-0.1' } },
  },
  {
    name: 'Question/short_answer empty reference',
    schemaRef: entitySchemaRefs.question,
    value: { ...questions[5], answer: { referenceAnswer: '' } },
  },
  {
    name: 'QuestionGroup empty question list',
    schemaRef: entitySchemaRefs.questionGroup,
    value: { ...questionGroup, questionIds: [] },
  },
  {
    name: 'Exam/fixed negative score',
    schemaRef: entitySchemaRefs.exam,
    value: { ...exams[0], items: [{ kind: 'question', questionId: 'q-1', score: -1 }] },
  },
  {
    name: 'Exam/generated template zero count',
    schemaRef: entitySchemaRefs.exam,
    value: { ...exams[1], rules: [{ unit: 'question', count: 0, scorePerQuestion: 1 }] },
  },
  {
    name: 'Exam/generated result invalid algorithm version',
    schemaRef: entitySchemaRefs.exam,
    value: { ...exams[2], algorithmVersion: 'v1' },
  },
];

export const boundarySamples: SchemaCase[] = [
  {
    name: 'Bank zero SemVer and empty maintainers',
    schemaRef: entitySchemaRefs.bank,
    value: {
      ...bank,
      version: '0.0.0',
      maintainers: [],
      paths: { ...bank.paths, questions: '题目/基础' },
    },
  },
  {
    name: 'Topic zero order and empty aliases',
    schemaRef: entitySchemaRefs.topic,
    value: { ...topic, order: 0, aliases: [] },
  },
  {
    name: 'Knowledge empty body and relations',
    schemaRef: entitySchemaRefs.knowledge,
    value: { ...knowledge, body: '', topicIds: [], prerequisiteIds: [], relatedIds: [], tags: [] },
  },
  {
    name: 'Question/single_choice zero score',
    schemaRef: entitySchemaRefs.question,
    value: { ...questions[0], score: 0 },
  },
  {
    name: 'Question/multiple_choice one correct option',
    schemaRef: entitySchemaRefs.question,
    value: { ...questions[1], answer: { choiceIds: ['choice-a'] }, score: 0 },
  },
  {
    name: 'Question/true_false false answer',
    schemaRef: entitySchemaRefs.question,
    value: { ...questions[2], answer: false, score: 0 },
  },
  {
    name: 'Question/fill_blank exact whitespace mode',
    schemaRef: entitySchemaRefs.question,
    value: {
      ...questions[3],
      score: 0,
      answer: {
        blanks: [
          {
            id: 'blank-1',
            acceptedAnswers: ['0'],
            caseSensitive: true,
            whitespace: 'exact',
          },
        ],
      },
    },
  },
  {
    name: 'Question/numeric negative value and zero tolerance',
    schemaRef: entitySchemaRefs.question,
    value: {
      ...questions[4],
      score: 0,
      answer: { value: '-0.25' },
      tolerance: { absolute: '0', relative: '0' },
    },
  },
  {
    name: 'Question/short_answer zero rubric score',
    schemaRef: entitySchemaRefs.question,
    value: {
      ...questions[5],
      score: 0,
      answer: {
        referenceAnswer: '答案',
        rubric: [{ id: 'criterion-zero', description: '边界评分项', score: 0 }],
      },
    },
  },
  {
    name: 'QuestionGroup empty passage and topics',
    schemaRef: entitySchemaRefs.questionGroup,
    value: { ...questionGroup, passage: '', topicIds: [] },
  },
  {
    name: 'Exam/fixed minimum duration and zero score',
    schemaRef: entitySchemaRefs.exam,
    value: {
      ...exams[0],
      durationMinutes: 1,
      items: [{ kind: 'question', questionId: 'q-1', score: 0 }],
    },
  },
  {
    name: 'Exam/generated template minimum count',
    schemaRef: entitySchemaRefs.exam,
    value: {
      ...exams[1],
      rules: [{ unit: 'question', count: 1, scorePerQuestion: 0 }],
    },
  },
  {
    name: 'Exam/generated result minimum values',
    schemaRef: entitySchemaRefs.exam,
    value: {
      ...exams[2],
      randomSeed: '0',
      bankVersion: '0.0.0',
      algorithmVersion: '0.0.0',
      items: [{ kind: 'question', questionId: 'q-1', score: 0 }],
    },
  },
];
