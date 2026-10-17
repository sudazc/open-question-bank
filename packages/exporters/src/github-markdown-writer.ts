import type { QuestionBankData } from '@openquestionbank/core';
import {
  collectExportAssetSources,
  copyExportAssets,
  prepareExportDirectory,
  readPreviousExportFiles,
  removeStaleExportFiles,
  writeExportFiles,
  type ExportWriterOptions,
} from './export-writer.js';
import {
  createQuestionBankGithubMarkdownExport,
  getQuestionBankGithubMarkdownFilePaths,
} from './github-markdown.js';

export interface WrittenGithubMarkdownExport {
  manifest: ReturnType<typeof createQuestionBankGithubMarkdownExport>['manifest'];
  outputDirectory: string;
}

/** 将题库渲染为 GitHub Markdown 页面并写入导出目录 */
export async function writeQuestionBankGithubMarkdownExport(
  data: QuestionBankData,
  sourceDirectory: string,
  outputDirectory: string,
  options: ExportWriterOptions = {},
): Promise<WrittenGithubMarkdownExport> {
  const bank = data.bank;
  if (!bank) {
    throw new Error('GitHub Markdown 导出要求存在有效的 Bank 实体');
  }

  const assetSources = await collectExportAssetSources(
    sourceDirectory,
    data,
    bank,
    options.maxTotalAssetBytes,
  );
  const targetDirectory = await prepareExportDirectory(sourceDirectory, outputDirectory, bank, [
    ...getQuestionBankGithubMarkdownFilePaths(data),
    ...assetSources.map(({ path }) => path),
  ]);
  const previousFiles = await readPreviousExportFiles(targetDirectory);
  const assets = await copyExportAssets(assetSources, targetDirectory);
  const exported = createQuestionBankGithubMarkdownExport(data, assets);
  await writeExportFiles(targetDirectory, exported.files);
  await removeStaleExportFiles(targetDirectory, previousFiles, [
    ...exported.files.map(({ path }) => path),
    ...assetSources.map(({ path }) => path),
  ]);

  return { manifest: exported.manifest, outputDirectory: targetDirectory };
}
