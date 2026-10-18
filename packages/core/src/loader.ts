import type { Dirent } from 'node:fs';
import { lstat, opendir, open, realpath, type FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { TextDecoder } from 'node:util';
import { validateAssetReferences } from './asset-validator.js';
import type { Diagnostic } from './diagnostics.js';
import { DocumentParseError, parseMarkdownDocument, parseYamlDocument } from './parser.js';
import { validateEntity } from './schema-validator.js';

const bankFilename = 'bank.yaml';
/** 默认允许引用资源的累计大小为 256 MiB */
export const defaultMaxTotalAssetBytes = 268_435_456;
const supportedExtensions: Record<CollectionName, readonly string[]> = {
  topics: ['.yaml', '.yml'],
  knowledge: ['.md'],
  questions: ['.yaml', '.yml'],
  groups: ['.yaml', '.yml'],
  exams: ['.yaml', '.yml'],
};

type CollectionName = 'topics' | 'knowledge' | 'questions' | 'groups' | 'exams';

export interface ParsedEntity {
  value: unknown;
  file: string;
}

export interface ParsedQuestionBank {
  rootDir: string;
  bank?: ParsedEntity;
  topics: ParsedEntity[];
  knowledge: ParsedEntity[];
  questions: ParsedEntity[];
  groups: ParsedEntity[];
  exams: ParsedEntity[];
  diagnostics: Diagnostic[];
}

export interface LoadOptions {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  /** 限制一份题库中被实体引用的资源累计大小 */
  maxTotalAssetBytes?: number;
  maxEntityFiles?: number;
  /** 最多扫描的实体目录条目数量 */
  maxScannedEntries?: number;
}

interface DirectoryScanBudget {
  maxEntries: number;
  scannedEntries: number;
  exceeded: boolean;
}

/** 读取 bank.yaml 指定的 YAML 实体文件与 Markdown 知识笔记 */
export async function loadQuestionBank(
  rootDir: string,
  options: LoadOptions = {},
): Promise<ParsedQuestionBank> {
  const absoluteRoot = resolve(rootDir);
  const result: ParsedQuestionBank = {
    rootDir: absoluteRoot,
    topics: [],
    knowledge: [],
    questions: [],
    groups: [],
    exams: [],
    diagnostics: [],
  };
  const maxFileBytes = options.maxFileBytes ?? 2_097_152;
  const maxTotalBytes = options.maxTotalBytes ?? 67_108_864;
  const maxTotalAssetBytes = options.maxTotalAssetBytes ?? defaultMaxTotalAssetBytes;
  const maxEntityFiles = options.maxEntityFiles ?? 10_000;
  const maxScannedEntries = options.maxScannedEntries ?? 50_000;
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) {
    result.diagnostics.push({
      code: 'OQB-FILE-011',
      severity: 'fatal',
      message: 'maxFileBytes 必须是正安全整数',
      file: '.',
    });
    return result;
  }
  if (!Number.isSafeInteger(maxEntityFiles) || maxEntityFiles < 0) {
    result.diagnostics.push({
      code: 'OQB-FILE-012',
      severity: 'fatal',
      message: 'maxEntityFiles 必须是非负安全整数',
      file: '.',
    });
    return result;
  }
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1) {
    result.diagnostics.push({
      code: 'OQB-FILE-017',
      severity: 'fatal',
      message: 'maxTotalBytes 必须是正安全整数',
      file: '.',
    });
    return result;
  }
  if (!Number.isSafeInteger(maxTotalAssetBytes) || maxTotalAssetBytes < 0) {
    result.diagnostics.push({
      code: 'OQB-FILE-020',
      severity: 'fatal',
      message: 'maxTotalAssetBytes 必须是非负安全整数',
      file: '.',
    });
    return result;
  }
  if (!Number.isSafeInteger(maxScannedEntries) || maxScannedEntries < 0) {
    result.diagnostics.push({
      code: 'OQB-FILE-018',
      severity: 'fatal',
      message: 'maxScannedEntries 必须是非负安全整数',
      file: '.',
    });
    return result;
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(absoluteRoot);
  } catch (error) {
    result.diagnostics.push({
      code: 'OQB-FILE-001',
      severity: 'fatal',
      message: errorMessage(error, '无法读取题库目录'),
      file: '.',
      suggestion: '确认题库根目录存在且当前进程具有读取权限',
    });
    return result;
  }

  const bankPath = resolve(absoluteRoot, bankFilename);
  const bankFile = bankFilename;
  const bankRead = await readDocument(
    bankPath,
    bankFile,
    'yaml',
    maxFileBytes,
    maxTotalBytes,
    0,
    absoluteRoot,
    canonicalRoot,
  );
  if ('diagnostic' in bankRead) {
    result.diagnostics.push({ ...bankRead.diagnostic, severity: 'fatal' });
    return result;
  }
  if (!('value' in bankRead)) {
    result.diagnostics.push({
      code: 'OQB-FILE-002',
      severity: 'fatal',
      message: `无法解析 ${bankFilename}`,
      file: bankFilename,
    });
    return result;
  }
  let totalBytesRead = bankRead.bytesRead;
  result.bank = { value: bankRead.value, file: bankFile };

  const bankValidation = validateEntity('bank', bankRead.value, bankFile);
  if (!bankValidation.valid) {
    return result;
  }

  const collections: Record<CollectionName, string> = {
    topics: bankValidation.value.paths.topics,
    knowledge: bankValidation.value.paths.knowledge,
    questions: bankValidation.value.paths.questions,
    groups: bankValidation.value.paths.groups,
    exams: bankValidation.value.paths.exams,
  };
  const pathDiagnostics = validateBankDirectoryPaths(
    absoluteRoot,
    collections,
    bankValidation.value.paths.assets,
  );
  if (pathDiagnostics.length > 0) {
    result.diagnostics.push(...pathDiagnostics);
    return result;
  }

  await validateAssetsDirectory(
    absoluteRoot,
    canonicalRoot,
    bankValidation.value.paths.assets,
    result.diagnostics,
  );
  let entityCount = 0;
  const scanBudget: DirectoryScanBudget = {
    maxEntries: maxScannedEntries,
    scannedEntries: 0,
    exceeded: false,
  };
  for (const collection of Object.keys(collections) as CollectionName[]) {
    const relativeDirectory = collections[collection];
    const directoryPath = resolveBankRelativePath(absoluteRoot, relativeDirectory);
    if (!directoryPath) {
      result.diagnostics.push(createInvalidBankPathDiagnostic(collection, relativeDirectory));
      continue;
    }

    const files = await discoverFiles(
      directoryPath,
      canonicalRoot,
      absoluteRoot,
      collection,
      result.diagnostics,
      maxEntityFiles - entityCount,
      scanBudget,
    );
    if (scanBudget.exceeded) {
      break;
    }
    entityCount += files.length;
    if (result.diagnostics.some(({ code }) => code === 'OQB-FILE-006')) {
      break;
    }
    let totalLimitReached = false;
    for (const file of files) {
      const loaded = await readDocument(
        file.fullPath,
        file.relativePath,
        collection === 'knowledge' ? 'markdown' : 'yaml',
        maxFileBytes,
        maxTotalBytes,
        totalBytesRead,
        absoluteRoot,
        canonicalRoot,
      );
      if ('bytesRead' in loaded) {
        totalBytesRead += loaded.bytesRead;
      }
      if ('diagnostic' in loaded) {
        result.diagnostics.push(loaded.diagnostic);
        if (loaded.diagnostic.code === 'OQB-FILE-016') {
          totalLimitReached = true;
          break;
        }
      } else if ('value' in loaded) {
        result[collection].push({ value: loaded.value, file: file.relativePath });
      }
    }
    if (totalLimitReached) {
      break;
    }
  }

  await validateAssetReferences(
    canonicalRoot,
    bankValidation.value.paths.assets,
    {
      ...(result.bank === undefined ? {} : { bank: result.bank }),
      topics: result.topics,
      knowledge: result.knowledge,
      questions: result.questions,
      groups: result.groups,
      exams: result.exams,
    },
    maxTotalAssetBytes,
    result.diagnostics,
  );

  return result;
}

interface DiscoveredFile {
  fullPath: string;
  relativePath: string;
}

async function discoverFiles(
  directoryPath: string,
  canonicalRoot: string,
  displayRoot: string,
  collection: CollectionName,
  diagnostics: Diagnostic[],
  remainingFiles: number,
  scanBudget: DirectoryScanBudget,
): Promise<DiscoveredFile[]> {
  const files: DiscoveredFile[] = [];
  const expectedExtensions = supportedExtensions[collection];
  let limitReached = false;

  async function visit(currentPath: string, depth: number): Promise<void> {
    if (limitReached) {
      return;
    }
    if (depth > 32) {
      diagnostics.push({
        code: 'OQB-FILE-004',
        severity: 'error',
        message: '实体目录嵌套超过 32 层，已停止扫描',
        file: toDisplayPath(displayRoot, currentPath),
      });
      return;
    }

    let entries: Dirent[];
    try {
      const symbolicLinkPath = await findSymbolicLinkPath(displayRoot, currentPath);
      if (symbolicLinkPath !== undefined) {
        diagnostics.push(unsafePathDiagnostic(displayRoot, symbolicLinkPath));
        return;
      }
      const metadata = await lstat(currentPath);
      if (metadata.isSymbolicLink()) {
        diagnostics.push(unsafePathDiagnostic(displayRoot, currentPath));
        return;
      }
      const canonicalDirectory = await realpath(currentPath);
      if (!isContained(canonicalRoot, canonicalDirectory)) {
        diagnostics.push(unsafePathDiagnostic(displayRoot, currentPath));
        return;
      }
      entries = [];
      const directory = await opendir(currentPath);
      for await (const entry of directory) {
        if (scanBudget.scannedEntries >= scanBudget.maxEntries) {
          diagnostics.push({
            code: 'OQB-FILE-019',
            severity: 'fatal',
            message: '题库实体目录扫描条目数超过 maxScannedEntries 限制',
            file: toDisplayPath(displayRoot, currentPath),
            suggestion: '移除目录中的无关文件，或显式提高 maxScannedEntries 限制',
          });
          scanBudget.exceeded = true;
          break;
        }
        scanBudget.scannedEntries += 1;
        entries.push(entry);
      }
    } catch (error) {
      if (isMissingPath(error)) {
        if (depth === 0) {
          diagnostics.push({
            code: 'OQB-FILE-015',
            severity: 'warning',
            message: '配置的实体目录不存在，已按空集合处理',
            file: toDisplayPath(displayRoot, currentPath),
            suggestion: '确认 Bank.paths 与题库目录名称一致',
          });
        }
        return;
      }
      diagnostics.push({
        code: 'OQB-FILE-005',
        severity: 'error',
        message: errorMessage(error, '无法读取实体目录'),
        file: toDisplayPath(displayRoot, currentPath),
      });
      return;
    }

    if (scanBudget.exceeded) {
      return;
    }

    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      if (limitReached || scanBudget.exceeded) {
        break;
      }
      const fullPath = resolve(currentPath, entry.name);
      const relativePath = toDisplayPath(displayRoot, fullPath);
      if (entry.isSymbolicLink()) {
        diagnostics.push(unsafePathDiagnostic(displayRoot, fullPath));
        continue;
      }
      if (entry.isDirectory()) {
        if (!isPortableBankPathSegment(entry.name)) {
          diagnostics.push(createInvalidEntityPathDiagnostic(relativePath));
          continue;
        }
        await visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
      if (!expectedExtensions.includes(extension)) {
        continue;
      }
      if (!isPortableBankPathSegment(entry.name)) {
        diagnostics.push(createInvalidEntityPathDiagnostic(relativePath));
        continue;
      }
      if (files.length >= remainingFiles) {
        diagnostics.push({
          code: 'OQB-FILE-006',
          severity: 'fatal',
          message: '实体文件数量超过 maxEntityFiles 限制',
          file: relativePath,
          suggestion: '拆分题库或显式提高 maxEntityFiles 限制',
        });
        limitReached = true;
        return;
      }
      files.push({ fullPath, relativePath });
    }
  }

  await visit(directoryPath, 0);
  return files;
}

function validateBankDirectoryPaths(
  rootDir: string,
  collections: Record<CollectionName, string>,
  assetsDirectory: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const configuredPaths = [
    ...Object.entries(collections).map(([name, value]) => ({ name, value })),
    { name: 'assets', value: assetsDirectory },
  ];
  const validPaths: Array<{ name: string; value: string; segments: string[] }> = [];

  for (const configuredPath of configuredPaths) {
    if (!resolveBankRelativePath(rootDir, configuredPath.value)) {
      diagnostics.push(createInvalidBankPathDiagnostic(configuredPath.name, configuredPath.value));
      continue;
    }

    validPaths.push({
      ...configuredPath,
      segments: normalizeBankDirectorySegments(configuredPath.value),
    });
  }

  for (let leftIndex = 0; leftIndex < validPaths.length; leftIndex += 1) {
    const left = validPaths[leftIndex];
    if (!left) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < validPaths.length; rightIndex += 1) {
      const right = validPaths[rightIndex];
      if (!right || !areOverlappingBankDirectories(left.segments, right.segments)) {
        continue;
      }
      diagnostics.push({
        code: 'OQB-FILE-021',
        severity: 'error',
        message: `题库目录不能相同或互相嵌套：paths.${left.name} 与 paths.${right.name}`,
        file: bankFilename,
        fieldPath: `paths.${left.name}`,
        suggestion: '为各类实体和资源配置互不相同且互不嵌套的相对目录',
      });
    }
  }

  return diagnostics;
}

function createInvalidBankPathDiagnostic(name: string, path: string): Diagnostic {
  const isAssetsPath = name === 'assets';
  return {
    code: 'OQB-FILE-003',
    severity: 'error',
    message: `${isAssetsPath ? '资源目录' : '目录'}路径不安全或不可跨平台使用：${path}`,
    file: bankFilename,
    fieldPath: `paths.${name}`,
    suggestion: isAssetsPath
      ? '将资源目录设置为题库根目录下符合跨平台文件系统规则的相对路径'
      : '使用题库根目录下的相对路径，并确保每段名称符合跨平台文件系统规则',
  };
}

function createInvalidEntityPathDiagnostic(path: string): Diagnostic {
  return {
    code: 'OQB-FILE-022',
    severity: 'error',
    message: `实体文件或目录名不可跨平台使用：${path}`,
    file: path,
    suggestion:
      '重命名路径段；每段不得包含 Windows 非法字符或控制字符，不能以点或空格结尾、不能使用保留设备名，UTF-8 长度不能超过 255 字节',
  };
}

function normalizeBankDirectorySegments(relativePath: string): string[] {
  const segments = relativePath.split('/');
  if (segments.at(-1) === '') {
    segments.pop();
  }
  return segments
    .map((segment) => segment.normalize('NFC').toLowerCase())
    .filter((segment) => segment.length > 0);
}

function areOverlappingBankDirectories(left: readonly string[], right: readonly string[]): boolean {
  const sharedLength = Math.min(left.length, right.length);
  return left.slice(0, sharedLength).every((segment, index) => segment === right[index]);
}

async function validateAssetsDirectory(
  rootDir: string,
  canonicalRoot: string,
  relativeDirectory: string,
  diagnostics: Diagnostic[],
): Promise<void> {
  const directoryPath = resolveBankRelativePath(rootDir, relativeDirectory);
  if (!directoryPath) {
    diagnostics.push(createInvalidBankPathDiagnostic('assets', relativeDirectory));
    return;
  }
  try {
    const symbolicLinkPath = await findSymbolicLinkPath(rootDir, directoryPath);
    if (symbolicLinkPath !== undefined) {
      diagnostics.push(unsafePathDiagnostic(rootDir, symbolicLinkPath));
      return;
    }
    const metadata = await lstat(directoryPath);
    if (metadata.isSymbolicLink()) {
      diagnostics.push(unsafePathDiagnostic(rootDir, directoryPath));
      return;
    }
    if (!metadata.isDirectory()) {
      diagnostics.push({
        code: 'OQB-FILE-013',
        severity: 'error',
        message: '配置的资源路径不是目录',
        file: relativeDirectory,
        fieldPath: 'paths.assets',
      });
      return;
    }
    const canonicalDirectory = await realpath(directoryPath);
    if (!isContained(canonicalRoot, canonicalDirectory)) {
      diagnostics.push(unsafePathDiagnostic(rootDir, directoryPath));
    }
  } catch (error) {
    if (!isMissingPath(error)) {
      diagnostics.push({
        code: 'OQB-FILE-014',
        severity: 'error',
        message: errorMessage(error, '无法检查资源目录'),
        file: relativeDirectory,
        fieldPath: 'paths.assets',
      });
    }
  }
}

async function readDocument(
  fullPath: string,
  relativePath: string,
  kind: 'yaml' | 'markdown',
  maxFileBytes: number,
  maxTotalBytes: number,
  totalBytesRead: number,
  rootDir: string,
  canonicalRoot: string,
): Promise<{ value: unknown; bytesRead: number } | { diagnostic: Diagnostic; bytesRead?: number }> {
  let bytesRead = 0;
  let file: FileHandle | undefined;
  try {
    if ((await findSymbolicLinkPath(rootDir, fullPath)) !== undefined) {
      return { diagnostic: unsafePathDiagnosticFromRelative(relativePath) };
    }
    const metadata = await lstat(fullPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      return { diagnostic: unsafePathDiagnosticFromRelative(relativePath) };
    }
    const canonicalFile = await realpath(fullPath);
    if (!isContained(canonicalRoot, canonicalFile)) {
      return { diagnostic: unsafePathDiagnosticFromRelative(relativePath) };
    }
    if (metadata.size > maxFileBytes) {
      return {
        diagnostic: {
          code: 'OQB-FILE-007',
          severity: 'error',
          message: `文件大小 ${metadata.size} 字节，超过限制 ${maxFileBytes} 字节`,
          file: relativePath,
          suggestion: '拆分内容或显式提高 maxFileBytes 限制',
        },
      };
    }
    if (metadata.size > maxTotalBytes - totalBytesRead) {
      return {
        diagnostic: createTotalSizeLimitDiagnostic(relativePath, metadata.size, maxTotalBytes),
      };
    }

    file = await open(fullPath, 'r');
    const openedMetadata = await file.stat();
    const deviceChanged =
      metadata.dev !== 0 && openedMetadata.dev !== 0 && openedMetadata.dev !== metadata.dev;
    if (!openedMetadata.isFile() || deviceChanged || openedMetadata.ino !== metadata.ino) {
      return { diagnostic: unsafePathDiagnosticFromRelative(relativePath) };
    }
    const openedCanonicalFile = await realpath(fullPath);
    if (!isContained(canonicalRoot, openedCanonicalFile)) {
      return { diagnostic: unsafePathDiagnosticFromRelative(relativePath) };
    }
    if (openedMetadata.size > maxFileBytes) {
      return {
        diagnostic: {
          code: 'OQB-FILE-007',
          severity: 'error',
          message: `文件大小 ${openedMetadata.size} 字节，超过限制 ${maxFileBytes} 字节`,
          file: relativePath,
          suggestion: '拆分内容或显式提高 maxFileBytes 限制',
        },
      };
    }
    if (openedMetadata.size > maxTotalBytes - totalBytesRead) {
      return {
        diagnostic: createTotalSizeLimitDiagnostic(
          relativePath,
          openedMetadata.size,
          maxTotalBytes,
        ),
      };
    }

    const allowedBytes = Math.min(maxFileBytes, maxTotalBytes - totalBytesRead);
    const readResult = await readFileWithinLimit(file, allowedBytes);
    if (readResult.kind === 'limit-exceeded') {
      return {
        diagnostic:
          maxFileBytes <= maxTotalBytes - totalBytesRead
            ? {
                code: 'OQB-FILE-007',
                severity: 'error',
                message: `文件读取量超过单文件限制 ${maxFileBytes} 字节`,
                file: relativePath,
                suggestion: '拆分内容或显式提高 maxFileBytes 限制',
              }
            : createTotalReadLimitDiagnostic(relativePath, maxTotalBytes),
        bytesRead: readResult.bytesRead,
      };
    }

    const bytes = readResult.bytes;
    bytesRead = bytes.byteLength;
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (kind === 'yaml') {
      return { value: parseYamlDocument(source), bytesRead };
    }
    const parsed = parseMarkdownDocument(source);
    return { value: { ...parsed.metadata, body: parsed.body }, bytesRead };
  } catch (error) {
    const parseError = error instanceof DocumentParseError ? error : undefined;
    const missingBankFile = relativePath === bankFilename && isMissingPath(error);
    return {
      diagnostic: {
        code: parseError ? 'OQB-FILE-008' : missingBankFile ? 'OQB-FILE-002' : 'OQB-FILE-009',
        severity: 'error',
        message: missingBankFile
          ? `题库根目录缺少必需文件 ${bankFilename}`
          : errorMessage(error, '无法读取或解析文件'),
        file: relativePath,
        ...(parseError?.line === undefined ? {} : { line: parseError.line }),
        ...(parseError?.column === undefined ? {} : { column: parseError.column }),
        suggestion: parseError
          ? '检查 YAML 语法与 Markdown Front Matter 分隔线'
          : missingBankFile
            ? '在题库根目录创建 bank.yaml，或运行 `oqb init <目录>` 生成有效模板'
            : '确认文件存在、编码为 UTF-8 且当前进程具有读取权限',
      },
      ...(bytesRead > 0 ? { bytesRead } : {}),
    };
  } finally {
    await file?.close();
  }
}

type LimitedFileReadResult =
  { kind: 'complete'; bytes: Buffer } | { kind: 'limit-exceeded'; bytesRead: number };

/** 最多返回上限字节内容，并读取额外一个字节判断是否超限 */
export async function readFileWithinLimit(
  file: FileHandle,
  maxBytes: number,
): Promise<LimitedFileReadResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('读取上限必须是非负安全整数');
  }

  const chunk = Buffer.allocUnsafe(Math.min(65_536, Math.max(1, maxBytes)));
  const chunks: Buffer[] = [];
  let totalBytesRead = 0;
  while (totalBytesRead < maxBytes) {
    const bytesToRead = Math.min(chunk.length, maxBytes - totalBytesRead);
    const { bytesRead } = await file.read(chunk, 0, bytesToRead, totalBytesRead);
    if (bytesRead === 0) {
      return { kind: 'complete', bytes: Buffer.concat(chunks, totalBytesRead) };
    }
    chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
    totalBytesRead += bytesRead;
  }

  const overflow = Buffer.allocUnsafe(1);
  const { bytesRead } = await file.read(overflow, 0, 1, totalBytesRead);
  return bytesRead === 0
    ? { kind: 'complete', bytes: Buffer.concat(chunks, totalBytesRead) }
    : { kind: 'limit-exceeded', bytesRead: totalBytesRead + bytesRead };
}

function createTotalReadLimitDiagnostic(relativePath: string, maxTotalBytes: number): Diagnostic {
  return {
    code: 'OQB-FILE-016',
    severity: 'fatal',
    message: `读取该文件会使题库累计读取量超过限制 ${maxTotalBytes} 字节`,
    file: relativePath,
    suggestion: '拆分题库或显式提高 maxTotalBytes 限制',
  };
}

function createTotalSizeLimitDiagnostic(
  relativePath: string,
  sizeBytes: number,
  maxTotalBytes: number,
): Diagnostic {
  return {
    code: 'OQB-FILE-016',
    severity: 'fatal',
    message: `文件大小 ${sizeBytes} 字节会使题库累计读取量超过限制 ${maxTotalBytes} 字节`,
    file: relativePath,
    suggestion: '拆分题库或显式提高 maxTotalBytes 限制',
  };
}

function resolveBankRelativePath(rootDir: string, relativePath: string): string | undefined {
  const segments = relativePath.split('/');
  if (segments.at(-1) === '') {
    segments.pop();
  }
  if (
    relativePath.includes('\0') ||
    relativePath.includes(':') ||
    relativePath.includes('\\') ||
    isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath) ||
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        !isPortableBankPathSegment(segment),
    )
  ) {
    return undefined;
  }
  const candidate = resolve(rootDir, ...segments);
  return isContained(rootDir, candidate) ? candidate : undefined;
}

function isPortableBankPathSegment(segment: string): boolean {
  if (
    segment.endsWith('.') ||
    segment.endsWith(' ') ||
    Buffer.byteLength(segment, 'utf8') > 255 ||
    /[<>:"|?*]/u.test(segment) ||
    [...segment].some((character) => (character.codePointAt(0) ?? 0) < 0x20)
  ) {
    return false;
  }

  const baseName = segment.split('.')[0]?.replace(/[ .]+$/u, '') ?? '';
  return !/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/iu.test(baseName);
}

async function findSymbolicLinkPath(
  rootDir: string,
  targetPath: string,
): Promise<string | undefined> {
  const pathFromRoot = relative(rootDir, targetPath);
  if (pathFromRoot === '' || pathFromRoot === '.') {
    return undefined;
  }
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    return targetPath;
  }

  let currentPath = rootDir;
  for (const segment of pathFromRoot.split(sep)) {
    currentPath = resolve(currentPath, segment);
    if ((await lstat(currentPath)).isSymbolicLink()) {
      return currentPath;
    }
  }
  return undefined;
}

function isContained(rootDir: string, target: string): boolean {
  const pathFromRoot = relative(rootDir, target);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  );
}

function toDisplayPath(rootDir: string, target: string): string {
  return relative(rootDir, target).split(sep).join('/') || '.';
}

function unsafePathDiagnostic(rootDir: string, target: string): Diagnostic {
  return {
    code: 'OQB-FILE-010',
    severity: 'error',
    message: '检测到符号链接或越出题库根目录的路径，已跳过读取',
    file: toDisplayPath(rootDir, target),
    suggestion: '将实体文件存放在题库目录内，并使用普通文件或目录',
  };
}

function unsafePathDiagnosticFromRelative(relativePath: string): Diagnostic {
  return {
    code: 'OQB-FILE-010',
    severity: 'error',
    message: '检测到符号链接或越出题库根目录的路径，已跳过读取',
    file: relativePath,
    suggestion: '将实体文件存放在题库目录内，并使用普通文件或目录',
  };
}

function isMissingPath(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
