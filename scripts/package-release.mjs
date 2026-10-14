import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!versionPattern.test(rootPackage.version)) {
  throw new Error(`根目录 package.json 不是有效的 SemVer 版本：${rootPackage.version}`);
}

const expectedTag = `v${rootPackage.version}`;
const currentTag = process.env.GITHUB_REF_NAME;

if (currentTag && currentTag !== expectedTag) {
  throw new Error(`Git 标签 ${currentTag} 与根目录版本 ${expectedTag} 不一致`);
}

const packageNames = ['schema', 'core', 'exporters', 'cli'];

for (const packageName of packageNames) {
  const packageDir = path.join(rootDir, 'packages', packageName);
  const packageManifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  const distDir = path.join(packageDir, 'dist');

  if (packageManifest.version !== rootPackage.version) {
    throw new Error(`${packageManifest.name} 版本 ${packageManifest.version} 与根目录版本不一致`);
  }

  if (!existsSync(distDir)) {
    throw new Error(`缺少 ${packageName} 构建目录，请先运行 pnpm build`);
  }
}

const archiveRootName = `openquestionbank-v${rootPackage.version}`;
const archiveName = `${archiveRootName}-prebuilt.tar.gz`;
const assetsDir = path.join(rootDir, 'dist', 'release');
const temporaryDir = mkdtempSync(path.join(tmpdir(), `openquestionbank-${rootPackage.version}-`));
const packageRootDir = path.join(temporaryDir, archiveRootName);
const archivePath = path.join(assetsDir, archiveName);

mkdirSync(packageRootDir, { recursive: true });
mkdirSync(assetsDir, { recursive: true });

try {
  const rootFiles = [
    '.npmrc',
    'AI_GUIDE.md',
    'CONTRIBUTING.md',
    'README.md',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
  ];

  for (const entry of [...rootFiles, 'docs', 'examples', 'templates']) {
    const sourcePath = path.join(rootDir, entry);

    if (existsSync(sourcePath)) {
      cpSync(sourcePath, path.join(packageRootDir, entry), { recursive: true });
    }
  }

  for (const packageName of packageNames) {
    const sourceDir = path.join(rootDir, 'packages', packageName);
    const destinationDir = path.join(packageRootDir, 'packages', packageName);

    mkdirSync(destinationDir, { recursive: true });
    cpSync(path.join(sourceDir, 'package.json'), path.join(destinationDir, 'package.json'));
    cpSync(path.join(sourceDir, 'dist'), path.join(destinationDir, 'dist'), { recursive: true });
  }

  const tarResult = spawnSync('tar', ['-czf', archivePath, '-C', temporaryDir, archiveRootName], {
    stdio: 'inherit',
  });

  if (tarResult.error) {
    throw tarResult.error;
  }

  if (tarResult.status !== 0) {
    throw new Error(`tar 打包失败，退出码：${tarResult.status}`);
  }

  const checksum = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
  writeFileSync(path.join(assetsDir, 'SHA256SUMS'), `${checksum}  ${archiveName}\n`, 'utf8');
  process.stdout.write(
    `已生成 ${path.relative(rootDir, archivePath)} 和 dist/release/SHA256SUMS\n`,
  );
} finally {
  rmSync(temporaryDir, { recursive: true, force: true });
}
