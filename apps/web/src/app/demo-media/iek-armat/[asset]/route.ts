import { readDemoImage } from '../../../../lib/catalog/demo-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(
  _request: Request,
  context: { params: Promise<{ asset: string }> },
) {
  const { asset } = await context.params;
  const bytes = readDemoImage(asset);
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  return bytes
    ? new Response(new Uint8Array(bytes), {
        headers: { ...headers, 'Content-Type': 'image/webp' },
      })
    : new Response(null, { status: 404, headers });
}
