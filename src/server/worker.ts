import { DurableObject } from 'cloudflare:workers';
export class Room extends DurableObject {
  async fetch(req: Request) {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) { ws.send('echo:' + msg); }
}
export default {
  async fetch(req: Request, env: { ROOMS: DurableObjectNamespace }) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/ws/')) return env.ROOMS.get(env.ROOMS.idFromName(url.pathname)).fetch(req);
    return new Response('api ok');
  },
};
