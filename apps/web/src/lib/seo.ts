import { isIP } from 'node:net';

export const NO_INDEX_ROBOTS = {
  index: false,
  follow: false,
  googleBot: { index: false, follow: false, noimageindex: true },
};

type PublicSeoEnvironment = Readonly<Record<string, string | undefined>>;

export function getPublicSeoConfig(env: PublicSeoEnvironment = process.env) {
  let origin: string | undefined;
  try {
    const url = new URL(env.PUBLIC_WEB_ORIGIN ?? '');
    const hostname = url.hostname.toLowerCase();
    const localHostname = [
      'localhost',
      'local',
      'internal',
      'lan',
      'home',
    ].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      hostname.includes('.') &&
      !localHostname &&
      !isIP(hostname) &&
      !hostname.startsWith('[')
    ) {
      origin = url.origin;
    }
  } catch {
    // Missing or invalid configuration must never produce fallback URLs.
  }
  return {
    origin,
    indexingEnabled:
      env.APP_ENV === 'production' &&
      env.PUBLIC_SITE_INDEXING_ENABLED === 'true' &&
      origin !== undefined,
  };
}

export function getPublicPageRobots() {
  return getPublicSeoConfig().indexingEnabled
    ? { index: true, follow: true, googleBot: { index: true, follow: true } }
    : NO_INDEX_ROBOTS;
}
