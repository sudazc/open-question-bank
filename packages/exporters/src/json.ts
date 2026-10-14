import { createHash } from 'node:crypto';
import type { Bank } from '@openquestionbank/schema';
import type { QuestionBankData } from '@openquestionbank/core';
import { normalizeExportAssets, type ExportAsset } from './export-common.js';

const format = 'openquestionbank-json';
const formatVersion = '1.0.0';
const questionBankFilename = 'question-bank.json';

export interface QuestionBankJsonDocument {
  format: typeof format;
  formatVersion: typeof formatVersion;
  data: QuestionBankData & { bank: Bank };
}

export interface JsonExportFile {
  path: string;
  contents: string;
}

export type JsonExportAsset = ExportAsset;

export interface JsonExportManifest {
  format: typeof format;
  formatVersion: typeof formatVersion;
  schemaVersion: Bank['schemaVersion'];
  bank: {
    id: Bank['id'];
    version: Bank['version'];
  };
  statistics: {
    entities: {
      bank: 1;
      topics: number;
      knowledge: number;
      questions: number;
      groups: number;
      exams: number;
    };
    totalEntities: number;
  };
  files: Array<{
    path: string;
    sizeBytes: number;
    sha256: string;
  }>;
}

export interface JsonExportPackage {
  manifest: JsonExportManifest;
  files: JsonExportFile[];
  assets: JsonExportAsset[];
}

/** 生成包含题库数据、引用资源和发布清单的稳定文件集合 */
export function createQuestionBankJsonExport(
  data: QuestionBankData,
  assets: readonly JsonExportAsset[],
): JsonExportPackage {
  if (!data.bank) {
    throw new Error('标准 JSON 导出要求存在有效的 Bank 实体');
  }

  const normalizedAssets = normalizeExportAssets(data, assets);

  const bank = data.bank;
  const document: QuestionBankJsonDocument = {
    format,
    formatVersion,
    data: {
      bank,
      topics: sortById(data.topics),
      knowledge: sortById(data.knowledge),
      questions: sortById(data.questions),
      groups: sortById(data.groups),
      exams: sortById(data.exams),
    },
  };
  const questionBankContents = stableJson(document);
  const dataFiles: JsonExportFile[] = [
    { path: questionBankFilename, contents: questionBankContents },
  ];
  const entityCounts = {
    bank: 1 as const,
    topics: data.topics.length,
    knowledge: data.knowledge.length,
    questions: data.questions.length,
    groups: data.groups.length,
    exams: data.exams.length,
  };
  const manifest: JsonExportManifest = {
    format,
    formatVersion,
    schemaVersion: bank.schemaVersion,
    bank: { id: bank.id, version: bank.version },
    statistics: {
      entities: entityCounts,
      totalEntities: Object.values(entityCounts).reduce((total, count) => total + count, 0),
    },
    files: [
      ...dataFiles.map(({ path, contents }) => ({
        path,
        sizeBytes: Buffer.byteLength(contents, 'utf8'),
        sha256: createHash('sha256').update(contents, 'utf8').digest('hex'),
      })),
      ...normalizedAssets,
    ].sort((left, right) => compareStrings(left.path, right.path)),
  };

  return {
    manifest,
    files: [...dataFiles, { path: 'manifest.json', contents: stableJson(manifest) }],
    assets: normalizedAssets,
  };
}

function sortById<T extends { id: string }>(entities: T[]): T[] {
  return [...entities].sort((left, right) => compareStrings(left.id, right.id));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(sortObjectKeys(value), null, 2);
  if (serialized === undefined) {
    throw new TypeError('JSON 导出内容无法序列化');
  }
  return `${serialized}\n`;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const entries = Object.entries(value).sort(([left], [right]) => compareStrings(left, right));
  return Object.fromEntries(entries.map(([key, item]) => [key, sortObjectKeys(item)]));
}
