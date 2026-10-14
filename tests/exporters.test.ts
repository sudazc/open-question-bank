import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { QuestionBankData } from '../packages/core/src/types.js';
import { createQuestionBankJsonExport } from '../packages/exporters/src/index.js';
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
