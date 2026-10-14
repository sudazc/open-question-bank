import { createHash } from 'node:crypto';
import { isAbsolute, win32 } from 'node:path';
import type { Bank } from '@openquestionbank/schema';
import type { QuestionBankData } from '@openquestionbank/core';

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

export interface JsonExportAsset {
  path: string;
  sizeBytes: number;
  sha256: string;
}

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

  const assetsByPath = new Map<string, JsonExportAsset>();
  for (const asset of assets) {
    assertSafeAssetPath(asset.path);
    if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 0) {
      throw new Error(`资源文件大小无效：${asset.path}`);
    }
    if (!/^[0-9a-f]{64}$/.test(asset.sha256)) {
      throw new Error(`资源文件 SHA-256 无效：${asset.path}`);
    }
    if (assetsByPath.has(asset.path)) {
      throw new Error(`导出资源路径重复：${asset.path}`);
    }
    assetsByPath.set(asset.path, asset);
  }

  const referencedAssets = collectReferencedAssets(data);
  for (const path of referencedAssets) {
    if (!assetsByPath.has(path)) {
      throw new Error(`缺少题库引用的资源文件：${path}`);
    }
  }
  for (const path of assetsByPath.keys()) {
    if (!referencedAssets.has(path)) {
      throw new Error(`导出资源未被题库实体引用：${path}`);
    }
  }

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
      ...assetsByPath.values(),
    ].sort((left, right) => compareStrings(left.path, right.path)),
  };

  return {
    manifest,
    files: [...dataFiles, { path: 'manifest.json', contents: stableJson(manifest) }],
    assets: [...assetsByPath.values()].sort((left, right) => compareStrings(left.path, right.path)),
  };
}

function collectReferencedAssets(data: QuestionBankData): Set<string> {
  const paths = new Set<string>();
  const entities = [...data.knowledge, ...data.questions, ...data.groups];
  for (const entity of entities) {
    for (const path of entity.assets ?? []) {
      assertSafeAssetPath(path);
      paths.add(path);
    }
  }
  return paths;
}

function assertSafeAssetPath(path: string): void {
  const segments = path.split('/');
  if (
    path.includes('\0') ||
    path.includes(':') ||
    path.includes('\\') ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    segments.length === 0 ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`题库资源路径不安全：${path}`);
  }
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
