import type { QuestionBankData } from '@openquestionbank/core';
import {
  collectExportAssetSources,
  copyExportAssets,
  prepareExportDirectory,
  readPreviousExportFiles,
  removeManagedExportPathConflicts,
  writeManagedExportFiles,
  type ExportWriterOptions,
} from './export-writer.js';
import { createQuestionBankJsonExport } from './json.js';

const questionBankFilename = 'question-bank.json';
const manifestFilename = 'manifest.json';

export interface WrittenJsonExport {
  manifest: ReturnType<typeof createQuestionBankJsonExport>['manifest'];
  outputDirectory: string;
}

/** 将校验后的题库、引用资源和发布清单写入导出目录 */
export async function writeQuestionBankJsonExport(
  data: QuestionBankData,
  sourceDirectory: string,
  outputDirectory: string,
  options: ExportWriterOptions = {},
): Promise<WrittenJsonExport> {
  const bank = data.bank;
  if (!bank) {
    throw new Error('标准 JSON 导出要求存在有效的 Bank 实体');
  }

  const assetSources = await collectExportAssetSources(
    sourceDirectory,
    data,
    bank,
    options.maxTotalAssetBytes,
  );
  const currentPaths = [
    questionBankFilename,
    manifestFilename,
    ...assetSources.map(({ path }) => path),
  ];
  const targetDirectory = await prepareExportDirectory(
    sourceDirectory,
    outputDirectory,
    bank,
    currentPaths,
  );
  const previousFiles = await readPreviousExportFiles(targetDirectory);
  await removeManagedExportPathConflicts(targetDirectory, previousFiles, currentPaths);
  const assets = await copyExportAssets(assetSources, targetDirectory);
  const exported = createQuestionBankJsonExport(data, assets);
  await writeManagedExportFiles(targetDirectory, exported.files, previousFiles, currentPaths);

  return { manifest: exported.manifest, outputDirectory: targetDirectory };
}
