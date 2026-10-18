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
import { decodeHtmlCharacterReferences, type QuestionBankData } from '@openquestionbank/core';
import {
  assertUniquePortableExportPaths,
  normalizeExportAssets,
  type ExportAsset,
} from './export-common.js';
import { maskMarkdownCode } from './markdown-utils.js';
import type { ExportFile } from './export-writer.js';

const format = 'openquestionbank-github-markdown';
const formatVersion = '1.2.0';

const sourceTypeLabels: Record<Question['source']['type'], string> = {
  original: '原创',
  official_public: '官方公开资料',
  licensed: '已获许可',
  adapted: '改编',
  unknown: '未知',
};

const reviewStatusLabels: Record<Question['review']['status'], string> = {
  draft: '草稿',
  pending: '待审核',
  approved: '审核通过',
  deprecated: '已弃用',
};

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

  const files = [...markdownFiles, { path: 'manifest.json', contents: stableJson(manifest) }].sort(
    (left, right) => compareStrings(left.path, right.path),
  );
  assertUniquePortableExportPaths([
    ...files.map(({ path }) => path),
    ...normalizedAssets.map(({ path }) => path),
  ]);

  return {
    manifest,
    files,
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
    const answerMarkers = getQuestionAnswerSectionMarkers(question.id);
    const stem = neutralizeUserAnswerSectionMarkers(
      rewriteMarkdown(question.stem, path, assets, targets),
      answerMarkers,
    );
    const explanation = question.explanation
      ? neutralizeUserAnswerSectionMarkers(
          rewriteMarkdown(question.explanation, path, assets, targets),
          answerMarkers,
        )
      : undefined;
    const answerSection = [
      answerMarkers.start,
      `## 答案\n\n${renderQuestionAnswer(question)}`,
      ...(explanation ? [`## 解析\n\n${explanation}`] : []),
      answerMarkers.end,
    ].join('\n\n');
    const sections = [
      `# ${escapeMarkdownHeading(singleLine(question.stem))}`,
      renderIdentity(
        question.id,
        `${question.type} · ${question.difficulty} · ${question.score} 分`,
      ),
      `## 题干\n\n${stem}`,
      renderQuestionChoices(question),
      answerSection,
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
    `来源类型：${escapeMarkdownText(sourceTypeLabels[source.type])}`,
    ...(source.title ? [`来源标题：${escapeMarkdownText(source.title)}`] : []),
    ...(source.author ? [`作者：${escapeMarkdownText(source.author)}`] : []),
    ...(source.url ? [`来源链接：${escapeMarkdownText(source.url)}`] : []),
    ...(source.license ? [`来源许可证：${escapeMarkdownText(source.license)}`] : []),
    ...(source.attribution ? [`署名：${escapeMarkdownText(source.attribution)}`] : []),
    `审核状态：${escapeMarkdownText(reviewStatusLabels[review.status])}`,
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
      contents = replaceMarkdownMatches(contents, pattern, () => destination, 1);
    }
  }

  const referencePattern =
    /\boqb:\/\/(topic|knowledge|question|exam)\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})(?![A-Za-z0-9._:-])/gi;
  contents = replaceMarkdownMatches(contents, referencePattern, (match) => {
    const kind = match[1] as EntityKind | undefined;
    const id = match[2];
    if (!kind || !id) {
      return match[0];
    }
    const target = getEntityTarget(targets, kind, id);
    return relativeMarkdownLink(sourcePath, target.path);
  });

  if (/\boqb:\/\//i.test(maskMarkdownCode(contents))) {
    throw new Error(`Markdown 中包含不支持的内部引用：${sourcePath}`);
  }
  return contents;
}

function replaceMarkdownMatches(
  markdown: string,
  pattern: RegExp,
  replace: (match: RegExpMatchArray) => string,
  prefixGroup = 0,
): string {
  const visibleMarkdown = createDecodedMarkdownSearchView(markdown);
  const matches = [...visibleMarkdown.text.matchAll(pattern)];
  let result = markdown;
  for (const match of matches.reverse()) {
    const start = match.index;
    const targetStart =
      start === undefined
        ? undefined
        : start + (prefixGroup === 0 ? 0 : (match[prefixGroup]?.length ?? 0));
    const end = start === undefined ? undefined : start + match[0].length;
    const sourceStart =
      targetStart === undefined ? undefined : visibleMarkdown.sourceStarts[targetStart];
    const sourceEnd =
      end === undefined || end === 0 ? undefined : visibleMarkdown.sourceEnds[end - 1];
    if (sourceStart === undefined || sourceEnd === undefined) {
      continue;
    }
    result = `${result.slice(0, sourceStart)}${replace(match)}${result.slice(sourceEnd)}`;
  }
  return result;
}

interface MarkdownSearchView {
  text: string;
  sourceStarts: number[];
  sourceEnds: number[];
}

function createDecodedMarkdownSearchView(markdown: string): MarkdownSearchView {
  const visibleMarkdown = maskMarkdownCode(markdown);
  const initialView: MarkdownSearchView = {
    text: visibleMarkdown,
    sourceStarts: Array.from({ length: markdown.length }, (_, index) => index),
    sourceEnds: Array.from({ length: markdown.length }, (_, index) => index + 1),
  };

  return decodePercentEncodedSearchView(
    decodeHtmlEntitiesInSearchView(decodeMarkdownEscapesInSearchView(initialView)),
  );
}

function decodeMarkdownEscapesInSearchView(view: MarkdownSearchView): MarkdownSearchView {
  const result = createEmptySearchView();
  for (let index = 0; index < view.text.length; index += 1) {
    const character = view.text[index] ?? '';
    const next = view.text[index + 1];
    if (character === '\\' && next !== undefined && isMarkdownEscapable(next)) {
      appendMappedSearchText(result, view, next, index, index + 2);
      index += 1;
    } else {
      appendMappedSearchText(result, view, character, index, index + 1);
    }
  }
  return result;
}

function decodeHtmlEntitiesInSearchView(view: MarkdownSearchView): MarkdownSearchView {
  const result = createEmptySearchView();
  for (let index = 0; index < view.text.length; index += 1) {
    const entity = /^&(?:#[xX][0-9a-fA-F]+;?|#\d+;?|[A-Za-z][A-Za-z0-9]+;)/.exec(
      view.text.slice(index),
    )?.[0];
    if (entity) {
      const decoded = decodeHtmlCharacterReferences(entity);
      if (decoded !== entity) {
        appendMappedSearchText(result, view, decoded, index, index + entity.length);
        index += entity.length - 1;
        continue;
      }
    }
    appendMappedSearchText(result, view, view.text[index] ?? '', index, index + 1);
  }
  return result;
}

function decodePercentEncodedSearchView(view: MarkdownSearchView): MarkdownSearchView {
  const result = createEmptySearchView();
  for (let index = 0; index < view.text.length; index += 1) {
    const encoded = /^%(?:[0-9a-fA-F]{2})+/.exec(view.text.slice(index))?.[0];
    if (encoded) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(encoded);
      } catch {
        decoded = encoded;
      }
      appendMappedSearchText(result, view, decoded, index, index + encoded.length);
      index += encoded.length - 1;
      continue;
    }
    appendMappedSearchText(result, view, view.text[index] ?? '', index, index + 1);
  }
  return result;
}

function isMarkdownEscapable(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

function createEmptySearchView(): MarkdownSearchView {
  return { text: '', sourceStarts: [], sourceEnds: [] };
}

function appendMappedSearchText(
  target: MarkdownSearchView,
  source: MarkdownSearchView,
  value: string,
  start: number,
  end: number,
): void {
  const sourceStart = source.sourceStarts[start];
  const sourceEnd = source.sourceEnds[end - 1];
  if (sourceStart === undefined || sourceEnd === undefined || value.length === 0) {
    return;
  }
  target.text += value;
  for (let index = 0; index < value.length; index += 1) {
    target.sourceStarts.push(sourceStart);
    target.sourceEnds.push(sourceEnd);
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

/** 根据实体类型和稳定 ID 获取 GitHub Markdown 阅读包中的页面路径 */
export function getQuestionBankGithubMarkdownEntityFilePath(kind: EntityKind, id: string): string {
  return entityFilePath(kind, id);
}

/** 获取题目答案区域的内部标记 */
export function getQuestionAnswerSectionMarkers(questionId: string): {
  start: string;
  end: string;
} {
  const key = createHash('sha256').update(questionId, 'utf8').digest('hex').slice(0, 16);
  return {
    start: `<!-- oqb:question-answer:${key}:start -->`,
    end: `<!-- oqb:question-answer:${key}:end -->`,
  };
}

/** 定位答案区域并忽略 Markdown 代码中的同名标记 */
export function findQuestionAnswerSection(
  markdown: string,
  questionId: string,
): { start: number; contentStart: number; end: number; contentEnd: number } | undefined {
  const markers = getQuestionAnswerSectionMarkers(questionId);
  const searchableMarkdown = maskMarkdownCode(markdown);
  let start = findMarkerLine(searchableMarkdown, markers.start, 0);
  while (start !== undefined) {
    const contentStart = start + markers.start.length;
    if (searchableMarkdown.startsWith('\n\n## 答案\n\n', contentStart)) {
      const end = findMarkerLine(searchableMarkdown, markers.end, contentStart, true);
      if (end !== undefined) {
        return {
          start,
          contentStart,
          end,
          contentEnd: end + markers.end.length,
        };
      }
      return undefined;
    }
    start = findMarkerLine(searchableMarkdown, markers.start, start + markers.start.length);
  }
  return undefined;
}

function findMarkerLine(
  markdown: string,
  marker: string,
  startIndex: number,
  fromEnd = false,
): number | undefined {
  let index = fromEnd ? markdown.lastIndexOf(marker) : markdown.indexOf(marker, startIndex);
  while (index >= startIndex) {
    const isLineStart = index === 0 || markdown[index - 1] === '\n';
    const afterMarker = index + marker.length;
    const isLineEnd =
      afterMarker === markdown.length ||
      markdown[afterMarker] === '\n' ||
      markdown[afterMarker] === '\r';
    if (isLineStart && isLineEnd) {
      return index;
    }
    index = fromEnd
      ? markdown.lastIndexOf(marker, index - 1)
      : markdown.indexOf(marker, index + marker.length);
  }
  return undefined;
}

function neutralizeUserAnswerSectionMarkers(
  markdown: string,
  markers: { start: string; end: string },
): string {
  const searchableMarkdown = maskMarkdownCode(markdown);
  const matches: Array<{ index: number; marker: string }> = [];
  for (const marker of [markers.start, markers.end]) {
    let startIndex = 0;
    let index = findMarkerLine(searchableMarkdown, marker, startIndex);
    while (index !== undefined) {
      matches.push({ index, marker });
      startIndex = index + marker.length;
      index = findMarkerLine(searchableMarkdown, marker, startIndex);
    }
  }

  let result = markdown;
  for (const { index, marker } of matches.sort((left, right) => right.index - left.index)) {
    const inertMarker = marker.replace('oqb:question-answer:', 'oqb:user-question-answer:');
    result = result.slice(0, index) + inertMarker + result.slice(index + marker.length);
  }
  return result;
}

function entityFilename(id: string): string {
  const encodedId = [...id]
    .map((character) =>
      /^[a-z0-9._-]$/.test(character)
        ? character
        : `~${Buffer.from(character, 'utf8').toString('hex').toUpperCase()}`,
    )
    .join('');
  if (encodedId.length > 220) {
    const bytes = Buffer.from(id, 'utf8');
    const encodedValue = BigInt(`0x${bytes.toString('hex') || '0'}`).toString(36);
    return `id-~x~${bytes.length.toString(36)}-${encodedValue}.md`;
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
