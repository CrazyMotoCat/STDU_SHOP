// Runtime opt-in for a dedicated test site. NODE_ENV is deliberately irrelevant.
export function catalogTestSiteEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return env.APP_ENV === 'test' && env.CATALOG_TEST_SITE_ENABLED === 'true';
}
