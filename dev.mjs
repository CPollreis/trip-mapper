#!/usr/bin/env node
// Local preview: rebuild on save, reload the open tab. No dependencies, no network.
//
//   npm run dev                       the only trip in trips/
//   npm run dev -- trips/other.json   a specific one
//   npm run dev -- --port 5000
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickTrip } from './lib/trips.mjs';

const root = new URL('./', import.meta.url);
const dir = fileURLToPath(root);

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = portArg > -1 ? Number(args[portArg + 1]) : 4173;
const tripArg = args.find((a) => !a.startsWith('--') && a !== String(PORT));
const { path: tripPath, slug } = pickTrip(root, tripArg);
const outDir = join(dir, 'dist', slug);

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

// Injected only by this server. The built file on disk stays clean, so what you
// commit is never the dev build.
const RELOAD = `
<script>
(() => {
  let src;
  const connect = () => {
    src = new EventSource('/__reload');
    src.onmessage = (e) => { if (e.data === 'reload') location.reload(); };
    src.onerror = () => { src.close(); setTimeout(connect, 1000); };
  };
  connect();
})();
</script>`;

const clients = new Set();
let building = false, queued = false, lastOk = true;

function build() {
  if (building) { queued = true; return; }
  building = true;
  const started = Date.now();
  const child = spawn(process.execPath, ['build.mjs', tripPath], { cwd: dir });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.on('close', (code) => {
    building = false;
    const ms = Date.now() - started;
    process.stdout.write('\x1b[2J\x1b[H');
    console.log(`trip-mapper dev  http://localhost:${PORT}\n`);
    console.log(out.trim() || '(no output)');
    if (code === 0) {
      console.log(`\nbuilt in ${ms} ms, ${new Date().toLocaleTimeString()}`);
      lastOk = true;
      for (const c of clients) c.write('data: reload\n\n');
    } else {
      console.log(`\nbuild failed, previous version still served`);
      lastOk = false;
      for (const c of clients) c.write('data: failed\n\n');
    }
    if (queued) { queued = false; build(); }
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/__reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  let name = decodeURIComponent(url.pathname);
  if (name === '/') name = '/index.html';
  const file = join(outDir, normalize(name).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(outDir)) { res.writeHead(403).end('Forbidden'); return; }

  try {
    await stat(file);
    let body = await readFile(file);
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    if (extname(file) === '.html') body = body.toString() + RELOAD;
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<pre style="font:14px ui-monospace;padding:24px">Not found: ${name}\n\n` +
      `Serving ${outDir}\n${lastOk ? '' : 'The last build failed, see the terminal.'}</pre>${RELOAD}`);
  }
});

// Debounced because editors fire several events per save.
let timer;
const bump = () => { clearTimeout(timer); timer = setTimeout(build, 80); };
for (const d of ['trips', 'cities', 'lib', 'resources']) {
  try { watch(join(dir, d), { recursive: true }, bump); } catch {}
}
watch(join(dir, 'build.mjs'), bump);

server.listen(PORT, '127.0.0.1', () => build());
process.on('SIGINT', () => { server.close(); process.exit(0); });
