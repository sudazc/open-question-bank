import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { QuestionBankData } from '../packages/core/src/types.js';
import {
  createQuestionBankGithubMarkdownExport,
  createQuestionBankJsonExport,
} from '../packages/exporters/src/index.js';
import { bank, exams, knowledge, questions, questionGroup, topic } from './fixtures.js';

const data: QuestionBankData = {
  bank,
  topics: [topic],
  knowledge: [knowledge],
  questions,
  groups: [questionGroup],
  exams,
};
const assetContents = new TextEncoder().encode('<svg/>');
const assets = [
  {
    path: 'assets/triangle.svg',
    sizeBytes: assetContents.byteLength,
    sha256: createHash('sha256').update(assetContents).digest('hex'),
  },
];

describe('OpenQuestionBank JSON 导出器', () => {
  it('生成版本化题库数据和包含统计及 SHA-256 的清单', () => {
    const exported = createQuestionBankJsonExport(data, assets);
    const questionBankFile = exported.files.find(({ path }) => path === 'question-bank.json');
    const fileInfo = exported.manifest.files.find(({ path }) => path === 'question-bank.json');
    const questionBankContents = questionBankFile?.contents;

    expect(questionBankFile).toBeDefined();
    expect(typeof questionBankContents).toBe('string');
    if (typeof questionBankContents !== 'string') {
      throw new Error('question-bank.json 必须是文本文件');
    }
    expect(questionBankContents).toContain('通用题库示例');
    expect(exported.manifest).toMatchObject({
      format: 'openquestionbank-json',
      formatVersion: '1.0.0',
      schemaVersion: '1.0.0',
      bank: { id: bank.id, version: bank.version },
      statistics: {
        entities: { bank: 1, topics: 1, knowledge: 1, questions: 6, groups: 1, exams: 3 },
        totalEntities: 13,
      },
    });
    expect(fileInfo).toBeDefined();
    expect(fileInfo?.sizeBytes).toBe(Buffer.byteLength(questionBankContents, 'utf8'));
    expect(fileInfo?.sha256).toBe(
      createHash('sha256').update(questionBankContents, 'utf8').digest('hex'),
    );
    expect(exported.manifest.files).toContainEqual({
      path: 'assets/triangle.svg',
      sizeBytes: 6,
      sha256: assets[0]?.sha256,
    });
    expect(
      exported.files
        .filter(({ path }) => path.endsWith('.json'))
        .every(({ contents }) => typeof contents === 'string' && contents.endsWith('\n')),
    ).toBe(true);
  });

  it('对实体顺序和对象键顺序变化保持相同输出', () => {
    const reordered = createQuestionBankJsonExport(
      {
        ...data,
        topics: [...data.topics].reverse(),
        knowledge: [...data.knowledge].reverse(),
        questions: [...data.questions].reverse(),
        groups: [...data.groups].reverse(),
        exams: [...data.exams].reverse(),
      },
      assets,
    );

    expect(reordered.files).toEqual(createQuestionBankJsonExport(data, assets).files);
  });

  it('拒绝缺少 Bank 实体的数据', () => {
    const withoutBank: QuestionBankData = { ...data };
    delete withoutBank.bank;

    expect(() => createQuestionBankJsonExport(withoutBank, assets)).toThrow('有效的 Bank 实体');
  });

  it('要求所有题库引用的资源都存在于导出集合中', () => {
    expect(() => createQuestionBankJsonExport(data, [])).toThrow('缺少题库引用的资源文件');
    expect(() =>
      createQuestionBankJsonExport(data, [
        { path: '../outside.svg', sizeBytes: 0, sha256: '0'.repeat(64) },
      ]),
    ).toThrow('资源路径不安全');
  });
});

describe('OpenQuestionBank GitHub Markdown 导出器', () => {
  it('生成可浏览的实体页面、重写内部链接和资源路径，并记录校验值', () => {
    const githubData: QuestionBankData = {
      ...data,
      topics: [...data.topics, { ...topic, id: 'topic:extended', name: '扩展考点' }],
      knowledge: [
        {
          ...knowledge,
          body: [
            '正文引用 [关联题目](oqb://question/question-single-choice)。',
            '![三角形](assets/triangle.svg?view=raw#preview)',
            '`oqb://question/question-single-choice`',
            '```text\noqb://knowledge/knowledge-foundations\n```',
          ].join('\n\n'),
        },
      ],
    };

    const exported = createQuestionBankGithubMarkdownExport(githubData, assets);
    const knowledgeFile = exported.files.find(
      ({ path }) => path === 'knowledge/id-knowledge-foundations.md',
    );
    const knowledgeContents = knowledgeFile?.contents;
    if (typeof knowledgeContents !== 'string') {
      throw new Error('应生成知识笔记 Markdown 页面');
    }

    expect(knowledgeContents).toContain('[关联题目](../questions/id-question-single-choice.md)');
    expect(knowledgeContents).toContain('![三角形](../assets/triangle.svg?view=raw#preview)');
    expect(knowledgeContents).toContain('`oqb://question/question-single-choice`');
    expect(knowledgeContents).toContain('```text\noqb://knowledge/knowledge-foundations\n```');
    expect(exported.files.some(({ path }) => path === 'topics/id-topic~3Aextended.md')).toBe(true);
    expect(
      exported.files.find(({ path }) => path === 'questions/id-question-fill-blank.md')?.contents,
    ).toContain('空白处理：trim');
    expect(
      exported.files.find(({ path }) => path === 'questions/id-question-numeric.md')?.contents,
    ).toContain('单位规则：required');
    expect(
      exported.files.find(({ path }) => path === 'questions/id-question-short-answer.md')?.contents,
    ).toContain('说明主要概念（1 分）');
    expect(exported.manifest).toMatchObject({
      format: 'openquestionbank-github-markdown',
      formatVersion: '1.0.0',
      schemaVersion: '1.0.0',
      bank: { id: bank.id, name: bank.name, version: bank.version },
      statistics: {
        entities: { bank: 1, topics: 2, knowledge: 1, questions: 6, groups: 1, exams: 3 },
        totalEntities: 14,
      },
    });
    expect(exported.manifest.files).toContainEqual({
      path: 'knowledge/id-knowledge-foundations.md',
      sizeBytes: Buffer.byteLength(knowledgeContents, 'utf8'),
      sha256: createHash('sha256').update(knowledgeContents, 'utf8').digest('hex'),
    });
    expect(exported.manifest.files).toContainEqual({
      path: 'assets/triangle.svg',
      sizeBytes: assetContents.byteLength,
      sha256: assets[0]?.sha256,
    });
    expect(exported.files.find(({ path }) => path === 'manifest.json')?.contents).toMatch(/\n$/);
  });

  it('对实体输入顺序变化保持相同输出', () => {
    const reordered = createQuestionBankGithubMarkdownExport(
      {
        ...data,
        topics: [...data.topics].reverse(),
        knowledge: [...data.knowledge].reverse(),
        questions: [...data.questions].reverse(),
        groups: [...data.groups].reverse(),
        exams: [...data.exams].reverse(),
      },
      assets,
    );

    expect(reordered.files).toEqual(createQuestionBankGithubMarkdownExport(data, assets).files);
  });

  it('为保留设备名和超长 ID 生成跨平台安全文件名', () => {
    const longId = `a${':'.repeat(127)}`;
    const exported = createQuestionBankGithubMarkdownExport(
      {
        ...data,
        topics: [...data.topics, { ...topic, id: 'CON' }, { ...topic, id: longId }],
      },
      assets,
    );
    const longIdPath = exported.files.find(({ path }) => path.includes('~b64~'))?.path;

    expect(exported.files.some(({ path }) => path === 'topics/id-CON.md')).toBe(true);
    expect(longIdPath).toBeDefined();
    expect(longIdPath?.split('/').at(-1)?.length).toBeLessThan(255);
  });

  it('拒绝悬空或类型错误的 Markdown 内部引用', () => {
    const broken: QuestionBankData = {
      ...data,
      knowledge: [{ ...knowledge, body: '[失效](oqb://question/missing-question)' }],
    };

    expect(() => createQuestionBankGithubMarkdownExport(broken, assets)).toThrow(
      '导出引用目标不存在或类型不匹配',
    );
  });
});
