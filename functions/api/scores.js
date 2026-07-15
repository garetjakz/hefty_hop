// Global Hall of Hefty — persisted in Cloudflare KV (binding: SCORES).
// Survives every deploy; the repo carries no score data.
const MAX_KEEP = 50, MAX_SHOW = 10;

export async function onRequestGet(ctx) {
  if (!ctx.env.SCORES) return new Response('KV binding SCORES missing', { status: 503 });
  const list = (await ctx.env.SCORES.get('top', 'json')) || [];
  return Response.json(list.slice(0, MAX_SHOW), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(ctx) {
  if (!ctx.env.SCORES) return new Response('KV binding SCORES missing', { status: 503 });
  const b = await ctx.request.json().catch(() => null);
  if (!b) return new Response('bad json', { status: 400 });
  const n = String(b.n || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 8).trim() || 'HIPPO';
  const s = Math.floor(Number(b.s)), l = Math.floor(Number(b.l)), h = Math.floor(Number(b.h)) || 0;
  if (!(s > 0 && s < 10000000 && l >= 1 && l < 1000)) return new Response('bad score', { status: 400 });
  if (s > l * 25000) return new Response('nice try', { status: 400 });  // sanity: impossible score for depth
  if (h && !(h >= 1 && h <= 8888)) return new Response('bad hippo', { status: 400 });
  const list = (await ctx.env.SCORES.get('top', 'json')) || [];
  list.push({ n, s, l, h, t: Date.now() });
  list.sort((a, b2) => b2.s - a.s);
  const top = list.slice(0, MAX_KEEP);
  await ctx.env.SCORES.put('top', JSON.stringify(top));
  return Response.json(top.slice(0, MAX_SHOW));
}
