import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateQuestionBankDirectory } from '../packages/core/src/index.js';
import { runCli, type CliOutput } from '../packages/cli/src/index.js';

describe('OpenQuestionBank CLI', () => {
  let rootDir: string;
  let stdout: string[];
  let stderr: string[];
  let output: CliOutput;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'oqb-cli-'));
    stdout = [];
    stderr = [];
    output = {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    };
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('初始化可校验的题库模板', async () => {
    const bankDir = join(rootDir, 'new-bank');

    const exitCode = await runCli(['init', bankDir], output);
    const result = await validateQuestionBankDirectory(bankDir);
    const releaseResult = await validateQuestionBankDirectory(bankDir, { mode: 'release' });
    const bankContents = await readFile(join(bankDir, 'bank.yaml'), 'utf8');

    expect(exitCode).toBe(0);
    expect(result.valid).toBe(true);
    expect(bankContents).toContain("license: 'TBD - not for publication'");
    expect(releaseResult.valid).toBe(false);
    expect(releaseResult.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'OQB-LICENSE-004', fieldPath: 'license' }),
    );
    expect(result.data.topics).toHaveLength(1);
    expect(result.data.knowledge).toHaveLength(1);
    expect(result.data.questions).toHaveLength(1);
    expect(stdout.join('\n')).toContain('已在');
  });

  it('拒绝向非空目录初始化并保留已有文件', async () => {
    const bankDir = join(rootDir, 'existing-bank');
    const existingFile = join(bankDir, 'keep.txt');
    await mkdir(bankDir);
    await writeFile(existingFile, 'existing content');

    const exitCode = await runCli(['init', bankDir], output);

    expect(exitCode).toBe(2);
    expect(await readFile(existingFile, 'utf8')).toBe('existing content');
    expect(stderr.join('\n')).toContain('未覆盖任何文件');
  });

  it('按校验模式报告结果，并统计结构有效实体', async () => {
    const bankDir = join(rootDir, 'bank');
    await runCli(['init', bankDir], output);
    stdout.length = 0;
    stderr.length = 0;

    const draftExitCode = await runCli(['validate', bankDir], output);
    const strictExitCode = await runCli(['validate', bankDir, '--mode', 'strict'], output);
    const statsExitCode = await runCli(['stats', bankDir], output);

    expect(draftExitCode).toBe(0);
    expect(strictExitCode).toBe(1);
    expect(statsExitCode).toBe(0);
    expect(stderr.join('\n')).toContain('OQB-REVIEW-001');
    expect(stdout.join('\n')).toContain('Question：1');
  });

  it('诊断题库及 Node.js 环境', async () => {
    const bankDir = join(rootDir, 'bank');
    await runCli(['init', bankDir], output);
    stdout.length = 0;

    const exitCode = await runCli(['doctor', bankDir], output);

    expect(exitCode).toBe(0);
    expect(stdout.join('\n')).toContain('Node.js');
    expect(stdout.join('\n')).toContain('bank.yaml 已加载');
  });

  it('使用随机种子构建规则组卷结果且不改写源模板', async () => {
    const bankDir = join(rootDir, 'bank');
    const exportDir = join(rootDir, 'dist', 'bank');
    await runCli(['init', bankDir], output);
    const templateFile = join(bankDir, 'exams', 'generated.yaml');
    const template = [
      'id: exam-generated',
      'title: 练习试卷',
      'mode: generated',
      'kind: template',
      'rules:',
      '  - unit: question',
      '    count: 1',
      '    scorePerQuestion: 2',
    ].join('\n');
    await writeFile(templateFile, template);

    const missingSeedExitCode = await runCli(['build', bankDir, '--out', exportDir], output);
    const buildExitCode = await runCli(
      ['build', bankDir, '--seed', 'review-run-1', '--out', exportDir],
      output,
    );
    const exported = JSON.parse(await readFile(join(exportDir, 'question-bank.json'), 'utf8'));
    const generatedExam = exported.data.exams.find(
      (exam: { id: string }) => exam.id === 'exam-generated',
    );

    expect(missingSeedExitCode).toBe(2);
    expect(buildExitCode).toBe(0);
    expect(generatedExam).toMatchObject({
      mode: 'generated',
      kind: 'result',
      randomSeed: 'review-run-1',
      bankVersion: '0.1.0',
      items: [{ kind: 'question', questionId: 'question-example', score: 2 }],
    });
    expect(await readFile(templateFile, 'utf8')).toBe(template);
    expect(stdout.join('\n')).toContain('已按种子生成规则试卷：1 份');
    expect(stdout.join('\n')).toContain('JSON 构建完成');
  });

  it('校验后生成标准 JSON 数据包和可复现清单', async () => {
    const bankDir = join(rootDir, 'bank');
    const exportDir = join(rootDir, 'dist', 'bank');
    await runCli(['init', bankDir], output);
    const questionFile = join(bankDir, 'questions', 'example.yaml');
    const question = (await readFile(questionFile, 'utf8')).replace(
      'explanation: 题库内容以 YAML 和 Markdown 文件保存，可使用 Git 管理变更。',
      'explanation: "[资源](assets/example.txt)"',
    );
    await writeFile(questionFile, `${question}\nassets: [assets/example.txt]\n`);
    await writeFile(join(bankDir, 'assets', 'example.txt'), '资源文件内容');
    stdout.length = 0;

    const firstExitCode = await runCli(
      ['export', bankDir, '--format', 'json', '--out', exportDir],
      output,
    );
    const firstDocument = await readFile(join(exportDir, 'question-bank.json'), 'utf8');
    const firstManifest = await readFile(join(exportDir, 'manifest.json'), 'utf8');
    const exportedAsset = await readFile(join(exportDir, 'assets', 'example.txt'), 'utf8');
    const secondExitCode = await runCli(['export', bankDir, '--out', exportDir], output);

    expect(firstExitCode).toBe(0);
    expect(secondExitCode).toBe(0);
    expect(JSON.parse(firstDocument)).toMatchObject({
      format: 'openquestionbank-json',
      formatVersion: '1.0.0',
      data: { bank: { name: '我的题库' }, questions: [{ id: 'question-example' }] },
    });
    expect(JSON.parse(firstManifest)).toMatchObject({
      bank: { id: 'my-question-bank', version: '0.1.0' },
      statistics: { totalEntities: 4 },
    });
    expect(JSON.parse(firstManifest).files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'assets/example.txt',
          sizeBytes: 18,
          sha256: createHash('sha256').update(exportedAsset, 'utf8').digest('hex'),
        }),
      ]),
    );
    expect(exportedAsset).toBe('资源文件内容');
    expect(await readFile(join(exportDir, 'question-bank.json'), 'utf8')).toBe(firstDocument);
    expect(await readFile(join(exportDir, 'manifest.json'), 'utf8')).toBe(firstManifest);
    expect(stdout.join('\n')).toContain('JSON 导出完成');
  });

  it('校验后生成 GitHub Markdown 阅读包和可复现清单', async () => {
    const bankDir = join(rootDir, 'bank');
    const exportDir = join(rootDir, 'dist', 'github');
    await runCli(['init', bankDir], output);
    const questionFile = join(bankDir, 'questions', 'example.yaml');
    const question = (await readFile(questionFile, 'utf8')).replace(
      'explanation: 题库内容以 YAML 和 Markdown 文件保存，可使用 Git 管理变更。',
      'explanation: "[参考资源](assets/example.txt)"',
    );
    await writeFile(join(bankDir, 'assets', 'example.txt'), '资源文件内容');
    await writeFile(
      join(bankDir, 'questions', 'example.yaml'),
      `${question}\nassets: [assets/example.txt]\n`,
    );

    const firstExitCode = await runCli(
      ['export', bankDir, '--format', 'github-markdown', '--out', exportDir],
      output,
    );
    const readme = await readFile(join(exportDir, 'README.md'), 'utf8');
    const questionPage = await readFile(
      join(exportDir, 'questions', 'id-question-example.md'),
      'utf8',
    );
    const manifest = await readFile(join(exportDir, 'manifest.json'), 'utf8');
    const firstReadme = readme;
    const firstManifest = manifest;
    const secondExitCode = await runCli(
      ['export', bankDir, '--format', 'github-markdown', '--out', exportDir],
      output,
    );

    expect(firstExitCode).toBe(0);
    expect(secondExitCode).toBe(0);
    expect(readme).toContain('[题目（1）](questions/README.md)');
    expect(questionPage).toContain('[参考资源](../assets/example.txt)');
    expect(questionPage).toContain('[基础知识](../topics/id-topic-foundations.md)');
    expect(questionPage).toContain('[示例知识点](../knowledge/id-knowledge-getting-started.md)');
    expect(JSON.parse(manifest)).toMatchObject({
      format: 'openquestionbank-github-markdown',
      formatVersion: '1.2.0',
      bank: { id: 'my-question-bank', version: '0.1.0' },
      statistics: { totalEntities: 4 },
    });
    expect(await readFile(join(exportDir, 'README.md'), 'utf8')).toBe(firstReadme);
    expect(await readFile(join(exportDir, 'manifest.json'), 'utf8')).toBe(firstManifest);
    expect(stdout.join('\n')).toContain('GitHub Markdown 导出完成');
  });

  it('校验后生成 Obsidian Vault 和可复现清单', async () => {
    const bankDir = join(rootDir, 'bank');
    const exportDir = join(rootDir, 'dist', 'obsidian');
    await runCli(['init', bankDir], output);

    const firstExitCode = await runCli(
      ['export', bankDir, '--format', 'obsidian', '--out', exportDir],
      output,
    );
    expect(firstExitCode, stderr.join('\n')).toBe(0);
    const readme = await readFile(join(exportDir, '题库首页.md'), 'utf8');
    const questionPage = await readFile(
      join(exportDir, '题目', 'OpenQuestionBank 的源数据主要使用什么方式维护？.md'),
      'utf8',
    );
    const firstManifest = await readFile(join(exportDir, 'manifest.json'), 'utf8');
    const secondExitCode = await runCli(
      ['export', bankDir, '--format', 'obsidian', '--out', exportDir],
      output,
    );

    expect(firstExitCode).toBe(0);
    expect(secondExitCode).toBe(0);
    expect(readme).toContain('[[考点/索引|考点（1）]]');
    expect(questionPage).toContain('[[考点/基础知识|基础知识]]');
    expect(questionPage).toContain('[[知识笔记/示例知识点|示例知识点]]');
    expect(questionPage).toContain('> [!question]- 显示答案与解析');
    expect(JSON.parse(firstManifest)).toMatchObject({
      format: 'openquestionbank-obsidian-vault',
      formatVersion: '2.1.0',
      bank: { id: 'my-question-bank', version: '0.1.0' },
      statistics: { totalEntities: 4 },
    });
    expect(await readFile(join(exportDir, '题库首页.md'), 'utf8')).toBe(readme);
    expect(await readFile(join(exportDir, 'manifest.json'), 'utf8')).toBe(firstManifest);
    expect(stdout.join('\n')).toContain('Obsidian Vault 导出完成');
  });

  it('重新导出时移除清单中已删除且未修改的题目页', async () => {
    const bankDir = join(rootDir, 'bank');
    const exportDir = join(rootDir, 'dist', 'obsidian');
    const sourceQuestion = join(bankDir, 'questions', 'example.yaml');
    const questionPage = join(
      exportDir,
      '题目',
      'OpenQuestionBank 的源数据主要使用什么方式维护？.md',
    );
    await runCli(['init', bankDir], output);
    const firstExitCode = await runCli(
      ['export', bankDir, '--format', 'obsidian', '--out', exportDir],
      output,
    );
    await rm(sourceQuestion);
    const secondExitCode = await runCli(
      ['export', bankDir, '--format', 'obsidian', '--out', exportDir],
      output,
    );
    const manifest = JSON.parse(await readFile(join(exportDir, 'manifest.json'), 'utf8')) as {
      files: Array<{ path: string }>;
    };

    expect(firstExitCode).toBe(0);
    expect(secondExitCode).toBe(0);
    expect(manifest.files.map(({ path }) => path)).not.toContain(
      '题目/OpenQuestionBank 的源数据主要使用什么方式维护？.md',
    );
    expect(existsSync(questionPage)).toBe(false);
  });

  it('导出失败后保留旧清单并在重试时清理旧页面', async () => {
    const bankDir = join(rootDir, 'bank');
    const exportDir = join(rootDir, 'dist', 'obsidian');
    const sourceQuestion = join(bankDir, 'questions', 'example.yaml');
    const topicPage = join(exportDir, '考点', '基础知识.md');
    const questionPage = join(
      exportDir,
      '题目',
      'OpenQuestionBank 的源数据主要使用什么方式维护？.md',
    );
    await runCli(['init', bankDir], output);
    const firstExitCode = await runCli(
      ['export', bankDir, '--format', 'obsidian', '--out', exportDir],
      output,
    );
    await rm(sourceQuestion);
    await rm(topicPage);
    await mkdir(topicPage);

    const failedExitCode = await runCli(
      ['export', bankDir, '--format', 'obsidian', '--out', exportDir],
      output,
    );
    const manifestAfterFailure = JSON.parse(
      await readFile(join(exportDir, 'manifest.json'), 'utf8'),
    ) as {
      files: Array<{ path: string }>;
    };
    await rm(topicPage, { recursive: true });
    const retryExitCode = await runCli(
      ['export', bankDir, '--format', 'obsidian', '--out', exportDir],
      output,
    );
    const manifestAfterRetry = JSON.parse(
      await readFile(join(exportDir, 'manifest.json'), 'utf8'),
    ) as {
      files: Array<{ path: string }>;
    };

    expect(firstExitCode).toBe(0);
    expect(failedExitCode).toBe(2);
    expect(manifestAfterFailure.files.map(({ path }) => path)).toContain(
      '题目/OpenQuestionBank 的源数据主要使用什么方式维护？.md',
    );
    expect(retryExitCode).toBe(0);
    expect(manifestAfterRetry.files.map(({ path }) => path)).not.toContain(
      '题目/OpenQuestionBank 的源数据主要使用什么方式维护？.md',
    );
    expect(existsSync(questionPage)).toBe(false);
  });

  it('重新导出时保留用户修改过的旧页面和未登记文件', async () => {
    const bankDir = join(rootDir, 'bank');
    const exportDir = join(rootDir, 'dist', 'obsidian');
    const sourceQuestion = join(bankDir, 'questions', 'example.yaml');
    const questionPage = join(
      exportDir,
      '题目',
      'OpenQuestionBank 的源数据主要使用什么方式维护？.md',
    );
    const customFile = join(exportDir, '我的笔记.md');
    await runCli(['init', bankDir], output);
    await runCli(['export', bankDir, '--format', 'obsidian', '--out', exportDir], output);
    await writeFile(questionPage, '用户修改的页面');
    await writeFile(customFile, '用户添加的文件');
    await rm(sourceQuestion);

    const exitCode = await runCli(
      ['export', bankDir, '--format', 'obsidian', '--out', exportDir],
      output,
    );

    expect(exitCode).toBe(0);
    expect(await readFile(questionPage, 'utf8')).toBe('用户修改的页面');
    expect(await readFile(customFile, 'utf8')).toBe('用户添加的文件');
  });

  it('忽略未知格式的旧清单并保留其中列出的文件', async () => {
    const bankDir = join(rootDir, 'bank');
    const exportDir = join(rootDir, 'dist', 'obsidian');
    const customFile = join(exportDir, '我的笔记.md');
    const contents = '用户添加的文件';
    await runCli(['init', bankDir], output);
    await mkdir(exportDir, { recursive: true });
    await writeFile(customFile, contents);
    await writeFile(
      join(exportDir, 'manifest.json'),
      JSON.stringify({
        format: 'openquestionbank-unknown-format',
        files: [
          {
            path: '我的笔记.md',
            sizeBytes: Buffer.byteLength(contents, 'utf8'),
            sha256: createHash('sha256').update(contents).digest('hex'),
          },
        ],
      }),
    );

    const exitCode = await runCli(
      ['export', bankDir, '--format', 'obsidian', '--out', exportDir],
      output,
    );

    expect(exitCode).toBe(0);
    expect(await readFile(customFile, 'utf8')).toBe(contents);
  });

  it('校验后生成 Notion CSV / Markdown 导入包和可复现清单', async () => {
    const bankDir = join(rootDir, 'bank');
    const exportDir = join(rootDir, 'dist', 'notion');
    await runCli(['init', bankDir], output);

    const firstExitCode = await runCli(
      ['export', bankDir, '--format', 'notion', '--out', exportDir],
      output,
    );
    expect(firstExitCode, stderr.join('\n')).toBe(0);
    const readme = await readFile(join(exportDir, 'README.md'), 'utf8');
    const questionsCsv = await readFile(join(exportDir, 'databases', 'questions.csv'), 'utf8');
    const answersCsv = await readFile(join(exportDir, 'databases', 'answers.csv'), 'utf8');
    const relationsCsv = await readFile(join(exportDir, 'relations.csv'), 'utf8');
    const questionPage = await readFile(
      join(exportDir, 'questions', 'id-question-example.md'),
      'utf8',
    );
    const firstManifest = await readFile(join(exportDir, 'manifest.json'), 'utf8');
    const secondExitCode = await runCli(
      ['export', bankDir, '--format', 'notion', '--out', exportDir],
      output,
    );

    expect(firstExitCode).toBe(0);
    expect(secondExitCode).toBe(0);
    expect(readme).toContain('先导入 `databases/questions.csv`');
    expect(readme).toContain('不会自动创建 Notion 原生 Relation');
    expect(questionsCsv).toContain('question-example');
    expect(questionsCsv).not.toContain('answerJson');
    expect(answersCsv).toContain('answerJson');
    expect(relationsCsv).toContain('question,question-example,topicIds,topic,topic-foundations,0');
    expect(questionPage).toContain('OpenQuestionBank 的源数据主要使用什么方式维护？');
    expect(JSON.parse(firstManifest)).toMatchObject({
      format: 'openquestionbank-notion-import',
      formatVersion: '2.2.0',
      bank: { id: 'my-question-bank', version: '0.1.0' },
      statistics: { totalEntities: 4 },
    });
    expect(await readFile(join(exportDir, 'manifest.json'), 'utf8')).toBe(firstManifest);
    expect(stdout.join('\n')).toContain('Notion 导入包导出完成');
  });

  it('支持以格式位置参数简写导出命令', async () => {
    const bankDir = join(rootDir, 'bank');
    await runCli(['init', bankDir], output);

    for (const [formatAlias, outputName, entryFile] of [
      ['github', 'github', 'README.md'],
      ['obsidian', 'obsidian', '题库首页.md'],
      ['notion', 'notion', 'README.md'],
      ['json', 'json', 'question-bank.json'],
    ] as const) {
      const exportDir = join(rootDir, 'dist', outputName);
      const exitCode = await runCli(['export', formatAlias, bankDir, '--out', exportDir], output);

      expect(exitCode, `${formatAlias} 导出失败：${stderr.join('\n')}`).toBe(0);
      await expect(readFile(join(exportDir, entryFile), 'utf8')).resolves.toBeTruthy();
    }
  });

  it('拒绝同时使用格式位置参数和 --format', async () => {
    const exitCode = await runCli(['export', 'notion', rootDir, '--format', 'json'], output);

    expect(exitCode).toBe(2);
    expect(stderr.join('\n')).toContain('格式位置参数与 --format 不能同时使用');
  });

  it('校验失败时不生成导出文件', async () => {
    const bankDir = join(rootDir, 'bank');
    const exportDir = join(rootDir, 'dist');
    await runCli(['init', bankDir], output);
    await writeFile(join(bankDir, 'questions', 'invalid.yaml'), 'id: invalid\n');

    const exitCode = await runCli(['export', bankDir, '--out', exportDir], output);

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('未生成导出文件');
    await expect(readFile(join(exportDir, 'question-bank.json'), 'utf8')).rejects.toHaveProperty(
      'code',
      'ENOENT',
    );
  });

  it('来源 URL 含访问凭据时阻止导出且不回显凭据', async () => {
    const bankDir = join(rootDir, 'bank');
    const exportDir = join(rootDir, 'dist');
    const sourceUrl = 'https://alice:secret@example.com/question';
    await runCli(['init', bankDir], output);
    const questionFile = join(bankDir, 'questions', 'example.yaml');
    const questionTemplate = await readFile(questionFile, 'utf8');
    const question = questionTemplate.replace(
      /source:\r?\n\x20{2}type: original/,
      (sourceBlock) =>
        `${sourceBlock}${sourceBlock.includes('\r\n') ? '\r\n' : '\n'}  url: "${sourceUrl}"`,
    );
    expect(question).not.toBe(questionTemplate);
    await writeFile(questionFile, question);

    const exitCode = await runCli(
      ['export', bankDir, '--format', 'github-markdown', '--out', exportDir],
      output,
    );
    const cliOutput = `${stdout.join('\n')}\n${stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(cliOutput).toContain('OQB-SOURCE-003');
    expect(cliOutput).toContain('未生成导出文件');
    expect(cliOutput).not.toContain('alice');
    expect(cliOutput).not.toContain('secret');
    expect(existsSync(exportDir)).toBe(false);
  });

  it('拒绝将导出目录放入题库源资源目录', async () => {
    const bankDir = join(rootDir, 'bank');
    const assetMarker = join(bankDir, 'assets', '.gitkeep');
    await runCli(['init', bankDir], output);
    const originalAsset = await readFile(assetMarker, 'utf8');

    const exitCode = await runCli(['export', bankDir, '--out', join(bankDir, 'assets')], output);

    expect(exitCode).toBe(2);
    expect(await readFile(assetMarker, 'utf8')).toBe(originalAsset);
    expect(stderr.join('\n')).toContain('题库源数据目录');
  });

  it('在创建路径前拒绝经目录符号链接进入题库源目录', async () => {
    const bankDir = join(rootDir, 'bank');
    const bankAlias = join(rootDir, 'bank-alias');
    const redirectedOutput = join(bankAlias, 'questions', 'exported');
    await runCli(['init', bankDir], output);
    await symlink(bankDir, bankAlias, 'junction');

    const exitCode = await runCli(['export', bankDir, '--out', redirectedOutput], output);

    expect(exitCode).toBe(2);
    expect(stderr.join('\n')).toContain('题库源数据目录');
    await expect(lstat(redirectedOutput)).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('拒绝把 GitHub Markdown 导出写回题库根目录', async () => {
    const bankDir = join(rootDir, 'bank');
    await runCli(['init', bankDir], output);
    const sourceReadme = await readFile(join(bankDir, 'README.md'), 'utf8');

    const exitCode = await runCli(
      ['export', bankDir, '--format', 'github-markdown', '--out', bankDir],
      output,
    );

    expect(exitCode).toBe(2);
    expect(await readFile(join(bankDir, 'README.md'), 'utf8')).toBe(sourceReadme);
    expect(stderr.join('\n')).toContain('导出目录不能');
  });

  it('显示帮助并拒绝未知校验模式', async () => {
    expect(await runCli(['--help'], output)).toBe(0);
    expect(stdout.join('\n')).toContain('oqb validate');
    expect(stdout.join('\n')).toContain('github-markdown');
    expect(stdout.join('\n')).toContain('obsidian');
    expect(stdout.join('\n')).toContain('notion');

    const exitCode = await runCli(['validate', rootDir, '--mode', 'invalid'], output);

    expect(exitCode).toBe(2);
    expect(stderr.join('\n')).toContain('不支持的校验模式');
  });
});
