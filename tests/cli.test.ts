import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

    expect(exitCode).toBe(0);
    expect(result.valid).toBe(true);
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
      formatVersion: '1.0.0',
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
    const readme = await readFile(join(exportDir, 'README.md'), 'utf8');
    const questionPage = await readFile(
      join(exportDir, 'questions', 'id-question-example.md'),
      'utf8',
    );
    const firstManifest = await readFile(join(exportDir, 'manifest.json'), 'utf8');
    const secondExitCode = await runCli(
      ['export', bankDir, '--format', 'obsidian', '--out', exportDir],
      output,
    );

    expect(firstExitCode).toBe(0);
    expect(secondExitCode).toBe(0);
    expect(readme).toContain('[[topics/README|考点（1）]]');
    expect(questionPage).toContain('[[topics/id-topic-foundations|基础知识]]');
    expect(questionPage).toContain('[[knowledge/id-knowledge-getting-started|示例知识点]]');
    expect(JSON.parse(firstManifest)).toMatchObject({
      format: 'openquestionbank-obsidian-vault',
      formatVersion: '1.0.0',
      bank: { id: 'my-question-bank', version: '0.1.0' },
      statistics: { totalEntities: 4 },
    });
    expect(await readFile(join(exportDir, 'README.md'), 'utf8')).toBe(readme);
    expect(await readFile(join(exportDir, 'manifest.json'), 'utf8')).toBe(firstManifest);
    expect(stdout.join('\n')).toContain('Obsidian Vault 导出完成');
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
    expect(stderr.join('\n')).toContain('不能与题库根目录相同');
  });

  it('显示帮助并拒绝未知校验模式', async () => {
    expect(await runCli(['--help'], output)).toBe(0);
    expect(stdout.join('\n')).toContain('oqb validate');
    expect(stdout.join('\n')).toContain('github-markdown');
    expect(stdout.join('\n')).toContain('obsidian');

    const exitCode = await runCli(['validate', rootDir, '--mode', 'invalid'], output);

    expect(exitCode).toBe(2);
    expect(stderr.join('\n')).toContain('不支持的校验模式');
  });
});
