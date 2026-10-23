import type { Response } from 'express';
import type { ApiConfig } from '../config.js';
import type { StaffRequest } from './request.js';

export function sessionCookieName(config: ApiConfig) {
  return config.cookieProfile === 'https'
    ? '__Host-stdu_staff'
    : 'stdu_staff_dev';
}

export function challengeCookieName(config: ApiConfig) {
  return config.cookieProfile === 'https'
    ? '__Host-stdu_login'
    : 'stdu_login_dev';
}

export function cookieValue(
  request: StaffRequest,
  name: string,
): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return undefined;
  return values[0]?.slice(name.length + 1);
}

export function setHttpOnlyCookie(
  response: Response,
  config: ApiConfig,
  name: string,
  value: string,
  maxAgeSeconds: number,
) {
  appendSetCookie(
    response,
    `${name}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly; SameSite=Lax${config.cookieProfile === 'https' ? '; Secure' : ''}`,
  );
}

export function clearHttpOnlyCookie(
  response: Response,
  config: ApiConfig,
  name: string,
) {
  setHttpOnlyCookie(response, config, name, '', 0);
}

function appendSetCookie(response: Response, cookie: string) {
  const current = response.getHeader('Set-Cookie');
  const values =
    current === undefined
      ? []
      : Array.isArray(current)
        ? current
        : [String(current)];
  response.setHeader('Set-Cookie', [...values, cookie]);
}
