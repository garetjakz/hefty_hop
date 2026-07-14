// Same-origin proxy for hippo art (canvas needs same-origin for pixel access).
// Tries each upstream in order; surfaces upstream status codes for debugging.
const UPSTREAMS = [
  'https://arweave.net/qRmQOoupWFtQbQV7w2W0ZCV1QxVtSLe4Eypm-cCtrD0/',
  'https://da1ezqlaxtxtv.cloudfront.net/images/',
];
export async function onRequest(context) {
  const id = parseInt(context.params.id, 10);
  if (!(id >= 1 && id <= 8888)) return new Response('bad id', { status: 400 });
  const tried = [];
  for (const base of UPSTREAMS) {
    try {
      const r = await fetch(base + id + '.png', {
        headers: { 'User-Agent': 'Mozilla/5.0 (HeftyHop art proxy)' },
        cf: { cacheEverything: true, cacheTtl: 604800 },
      });
      if (r.ok) {
        return new Response(r.body, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=604800, immutable',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      tried.push(base + ' -> ' + r.status);
    } catch (e) {
      tried.push(base + ' -> ' + (e.message || 'fetch failed'));
    }
  }
  return new Response('upstreams failed: ' + tried.join(' | '), { status: 502 });
}
