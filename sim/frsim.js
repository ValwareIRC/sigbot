// frsim: the same team scenes as rsim.js, on the REAL Sigmally server code (sig-server), but FAST: no network and no
// waiting - the bot's game connections are in-memory socket pairs into the server's own Connection objects, and a
// virtual clock steps the server tick by tick (40 ms each) as fast as the computer can. Same physics as live/rsim.
// usage: node frsim.js <userscript> <scene> [seconds]   env: SEED, CFG='{...}', FRAMES=<file>, TRACE=1, PELLETS
const path = require('path'), fs = require('fs');
// LAB_DIR: the Sigmally Lab gadget (its node_modules has ws); SIG_SERVER: a checkout of https://github.com/8y8x/sig-server
const ROOT = path.resolve(__dirname, '..');
const LAB = process.env.LAB_DIR || path.join(ROOT, '.prism', 'gadgets', 'sigmally-lab');
const SIG = process.env.SIG_SERVER || [path.join(ROOT, 'sig-server'), path.resolve(ROOT, '..', 'sig-server')].find(p => fs.existsSync(path.join(p, 'src', 'ServerHandle.js'))) || path.join(ROOT, 'sig-server');
process.env.NODE_PATH = path.join(LAB, 'node_modules') + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
require('module').Module._initPaths();
const req = p => require(path.join(SIG, p));
const SCENES = require('./rscenes.js');

const SCRIPT = process.argv[2], SCENE = process.argv[3] || 'fast', SECS = +(process.argv[4] || 16);
const sc = SCENES[SCENE];
if (!sc) { console.error('unknown scene ' + SCENE); process.exit(2); }

// ------------------------------------------------------------------ virtual time (before anything reads the clock)
let vt = 0; const BASE = 1.75e12;
const realNow = Date.now;
global.performance = { now: () => vt };
Date.now = () => BASE + vt;
let seed = +(process.env.SEED || 1);
Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ------------------------------------------------------------------ the server, stepped by hand
const settings = Object.assign({}, req('src/Settings'), {
    listeningPort: 0, listenerMaxConnectionsPerIP: 64, listenerAcceptedOrigins: [], worldPlayerBotsPerWorld: 0,
    virusMinCount: 0, virusMaxCount: 100000, playerEjectDelay: 1, chatEnabled: false, serverName: 'frsim', worldMapW: 22142, worldMapH: 22142,
    pelletCount: +(process.env.PELLETS || 21000), worldMaxCount: 1,
});
const handle = new (req('src/ServerHandle'))(settings);
handle.protocols.register(req('src/protocols/SigmallyProtocol'), req('src/protocols/LegacyProtocol'), req('src/protocols/ModernProtocol'));
handle.gamemodes.register(req('src/gamemodes/FFA'), req('src/gamemodes/Teams'), req('src/gamemodes/LastManStanding'));
handle.logger.onlog = (d, level, m) => { if (level === 'ERROR') console.error('[server]', m); };
// handle.start() without the listener socket and the ticker
handle.gamemodes.setGamemode(settings.serverGamemode);
handle.startTime = new Date(); handle.averageTickTime = handle.tick = 0; handle.running = true;
handle.gamemode.onHandleStart();
const PlayerCell = req('src/cells/PlayerCell'), Virus = req('src/cells/Virus'), Bot = req('src/bots/Bot');

// ------------------------------------------------------------------ in-memory sockets
const toServer = [], toClient = [];
// network lag like live: messages are held this many ticks each way (env LAG, default 2 = ~80 ms each way)
const LAGT = +(process.env.LAG ?? 2);
let simTick = 0;
class ServerSide {
    constructor(client) { this.client = client; this._socket = { remoteAddress: '127.0.0.1' }; this.h = {}; this.readyState = 1; }
    on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); }
    send(data) { const u = data instanceof Buffer ? data : Buffer.from(data); toClient.push([this.client, u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength), simTick + LAGT]); }
    close() { this.readyState = 3; }
    removeAllListeners() { }
}
class FakeWebSocket {
    constructor(url) {
        this.url = url; this.readyState = 0; this.binaryType = 'arraybuffer'; this.l = {};
        this.server = new ServerSide(this);
        handle.listener.onConnection(this.server);
        toClient.push([this, 'open', 0]);
    }
    addEventListener(n, f) { (this.l[n] = this.l[n] || []).push(f); }
    removeEventListener(n, f) { if (this.l[n]) this.l[n] = this.l[n].filter(x => x !== f); }
    send(d) {
        const u = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d);
        toServer.push([this.server, u.slice().buffer, simTick + LAGT]);
    }
    close() { this.readyState = 3; }
    emit(n, ev) { if (this['on' + n]) this['on' + n](ev); for (const f of this.l[n] || []) f(ev); }
}
FakeWebSocket.OPEN = 1;
const flushToServer = () => { while (toServer.length && toServer[0][2] <= simTick) { const [s, buf] = toServer.shift(); for (const f of s.h.message || []) f(buf); } };
const flushToClient = () => {
    let n = 0;
    while (toClient.length && toClient[0][2] <= simTick && n++ < 10000) {
        const [c, d] = toClient.shift();
        if (d === 'open') { c.readyState = 1; c.emit('open', {}); continue; }
        c.emit('message', { data: d });
    }
};

// ------------------------------------------------------------------ the browser, then the bot (one copy, in-tab multibox)
const cfg = Object.assign({ bot: true, hud: false, lab: false, autoRespawn: false, multibox: true, squad: 'frsim', observe: false, teamJournal: false, maxCells: 16 },
    JSON.parse(process.env.CFG || '{}'));
const store = new Map([['sigMegaBot.cfg', JSON.stringify(cfg)]]);
global.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
global.document = { body: null, hidden: false, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
global.location = { href: 'https://one.sigmally.com/', reload() { } };
global.window = global;
global.addEventListener = () => { };
global.WebSocket = FakeWebSocket;
global.setInterval = () => 0;   // the bot's own timers (Lab link, HUD) aren't needed here
const _log = console.log; console.log = () => { };
new Function(fs.readFileSync(SCRIPT, 'utf8'))();
console.log = _log;
const mb = global.megaBot;

// ------------------------------------------------------------------ bot players: a minimal game client each
const enc = new TextEncoder();
const botNames = Object.keys(sc.bots);
function botClient(name) {
    const ws = new FakeWebSocket('wss://sim.sigmally.com/ws/');
    let shuf = null, unshuf = null, inWorld = false;
    ws.addEventListener('open', () => ws.send(enc.encode('SIG 0.0.1\0')));
    ws.addEventListener('message', ev => {
        const u = new Uint8Array(ev.data);
        if (shuf) {
            if (!inWorld && unshuf[u[0]] === 64) {
                inWorld = true;
                const body = enc.encode(JSON.stringify({ name, skin: '', clan: '', showClanmates: false }));
                const b = new Uint8Array(body.length + 2); b[0] = shuf[0]; b.set(body, 1); ws.send(b);
            }
            return;
        }
        let o = 0; while (o < u.length && u[o] !== 0) o++;
        shuf = u.slice(o + 1, o + 1 + 256); unshuf = new Uint8Array(256); for (let i = 0; i < 256; i++) unshuf[shuf[i]] = i;
        const dv = new DataView(new ArrayBuffer(13)); dv.setUint8(0, shuf[16]); ws.send(dv.buffer);   // the client's first mouse
    });
    return ws;
}

// ------------------------------------------------------------------ scripted opponents (server-side players)
const canEat = (a, b) => a > b * settings.worldEatMult, mass = s => s * s / 100, size = m => Math.sqrt(m * 100);
const world = () => Object.values(handle.worlds)[0];
const ownedBy = name => { const w = world(); const p = w && w.players.find(x => x.cellName === name); return p ? p.ownedCells : []; };
const events = [], splits = [];
let t0 = 0;
class Npc extends Bot {
    constructor(w, name, spec) { super(w); this.npcName = name; this.spec = spec; this.lastSplit = -99; }
    static get type() { return 'playerbot'; }
    get shouldClose() { return false; }
    update() {
        const p = this.player; p.updateVisibleCells();
        if (p.state === -1 && !this.spawnedOnce) { this.spawnedOnce = true; this.spawningAttributes = { name: this.npcName, skin: '', spectating: false, clan: '', showClanmates: false }; return; }
        if (!p.ownedCells.length) return;
        const me = p.ownedCells, c = me.reduce((a, x) => (x.size > a.size ? x : a)), S = this.spec, tick = handle.tick;
        let tgt = null;
        const edible = () => { let best = null; for (const nm of botNames) for (const q of ownedBy(nm)) if (canEat(c.size, q.size) && (!best || Math.hypot(q.x - c.x, q.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y))) best = q; return best; };
        if (S.kind === 'chase') tgt = ownedBy(S.target).reduce((a, x) => (!a || x.size > a.size ? x : a), null);
        else if (S.kind === 'chaseboth') tgt = edible();
        if (tgt) { this.mouseX = tgt.x; this.mouseY = tgt.y; }
        if (tgt && S.splits && me.length === 1 && canEat(c.size / Math.SQRT2, tgt.size) && Math.hypot(tgt.x - c.x, tgt.y - c.y) < c.size + 700 && tick - this.lastSplit > 50) { this.lastSplit = tick; this.splitAttempts++; }
        if (S.kind === 'flee') {
            let fx = 0, fy = 0;
            for (const nm of botNames) for (const q of ownedBy(nm)) if (canEat(q.size, c.size)) { const dx = c.x - q.x, dy = c.y - q.y, d = Math.max(1, Math.hypot(dx, dy) - q.size); fx += dx / d; fy += dy / d; }
            const fl = Math.hypot(fx, fy); if (fl) { this.mouseX = c.x + fx / fl * 600; this.mouseY = c.y + fy / fl * 600; } else { this.mouseX = c.x; this.mouseY = c.y; }
        }
        if (S.kind === 'idle') { this.mouseX = c.x; this.mouseY = c.y; }
    }
}
function place(player, pieces) {
    const w = world();
    for (const c of player.ownedCells.slice()) w.removeCell(c);
    for (const [x, y, m] of pieces) w.addCell(new PlayerCell(player, x, y, size(m)));
    // removing every cell marks the player dead (state -1: a frozen view elsewhere, it sees only its own cells) - alive again
    player.updateState(0); player.updateViewArea();
}
const centre = cs => { let x = 0, y = 0, m = 0; for (const c of cs) { const w2 = c.size * c.size; x += c.x * w2; y += c.y * w2; m += w2; } return m ? { x: x / m, y: y / m } : { x: 0, y: 0 }; };
const jitTrail = {}, jitSecs = {}, frzSecs = {};   // frzSecs: 3 s windows where a bot moved under 60 (frozen)
const step = () => { vt += 40; simTick++; flushToServer(); handle.onTick(); flushToClient();
    // jitter: 3 s windows where a bot moved 350+ but got less than 30% of that anywhere (the bot's own wobble test)
    if (simTick % 5 === 0 && typeof botNames !== "undefined") for (const n of botNames) { const cs = ownedBy(n); if (!cs.length) { jitTrail[n] = []; continue; }
        const tr = jitTrail[n] = jitTrail[n] || []; tr.push(centre(cs)); if (tr.length > 15) tr.shift();
        if (tr.length === 15 && simTick % 25 === 0) { let p = 0; for (let i = 1; i < 15; i++) p += Math.hypot(tr[i].x - tr[i-1].x, tr[i].y - tr[i-1].y); const net = Math.hypot(tr[14].x - tr[0].x, tr[14].y - tr[0].y); if (p > 350 && net < 0.3 * p) jitSecs[n] = (jitSecs[n] || 0) + 1; if (p < 60) frzSecs[n] = (frzSecs[n] || 0) + 1; } } };

// ------------------------------------------------------------------ run
for (const n of botNames) botClient(n);
for (let i = 0; i < 200 && !(world() && botNames.every(n => ownedBy(n).length)); i++) step();
const w = world();
if (!w) { console.error('no world'); process.exit(1); }
const npcs = {};
for (const [n, spec] of Object.entries(sc.npcs || {})) npcs[n] = new Npc(w, n, spec);
for (let i = 0; i < 100 && !Object.keys(npcs).every(n => ownedBy(n).length); i++) step();
const rm = w.removeCell.bind(w);
w.removeCell = cell => {
    if (t0 && cell.eatenBy && cell.type === 0 && cell.eatenBy.type === 0 && cell.owner !== cell.eatenBy.owner)
        events.push(`t${handle.tick - t0}: ${cell.eatenBy.owner.cellName} ate ${cell.owner.cellName} piece (${Math.round(mass(cell.size))})`);
    return rm(cell);
};
const sp = w.splitPlayer.bind(w);
w.splitPlayer = pl => { if (t0) splits.push(`t${handle.tick - t0} ${pl.cellName} x1`); return sp(pl); };
for (const n of botNames) place(w.players.find(p => p.cellName === n), sc.bots[n]);
for (const [n, spec] of Object.entries(sc.npcs || {})) place(npcs[n].player, spec.pieces);
for (const [x, y] of sc.viruses || []) w.addCell(new Virus(w, x, y));
for (let i = 0; i < 3; i++) step();          // let everyone see the placed scene (and squad messages flow)
if (process.env.DBGVIS) {
    for (const n of botNames) {
        const p = w.players.find(q => q.cellName === n), vis = Object.values(p.visibleCells || {});
        const by = {}; for (const c of vis) { const k = c.type === 0 ? 'player:' + c.owner.cellName : ['pl', 'pellet', 'virus', 'eject'][c.type] || c.type; by[k] = (by[k] || 0) + 1; }
        console.log('VIS server', n, 'state', p.state, 'view', JSON.stringify({ x: Math.round(p.viewArea.x), y: Math.round(p.viewArea.y), w: Math.round(p.viewArea.w), h: Math.round(p.viewArea.h) }), JSON.stringify(by));
    }
    for (const k of mb.conns()) console.log('VIS client', k.myName || '?', 'cells', k.cells.size, 'players', [...k.cells.values()].filter(c => c.player).map(c => c.name).join(','));
}
t0 = handle.tick;
const start = {}; for (const n of botNames) start[n] = centre(ownedBy(n));
const F = { scene: SCENE, desc: sc.desc, real: true, border: settings.worldMapW / 2, frames: [], owners: [], events, splits, relay: [] };
const cols = {};
const nameOfConn = k => { for (const n of botNames) if (ownedBy(n).some(x => k.mine.has(x.id))) return n; return null; };
let firstDeath = null, lastModes = {};
const t1 = realNow();
for (let i = 0; i < SECS * 25; i++) {
    step();
    const t = handle.tick - t0;
    if (!firstDeath) for (const n of botNames) if (!ownedBy(n).length) { firstDeath = { n, t, modes: lastModes }; break; }
    { const lm = {}; for (const k of mb.conns()) { const n = nameOfConn(k); if (n) lm[n] = (k.mode || '').replace('fast travel: ', '').replace(/\(.*\)/, '').replace(/[0-9]+/g, '#').trim(); } lastModes = lm; }
    if (process.env.FRAMES) {
        const list = [], cx = centre(botNames.flatMap(n => ownedBy(n)));
        for (const c of w.cells) {
            if (c.type === 1 && (Math.abs(c.x - cx.x) > 2600 || Math.abs(c.y - cx.y) > 1800)) continue;
            if (Math.abs(c.x - cx.x) > 5000 || Math.abs(c.y - cx.y) > 5000) continue;
            const kind = c.type === 0 ? 'p' : c.type === 1 ? 'f' : c.type === 2 ? 'v' : c.type === 3 ? 'e' : 'o';
            const owner = c.type === 0 ? c.owner.cellName : '';
            if (owner && !cols[owner]) cols[owner] = c.color;
            list.push([c.id, Math.round(c.x), Math.round(c.y), Math.round(c.size), kind, owner]);
        }
        const modes = {}, aims = {};
        for (const k of mb.conns()) { const n = nameOfConn(k); if (!n) continue; modes[n] = k.mode || ''; if (k.botAim) aims[n] = [Math.round(k.botAim.x), Math.round(k.botAim.y)]; }
        F.frames.push({ t, c: list, m: modes, a: aims });
    }
    if (process.env.TRACE && t % 25 === 0) for (const k of mb.conns()) { const n = nameOfConn(k); if (n) console.log(`  t${t} ${n} ${Math.round(ownedBy(n).reduce((a, c) => a + mass(c.size), 0))}m/${ownedBy(n).length}pc | ${k.mode}` + (process.env.TRACE === "2" ? " ft=" + JSON.stringify(k.ft ? { a: k.ft.active, i: k.ft.idx, turn: k.ft.turn, seen: k.ft.seen, plan: k.ft.plan } : null) : "")); }
}
// ------------------------------------------------------------------ outcome (same lines as rsim, plus one JSON line for batches)
const m = n => Math.round(ownedBy(n).reduce((a, c) => a + mass(c.size), 0));
console.log(`${SCENE}: ${botNames.map(n => `${n} ${m(n)}`).concat(Object.keys(npcs).map(n => `${n} ${m(n)}`)).join('  ')}  pieces ${botNames.map(n => n + ' ' + ownedBy(n).length).join(' ')}`);
const team = botNames.reduce((a, n) => a + m(n), 0);
const moved = botNames.map(n => { const a = start[n], b = centre(ownedBy(n)); return ownedBy(n).length ? Math.round(Math.hypot(b.x - a.x, b.y - a.y)) : 0; });
const walk = botNames.map(n => Math.round(88 * Math.pow(size(sc.bots[n].reduce((a, p) => a + p[2], 0)), -0.4396754) * 2.5 * 25 * SECS));
const alive = botNames.filter(n => ownedBy(n).length).length;
const mateEats = events.filter(e => botNames.some(a => e.includes(': ' + a + ' ate ')) && botNames.some(b => e.includes('ate ' + b + ' ')));
console.log(`TEAM total ${team}, alive ${alive}/${botNames.length}, moved ${moved.join('/')} in ${SECS} s (walking ${walk.join('/')})` + (firstDeath ? `, ${firstDeath.n} died at ${(firstDeath.t / 25).toFixed(1)} s` : '') + ` [${((realNow() - t1) / 1000).toFixed(1)} s to run]`);
console.log(`HANDOFFS ${mateEats.length}; splits ${splits.length}`);
const lastSplit = splits.length ? +splits[splits.length - 1].slice(1, splits[splits.length - 1].indexOf(' ')) / 25 : 0;
console.log('RESULT ' + JSON.stringify({ lastSplit, scene: SCENE, seed: +(process.env.SEED || 1), alive, of: botNames.length, team, moved, walk, handoffs: mateEats.length, splits: splits.length, death: firstDeath, jitter: botNames.map(n => jitSecs[n] || 0), frozen: botNames.map(n => frzSecs[n] || 0) }));
if (process.env.FRAMES) { F.owners = Object.keys(cols).map(n => ({ name: n, col: cols[n], bot: botNames.includes(n) })); fs.writeFileSync(process.env.FRAMES, JSON.stringify(F)); }
process.exit(0);
