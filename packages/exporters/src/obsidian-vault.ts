import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { QuestionBankData } from '@openquestionbank/core';
import { maskMarkdownCode } from './markdown-utils.js';
import type { ExportAsset } from './export-common.js';
import type { ExportFile } from './export-writer.js';
import {
  createQuestionBankGithubMarkdownExport,
  getQuestionBankGithubMarkdownFilePaths,
} from './github-markdown.js';

const format = 'openquestionbank-obsidian-vault';
const formatVersion = '1.0.0';
const manifestPath = 'manifest.json';
const githubIntroduction =
  '本目录由 OpenQuestionBank 生成，适合直接在 GitHub 中阅读。实体页面保留稳定 ID，题库内部链接和资源链接已转换为相对路径。';
const obsidianIntroduction =
  '此 Vault 由 OpenQuestionBank 生成，可在 Obsidian 中按考点、知识笔记和题目浏览。实体页面保留稳定 ID；题库内部引用使用 Wiki 链接，引用资源会作为 Vault 附件嵌入或链接。';

export interface ObsidianVaultExportManifest {
  format: typeof format;
  formatVersion: typeof formatVersion;
  schemaVersion: NonNullable<QuestionBankData['bank']>['schemaVersion'];
  bank: {
    id: string;
    name: string;
    version: string;
  };
  statistics: {
    entities: {
      bank: 1;
      topics: number;
      knowledge: number;
      questions: number;
      groups: number;
      exams: number;
    };
    totalEntities: number;
  };
  files: ExportAsset[];
}

export interface ObsidianVaultExportPackage {
  manifest: ObsidianVaultExportManifest;
  files: ExportFile[];
  assets: ExportAsset[];
}

/** 生成使用 Obsidian Wiki 链接的题库 Vault 和发布清单 */
export function createQuestionBankObsidianVaultExport(
  data: QuestionBankData,
  assets: readonly ExportAsset[],
): ObsidianVaultExportPackage {
  const bank = data.bank;
  if (!bank) {
    throw new Error('Obsidian Vault 导出要求存在有效的 Bank 实体');
  }

  const markdownPackage = createQuestionBankGithubMarkdownExport(data, assets);
  const markdownPaths = new Set(
    getQuestionBankGithubMarkdownFilePaths(data).filter((path) => path.endsWith('.md')),
  );
  const assetPaths = new Set(markdownPackage.assets.map(({ path }) => path));
  const markdownFiles = markdownPackage.files
    .filter(({ path }) => path.endsWith('.md'))
    .map(({ path, contents }) => ({
      path,
      contents: convertMarkdownLinks(
        path === 'README.md'
          ? contents.replace(githubIntroduction, obsidianIntroduction)
          : contents,
        path,
        markdownPaths,
        assetPaths,
      ),
    }))
    .sort((left, right) => compareStrings(left.path, right.path));
  const entityCounts = {
    bank: 1 as const,
    topics: data.topics.length,
    knowledge: data.knowledge.length,
    questions: data.questions.length,
    groups: data.groups.length,
    exams: data.exams.length,
  };
  const manifest: ObsidianVaultExportManifest = {
    format,
    formatVersion,
    schemaVersion: bank.schemaVersion,
    bank: { id: bank.id, name: bank.name, version: bank.version },
    statistics: {
      entities: entityCounts,
      totalEntities: Object.values(entityCounts).reduce((total, count) => total + count, 0),
    },
    files: [
      ...markdownFiles.map(({ path, contents }) => ({
        path,
        sizeBytes: Buffer.byteLength(contents, 'utf8'),
        sha256: createHash('sha256').update(contents, 'utf8').digest('hex'),
      })),
      ...markdownPackage.assets,
    ].sort((left, right) => compareStrings(left.path, right.path)),
  };

  return {
    manifest,
    files: [...markdownFiles, { path: manifestPath, contents: stableJson(manifest) }].sort(
      (left, right) => compareStrings(left.path, right.path),
    ),
    assets: markdownPackage.assets,
  };
}

/** 列出 Obsidian Vault 导出会生成的 Markdown 和清单路径 */
export function getQuestionBankObsidianVaultFilePaths(data: QuestionBankData): string[] {
  return getQuestionBankGithubMarkdownFilePaths(data);
}

function convertMarkdownLinks(
  markdown: string,
  sourcePath: string,
  markdownPaths: ReadonlySet<string>,
  assetPaths: ReadonlySet<string>,
): string {
  const visibleMarkdown = maskMarkdownCode(markdown);
  let result = '';
  let consumedUntil = 0;
  let index = 0;

  while (index < visibleMarkdown.length) {
    const image = visibleMarkdown[index] === '!' && visibleMarkdown[index + 1] === '[';
    const openingBracket = image ? index + 1 : index;
    if (visibleMarkdown[openingBracket] !== '[') {
      index += 1;
      continue;
    }

    const closingBracket = findClosingBracket(visibleMarkdown, openingBracket);
    if (
      closingBracket < 0 ||
      visibleMarkdown[closingBracket + 1] !== '(' ||
      closingBracket + 2 >= visibleMarkdown.length
    ) {
      index = openingBracket + 1;
      continue;
    }

    const closingParenthesis = findClosingParenthesis(visibleMarkdown, closingBracket + 1);
    if (closingParenthesis < 0) {
      index = closingBracket + 1;
      continue;
    }

    const destination = parseDestination(markdown.slice(closingBracket + 2, closingParenthesis));
    const converted = destination
      ? convertDestination(
          destination,
          sourcePath,
          markdownPaths,
          assetPaths,
          image,
          markdown.slice(openingBracket + 1, closingBracket),
        )
      : undefined;
    if (!converted) {
      index = closingParenthesis + 1;
      continue;
    }

    const linkStart = image ? index : openingBracket;
    result += markdown.slice(consumedUntil, linkStart);
    result += converted;
    consumedUntil = closingParenthesis + 1;
    index = consumedUntil;
  }

  return result + markdown.slice(consumedUntil);
}

function convertDestination(
  destination: string,
  sourcePath: string,
  markdownPaths: ReadonlySet<string>,
  assetPaths: ReadonlySet<string>,
  image: boolean,
  label: string,
): string | undefined {
  if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/|\/)/.test(destination)) {
    return undefined;
  }

  const match = /^([^?#]*)(?:\?[^#]*)?(#.*)?$/.exec(destination);
  const pathPart = match?.[1] ?? '';
  const fragment = match?.[2] ?? '';
  let targetPath: string;
  try {
    targetPath = pathPart
      ? posix.normalize(posix.join(posix.dirname(sourcePath), decodeURIComponent(pathPart)))
      : sourcePath;
  } catch {
    return undefined;
  }

  if (targetPath === '..' || targetPath.startsWith('../') || targetPath.startsWith('/')) {
    return undefined;
  }
  const isMarkdown = markdownPaths.has(targetPath);
  const isAsset = assetPaths.has(targetPath);
  if (!isMarkdown && !isAsset) {
    return undefined;
  }

  const wikiPath = isMarkdown ? targetPath.replace(/\.md$/, '') : targetPath;
  const alias = wikiAlias(label);
  const aliasPart = !image && alias ? `|${alias}` : '';
  return `${image ? '!' : ''}[[${escapeWikiPath(wikiPath)}${escapeWikiFragment(fragment)}${aliasPart}]]`;
}

function findClosingBracket(markdown: string, openingBracket: number): number {
  let depth = 0;
  for (let index = openingBracket; index < markdown.length; index += 1) {
    if (markdown[index] === '\\') {
      index += 1;
      continue;
    }
    if (markdown[index] === '[') {
      depth += 1;
    } else if (markdown[index] === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findClosingParenthesis(markdown: string, openingParenthesis: number): number {
  let depth = 0;
  for (let index = openingParenthesis; index < markdown.length; index += 1) {
    if (markdown[index] === '\\') {
      index += 1;
      continue;
    }
    if (markdown[index] === '(') {
      depth += 1;
    } else if (markdown[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function parseDestination(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.startsWith('<')) {
    const closingBracket = trimmed.indexOf('>');
    return closingBracket < 0 ? undefined : unescapeMarkdown(trimmed.slice(1, closingBracket));
  }

  let parentheses = 0;
  let end = trimmed.length;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === '\\') {
      index += 1;
      continue;
    }
    if (trimmed[index] === '(') {
      parentheses += 1;
    } else if (trimmed[index] === ')' && parentheses > 0) {
      parentheses -= 1;
    } else if (/\s/.test(trimmed[index] ?? '') && parentheses === 0) {
      end = index;
      break;
    }
  }
  return unescapeMarkdown(trimmed.slice(0, end));
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([^A-Za-z0-9\s])/g, '$1');
}

function wikiAlias(value: string): string {
  return unescapeMarkdown(value)
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(?<!\w)(\*|_)(.+?)\1(?!\w)/g, '$2')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function escapeWikiPath(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/#/g, '\\#')
    .replace(/\]/g, '\\]')
    .replace(/\[/g, '\\[');
}

function escapeWikiFragment(value: string): string {
  return value ? `#${value.slice(1).replace(/\|/g, '\\|').replace(/\]/g, '\\]')}` : '';
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new TypeError('Obsidian Vault 导出清单无法序列化');
  }
  return `${serialized}\n`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
