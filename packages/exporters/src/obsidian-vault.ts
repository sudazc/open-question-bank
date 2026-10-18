import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { Question } from '@openquestionbank/schema';
import type { QuestionBankData } from '@openquestionbank/core';
import { maskMarkdownCode } from './markdown-utils.js';
import { assertUniquePortableExportPaths, type ExportAsset } from './export-common.js';
import type { ExportFile } from './export-writer.js';
import {
  createQuestionBankGithubMarkdownExport,
  findQuestionAnswerSection,
  getQuestionBankGithubMarkdownEntityFilePath,
  getQuestionBankGithubMarkdownFilePaths,
} from './github-markdown.js';

const format = 'openquestionbank-obsidian-vault';
const formatVersion = '2.1.0';
const manifestPath = 'manifest.json';
const githubIntroduction =
  '本目录由 OpenQuestionBank 生成，适合直接在 GitHub 中阅读。实体页面保留稳定 ID，题库内部链接和资源链接已转换为相对路径。';
const obsidianIntroduction =
  '此 Vault 由 OpenQuestionBank 生成，可在 Obsidian 中按考点、知识笔记和题目浏览。页面使用可读标题，稳定 ID 保留在页面属性中；题库内部引用使用 Wiki 链接，引用资源会作为 Vault 附件嵌入或链接。';

type EntityKind = 'topic' | 'knowledge' | 'question' | 'group' | 'exam';

interface EntityPageTarget {
  kind: EntityKind;
  id: string;
  sourcePath: string;
  outputPath: string;
  title: string;
}

const questionTypeLabels: Record<Question['type'], string> = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
  fill_blank: '填空题',
  numeric: '数值题',
  short_answer: '简答题',
};

const invalidPageTitleCharacters = '<>:"/\\|?*#^[]';

const collectionDirectories = [
  { source: 'topics', output: '考点' },
  { source: 'knowledge', output: '知识笔记' },
  { source: 'questions', output: '题目' },
  { source: 'groups', output: '材料题组' },
  { source: 'exams', output: '试卷' },
] as const;

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
  const githubMarkdownPaths = getQuestionBankGithubMarkdownFilePaths(data).filter((path) =>
    path.endsWith('.md'),
  );
  const entityTargets = createEntityPageTargets(data);
  const targetBySourcePath = new Map(
    entityTargets.map((target) => [target.sourcePath, target] as const),
  );
  const outputPathBySourcePath = createMarkdownOutputPathMap(entityTargets);
  const markdownPaths = new Set(githubMarkdownPaths);
  const assetPaths = new Set(markdownPackage.assets.map(({ path }) => path));
  const markdownFiles = markdownPackage.files
    .filter(({ path }) => path.endsWith('.md'))
    .map(({ path, contents }) => {
      const target = targetBySourcePath.get(path);
      const preparedContents =
        path === 'README.md'
          ? contents.replace(githubIntroduction, obsidianIntroduction)
          : target
            ? prepareObsidianEntityPage(contents, target, entityTargets)
            : path.endsWith('/README.md')
              ? contents.replace(/ · `[^`]+`$/gm, '')
              : contents;
      return {
        path: outputPathBySourcePath.get(path) ?? path,
        contents: convertMarkdownLinks(
          preparedContents,
          path,
          markdownPaths,
          assetPaths,
          targetBySourcePath,
          outputPathBySourcePath,
        ),
      };
    })
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

  const files = [...markdownFiles, { path: manifestPath, contents: stableJson(manifest) }].sort(
    (left, right) => compareStrings(left.path, right.path),
  );
  assertUniquePortableExportPaths([
    ...files.map(({ path }) => path),
    ...markdownPackage.assets.map(({ path }) => path),
  ]);

  return {
    manifest,
    files,
    assets: markdownPackage.assets,
  };
}

/** 列出 Obsidian Vault 导出会生成的 Markdown 和清单路径 */
export function getQuestionBankObsidianVaultFilePaths(data: QuestionBankData): string[] {
  const entityTargets = createEntityPageTargets(data);
  const outputPathBySourcePath = createMarkdownOutputPathMap(entityTargets);
  return getQuestionBankGithubMarkdownFilePaths(data)
    .map((path) => outputPathBySourcePath.get(path) ?? path)
    .sort(compareStrings);
}

function convertMarkdownLinks(
  markdown: string,
  sourcePath: string,
  markdownPaths: ReadonlySet<string>,
  assetPaths: ReadonlySet<string>,
  entityTargets: ReadonlyMap<string, EntityPageTarget>,
  outputPathBySourcePath: ReadonlyMap<string, string>,
): string {
  const linkedMarkdown = rewriteMarkdownReferenceDestinations(
    markdown,
    sourcePath,
    markdownPaths,
    assetPaths,
    outputPathBySourcePath,
  );
  const visibleMarkdown = maskMarkdownCode(linkedMarkdown);
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

    const destination = parseDestination(
      linkedMarkdown.slice(closingBracket + 2, closingParenthesis),
    );
    const converted = destination
      ? convertDestination(
          destination,
          sourcePath,
          markdownPaths,
          assetPaths,
          entityTargets,
          outputPathBySourcePath,
          image,
          linkedMarkdown.slice(openingBracket + 1, closingBracket),
        )
      : undefined;
    if (!converted) {
      index = closingParenthesis + 1;
      continue;
    }

    const linkStart = image ? index : openingBracket;
    result += linkedMarkdown.slice(consumedUntil, linkStart);
    result += converted;
    consumedUntil = closingParenthesis + 1;
    index = consumedUntil;
  }

  return result + linkedMarkdown.slice(consumedUntil);
}

function rewriteMarkdownReferenceDestinations(
  markdown: string,
  sourcePath: string,
  markdownPaths: ReadonlySet<string>,
  assetPaths: ReadonlySet<string>,
  outputPathBySourcePath: ReadonlyMap<string, string>,
): string {
  const definitionPattern =
    /^(?:[ \t]{0,3}>[ \t]?)*[ \t]*\[[^\]\n]+\]:[ \t]*(<[^>\n]*>|(?:\\.|[^ \t\r\n])+)/gm;
  const matches = [...maskMarkdownCode(markdown).matchAll(definitionPattern)];
  let result = markdown;
  for (const match of matches.reverse()) {
    const start = match.index;
    const rawDestination = match[1];
    if (start === undefined || rawDestination === undefined) {
      continue;
    }
    const destination = parseDestination(rawDestination);
    const localDestination = destination
      ? resolveLocalDestination(destination, sourcePath, markdownPaths, assetPaths)
      : undefined;
    if (!localDestination) {
      continue;
    }
    const sourceOutputPath = outputPathBySourcePath.get(sourcePath) ?? sourcePath;
    const targetOutputPath =
      outputPathBySourcePath.get(localDestination.targetPath) ?? localDestination.targetPath;
    const relativePath = posix.relative(posix.dirname(sourceOutputPath), targetOutputPath);
    const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
    const replacement =
      '<' + encodedPath + localDestination.fragment.replace(/ /g, '%20').replace(/>/g, '%3E') + '>';
    const destinationStart = start + match[0].length - rawDestination.length;
    result =
      result.slice(0, destinationStart) +
      replacement +
      result.slice(destinationStart + rawDestination.length);
  }
  return result;
}

function resolveLocalDestination(
  destination: string,
  sourcePath: string,
  markdownPaths: ReadonlySet<string>,
  assetPaths: ReadonlySet<string>,
): { targetPath: string; fragment: string; isMarkdown: boolean } | undefined {
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
  if (!isMarkdown && !assetPaths.has(targetPath)) {
    return undefined;
  }
  return { targetPath, fragment, isMarkdown };
}

function convertDestination(
  destination: string,
  sourcePath: string,
  markdownPaths: ReadonlySet<string>,
  assetPaths: ReadonlySet<string>,
  entityTargets: ReadonlyMap<string, EntityPageTarget>,
  outputPathBySourcePath: ReadonlyMap<string, string>,
  image: boolean,
  label: string,
): string | undefined {
  const localDestination = resolveLocalDestination(
    destination,
    sourcePath,
    markdownPaths,
    assetPaths,
  );
  if (!localDestination) {
    return undefined;
  }
  const { targetPath, fragment, isMarkdown } = localDestination;
  const entityTarget = entityTargets.get(targetPath);
  const linkedPath = outputPathBySourcePath.get(targetPath) ?? targetPath;
  const wikiPath = isMarkdown ? linkedPath.replace(/\.md$/, '') : linkedPath;
  const alias = entityTarget?.title ?? wikiAlias(label);
  const aliasPart = !image && alias ? `|${alias}` : '';
  return `${image ? '!' : ''}[[${escapeWikiPath(wikiPath)}${escapeWikiFragment(fragment)}${aliasPart}]]`;
}

function createEntityPageTargets(data: QuestionBankData): EntityPageTarget[] {
  const entities: Array<{ kind: EntityKind; id: string; title: string }> = [
    ...data.topics.map((entity) => ({
      kind: 'topic' as const,
      id: entity.id,
      title: entity.name,
    })),
    ...data.knowledge.map((entity) => ({
      kind: 'knowledge' as const,
      id: entity.id,
      title: entity.title,
    })),
    ...data.questions.map((entity) => ({
      kind: 'question' as const,
      id: entity.id,
      title: questionPageTitle(entity.stem),
    })),
    ...data.groups.map((entity) => ({
      kind: 'group' as const,
      id: entity.id,
      title: entity.title,
    })),
    ...data.exams.map((entity) => ({
      kind: 'exam' as const,
      id: entity.id,
      title: entity.title,
    })),
  ].sort(
    (left, right) => compareStrings(left.kind, right.kind) || compareStrings(left.id, right.id),
  );

  const directoryByKind: Record<EntityKind, string> = {
    topic: '考点',
    knowledge: '知识笔记',
    question: '题目',
    group: '材料题组',
    exam: '试卷',
  };
  const usedNames = new Map<string, Set<string>>();
  return entities.map((entity) => {
    const directory = directoryByKind[entity.kind];
    const used = usedNames.get(directory) ?? new Set(['索引']);
    usedNames.set(directory, used);
    const baseName = safePageTitle(entity.title, entity.kind);
    let fileName = baseName;
    let suffix = 2;
    while (used.has(fileName.toLocaleLowerCase('en-US'))) {
      fileName = baseName + ' (' + suffix + ')';
      suffix += 1;
    }
    used.add(fileName.toLocaleLowerCase('en-US'));
    return {
      ...entity,
      title: fileName,
      sourcePath: getQuestionBankGithubMarkdownEntityFilePath(entity.kind, entity.id),
      outputPath: directory + '/' + fileName + '.md',
    };
  });
}

function createMarkdownOutputPathMap(
  entityTargets: readonly EntityPageTarget[],
): Map<string, string> {
  const outputPaths = new Map(
    entityTargets.map((target) => [target.sourcePath, target.outputPath] as const),
  );
  outputPaths.set('README.md', '题库首页.md');
  for (const { source, output } of collectionDirectories) {
    outputPaths.set(source + '/README.md', output + '/索引.md');
  }
  return outputPaths;
}

function prepareObsidianEntityPage(
  markdown: string,
  target: EntityPageTarget,
  entityTargets: readonly EntityPageTarget[],
): string {
  let result = markdown.replace(/^# .+$/m, '# ' + escapeMarkdownHeading(target.title));
  const codeTick = String.fromCharCode(96);
  const identityPrefix = '> 稳定 ID：' + codeTick + target.id + codeTick;
  result = result.replace(/^> 稳定 ID：.*$/m, (line) => {
    if (!line.startsWith(identityPrefix)) {
      return line;
    }
    const description = line.slice(identityPrefix.length).replace(/^ · /, '');
    return description ? '> ' + description : '';
  });
  result = result
    .split('\n')
    .filter((line) => !line.startsWith('- 稳定 ID：' + codeTick + target.id + codeTick))
    .join('\n');

  if (target.kind !== 'question') {
    return addObsidianProperties(result, target);
  }

  const typeLine = /^> (.+)$/m.exec(result);
  const sourceType = typeLine?.[1]?.split(' · ')[0];
  if (typeLine && sourceType) {
    const type = sourceType.replace(/\\_/g, '_');
    const localizedType = Object.entries(questionTypeLabels).find(([name]) => name === type)?.[1];
    if (localizedType) {
      result = result.replace(
        typeLine[0],
        '> ' + localizedType + (typeLine[1] ?? '').slice(sourceType.length),
      );
    }
  }
  result = neutralizeChoiceMarkers(result);
  result = collapseQuestionAnswer(result, target.id);

  const questions = entityTargets
    .filter(({ kind }) => kind === 'question')
    .sort((left, right) => compareStrings(left.id, right.id));
  const index = questions.findIndex(({ id }) => id === target.id);
  const navigation = renderQuestionNavigation(questions[index - 1], questions[index + 1]);
  result = result.replace(/^(# .+)$/m, '$1\n\n' + navigation);
  return addObsidianProperties(result, target);
}

function addObsidianProperties(markdown: string, target: EntityPageTarget): string {
  const properties = [
    '---',
    '题库ID: ' + JSON.stringify(target.id),
    '实体类型: ' + entityKindLabel(target.kind),
    '---',
  ].join('\n');
  return properties + '\n\n' + markdown;
}

function renderQuestionNavigation(
  previous: EntityPageTarget | undefined,
  next: EntityPageTarget | undefined,
): string {
  const previousLink = previous
    ? '[[' +
      escapeWikiPath(previous.outputPath.replace(/\.md$/, '')) +
      '|' +
      escapeWikiAlias(previous.title) +
      ']]'
    : '无';
  const nextLink = next
    ? '[[' +
      escapeWikiPath(next.outputPath.replace(/\.md$/, '')) +
      '|' +
      escapeWikiAlias(next.title) +
      ']]'
    : '无';
  return '> **上一题：** ' + previousLink + '　｜　**下一题：** ' + nextLink;
}

function neutralizeChoiceMarkers(markdown: string): string {
  const optionsHeading = '\n## 选项\n';
  const optionsStart = markdown.indexOf(optionsHeading);
  if (optionsStart < 0) {
    return markdown;
  }
  const contentStart = optionsStart + optionsHeading.length;
  const nextHeading = markdown.indexOf('\n## ', contentStart);
  const optionsEnd = nextHeading < 0 ? markdown.length : nextHeading;
  const options = markdown.slice(contentStart, optionsEnd).replace(/^- [☑☐] /gm, '- ');
  return markdown.slice(0, contentStart) + options + markdown.slice(optionsEnd);
}

function collapseQuestionAnswer(markdown: string, questionId: string): string {
  const section = findQuestionAnswerSection(markdown, questionId);
  if (!section) {
    throw new Error(`无法定位题目 ${questionId} 的答案区域，已取消 Obsidian 导出`);
  }

  const answerSection = markdown.slice(section.contentStart, section.end).trim();
  const details = answerSection.replace(/^## 答案[ \t]*\r?\n+/, '').trim();
  const folded = [
    '> [!question]- 显示答案与解析',
    ...details.split('\n').map((line) => (line ? '> ' + line : '>')),
  ].join('\n');
  const before = markdown.slice(0, section.start).trimEnd();
  const after = markdown.slice(section.contentEnd).trimStart();
  return before + '\n\n' + folded + (after ? '\n\n' + after : '');
}

function questionPageTitle(stem: string): string {
  const plainText = stem
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\\([\\_*{}[\]()#+.!<>|])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .split(String.fromCharCode(96))
    .join('');
  const characters = [...plainText];
  return characters.length > 56 ? characters.slice(0, 55).join('') + '…' : plainText;
}

function safePageTitle(value: string, kind: EntityKind): string {
  const sanitized = [...value.normalize('NFC')]
    .map((character) => {
      const codePoint = character.charCodeAt(0);
      return codePoint < 0x20 || invalidPageTitleCharacters.includes(character) ? ' ' : character;
    })
    .join('')
    .replace(/[\s]+/g, ' ')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim();
  let title = '';
  for (const character of [...sanitized].slice(0, 80)) {
    if (Buffer.byteLength(title + character, 'utf8') > 240) {
      break;
    }
    title += character;
  }
  title = title.replace(/[. ]+$/, '');
  if (!title) {
    return '未命名' + entityKindLabel(kind);
  }
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(title)
    ? entityKindLabel(kind) + ' ' + title
    : title;
}

function entityKindLabel(kind: EntityKind): string {
  return {
    topic: '考点',
    knowledge: '知识笔记',
    question: '题目',
    group: '材料题组',
    exam: '试卷',
  }[kind];
}

function escapeMarkdownHeading(value: string): string {
  return value
    .split(String.fromCharCode(96))
    .join('')
    .replace(/([\\_*{}[\]()#+.!<>|])/g, '\\$1');
}

function escapeWikiAlias(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\]/g, '\\]');
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
