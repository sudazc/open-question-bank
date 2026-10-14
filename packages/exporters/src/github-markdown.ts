import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type {
  Exam,
  ExamItem,
  Knowledge,
  Question,
  QuestionGroup,
  Topic,
} from '@openquestionbank/schema';
import type { QuestionBankData } from '@openquestionbank/core';
import { normalizeExportAssets, type ExportAsset } from './export-common.js';
import type { ExportFile } from './export-writer.js';

const format = 'openquestionbank-github-markdown';
const formatVersion = '1.0.0';

type EntityKind = 'topic' | 'knowledge' | 'question' | 'group' | 'exam';

interface EntityTarget {
  path: string;
  label: string;
}

export interface GithubMarkdownExportManifest {
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

export interface GithubMarkdownExportPackage {
  manifest: GithubMarkdownExportManifest;
  files: ExportFile[];
  assets: ExportAsset[];
}

/** 生成面向 GitHub 阅读的 Markdown 页面、资源映射和发布清单 */
export function createQuestionBankGithubMarkdownExport(
  data: QuestionBankData,
  assets: readonly ExportAsset[],
): GithubMarkdownExportPackage {
  const bank = data.bank;
  if (!bank) {
    throw new Error('GitHub Markdown 导出要求存在有效的 Bank 实体');
  }

  const normalizedAssets = normalizeExportAssets(data, assets);
  const targets = createEntityTargets(data);
  const markdownFiles: ExportFile[] = [
    { path: 'README.md', contents: renderBankReadme(data, targets, normalizedAssets) },
    ...renderCollectionIndexes(data, targets),
    ...renderTopicFiles(data.topics, targets, normalizedAssets),
    ...renderKnowledgeFiles(data.knowledge, targets, normalizedAssets),
    ...renderQuestionFiles(data.questions, targets, normalizedAssets),
    ...renderGroupFiles(data.groups, targets, normalizedAssets),
    ...renderExamFiles(data.exams, targets, normalizedAssets),
  ].sort((left, right) => compareStrings(left.path, right.path));
  const entityCounts = {
    bank: 1 as const,
    topics: data.topics.length,
    knowledge: data.knowledge.length,
    questions: data.questions.length,
    groups: data.groups.length,
    exams: data.exams.length,
  };
  const manifest: GithubMarkdownExportManifest = {
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
      ...normalizedAssets,
    ].sort((left, right) => compareStrings(left.path, right.path)),
  };

  return {
    manifest,
    files: [...markdownFiles, { path: 'manifest.json', contents: stableJson(manifest) }].sort(
      (left, right) => compareStrings(left.path, right.path),
    ),
    assets: normalizedAssets,
  };
}

/** 列出 GitHub Markdown 导出会生成的文件路径 */
export function getQuestionBankGithubMarkdownFilePaths(data: QuestionBankData): string[] {
  return [
    'README.md',
    'manifest.json',
    ...collectionDefinitions.map(({ path }) => `${path}/README.md`),
    ...data.topics.map((entity) => entityFilePath('topic', entity.id)),
    ...data.knowledge.map((entity) => entityFilePath('knowledge', entity.id)),
    ...data.questions.map((entity) => entityFilePath('question', entity.id)),
    ...data.groups.map((entity) => entityFilePath('group', entity.id)),
    ...data.exams.map((entity) => entityFilePath('exam', entity.id)),
  ].sort(compareStrings);
}

const collectionDefinitions: Array<{
  kind: EntityKind;
  path: string;
  title: string;
}> = [
  { kind: 'topic', path: 'topics', title: '考点' },
  { kind: 'knowledge', path: 'knowledge', title: '知识笔记' },
  { kind: 'question', path: 'questions', title: '题目' },
  { kind: 'group', path: 'groups', title: '材料题组' },
  { kind: 'exam', path: 'exams', title: '试卷' },
];

function createEntityTargets(data: QuestionBankData): Map<EntityKind, Map<string, EntityTarget>> {
  const targets = new Map<EntityKind, Map<string, EntityTarget>>();
  targets.set(
    'topic',
    new Map(data.topics.map((entity) => [entity.id, targetFor('topic', entity.id, entity.name)])),
  );
  targets.set(
    'knowledge',
    new Map(
      data.knowledge.map((entity) => [entity.id, targetFor('knowledge', entity.id, entity.title)]),
    ),
  );
  targets.set(
    'question',
    new Map(
      data.questions.map((entity) => [
        entity.id,
        targetFor('question', entity.id, `题目 ${entity.id}`),
      ]),
    ),
  );
  targets.set(
    'group',
    new Map(data.groups.map((entity) => [entity.id, targetFor('group', entity.id, entity.title)])),
  );
  targets.set(
    'exam',
    new Map(data.exams.map((entity) => [entity.id, targetFor('exam', entity.id, entity.title)])),
  );
  return targets;
}

function renderBankReadme(
  data: QuestionBankData,
  targets: Map<EntityKind, Map<string, EntityTarget>>,
  assets: readonly ExportAsset[],
): string {
  const bank = data.bank;
  if (!bank) {
    throw new Error('GitHub Markdown 导出要求存在有效的 Bank 实体');
  }

  const counts: Record<EntityKind, number> = {
    topic: data.topics.length,
    knowledge: data.knowledge.length,
    question: data.questions.length,
    group: data.groups.length,
    exam: data.exams.length,
  };
  const maintainers = bank.maintainers.map((maintainer) => escapeMarkdownText(maintainer.name));
  return finishMarkdown([
    `# ${escapeMarkdownHeading(bank.name)}`,
    bank.description ? rewriteMarkdown(bank.description, 'README.md', assets, targets) : '',
    [
      `- 题库 ID：\`${escapeInlineCode(bank.id)}\``,
      `- 版本：${escapeMarkdownText(bank.version)}`,
      `- Schema：${escapeMarkdownText(bank.schemaVersion)}`,
      `- 语言：${escapeMarkdownText(bank.language)}`,
      `- 许可证：${escapeMarkdownText(bank.license)}`,
      ...(maintainers.length > 0 ? [`- 维护者：${maintainers.join('、')}`] : []),
    ].join('\n'),
    `## 内容概览\n\n${[
      `考点 ${counts.topic}`,
      `知识笔记 ${counts.knowledge}`,
      `题目 ${counts.question}`,
      `材料题组 ${counts.group}`,
      `试卷 ${counts.exam}`,
    ].join(' · ')}`,
    `## 浏览题库\n\n${collectionDefinitions
      .map(({ kind, path, title }) => `- [${title}（${counts[kind]}）](${path}/README.md)`)
      .join('\n')}`,
    '本目录由 OpenQuestionBank 生成，适合直接在 GitHub 中阅读。实体页面保留稳定 ID，题库内部链接和资源链接已转换为相对路径。',
  ]);
}

function renderCollectionIndexes(
  data: QuestionBankData,
  targets: Map<EntityKind, Map<string, EntityTarget>>,
): ExportFile[] {
  const entitiesByKind = new Map<EntityKind, Array<{ id: string }>>([
    ['topic', data.topics],
    ['knowledge', data.knowledge],
    ['question', data.questions],
    ['group', data.groups],
    ['exam', data.exams],
  ]);

  return collectionDefinitions.map(({ kind, path, title }) => {
    const entities = entitiesByKind.get(kind) ?? [];
    const entries = entities
      .slice()
      .sort((left, right) => compareStrings(left.id, right.id))
      .map((entity) => {
        const target = getEntityTarget(targets, kind, entity.id);
        return `- ${markdownLink(target.label, relativeMarkdownLink(`${path}/README.md`, target.path))} · \`${escapeInlineCode(entity.id)}\``;
      });
    return {
      path: `${path}/README.md`,
      contents: finishMarkdown([
        `# ${title}`,
        `共 ${entities.length} 条`,
        entries.length > 0 ? entries.join('\n') : '暂无内容。',
      ]),
    };
  });
}

function renderTopicFiles(
  topics: Topic[],
  targets: Map<EntityKind, Map<string, EntityTarget>>,
  assets: readonly ExportAsset[],
): ExportFile[] {
  return topics.map((topic) => {
    const path = entityFilePath('topic', topic.id);
    const sections = [
      `# ${escapeMarkdownHeading(topic.name)}`,
      `- 稳定 ID：\`${escapeInlineCode(topic.id)}\``,
      `- 排序：${topic.order}`,
      ...(topic.aliases?.length
        ? [`- 别名：${topic.aliases.map(escapeMarkdownText).join('、')}`]
        : []),
      ...(topic.parentId
        ? [`## 父考点\n\n${entityMarkdownLink('topic', topic.parentId, path, targets)}`]
        : []),
      ...(topic.description ? [rewriteMarkdown(topic.description, path, assets, targets)] : []),
    ];
    return { path, contents: finishMarkdown(sections) };
  });
}

function renderKnowledgeFiles(
  knowledge: Knowledge[],
  targets: Map<EntityKind, Map<string, EntityTarget>>,
  assets: readonly ExportAsset[],
): ExportFile[] {
  return knowledge.map((entity) => {
    const path = entityFilePath('knowledge', entity.id);
    const sections = [
      `# ${escapeMarkdownHeading(entity.title)}`,
      renderIdentity(entity.id, entity.summary),
      renderEntityLinks('所属考点', entity.topicIds, 'topic', path, targets),
      renderEntityLinks('前置知识', entity.prerequisiteIds, 'knowledge', path, targets),
      renderEntityLinks('相关知识', entity.relatedIds, 'knowledge', path, targets),
      renderTags(entity.tags),
      renderSourceAndReview(entity.source, entity.review),
      rewriteMarkdown(entity.body, path, assets, targets),
    ];
    return { path, contents: finishMarkdown(sections) };
  });
}

function renderQuestionFiles(
  questions: Question[],
  targets: Map<EntityKind, Map<string, EntityTarget>>,
  assets: readonly ExportAsset[],
): ExportFile[] {
  return questions.map((question) => {
    const path = entityFilePath('question', question.id);
    const sections = [
      `# ${escapeMarkdownHeading(singleLine(question.stem))}`,
      renderIdentity(
        question.id,
        `${question.type} · ${question.difficulty} · ${question.score} 分`,
      ),
      `## 题干\n\n${rewriteMarkdown(question.stem, path, assets, targets)}`,
      renderQuestionChoices(question),
      `## 答案\n\n${renderQuestionAnswer(question)}`,
      ...(question.explanation
        ? [`## 解析\n\n${rewriteMarkdown(question.explanation, path, assets, targets)}`]
        : []),
      renderEntityLinks('所属考点', question.topicIds, 'topic', path, targets),
      renderEntityLinks('关联知识', question.knowledgeIds, 'knowledge', path, targets),
      renderTags(question.tags),
      renderSourceAndReview(question.source, question.review),
    ];
    return { path, contents: finishMarkdown(sections) };
  });
}

function renderGroupFiles(
  groups: QuestionGroup[],
  targets: Map<EntityKind, Map<string, EntityTarget>>,
  assets: readonly ExportAsset[],
): ExportFile[] {
  return groups.map((group) => {
    const path = entityFilePath('group', group.id);
    const sections = [
      `# ${escapeMarkdownHeading(group.title)}`,
      renderIdentity(group.id),
      `## 材料\n\n${rewriteMarkdown(group.passage, path, assets, targets)}`,
      renderEntityLinks('子题', group.questionIds, 'question', path, targets),
      renderEntityLinks('所属考点', group.topicIds, 'topic', path, targets),
      renderTags(group.tags ?? []),
      renderSourceAndReview(group.source, group.review),
    ];
    return { path, contents: finishMarkdown(sections) };
  });
}

function renderExamFiles(
  exams: Exam[],
  targets: Map<EntityKind, Map<string, EntityTarget>>,
  assets: readonly ExportAsset[],
): ExportFile[] {
  return exams.map((exam) => {
    const path = entityFilePath('exam', exam.id);
    const sections = [
      `# ${escapeMarkdownHeading(exam.title)}`,
      renderIdentity(exam.id, `${exam.mode}${'kind' in exam ? ` · ${exam.kind}` : ''}`),
      ...(exam.description
        ? [`## 说明\n\n${rewriteMarkdown(exam.description, path, assets, targets)}`]
        : []),
      `## 试卷内容\n\n${renderExamContents(exam, path, targets)}`,
      ...(exam.durationMinutes !== undefined ? [`时长：${exam.durationMinutes} 分钟`] : []),
    ];
    return { path, contents: finishMarkdown(sections) };
  });
}

function renderQuestionChoices(question: Question): string {
  if (!('choices' in question)) {
    return '';
  }
  const correctIds =
    question.type === 'single_choice'
      ? new Set([question.answer.choiceId])
      : question.type === 'multiple_choice'
        ? new Set(question.answer.choiceIds)
        : new Set<string>();
  const choices = question.choices.map((choice, index) => {
    const label = String.fromCharCode(65 + index);
    const marker = correctIds.has(choice.id) ? '☑' : '☐';
    return `- ${marker} **${label}.** ${escapeMarkdownText(choice.text)}`;
  });
  return `## 选项\n\n${choices.join('\n')}`;
}

function renderQuestionAnswer(question: Question): string {
  switch (question.type) {
    case 'single_choice': {
      const choice = question.choices.find(({ id }) => id === question.answer.choiceId);
      if (!choice) {
        throw new Error(`单选题答案选项不存在：${question.id}/${question.answer.choiceId}`);
      }
      return `${escapeMarkdownText(choice.text)}（${escapeMarkdownText(choice.id)}）`;
    }
    case 'multiple_choice': {
      const choices = question.answer.choiceIds.map((id) => {
        const choice = question.choices.find((item) => item.id === id);
        if (!choice) {
          throw new Error(`多选题答案选项不存在：${question.id}/${id}`);
        }
        return `${escapeMarkdownText(choice.text)}（${escapeMarkdownText(choice.id)}）`;
      });
      return choices.join('；');
    }
    case 'true_false':
      return question.answer ? '正确' : '错误';
    case 'fill_blank':
      return question.answer.blanks
        .map(
          (blank) =>
            `- ${escapeMarkdownText(blank.id)}：${blank.acceptedAnswers.map(escapeMarkdownText).join(' / ')}（大小写敏感：${(blank.caseSensitive ?? false) ? '是' : '否'}；空白处理：${blank.whitespace ?? 'trim'}）`,
        )
        .join('\n');
    case 'numeric': {
      const answer = `${escapeMarkdownText(question.answer.value)}${question.answer.unit ? ` ${escapeMarkdownText(question.answer.unit)}` : ''}`;
      const tolerance = question.tolerance;
      const details = [
        `绝对误差：${escapeMarkdownText(tolerance?.absolute ?? '0')}`,
        `相对误差：${escapeMarkdownText(tolerance?.relative ?? '0')}`,
        ...(question.unitRule
          ? [
              `单位规则：${escapeMarkdownText(question.unitRule.mode)}`,
              ...(question.unitRule.acceptedUnits?.length
                ? [
                    `可接受单位：${question.unitRule.acceptedUnits.map(escapeMarkdownText).join('、')}`,
                  ]
                : []),
            ]
          : []),
      ];
      return `${answer}\n\n${details.join('；')}`;
    }
    case 'short_answer': {
      const rubric = question.answer.rubric;
      const rubricMarkdown = rubric?.length
        ? `评分要点：\n\n${rubric
            .map(
              (item) =>
                `- ${escapeMarkdownText(item.description)}（${escapeMarkdownText(String(item.score))} 分）`,
            )
            .join('\n')}`
        : '';
      return [normalizeMarkdown(question.answer.referenceAnswer), rubricMarkdown]
        .filter((section) => section !== '')
        .join('\n\n');
    }
  }
}

function renderExamContents(
  exam: Exam,
  path: string,
  targets: Map<EntityKind, Map<string, EntityTarget>>,
): string {
  if (exam.mode === 'generated' && exam.kind === 'template') {
    return exam.rules
      .map((rule, index) => {
        const filters = rule.filters;
        const details = [
          `单元：${rule.unit === 'question' ? '题目' : '材料题组'}`,
          `数量：${rule.count}`,
          `每题分值：${rule.scorePerQuestion}`,
          ...(filters?.questionTypes?.length
            ? [`题型：${filters.questionTypes.map(escapeMarkdownText).join('、')}`]
            : []),
          ...(filters?.difficulty ? [`难度：${escapeMarkdownText(filters.difficulty)}`] : []),
        ];
        const topics = filters?.topicIds?.length
          ? `\n考点：${filters.topicIds.map((id) => entityMarkdownLink('topic', id, path, targets)).join('、')}`
          : '';
        return `${index + 1}. ${details.join('；')}${topics}`;
      })
      .join('\n');
  }

  if (exam.mode === 'generated' && exam.kind === 'result') {
    return `${renderExamItems(exam.items, path, targets)}\n\n随机种子：\`${escapeInlineCode(exam.randomSeed)}\`\n\n题库版本：${escapeMarkdownText(exam.bankVersion)} · 算法版本：${escapeMarkdownText(exam.algorithmVersion)}`;
  }
  return renderExamItems(exam.items, path, targets);
}

function renderExamItems(
  items: ExamItem[],
  path: string,
  targets: Map<EntityKind, Map<string, EntityTarget>>,
): string {
  return items
    .map((item, index) => {
      if (item.kind === 'question') {
        return `${index + 1}. ${entityMarkdownLink('question', item.questionId, path, targets)} · ${item.score} 分`;
      }
      const questions = item.questions
        .map(
          (question) =>
            `   - ${entityMarkdownLink('question', question.questionId, path, targets)} · ${question.score} 分`,
        )
        .join('\n');
      return `${index + 1}. ${entityMarkdownLink('group', item.groupId, path, targets)}\n${questions}`;
    })
    .join('\n');
}

function renderEntityLinks(
  title: string,
  ids: readonly string[],
  kind: EntityKind,
  sourcePath: string,
  targets: Map<EntityKind, Map<string, EntityTarget>>,
): string {
  if (ids.length === 0) {
    return '';
  }
  const links = ids.map((id) => entityMarkdownLink(kind, id, sourcePath, targets));
  return `## ${title}\n\n${links.join('、')}`;
}

function renderIdentity(id: string, description?: string): string {
  return `> 稳定 ID：\`${escapeInlineCode(id)}\`${description ? ` · ${escapeMarkdownText(description)}` : ''}`;
}

function renderTags(tags: readonly string[]): string {
  return tags.length > 0
    ? `## 标签\n\n${tags.map((tag) => `\`${escapeInlineCode(tag)}\``).join('、')}`
    : '';
}

function renderSourceAndReview(source: Question['source'], review: Question['review']): string {
  const fields = [
    `来源类型：${escapeMarkdownText(source.type)}`,
    ...(source.title ? [`来源标题：${escapeMarkdownText(source.title)}`] : []),
    ...(source.author ? [`作者：${escapeMarkdownText(source.author)}`] : []),
    ...(source.url ? [`来源链接：${escapeMarkdownText(source.url)}`] : []),
    ...(source.license ? [`来源许可证：${escapeMarkdownText(source.license)}`] : []),
    ...(source.attribution ? [`署名：${escapeMarkdownText(source.attribution)}`] : []),
    `审核状态：${escapeMarkdownText(review.status)}`,
    ...(review.reviewer ? [`审核人：${escapeMarkdownText(review.reviewer)}`] : []),
    ...(review.reviewedAt ? [`审核时间：${escapeMarkdownText(review.reviewedAt)}`] : []),
    ...(review.notes ? [`审核备注：${escapeMarkdownText(review.notes)}`] : []),
  ];
  return `## 来源与审核\n\n${fields.map((field) => `- ${field}`).join('\n')}`;
}

function rewriteMarkdown(
  markdown: string,
  sourcePath: string,
  assets: readonly ExportAsset[],
  targets: Map<EntityKind, Map<string, EntityTarget>>,
): string {
  let contents = normalizeMarkdown(markdown);
  const assetSources = new Set(assets.map(({ path }) => path));
  for (const assetPath of [...assetSources].sort((left, right) => right.length - left.length)) {
    const destination = relativeMarkdownLink(sourcePath, assetPath);
    const variants = [...new Set([assetPath, encodeRelativePath(assetPath)])].sort(
      (left, right) => right.length - left.length,
    );
    for (const variant of variants) {
      const pattern = new RegExp(
        `(^|[^A-Za-z0-9_./-])(${escapeRegExp(variant)})(?=$|[?#)\\s>])`,
        'gm',
      );
      contents = replaceMarkdownMatches(
        contents,
        pattern,
        (match) => `${match[1] ?? ''}${destination}`,
      );
    }
  }

  const referencePattern =
    /\boqb:\/\/(topic|knowledge|question|exam)\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})(?![A-Za-z0-9._:-])/g;
  contents = replaceMarkdownMatches(contents, referencePattern, (match) => {
    const kind = match[1] as EntityKind | undefined;
    const id = match[2];
    if (!kind || !id) {
      return match[0];
    }
    const target = getEntityTarget(targets, kind, id);
    return relativeMarkdownLink(sourcePath, target.path);
  });

  if (/\boqb:\/\//.test(maskMarkdownCode(contents))) {
    throw new Error(`Markdown 中包含不支持的内部引用：${sourcePath}`);
  }
  return contents;
}

function replaceMarkdownMatches(
  markdown: string,
  pattern: RegExp,
  replace: (match: RegExpMatchArray) => string,
): string {
  const visibleMarkdown = maskMarkdownCode(markdown);
  const matches = [...visibleMarkdown.matchAll(pattern)];
  let result = markdown;
  for (const match of matches.reverse()) {
    const start = match.index;
    if (start === undefined) {
      continue;
    }
    result = `${result.slice(0, start)}${replace(match)}${result.slice(start + match[0].length)}`;
  }
  return result;
}

function maskMarkdownCode(markdown: string): string {
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
      maskMarkdownRange(characters, lineStart, lineEnd);
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
      maskMarkdownRange(characters, lineStart, lineEnd);
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
    maskMarkdownRange(characters, run.start, closingRun.end);
    runIndex = closingRunIndex;
  }
  return characters.join('');
}

function maskMarkdownRange(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== '\n' && characters[index] !== '\r') {
      characters[index] = ' ';
    }
  }
}

function entityMarkdownLink(
  kind: EntityKind,
  id: string,
  sourcePath: string,
  targets: Map<EntityKind, Map<string, EntityTarget>>,
): string {
  const target = getEntityTarget(targets, kind, id);
  return markdownLink(target.label, relativeMarkdownLink(sourcePath, target.path));
}

function getEntityTarget(
  targets: Map<EntityKind, Map<string, EntityTarget>>,
  kind: EntityKind,
  id: string,
): EntityTarget {
  const target = targets.get(kind)?.get(id);
  if (!target) {
    throw new Error(`导出引用目标不存在或类型不匹配：${kind}/${id}`);
  }
  return target;
}

function targetFor(kind: EntityKind, id: string, label: string): EntityTarget {
  return { path: entityFilePath(kind, id), label };
}

function entityFilePath(kind: EntityKind, id: string): string {
  const directory = {
    topic: 'topics',
    knowledge: 'knowledge',
    question: 'questions',
    group: 'groups',
    exam: 'exams',
  }[kind];
  return `${directory}/${entityFilename(id)}`;
}

function entityFilename(id: string): string {
  const encodedId = id.replace(
    /[^A-Za-z0-9._-]/g,
    (character) => `~${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
  if (encodedId.length > 220) {
    return `id-~b64~${Buffer.from(id, 'utf8').toString('base64url')}.md`;
  }
  return `id-${encodedId}.md`;
}

function relativeMarkdownLink(sourcePath: string, targetPath: string): string {
  const relativePath = posix.relative(posix.dirname(sourcePath), targetPath);
  return encodeRelativePath(relativePath);
}

function encodeRelativePath(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

function markdownLink(label: string, destination: string): string {
  return `[${escapeMarkdownLinkLabel(label)}](${destination})`;
}

function escapeMarkdownLinkLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replace(/\r?\n/g, ' ');
}

function escapeMarkdownHeading(value: string): string {
  return escapeMarkdownText(singleLine(value));
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('*', '\\*')
    .replaceAll('_', '\\_')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll('#', '\\#')
    .replaceAll('+', '\\+')
    .replaceAll('.', '\\.')
    .replaceAll('!', '\\!')
    .replaceAll('|', '\\|')
    .replaceAll('>', '\\>')
    .replace(/</g, '&lt;')
    .replace(/\r?\n/g, ' ');
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, '\\`');
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function finishMarkdown(sections: readonly string[]): string {
  return `${sections
    .filter((section) => section.trim() !== '')
    .join('\n\n')
    .trimEnd()}\n`;
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new TypeError('GitHub Markdown 导出清单无法序列化');
  }
  return `${serialized}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
