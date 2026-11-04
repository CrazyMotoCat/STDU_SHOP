export const syntheticDatabase = 'stdu_sec_api_02_test';

export function syntheticScanEnabled(): boolean {
  return (
    process.env.SEC_API_02_SYNTHETIC_SCAN_ENABLED === 'true' &&
    process.env.APP_ENV === 'development' &&
    process.env.NODE_ENV === 'test'
  );
}
