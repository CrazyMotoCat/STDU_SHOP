import { readinessHandler } from '../../../health';
export const dynamic = 'force-dynamic';
export const GET = readinessHandler(() => process.env.API_INTERNAL_URL);
