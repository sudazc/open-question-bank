import type { QuestionBankData } from '@openquestionbank/core';

/** 导出清单中的资源文件信息 */
export interface ExportAsset {
  path: string;
  sizeBytes: number;
  sha256: string;
}

/** 校验资源路径及导出清单中的资源信息 */
export function normalizeExportAssets(
  data: QuestionBankData,
  assets: readonly ExportAsset[],
): ExportAsset[] {
  const assetsByPath = new Map<string, ExportAsset>();
  for (const asset of assets) {
    assertSafeExportPath(asset.path, '题库资源路径');
    if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 0) {
      throw new Error(`资源文件大小无效：${asset.path}`);
    }
    if (!/^[0-9a-f]{64}$/.test(asset.sha256)) {
      throw new Error(`资源文件 SHA-256 无效：${asset.path}`);
    }
    if (assetsByPath.has(asset.path)) {
      throw new Error(`导出资源路径重复：${asset.path}`);
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
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label}不安全：${path}`);
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
