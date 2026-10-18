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

const credentialUrlParameterNames = new Set(
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
  if (hasCredentialUrlParameter(normalized)) {
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

function hasCredentialUrlParameter(value: string): boolean {
  const fragmentStart = value.indexOf('#');
  const beforeFragment = fragmentStart < 0 ? value : value.slice(0, fragmentStart);
  const fragment = fragmentStart < 0 ? undefined : value.slice(fragmentStart + 1);
  const queryStart = beforeFragment.indexOf('?');
  const query = queryStart < 0 ? '' : beforeFragment.slice(queryStart + 1);
  const fragmentQueryStart = fragment?.lastIndexOf('?') ?? -1;
  const fragmentParameters =
    fragment === undefined
      ? ''
      : fragmentQueryStart < 0
        ? fragment
        : fragment.slice(fragmentQueryStart + 1);
  return hasCredentialParameterList(query) || hasCredentialParameterList(fragmentParameters);
}

function hasCredentialParameterList(parameters: string): boolean {
  for (const [name, parameterValue] of new URLSearchParams(parameters)) {
    if (
      parameterValue !== '' &&
      credentialUrlParameterNames.has(normalizeQueryParameterName(name))
    ) {
      return true;
    }
  }
  return false;
}

function normalizeQueryParameterName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
