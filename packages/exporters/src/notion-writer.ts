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
import { createQuestionBankNotionExport, getQuestionBankNotionFilePaths } from './notion.js';

export interface WrittenNotionExport {
  manifest: ReturnType<typeof createQuestionBankNotionExport>['manifest'];
  outputDirectory: string;
}

/** 将 Notion CSV、Markdown 页面、资源和清单写入导出目录 */
export async function writeQuestionBankNotionExport(
  data: QuestionBankData,
  sourceDirectory: string,
  outputDirectory: string,
  options: ExportWriterOptions = {},
): Promise<WrittenNotionExport> {
  const bank = data.bank;
  if (!bank) {
    throw new Error('Notion 导出要求存在有效的 Bank 实体');
  }

  const assetSources = await collectExportAssetSources(
    sourceDirectory,
    data,
    bank,
    options.maxTotalAssetBytes,
  );
  const currentPaths = [
    ...getQuestionBankNotionFilePaths(data),
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
  const exported = createQuestionBankNotionExport(data, assets);
  await writeManagedExportFiles(targetDirectory, exported.files, previousFiles, currentPaths);

  return { manifest: exported.manifest, outputDirectory: targetDirectory };
}
