import { hasCredentialedQuestionBankUrls, type QuestionBankData } from '@openquestionbank/core';

/** 导出清单中的资源文件信息 */
export interface ExportAsset {
  path: string;
  sizeBytes: number;
  sha256: string;
}

/** 在写入导出目录前拒绝包含访问凭据的题库内容 */
export function assertNoCredentialedQuestionBankUrls(data: QuestionBankData): void {
  if (hasCredentialedQuestionBankUrls(data)) {
    throw new Error('题库元数据、来源或 Markdown 链接中存在访问凭据，拒绝导出');
  }
}

/** 校验资源路径及导出清单中的资源信息 */
export function normalizeExportAssets(
  data: QuestionBankData,
  assets: readonly ExportAsset[],
): ExportAsset[] {
  assertNoCredentialedQuestionBankUrls(data);

  const assetsByPath = new Map<string, ExportAsset>();
  assertUniquePortableExportPaths(
    assets.map(({ path }) => path),
    '导出资源路径',
  );
  for (const asset of assets) {
    if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 0) {
      throw new Error(`资源文件大小无效：${asset.path}`);
    }
    if (!/^[0-9a-f]{64}$/.test(asset.sha256)) {
      throw new Error(`资源文件 SHA-256 无效：${asset.path}`);
    }
    assetsByPath.set(asset.path, asset);
  }

  const referencedAssets = collectReferencedAssets(data);
  for (const path of referencedAssets) {
    if (!assetsByPath.has(path)) {
      throw new Error(`缺少题库引用的资源文件：${path}`);
    }
  }
  for (const path of assetsByPath.keys()) {
    if (!referencedAssets.has(path)) {
      throw new Error(`导出资源未被题库实体引用：${path}`);
    }
  }

  return [...assetsByPath.values()].sort((left, right) => compareStrings(left.path, right.path));
}

/** 收集知识、题目和题组声明的资源路径 */
export function collectReferencedAssets(data: QuestionBankData): Set<string> {
  const paths = new Set<string>();
  const entities = [...data.knowledge, ...data.questions, ...data.groups];
  for (const entity of entities) {
    for (const path of entity.assets ?? []) {
      assertSafeExportPath(path, '题库资源路径');
      paths.add(path);
    }
  }
  return paths;
}

/** 确认导出文件路径是题库根目录下的普通相对路径 */
export function assertSafeExportPath(path: string, label = '导出文件路径'): void {
  const segments = path.split('/');
  if (
    path.includes('\0') ||
    path.includes(':') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        segment.endsWith('.') ||
        segment.endsWith(' ') ||
        Buffer.byteLength(segment, 'utf8') > 255 ||
        /[<>"|?*]/.test(segment) ||
        [...segment].some((character) => (character.codePointAt(0) ?? 0) < 0x20) ||
        isWindowsReservedName(segment),
    )
  ) {
    throw new Error(`${label}不安全：${path}`);
  }
}

function isWindowsReservedName(segment: string): boolean {
  const baseName = segment.split('.')[0]?.replace(/[ .]+$/, '') ?? '';
  return /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(baseName);
}

/** 拒绝在大小写或 Unicode 规范化不敏感文件系统上重名的导出路径 */
export function assertUniquePortableExportPaths(
  paths: readonly string[],
  label = '导出文件路径',
): void {
  const seenPaths = new Map<string, string>();
  for (const path of paths) {
    assertSafeExportPath(path, label);
    const key = getPortableExportPathKey(path);
    const existingPath = seenPaths.get(key);
    if (existingPath !== undefined) {
      if (existingPath === path) {
        throw new Error(`${label}重复：${path}`);
      }
      throw new Error(
        `${label}在大小写或 Unicode 规范化不敏感的文件系统上冲突：${existingPath}、${path}`,
      );
    }
    seenPaths.set(key, path);
  }

  for (const [key, path] of seenPaths) {
    const segments = key.split('/');
    let parent = '';
    for (const segment of segments.slice(0, -1)) {
      parent = parent ? `${parent}/${segment}` : segment;
      const parentPath = seenPaths.get(parent);
      if (parentPath !== undefined) {
        throw new Error(`${label}文件与目录冲突：${parentPath}、${path}`);
      }
    }
  }
}

/** 生成跨平台导出路径比较键 */
export function getPortableExportPathKey(path: string): string {
  return path.normalize('NFC').toLowerCase().toUpperCase().toLowerCase();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
