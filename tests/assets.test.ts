import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { platform, tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  validateQuestionBankDirectory,
  type QuestionBankData,
} from '../packages/core/src/index.js';
import {
  collectExportAssetSources,
  copyExportAssets,
  prepareExportDirectory,
  readPreviousExportFiles,
  removeStaleExportFiles,
} from '../packages/exporters/src/export-writer.js';
import { writeQuestionBankJsonExport } from '../packages/exporters/src/index.js';
import { bank, knowledge } from './fixtures.js';

describe('Core 资源校验', () => {
  let rootDir: string;
  let externalDir: string | undefined;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'oqb-assets-'));
    externalDir = undefined;
    await createBank(rootDir);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
    if (externalDir) {
      await rm(externalDir, { recursive: true, force: true });
    }
  });

  it('检查知识、题目和题组的资源链接、清单与文件', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        ['assets/diagram image.svg', 'assets/handout.pdf'],
        [
          '![图](<assets/diagram%20image.svg?view=full#preview>)',
          '![引用式图][diagram]',
          '[附件](assets/handout.pdf)',
          '[diagram]: <assets/diagram image.svg>',
        ].join('\n'),
      ),
    );
    await writeFile(
      join(rootDir, 'questions/question.yaml'),
      questionYaml('![题目图](assets/question.svg)', ['assets/question.svg']),
    );
    await writeFile(
      join(rootDir, 'groups/group.yaml'),
      groupYaml('![材料图](<assets/group image.svg>)', ['assets/group image.svg']),
    );
    await writeFile(join(rootDir, 'assets/diagram image.svg'), '<svg/>');
    await writeFile(join(rootDir, 'assets/handout.pdf'), 'pdf');
    await writeFile(join(rootDir, 'assets/question.svg'), '<svg/>');
    await writeFile(join(rootDir, 'assets/group image.svg'), '<svg/>');

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    expect(result.diagnostics.filter(({ code }) => code !== 'OQB-QUALITY-006')).toEqual([]);
  });

  it('校验省略分号的 HTML 字符引用资源链接', async () => {
    const assetPath = 'assets/diagram&/guide.svg';
    await mkdir(join(rootDir, 'assets/diagram&'), { recursive: true });
    await writeFile(join(rootDir, assetPath), '<svg/>');
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown([assetPath], '![图片](<assets/diagram&amp/guide.svg>)'),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    expect(result.diagnostics.filter(({ code }) => code.startsWith('OQB-ASSET-'))).toEqual([]);
  });

  it('检查简答题参考答案中的资源链接与 assets 清单', async () => {
    const assetPath = 'assets/answer-image.png';
    await writeFile(join(rootDir, assetPath), 'image');
    await writeFile(
      join(rootDir, 'questions/question.yaml'),
      shortAnswerQuestionYaml(`参考图 ![答案图](${assetPath})`, []),
    );

    const unlisted = await validateQuestionBankDirectory(rootDir);

    expect(unlisted.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OQB-ASSET-003',
        entityId: 'question-asset',
        fieldPath: 'answer.referenceAnswer',
        message: 'Markdown 资源链接未列入 assets：assets/answer-image.png',
      }),
    );

    await writeFile(
      join(rootDir, 'questions/question.yaml'),
      shortAnswerQuestionYaml(`参考图 ![答案图](${assetPath})`, [assetPath]),
    );
    const listed = await validateQuestionBankDirectory(rootDir);

    expect(listed.valid, JSON.stringify(listed.diagnostics, null, 2)).toBe(true);
    expect(listed.diagnostics.filter(({ code }) => code.startsWith('OQB-ASSET-'))).toEqual([]);
  });

  it('拒绝在没有 assets 清单的试卷说明中引用本地资源', async () => {
    const assetPath = 'assets/exam-handout.pdf';
    await writeFile(join(rootDir, assetPath), 'pdf');
    await writeFile(join(rootDir, 'questions/question.yaml'), questionYaml('题目', []));
    await writeFile(
      join(rootDir, 'exams/exam.yaml'),
      [
        'id: exam-asset',
        'title: 资源试卷',
        `description: "[讲义](${assetPath})"`,
        'mode: fixed',
        'items:',
        '  - kind: question',
        '    questionId: question-asset',
        '    score: 1',
      ].join('\n'),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OQB-ASSET-003',
        entityId: 'exam-asset',
        file: 'exams/exam.yaml',
        fieldPath: 'description',
        message: '题库、考点或试卷说明不能声明本地资源链接：assets/exam-handout.pdf',
      }),
    );
  });

  it('限制引用资源累计大小，并按资源路径去重', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        ['assets/shared.dat', 'assets/first.dat'],
        '[共享资源](assets/shared.dat) [第一份资源](assets/first.dat)',
      ),
    );
    await writeFile(
      join(rootDir, 'questions/question.yaml'),
      questionYaml('![共享资源](assets/shared.dat) ![第二份资源](assets/second.dat)', [
        'assets/shared.dat',
        'assets/second.dat',
      ]),
    );
    await writeFile(join(rootDir, 'assets/shared.dat'), '12');
    await writeFile(join(rootDir, 'assets/first.dat'), '123');
    await writeFile(join(rootDir, 'assets/second.dat'), '456');

    const overLimit = await validateQuestionBankDirectory(rootDir, { maxTotalAssetBytes: 7 });
    const atLimit = await validateQuestionBankDirectory(rootDir, { maxTotalAssetBytes: 8 });

    expect(overLimit.valid).toBe(false);
    expect(overLimit.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'OQB-ASSET-005', severity: 'fatal' }),
    );
    expect(atLimit.valid).toBe(true);
    expect(atLimit.diagnostics.filter(({ code }) => code !== 'OQB-QUALITY-006')).toEqual([]);
  });

  it('拒绝无效的引用资源累计大小限制', async () => {
    const result = await validateQuestionBankDirectory(rootDir, { maxTotalAssetBytes: -1 });

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'OQB-FILE-020', severity: 'fatal' }),
    );
  });

  it('导出 API 也会限制引用资源累计大小', async () => {
    const path = 'assets/large.dat';
    await writeFile(join(rootDir, path), '1234');
    const data: QuestionBankData = {
      bank,
      topics: [],
      knowledge: [{ ...knowledge, body: '资源', assets: [path] }],
      questions: [],
      groups: [],
      exams: [],
    };

    await expect(collectExportAssetSources(rootDir, data, bank, 3)).rejects.toThrow(
      '题库引用资源累计大小超过限制 3 字节',
    );
  });

  it('复制资源前重新验证来源路径，拒绝被替换为题库外目录的路径', async () => {
    externalDir = await mkdtemp(join(tmpdir(), 'oqb-assets-external-'));
    const sourceAssetDirectory = join(rootDir, 'assets');
    const movedAssetDirectory = join(rootDir, 'assets-original');
    const outsideFile = join(externalDir, 'image.svg');
    const outputDir = join(rootDir, 'export');
    const assetPath = 'assets/image.svg';
    const data: QuestionBankData = {
      bank,
      topics: [],
      knowledge: [
        {
          ...knowledge,
          body: '![图片](assets/image.svg)',
          assets: [assetPath],
        },
      ],
      questions: [],
      groups: [],
      exams: [],
    };
    await writeFile(join(rootDir, assetPath), '<svg>题库内资源</svg>');
    await writeFile(outsideFile, '<svg>题库外内容</svg>');
    const sources = await collectExportAssetSources(rootDir, data, bank);
    await mkdir(outputDir);

    await rename(sourceAssetDirectory, movedAssetDirectory);
    await symlink(externalDir, sourceAssetDirectory, platform() === 'win32' ? 'junction' : 'dir');

    await expect(copyExportAssets(sources, outputDir)).rejects.toThrow('题库资源目录');
    await expect(readFile(join(outputDir, assetPath), 'utf8')).rejects.toHaveProperty(
      'code',
      'ENOENT',
    );
  });

  it('导出 API 拒绝资源路径中间层的符号链接', async () => {
    const targetDirectory = join(rootDir, 'assets/actual');
    const linkedDirectory = join(rootDir, 'assets/linked');
    const assetPath = 'assets/linked/image.dat';
    await mkdir(targetDirectory);
    await symlink(targetDirectory, linkedDirectory, platform() === 'win32' ? 'junction' : 'dir');
    await writeFile(join(targetDirectory, 'image.dat'), 'image');
    const data: QuestionBankData = {
      bank,
      topics: [],
      knowledge: [
        {
          ...knowledge,
          body: `![图片](${assetPath})`,
          assets: [assetPath],
        },
      ],
      questions: [],
      groups: [],
      exams: [],
    };

    await expect(collectExportAssetSources(rootDir, data, bank)).rejects.toThrow('符号链接');
  });

  it('复制 SVG 时重新检查内容，拒绝校验后同大小替换的活动内容', async () => {
    const assetPath = 'assets/image.svg';
    const sourcePath = join(rootDir, assetPath);
    const outputDir = join(rootDir, 'svg-export');
    const safeSvg = `<svg>${' '.repeat(11)}</svg>`;
    const unsafeSvg = '<svg onload="x"></svg>';
    const data: QuestionBankData = {
      bank,
      topics: [],
      knowledge: [{ ...knowledge, body: '![图片](assets/image.svg)', assets: [assetPath] }],
      questions: [],
      groups: [],
      exams: [],
    };
    expect(Buffer.byteLength(safeSvg)).toBe(Buffer.byteLength(unsafeSvg));
    await writeFile(sourcePath, safeSvg);
    const sources = await collectExportAssetSources(rootDir, data, bank);
    await mkdir(outputDir);
    await copyExportAssets(sources, outputDir);
    expect(await readFile(join(outputDir, assetPath), 'utf8')).toBe(safeSvg);
    await writeFile(sourcePath, unsafeSvg);

    await expect(copyExportAssets(sources, outputDir)).rejects.toThrow('事件处理属性');
    expect(await readFile(join(outputDir, assetPath), 'utf8')).toBe(safeSvg);
  });

  it('资源校验失败时保留上一版全部资源', async () => {
    const firstAssetPath = 'assets/first.bin';
    const lastAssetPath = 'assets/last.svg';
    const outputDir = join(rootDir, 'svg-export');
    const firstSourcePath = join(rootDir, firstAssetPath);
    const lastSourcePath = join(rootDir, lastAssetPath);
    const safeSvg = `<svg>${' '.repeat(11)}</svg>`;
    const unsafeSvg = '<svg onload="x"></svg>';
    const data: QuestionBankData = {
      bank,
      topics: [],
      knowledge: [
        {
          ...knowledge,
          body: '![数据](assets/first.bin) ![图片](assets/last.svg)',
          assets: [firstAssetPath, lastAssetPath],
        },
      ],
      questions: [],
      groups: [],
      exams: [],
    };
    await writeFile(firstSourcePath, 'old');
    await writeFile(lastSourcePath, safeSvg);
    const sources = await collectExportAssetSources(rootDir, data, bank);
    await mkdir(outputDir);
    await copyExportAssets(sources, outputDir);

    await writeFile(firstSourcePath, 'new');
    await writeFile(lastSourcePath, unsafeSvg);
    await expect(copyExportAssets(sources, outputDir)).rejects.toThrow('事件处理属性');

    expect(await readFile(join(outputDir, firstAssetPath), 'utf8')).toBe('old');
    expect(await readFile(join(outputDir, lastAssetPath), 'utf8')).toBe(safeSvg);
  });

  it('解码 HTML 字符引用后校验资源文件名', async () => {
    const assetPath = 'assets/diagram&guide.svg';
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown([assetPath], '![图](<assets/diagram&amp;guide.svg>)'),
    );
    await writeFile(join(rootDir, assetPath), '<svg/>');

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('检查块引用中的引用式资源链接定义', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        [],
        ['> ![块引用图片][diagram]', '>', '> [diagram]: <assets/missing.svg>'].join('\n'),
      ),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain('OQB-ASSET-002');
    expect(result.diagnostics.map(({ code }) => code)).toContain('OQB-ASSET-003');
  });

  it('检查嵌套列表中的引用式资源链接定义', async () => {
    await writeFile(join(rootDir, 'assets/nested.svg'), '<svg/>');
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        ['assets/nested.svg'],
        [
          '- 外层列表',
          '  - 内层列表',
          '    ![嵌套图片][nested-image]',
          '    [nested-image]: <assets/nested.svg>',
        ].join('\n'),
      ),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('重复的引用标签使用首个定义', async () => {
    await writeFile(join(rootDir, 'assets/valid.svg'), '<svg/>');
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        [],
        [
          '![首个目标缺失][first]',
          '![后续目标生效错误][second]',
          '[first]: <assets/missing-first.svg>',
          '[first]: <assets/valid.svg>',
          '[second]: <assets/valid.svg>',
          '[second]: <assets/missing-later.svg>',
        ].join('\n'),
      ),
    );

    const result = await validateQuestionBankDirectory(rootDir);
    const missingAssetMessages = result.diagnostics
      .filter(({ code }) => code === 'OQB-ASSET-002')
      .map(({ message }) => message);

    expect(result.valid).toBe(false);
    expect(
      missingAssetMessages.some((message) => message.includes('assets/missing-first.svg')),
    ).toBe(true);
    expect(
      missingAssetMessages.some((message) => message.includes('assets/missing-later.svg')),
    ).toBe(false);
  });

  it('报告未登记、未引用和缺失的资源文件', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        ['assets/orphan.svg'],
        '![已存在](assets/inline.svg) ![缺失](assets/not-found.svg)',
      ),
    );
    await writeFile(
      join(rootDir, 'questions/question.yaml'),
      questionYaml('[跨实体链接](assets/orphan.svg)', []),
    );
    await writeFile(join(rootDir, 'assets/orphan.svg'), '<svg/>');
    await writeFile(join(rootDir, 'assets/inline.svg'), '<svg/>');

    const result = await validateQuestionBankDirectory(rootDir);
    const codes = result.diagnostics.map(({ code }) => code);

    expect(result.valid).toBe(false);
    expect(codes).toContain('OQB-ASSET-002');
    expect(codes).toContain('OQB-ASSET-003');
    expect(codes).toContain('OQB-ASSET-004');
  });

  it('拒绝资源目录之外及路径穿越的资源地址', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        ['assets/../outside.svg'],
        [
          '![越界](assets/%2e%2e/outside.svg)',
          '![绝对路径](C:/outside.svg)',
          '![文件协议](file:///outside.svg)',
        ].join(' '),
      ),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.some(({ code }) => code === 'OQB-ASSET-001')).toBe(true);
  });

  it('在检查资源目录边界前解码 HTML 分隔符和点号', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        [],
        [
          '![分隔符路径](<assets&sol;..&sol;outside.svg>)',
          '![点号路径](<assets/&period;&period;/outside.svg>)',
        ].join(' '),
      ),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.filter(({ code }) => code === 'OQB-ASSET-001')).toHaveLength(2);
  });

  it('拒绝包含事件处理器的 SVG 资源', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(['assets/unsafe.svg'], '![图](assets/unsafe.svg)'),
    );
    await writeFile(
      join(rootDir, 'assets/unsafe.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0"/></svg>',
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OQB-SECURITY-003',
        severity: 'error',
        entityId: 'knowledge-asset',
      }),
    );
  });

  it('拒绝使用 XML 命名空间前缀嵌入活动内容的 SVG 资源', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(['assets/unsafe.svg'], '![图](assets/unsafe.svg)'),
    );
    const unsafeElements = [
      '<active:script xmlns:active="http://www.w3.org/2000/svg">alert(1)</active:script>',
      '<图形:script xmlns:图形="http://www.w3.org/2000/svg">alert(1)</图形:script>',
      '<active:foreignObject xmlns:active="http://www.w3.org/2000/svg" />',
      '<active:style xmlns:active="http://www.w3.org/2000/svg">.shape { display: none }</active:style>',
      '<active:animate xmlns:active="http://www.w3.org/2000/svg" attributeName="opacity" />',
    ];

    for (const unsafeElement of unsafeElements) {
      await writeFile(
        join(rootDir, 'assets/unsafe.svg'),
        `<svg xmlns="http://www.w3.org/2000/svg">${unsafeElement}</svg>`,
      );

      const result = await validateQuestionBankDirectory(rootDir);

      expect(result.valid).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'OQB-SECURITY-003',
          severity: 'error',
          entityId: 'knowledge-asset',
        }),
      );
    }
  });

  it.each([
    ['外部 HTTP 图像', '<svg><image href="https://example.com/image.png" /></svg>'],
    ['内嵌 data URI', '<svg><image href="data:image/png;base64,AAAA" /></svg>'],
    ['CSS 外部资源', '<svg><path fill="url(https://example.com/pattern.svg#paint)" /></svg>'],
    ['XML 外部实体', '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///secret">]><svg>&xxe;</svg>'],
  ])('拒绝包含%s的 SVG 资源', async (_description, svg) => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(['assets/unsafe.svg'], '![图](assets/unsafe.svg)'),
    );
    await writeFile(join(rootDir, 'assets/unsafe.svg'), svg);

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OQB-SECURITY-003',
        severity: 'error',
        entityId: 'knowledge-asset',
      }),
    );
  });

  it('允许 SVG 引用同一文件中的片段资源', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(['assets/internal.svg'], '![图](assets/internal.svg)'),
    );
    await writeFile(
      join(rootDir, 'assets/internal.svg'),
      '<svg><defs><linearGradient id="paint" /></defs><path fill="url(#paint)" /></svg>',
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('共享 SVG 的安全诊断关联到每个引用实体', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(['assets/shared.svg'], '![图](assets/shared.svg)'),
    );
    await writeFile(
      join(rootDir, 'questions/question.yaml'),
      questionYaml('![图](assets/shared.svg)', ['assets/shared.svg']),
    );
    await writeFile(join(rootDir, 'assets/shared.svg'), '<svg onload="alert(1)"/>');

    const result = await validateQuestionBankDirectory(rootDir);
    const diagnostics = result.diagnostics.filter(({ code }) => code === 'OQB-SECURITY-003');

    expect(diagnostics.map(({ entityId }) => entityId).sort()).toEqual([
      'knowledge-asset',
      'question-asset',
    ]);
  });

  it('在创建输出目录前拒绝跨平台重名路径', async () => {
    const outputDir = join(rootDir, 'portable-collision-output');

    await expect(
      prepareExportDirectory(rootDir, outputDir, bank, ['topics/Name.md', 'topics/name.md']),
    ).rejects.toThrow('大小写或 Unicode 规范化不敏感');
    expect(await readdir(rootDir)).not.toContain('portable-collision-output');
  });

  it('旧文件路径与当前路径可能指向同一文件时保留当前文件', async () => {
    const outputDir = join(rootDir, 'portable-path-output');
    const contents = '生成的页面';
    await mkdir(outputDir);
    await writeFile(join(outputDir, 'Old.md'), contents);
    await writeFile(join(outputDir, 'old.md'), contents);

    await removeStaleExportFiles(
      outputDir,
      [
        {
          path: 'Old.md',
          sizeBytes: Buffer.byteLength(contents, 'utf8'),
          sha256: createHash('sha256').update(contents).digest('hex'),
        },
      ],
      ['old.md'],
    );

    expect(await readFile(join(outputDir, 'old.md'), 'utf8')).toBe(contents);
  });

  it('忽略旧清单中的路径穿越记录', async () => {
    const outputDir = join(rootDir, 'malformed-manifest-output');
    const outsideFile = join(rootDir, 'outside.txt');
    const contents = '用户文件';
    await mkdir(outputDir);
    await writeFile(outsideFile, contents);
    await writeFile(
      join(outputDir, 'manifest.json'),
      JSON.stringify({
        format: 'openquestionbank-json',
        files: [
          {
            path: '../outside.txt',
            sizeBytes: Buffer.byteLength(contents, 'utf8'),
            sha256: createHash('sha256').update(contents).digest('hex'),
          },
        ],
      }),
    );

    const previousFiles = await readPreviousExportFiles(outputDir);
    await removeStaleExportFiles(outputDir, previousFiles, []);

    expect(previousFiles).toEqual([]);
    expect(await readFile(outsideFile, 'utf8')).toBe(contents);
  });

  it('忽略外部链接和代码片段中的示例链接', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        [],
        [
          '[外部链接](https://example.com/image.svg)',
          '`![行内示例](assets/inline.svg)`',
          '```md',
          '![代码块示例](assets/fenced.svg)',
          '```',
          '> ```md',
          '> <script>alert(1)</script>',
          '> ![引用块代码示例](assets/quoted.svg)',
          '> ```',
          '',
          '    <script>alert(1)</script>',
          '    ![缩进代码块示例](assets/indented.svg)',
        ].join('\n'),
      ),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('不会把列表中的缩进资源链接误当作代码块', async () => {
    await writeFile(join(rootDir, 'assets/list.svg'), '<svg/>');
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(['assets/list.svg'], '- 列表内容\n    ![列表图片](assets/list.svg)'),
    );

    const result = await validateQuestionBankDirectory(rootDir);

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('围栏代码中以大于号开头的示例不会屏蔽后续资源链接', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        [],
        [
          '```md',
          '> ![代码示例](assets/example.svg)',
          '```',
          '',
          '![实际图片](assets/missing.svg)',
        ].join('\n'),
      ),
    );

    const result = await validateQuestionBankDirectory(rootDir);
    const codes = result.diagnostics.map(({ code }) => code);

    expect(result.valid).toBe(false);
    expect(codes).toContain('OQB-ASSET-002');
    expect(codes).toContain('OQB-ASSET-003');
  });

  it('检查失配的转义反引号跨度中的实际资源链接', async () => {
    await writeFile(
      join(rootDir, 'knowledge/note.md'),
      knowledgeMarkdown(
        [],
        String.fromCharCode(92) +
          '``![缺失资源](assets/missing.svg)' +
          String.fromCharCode(92) +
          '`',
      ),
    );

    const result = await validateQuestionBankDirectory(rootDir);
    const codes = result.diagnostics.map(({ code }) => code);

    expect(result.valid).toBe(false);
    expect(codes).toContain('OQB-ASSET-002');
    expect(codes).toContain('OQB-ASSET-003');
  });
});

describe('导出文件写入', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'oqb-export-writer-'));
    await createBank(rootDir);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('在创建输出目录或复制资源前拒绝含访问凭据的题库', async () => {
    const assetPath = 'assets/private.dat';
    const outputDirectory = join(rootDir, 'credential-output');
    await writeFile(join(rootDir, assetPath), 'private resource');

    await expect(
      writeQuestionBankJsonExport(
        createExportData([assetPath], 'https://example.com/?access_token=secret'),
        rootDir,
        outputDirectory,
      ),
    ).rejects.toThrow('访问凭据');
    await expect(readdir(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('在创建输出目录前拒绝含凭据的维护者 URL', async () => {
    const assetPath = 'assets/private.dat';
    const outputDirectory = join(rootDir, 'maintainer-credential-output');
    await writeFile(join(rootDir, assetPath), 'private resource');
    const credentialedData: QuestionBankData = {
      ...createExportData([assetPath]),
      bank: {
        ...bank,
        maintainers: [
          { name: 'OpenQuestionBank', url: 'https://example.com/profile?token=secret' },
        ],
      },
    };

    await expect(
      writeQuestionBankJsonExport(credentialedData, rootDir, outputDirectory),
    ).rejects.toThrow('访问凭据');
    await expect(readdir(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('旧导出文件变为新目录时先清理未修改的旧文件', async () => {
    const outputDirectory = join(rootDir, 'file-to-directory-output');
    const stalePath = 'assets/archive';
    const staleContents = '旧资源';
    const assetPath = 'assets/archive/new.dat';
    await mkdir(outputDirectory);
    await mkdir(join(outputDirectory, 'assets'));
    await writeFile(join(outputDirectory, stalePath), staleContents);
    await writePreviousManifest(outputDirectory, stalePath, staleContents);
    await mkdir(join(rootDir, 'assets', 'archive'));
    await writeFile(join(rootDir, assetPath), '新资源');

    await writeQuestionBankJsonExport(createExportData([assetPath]), rootDir, outputDirectory);

    expect(await readFile(join(outputDirectory, 'assets', 'archive', 'new.dat'), 'utf8')).toBe(
      '新资源',
    );
  });

  it('旧导出目录变为新文件时先清理未修改的旧文件和空目录', async () => {
    const outputDirectory = join(rootDir, 'directory-to-file-output');
    const stalePath = 'assets/archive/old.dat';
    const staleContents = '旧资源';
    const assetPath = 'assets/archive';
    await mkdir(join(outputDirectory, 'assets', 'archive'), { recursive: true });
    await writeFile(join(outputDirectory, stalePath), staleContents);
    await writePreviousManifest(outputDirectory, stalePath, staleContents);
    await writeFile(join(rootDir, assetPath), '新资源');

    await writeQuestionBankJsonExport(createExportData([assetPath]), rootDir, outputDirectory);

    expect(await readFile(join(outputDirectory, 'assets', 'archive'), 'utf8')).toBe('新资源');
  });
});

async function createBank(rootDir: string): Promise<void> {
  for (const directory of ['topics', 'knowledge', 'questions', 'groups', 'exams', 'assets']) {
    await mkdir(join(rootDir, directory), { recursive: true });
  }
  await writeFile(
    join(rootDir, 'bank.yaml'),
    [
      'schemaVersion: "1.0.0"',
      'id: asset-bank',
      'name: 资源测试题库',
      'version: "1.0.0"',
      'language: zh-CN',
      'license: CC-BY-4.0',
      'maintainers: [{ name: OpenQuestionBank }]',
      'paths:',
      '  topics: topics',
      '  knowledge: knowledge',
      '  questions: questions',
      '  groups: groups',
      '  exams: exams',
      '  assets: assets',
    ].join('\n'),
  );
}

function createExportData(assets: string[], sourceUrl?: string): QuestionBankData {
  return {
    bank,
    topics: [],
    knowledge: [
      {
        ...knowledge,
        body: '资源写入测试',
        assets,
        source:
          sourceUrl === undefined ? knowledge.source : { ...knowledge.source, url: sourceUrl },
      },
    ],
    questions: [],
    groups: [],
    exams: [],
  };
}

async function writePreviousManifest(
  outputDirectory: string,
  path: string,
  contents: string,
): Promise<void> {
  await writeFile(
    join(outputDirectory, 'manifest.json'),
    JSON.stringify({
      format: 'openquestionbank-json',
      files: [
        {
          path,
          sizeBytes: Buffer.byteLength(contents, 'utf8'),
          sha256: createHash('sha256').update(contents, 'utf8').digest('hex'),
        },
      ],
    }),
  );
}

function knowledgeMarkdown(assets: string[], body: string): string {
  return [
    '---',
    'id: knowledge-asset',
    'title: 资源测试',
    'topicIds: []',
    'prerequisiteIds: []',
    'relatedIds: []',
    'tags: []',
    'assets: ' + JSON.stringify(assets),
    'source: { type: original }',
    'review: { status: draft }',
    '---',
    body,
  ].join('\n');
}

function questionYaml(stem: string, assets: string[]): string {
  return [
    'id: question-asset',
    'type: true_false',
    'stem: ' + JSON.stringify(stem),
    'answer: true',
    'topicIds: []',
    'knowledgeIds: []',
    'difficulty: 入门',
    'tags: []',
    'score: 1',
    'assets: ' + JSON.stringify(assets),
    'source: { type: original }',
    'review: { status: draft }',
  ].join('\n');
}

function shortAnswerQuestionYaml(referenceAnswer: string, assets: string[]): string {
  return [
    'id: question-asset',
    'type: short_answer',
    'stem: 简答题',
    'answer:',
    `  referenceAnswer: ${JSON.stringify(referenceAnswer)}`,
    'topicIds: []',
    'knowledgeIds: []',
    'difficulty: 入门',
    'tags: []',
    'score: 1',
    'assets: ' + JSON.stringify(assets),
    'source: { type: original }',
    'review: { status: draft }',
  ].join('\n');
}

function groupYaml(passage: string, assets: string[]): string {
  return [
    'id: group-asset',
    'title: 资源题组',
    'passage: ' + JSON.stringify(passage),
    'questionIds: [question-asset]',
    'topicIds: []',
    'assets: ' + JSON.stringify(assets),
    'source: { type: original }',
    'review: { status: draft }',
  ].join('\n');
}
