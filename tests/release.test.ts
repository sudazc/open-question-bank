import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('发布包版本检查', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'oqb-release-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it.each(['1.2.3-01', '1.2.3-alpha.01'])('拒绝无效 SemVer 预发布版本 %s', async (version) => {
    const scriptPath = await prepareReleaseScript(rootDir, version);
    const result = runReleasePreflight(rootDir, scriptPath, `v${version}`);

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`根目录 package.json 不是有效的 SemVer 版本：${version}`);
  });

  it.each(['1.2.3\n', '1.2.3\r', '1.2.3\u2028', '1.2.3\u2029'])(
    '拒绝末尾带换行符的 SemVer 版本',
    async (version) => {
      const scriptPath = await prepareReleaseScript(rootDir, version);
      const result = runReleasePreflight(rootDir, scriptPath, `v${version}`);

      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('根目录 package.json 不是有效的 SemVer 版本：');
    },
  );

  it('允许合法的零值数字预发布标识', async () => {
    const version = '1.2.3-0';
    const scriptPath = await prepareReleaseScript(rootDir, version);
    const result = runReleasePreflight(rootDir, scriptPath, 'v1.2.3-1');

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Git 标签 v1.2.3-1 与根目录版本 v1.2.3-0 不一致');
  });
});

async function prepareReleaseScript(rootDir: string, version: string): Promise<string> {
  const scriptsDirectory = join(rootDir, 'scripts');
  const scriptPath = join(scriptsDirectory, 'package-release.mjs');
  await mkdir(scriptsDirectory);
  await copyFile(join(repositoryRoot, 'scripts/package-release.mjs'), scriptPath);
  await writeFile(join(rootDir, 'package.json'), JSON.stringify({ version }), 'utf8');
  return scriptPath;
}

function runReleasePreflight(rootDir: string, scriptPath: string, tag: string) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REF_NAME: tag },
  });
}
