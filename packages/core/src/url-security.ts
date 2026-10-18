/** 解析有效的 HTTP 或 HTTPS URL */
export function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

/** 检查 URL authority 中是否包含用户名或密码 */
export function hasUrlAuthorityCredentials(value: string): boolean {
  const normalized = value.trim();
  try {
    const url = new URL(normalized);
    if (url.username !== '' || url.password !== '') {
      return true;
    }
  } catch {
    // 格式错误的 URL 仍需检查 authority 中可识别的凭据
  }
  const authority = /^(?:[a-z][a-z\d+.-]*:)?[\\/]{2}([^/?#\\]*)/i.exec(normalized)?.[1];
  return authority !== undefined && authority.lastIndexOf('@') > 0;
}
