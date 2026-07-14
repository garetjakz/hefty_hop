// OBSOLETE: art is now pre-baked in /hippos/N.png — this proxy is unused.
// Safe to delete this functions/ directory entirely.
export async function onRequest() {
  return Response.redirect('/', 302);
}
