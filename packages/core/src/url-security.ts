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

const credentialQueryParameterNames = new Set(
  [
    'access_token',
    'refresh_token',
    'id_token',
    'auth_token',
    'x_auth_token',
    'authentication_token',
    'x_access_token',
    'api_token',
    'private_token',
    'security_token',
    'bearer_token',
    'token',
    'authorization',
    'api_key',
    'x_api_key',
    'key',
    'access_key',
    'secret',
    'api_secret',
    'auth_key',
    'client_secret',
    'client_key',
    'private_key',
    'password',
    'passwd',
    'pwd',
    'signature',
    'sig',
    'session_id',
    'sessionid',
    'session_token',
    'cookie',
    'jwt',
    'credential',
    'credentials',
    'awsaccesskeyid',
    'x_amz_credential',
    'x_amz_security_token',
    'x_amz_signature',
    'googleaccessid',
    'x_goog_credential',
    'x_goog_signature',
  ].map(normalizeQueryParameterName),
);

/** 检查 URL 是否包含可识别的访问凭据 */
export function hasUrlCredentials(value: string): boolean {
  const normalized = value.trim();
  if (hasCredentialQueryParameter(normalized)) {
    return true;
  }
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

function hasCredentialQueryParameter(value: string): boolean {
  const withoutFragment = value.split('#', 1)[0] ?? value;
  const queryStart = withoutFragment.indexOf('?');
  if (queryStart < 0) {
    return false;
  }
  for (const [name, parameterValue] of new URLSearchParams(withoutFragment.slice(queryStart + 1))) {
    if (
      parameterValue !== '' &&
      credentialQueryParameterNames.has(normalizeQueryParameterName(name))
    ) {
      return true;
    }
  }
  return false;
}

function normalizeQueryParameterName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
