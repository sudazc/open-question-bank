import type { QuestionBankData } from '@openquestionbank/core';
import {
  collectExportAssetSources,
  copyExportAssets,
  prepareExportDirectory,
  readPreviousExportFiles,
  removeStaleExportFiles,
  writeExportFiles,
} from './export-writer.js';
import {
  createQuestionBankObsidianVaultExport,
  getQuestionBankObsidianVaultFilePaths,
} from './obsidian-vault.js';

export interface WrittenObsidianVaultExport {
  manifest: ReturnType<typeof createQuestionBankObsidianVaultExport>['manifest'];
  outputDirectory: string;
}

/** 将题库渲染为 Obsidian Vault 并写入导出目录 */
export async function writeQuestionBankObsidianVaultExport(
  data: QuestionBankData,
  sourceDirectory: string,
  outputDirectory: string,
): Promise<WrittenObsidianVaultExport> {
  const bank = data.bank;
  if (!bank) {
    throw new Error('Obsidian Vault 导出要求存在有效的 Bank 实体');
  }

  const assetSources = await collectExportAssetSources(sourceDirectory, data, bank);
  const targetDirectory = await prepareExportDirectory(sourceDirectory, outputDirectory, bank, [
    ...getQuestionBankObsidianVaultFilePaths(data),
    ...assetSources.map(({ path }) => path),
  ]);
  const previousFiles = await readPreviousExportFiles(targetDirectory);
  const assets = await copyExportAssets(assetSources, targetDirectory);
  const exported = createQuestionBankObsidianVaultExport(data, assets);
  await writeExportFiles(targetDirectory, exported.files);
  await removeStaleExportFiles(targetDirectory, previousFiles, [
    ...exported.files.map(({ path }) => path),
    ...assetSources.map(({ path }) => path),
  ]);

  return { manifest: exported.manifest, outputDirectory: targetDirectory };
}
