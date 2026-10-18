#!/usr/bin/env node

import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ExamGenerationError,
  generateExam,
  validateQuestionBankDirectory,
  type Diagnostic,
  type ValidationMode,
} from '@openquestionbank/core';
import {
  writeQuestionBankGithubMarkdownExport,
  writeQuestionBankJsonExport,
  writeQuestionBankNotionExport,
  writeQuestionBankObsidianVaultExport,
} from '@openquestionbank/exporters';
import { isSupportedNodeVersion } from './node-version.js';

const validationModes = ['draft', 'strict', 'release'] as const satisfies readonly ValidationMode[];
const exportFormats = ['json', 'github-markdown', 'obsidian', 'notion'] as const;
const templateRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../templates/question-bank',
);

export interface CliOutput {
  stdout(message: string): void;
  stderr(message: string): void;
}

const defaultOutput: CliOutput = {
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
};

/** 解析命令行参数并执行对应题库操作 */
export async function runCli(
  argv: readonly string[],
  output: CliOutput = defaultOutput,
): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        help: { type: 'boolean', short: 'h' },
        mode: { type: 'string', short: 'm' },
        format: { type: 'string', short: 'f' },
        out: { type: 'string', short: 'o' },
        seed: { type: 'string', short: 's' },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    output.stderr(`参数错误：${errorMessage(error)}`);
    output.stderr('运行 `oqb --help` 查看命令用法');
    return 2;
  }

  const { positionals, values } = parsed;
  const [command, ...parsedArguments] = positionals;
  let arguments_ = parsedArguments;
  const positionalFormat = command === 'export' ? parseExportFormatAlias(arguments_[0]) : undefined;
  if (positionalFormat !== undefined) {
    arguments_ = arguments_.slice(1);
  }
  if (values.help || command === 'help' || command === undefined) {
    printHelp(output);
    return 0;
  }

  if (arguments_.length > 1) {
    output.stderr(`命令 ${command} 只接受一个题库目录参数`);
    output.stderr('运行 `oqb --help` 查看命令用法');
    return 2;
  }

  const modeValue = values.mode;
  if (modeValue !== undefined && typeof modeValue !== 'string') {
    output.stderr('--mode 必须指定 draft、strict 或 release');
    return 2;
  }
  if (modeValue !== undefined && !isValidationMode(modeValue)) {
    output.stderr(`不支持的校验模式：${modeValue}`);
    output.stderr('可用模式：draft、strict、release');
    return 2;
  }
  if (command === 'init' && modeValue !== undefined) {
    output.stderr('init 命令不使用 --mode 参数');
    return 2;
  }

  const formatValue = values.format;
  if (formatValue !== undefined && typeof formatValue !== 'string') {
    output.stderr('--format 必须指定 json、github-markdown、obsidian 或 notion');
    return 2;
  }
  if (positionalFormat !== undefined && formatValue !== undefined) {
    output.stderr('格式位置参数与 --format 不能同时使用');
    return 2;
  }
  if (command !== 'export' && command !== 'build' && formatValue !== undefined) {
    output.stderr('--format 仅用于 export 和 build 命令');
    return 2;
  }
  if (command === 'export' && formatValue !== undefined && !isExportFormat(formatValue)) {
    output.stderr(`暂不支持导出格式：${formatValue}`);
    output.stderr(`当前可用格式：${exportFormats.join('、')}`);
    return 2;
  }
  if (command === 'build' && formatValue !== undefined && !isExportFormat(formatValue)) {
    output.stderr(`暂不支持构建格式：${formatValue}`);
    output.stderr(`当前可用格式：${exportFormats.join('、')}`);
    return 2;
  }

  const seedValue = values.seed;
  if (seedValue !== undefined && typeof seedValue !== 'string') {
    output.stderr('--seed 必须指定随机种子');
    return 2;
  }
  if (seedValue !== undefined && command !== 'build') {
    output.stderr('--seed 仅用于 build 命令');
    return 2;
  }
  if (seedValue !== undefined && (seedValue.trim() === '' || [...seedValue].length > 128)) {
    output.stderr('--seed 必须为 1 至 128 个非空字符');
    return 2;
  }

  const outputDirectory = values.out;
  if (outputDirectory !== undefined && typeof outputDirectory !== 'string') {
    output.stderr('--out 必须指定输出目录');
    return 2;
  }
  if (command !== 'export' && command !== 'build' && outputDirectory !== undefined) {
    output.stderr('--out 仅用于 export 和 build 命令');
    return 2;
  }
  if (outputDirectory !== undefined && outputDirectory.trim() === '') {
    output.stderr('--out 不能为空');
    return 2;
  }

  const directory = arguments_[0] ?? '.';
  const mode = modeValue ?? 'draft';
  try {
    switch (command) {
      case 'init':
        return await initializeQuestionBank(directory, output);
      case 'validate':
        return await validateCommand(directory, mode, output);
      case 'stats':
        return await statsCommand(directory, mode, output);
      case 'doctor':
        return await doctorCommand(directory, mode, output);
      case 'export':
        return await exportCommand(
          directory,
          mode,
          isExportFormat(formatValue) ? formatValue : (positionalFormat ?? 'json'),
          outputDirectory ?? 'dist',
          output,
        );
      case 'build':
        return await exportCommand(
          directory,
          mode,
          isExportFormat(formatValue) ? formatValue : 'json',
          outputDirectory ?? 'dist',
          output,
          {
            generateExamResults: true,
            ...(seedValue === undefined ? {} : { randomSeed: seedValue }),
          },
        );
      default:
        output.stderr(`未知命令：${command}`);
        output.stderr('运行 `oqb --help` 查看可用命令');
        return 2;
    }
  } catch (error) {
    output.stderr(`执行失败：${errorMessage(error)}`);
    return 2;
  }
}

async function initializeQuestionBank(directory: string, output: CliOutput): Promise<number> {
  const target = resolve(directory);
  let targetExists = false;
  try {
    const metadata = await lstat(target);
    targetExists = true;
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      output.stderr(`初始化目标不是普通目录：${target}`);
      return 2;
    }
    if ((await readdir(target)).length > 0) {
      output.stderr(`初始化目标不为空，未覆盖任何文件：${target}`);
      return 2;
    }
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
  }

  const files = await collectTemplateFiles(templateRoot);
  if (files.length === 0) {
    throw new Error('题库模板目录中没有可复制的文件');
  }

  await mkdir(target, { recursive: true });
  for (const file of files) {
    const destination = join(target, ...file.path.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.contents, { flag: 'wx' });
  }

  output.stdout(`已在 ${target} 初始化题库`);
  output.stdout(
    '下一步：编辑 bank.yaml 和示例内容，然后运行 `oqb validate ' + quotePath(target) + '`',
  );
  if (targetExists) {
    output.stdout('原目录为空，已保留目录本身并写入模板文件');
  }
  return 0;
}

async function collectTemplateFiles(
  root: string,
): Promise<Array<{ path: string; contents: Uint8Array }>> {
  const files: Array<{ path: string; contents: Uint8Array }> = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const source = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(source);
      } else if (entry.isFile()) {
        const path = join(relative(root, directory), entry.name).split(sep).join('/');
        files.push({ path, contents: await readFile(source) });
      }
    }
  }

  await visit(root);
  return files;
}

async function validateCommand(
  directory: string,
  mode: ValidationMode,
  output: CliOutput,
): Promise<number> {
  const root = resolve(directory);
  const result = await validateQuestionBankDirectory(root, { mode });
  output.stdout(`校验题库：${root}`);
  printValidationSummary(result.data, result.diagnostics, result.valid, mode, output);
  printDiagnostics(result.diagnostics, output);
  return result.valid ? 0 : 1;
}

async function statsCommand(
  directory: string,
  mode: ValidationMode,
  output: CliOutput,
): Promise<number> {
  const root = resolve(directory);
  const result = await validateQuestionBankDirectory(root, { mode });
  output.stdout(`题库统计：${result.data.bank?.name ?? root}`);
  output.stdout(`校验模式：${mode}`);
  output.stdout('数量统计（结构有效实体）：');
  output.stdout(`  考点 Topic：${result.data.topics.length}`);
  output.stdout(`  知识 Knowledge：${result.data.knowledge.length}`);
  output.stdout(`  题目 Question：${result.data.questions.length}`);
  output.stdout(`  材料题组 QuestionGroup：${result.data.groups.length}`);
  output.stdout(`  试卷 Exam：${result.data.exams.length}`);
  printDiagnosticCounts(result.diagnostics, output);
  printDiagnostics(result.diagnostics, output);
  return result.valid ? 0 : 1;
}

async function doctorCommand(
  directory: string,
  mode: ValidationMode,
  output: CliOutput,
): Promise<number> {
  const root = resolve(directory);
  const supportedNode = isSupportedNodeVersion(process.versions.node);
  const result = await validateQuestionBankDirectory(root, { mode });
  output.stdout(`环境诊断：${root}`);
  output.stdout(
    `[${supportedNode ? '通过' : '失败'}] Node.js ${process.versions.node}（要求 >=22.13.0）`,
  );
  output.stdout(
    `[${result.data.bank ? '通过' : '失败'}] ${result.data.bank ? 'bank.yaml 已加载' : 'bank.yaml 缺失或无效'}`,
  );
  output.stdout(`[${result.valid ? '通过' : '失败'}] ${mode} 模式题库校验`);
  printValidationSummary(result.data, result.diagnostics, result.valid, mode, output);
  printDiagnostics(result.diagnostics, output);
  return supportedNode && result.valid ? 0 : 1;
}

async function exportCommand(
  directory: string,
  mode: ValidationMode,
  format: (typeof exportFormats)[number],
  outputDirectory: string,
  output: CliOutput,
  buildOptions: { generateExamResults: boolean; randomSeed?: string } = {
    generateExamResults: false,
  },
): Promise<number> {
  const root = resolve(directory);
  const result = await validateQuestionBankDirectory(root, { mode });
  output.stdout(
    `${buildOptions.generateExamResults ? '构建' : '导出'}题库：${result.data.bank?.name ?? root}`,
  );
  printValidationSummary(result.data, result.diagnostics, result.valid, mode, output);
  printDiagnostics(result.diagnostics, output);
  if (!result.valid) {
    output.stderr('题库校验未通过，未生成导出文件');
    return 1;
  }
  if (!result.data.bank) {
    output.stderr('题库缺少有效的 Bank 实体，未生成导出文件');
    return 1;
  }

  let data = result.data;
  if (buildOptions.generateExamResults) {
    const templates = data.exams.filter((exam) => 'rules' in exam);
    if (templates.length > 0 && buildOptions.randomSeed === undefined) {
      output.stderr('题库包含规则组卷模板；请使用 --seed <随机种子> 生成可复现试卷');
      return 2;
    }
    if (templates.length > 0 && buildOptions.randomSeed !== undefined) {
      try {
        const randomSeed = buildOptions.randomSeed;
        const generatedById = new Map(
          templates.map((template) => [template.id, generateExam(data, template.id, randomSeed)]),
        );
        data = {
          ...data,
          exams: data.exams.map((exam) => generatedById.get(exam.id) ?? exam),
        };
        output.stdout(`已按种子生成规则试卷：${templates.length} 份`);
      } catch (error) {
        if (error instanceof ExamGenerationError) {
          output.stderr(`[${error.code}] ${error.message}`);
          return 1;
        }
        throw error;
      }
    } else if (buildOptions.randomSeed !== undefined) {
      output.stdout('题库没有规则组卷模板，未使用随机种子');
    }
  }

  if (format === 'github-markdown') {
    const exported = await writeQuestionBankGithubMarkdownExport(data, root, outputDirectory);
    output.stdout(
      `GitHub Markdown ${buildOptions.generateExamResults ? '构建' : '导出'}完成：${exported.outputDirectory}`,
    );
    output.stdout(`入口文件：${join(exported.outputDirectory, 'README.md')}`);
    output.stdout(`发布清单：${join(exported.outputDirectory, 'manifest.json')}`);
  } else if (format === 'obsidian') {
    const exported = await writeQuestionBankObsidianVaultExport(data, root, outputDirectory);
    output.stdout(
      `Obsidian Vault ${buildOptions.generateExamResults ? '构建' : '导出'}完成：${exported.outputDirectory}`,
    );
    output.stdout(`入口文件：${join(exported.outputDirectory, '题库首页.md')}`);
    output.stdout(`发布清单：${join(exported.outputDirectory, 'manifest.json')}`);
  } else if (format === 'notion') {
    const exported = await writeQuestionBankNotionExport(data, root, outputDirectory);
    output.stdout(
      `Notion 导入包${buildOptions.generateExamResults ? '构建' : '导出'}完成：${exported.outputDirectory}`,
    );
    output.stdout(`导入说明：${join(exported.outputDirectory, 'README.md')}`);
    output.stdout(`发布清单：${join(exported.outputDirectory, 'manifest.json')}`);
  } else {
    const exported = await writeQuestionBankJsonExport(data, root, outputDirectory);
    output.stdout(
      `JSON ${buildOptions.generateExamResults ? '构建' : '导出'}完成：${exported.outputDirectory}`,
    );
    output.stdout(`数据文件：${join(exported.outputDirectory, 'question-bank.json')}`);
    output.stdout(`发布清单：${join(exported.outputDirectory, 'manifest.json')}`);
  }
  return 0;
}

function printValidationSummary(
  data: Awaited<ReturnType<typeof validateQuestionBankDirectory>>['data'],
  diagnostics: Diagnostic[],
  valid: boolean,
  mode: ValidationMode,
  output: CliOutput,
): void {
  output.stdout(`校验模式：${mode}`);
  output.stdout(
    `实体数量：考点 ${data.topics.length}，知识 ${data.knowledge.length}，题目 ${data.questions.length}，题组 ${data.groups.length}，试卷 ${data.exams.length}`,
  );
  output.stdout(`校验结果：${valid ? '通过' : '失败'}`);
  printDiagnosticCounts(diagnostics, output);
}

function printDiagnosticCounts(diagnostics: Diagnostic[], output: CliOutput): void {
  const errors = diagnostics.filter(({ severity }) => severity === 'fatal' || severity === 'error');
  const warnings = diagnostics.filter(({ severity }) => severity === 'warning');
  const info = diagnostics.filter(({ severity }) => severity === 'info');
  output.stdout(`诊断数量：错误 ${errors.length}，警告 ${warnings.length}，提示 ${info.length}`);
}

function printDiagnostics(diagnostics: Diagnostic[], output: CliOutput): void {
  for (const diagnostic of diagnostics) {
    const position = diagnostic.line === undefined ? '' : `:${diagnostic.line}`;
    const column = diagnostic.column === undefined ? '' : `:${diagnostic.column}`;
    const field = diagnostic.fieldPath === undefined ? '' : ` ${diagnostic.fieldPath}`;
    output.stderr(
      `[${severityLabel(diagnostic.severity)}] ${diagnostic.file}${position}${column} ${diagnostic.code}${field}：${diagnostic.message}`,
    );
    if (diagnostic.suggestion) {
      output.stderr(`  建议：${diagnostic.suggestion}`);
    }
  }
}

function severityLabel(severity: Diagnostic['severity']): string {
  switch (severity) {
    case 'fatal':
      return '致命错误';
    case 'error':
      return '错误';
    case 'warning':
      return '警告';
    case 'info':
      return '提示';
  }
}

function isValidationMode(value: string): value is ValidationMode {
  return validationModes.some((mode) => mode === value);
}

function isExportFormat(value: string | undefined): value is (typeof exportFormats)[number] {
  return value !== undefined && exportFormats.some((format) => format === value);
}

function parseExportFormatAlias(
  value: string | undefined,
): (typeof exportFormats)[number] | undefined {
  if (value === 'github') {
    return 'github-markdown';
  }
  return isExportFormat(value) ? value : undefined;
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function quotePath(path: string): string {
  return path.includes(' ') ? `"${path}"` : path;
}

function printHelp(output: CliOutput): void {
  output.stdout(`OpenQuestionBank CLI

用法：
  oqb init [目录]
  oqb validate [目录] [--mode draft|strict|release]
  oqb stats [目录] [--mode draft|strict|release]
  oqb doctor [目录] [--mode draft|strict|release]
  oqb export [目录] [--format json|github-markdown|obsidian|notion] [--out <目录>] [--mode draft|strict|release]
  oqb export <格式> [目录] [--out <目录>] [--mode draft|strict|release]
  oqb build [目录] [--format json|github-markdown|obsidian|notion] [--out <目录>] [--mode draft|strict|release] [--seed <随机种子>]
  oqb --help

命令：
  init      创建可直接编辑的题库目录；目标目录必须不存在或为空
  validate  校验题库结构、引用、资源及审核授权要求
  stats     统计当前模式下保留的有效题库实体
  doctor    检查 Node.js 环境、bank.yaml 和题库校验结果
  export    校验题库后生成 JSON、GitHub Markdown、Obsidian Vault 或 Notion 导入包；格式也可作为位置参数
  build     构建所选格式；题库含规则组卷模板时使用 --seed 生成试卷结果

选项：
  -m, --mode <模式>  校验模式，默认为 draft
  -f, --format <格式> 导出格式，支持 json、github-markdown、obsidian、notion
  -o, --out <目录>   导出目录，默认为当前目录下的 dist
  -s, --seed <种子>  build 中用于可复现规则组卷的随机种子
  -h, --help         显示帮助信息

校验模式：
  draft     编辑期间使用，不额外要求审核通过或授权信息
  strict    所有内容实体必须审核通过并具备发布授权信息
  release   只保留审核通过且授权信息完整的内容

退出码：0 成功；1 题库校验或环境检查未通过；2 参数或执行错误`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
