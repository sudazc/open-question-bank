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

  it('显示帮助并拒绝未知校验模式', async () => {
    expect(await runCli(['--help'], output)).toBe(0);
    expect(stdout.join('\n')).toContain('oqb validate');

    const exitCode = await runCli(['validate', rootDir, '--mode', 'invalid'], output);

    expect(exitCode).toBe(2);
    expect(stderr.join('\n')).toContain('不支持的校验模式');
  });
});
