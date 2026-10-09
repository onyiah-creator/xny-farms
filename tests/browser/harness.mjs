/**
 * Local test harness for the browser tests: serves the repo's static files and runs
 * the REAL /api functions against an in-memory KV, with Resend and Turnstile mocked.
 *
 * Test-only endpoints (never part of the site):
 *   GET /__mails            every email "sent" so far, as JSON
 *   GET /__delay?ms=N       make every /api response wait N ms (to see loading states)
 *   GET /__turnstile?on=1   pretend TURNSTILE_SECRET_KEY is configured
 * The client IP comes from the x-test-ip request header (so tests can stay under the
 * per-IP rate limits) and is passed to the functions as CF-Connecting-IP.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json" };

export async function startHarness(port) {
  const store = new Map();
  const kv = {
    async put(k, v, o = {}) { store.set(k, { value: v, metadata: o.metadata ?? null, expiresAt: o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : null }); },
    async get(k) { const e = store.get(k); if (!e) return null; if (e.expiresAt && e.expiresAt <= Date.now()) { store.delete(k); return null; } return e.value; },
    async delete(k) { store.delete(k); },
    async list({ prefix = "", cursor, limit = 1000 } = {}) {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix) && (!store.get(k).expiresAt || store.get(k).expiresAt > Date.now())).sort();
      const st = cursor ? Number(cursor) : 0, sl = all.slice(st, st + limit), n = st + limit;
      return { keys: sl.map((name) => ({ name, metadata: store.get(name).metadata })), cursor: n < all.length ? String(n) : undefined, list_complete: n >= all.length };
    }
  };
  const env = { REFERRALS_KV: kv, ADMIN_REPORT_PASSWORD: "admin-pw", RESEND_API_KEY: "re_test_key" };
  const mails = [];
  let delayMs = 0;

  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://challenges.cloudflare.com/")) return new Response(JSON.stringify({ success: true }), { status: 200 });
    mails.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "re_" + mails.length }), { status: 200 });
  };

  const modules = {};
  const load = async (name) => (modules[name] ||= await import(pathToFileURL(path.join(ROOT, "functions/api", name + ".js")).href));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/__mails") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(mails)); return; }
    if (url.pathname === "/__delay") { delayMs = Number(url.searchParams.get("ms") || 0); res.writeHead(200); res.end("ok"); return; }
    if (url.pathname === "/__turnstile") { if (url.searchParams.get("on") === "1") env.TURNSTILE_SECRET_KEY = "x"; else delete env.TURNSTILE_SECRET_KEY; res.writeHead(200); res.end("ok"); return; }

    const m = /^\/api\/([\w-]+)$/.exec(url.pathname);
    if (m && fs.existsSync(path.join(ROOT, "functions/api", m[1] + ".js"))) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = new Headers();
      headers.set("CF-Connecting-IP", String(req.headers["x-test-ip"] || "127.0.0.1"));
      const request = new Request(`http://${req.headers.host}` + req.url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const mod = await load(m[1]);
      const handler = req.method === "GET" ? mod.onRequestGet : mod.onRequestPost;
      if (!handler) { res.writeHead(405); res.end("method not allowed"); return; }
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const pending = [];
      const out = await handler({ request, env, waitUntil: (p) => pending.push(p) });
      await Promise.all(pending);
      const h = {};
      out.headers.forEach((v, k) => { h[k] = v; });
      res.writeHead(out.status, h);
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }

    let p = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (p.endsWith("/")) p += "index.html";
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return { server, base: `http://localhost:${port}`, kv, env, mails, close: () => new Promise((r) => server.close(r)) };
}
