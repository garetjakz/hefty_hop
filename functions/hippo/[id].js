// Cloudflare Pages Function: same-origin proxy for hippo art.
// The art CDN doesn't send CORS headers, so the browser can't read pixels
// from it directly; served from our own origin, canvas access is unrestricted.
export async function onRequest(context) {
  const id = parseInt(context.params.id, 10);
  if (!(id >= 1 && id <= 8888)) return new Response('bad id', { status: 400 });
  const upstream = await fetch('https://da1ezqlaxtxtv.cloudfront.net/images/' + id + '.png', {
    cf: { cacheEverything: true, cacheTtl: 604800 },
  });
  if (!upstream.ok) return new Response('not found', { status: 404 });
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
