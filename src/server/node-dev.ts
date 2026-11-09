// Plain-Node host for the exact same room engine. Used for local development without Cloudflare's
// runtime, for end-to-end tests, and as an alternative deployment target (any VM / container).
//   npx tsx src/server/node-dev.ts            (PORT=8787 by default, serves dist/client if it exists)

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_SEATS, ROOM_CODE_RE } from '../shared/protocol';
import { randomRoomCode } from '../shared/rng';
import { RoomEngine } from '../shared/room';
import { RoomHost, type Conn } from './host';

interface Live {
  host: RoomHost;
  sockets: Map<WebSocket, string | null>;
  timer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Live>();
const PORT = Number(process.env.PORT ?? 8787);
const here = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(here, '../../dist/client');

function makeConn(live: Live, ws: WebSocket): Conn {
  return {
    raw: ws,
    getId: () => live.sockets.get(ws) ?? null,
    setId: (id) => live.sockets.set(ws, id),
    send: (d) => ws.send(d),
    close: (code, reason) => ws.close(code, reason.slice(0, 100)),
  };
}

function createRoom(code: string): Live {
  const engine = RoomEngine.create(code, Date.now());
  const live: Live = { sockets: new Map(), timer: null, host: null as unknown as RoomHost };
  const conns = new Map<WebSocket, Conn>();
  const connOf = (ws: WebSocket) => {
    let c = conns.get(ws);
    if (!c) conns.set(ws, (c = makeConn(live, ws)));
    return c;
  };
  live.host = new RoomHost(engine, {
    conns: () => [...live.sockets.keys()].map(connOf),
    now: () => Date.now(),
    persist: () => undefined,
    schedule: (at) => {
      if (live.timer) clearTimeout(live.timer);
      live.timer = at === null ? null : setTimeout(() => void live.host.onAlarm(), Math.max(0, at - Date.now()));
    },
    destroy: () => {
      if (live.timer) clearTimeout(live.timer);
      rooms.delete(code);
    },
  });
  rooms.set(code, live);
  void live.host.changed(Date.now());
  return live;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  if (p === '/api/health') return send(res, 200, { ok: true, t: Date.now() });
  if (p === '/api/rooms' && req.method === 'POST') {
    for (let i = 0; i < 8; i++) {
      const code = randomRoomCode();
      if (!rooms.has(code)) {
        createRoom(code);
        return send(res, 201, { code });
      }
    }
    return send(res, 503, { error: 'try again' });
  }
  const info = p.match(/^\/api\/rooms\/([A-Z]+)$/);
  if (info) {
    const live = ROOM_CODE_RE.test(info[1]!) ? rooms.get(info[1]!) : undefined;
    if (!live) return send(res, 200, { exists: false });
    const s = live.host.engine.s;
    return send(res, 200, { exists: true, phase: s.phase, players: s.seats.length, joinable: s.phase === 'lobby' && s.seats.length < MAX_SEATS });
  }
  if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' });

  // static files (production-like preview) with SPA fallback
  let file = path.join(STATIC_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(STATIC_DIR)) file = path.join(STATIC_DIR, 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC_DIR, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end('Build the client first: npm run build');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const m = (req.url ?? '').match(/^\/ws\/([A-Z]+)/);
  const live = m && ROOM_CODE_RE.test(m[1]!) ? rooms.get(m[1]!) : undefined;
  if (!live) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    live.sockets.set(ws, null);
    ws.on('message', (data, isBinary) => {
      const text = isBinary ? '' : data.toString();
      if (text === 'ping') return ws.send('pong');
      void live.host.onMessage(makeConn(live, ws), text);
    });
    const gone = () => {
      const conn = makeConn(live, ws);
      const id = conn.getId();
      live.sockets.delete(ws);
      void live.host.onClose({ ...conn, getId: () => id });
    };
    ws.on('close', gone);
    ws.on('error', () => undefined);
  });
});

server.listen(PORT, () => console.log(`gaffer node host listening on http://localhost:${PORT}`));
