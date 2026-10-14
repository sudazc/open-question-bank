import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateQuestionBankDirectory } from '../packages/core/src/index.js';

describe('Core 资源校验', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'oqb-assets-'));
    await createBank(rootDir);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('检查知识、题目和题组的资源链接、清单与文件', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        ['assets/diagram image.svg', 'assets/handout.pdf'],
        [
          '![图](<assets/diagram%20image.svg?view=full#preview>)',
          '![引用式图][diagram]',
          '[附件](assets/handout.pdf)',
          '[diagram]: <assets/diagram image.svg>',
        ].join('\n'),
      ),
    );
    await writeFile(
      join(rootDir, 'questions/question.yaml'),
      questionYaml('![题目图](assets/question.svg)', ['assets/question.svg']),
    );
    await writeFile(
      join(rootDir, 'groups/group.yaml'),
      groupYaml('![材料图](<assets/group image.svg>)', ['assets/group image.svg']),
    );
    await writeFile(join(rootDir, 'assets/diagram image.svg'), '<svg/>');
    await writeFile(join(rootDir, 'assets/handout.pdf'), 'pdf');
    await writeFile(join(rootDir, 'assets/question.svg'), '<svg/>');
    await writeFile(join(rootDir, 'assets/group image.svg'), '<svg/>');

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('报告未登记、未引用和缺失的资源文件', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        ['assets/orphan.svg'],
        '![已存在](assets/inline.svg) ![缺失](assets/not-found.svg)',
      ),
    );
    await writeFile(
      join(rootDir, 'questions/question.yaml'),
      questionYaml('[跨实体链接](assets/orphan.svg)', []),
    );
    await writeFile(join(rootDir, 'assets/orphan.svg'), '<svg/>');
    await writeFile(join(rootDir, 'assets/inline.svg'), '<svg/>');

    const result = await validateQuestionBankDirectory(rootDir);
    const codes = result.diagnostics.map(({ code }) => code);

    expect(result.valid).toBe(false);
    expect(codes).toContain('OQB-ASSET-002');
    expect(codes).toContain('OQB-ASSET-003');
    expect(codes).toContain('OQB-ASSET-004');
  });

  it('拒绝资源目录之外及路径穿越的资源地址', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        ['assets/../outside.svg'],
        [
          '![越界](assets/%2e%2e/outside.svg)',
          '![绝对路径](C:/outside.svg)',
          '![文件协议](file:///outside.svg)',
        ].join(' '),
      ),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.some(({ code }) => code === 'OQB-ASSET-001')).toBe(true);
  });

  it('忽略外部链接和代码片段中的示例链接', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        [],
        [
          '[外部链接](https://example.com/image.svg)',
          '`![行内示例](assets/inline.svg)`',
          '```md',
          '![代码块示例](assets/fenced.svg)',
          '```',
        ].join('\n'),
      ),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });
});

async function createBank(rootDir: string): Promise<void> {
  for (const directory of ['topics', 'knowledge', 'questions', 'groups', 'exams', 'assets']) {
    await mkdir(join(rootDir, directory), { recursive: true });
  }
  await writeFile(
    join(rootDir, 'bank.yaml'),
    [
      'schemaVersion: "1.0.0"',
      'id: asset-bank',
      'name: 资源测试题库',
      'version: "1.0.0"',
      'language: zh-CN',
      'license: CC-BY-4.0',
      'maintainers: [{ name: OpenQuestionBank }]',
      'paths:',
      '  topics: topics',
      '  knowledge: knowledge',
      '  questions: questions',
      '  groups: groups',
      '  exams: exams',
      '  assets: assets',
    ].join('\n'),
  );
}

function knowledgeMarkdown(assets: string[], body: string): string {
  return [
    '---',
    'id: knowledge-asset',
    'title: 资源测试',
    'topicIds: []',
    'prerequisiteIds: []',
    'relatedIds: []',
    'tags: []',
    'assets: ' + JSON.stringify(assets),
    'source: { type: original }',
    'review: { status: draft }',
    '---',
    body,
  ].join('\n');
}

function questionYaml(stem: string, assets: string[]): string {
  return [
    'id: question-asset',
    'type: true_false',
    'stem: ' + JSON.stringify(stem),
    'answer: true',
    'topicIds: []',
    'knowledgeIds: []',
    'difficulty: 入门',
    'tags: []',
    'score: 1',
    'assets: ' + JSON.stringify(assets),
    'source: { type: original }',
    'review: { status: draft }',
  ].join('\n');
}

function groupYaml(passage: string, assets: string[]): string {
  return [
    'id: group-asset',
    'title: 资源题组',
    'passage: ' + JSON.stringify(passage),
    'questionIds: [question-asset]',
    'topicIds: []',
    'assets: ' + JSON.stringify(assets),
    'source: { type: original }',
    'review: { status: draft }',
  ].join('\n');
}
