/**
 * Runs in front of every /api/* function. It only touches the ADMIN endpoints (the list lives in
 * _lib/admin-auth.js next to the gate that protects them) and adds the headers that keep their responses
 * from being cached, framed, or leaking the page's URL. _headers can't do this: Cloudflare Pages applies
 * _headers to static files only, not to Functions responses. Public endpoints are returned untouched.
 */
import { ADMIN_API_PATHS } from "../_lib/admin-auth.js";

export const ADMIN_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

export async function onRequest(context) {
  const response = await context.next();
  let name = "";
  try { name = new URL(context.request.url).pathname.replace(/^\/api\//, "").replace(/\/+$/, ""); } catch (err) { /* not an admin path */ }
  if (!ADMIN_API_PATHS.includes(name)) return response;
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(ADMIN_RESPONSE_HEADERS)) out.headers.set(k, v);
  return out;
}
