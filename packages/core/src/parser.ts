import { parse } from 'yaml';

const maximumYamlNestingDepth = 128;

export interface ParsedMarkdownDocument {
  metadata: Record<string, unknown>;
  body: string;
}

export class DocumentParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
    this.name = 'DocumentParseError';
  }
}

/** 解析不包含自定义标签的 YAML 文档 */
export function parseYamlDocument(source: string): unknown {
  try {
    const value = parse(source, { maxAliasCount: 50, uniqueKeys: true });
    assertAcyclic(value);
    return value;
  } catch (error) {
    throw toDocumentParseError(error, 0);
  }
}

/** 将 Markdown Front Matter 与正文合并为标准化知识实体 */
export function parseMarkdownDocument(source: string): ParsedMarkdownDocument {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) {
    throw new DocumentParseError('Markdown 文件缺少有效的 YAML Front Matter');
  }

  let metadata: unknown;
  try {
    metadata = parse(match[1] ?? '', { maxAliasCount: 50, uniqueKeys: true });
    assertAcyclic(metadata);
  } catch (error) {
    throw toDocumentParseError(error, 1);
  }

  if (!isRecord(metadata)) {
    throw new DocumentParseError('YAML Front Matter 必须是对象');
  }
  if (Object.hasOwn(metadata, 'body')) {
    throw new DocumentParseError('正文必须写在 Front Matter 分隔线之后，不应设置 body 字段');
  }

  return {
    metadata,
    body: source.slice(match[0].length),
  };
}

function toDocumentParseError(error: unknown, lineOffset: number): DocumentParseError {
  if (error instanceof Error) {
    const position = getPosition(error);
    return new DocumentParseError(
      error.message,
      position.line === undefined ? undefined : position.line + lineOffset,
      position.column,
    );
  }
  return new DocumentParseError('无法解析文档');
}

function getPosition(error: Error): { line?: number; column?: number } {
  if (!('linePos' in error) || !Array.isArray(error.linePos)) {
    return {};
  }
  const position: unknown = error.linePos[0];
  if (!isRecord(position)) {
    return {};
  }
  return {
    ...(typeof position.line === 'number' ? { line: position.line } : {}),
    ...(typeof position.col === 'number' ? { column: position.col } : {}),
  };
}

function assertAcyclic(value: unknown): void {
  const states = new WeakMap<object, 'active' | 'complete'>();
  const subtreeHeights = new WeakMap<object, number>();
  const pending: Array<{ value: unknown; depth: number; exit: boolean }> = [
    { value, depth: 0, exit: false },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current.value !== 'object' || current.value === null) {
      continue;
    }
    const state = states.get(current.value);
    if (current.exit) {
      const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
      let subtreeHeight = 0;
      for (const child of children) {
        if (typeof child === 'object' && child !== null) {
          subtreeHeight = Math.max(subtreeHeight, (subtreeHeights.get(child) ?? 0) + 1);
        }
      }
      if (current.depth + subtreeHeight > maximumYamlNestingDepth) {
        throw new DocumentParseError(`YAML 文档嵌套超过 ${maximumYamlNestingDepth} 层`);
      }
      subtreeHeights.set(current.value, subtreeHeight);
      states.set(current.value, 'complete');
      continue;
    }
    if (state === 'active') {
      throw new DocumentParseError('YAML 文档包含循环别名');
    }
    if (state === 'complete') {
      if (current.depth + (subtreeHeights.get(current.value) ?? 0) > maximumYamlNestingDepth) {
        throw new DocumentParseError(`YAML 文档嵌套超过 ${maximumYamlNestingDepth} 层`);
      }
      continue;
    }
    if (current.depth > maximumYamlNestingDepth) {
      throw new DocumentParseError(`YAML 文档嵌套超过 ${maximumYamlNestingDepth} 层`);
    }
    states.set(current.value, 'active');
    pending.push({ value: current.value, depth: current.depth, exit: true });
    const children: unknown[] = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ value: children[index], depth: current.depth + 1, exit: false });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
