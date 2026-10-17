import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { TextDecoder } from 'node:util';
import { validateAssetReferences } from './asset-validator.js';
import type { Diagnostic } from './diagnostics.js';
import { DocumentParseError, parseMarkdownDocument, parseYamlDocument } from './parser.js';
import { validateEntity } from './schema-validator.js';

const bankFilename = 'bank.yaml';
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
  maxEntityFiles?: number;
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
  const maxEntityFiles = options.maxEntityFiles ?? 10_000;
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
  let totalBytesRead = bankRead.sizeBytes;
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
  await validateAssetsDirectory(
    absoluteRoot,
    canonicalRoot,
    bankValidation.value.paths.assets,
    result.diagnostics,
  );
  let entityCount = 0;
  for (const collection of Object.keys(collections) as CollectionName[]) {
    const relativeDirectory = collections[collection];
    const directoryPath = resolveBankRelativePath(absoluteRoot, relativeDirectory);
    if (!directoryPath) {
      result.diagnostics.push({
        code: 'OQB-FILE-003',
        severity: 'error',
        message: `目录路径不安全：${relativeDirectory}`,
        file: bankFile,
        fieldPath: `paths.${collection}`,
        suggestion: '使用题库根目录下不含绝对路径、点路径或 Windows 保留分隔符的相对路径',
      });
      continue;
    }

    const files = await discoverFiles(
      directoryPath,
      canonicalRoot,
      absoluteRoot,
      collection,
      result.diagnostics,
      maxEntityFiles - entityCount,
    );
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
        canonicalRoot,
      );
      if ('sizeBytes' in loaded) {
        totalBytesRead += loaded.sizeBytes;
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
    { knowledge: result.knowledge, questions: result.questions, groups: result.groups },
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

    let entries;
    try {
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
      entries = await readdir(currentPath, { withFileTypes: true });
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

    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      if (limitReached) {
        break;
      }
      const fullPath = resolve(currentPath, entry.name);
      const relativePath = toDisplayPath(displayRoot, fullPath);
      if (entry.isSymbolicLink()) {
        diagnostics.push(unsafePathDiagnostic(displayRoot, fullPath));
        continue;
      }
      if (entry.isDirectory()) {
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

async function validateAssetsDirectory(
  rootDir: string,
  canonicalRoot: string,
  relativeDirectory: string,
  diagnostics: Diagnostic[],
): Promise<void> {
  const directoryPath = resolveBankRelativePath(rootDir, relativeDirectory);
  if (!directoryPath) {
    diagnostics.push({
      code: 'OQB-FILE-003',
      severity: 'error',
      message: `资源目录路径不安全：${relativeDirectory}`,
      file: bankFilename,
      fieldPath: 'paths.assets',
      suggestion: '将资源目录设置为题库根目录下的相对路径',
    });
    return;
  }
  try {
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
  canonicalRoot: string,
): Promise<{ value: unknown; sizeBytes: number } | { diagnostic: Diagnostic; sizeBytes?: number }> {
  let sizeBytes = 0;
  try {
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
        diagnostic: {
          code: 'OQB-FILE-016',
          severity: 'fatal',
          message: `文件大小 ${metadata.size} 字节会使题库累计读取量超过限制 ${maxTotalBytes} 字节`,
          file: relativePath,
          suggestion: '拆分题库或显式提高 maxTotalBytes 限制',
        },
      };
    }
    const bytes = await readFile(fullPath);
    sizeBytes = bytes.byteLength;
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (kind === 'yaml') {
      return { value: parseYamlDocument(source), sizeBytes };
    }
    const parsed = parseMarkdownDocument(source);
    return { value: { ...parsed.metadata, body: parsed.body }, sizeBytes };
  } catch (error) {
    const parseError = error instanceof DocumentParseError ? error : undefined;
    return {
      diagnostic: {
        code: parseError ? 'OQB-FILE-008' : 'OQB-FILE-009',
        severity: 'error',
        message: errorMessage(error, '无法读取或解析文件'),
        file: relativePath,
        ...(parseError?.line === undefined ? {} : { line: parseError.line }),
        ...(parseError?.column === undefined ? {} : { column: parseError.column }),
        suggestion: parseError
          ? '检查 YAML 语法与 Markdown Front Matter 分隔线'
          : '确认文件编码为 UTF-8 且当前进程具有读取权限',
      },
      ...(sizeBytes > 0 ? { sizeBytes } : {}),
    };
  }
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
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  const candidate = resolve(rootDir, ...segments);
  return isContained(rootDir, candidate) ? candidate : undefined;
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
