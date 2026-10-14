import { createHash } from 'node:crypto';
import type { QuestionBankData } from '@openquestionbank/core';
import { normalizeExportAssets, type ExportAsset } from './export-common.js';
import {
  createQuestionBankGithubMarkdownExport,
  getQuestionBankGithubMarkdownFilePaths,
} from './github-markdown.js';
import type { ExportFile } from './export-writer.js';

const format = 'openquestionbank-notion-import';
const formatVersion = '1.0.0';
const databasePaths = [
  'databases/bank.csv',
  'databases/topics.csv',
  'databases/knowledge.csv',
  'databases/questions.csv',
  'databases/groups.csv',
  'databases/exams.csv',
] as const;

type EntityType = 'topic' | 'knowledge' | 'question' | 'group' | 'exam';

interface NotionRelation {
  sourceType: EntityType;
  sourceId: string;
  field: string;
  targetType: EntityType;
  targetId: string;
  position: number | '';
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
  const markdownFiles = markdownExport.files.filter(
    ({ path }) => path !== 'README.md' && path !== 'manifest.json',
  );
  const contentFiles: ExportFile[] = [
    { path: 'README.md', contents: renderReadme(data, normalizedAssets) },
    ...renderDatabaseFiles(data),
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

  return {
    manifest,
    files: [...contentFiles, { path: 'manifest.json', contents: stableJson(manifest) }].sort(
      (left, right) => compareStrings(left.path, right.path),
    ),
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

function renderDatabaseFiles(data: QuestionBankData): ExportFile[] {
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
          'id',
          'name',
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
            bank.id,
            bank.name,
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
          'id',
          'name',
          'parentId',
          'order',
          'description',
          'aliasesJson',
          'extensionsJson',
          'entityJson',
        ],
        topics.map((entity) => [
          entity.id,
          entity.name,
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
          'id',
          'title',
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
          entity.id,
          entity.title,
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
          'id',
          'type',
          'stemMarkdown',
          'explanationMarkdown',
          'choicesJson',
          'answerJson',
          'difficulty',
          'topicIdsJson',
          'knowledgeIdsJson',
          'tagsJson',
          'score',
          'sourceJson',
          'reviewJson',
          'assetsJson',
          'extensionsJson',
          'entityJson',
        ],
        questions.map((entity) => [
          entity.id,
          entity.type,
          entity.stem,
          entity.explanation,
          'choices' in entity ? jsonCell(entity.choices) : '',
          jsonCell(entity.answer),
          entity.difficulty,
          jsonCell(entity.topicIds),
          jsonCell(entity.knowledgeIds),
          jsonCell(entity.tags),
          entity.score,
          jsonCell(entity.source),
          jsonCell(entity.review),
          jsonCell(entity.assets),
          jsonCell(entity.extensions),
          jsonCell(entity),
        ]),
      ),
    },
    {
      path: 'databases/groups.csv',
      contents: renderCsv(
        [
          'id',
          'title',
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
          entity.id,
          entity.title,
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
          'id',
          'title',
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
          entity.id,
          entity.title,
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
    `# ${bank.name} · Notion 导入包`,
    '',
    `题库稳定 ID：\`${bank.id}\` · 版本：${bank.version} · Schema：${bank.schemaVersion}`,
    '',
    '本目录是可手动导入 Notion 的 CSV 和 Markdown 文件包。CSV 会创建普通数据库属性；导入器不会自动创建 Notion 原生 Relation 属性，也不会自动连接数据库记录。',
    '',
    '## 导入步骤',
    '',
    '1. 将整个导出目录解压到本地，先保留 `manifest.json` 以核对文件和题库版本。',
    '2. 在 Notion 中分别导入 `databases/` 内的六个 CSV。每个 CSV 对应一个数据库；保留 `id` 列作为稳定标识，不要把它当作 Notion 自动生成的页面 ID。',
    '3. CSV 中以 `Json` 结尾的列及 `entityJson` 列是 JSON 文本。简单属性可直接筛选；完整结构和不常用字段保存在 `entityJson` 中。',
    '4. 需要阅读完整正文时，再将相应 Markdown 文件导入为页面。知识、题目、题组、考点和试卷页面按目录分类，文件名包含稳定 ID。',
    '5. 将 `relations.csv` 导入为映射表。按 `sourceType` / `sourceId` 找到来源记录，按 `targetType` / `targetId` 找到目标记录，再在 Notion 数据库中手动建立所需的 Relation 属性。',
    '',
    '## 关系映射',
    '',
    '`relations.csv` 使用稳定 ID 描述题库中的跨实体关联。`field` 是源实体中的字段路径；数组关系的 `position` 从 0 开始，单值关系留空。试卷中的嵌套关系会在 `field` 中包含数组下标。',
    '',
    'Notion 的原生 Relation 需要在 Notion 数据库内配置并连接记录。本文件只提供可核对的关系清单，不会自动转换成双向 Relation；导入后是否建立 Relation 以及属性名称由使用者决定。',
    '',
    '## 文件说明',
    '',
    '- `databases/*.csv`：Bank、考点、知识、题目、题组和试卷的表格数据',
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
