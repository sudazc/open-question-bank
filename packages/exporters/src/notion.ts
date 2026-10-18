import { createHash } from 'node:crypto';
import type { QuestionBankData } from '@openquestionbank/core';
import {
  assertUniquePortableExportPaths,
  normalizeExportAssets,
  type ExportAsset,
} from './export-common.js';
import { escapeMarkdownHeading, escapeMarkdownText } from './markdown-utils.js';
import {
  createQuestionBankGithubMarkdownExport,
  findQuestionAnswerSection,
  getQuestionBankGithubMarkdownEntityFilePath,
  getQuestionBankGithubMarkdownFilePaths,
} from './github-markdown.js';
import type { ExportFile } from './export-writer.js';

const format = 'openquestionbank-notion-import';
const formatVersion = '2.2.0';
const databasePaths = [
  'databases/bank.csv',
  'databases/topics.csv',
  'databases/knowledge.csv',
  'databases/questions.csv',
  'databases/answers.csv',
  'databases/groups.csv',
  'databases/exams.csv',
] as const;

type EntityType = 'topic' | 'knowledge' | 'question' | 'group' | 'exam';

const questionTypeLabels: Record<QuestionEntity['type'], string> = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
  fill_blank: '填空题',
  numeric: '数值题',
  short_answer: '简答题',
};

interface NotionRelation {
  sourceType: EntityType;
  sourceId: string;
  field: string;
  targetType: EntityType;
  targetId: string;
  position: number | '';
}

type QuestionEntity = QuestionBankData['questions'][number];

interface QuestionNavigation {
  previous: QuestionEntity | undefined;
  next: QuestionEntity | undefined;
}

export interface NotionExportManifest {
  format: typeof format;
  formatVersion: typeof formatVersion;
  schemaVersion: NonNullable<QuestionBankData['bank']>['schemaVersion'];
  bank: { id: string; name: string; version: string };
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

export interface NotionExportPackage {
  manifest: NotionExportManifest;
  files: ExportFile[];
  assets: ExportAsset[];
}

/** 生成供 Notion 导入的 CSV 数据库、Markdown 页面、关系表和发布清单 */
export function createQuestionBankNotionExport(
  data: QuestionBankData,
  assets: readonly ExportAsset[],
): NotionExportPackage {
  const bank = data.bank;
  if (!bank) {
    throw new Error('Notion 导出要求存在有效的 Bank 实体');
  }

  const normalizedAssets = normalizeExportAssets(data, assets);
  const markdownExport = createQuestionBankGithubMarkdownExport(data, normalizedAssets);
  const navigationByQuestionId = createQuestionNavigationMap(data.questions);
  const questionsByPath = new Map(
    data.questions.map((question) => [
      getQuestionBankGithubMarkdownEntityFilePath('question', question.id),
      question,
    ]),
  );
  const markdownFiles = markdownExport.files
    .filter(({ path }) => path !== 'README.md' && path !== 'manifest.json')
    .map(({ path, contents }) => {
      const question = questionsByPath.get(path);
      return {
        path,
        contents: question
          ? prepareNotionQuestionPage(contents, question, navigationByQuestionId.get(question.id))
          : contents,
      };
    });
  const contentFiles: ExportFile[] = [
    { path: 'README.md', contents: renderReadme(data, normalizedAssets) },
    ...renderDatabaseFiles(data, navigationByQuestionId),
    { path: 'relations.csv', contents: renderRelationsCsv(data) },
    ...markdownFiles,
  ].sort((left, right) => compareStrings(left.path, right.path));
  const entityCounts = {
    bank: 1 as const,
    topics: data.topics.length,
    knowledge: data.knowledge.length,
    questions: data.questions.length,
    groups: data.groups.length,
    exams: data.exams.length,
  };
  const manifest: NotionExportManifest = {
    format,
    formatVersion,
    schemaVersion: bank.schemaVersion,
    bank: { id: bank.id, name: bank.name, version: bank.version },
    statistics: {
      entities: entityCounts,
      totalEntities: Object.values(entityCounts).reduce((total, count) => total + count, 0),
    },
    files: [
      ...contentFiles.map(({ path, contents }) => ({
        path,
        sizeBytes: Buffer.byteLength(contents, 'utf8'),
        sha256: createHash('sha256').update(contents, 'utf8').digest('hex'),
      })),
      ...normalizedAssets,
    ].sort((left, right) => compareStrings(left.path, right.path)),
  };

  const files = [...contentFiles, { path: 'manifest.json', contents: stableJson(manifest) }].sort(
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

/** 列出 Notion 导出会生成的文件路径 */
export function getQuestionBankNotionFilePaths(data: QuestionBankData): string[] {
  return [
    'README.md',
    'manifest.json',
    ...databasePaths,
    'relations.csv',
    ...getQuestionBankGithubMarkdownFilePaths(data).filter(
      (path) => path !== 'README.md' && path !== 'manifest.json',
    ),
  ].sort(compareStrings);
}

function renderDatabaseFiles(
  data: QuestionBankData,
  navigationByQuestionId: ReadonlyMap<string, QuestionNavigation>,
): ExportFile[] {
  const bank = data.bank;
  if (!bank) {
    throw new Error('Notion 导出要求存在有效的 Bank 实体');
  }

  const topics = sortById(data.topics);
  const knowledge = sortById(data.knowledge);
  const questions = sortById(data.questions);
  const groups = sortById(data.groups);
  const exams = sortById(data.exams);

  return [
    {
      path: 'databases/bank.csv',
      contents: renderCsv(
        [
          'name',
          'id',
          'description',
          'version',
          'schemaVersion',
          'language',
          'license',
          'maintainersJson',
          'examSystem',
          'pathsJson',
          'extensionsJson',
          'entityJson',
        ],
        [
          [
            bank.name,
            bank.id,
            bank.description,
            bank.version,
            bank.schemaVersion,
            bank.language,
            bank.license,
            jsonCell(bank.maintainers),
            bank.examSystem,
            jsonCell(bank.paths),
            jsonCell(bank.extensions),
            jsonCell(bank),
          ],
        ],
      ),
    },
    {
      path: 'databases/topics.csv',
      contents: renderCsv(
        [
          'name',
          'id',
          'parentId',
          'order',
          'description',
          'aliasesJson',
          'extensionsJson',
          'entityJson',
        ],
        topics.map((entity) => [
          entity.name,
          entity.id,
          entity.parentId,
          entity.order,
          entity.description,
          jsonCell(entity.aliases),
          jsonCell(entity.extensions),
          jsonCell(entity),
        ]),
      ),
    },
    {
      path: 'databases/knowledge.csv',
      contents: renderCsv(
        [
          'title',
          'id',
          'summary',
          'bodyMarkdown',
          'topicIdsJson',
          'prerequisiteIdsJson',
          'relatedIdsJson',
          'tagsJson',
          'assetsJson',
          'sourceJson',
          'reviewJson',
          'extensionsJson',
          'entityJson',
        ],
        knowledge.map((entity) => [
          entity.title,
          entity.id,
          entity.summary,
          entity.body,
          jsonCell(entity.topicIds),
          jsonCell(entity.prerequisiteIds),
          jsonCell(entity.relatedIds),
          jsonCell(entity.tags),
          jsonCell(entity.assets),
          jsonCell(entity.source),
          jsonCell(entity.review),
          jsonCell(entity.extensions),
          jsonCell(entity),
        ]),
      ),
    },
    {
      path: 'databases/questions.csv',
      contents: renderCsv(
        [
          'title',
          'id',
          'type',
          'typeLabel',
          'stemMarkdown',
          'choicesJson',
          'difficulty',
          'topicIdsJson',
          'knowledgeIdsJson',
          'tagsJson',
          'score',
          'previousId',
          'previousTitle',
          'nextId',
          'nextTitle',
          'sourceJson',
          'reviewJson',
          'assetsJson',
          'extensionsJson',
          'questionJson',
        ],
        questions.map((entity) => {
          const navigation = navigationByQuestionId.get(entity.id);
          return [
            questionTitle(entity.stem),
            entity.id,
            entity.type,
            questionTypeLabels[entity.type],
            entity.stem,
            'choices' in entity ? jsonCell(entity.choices) : '',
            entity.difficulty,
            jsonCell(entity.topicIds),
            jsonCell(entity.knowledgeIds),
            jsonCell(entity.tags),
            entity.score,
            navigation?.previous?.id,
            navigation?.previous ? questionTitle(navigation.previous.stem) : '',
            navigation?.next?.id,
            navigation?.next ? questionTitle(navigation.next.stem) : '',
            jsonCell(entity.source),
            jsonCell(entity.review),
            jsonCell(entity.assets),
            jsonCell(entity.extensions),
            questionJsonWithoutAnswers(entity),
          ];
        }),
      ),
    },
    {
      path: 'databases/answers.csv',
      contents: renderCsv(
        ['title', 'id', 'answerJson', 'explanationMarkdown', 'entityJson'],
        questions.map((entity) => [
          questionTitle(entity.stem),
          entity.id,
          jsonCell(entity.answer),
          entity.explanation,
          jsonCell(entity),
        ]),
      ),
    },
    {
      path: 'databases/groups.csv',
      contents: renderCsv(
        [
          'title',
          'id',
          'passageMarkdown',
          'questionIdsJson',
          'topicIdsJson',
          'tagsJson',
          'sourceJson',
          'reviewJson',
          'assetsJson',
          'extensionsJson',
          'entityJson',
        ],
        groups.map((entity) => [
          entity.title,
          entity.id,
          entity.passage,
          jsonCell(entity.questionIds),
          jsonCell(entity.topicIds),
          jsonCell(entity.tags),
          jsonCell(entity.source),
          jsonCell(entity.review),
          jsonCell(entity.assets),
          jsonCell(entity.extensions),
          jsonCell(entity),
        ]),
      ),
    },
    {
      path: 'databases/exams.csv',
      contents: renderCsv(
        [
          'title',
          'id',
          'mode',
          'kind',
          'description',
          'durationMinutes',
          'itemsJson',
          'rulesJson',
          'randomSeed',
          'bankVersion',
          'algorithmVersion',
          'extensionsJson',
          'entityJson',
        ],
        exams.map((entity) => [
          entity.title,
          entity.id,
          entity.mode,
          'kind' in entity ? entity.kind : '',
          entity.description,
          entity.durationMinutes,
          'items' in entity ? jsonCell(entity.items) : '',
          'rules' in entity ? jsonCell(entity.rules) : '',
          'randomSeed' in entity ? entity.randomSeed : '',
          'bankVersion' in entity ? entity.bankVersion : '',
          'algorithmVersion' in entity ? entity.algorithmVersion : '',
          jsonCell(entity.extensions),
          jsonCell(entity),
        ]),
      ),
    },
  ];
}

function createQuestionNavigationMap(
  questions: readonly QuestionEntity[],
): Map<string, QuestionNavigation> {
  const orderedQuestions = sortById(questions);
  return new Map(
    orderedQuestions.map((question, index) => [
      question.id,
      { previous: orderedQuestions[index - 1], next: orderedQuestions[index + 1] },
    ]),
  );
}

function prepareNotionQuestionPage(
  markdown: string,
  question: QuestionEntity,
  navigation: QuestionNavigation | undefined,
): string {
  let result = markdown.replace(
    /^# .+$/m,
    () => '# ' + escapeMarkdownHeading(questionTitle(question.stem)),
  );
  const identityLine = /^> (稳定 ID：.*?)(?: · .*)?$/m.exec(result);
  if (identityLine) {
    const details = [
      questionTypeLabels[question.type],
      '难度：' + escapeMarkdownText(question.difficulty),
      '分值：' + escapeMarkdownText(String(question.score)) + ' 分',
    ];
    result = result.replace(identityLine[0], identityLine[1] + ' · ' + details.join(' · '));
  }

  const optionsHeading = '\n## 选项\n';
  const optionsStart = result.indexOf(optionsHeading);
  if (optionsStart >= 0) {
    const contentStart = optionsStart + optionsHeading.length;
    const nextHeading = result.indexOf('\n## ', contentStart);
    const optionsEnd = nextHeading < 0 ? result.length : nextHeading;
    const options = result.slice(contentStart, optionsEnd).replace(/^- [☑☐] /gm, '- ');
    result = result.slice(0, contentStart) + options + result.slice(optionsEnd);
  }

  result = omitQuestionAnswer(result, question.id);
  const previous = navigation?.previous;
  const next = navigation?.next;
  const previousLink = previous
    ? '[' +
      escapeMarkdownLinkTitle(questionTitle(previous.stem)) +
      '](' +
      getQuestionBankGithubMarkdownEntityFilePath('question', previous.id).split('/').at(-1) +
      ')'
    : '无';
  const nextLink = next
    ? '[' +
      escapeMarkdownLinkTitle(questionTitle(next.stem)) +
      '](' +
      getQuestionBankGithubMarkdownEntityFilePath('question', next.id).split('/').at(-1) +
      ')'
    : '无';
  const navigationLine = '> **上一题：** ' + previousLink + '　｜　**下一题：** ' + nextLink;
  return result.replace(/^(# .+)$/m, '$1\n\n' + navigationLine);
}

function omitQuestionAnswer(markdown: string, questionId: string): string {
  const section = findQuestionAnswerSection(markdown, questionId);
  if (!section) {
    throw new Error(`无法定位题目 ${questionId} 的答案区域，已取消 Notion 导出`);
  }

  const before = markdown.slice(0, section.start).trimEnd();
  const after = markdown.slice(section.contentEnd).trimStart();
  const reminder = '## 答案与解析\n\n练习后可在单独的“答案与解析”数据库中按稳定 ID 查询。';
  return before + '\n\n' + reminder + (after ? '\n\n' + after : '');
}

function questionTitle(stem: string): string {
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

function questionJsonWithoutAnswers(question: QuestionEntity): string {
  const data = Object.fromEntries(
    Object.entries(question).filter(([key]) => key !== 'answer' && key !== 'explanation'),
  );
  return jsonCell(data);
}

function escapeMarkdownLinkTitle(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function renderRelationsCsv(data: QuestionBankData): string {
  const relations: NotionRelation[] = [];
  const add = (
    sourceType: EntityType,
    sourceId: string,
    field: string,
    targetType: EntityType,
    targetId: string,
    position: number | '' = '',
  ): void => {
    relations.push({ sourceType, sourceId, field, targetType, targetId, position });
  };
  const addArray = (
    sourceType: EntityType,
    sourceId: string,
    field: string,
    targetType: EntityType,
    targetIds: readonly string[],
  ): void => {
    targetIds.forEach((targetId, position) =>
      add(sourceType, sourceId, field, targetType, targetId, position),
    );
  };

  for (const entity of sortById(data.topics)) {
    if (entity.parentId) {
      add('topic', entity.id, 'parentId', 'topic', entity.parentId);
    }
  }
  for (const entity of sortById(data.knowledge)) {
    addArray('knowledge', entity.id, 'topicIds', 'topic', entity.topicIds);
    addArray('knowledge', entity.id, 'prerequisiteIds', 'knowledge', entity.prerequisiteIds);
    addArray('knowledge', entity.id, 'relatedIds', 'knowledge', entity.relatedIds);
  }
  for (const entity of sortById(data.questions)) {
    addArray('question', entity.id, 'topicIds', 'topic', entity.topicIds);
    addArray('question', entity.id, 'knowledgeIds', 'knowledge', entity.knowledgeIds);
  }
  for (const entity of sortById(data.groups)) {
    addArray('group', entity.id, 'questionIds', 'question', entity.questionIds);
    addArray('group', entity.id, 'topicIds', 'topic', entity.topicIds);
  }
  for (const exam of sortById(data.exams)) {
    if (exam.mode === 'generated' && exam.kind === 'template') {
      exam.rules.forEach((rule, ruleIndex) => {
        addArray(
          'exam',
          exam.id,
          `rules[${ruleIndex}].filters.topicIds`,
          'topic',
          rule.filters?.topicIds ?? [],
        );
      });
      continue;
    }

    exam.items.forEach((item, itemIndex) => {
      if (item.kind === 'question') {
        add(
          'exam',
          exam.id,
          `items[${itemIndex}].questionId`,
          'question',
          item.questionId,
          itemIndex,
        );
        return;
      }
      add('exam', exam.id, `items[${itemIndex}].groupId`, 'group', item.groupId, itemIndex);
      item.questions.forEach((question, questionIndex) => {
        add(
          'exam',
          exam.id,
          `items[${itemIndex}].questions[${questionIndex}].questionId`,
          'question',
          question.questionId,
          questionIndex,
        );
      });
    });
  }

  relations.sort(
    (left, right) =>
      compareStrings(left.sourceType, right.sourceType) ||
      compareStrings(left.sourceId, right.sourceId) ||
      compareStrings(left.field, right.field) ||
      compareNumbers(
        left.position === '' ? -1 : left.position,
        right.position === '' ? -1 : right.position,
      ) ||
      compareStrings(left.targetId, right.targetId),
  );
  return renderCsv(
    ['sourceType', 'sourceId', 'field', 'targetType', 'targetId', 'position'],
    relations.map(({ sourceType, sourceId, field, targetType, targetId, position }) => [
      sourceType,
      sourceId,
      field,
      targetType,
      targetId,
      position,
    ]),
  );
}

function renderReadme(data: QuestionBankData, assets: readonly ExportAsset[]): string {
  const bank = data.bank;
  if (!bank) {
    throw new Error('Notion 导出要求存在有效的 Bank 实体');
  }
  return [
    `# ${escapeMarkdownHeading(bank.name)} · Notion 导入包`,
    '',
    `题库稳定 ID：\`${bank.id}\` · 版本：${bank.version} · Schema：${bank.schemaVersion}`,
    '',
    '本目录是可手动导入 Notion 的 CSV 和 Markdown 文件包。CSV 会创建普通数据库属性；导入器不会自动创建 Notion 原生 Relation 属性，也不会自动连接数据库记录。',
    '',
    '## 导入步骤',
    '',
    '1. 将整个导出目录解压到本地，先保留 `manifest.json` 以核对文件和题库版本。',
    '2. 先导入 `databases/questions.csv` 创建题目数据库。第一列 `title` 是可读题名，`id` 是 OpenQuestionBank 稳定 ID；`type` 是 Schema 机器值，`typeLabel` 是中文题型名。题目选项、题干和导航字段可用于练习，导航按稳定 ID 排序，首题和末题对应字段为空。答案不在此表中。',
    '3. 练习完成后再导入 `databases/answers.csv`。该表单独保存答案、解析和完整实体 JSON，可按 `id` 与题目数据库对应；暂时不需要查看答案时，可以先不导入这张表。',
    '4. 按需导入 `databases/` 中其余 CSV；每个 CSV 对应一个数据库，各实体表以 `name` 或 `title` 作为首列，`id` 保留稳定标识。',
    '5. CSV 中以 `Json` 结尾的列、`questionJson` 和 `entityJson` 是 JSON 文本。题目数据库中的 `questionJson` 已排除答案和解析；完整题目实体保存在答案表的 `entityJson` 中。',
    '6. 需要阅读完整正文时，再将相应 Markdown 文件导入为页面。题目页不含答案正文，并提供上一题 / 下一题文件链接。',
    '7. 将 `relations.csv` 导入为映射表。按 `sourceType` / `sourceId` 找到来源记录，按 `targetType` / `targetId` 找到目标记录，再在 Notion 数据库中手动建立所需的 Relation 属性。',
    '',
    '## 关系映射',
    '',
    '`relations.csv` 使用稳定 ID 描述题库中的跨实体关联。`field` 是源实体中的字段路径；数组关系的 `position` 从 0 开始，单值关系留空。试卷中的嵌套关系会在 `field` 中包含数组下标。题目表的 `previousId` / `nextId` 列也可用于手动建立题目间的前后 Relation。',
    '',
    'Notion 的原生 Relation 需要在 Notion 数据库内配置并连接记录。本文件只提供可核对的关系清单，不会自动转换成双向 Relation；导入后是否建立 Relation 以及属性名称由使用者决定。',
    '',
    '## 文件说明',
    '',
    '- `databases/*.csv`：题库、考点、知识、题目、答案与解析、题组和试卷的表格数据；题目表与答案表分开导入',
    '- `relations.csv`：跨实体关系映射，包含数组顺序和试卷嵌套路径',
    '- `topics/`、`knowledge/`、`questions/`、`groups/`、`exams/`：适合阅读和导入为页面的 Markdown 文件及分类索引',
    `- 资源文件：${assets.length} 个引用资源，保留题库中的相对路径`,
    '- `manifest.json`：导出格式版本、实体数量以及每个 CSV、Markdown 和资源文件的大小与 SHA-256',
    '',
    '所有 CSV 使用 UTF-8 和 RFC 4180 引号规则。Markdown 文件中的相对链接适合随整个包一起查看；Notion 导入后不会自动把这些链接转换为数据库 Relation。',
    '',
  ].join('\n');
}

function renderCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | undefined)[])[],
): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

function escapeCsvField(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value).replace(/\r\n|\r|\n/g, '\r\n');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function jsonCell(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  const serialized = JSON.stringify(sortObjectKeys(value));
  if (serialized === undefined) {
    throw new TypeError('Notion 导出内容无法序列化');
  }
  return serialized;
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(sortObjectKeys(value), null, 2);
  if (serialized === undefined) {
    throw new TypeError('Notion 导出内容无法序列化');
  }
  return `${serialized}\n`;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const entries = Object.entries(value).sort(([left], [right]) => compareStrings(left, right));
  return Object.fromEntries(entries.map(([key, item]) => [key, sortObjectKeys(item)]));
}

function sortById<T extends { id: string }>(entities: readonly T[]): T[] {
  return [...entities].sort((left, right) => compareStrings(left.id, right.id));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
