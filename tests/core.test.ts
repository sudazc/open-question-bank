import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  generateExam,
  parseMarkdownDocument,
  parseYamlDocument,
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
      algorithmVersion: '1.0.0',
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
