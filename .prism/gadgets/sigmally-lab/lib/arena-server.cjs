// Runs the real Sigmally server code (sig-server) locally for arena games.
// usage: node arena-server.cjs --sig <path to sig-server> --port 47900 --bots 8 --maxCells 8
const path = require('path');
const argv = process.argv.slice(2);
const args = new Proxy({}, { get: (_, k) => { const i = argv.indexOf('--' + String(k)); return i >= 0 ? argv[i + 1] : undefined; } });
const sig = path.resolve(args.sig);
const req = p => require(path.join(sig, p));

// sig-server listens on every network interface; keep the arena on this computer only
const wsLib = require('ws');
const OrigServer = wsLib.WebSocketServer;
wsLib.WebSocketServer = wsLib.Server = class extends OrigServer {
    constructor(opts, cb) { super({ host: '127.0.0.1', ...opts }, cb); }
};

const DefaultSettings = req('src/Settings');
const ServerHandle = req('src/ServerHandle');
const settings = Object.assign({}, DefaultSettings, {
    listeningPort: +args.port || 47900,
    listenerMaxConnectionsPerIP: 128,   // every arena bot connects from 127.0.0.1
    listenerMaxConnections: 256,
    listenerAcceptedOrigins: [],
    worldPlayerBotsPerWorld: +(args.bots ?? 8),
    playerMaxCells: +(args.maxCells ?? 8),
    // the live server has no virus cap (fed viruses always split there); the repo default (30) made fed viruses ignore
    // every shot once the map was full - mining did nothing in the arena
    virusMaxCount: 100000, playerEjectDelay: 1,   // live takes a W press every tick (measured)
    serverName: 'Sigmally Lab arena',
    chatEnabled: false,
});
const handle = new ServerHandle(settings);
handle.protocols.register(req('src/protocols/SigmallyProtocol'), req('src/protocols/LegacyProtocol'), req('src/protocols/ModernProtocol'));
handle.gamemodes.register(req('src/gamemodes/FFA'), req('src/gamemodes/Teams'), req('src/gamemodes/LastManStanding'));
// only warnings and errors are interesting here
handle.logger.onlog = (date, level, message) => {
    if (level === 'WARN' || level === 'ERROR' || process.env.ARENA_DEBUG) console.error(`[server ${level}] ${message}`);
};
process.on('uncaughtException', err => console.error('[server crash]', err && err.stack));
handle.start();
// "ready" only once the port is really open (listen errors arrive asynchronously, after start())
const sock = handle.listener.listenerSocket;
sock.on('listening', () => console.log(JSON.stringify({ type: 'ready', port: settings.listeningPort, bots: settings.worldPlayerBotsPerWorld, maxCells: settings.playerMaxCells })));
sock.on('error', err => { console.error('[server listen error]', err.message); process.exit(2); });

// a heartbeat with the leaderboard so the lab can show who's winning, server bots included
setInterval(() => {
    const out = [];
    for (const id in handle.worlds) {
        const w = handle.worlds[id];
        for (const p of w.players) {
            if (!p.ownedCells.length) continue;
            let m = 0; for (const c of p.ownedCells) m += c.size * c.size / 100;
            out.push({ name: p.cellName || p.leaderboardName || '?', mass: Math.round(m), cells: p.ownedCells.length, bot: p.router.type === 'playerbot' });
        }
    }
    out.sort((a, b) => b.mass - a.mass);
    if (process.env.ARENA_DEBUG) console.error("[dbg] worlds", Object.keys(handle.worlds).length, "players", Object.keys(handle.players).length, "queued", handle.matchmaker.queued.length, "tick", handle.tick);
    console.log(JSON.stringify({ type: 'board', t: Date.now(), players: out.slice(0, 30) }));
}, 2000);
process.on('SIGTERM', () => { handle.stop(); process.exit(0); });

// ---- spectator feed (the user wants to WATCH the arena, not just read numbers): the whole world ~12x a second on
// ws://127.0.0.1:<port+1>. Players, viruses and ejected mass everywhere; pellets only inside the area a viewer asks
// for ({ view: { x, y, w, h } }), so it stays light.
{
    const spec = new OrigServer({ host: '127.0.0.1', port: (+args.port || 47900) + 1 });
    const views = new Map();
    spec.on('connection', ws => {
        views.set(ws, null);
        ws.on('message', d => { try { const m = JSON.parse(d); if (m.view) views.set(ws, m.view); } catch (_) { } });
        ws.on('close', () => views.delete(ws));
    });
    spec.on('error', err => console.error('[spectator]', err.message));
    setInterval(() => {
        if (!views.size) return;
        let w = null; for (const id in handle.worlds) { w = handle.worlds[id]; break; }
        if (!w) return;
        const players = [], other = [], pelletsAll = [];
        for (const c of w.cells) {
            const t = c.type;
            if (t === 0) players.push([Math.round(c.x), Math.round(c.y), Math.round(c.size), c.owner ? c.owner.id : 0]);
            else if (t === 1) pelletsAll.push(c);
            else other.push([Math.round(c.x), Math.round(c.y), Math.round(c.size), t]);
        }
        const owners = {};
        for (const p of w.players) if (p.ownedCells.length) {
            let m = 0; for (const c of p.ownedCells) m += c.size * c.size / 100;
            const col = p.cellColor || {};
            owners[p.id] = [p.cellName || p.leaderboardName || '', Math.round(m), p.router.type === 'playerbot' ? 1 : 0, ((col.r | 0) << 16) | ((col.g | 0) << 8) | (col.b | 0)];
        }
        const base = { t: Date.now(), border: w.border, players, other, owners };
        for (const [ws, v] of views) {
            if (ws.readyState !== 1) continue;
            const pel = [];
            if (v) for (const c of pelletsAll) if (Math.abs(c.x - v.x) < v.w / 2 && Math.abs(c.y - v.y) < v.h / 2) { pel.push(Math.round(c.x), Math.round(c.y)); if (pel.length > 8000) break; }
            try { ws.send(JSON.stringify({ ...base, pellets: pel })); } catch (_) { }
        }
    }, 80);
}
