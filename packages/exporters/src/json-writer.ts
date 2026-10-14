import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import type { Bank } from '@openquestionbank/schema';
import type { QuestionBankData } from '@openquestionbank/core';
import { createQuestionBankJsonExport, type JsonExportAsset } from './json.js';

const questionBankFilename = 'question-bank.json';
const manifestFilename = 'manifest.json';

interface ExportAssetSource {
  path: string;
  sourcePath: string;
}

export interface WrittenJsonExport {
  manifest: ReturnType<typeof createQuestionBankJsonExport>['manifest'];
  outputDirectory: string;
}

/** 将校验后的题库、引用资源和发布清单写入导出目录 */
export async function writeQuestionBankJsonExport(
  data: QuestionBankData,
  sourceDirectory: string,
  outputDirectory: string,
): Promise<WrittenJsonExport> {
  const bank = data.bank;
  if (!bank) {
    throw new Error('标准 JSON 导出要求存在有效的 Bank 实体');
  }

  const assetSources = await collectExportAssetSources(sourceDirectory, data, bank);
  const outputFiles = [
    { path: questionBankFilename },
    { path: manifestFilename },
    ...assetSources.map(({ path }) => ({ path })),
  ];
  const targetDirectory = await prepareExportDirectory(
    sourceDirectory,
    outputDirectory,
    bank,
    outputFiles,
  );
  const assets = await copyExportAssets(assetSources, targetDirectory);
  const exported = createQuestionBankJsonExport(data, assets);
  for (const file of exported.files) {
    const target = join(targetDirectory, ...file.path.split('/'));
    await prepareExportParent(targetDirectory, file.path);
    try {
      const metadata = await lstat(target);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error(`导出目标不是普通文件：${target}`);
      }
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
    }
    await writeExportFile(target, file.contents);
  }

  return { manifest: exported.manifest, outputDirectory: targetDirectory };
}

async function prepareExportDirectory(
  sourceDirectory: string,
  outputDirectory: string,
  bank: Bank,
  files: readonly { path: string }[],
): Promise<string> {
  const sourceRoot = await realpath(sourceDirectory);
  const targetDirectory = resolve(outputDirectory);
  assertOutputOutsideSourceCollections(sourceRoot, targetDirectory, bank, files);

  try {
    const metadata = await lstat(targetDirectory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`导出目标不是普通目录：${targetDirectory}`);
    }
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
  }

  await mkdir(targetDirectory, { recursive: true });
  const canonicalTarget = await realpath(targetDirectory);
  assertOutputOutsideSourceCollections(sourceRoot, canonicalTarget, bank, files);
  return canonicalTarget;
}

function assertOutputOutsideSourceCollections(
  sourceRoot: string,
  outputDirectory: string,
  bank: Bank,
  files: readonly { path: string }[],
): void {
  for (const [collection, configuredPath] of Object.entries(bank.paths)) {
    const sourceCollection = resolve(sourceRoot, ...configuredPath.split('/'));
    const artifactOverlapsSource = files.some((file) =>
      isPathWithin(sourceCollection, resolve(outputDirectory, ...file.path.split('/'))),
    );
    if (isPathWithin(sourceCollection, outputDirectory) || artifactOverlapsSource) {
      throw new Error(`导出目录不能位于题库源数据目录 paths.${collection} 中：${outputDirectory}`);
    }
  }
}

async function collectExportAssetSources(
  sourceDirectory: string,
  data: QuestionBankData,
  bank: Bank,
): Promise<ExportAssetSource[]> {
  const sourceRoot = await realpath(sourceDirectory);
  const assetsRoot = resolve(sourceRoot, ...bank.paths.assets.split('/'));
  const assetPaths = new Set<string>();
  for (const entity of [...data.knowledge, ...data.questions, ...data.groups]) {
    for (const path of entity.assets ?? []) {
      assetPaths.add(path);
    }
  }

  const assets: ExportAssetSource[] = [];
  for (const path of [...assetPaths].sort(compareStrings)) {
    const sourceFile = resolveSafeRelativePath(sourceRoot, path);
    if (!isPathWithin(assetsRoot, sourceFile)) {
      throw new Error(`资源文件不在 Bank.paths.assets 目录内：${path}`);
    }
    const metadata = await lstat(sourceFile);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`资源文件不是普通文件：${path}`);
    }
    const canonicalFile = await realpath(sourceFile);
    if (!isPathWithin(sourceRoot, canonicalFile) || !isPathWithin(assetsRoot, canonicalFile)) {
      throw new Error(`资源文件路径越出题库资源目录：${path}`);
    }
    assets.push({ path, sourcePath: canonicalFile });
  }
  return assets;
}

async function copyExportAssets(
  sources: readonly ExportAssetSource[],
  outputRoot: string,
): Promise<JsonExportAsset[]> {
  const assets: JsonExportAsset[] = [];
  for (const source of sources) {
    await prepareExportParent(outputRoot, source.path);
    const target = join(outputRoot, ...source.path.split('/'));
    try {
      const metadata = await lstat(target);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error(`导出资源目标不是普通文件：${target}`);
      }
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
    }

    await withTemporaryExportFile(target, (temporary) =>
      copyFile(source.sourcePath, temporary, constants.COPYFILE_EXCL),
    );
    assets.push(await describeExportAsset(source.path, target));
  }
  return assets;
}

async function describeExportAsset(path: string, file: string): Promise<JsonExportAsset> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    sizeBytes += chunk.byteLength;
  }
  return { path, sizeBytes, sha256: hash.digest('hex') };
}

async function prepareExportParent(outputRoot: string, relativePath: string): Promise<void> {
  const directories = relativePath.split('/').slice(0, -1);
  let current = outputRoot;
  for (const segment of directories) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`导出路径包含非普通目录：${current}`);
      }
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
      await mkdir(current);
    }
  }
}

async function writeExportFile(target: string, contents: string): Promise<void> {
  await withTemporaryExportFile(target, (temporary) =>
    writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' }),
  );
}

async function withTemporaryExportFile(
  target: string,
  writeTemporary: (temporary: string) => Promise<void>,
): Promise<void> {
  const temporary = join(dirname(target), `.oqb-export-${randomUUID()}.tmp`);
  try {
    await writeTemporary(temporary);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function resolveSafeRelativePath(root: string, path: string): string {
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
  const target = resolve(root, ...segments);
  if (!isPathWithin(root, target)) {
    throw new Error(`题库资源路径越出题库目录：${path}`);
  }
  return target;
}

function isPathWithin(parent: string, target: string): boolean {
  const pathFromParent = relative(parent, target);
  return (
    pathFromParent === '' ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== '..' &&
      !isAbsolute(pathFromParent))
  );
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
