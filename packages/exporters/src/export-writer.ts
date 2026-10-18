import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rmdir,
  rm,
  stat,
  type FileHandle,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TextDecoder } from 'node:util';
import type { Bank } from '@openquestionbank/schema';
import {
  defaultMaxTotalAssetBytes,
  getSvgSecurityIssue,
  maxSvgAssetBytes,
  type QuestionBankData,
} from '@openquestionbank/core';
import {
  assertNoCredentialedQuestionBankUrls,
  assertSafeExportPath,
  assertUniquePortableExportPaths,
  collectReferencedAssets,
  getPortableExportPathKey,
  type ExportAsset,
} from './export-common.js';

export interface ExportAssetSource {
  path: string;
  sourcePath: string;
  sourceRoot: string;
  assetsRoot: string;
  sizeBytes: number;
}

export interface ExportFile {
  path: string;
  contents: string;
}

/** 控制导出资源处理上限 */
export interface ExportWriterOptions {
  /** 限制导出资源累计大小，默认使用 Core 的 256 MiB 上限 */
  maxTotalAssetBytes?: number;
}

interface PreviousExportFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

const knownExportFormats = new Set([
  'openquestionbank-json',
  'openquestionbank-github-markdown',
  'openquestionbank-obsidian-vault',
  'openquestionbank-notion-import',
]);

/** 收集并校验题库声明的资源文件 */
export async function collectExportAssetSources(
  sourceDirectory: string,
  data: QuestionBankData,
  bank: Bank,
  maxTotalAssetBytes = defaultMaxTotalAssetBytes,
): Promise<ExportAssetSource[]> {
  assertNoCredentialedQuestionBankUrls(data);
  if (!Number.isSafeInteger(maxTotalAssetBytes) || maxTotalAssetBytes < 0) {
    throw new RangeError('maxTotalAssetBytes 必须是非负安全整数');
  }
  const sourceRoot = await realpath(sourceDirectory);
  const assetsRoot = resolve(sourceRoot, ...bank.paths.assets.split('/'));
  const assets: ExportAssetSource[] = [];
  let totalAssetBytes = 0;
  for (const path of [...collectReferencedAssets(data)].sort(compareStrings)) {
    assertSafeExportPath(path, '题库资源路径');
    const sourceFile = resolveSafeRelativePath(sourceRoot, path);
    if (!isPathWithin(assetsRoot, sourceFile)) {
      throw new Error(`资源文件不在 Bank.paths.assets 目录内：${path}`);
    }
    let currentPath = sourceRoot;
    let sizeBytes: number | undefined;
    const segments = path.split('/');
    for (const [index, segment] of segments.entries()) {
      currentPath = resolve(currentPath, segment);
      const metadata = await lstat(currentPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`资源路径包含符号链接：${path}`);
      }
      const isLast = index === segments.length - 1;
      if ((isLast && !metadata.isFile()) || (!isLast && !metadata.isDirectory())) {
        throw new Error(isLast ? `资源文件不是普通文件：${path}` : `资源路径不是普通目录：${path}`);
      }
      if (isLast) {
        sizeBytes = metadata.size;
      }
    }
    if (sizeBytes === undefined) {
      throw new Error(`无法检查资源文件：${path}`);
    }
    if (sizeBytes > maxTotalAssetBytes - totalAssetBytes) {
      throw new Error(`题库引用资源累计大小超过限制 ${maxTotalAssetBytes} 字节`);
    }
    totalAssetBytes += sizeBytes;
    const canonicalFile = await realpath(sourceFile);
    if (!isPathWithin(sourceRoot, canonicalFile) || !isPathWithin(assetsRoot, canonicalFile)) {
      throw new Error(`资源文件路径越出题库资源目录：${path}`);
    }
    assets.push({
      path,
      sourcePath: canonicalFile,
      sourceRoot,
      assetsRoot,
      sizeBytes,
    });
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
  assertUniquePortableExportPaths(paths);

  const sourceRoot = await realpath(sourceDirectory);
  const targetDirectory = resolve(outputDirectory);

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

  const physicalTargetBeforeCreation = await resolvePhysicalPathBeforeCreation(targetDirectory);
  if (
    isPathWithin(sourceRoot, physicalTargetBeforeCreation) &&
    isPathWithin(physicalTargetBeforeCreation, sourceRoot)
  ) {
    throw new Error(`导出目录不能与题库根目录相同：${physicalTargetBeforeCreation}`);
  }
  assertOutputOutsideSourceCollections(sourceRoot, physicalTargetBeforeCreation, bank, paths);

  await mkdir(targetDirectory, { recursive: true });
  const canonicalTarget = await realpath(targetDirectory);
  assertOutputOutsideSourceCollections(sourceRoot, canonicalTarget, bank, paths);
  return canonicalTarget;
}

/** 解析尚未创建的导出目录对应的物理路径 */
async function resolvePhysicalPathBeforeCreation(targetDirectory: string): Promise<string> {
  let currentPath = targetDirectory;
  const missingSegments: string[] = [];

  while (true) {
    try {
      const metadata = await stat(currentPath);
      if (!metadata.isDirectory()) {
        throw new Error(`导出路径的现有父级不是目录：${currentPath}`);
      }
      return resolve(await realpath(currentPath), ...missingSegments);
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
      const parentPath = dirname(currentPath);
      if (parentPath === currentPath) {
        throw error;
      }
      missingSegments.unshift(basename(currentPath));
      currentPath = parentPath;
    }
  }
}

/** 将校验过的资源复制到导出目录并生成校验信息 */
export async function copyExportAssets(
  sources: readonly ExportAssetSource[],
  outputRoot: string,
): Promise<ExportAsset[]> {
  const assets: ExportAsset[] = [];
  const stagedFiles: Array<{ target: string; temporary: string }> = [];
  try {
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

      const inspectSvg = source.path.toLowerCase().endsWith('.svg');
      if (inspectSvg && source.sizeBytes > maxSvgAssetBytes) {
        throw new Error(`SVG 文件超过安全检查限制 ${maxSvgAssetBytes} 字节：${source.path}`);
      }

      const sourceFile = await openExportAssetSource(source);
      let temporary: string;
      try {
        temporary = await writeTemporaryExportFile(target, async (path) => {
          await pipeline(
            sourceFile.createReadStream({ autoClose: false }),
            createExportAssetInspector(source, inspectSvg),
            createWriteStream(path, { flags: 'wx' }),
          );
          const copiedMetadata = await stat(path);
          if (!copiedMetadata.isFile() || copiedMetadata.size !== source.sizeBytes) {
            throw new Error(`题库资源文件在复制期间发生变化：${source.path}`);
          }
        });
        stagedFiles.push({ target, temporary });
      } finally {
        await sourceFile.close();
      }
      assets.push(await describeExportAsset(source.path, temporary));
    }

    for (const stagedFile of stagedFiles) {
      await rename(stagedFile.temporary, stagedFile.target);
    }
    return assets;
  } finally {
    await Promise.all(stagedFiles.map(({ temporary }) => rm(temporary, { force: true })));
  }
}

function createExportAssetInspector(source: ExportAssetSource, inspectSvg: boolean): Transform {
  const svgChunks: Buffer[] = [];
  let totalBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      totalBytes += chunk.byteLength;
      if (totalBytes > source.sizeBytes) {
        callback(new Error(`题库资源文件在复制期间发生变化：${source.path}`));
        return;
      }
      if (inspectSvg) {
        if (totalBytes > maxSvgAssetBytes) {
          callback(new Error(`SVG 文件超过安全检查限制 ${maxSvgAssetBytes} 字节：${source.path}`));
          return;
        }
        svgChunks.push(chunk);
      }
      callback(null, chunk);
    },
    flush(callback: TransformCallback) {
      if (totalBytes !== source.sizeBytes) {
        callback(new Error(`题库资源文件在复制期间发生变化：${source.path}`));
        return;
      }
      if (!inspectSvg) {
        callback();
        return;
      }

      let svgSource: string;
      try {
        svgSource = new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(svgChunks, totalBytes),
        );
      } catch {
        callback(new Error(`SVG 文件不是有效的 UTF-8 文本：${source.path}`));
        return;
      }
      const issue = getSvgSecurityIssue(svgSource);
      if (issue) {
        callback(new Error(`${issue}：${source.path}`));
        return;
      }
      callback();
    },
  });
}

/** 打开仍位于题库资源目录中的普通文件 */
async function openExportAssetSource(source: ExportAssetSource): Promise<FileHandle> {
  let file: FileHandle | undefined;
  try {
    const metadata = await lstat(source.sourcePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`题库资源目录中的文件在导出期间发生变化：${source.path}`);
    }
    file = await open(source.sourcePath, 'r');
    const openedMetadata = await file.stat();
    const pathMetadata = await lstat(source.sourcePath);
    const canonicalPath = await realpath(source.sourcePath);
    const deviceChanged =
      metadata.dev !== 0 && openedMetadata.dev !== 0 && metadata.dev !== openedMetadata.dev;
    const inodeChanged =
      metadata.ino !== 0 && openedMetadata.ino !== 0 && metadata.ino !== openedMetadata.ino;
    const pathChanged =
      pathMetadata.isSymbolicLink() ||
      !pathMetadata.isFile() ||
      (pathMetadata.ino !== 0 &&
        openedMetadata.ino !== 0 &&
        pathMetadata.ino !== openedMetadata.ino);
    if (
      !openedMetadata.isFile() ||
      deviceChanged ||
      inodeChanged ||
      pathChanged ||
      openedMetadata.size !== source.sizeBytes ||
      canonicalPath !== source.sourcePath ||
      !isPathWithin(source.sourceRoot, canonicalPath) ||
      !isPathWithin(source.assetsRoot, canonicalPath)
    ) {
      throw new Error(`题库资源目录中的文件在导出期间发生变化：${source.path}`);
    }
    return file;
  } catch (error) {
    await file?.close();
    throw error;
  }
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

/** 写入导出文件并在旧文件清理完成后发布新清单 */
export async function writeManagedExportFiles(
  outputRoot: string,
  files: readonly ExportFile[],
  previousFiles: readonly PreviousExportFile[],
  currentPaths: readonly string[],
): Promise<void> {
  const manifestFiles = files.filter(({ path }) => path === 'manifest.json');
  if (manifestFiles.length !== 1) {
    throw new Error('导出包必须且只能包含一个 manifest.json');
  }
  const [manifestFile] = manifestFiles;
  if (!manifestFile) {
    throw new Error('导出包缺少 manifest.json');
  }

  await writeExportFiles(
    outputRoot,
    files.filter(({ path }) => path !== 'manifest.json'),
  );
  await removeStaleExportFiles(outputRoot, previousFiles, currentPaths);
  await writeExportFiles(outputRoot, [manifestFile]);
}

/** 读取上一版 OpenQuestionBank 导出清单中的文件记录 */
export async function readPreviousExportFiles(outputRoot: string): Promise<PreviousExportFile[]> {
  const manifestPath = join(outputRoot, 'manifest.json');
  let metadata;
  try {
    metadata = await lstat(manifestPath);
  } catch (error) {
    if (isMissingPath(error)) {
      return [];
    }
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 67_108_864) {
    return [];
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return [];
    }
    throw error;
  }
  if (
    !isRecord(manifest) ||
    typeof manifest.format !== 'string' ||
    !knownExportFormats.has(manifest.format) ||
    !Array.isArray(manifest.files)
  ) {
    return [];
  }

  const files: PreviousExportFile[] = [];
  for (const entry of manifest.files) {
    if (!isRecord(entry)) {
      continue;
    }
    const { path, sizeBytes, sha256 } = entry;
    if (
      typeof path !== 'string' ||
      path === 'manifest.json' ||
      !Number.isSafeInteger(sizeBytes) ||
      typeof sizeBytes !== 'number' ||
      sizeBytes < 0 ||
      typeof sha256 !== 'string' ||
      !/^[0-9a-f]{64}(?![\s\S])/.test(sha256)
    ) {
      continue;
    }
    try {
      assertSafeExportPath(path, '上一版导出文件路径');
    } catch {
      continue;
    }
    files.push({ path, sizeBytes, sha256 });
  }
  return files;
}

/** 移除未修改且会阻止本次导出路径创建的旧文件 */
export async function removeManagedExportPathConflicts(
  outputRoot: string,
  previousFiles: readonly PreviousExportFile[],
  currentPaths: readonly string[],
): Promise<void> {
  for (const previousFile of previousFiles) {
    const conflictingPath = currentPaths.find(
      (currentPath) =>
        isPortableExportPathAncestor(previousFile.path, currentPath) ||
        isPortableExportPathAncestor(currentPath, previousFile.path),
    );
    if (!conflictingPath) {
      continue;
    }

    const target = await getExistingOutputFile(outputRoot, previousFile.path);
    if (!target) {
      continue;
    }
    const currentFile = await describeExportAsset(previousFile.path, target);
    if (
      currentFile.sizeBytes !== previousFile.sizeBytes ||
      currentFile.sha256 !== previousFile.sha256
    ) {
      continue;
    }

    await rm(target);
    if (isPortableExportPathAncestor(conflictingPath, previousFile.path)) {
      await removeEmptyOutputDirectories(outputRoot, previousFile.path, conflictingPath);
    }
  }
}

/** 删除上一版清单登记且本次未生成、内容也未被修改的文件 */
export async function removeStaleExportFiles(
  outputRoot: string,
  previousFiles: readonly PreviousExportFile[],
  currentPaths: readonly string[],
): Promise<void> {
  const currentPathsByKey = new Map(
    currentPaths.map((path) => [getPortableExportPathKey(path), path] as const),
  );
  for (const previousFile of previousFiles) {
    const currentPath = currentPathsByKey.get(getPortableExportPathKey(previousFile.path));
    if (currentPath === previousFile.path) {
      continue;
    }
    const target = await getExistingOutputFile(outputRoot, previousFile.path);
    if (!target) {
      continue;
    }
    if (
      currentPath &&
      (await mayBeSameFile(target, resolveSafeRelativePath(outputRoot, currentPath)))
    ) {
      continue;
    }
    const currentFile = await describeExportAsset(previousFile.path, target);
    if (
      currentFile.sizeBytes !== previousFile.sizeBytes ||
      currentFile.sha256 !== previousFile.sha256
    ) {
      continue;
    }
    await rm(target);
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

async function getExistingOutputFile(
  outputRoot: string,
  relativePath: string,
): Promise<string | undefined> {
  const segments = relativePath.split('/');
  let currentDirectory = outputRoot;
  for (const segment of segments.slice(0, -1)) {
    currentDirectory = join(currentDirectory, segment);
    try {
      const metadata = await lstat(currentDirectory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        return undefined;
      }
    } catch (error) {
      if (isMissingPath(error)) {
        return undefined;
      }
      throw error;
    }
  }

  const target = resolveSafeRelativePath(outputRoot, relativePath);
  try {
    const metadata = await lstat(target);
    return metadata.isFile() && !metadata.isSymbolicLink() ? target : undefined;
  } catch (error) {
    if (isMissingPath(error)) {
      return undefined;
    }
    throw error;
  }
}

async function removeEmptyOutputDirectories(
  outputRoot: string,
  previousPath: string,
  currentPath: string,
): Promise<void> {
  const previousSegments = previousPath.split('/');
  const currentDepth = currentPath.split('/').length;
  for (let depth = previousSegments.length - 1; depth >= currentDepth; depth--) {
    const directory = join(outputRoot, ...previousSegments.slice(0, depth));
    try {
      await rmdir(directory);
    } catch (error) {
      if (isMissingPath(error)) {
        continue;
      }
      if (isDirectoryNotEmpty(error)) {
        return;
      }
      throw error;
    }
  }
}

function isPortableExportPathAncestor(parent: string, target: string): boolean {
  const parentSegments = getPortableExportPathKey(parent).split('/');
  const targetSegments = getPortableExportPathKey(target).split('/');
  return (
    parentSegments.length < targetSegments.length &&
    parentSegments.every((segment, index) => segment === targetSegments[index])
  );
}

async function mayBeSameFile(left: string, right: string): Promise<boolean> {
  try {
    const [leftMetadata, rightMetadata] = await Promise.all([stat(left), stat(right)]);
    return (
      leftMetadata.isFile() &&
      rightMetadata.isFile() &&
      leftMetadata.dev === rightMetadata.dev &&
      (leftMetadata.ino === 0 || rightMetadata.ino === 0 || leftMetadata.ino === rightMetadata.ino)
    );
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
}

async function withTemporaryExportFile(
  target: string,
  writeTemporary: (temporary: string) => Promise<void>,
): Promise<void> {
  const temporary = await writeTemporaryExportFile(target, writeTemporary);
  try {
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeTemporaryExportFile(
  target: string,
  writeTemporary: (temporary: string) => Promise<void>,
): Promise<string> {
  const temporary = join(dirname(target), `.oqb-export-${randomUUID()}.tmp`);
  try {
    await writeTemporary(temporary);
    return temporary;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
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

function isDirectoryNotEmpty(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOTEMPTY' || error.code === 'EEXIST')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
