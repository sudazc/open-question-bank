import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Exam, Question, QuestionGroup } from '../packages/schema/src/types.js';
import {
  generateExam,
  parseMarkdownDocument,
  parseYamlDocument,
  validateQuestionBank,
  validateQuestionBankDirectory,
} from '../packages/core/src/index.js';

describe('OpenQuestionBank Core', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'oqb-core-'));
    await writeQuestionBank(rootDir);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('读取 YAML 实体和 Markdown Front Matter 并构建关联索引', async () => {
    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.data.knowledge[0]?.body).toContain('oqb://knowledge/k-two');
    expect(result.index.topicChildren.get('topic-root')?.[0]?.id).toBe('topic-child');
    expect(result.index.questionsByKnowledge.get('k-one')?.map(({ id }) => id)).toEqual(['q-one']);
    expect(result.index.knowledgeByQuestion.get('q-one')?.map(({ id }) => id)).toEqual(['k-one']);
    expect(result.index.questionsByGroup.get('group-reading')?.map(({ id }) => id)).toEqual([
      'q-one',
      'q-two',
    ]);
    expect(result.index.examsByGroup.get('group-reading')?.[0]?.id).toBe('exam-fixed');
  });

  it('draft 模式兼容未审核的内容，strict 模式报告发布资格问题', async () => {
    const draft = await validateQuestionBankDirectory(rootDir);
    const strict = await validateQuestionBankDirectory(rootDir, { mode: 'strict' });

    expect(draft.valid).toBe(true);
    expect(draft.diagnostics).toEqual([]);
    expect(strict.valid).toBe(false);
    expect(strict.data.questions).toHaveLength(2);
    expect(
      strict.diagnostics.some(
        ({ code, severity }) => code === 'OQB-REVIEW-001' && severity === 'error',
      ),
    ).toBe(true);
  });

  it('提示非原创来源缺少或使用无效来源链接，但不阻止草稿校验', async () => {
    await writeFile(
      join(rootDir, 'questions/one.yaml'),
      questionYaml('q-one', 'k-one').replace(
        'source: { type: original }',
        'source: { type: official_public }',
      ),
    );
    await writeFile(
      join(rootDir, 'questions/two.yaml'),
      questionYaml('q-two', 'k-two').replace(
        'source: { type: original }',
        'source: { type: licensed, url: "ftp://example.com/question" }',
      ),
    );

    const result = await validateQuestionBankDirectory(rootDir);
    const sourceDiagnostics = result.diagnostics.filter(({ code }) =>
      code.startsWith('OQB-SOURCE-'),
    );

    expect(result.valid).toBe(true);
    expect(sourceDiagnostics).toMatchObject([
      {
        code: 'OQB-SOURCE-001',
        severity: 'warning',
        entityId: 'q-one',
        fieldPath: 'source.url',
      },
      {
        code: 'OQB-SOURCE-002',
        severity: 'warning',
        entityId: 'q-two',
        fieldPath: 'source.url',
      },
    ]);
  });

  it('release 模式筛除未授权内容及依赖它们的题目、题组和试卷', async () => {
    const firstKnowledge = knowledgeMarkdown('k-one', '', '').replace(
      '正文和引用 [关联知识](oqb://knowledge/)。',
      '正文。',
    );
    await writeFile(
      join(rootDir, 'knowledge/one.md'),
      firstKnowledge.replace('review: { status: draft }', 'review: { status: approved }'),
    );
    await writeFile(
      join(rootDir, 'knowledge/two.md'),
      knowledgeMarkdown('k-two', '', 'k-one')
        .replace('source: { type: original }', 'source: { type: official_public }')
        .replace('tags: [基础]', 'tags: [基础]\nassets: [assets/missing.png]')
        .replace('review: { status: draft }', 'review: { status: approved }'),
    );
    await writeFile(
      join(rootDir, 'questions/one.yaml'),
      questionYaml('q-one', 'k-one').replace(
        'review: { status: draft }',
        'review: { status: approved }',
      ),
    );
    await writeFile(
      join(rootDir, 'questions/two.yaml'),
      questionYaml('q-two', 'k-two').replace(
        'review: { status: draft }',
        'review: { status: approved }',
      ),
    );
    await writeFile(
      join(rootDir, 'groups/reading.yaml'),
      [
        'id: group-reading',
        'title: 阅读材料',
        'passage: 共享材料',
        'questionIds: [q-one, q-two]',
        'topicIds: [topic-child]',
        'source: { type: original }',
        'review: { status: approved }',
      ].join('\n'),
    );

    const result = await validateQuestionBankDirectory(rootDir, { mode: 'release' });
    const codes = result.diagnostics.map(({ code }) => code);

    expect(result.valid).toBe(true);
    expect(result.data.knowledge.map(({ id }) => id)).toEqual(['k-one']);
    expect(result.data.questions.map(({ id }) => id)).toEqual(['q-one']);
    expect(result.data.groups).toEqual([]);
    expect(result.data.exams).toEqual([]);
    expect(codes).toContain('OQB-LICENSE-002');
    expect(codes).toContain('OQB-REF-010');
    expect(result.diagnostics.every(({ severity }) => severity === 'warning')).toBe(true);
  });

  it('release 模式拒绝题库许可证待确认占位值', async () => {
    const bankPath = join(rootDir, 'bank.yaml');
    const bank = await readFile(bankPath, 'utf8');
    await writeFile(
      bankPath,
      bank.replace('license: CC-BY-4.0', 'license: TBD - not for publication'),
    );

    const result = await validateQuestionBankDirectory(rootDir, { mode: 'release' });

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OQB-LICENSE-004',
        severity: 'error',
        file: 'bank.yaml',
        fieldPath: 'license',
      }),
    );
  });

  it('release 过滤通过单次依赖遍历传递移除长知识链', () => {
    const count = 1_000;
    const bank = {
      file: 'bank.yaml',
      value: {
        schemaVersion: '1.0.0',
        id: 'sample-bank',
        name: '通用示例题库',
        version: '1.0.0',
        language: 'zh-CN',
        license: 'CC-BY-4.0',
        maintainers: [{ name: 'OpenQuestionBank' }],
        paths: {
          topics: 'topics',
          knowledge: 'knowledge',
          questions: 'questions',
          groups: 'groups',
          exams: 'exams',
          assets: 'assets',
        },
      },
    };
    const knowledge = Array.from({ length: count }, (_, index) => ({
      file: `knowledge/${index}.md`,
      value: {
        id: `knowledge-${index}`,
        title: `知识 ${index}`,
        body: '知识内容',
        topicIds: [],
        prerequisiteIds: index === 0 ? [] : [`knowledge-${index - 1}`],
        relatedIds: [],
        tags: [],
        source: { type: 'original' as const },
        review: { status: index === 0 ? ('draft' as const) : ('approved' as const) },
      },
    }));

    const result = validateQuestionBank(
      {
        rootDir,
        bank,
        topics: [],
        knowledge,
        questions: [],
        groups: [],
        exams: [],
        diagnostics: [],
      },
      { mode: 'release' },
    );

    expect(result.valid).toBe(true);
    expect(result.data.knowledge).toHaveLength(0);
    expect(result.diagnostics.filter(({ code }) => code === 'OQB-REF-010')).toHaveLength(count - 1);
  });

  it('不把 Markdown 代码中的 oqb URI 当作实际实体引用', async () => {
    const notePath = join(rootDir, 'knowledge/one.md');
    const note = await readFile(notePath, 'utf8');
    await writeFile(
      notePath,
      note.replace(
        '正文和引用 [关联知识](oqb://knowledge/k-two)。',
        [
          '示例 `oqb://question/not-a-question`。',
          '```text',
          'oqb://exam/not-an-exam',
          '```',
          '[关联知识](oqb://knowledge/k-two)。',
        ].join('\n'),
      ),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(true);
    expect(result.diagnostics.map(({ code }) => code)).not.toContain('OQB-REF-003');
  });

  it('校验反斜杠转义反引号外的 Markdown 内部引用', async () => {
    const note = knowledgeMarkdown('k-one', '', '').replace(
      '正文和引用 [关联知识](oqb://knowledge/)。',
      '\\`[失效](oqb://question/missing-question)\\`',
    );
    await writeFile(join(rootDir, 'knowledge/one.md'), note);

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain('OQB-REF-003');
  });

  it('release 模式在筛选后报告正文指向已移除内容的引用', async () => {
    const note = knowledgeMarkdown('k-one', '', '')
      .replace('oqb://knowledge/)。', 'oqb://knowledge/k-two)。')
      .replace('review: { status: draft }', 'review: { status: approved }');
    await writeFile(join(rootDir, 'knowledge/one.md'), note);

    const result = await validateQuestionBankDirectory(rootDir, { mode: 'release' });

    expect(result.valid).toBe(false);
    expect(result.data.knowledge.map(({ id }) => id)).toEqual(['k-one']);
    expect(result.diagnostics.some(({ code }) => code === 'OQB-REF-003')).toBe(true);
  });

  it('报告考点和前置知识循环，以及试卷中的不完整题组', async () => {
    await writeFile(
      join(rootDir, 'topics/root.yaml'),
      'id: topic-root\nname: 根考点\nparentId: topic-child\norder: 0\n',
    );
    await writeFile(
      join(rootDir, 'knowledge/one.md'),
      `${knowledgeMarkdown('k-one', 'k-two', 'k-two')}错误类型引用 [题目](oqb://question/k-two)\n`,
    );
    await writeFile(
      join(rootDir, 'knowledge/two.md'),
      knowledgeMarkdown('k-two', 'k-one', 'k-one'),
    );
    await writeFile(
      join(rootDir, 'exams/fixed.yaml'),
      [
        'id: exam-fixed',
        'title: 固定试卷',
        'mode: fixed',
        'items:',
        '  - kind: group',
        '    groupId: group-reading',
        '    questions:',
        '      - kind: question',
        '        questionId: q-one',
        '        score: 2',
      ].join('\n'),
    );
    await writeFile(
      join(rootDir, 'exams/template.yaml'),
      [
        'id: exam-template',
        'title: 规则组卷模板',
        'mode: generated',
        'kind: template',
        'rules:',
        '  - unit: question',
        '    count: 3',
        '    scorePerQuestion: 1',
        '    filters:',
        '      topicIds: [topic-child]',
        '      questionTypes: [true_false]',
      ].join('\n'),
    );

    const result = await validateQuestionBankDirectory(rootDir);
    const codes = result.diagnostics.map(({ code }) => code);

    expect(result.valid).toBe(false);
    expect(codes).toContain('OQB-TOPIC-001');
    expect(codes).toContain('OQB-KNOWLEDGE-001');
    expect(codes).toContain('OQB-GROUP-003');
    expect(codes).toContain('OQB-REF-003');
    expect(codes).toContain('OQB-EXAM-003');
  });

  it('校验大量多选答案和题组子题引用', () => {
    const itemCount = 5_000;
    const choices = Array.from({ length: itemCount }, (_, index) => ({
      id: `choice-${index}`,
      text: `选项 ${index}`,
    }));
    const choiceQuestion: Question = {
      id: 'q-many-choices',
      type: 'multiple_choice',
      stem: '选择所有正确选项',
      choices,
      answer: { choiceIds: choices.map(({ id }) => id).reverse() },
      topicIds: [],
      knowledgeIds: [],
      difficulty: '入门',
      tags: [],
      score: 1,
      source: { type: 'original' },
      review: { status: 'draft' },
    };
    const groupQuestions: Question[] = Array.from({ length: itemCount }, (_, index) => ({
      id: `q-group-${index}`,
      type: 'true_false',
      stem: `判断题 ${index}`,
      answer: index % 2 === 0,
      topicIds: [],
      knowledgeIds: [],
      difficulty: '入门',
      tags: [],
      score: 1,
      source: { type: 'original' },
      review: { status: 'draft' },
    }));
    const questionIds = groupQuestions.map(({ id }) => id);
    const group: QuestionGroup = {
      id: 'group-large',
      title: '大型材料题组',
      passage: '共享材料',
      questionIds,
      topicIds: [],
      source: { type: 'original' },
      review: { status: 'draft' },
    };
    const exam: Exam = {
      id: 'exam-large-group',
      title: '大型题组试卷',
      mode: 'fixed',
      items: [
        {
          kind: 'group',
          groupId: group.id,
          questions: questionIds.map((questionId) => ({
            kind: 'question',
            questionId,
            score: 1,
          })),
        },
      ],
    };

    const result = validateQuestionBank({
      rootDir,
      topics: [],
      knowledge: [],
      questions: [
        { file: 'questions/choices.yaml', value: choiceQuestion },
        ...groupQuestions.map((value, index) => ({ file: `questions/${index}.yaml`, value })),
      ],
      groups: [{ file: 'groups/large.yaml', value: group }],
      exams: [{ file: 'exams/large.yaml', value: exam }],
      diagnostics: [],
    });

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('按随机种子生成可复现且不重复的题目与完整题组', async () => {
    await writeFile(join(rootDir, 'questions/three.yaml'), questionYaml('q-three', 'k-one'));
    await writeFile(join(rootDir, 'questions/four.yaml'), questionYaml('q-four', 'k-two'));
    await writeFile(
      join(rootDir, 'groups/second.yaml'),
      [
        'id: group-second',
        'title: 第二组材料题',
        'passage: 第二份共享材料',
        'questionIds: [q-three, q-four]',
        'topicIds: [topic-child]',
        'source: { type: original }',
        'review: { status: draft }',
      ].join('\n'),
    );
    await writeFile(
      join(rootDir, 'exams/generated.yaml'),
      [
        'id: exam-generated',
        'title: 规则组卷',
        'mode: generated',
        'kind: template',
        'rules:',
        '  - unit: question',
        '    count: 1',
        '    scorePerQuestion: 2',
        '  - unit: group',
        '    count: 1',
        '    scorePerQuestion: 1',
      ].join('\n'),
    );

    const validated = await validateQuestionBankDirectory(rootDir);
    const first = generateExam(validated.data, 'exam-generated', 'repeatable-seed');
    const second = generateExam(validated.data, 'exam-generated', 'repeatable-seed');

    expect(validated.valid).toBe(true);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      mode: 'generated',
      kind: 'result',
      randomSeed: 'repeatable-seed',
      bankVersion: '1.0.0',
      algorithmVersion: '1.2.0',
      items: [
        { kind: 'question', score: 2 },
        { kind: 'group', questions: [{ score: 1 }, { score: 1 }] },
      ],
    });
    const selectedQuestion = first.items[0];
    const selectedGroup = first.items[1];
    expect(selectedQuestion?.kind).toBe('question');
    expect(selectedGroup?.kind).toBe('group');
    if (selectedQuestion?.kind === 'question' && selectedGroup?.kind === 'group') {
      expect(selectedGroup.questions.map(({ questionId }) => questionId)).not.toContain(
        selectedQuestion.questionId,
      );
    }
  });

  it('对脚本 HTML 和危险链接报错并忽略代码示例', async () => {
    const note = knowledgeMarkdown('k-one', '', '').replace(
      '正文和引用 [关联知识](oqb://knowledge/)。',
      [
        '允许的折叠内容 <details><summary>提示</summary>正文</details>。',
        '[安全链接](https://example.com)',
        '<https://example.com>',
        '[危险链接](javascript:alert(1))',
        '<script>alert(1)</script>',
        '```html',
        '<script>仅作示例</script>',
        '```',
      ].join('\n'),
    );
    await writeFile(join(rootDir, 'knowledge/one.md'), note);

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain('OQB-SECURITY-001');
    expect(result.diagnostics.map(({ code }) => code)).toContain('OQB-SECURITY-002');
  });

  it('不会将反斜杠转义的反引号内容误判为代码示例', async () => {
    const note = knowledgeMarkdown('k-one', '', '').replace(
      '正文和引用 [关联知识](oqb://knowledge/)。',
      '\\`<script>alert(1)</script>\\`',
    );
    await writeFile(join(rootDir, 'knowledge/one.md'), note);

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain('OQB-SECURITY-001');
  });

  it('不会把首个反引号被转义的连续片段误当作代码跨度', async () => {
    const note = knowledgeMarkdown('k-one', '', '').replace(
      '正文和引用 [关联知识](oqb://knowledge/)。',
      String.fromCharCode(92) + '``<script>alert(1)</script>' + String.fromCharCode(92) + '`',
    );
    await writeFile(join(rootDir, 'knowledge/one.md'), note);

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain('OQB-SECURITY-001');
  });

  it('不会把含反引号信息字符串的无效围栏当作代码块', async () => {
    const note = knowledgeMarkdown('k-one', '', '').replace(
      '正文和引用 [关联知识](oqb://knowledge/)。',
      '```bad` info\n<script>alert(1)</script>',
    );
    await writeFile(join(rootDir, 'knowledge/one.md'), note);

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain('OQB-SECURITY-001');
  });

  it('允许波浪号围栏的信息字符串包含反引号', async () => {
    const note = knowledgeMarkdown('k-one', '', '').replace(
      '正文和引用 [关联知识](oqb://knowledge/)。',
      '~~~bad` info\n<script>alert(1)</script>\n~~~',
    );
    await writeFile(join(rootDir, 'knowledge/one.md'), note);

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(true);
  });

  it('继续忽略真正的 Markdown 行内代码示例', async () => {
    const note = knowledgeMarkdown('k-one', '', '').replace(
      '正文和引用 [关联知识](oqb://knowledge/)。',
      '`<script>alert(1)</script>`',
    );
    await writeFile(join(rootDir, 'knowledge/one.md'), note);

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('报告空白题干错误和完全重复题干警告', async () => {
    await writeFile(
      join(rootDir, 'questions/one.yaml'),
      questionYaml('q-one', 'k-one').replace('该陈述 q-one 是否正确？', '"   "'),
    );
    await writeFile(
      join(rootDir, 'questions/two.yaml'),
      questionYaml('q-two', 'k-two').replace('该陈述 q-two 是否正确？', '与题一相同'),
    );
    await writeFile(
      join(rootDir, 'questions/duplicate.yaml'),
      questionYaml('q-duplicate', 'k-one').replace('该陈述 q-duplicate 是否正确？', '与题一相同'),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OQB-QUALITY-001',
        severity: 'error',
        entityId: 'q-one',
        fieldPath: 'stem',
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OQB-QUALITY-002',
        severity: 'warning',
        entityId: 'q-two',
        fieldPath: 'stem',
      }),
    );
  });

  it('报告规范化后重复的选择题选项', async () => {
    await writeFile(
      join(rootDir, 'questions/choices.yaml'),
      questionYaml(
        'q-choices',
        'k-one',
        [
          'choices:',
          '  - { id: choice-a, text: "Choice A" }',
          '  - { id: choice-b, text: "  ＣＨＯＩＣＥ　Ａ " }',
          '  - { id: choice-c, text: "不支持" }',
          'answer: { choiceId: choice-c }',
        ].join('\n'),
      ).replace('type: true_false', 'type: single_choice'),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OQB-QUALITY-003',
        severity: 'warning',
        entityId: 'q-choices',
        fieldPath: 'choices[1].text',
      }),
    );
  });

  it('拒绝只包含空白的许可证、维护者名称、难度和答案内容', async () => {
    const bankPath = join(rootDir, 'bank.yaml');
    const bank = await readFile(bankPath, 'utf8');
    await writeFile(
      bankPath,
      bank
        .replace('license: CC-BY-4.0', 'license: "   "')
        .replace('name: OpenQuestionBank', 'name: "   "'),
    );
    await writeFile(
      join(rootDir, 'questions/one.yaml'),
      questionYaml('q-one', 'k-one').replace('difficulty: 入门', 'difficulty: "   "'),
    );
    await writeFile(
      join(rootDir, 'questions/two.yaml'),
      questionYaml('q-two', 'k-two')
        .replace('type: true_false', 'type: fill_blank')
        .replace(
          'answer: true',
          ['answer:', '  blanks:', '    - id: blank-one', '      acceptedAnswers: ["   "]'].join(
            '\n',
          ),
        ),
    );
    await writeFile(
      join(rootDir, 'questions/short-answer.yaml'),
      questionYaml('q-short', 'k-one')
        .replace('type: true_false', 'type: short_answer')
        .replace(
          'answer: true',
          [
            'answer:',
            '  referenceAnswer: "   "',
            '  rubric:',
            '    - id: criterion-one',
            '      description: "   "',
            '      score: 1',
          ].join('\n'),
        ),
    );

    const draft = await validateQuestionBankDirectory(rootDir);
    const blankFields = draft.diagnostics
      .filter(({ code }) => code === 'OQB-QUALITY-001')
      .map(({ entityId, fieldPath }) => `${entityId}.${fieldPath}`);

    expect(draft.valid).toBe(false);
    expect(blankFields).toEqual(
      expect.arrayContaining([
        'sample-bank.license',
        'sample-bank.maintainers[0].name',
        'q-one.difficulty',
        'q-two.answer.blanks[0].acceptedAnswers[0]',
        'q-short.answer.referenceAnswer',
        'q-short.answer.rubric[0].description',
      ]),
    );

    const strict = await validateQuestionBankDirectory(rootDir, { mode: 'strict' });
    expect(
      strict.diagnostics.filter(({ fieldPath }) => fieldPath === 'license').map(({ code }) => code),
    ).toEqual(['OQB-LICENSE-004']);
  });

  it('生成时报告多条规则之间的候选冲突', async () => {
    await writeFile(
      join(rootDir, 'questions/only-advanced.yaml'),
      questionYaml('q-advanced', 'k-one').replace('difficulty: 入门', 'difficulty: 高级'),
    );
    await writeFile(
      join(rootDir, 'exams/conflict.yaml'),
      [
        'id: exam-conflict',
        'title: 冲突规则',
        'mode: generated',
        'kind: template',
        'rules:',
        '  - unit: question',
        '    count: 1',
        '    scorePerQuestion: 1',
        '    filters: { difficulty: 高级 }',
        '  - unit: question',
        '    count: 1',
        '    scorePerQuestion: 1',
        '    filters: { difficulty: 高级 }',
      ].join('\n'),
    );

    const validated = await validateQuestionBankDirectory(rootDir);

    expect(validated.valid).toBe(true);
    expect(() => generateExam(validated.data, 'exam-conflict', 'repeatable-seed')).toThrow(
      expect.objectContaining({
        code: 'INSUFFICIENT_CANDIDATES',
        ruleIndex: 1,
        requiredCount: 1,
        availableCount: 0,
      }),
    );
  });

  it('先分配候选更紧的规则，避免宽规则随机占用必需题目', async () => {
    await writeFile(
      join(rootDir, 'questions/two.yaml'),
      questionYaml('q-two', 'k-two').replace('difficulty: 入门', 'difficulty: 高级'),
    );
    await writeFile(
      join(rootDir, 'exams/overlap.yaml'),
      [
        'id: exam-overlap',
        'title: 重叠筛选规则',
        'mode: generated',
        'kind: template',
        'rules:',
        '  - unit: question',
        '    count: 1',
        '    scorePerQuestion: 1',
        '  - unit: question',
        '    count: 1',
        '    scorePerQuestion: 1',
        '    filters: { difficulty: 高级 }',
      ].join('\n'),
    );

    const validated = await validateQuestionBankDirectory(rootDir);

    expect(validated.valid).toBe(true);
    const result = generateExam(validated.data, 'exam-overlap', 'seed-1');
    expect(result.items.map((item) => item.kind === 'question' && item.questionId)).toEqual([
      'q-one',
      'q-two',
    ]);
  });

  it('回溯跨规则候选选择，避免随机贪心误报候选不足', async () => {
    const topicIds = ['topic-common', 'topic-rule-0', 'topic-rule-1', 'topic-rule-2'];
    for (const id of topicIds) {
      await writeFile(join(rootDir, `topics/${id}.yaml`), `id: ${id}\nname: ${id}\norder: 0\n`);
    }

    const questionSpecs = [
      { id: 'q-a', topicIds: ['topic-common', 'topic-rule-0'] },
      { id: 'q-x0', topicIds: ['topic-rule-0'] },
      { id: 'q-y0', topicIds: ['topic-rule-0'] },
      { id: 'q-b', topicIds: ['topic-common', 'topic-rule-1'] },
      { id: 'q-x1', topicIds: ['topic-rule-1'] },
      { id: 'q-y1', topicIds: ['topic-rule-1'] },
      { id: 'q-c', topicIds: ['topic-common', 'topic-rule-2'] },
      { id: 'q-x2', topicIds: ['topic-rule-2'] },
      { id: 'q-y2', topicIds: ['topic-rule-2'] },
      { id: 'q-d', topicIds: ['topic-common'] },
      { id: 'q-e', topicIds: ['topic-common'] },
    ];
    for (const { id, topicIds: questionTopicIds } of questionSpecs) {
      await writeFile(
        join(rootDir, `questions/${id}.yaml`),
        questionYaml(id, 'k-one').replace(
          'topicIds: [topic-child]',
          `topicIds: [${questionTopicIds.join(', ')}]`,
        ),
      );
    }
    await writeFile(
      join(rootDir, 'exams/backtracking.yaml'),
      [
        'id: exam-backtracking',
        'title: 重叠候选回溯',
        'mode: generated',
        'kind: template',
        'rules:',
        '  - unit: question',
        '    count: 1',
        '    scorePerQuestion: 1',
        '    filters: { topicIds: [topic-rule-0] }',
        '  - unit: question',
        '    count: 1',
        '    scorePerQuestion: 1',
        '    filters: { topicIds: [topic-rule-1] }',
        '  - unit: question',
        '    count: 1',
        '    scorePerQuestion: 1',
        '    filters: { topicIds: [topic-rule-2] }',
        '  - unit: question',
        '    count: 3',
        '    scorePerQuestion: 1',
        '    filters: { topicIds: [topic-common] }',
      ].join('\n'),
    );

    const validated = await validateQuestionBankDirectory(rootDir);

    expect(validated.valid).toBe(true);
    const result = generateExam(validated.data, 'exam-backtracking', 'seed-18');
    const selectedIds = result.items.flatMap((item) =>
      item.kind === 'question'
        ? [item.questionId]
        : item.questions.map(({ questionId }) => questionId),
    );
    expect(selectedIds).toHaveLength(6);
    expect(new Set(selectedIds).size).toBe(6);
    expect(result.algorithmVersion).toBe('1.2.0');
  });

  it('超出候选组合搜索上限时明确报告搜索未完成', async () => {
    const topicIds = ['topic-first-rule', 'topic-second-rule', 'topic-shared'];
    for (const id of topicIds) {
      await writeFile(join(rootDir, `topics/${id}.yaml`), `id: ${id}\nname: ${id}\norder: 0\n`);
    }

    const questionSpecs = [
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `q-first-${index}`,
        topicIds: ['topic-first-rule'],
      })),
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `q-second-${index}`,
        topicIds: ['topic-second-rule'],
      })),
      ...Array.from({ length: 21 }, (_, index) => ({
        id: `q-shared-${index}`,
        topicIds: ['topic-first-rule', 'topic-second-rule', 'topic-shared'],
      })),
    ];
    for (const { id, topicIds: questionTopicIds } of questionSpecs) {
      await writeFile(
        join(rootDir, `questions/${id}.yaml`),
        questionYaml(id, 'k-one').replace(
          'topicIds: [topic-child]',
          `topicIds: [${questionTopicIds.join(', ')}]`,
        ),
      );
    }
    await writeFile(
      join(rootDir, 'exams/search-limit.yaml'),
      [
        'id: exam-search-limit',
        'title: 搜索上限',
        'mode: generated',
        'kind: template',
        'rules:',
        '  - unit: question',
        '    count: 20',
        '    scorePerQuestion: 1',
        '    filters: { topicIds: [topic-first-rule] }',
        '  - unit: question',
        '    count: 20',
        '    scorePerQuestion: 1',
        '    filters: { topicIds: [topic-second-rule] }',
      ].join('\n'),
    );

    const validated = await validateQuestionBankDirectory(rootDir);

    expect(validated.valid).toBe(true);
    expect(() => generateExam(validated.data, 'exam-search-limit', 'search-limit-seed')).toThrow(
      expect.objectContaining({ code: 'SEARCH_LIMIT_REACHED' }),
    );
  });

  it('以迭代方式校验长考点树和知识前置链', () => {
    const count = 9_000;
    const topics = Array.from({ length: count }, (_, index) => ({
      file: `topics/${index}.yaml`,
      value: {
        id: `topic-${index}`,
        name: `考点 ${index}`,
        order: index,
        ...(index + 1 < count ? { parentId: `topic-${index + 1}` } : {}),
      },
    }));
    const topicResult = validateQuestionBank({
      rootDir,
      topics,
      knowledge: [],
      questions: [],
      groups: [],
      exams: [],
      diagnostics: [],
    });
    expect(topicResult.valid).toBe(true);

    const knowledge = Array.from({ length: count }, (_, index) => ({
      file: `knowledge/${index}.md`,
      value: {
        id: `knowledge-${index}`,
        title: `知识 ${index}`,
        body: '知识内容',
        topicIds: [],
        prerequisiteIds: index === 0 ? [] : [`knowledge-${index - 1}`],
        relatedIds: [],
        tags: [],
        source: { type: 'original' as const },
        review: { status: 'draft' as const },
      },
    }));
    const knowledgeResult = validateQuestionBank({
      rootDir,
      topics: [],
      knowledge,
      questions: [],
      groups: [],
      exams: [],
      diagnostics: [],
    });
    expect(knowledgeResult.valid).toBe(true);
  });

  it('将 Schema 结构错误定位到文件和字段', async () => {
    await writeFile(
      join(rootDir, 'questions/one.yaml'),
      questionYaml('q-one', 'k-one', 'answer: "true"'),
    );

    const result = await validateQuestionBankDirectory(rootDir);
    const diagnostics = result.diagnostics.filter(({ code }) => code === 'OQB-SCHEMA-001');

    expect(result.valid).toBe(false);
    expect(diagnostics.every(({ file }) => file === 'questions/one.yaml')).toBe(true);
    expect(diagnostics.some(({ fieldPath }) => fieldPath === 'answer')).toBe(true);
  });

  it('拒绝危险的 Markdown Front Matter 正文覆盖', () => {
    expect(() =>
      parseMarkdownDocument('---\nid: k-one\ntitle: 标题\nbody: 被覆盖\n---\n正文'),
    ).toThrow('不应设置 body 字段');
  });

  it('拒绝循环 YAML 别名', () => {
    expect(() => parseYamlDocument('loop: &loop\n  self: *loop')).toThrow('循环别名');
  });

  it('达到题库累计输入大小上限后停止继续读取实体', async () => {
    const bankBytes = (await readFile(join(rootDir, 'bank.yaml'))).byteLength;
    const firstTopicBytes = (await readFile(join(rootDir, 'topics/child.yaml'))).byteLength;
    const result = await validateQuestionBankDirectory(rootDir, {
      maxTotalBytes: bankBytes + firstTopicBytes,
    });
    const limitDiagnostic = result.diagnostics.find(({ code }) => code === 'OQB-FILE-016');

    expect(limitDiagnostic?.file).toBe('topics/root.yaml');
    expect(result.data.topics.map(({ id }) => id)).toEqual(['topic-child']);
  });

  it('拒绝无效的题库累计输入大小限制', async () => {
    const result = await validateQuestionBankDirectory(rootDir, { maxTotalBytes: 0 });

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain('OQB-FILE-017');
  });

  it('限制扫描的目录条目数量，包括不参与解析的文件', async () => {
    await writeFile(join(rootDir, 'topics/unrelated.txt'), 'ignored');

    const result = await validateQuestionBankDirectory(rootDir, { maxScannedEntries: 1 });

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OQB-FILE-019',
        severity: 'fatal',
        file: 'topics',
      }),
    );
  });

  it('拒绝无效的目录扫描条目限制', async () => {
    const result = await validateQuestionBankDirectory(rootDir, { maxScannedEntries: -1 });

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain('OQB-FILE-018');
  });
});

async function writeQuestionBank(rootDir: string): Promise<void> {
  for (const directory of ['topics', 'knowledge', 'questions', 'groups', 'exams']) {
    await mkdir(join(rootDir, directory), { recursive: true });
  }
  await writeFile(
    join(rootDir, 'bank.yaml'),
    [
      'schemaVersion: "1.0.0"',
      'id: sample-bank',
      'name: 通用示例题库',
      'version: "1.0.0"',
      'language: zh-CN',
      'license: CC-BY-4.0',
      'maintainers:',
      '  - name: OpenQuestionBank',
      'paths:',
      '  topics: topics',
      '  knowledge: knowledge',
      '  questions: questions',
      '  groups: groups',
      '  exams: exams',
      '  assets: assets',
    ].join('\n'),
  );
  await writeFile(join(rootDir, 'topics/root.yaml'), 'id: topic-root\nname: 根考点\norder: 0\n');
  await writeFile(
    join(rootDir, 'topics/child.yaml'),
    'id: topic-child\nname: 子考点\nparentId: topic-root\norder: 0\n',
  );
  await writeFile(join(rootDir, 'knowledge/one.md'), knowledgeMarkdown('k-one', '', 'k-two'));
  await writeFile(join(rootDir, 'knowledge/two.md'), knowledgeMarkdown('k-two', '', 'k-one'));
  await writeFile(join(rootDir, 'questions/one.yaml'), questionYaml('q-one', 'k-one'));
  await writeFile(join(rootDir, 'questions/two.yaml'), questionYaml('q-two', 'k-two'));
  await writeFile(
    join(rootDir, 'groups/reading.yaml'),
    [
      'id: group-reading',
      'title: 阅读材料',
      'passage: 共享材料',
      'questionIds: [q-one, q-two]',
      'topicIds: [topic-child]',
      'source: { type: original }',
      'review: { status: draft }',
    ].join('\n'),
  );
  await writeFile(
    join(rootDir, 'exams/fixed.yaml'),
    [
      'id: exam-fixed',
      'title: 固定试卷',
      'mode: fixed',
      'items:',
      '  - kind: group',
      '    groupId: group-reading',
      '    questions:',
      '      - kind: question',
      '        questionId: q-one',
      '        score: 2',
      '      - kind: question',
      '        questionId: q-two',
      '        score: 2',
    ].join('\n'),
  );
}

function knowledgeMarkdown(id: string, prerequisiteId: string, relatedId: string): string {
  const prerequisites = prerequisiteId ? `[${prerequisiteId}]` : '[]';
  return [
    '---',
    `id: ${id}`,
    `title: ${id} 知识`,
    'topicIds: [topic-child]',
    `prerequisiteIds: ${prerequisites}`,
    `relatedIds: [${relatedId}]`,
    'tags: [基础]',
    'source: { type: original }',
    'review: { status: draft }',
    '---',
    `正文和引用 [关联知识](oqb://knowledge/${relatedId})。`,
    '',
  ].join('\n');
}

function questionYaml(id: string, knowledgeId: string, answer = 'answer: true'): string {
  return [
    `id: ${id}`,
    'type: true_false',
    `stem: 该陈述 ${id} 是否正确？`,
    answer,
    'topicIds: [topic-child]',
    `knowledgeIds: [${knowledgeId}]`,
    'difficulty: 入门',
    'tags: []',
    'score: 2',
    'source: { type: original }',
    'review: { status: draft }',
  ].join('\n');
}
