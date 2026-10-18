/** 检查 Node.js 版本是否达到项目最低要求 */
export function isSupportedNodeVersion(version: string): boolean {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?(?![\s\S])/u.exec(
      version,
    );
  if (!match) {
    return false;
  }

  if (match[4] !== undefined) {
    return false;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major !== 22) {
    return major > 22;
  }
  if (minor !== 13) {
    return minor > 13;
  }
  if (patch !== 0) {
    return patch > 0;
  }
  return true;
}
