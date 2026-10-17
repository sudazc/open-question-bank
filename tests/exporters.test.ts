import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { QuestionBankData } from '../packages/core/src/types.js';
import {
  createQuestionBankGithubMarkdownExport,
  createQuestionBankJsonExport,
  createQuestionBankNotionExport,
  createQuestionBankObsidianVaultExport,
} from '../packages/exporters/src/index.js';
import { getQuestionAnswerSectionMarkers } from '../packages/exporters/src/github-markdown.js';
import { bank, exams, knowledge, questions, questionGroup, topic } from './fixtures.js';

const data: QuestionBankData = {
  bank,
  topics: [topic],
  knowledge: [knowledge],
  questions,
  groups: [questionGroup],
  exams,
};
const assetContents = new TextEncoder().encode('<svg/>');
const assets = [
  {
    path: 'assets/triangle.svg',
    sizeBytes: assetContents.byteLength,
    sha256: createHash('sha256').update(assetContents).digest('hex'),
  },
];

describe('OpenQuestionBank JSON 导出器', () => {
  it('生成版本化题库数据和包含统计及 SHA-256 的清单', () => {
    const exported = createQuestionBankJsonExport(data, assets);
    const questionBankFile = exported.files.find(({ path }) => path === 'question-bank.json');
    const fileInfo = exported.manifest.files.find(({ path }) => path === 'question-bank.json');
    const questionBankContents = questionBankFile?.contents;

    expect(questionBankFile).toBeDefined();
    expect(typeof questionBankContents).toBe('string');
    if (typeof questionBankContents !== 'string') {
      throw new Error('question-bank.json 必须是文本文件');
    }
    expect(questionBankContents).toContain('通用题库示例');
    expect(exported.manifest).toMatchObject({
      format: 'openquestionbank-json',
      formatVersion: '1.0.0',
      schemaVersion: '1.0.0',
      bank: { id: bank.id, version: bank.version },
      statistics: {
        entities: { bank: 1, topics: 1, knowledge: 1, questions: 6, groups: 1, exams: 3 },
        totalEntities: 13,
      },
    });
    expect(fileInfo).toBeDefined();
    expect(fileInfo?.sizeBytes).toBe(Buffer.byteLength(questionBankContents, 'utf8'));
    expect(fileInfo?.sha256).toBe(
      createHash('sha256').update(questionBankContents, 'utf8').digest('hex'),
    );
    expect(exported.manifest.files).toContainEqual({
      path: 'assets/triangle.svg',
      sizeBytes: 6,
      sha256: assets[0]?.sha256,
    });
    expect(
      exported.files
        .filter(({ path }) => path.endsWith('.json'))
        .every(({ contents }) => typeof contents === 'string' && contents.endsWith('\n')),
    ).toBe(true);
  });

  it('对实体顺序和对象键顺序变化保持相同输出', () => {
    const reordered = createQuestionBankJsonExport(
      {
        ...data,
        topics: [...data.topics].reverse(),
        knowledge: [...data.knowledge].reverse(),
        questions: [...data.questions].reverse(),
        groups: [...data.groups].reverse(),
        exams: [...data.exams].reverse(),
      },
      assets,
    );

    expect(reordered.files).toEqual(createQuestionBankJsonExport(data, assets).files);
  });

  it('拒绝缺少 Bank 实体的数据', () => {
    const withoutBank: QuestionBankData = { ...data };
    delete withoutBank.bank;

    expect(() => createQuestionBankJsonExport(withoutBank, assets)).toThrow('有效的 Bank 实体');
  });

  it('要求所有题库引用的资源都存在于导出集合中', () => {
    expect(() => createQuestionBankJsonExport(data, [])).toThrow('缺少题库引用的资源文件');
    expect(() =>
      createQuestionBankJsonExport(data, [
        { path: '../outside.svg', sizeBytes: 0, sha256: '0'.repeat(64) },
      ]),
    ).toThrow('资源路径不安全');
    expect(() =>
      createQuestionBankJsonExport(data, [
        { path: 'assets/Photo.png', sizeBytes: 1, sha256: '0'.repeat(64) },
        { path: 'assets/photo.png', sizeBytes: 1, sha256: '1'.repeat(64) },
      ]),
    ).toThrow('大小写或 Unicode 规范化不敏感');
    expect(() =>
      createQuestionBankJsonExport(data, [
        { path: 'assets/é.svg', sizeBytes: 1, sha256: '0'.repeat(64) },
        { path: 'assets/e\u0301.svg', sizeBytes: 1, sha256: '1'.repeat(64) },
      ]),
    ).toThrow('大小写或 Unicode 规范化不敏感');
  });
});

describe('跨平台导出文件名', () => {
  it('拒绝 Windows 非法文件名、保留设备名和超长路径段', () => {
    for (const path of [
      'assets/CON.svg',
      'assets/image?.svg',
      'assets/image:preview.svg',
      'assets/control\u0001.svg',
      `assets/${'é'.repeat(128)}.svg`,
    ]) {
      expect(() =>
        createQuestionBankJsonExport(data, [{ path, sizeBytes: 1, sha256: '0'.repeat(64) }]),
      ).toThrow('不安全');
    }
  });

  it('拒绝资源文件与导出文件之间的文件或目录冲突', () => {
    const assetPath = 'manifest.json/diagram.svg';
    const conflictingData: QuestionBankData = {
      ...data,
      knowledge: data.knowledge.map((entity) => ({ ...entity, assets: [assetPath] })),
    };
    const conflictingAssets = [{ path: assetPath, sizeBytes: 1, sha256: '0'.repeat(64) }];
    const exporters = [
      () => createQuestionBankJsonExport(conflictingData, conflictingAssets),
      () => createQuestionBankGithubMarkdownExport(conflictingData, conflictingAssets),
      () => createQuestionBankObsidianVaultExport(conflictingData, conflictingAssets),
      () => createQuestionBankNotionExport(conflictingData, conflictingAssets),
    ];

    for (const createExport of exporters) {
      expect(createExport).toThrow('文件与目录冲突');
    }
  });
});

describe('OpenQuestionBank GitHub Markdown 导出器', () => {
  it('生成可浏览的实体页面、重写内部链接和资源路径，并记录校验值', () => {
    const githubData: QuestionBankData = {
      ...data,
      topics: [...data.topics, { ...topic, id: 'topic:extended', name: '扩展考点' }],
      knowledge: [
        {
          ...knowledge,
          body: [
            '正文引用 [关联题目](oqb://question/question-single-choice)。',
            '![三角形](assets/triangle.svg?view=raw#preview)',
            '\\`[转义边界](oqb://question/question-single-choice)\\`',
            '`oqb://question/question-single-choice`',
            '```text\noqb://knowledge/knowledge-foundations\n```',
          ].join('\n\n'),
        },
      ],
    };

    const exported = createQuestionBankGithubMarkdownExport(githubData, assets);
    const knowledgeFile = exported.files.find(
      ({ path }) => path === 'knowledge/id-knowledge-foundations.md',
    );
    const knowledgeContents = knowledgeFile?.contents;
    if (typeof knowledgeContents !== 'string') {
      throw new Error('应生成知识笔记 Markdown 页面');
    }

    expect(knowledgeContents).toContain('[关联题目](../questions/id-question-single-choice.md)');
    expect(knowledgeContents).toContain('![三角形](../assets/triangle.svg?view=raw#preview)');
    expect(knowledgeContents).toContain(
      '\\`[转义边界](../questions/id-question-single-choice.md)\\`',
    );
    expect(knowledgeContents).toContain('`oqb://question/question-single-choice`');
    expect(knowledgeContents).toContain('```text\noqb://knowledge/knowledge-foundations\n```');
    expect(exported.files.some(({ path }) => path === 'topics/id-topic~3Aextended.md')).toBe(true);
    expect(
      exported.files.find(({ path }) => path === 'questions/id-question-fill-blank.md')?.contents,
    ).toContain('空白处理：trim');
    expect(
      exported.files.find(({ path }) => path === 'questions/id-question-numeric.md')?.contents,
    ).toContain('单位规则：required');
    expect(
      exported.files.find(({ path }) => path === 'questions/id-question-short-answer.md')?.contents,
    ).toContain('说明主要概念（1 分）');
    expect(exported.manifest).toMatchObject({
      format: 'openquestionbank-github-markdown',
      formatVersion: '1.1.0',
      schemaVersion: '1.0.0',
      bank: { id: bank.id, name: bank.name, version: bank.version },
      statistics: {
        entities: { bank: 1, topics: 2, knowledge: 1, questions: 6, groups: 1, exams: 3 },
        totalEntities: 14,
      },
    });
    expect(exported.manifest.files).toContainEqual({
      path: 'knowledge/id-knowledge-foundations.md',
      sizeBytes: Buffer.byteLength(knowledgeContents, 'utf8'),
      sha256: createHash('sha256').update(knowledgeContents, 'utf8').digest('hex'),
    });
    expect(exported.manifest.files).toContainEqual({
      path: 'assets/triangle.svg',
      sizeBytes: assetContents.byteLength,
      sha256: assets[0]?.sha256,
    });
    expect(exported.files.find(({ path }) => path === 'manifest.json')?.contents).toMatch(/\n$/);
  });

  it('对实体输入顺序变化保持相同输出', () => {
    const reordered = createQuestionBankGithubMarkdownExport(
      {
        ...data,
        topics: [...data.topics].reverse(),
        knowledge: [...data.knowledge].reverse(),
        questions: [...data.questions].reverse(),
        groups: [...data.groups].reverse(),
        exams: [...data.exams].reverse(),
      },
      assets,
    );

    expect(reordered.files).toEqual(createQuestionBankGithubMarkdownExport(data, assets).files);
  });

  it('为保留设备名和超长 ID 生成跨平台安全文件名', () => {
    const longId = `a${':'.repeat(127)}`;
    const exported = createQuestionBankGithubMarkdownExport(
      {
        ...data,
        topics: [...data.topics, { ...topic, id: 'CON' }, { ...topic, id: longId }],
      },
      assets,
    );
    const longIdPath = exported.files.find(({ path }) => path.includes('~x~'))?.path;

    expect(exported.files.some(({ path }) => path === 'topics/id-~43~4F~4E.md')).toBe(true);
    expect(longIdPath).toBeDefined();
    expect(longIdPath?.split('/').at(-1)?.length).toBeLessThan(255);
  });

  it('为仅大小写不同的稳定 ID 生成跨平台不冲突的导出路径', () => {
    const collidingIds: QuestionBankData = {
      ...data,
      topics: [
        ...data.topics,
        { ...topic, id: 'TopicA', name: '大写 ID' },
        { ...topic, id: 'topica', name: '小写 ID' },
      ],
    };
    const exports = [
      createQuestionBankGithubMarkdownExport(collidingIds, assets),
      createQuestionBankObsidianVaultExport(collidingIds, assets),
      createQuestionBankNotionExport(collidingIds, assets),
    ];

    expect(exports[0]?.files.map(({ path }) => path)).toContain('topics/id-~54opic~41.md');
    expect(exports[0]?.files.map(({ path }) => path)).toContain('topics/id-topica.md');
    for (const exported of exports) {
      const portablePaths = exported.files.map(({ path }) =>
        path.normalize('NFC').toLocaleLowerCase('en-US'),
      );
      expect(new Set(portablePaths).size).toBe(portablePaths.length);
    }
  });

  it('拒绝悬空或类型错误的 Markdown 内部引用', () => {
    const broken: QuestionBankData = {
      ...data,
      knowledge: [{ ...knowledge, body: '[失效](oqb://question/missing-question)' }],
    };

    expect(() => createQuestionBankGithubMarkdownExport(broken, assets)).toThrow(
      '导出引用目标不存在或类型不匹配',
    );
  });

  it('不会因转义反引号跨度误判而漏掉悬空的 Markdown 内部引用', () => {
    const escapedRun =
      String.fromCharCode(92) +
      '``[失效](oqb://question/missing-question)' +
      String.fromCharCode(92) +
      '`';
    const broken: QuestionBankData = {
      ...data,
      knowledge: [{ ...knowledge, body: escapedRun }],
    };

    expect(() => createQuestionBankGithubMarkdownExport(broken, assets)).toThrow(
      '导出引用目标不存在或类型不匹配',
    );
  });

  it('不会因无效代码围栏而漏掉悬空的 Markdown 内部引用', () => {
    const broken: QuestionBankData = {
      ...data,
      knowledge: [
        {
          ...knowledge,
          body: '```bad` info\n[失效](oqb://question/missing-question)',
        },
      ],
    };

    expect(() => createQuestionBankGithubMarkdownExport(broken, assets)).toThrow(
      '导出引用目标不存在或类型不匹配',
    );
  });

  it('忽略允许包含反引号的信息字符串的波浪号围栏内部引用', () => {
    const fenced: QuestionBankData = {
      ...data,
      knowledge: [
        {
          ...knowledge,
          body: '~~~bad` info\n[失效](oqb://question/missing-question)\n~~~',
        },
      ],
    };

    expect(() => createQuestionBankGithubMarkdownExport(fenced, assets)).not.toThrow();
  });
});

describe('Obsidian 页面文件名长度', () => {
  it('按 UTF-8 字节限制多字节标题的路径段长度', () => {
    const exported = createQuestionBankObsidianVaultExport(
      { ...data, topics: [{ ...topic, name: '😀'.repeat(80) }] },
      assets,
    );
    const topicPage = exported.files.find(
      ({ path }) => path.startsWith('考点/') && path !== '考点/索引.md',
    );

    expect(topicPage).toBeDefined();
    expect(Buffer.byteLength(topicPage?.path.split('/').at(-1) ?? '', 'utf8')).toBeLessThanOrEqual(
      255,
    );
  });
});

describe('OpenQuestionBank Obsidian Vault 导出器', () => {
  it('生成 Wiki 链接、图片嵌入和含 SHA-256 的发布清单', () => {
    const obsidianData: QuestionBankData = {
      ...data,
      knowledge: [
        {
          ...knowledge,
          body: [
            '[关联题目](oqb://question/question-single-choice)',
            '![三角形](assets/triangle.svg?view=raw#preview)',
            '[资源文件](assets/triangle.svg)',
            '[path_name](assets/triangle.svg)',
            '`[行内代码](../questions/id-question-single-choice.md)`',
            '```md\n[代码示例](oqb://question/question-single-choice)\n```',
          ].join('\n\n'),
        },
      ],
    };

    const exported = createQuestionBankObsidianVaultExport(obsidianData, assets);
    const knowledgeFile = exported.files.find(({ contents }) =>
      contents.includes('题库ID: "knowledge-foundations"'),
    );
    const knowledgeContents = knowledgeFile?.contents;
    const questionFile = exported.files.find(({ contents }) =>
      contents.includes('题库ID: "question-single-choice"'),
    );
    const questionContents = questionFile?.contents;
    const questionPagePath = questionFile?.path?.replace(/\.md$/, '');
    const questionPageTitle = questionPagePath?.split('/').at(-1);

    expect(knowledgeFile?.path).toBe('知识笔记/基础知识.md');
    expect(questionFile?.path).toMatch(/^题目\/.+\.md$/);
    expect(knowledgeContents).toContain(`[[${questionPagePath}|${questionPageTitle}]]`);
    expect(knowledgeContents).toContain('![[assets/triangle.svg#preview]]');
    expect(knowledgeContents).toContain('[[assets/triangle.svg|资源文件]]');
    expect(knowledgeContents).toContain('[[assets/triangle.svg|path_name]]');
    expect(knowledgeContents).toContain('`[行内代码](../questions/id-question-single-choice.md)`');
    expect(knowledgeContents).toContain(
      '```md\n[代码示例](oqb://question/question-single-choice)\n```',
    );
    expect(exported.files.find(({ path }) => path === '题库首页.md')?.contents).toContain(
      '[[考点/索引|考点（1）]]',
    );
    expect(questionContents).toContain('实体类型: 题目');
    expect(questionContents).toContain('> [!question]- 显示答案与解析');
    expect(questionContents).not.toContain('☑');
    expect(questionContents).not.toContain('☐');
    expect(questionContents).toContain('**上一题：**');
    expect(questionContents).toContain('**下一题：**');
    expect(exported.manifest).toMatchObject({
      format: 'openquestionbank-obsidian-vault',
      formatVersion: '2.0.0',
      schemaVersion: '1.0.0',
      bank: { id: bank.id, name: bank.name, version: bank.version },
      statistics: {
        entities: { bank: 1, topics: 1, knowledge: 1, questions: 6, groups: 1, exams: 3 },
        totalEntities: 13,
      },
    });
    expect(exported.manifest.files).toContainEqual({
      path: knowledgeFile?.path,
      sizeBytes: Buffer.byteLength(knowledgeContents ?? '', 'utf8'),
      sha256: createHash('sha256')
        .update(knowledgeContents ?? '', 'utf8')
        .digest('hex'),
    });
    expect(exported.manifest.files).toContainEqual({
      path: 'assets/triangle.svg',
      sizeBytes: assetContents.byteLength,
      sha256: assets[0]?.sha256,
    });
    expect(exported.files.find(({ path }) => path === '题库首页.md')?.contents).not.toContain(
      'GitHub',
    );
  });

  it('解析中的元数据同名标题仍完整收纳在折叠答案区内', () => {
    const explanation = [
      '这是答案解析的开头。',
      '## 所属考点',
      '这是解析中的同名标题内容。',
      '## 标签',
      '这段解析也必须保持折叠。',
    ].join('\n\n');
    const obsidianData: QuestionBankData = {
      ...data,
      questions: data.questions.map((question) =>
        question.id === 'question-single-choice' ? { ...question, explanation } : question,
      ),
    };
    const questionContents = createQuestionBankObsidianVaultExport(obsidianData, assets).files.find(
      ({ contents }) => contents.includes('题库ID: "question-single-choice"'),
    )?.contents;

    expect(questionContents).toContain('> [!question]- 显示答案与解析');
    expect(questionContents).toContain(
      '> ## 所属考点\n>\n> 这是解析中的同名标题内容。\n>\n> ## 标签\n>\n> 这段解析也必须保持折叠。',
    );
  });

  it('生成适用于 Windows 的文件名并消解同类页面标题冲突', () => {
    const exported = createQuestionBankObsidianVaultExport(
      {
        ...data,
        topics: [{ ...topic, name: 'CON.txt' }],
      },
      assets,
    );
    const questionPaths = exported.files
      .filter(({ path }) => path.startsWith('题目/') && path !== '题目/索引.md')
      .map(({ path }) => path);

    expect(exported.files.map(({ path }) => path)).toContain('考点/考点 CON.txt.md');
    expect(new Set(questionPaths).size).toBe(data.questions.length);
  });

  it('对实体输入顺序变化保持相同输出', () => {
    const reordered = createQuestionBankObsidianVaultExport(
      {
        ...data,
        topics: [...data.topics].reverse(),
        knowledge: [...data.knowledge].reverse(),
        questions: [...data.questions].reverse(),
        groups: [...data.groups].reverse(),
        exams: [...data.exams].reverse(),
      },
      assets,
    );

    expect(reordered.files).toEqual(createQuestionBankObsidianVaultExport(data, assets).files);
  });

  it('拒绝悬空或类型错误的正文引用', () => {
    const broken: QuestionBankData = {
      ...data,
      knowledge: [{ ...knowledge, body: '[失效](oqb://question/missing-question)' }],
    };

    expect(() => createQuestionBankObsidianVaultExport(broken, assets)).toThrow(
      '导出引用目标不存在或类型不匹配',
    );
  });
});

describe('OpenQuestionBank Notion 导入包导出器', () => {
  it('生成题目与答案分离的数据库、练习页面、关系映射和发布清单', () => {
    const exported = createQuestionBankNotionExport(data, assets);
    const topicsCsv = exported.files.find(({ path }) => path === 'databases/topics.csv')?.contents;
    const questionsCsv = exported.files.find(
      ({ path }) => path === 'databases/questions.csv',
    )?.contents;
    const answersCsv = exported.files.find(
      ({ path }) => path === 'databases/answers.csv',
    )?.contents;
    const relationsCsv = exported.files.find(({ path }) => path === 'relations.csv')?.contents;
    const knowledgePage = exported.files.find(
      ({ path }) => path === 'knowledge/id-knowledge-foundations.md',
    )?.contents;
    const questionPage = exported.files.find(
      ({ path }) => path === 'questions/id-question-single-choice.md',
    )?.contents;

    expect(topicsCsv).toContain('name,id,parentId,order,description');
    expect(topicsCsv).toContain('基础知识,topic-foundations,,0');
    expect(questionsCsv).toContain('title,id,type,typeLabel,stemMarkdown,choicesJson,difficulty');
    expect(questionsCsv).not.toContain('answerJson');
    expect(questionsCsv).not.toContain('explanationMarkdown');
    expect(questionsCsv).toContain('单选题');
    expect(answersCsv).toContain('title,id,answerJson,explanationMarkdown,entityJson');
    expect(answersCsv).toContain('这是用于 Schema 测试的通用解析。');
    expect(questionsCsv).toContain('""id"":""choice-a""');
    expect(relationsCsv).toContain(
      'knowledge,knowledge-foundations,topicIds,topic,topic-foundations,0',
    );
    expect(relationsCsv).toContain('exam,exam-fixed,items[1].groupId,group,group-example,1');
    expect(relationsCsv).toContain(
      'exam,exam-template,rules[0].filters.topicIds,topic,topic-foundations,0',
    );
    expect(knowledgePage).toContain('![三角形示意图](../assets/triangle.svg)');
    expect(questionPage).toContain('# 以下哪项符合题目要求？');
    expect(questionPage).toContain('单选题 · 难度：入门 · 分值：1 分');
    expect(questionPage).toContain('**上一题：**');
    expect(questionPage).toContain('**下一题：**');
    expect(questionPage).toContain('练习后可在单独的“答案与解析”数据库中按稳定 ID 查询。');
    expect(questionPage).not.toContain('## 答案\n');
    expect(questionPage).not.toContain('## 解析\n');
    expect(questionPage).not.toContain('选项 A（choice-a）');
    expect(exported.files.find(({ path }) => path === 'README.md')?.contents).toContain(
      '不会自动创建 Notion 原生 Relation 属性',
    );
    expect(exported.manifest).toMatchObject({
      format: 'openquestionbank-notion-import',
      formatVersion: '2.1.0',
      schemaVersion: '1.0.0',
      bank: { id: bank.id, name: bank.name, version: bank.version },
      statistics: {
        entities: { bank: 1, topics: 1, knowledge: 1, questions: 6, groups: 1, exams: 3 },
        totalEntities: 13,
      },
    });
    expect(exported.manifest.files).toContainEqual({
      path: 'relations.csv',
      sizeBytes: Buffer.byteLength(relationsCsv ?? '', 'utf8'),
      sha256: createHash('sha256')
        .update(relationsCsv ?? '', 'utf8')
        .digest('hex'),
    });
    expect(exported.manifest.files).toContainEqual({
      path: 'assets/triangle.svg',
      sizeBytes: assetContents.byteLength,
      sha256: assets[0]?.sha256,
    });
  });

  it('解析中的元数据同名标题不会使答案内容泄漏到练习页面', () => {
    const explanation = [
      '这是答案解析的开头。',
      '## 所属考点',
      '这是解析中的同名标题内容。',
      '## 标签',
      '这段解析也必须保持隐藏。',
    ].join('\n\n');
    const notionData: QuestionBankData = {
      ...data,
      questions: data.questions.map((question) =>
        question.id === 'question-single-choice' ? { ...question, explanation } : question,
      ),
    };
    const questionContents = createQuestionBankNotionExport(notionData, assets).files.find(
      ({ path }) => path === 'questions/id-question-single-choice.md',
    )?.contents;

    expect(questionContents).toContain('练习后可在单独的“答案与解析”数据库中按稳定 ID 查询。');
    expect(questionContents).not.toContain('这是答案解析的开头。');
    expect(questionContents).not.toContain('这是解析中的同名标题内容。');
    expect(questionContents).not.toContain('这段解析也必须保持隐藏。');
  });

  it('题干中的内部答案标记不会隐藏后续题目内容', () => {
    const question = data.questions.find(({ id }) => id === 'question-single-choice');
    if (!question || !('choices' in question)) {
      throw new Error('测试题库缺少单选题');
    }
    const firstChoice = question.choices[0];
    if (!firstChoice) {
      throw new Error('单选题必须包含选项');
    }

    const markers = getQuestionAnswerSectionMarkers(question.id);
    const stem = ['题干开头。', markers.start, '## 答案', '这段文字仍属于题干。'].join('\n\n');
    const questionData: QuestionBankData = {
      ...data,
      questions: data.questions.map((item) => (item.id === question.id ? { ...item, stem } : item)),
    };
    const obsidianPage = createQuestionBankObsidianVaultExport(questionData, assets).files.find(
      ({ contents }) => contents.includes(`题库ID: "${question.id}"`),
    )?.contents;
    const notionPage = createQuestionBankNotionExport(questionData, assets).files.find(
      ({ path }) => path === 'questions/id-question-single-choice.md',
    )?.contents;
    const foldedAnswerIndex = obsidianPage?.indexOf('> [!question]- 显示答案与解析') ?? -1;
    const choiceIndex = obsidianPage?.indexOf(firstChoice.text) ?? -1;
    const injectedTextIndex = obsidianPage?.indexOf('这段文字仍属于题干。') ?? -1;

    expect(choiceIndex).toBeGreaterThanOrEqual(0);
    expect(injectedTextIndex).toBeGreaterThanOrEqual(0);
    expect(foldedAnswerIndex).toBeGreaterThanOrEqual(0);
    expect(choiceIndex).toBeLessThan(foldedAnswerIndex);
    expect(injectedTextIndex).toBeLessThan(foldedAnswerIndex);
    expect(notionPage).toContain(firstChoice.text);
    expect(notionPage).toContain('这段文字仍属于题干。');
  });

  it('解析代码块中的答案标记不会使后续答案内容泄漏到练习页面', () => {
    const question = data.questions.find(({ id }) => id === 'question-single-choice');
    if (!question) {
      throw new Error('测试题库缺少单选题');
    }
    const markers = getQuestionAnswerSectionMarkers(question.id);
    const explanation = ['解析开头。', '```md', markers.end, '```', '后续解析必须保持隐藏。'].join(
      '\n',
    );
    const questionData: QuestionBankData = {
      ...data,
      questions: data.questions.map((item) =>
        item.id === question.id ? { ...item, explanation } : item,
      ),
    };
    const obsidianPage = createQuestionBankObsidianVaultExport(questionData, assets).files.find(
      ({ contents }) => contents.includes(`题库ID: "${question.id}"`),
    )?.contents;
    const notionPage = createQuestionBankNotionExport(questionData, assets).files.find(
      ({ path }) => path === 'questions/id-question-single-choice.md',
    )?.contents;

    expect(obsidianPage).toContain('> 后续解析必须保持隐藏。');
    expect(obsidianPage).not.toContain('\n后续解析必须保持隐藏。');
    expect(notionPage).not.toContain('后续解析必须保持隐藏。');
  });

  it('对实体输入顺序变化保持相同输出', () => {
    const reordered = createQuestionBankNotionExport(
      {
        ...data,
        topics: [...data.topics].reverse(),
        knowledge: [...data.knowledge].reverse(),
        questions: [...data.questions].reverse(),
        groups: [...data.groups].reverse(),
        exams: [...data.exams].reverse(),
      },
      assets,
    );

    expect(reordered.files).toEqual(createQuestionBankNotionExport(data, assets).files);
  });

  it('按 CSV 规则转义逗号、引号和多行正文', () => {
    const multilineData: QuestionBankData = {
      ...data,
      knowledge: [
        {
          ...knowledge,
          body: '第一行, 带逗号\n第二行带有"引号"',
        },
      ],
    };
    const knowledgeCsv = createQuestionBankNotionExport(multilineData, assets).files.find(
      ({ path }) => path === 'databases/knowledge.csv',
    )?.contents;

    expect(knowledgeCsv).toContain('"第一行, 带逗号\r\n第二行带有""引号"""');
  });

  it('拒绝缺少 Bank 或题库引用资源的数据', () => {
    const withoutBank: QuestionBankData = { ...data };
    delete withoutBank.bank;

    expect(() => createQuestionBankNotionExport(withoutBank, assets)).toThrow('有效的 Bank 实体');
    expect(() => createQuestionBankNotionExport(data, [])).toThrow('缺少题库引用的资源文件');
  });
});
