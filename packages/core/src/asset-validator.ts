import { lstat, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import type { Diagnostic } from './diagnostics.js';

interface AssetEntity {
  file: string;
  value: unknown;
}

interface AssetCollections {
  knowledge: readonly AssetEntity[];
  questions: readonly AssetEntity[];
  groups: readonly AssetEntity[];
}

interface AssetPathEntry {
  fieldPath: string;
  entityId?: string;
  file: string;
}

/** 检查实体资源清单、Markdown 链接与资源文件是否一致 */
export async function validateAssetReferences(
  canonicalRoot: string,
  relativeAssetsDirectory: string,
  collections: AssetCollections,
  diagnostics: Diagnostic[],
): Promise<void> {
  const assetsDirectory = normalizeDirectoryPath(relativeAssetsDirectory);
  if (!assetsDirectory) {
    return;
  }

  const entities = [
    ...collections.knowledge.map((entity) => ({
      entity,
      fields: [{ path: 'body', value: getRecord(entity.value)?.body }],
    })),
    ...collections.questions.map((entity) => ({
      entity,
      fields: [
        { path: 'stem', value: getRecord(entity.value)?.stem },
        { path: 'explanation', value: getRecord(entity.value)?.explanation },
      ],
    })),
    ...collections.groups.map((entity) => ({
      entity,
      fields: [{ path: 'passage', value: getRecord(entity.value)?.passage }],
    })),
  ];

  for (const { entity, fields } of entities) {
    const listedAssets = new Map<string, AssetPathEntry>();
    const linkedAssets = new Map<string, AssetPathEntry>();
    const value = getRecord(entity.value);
    const entityId = typeof value?.id === 'string' ? value.id : undefined;
    const assets = Array.isArray(value?.assets) ? value.assets : [];
    assets.forEach((asset, index) => {
      if (typeof asset !== 'string') {
        return;
      }
      const fieldPath = 'assets[' + index + ']';
      const path = normalizeResourcePath(asset);
      if (!path || !isInsideAssetsDirectory(path, assetsDirectory)) {
        addAssetDiagnostic(
          diagnostics,
          entity.file,
          entityId,
          'OQB-ASSET-001',
          '资源路径无效或不在配置的资源目录内：' + asset,
          fieldPath,
          '使用题库资源目录下的正斜杠相对文件路径',
        );
        return;
      }
      listedAssets.set(path, {
        file: entity.file,
        ...(entityId === undefined ? {} : { entityId }),
        fieldPath,
      });
    });

    for (const field of fields) {
      if (typeof field.value !== 'string') {
        continue;
      }
      for (const destination of extractMarkdownDestinations(field.value)) {
        const normalized = normalizeMarkdownResourcePath(destination);
        if (normalized.kind === 'ignored') {
          continue;
        }
        if (
          normalized.kind === 'invalid' ||
          !isInsideAssetsDirectory(normalized.path, assetsDirectory)
        ) {
          addAssetDiagnostic(
            diagnostics,
            entity.file,
            entityId,
            'OQB-ASSET-001',
            'Markdown 资源链接路径无效或不在配置的资源目录内：' + destination,
            field.path,
            '使用题库资源目录下的正斜杠相对文件路径',
          );
          continue;
        }
        if (!linkedAssets.has(normalized.path)) {
          linkedAssets.set(normalized.path, {
            file: entity.file,
            ...(entityId === undefined ? {} : { entityId }),
            fieldPath: field.path,
          });
        }
      }
    }
    for (const [path, entry] of linkedAssets) {
      if (!listedAssets.has(path)) {
        addAssetDiagnostic(
          diagnostics,
          entry.file,
          entry.entityId,
          'OQB-ASSET-003',
          'Markdown 资源链接未列入 assets：' + path,
          entry.fieldPath,
          '将资源路径加入当前实体的 assets 列表',
        );
      }
    }
    for (const [path, entry] of listedAssets) {
      if (!linkedAssets.has(path)) {
        addAssetDiagnostic(
          diagnostics,
          entry.file,
          entry.entityId,
          'OQB-ASSET-004',
          'assets 中的资源未被 Markdown 链接引用：' + path,
          entry.fieldPath,
          '在 Markdown 正文中引用该资源，或从 assets 列表移除它',
        );
      }
    }

    const checkedPaths = new Set<string>();
    for (const [path, entry] of [...listedAssets, ...linkedAssets]) {
      if (checkedPaths.has(path)) {
        continue;
      }
      checkedPaths.add(path);
      const result = await inspectAssetFile(canonicalRoot, path);
      if (result === 'valid') {
        continue;
      }
      const unsafe = result === 'unsafe';
      addAssetDiagnostic(
        diagnostics,
        entry.file,
        entry.entityId,
        unsafe ? 'OQB-ASSET-001' : 'OQB-ASSET-002',
        unsafe
          ? '资源路径包含符号链接或越出题库根目录：' + path
          : '资源文件不存在、不是普通文件或无法检查：' + path,
        entry.fieldPath,
        '确认资源文件存在于题库资源目录中且路径各级均为普通目录或文件',
      );
    }
  }
}

function normalizeDirectoryPath(value: string): string | undefined {
  const normalized = value.endsWith('/') ? value.slice(0, -1) : value;
  return normalizeResourcePath(normalized);
}

function normalizeResourcePath(value: string): string | undefined {
  if (
    value.length === 0 ||
    value.includes('\0') ||
    value.includes(':') ||
    value.includes('\\') ||
    value.startsWith('/')
  ) {
    return undefined;
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return undefined;
  }
  return segments.join('/');
}

function normalizeMarkdownResourcePath(
  destination: string,
): { kind: 'ignored' } | { kind: 'invalid' } | { kind: 'path'; path: string } {
  const unescaped = unescapeMarkdownDestination(destination);
  const queryIndex = unescaped.indexOf('?');
  const fragmentIndex = unescaped.indexOf('#');
  const suffixIndex = [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), unescaped.length);
  const withoutSuffix = unescaped.slice(0, suffixIndex);
  if (/^[A-Za-z]:[\\/]/.test(withoutSuffix)) {
    return { kind: 'invalid' };
  }
  if (/^file:/i.test(withoutSuffix)) {
    return { kind: 'invalid' };
  }
  if (
    withoutSuffix.length === 0 ||
    /^\/\//.test(withoutSuffix) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/i.test(withoutSuffix)
  ) {
    return { kind: 'ignored' };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
    return { kind: 'invalid' };
  }
  const path = normalizeResourcePath(decoded);
  return path ? { kind: 'path', path } : { kind: 'invalid' };
}

function unescapeMarkdownDestination(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    const next = value[index + 1] ?? '';
    const code = next.charCodeAt(0);
    const isEscapable =
      (code >= 33 && code <= 47) ||
      (code >= 58 && code <= 64) ||
      (code >= 91 && code <= 96) ||
      (code >= 123 && code <= 126);
    if (character === '\\' && isEscapable) {
      result += next;
      index += 1;
    } else {
      result += character;
    }
  }
  return result;
}

function isInsideAssetsDirectory(path: string, assetsDirectory: string): boolean {
  return path.startsWith(assetsDirectory + '/');
}

async function inspectAssetFile(
  canonicalRoot: string,
  relativePath: string,
): Promise<'valid' | 'missing' | 'unsafe' | 'unavailable'> {
  const segments = relativePath.split('/');
  let currentPath = canonicalRoot;
  try {
    for (const [index, segment] of segments.entries()) {
      currentPath = resolve(currentPath, segment);
      const metadata = await lstat(currentPath);
      if (metadata.isSymbolicLink()) {
        return 'unsafe';
      }
      const isLast = index === segments.length - 1;
      if ((isLast && !metadata.isFile()) || (!isLast && !metadata.isDirectory())) {
        return 'missing';
      }
      const canonicalPath = await realpath(currentPath);
      if (!isContained(canonicalRoot, canonicalPath)) {
        return 'unsafe';
      }
    }
  } catch (error) {
    if (isMissingPath(error)) {
      return 'missing';
    }
    return 'unavailable';
  }
  return 'valid';
}

function isContained(rootPath: string, targetPath: string): boolean {
  const pathFromRoot = relative(rootPath, targetPath);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith('..' + sep) && pathFromRoot !== '..' && !isAbsolutePath(pathFromRoot))
  );
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith(sep) || /^[A-Za-z]:[\\/]/.test(value);
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function addAssetDiagnostic(
  diagnostics: Diagnostic[],
  file: string,
  entityId: string | undefined,
  code: string,
  message: string,
  fieldPath: string,
  suggestion: string,
): void {
  diagnostics.push({
    code,
    severity: 'error',
    message,
    file,
    ...(entityId === undefined ? {} : { entityId }),
    fieldPath,
    suggestion,
  });
}

function extractMarkdownDestinations(markdown: string): string[] {
  const source = maskCode(markdown);
  const referencePattern =
    /^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]*)>|((?:\\.|[^ \t\r\n])+))/gm;
  const references = new Map<string, string>();
  const searchableCharacters = source.split('');
  for (const match of source.matchAll(referencePattern)) {
    const label = match[1];
    const destination = match[2] ?? match[3];
    if (label && destination) {
      references.set(normalizeReferenceLabel(label), destination);
      const start = match.index;
      if (start !== undefined) {
        maskRange(searchableCharacters, start, start + match[0].length);
      }
    }
  }
  const searchableSource = searchableCharacters.join('');
  const bracketPairs = findBracketPairs(searchableSource);
  const destinations: string[] = [];
  for (let index = 0; index < searchableSource.length; index += 1) {
    if (searchableSource[index] === '\\') {
      index += 1;
      continue;
    }
    const isImage = searchableSource[index] === '!' && searchableSource[index + 1] === '[';
    if (!isImage && searchableSource[index] !== '[') {
      continue;
    }
    const openBracket = isImage ? index + 1 : index;
    const closeBracket = bracketPairs.get(openBracket);
    if (closeBracket === undefined) {
      continue;
    }
    const openParenthesis = closeBracket + 1;
    if (searchableSource[openParenthesis] === '(') {
      const parsed = parseInlineDestination(searchableSource, openParenthesis);
      if (parsed) {
        destinations.push(parsed.destination);
        index = parsed.endIndex;
      } else {
        index = closeBracket;
      }
      continue;
    }

    const label = searchableSource.slice(openBracket + 1, closeBracket);
    let referenceStart = closeBracket + 1;
    while (/\s/.test(searchableSource[referenceStart] ?? '')) {
      referenceStart += 1;
    }
    if (searchableSource[referenceStart] === '[') {
      const referenceEnd = bracketPairs.get(referenceStart);
      if (referenceEnd !== undefined) {
        const explicitLabel = searchableSource.slice(referenceStart + 1, referenceEnd);
        const destination = references.get(normalizeReferenceLabel(explicitLabel || label));
        if (destination) {
          destinations.push(destination);
          index = referenceEnd;
          continue;
        }
      }
    }
    const shortcutDestination = references.get(normalizeReferenceLabel(label));
    if (shortcutDestination) {
      destinations.push(shortcutDestination);
    }
    index = closeBracket;
  }
  return destinations;
}

function findBracketPairs(source: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const openBrackets: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
    } else if (source[index] === '[') {
      openBrackets.push(index);
    } else if (source[index] === ']') {
      const openBracket = openBrackets.pop();
      if (openBracket !== undefined) {
        pairs.set(openBracket, index);
      }
    }
  }
  return pairs;
}

function normalizeReferenceLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function maskCode(markdown: string): string {
  const characters = markdown.split('');
  let lineStart = 0;
  let fence: { marker: string; length: number } | undefined;
  while (lineStart < markdown.length) {
    const newlineIndex = markdown.indexOf('\n', lineStart);
    const lineEnd = newlineIndex < 0 ? markdown.length : newlineIndex;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, '');
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const closingMatch = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
      maskRange(characters, lineStart, lineEnd);
      const closingMarker = closingMatch?.[1];
      if (
        closingMarker &&
        closingMarker[0] === fence.marker &&
        closingMarker.length >= fence.length
      ) {
        fence = undefined;
      }
    } else if (fenceMatch?.[1]) {
      fence = { marker: fenceMatch[1][0] ?? '', length: fenceMatch[1].length };
      maskRange(characters, lineStart, lineEnd);
    }
    lineStart = newlineIndex < 0 ? markdown.length : newlineIndex + 1;
  }

  const masked = characters.join('');
  const backtick = String.fromCharCode(96);
  const runs: Array<{ start: number; end: number; length: number }> = [];
  let index = 0;
  while (index < masked.length) {
    if (masked[index] !== backtick) {
      index += 1;
      continue;
    }
    let runLength = 1;
    while (masked[index + runLength] === backtick) {
      runLength += 1;
    }
    runs.push({ start: index, end: index + runLength, length: runLength });
    index += runLength;
  }

  const nextRunIndices: Array<number | undefined> = new Array(runs.length);
  const latestRunByLength = new Map<number, number>();
  for (let runIndex = runs.length - 1; runIndex >= 0; runIndex -= 1) {
    const run = runs[runIndex];
    if (!run) {
      continue;
    }
    nextRunIndices[runIndex] = latestRunByLength.get(run.length);
    latestRunByLength.set(run.length, runIndex);
  }
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex];
    const closingRunIndex = nextRunIndices[runIndex];
    const closingRun = closingRunIndex === undefined ? undefined : runs[closingRunIndex];
    if (!run || closingRunIndex === undefined || !closingRun) {
      continue;
    }
    maskRange(characters, run.start, closingRun.end);
    runIndex = closingRunIndex;
  }
  return characters.join('');
}

function maskRange(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== '\n' && characters[index] !== '\r') {
      characters[index] = ' ';
    }
  }
}

function parseInlineDestination(
  source: string,
  openParenthesis: number,
): { destination: string; endIndex: number } | undefined {
  let cursor = openParenthesis + 1;
  while (/\s/.test(source[cursor] ?? '')) {
    cursor += 1;
  }
  let destination = '';
  if (source[cursor] === '<') {
    cursor += 1;
    while (cursor < source.length && source[cursor] !== '>') {
      const character = source[cursor] ?? '';
      const nextCharacter = source[cursor + 1];
      if (character === '\\' && nextCharacter !== undefined) {
        destination += character + nextCharacter;
        cursor += 2;
      } else {
        destination += character;
        cursor += 1;
      }
    }
    if (source[cursor] !== '>') {
      return undefined;
    }
    cursor += 1;
  } else {
    let nestedParentheses = 0;
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === '\\' && cursor + 1 < source.length) {
        destination += character + source[cursor + 1];
        cursor += 2;
        continue;
      }
      if (character === '(') {
        nestedParentheses += 1;
      } else if (character === ')') {
        if (nestedParentheses === 0) {
          break;
        }
        nestedParentheses -= 1;
      } else if (/\s/.test(character ?? '') && nestedParentheses === 0) {
        break;
      }
      destination += character;
      cursor += 1;
    }
  }
  if (destination.length === 0) {
    return undefined;
  }
  while (/\s/.test(source[cursor] ?? '')) {
    cursor += 1;
  }
  if (source[cursor] !== ')') {
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") {
      return undefined;
    }
    cursor += 1;
    while (cursor < source.length) {
      if (source[cursor] === '\\') {
        cursor += 2;
      } else if (source[cursor] === quote) {
        cursor += 1;
        break;
      } else {
        cursor += 1;
      }
    }
    while (/\s/.test(source[cursor] ?? '')) {
      cursor += 1;
    }
  }
  if (source[cursor] !== ')') {
    return undefined;
  }
  return { destination, endIndex: cursor };
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
