import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Bank } from '@openquestionbank/schema';
import type { QuestionBankData } from '@openquestionbank/core';
import {
  assertSafeExportPath,
  collectReferencedAssets,
  type ExportAsset,
} from './export-common.js';

export interface ExportAssetSource {
  path: string;
  sourcePath: string;
}

export interface ExportFile {
  path: string;
  contents: string;
}

/** 收集并校验题库声明的资源文件 */
export async function collectExportAssetSources(
  sourceDirectory: string,
  data: QuestionBankData,
  bank: Bank,
): Promise<ExportAssetSource[]> {
  const sourceRoot = await realpath(sourceDirectory);
  const assetsRoot = resolve(sourceRoot, ...bank.paths.assets.split('/'));
  const assets: ExportAssetSource[] = [];
  for (const path of [...collectReferencedAssets(data)].sort(compareStrings)) {
    assertSafeExportPath(path, '题库资源路径');
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

/** 准备不与题库源数据目录冲突的导出目录 */
export async function prepareExportDirectory(
  sourceDirectory: string,
  outputDirectory: string,
  bank: Bank,
  outputPaths: readonly string[],
): Promise<string> {
  const paths = [...outputPaths];
  const seenPaths = new Set<string>();
  for (const path of paths) {
    assertSafeExportPath(path);
    if (seenPaths.has(path)) {
      throw new Error(`导出文件路径重复：${path}`);
    }
    seenPaths.add(path);
  }

  const sourceRoot = await realpath(sourceDirectory);
  const targetDirectory = resolve(outputDirectory);
  if (isPathWithin(sourceRoot, targetDirectory) && isPathWithin(targetDirectory, sourceRoot)) {
    throw new Error(`导出目录不能与题库根目录相同：${targetDirectory}`);
  }
  assertOutputOutsideSourceCollections(sourceRoot, targetDirectory, bank, paths);

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
  assertOutputOutsideSourceCollections(sourceRoot, canonicalTarget, bank, paths);
  return canonicalTarget;
}

/** 将校验过的资源复制到导出目录并生成校验信息 */
export async function copyExportAssets(
  sources: readonly ExportAssetSource[],
  outputRoot: string,
): Promise<ExportAsset[]> {
  const assets: ExportAsset[] = [];
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

/** 以 UTF-8 和临时文件替换方式写入导出文本 */
export async function writeExportFiles(
  outputRoot: string,
  files: readonly ExportFile[],
): Promise<void> {
  for (const file of files) {
    assertSafeExportPath(file.path);
    const target = join(outputRoot, ...file.path.split('/'));
    await prepareExportParent(outputRoot, file.path);
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
    await withTemporaryExportFile(target, (temporary) =>
      writeFile(temporary, file.contents, { encoding: 'utf8', flag: 'wx' }),
    );
  }
}

function assertOutputOutsideSourceCollections(
  sourceRoot: string,
  outputDirectory: string,
  bank: Bank,
  outputPaths: readonly string[],
): void {
  for (const [collection, configuredPath] of Object.entries(bank.paths)) {
    const sourceCollection = resolve(sourceRoot, ...configuredPath.split('/'));
    const artifactOverlapsSource = outputPaths.some((path) =>
      isPathWithin(sourceCollection, resolve(outputDirectory, ...path.split('/'))),
    );
    if (isPathWithin(sourceCollection, outputDirectory) || artifactOverlapsSource) {
      throw new Error(`导出目录不能位于题库源数据目录 paths.${collection} 中：${outputDirectory}`);
    }
  }
}

async function describeExportAsset(path: string, file: string): Promise<ExportAsset> {
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
  const target = resolve(root, ...path.split('/'));
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
