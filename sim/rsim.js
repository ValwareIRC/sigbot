// rsim: team scenes on the REAL Sigmally server code (sig-server, in this process). Our bot (one copy of the userscript,
// in-tab multibox) drives a real game connection per teammate; scripted opponents are server-side players. Eating,
// splitting, boosts, virus pops, merging, decay: all exactly the server's - unlike sqsim, whose own pieces never merge and
// whose viruses don't pop. Runs in real time (25 ticks a second).
// usage: node rsim.js <userscript> <scene> [seconds]   env: FRAMES=<file> (for the Sim viewer), SEED, CFG='{...}', LIST=1
const path = require('path'), fs = require('fs');
// LAB_DIR: the Sigmally Lab gadget (its node_modules has ws); SIG_SERVER: a checkout of https://github.com/8y8x/sig-server
const ROOT = path.resolve(__dirname, '..');
const LAB = process.env.LAB_DIR || path.join(ROOT, '.prism', 'gadgets', 'sigmally-lab');
const SIG = process.env.SIG_SERVER || [path.join(ROOT, 'sig-server'), path.resolve(ROOT, '..', 'sig-server')].find(p => fs.existsSync(path.join(p, 'src', 'ServerHandle.js'))) || path.join(ROOT, 'sig-server');
// the server's own requires (ws, ...) resolve from the Lab's node_modules too
process.env.NODE_PATH = path.join(LAB, 'node_modules') + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
require('module').Module._initPaths();
const wsLib = require('ws');
const req = p => require(path.join(SIG, p));

// ------------------------------------------------------------------ scenes (name -> what it tests, how it's set up)
// Each: { desc, bots: { name: [[x, y, mass], ...pieces] }, npcs: { name: { pieces, kind, ... } }, viruses: [[x, y]], goal }
const SCENES = require('./rscenes.js');
if (process.env.LIST) { for (const [k, s] of Object.entries(SCENES)) console.log(k + ': ' + s.desc); process.exit(0); }

const SCRIPT = process.argv[2], SCENE = process.argv[3] || 'dna', SECS = +(process.argv[4] || 15);
const sc = SCENES[SCENE];
if (!sc) { console.error('unknown scene ' + SCENE + '; scenes: ' + Object.keys(SCENES).join(', ')); process.exit(2); }
let seed = +(process.env.SEED || 1);
Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;   // the server's randomness too: repeatable-ish

// ------------------------------------------------------------------ the server
const PORT = 47960 + (process.pid % 30);
const settings = Object.assign({}, req('src/Settings'), {
    listeningPort: PORT, listenerMaxConnectionsPerIP: 64, listenerAcceptedOrigins: [], worldPlayerBotsPerWorld: 0,
    virusMinCount: 0, virusMaxCount: 0, chatEnabled: false, serverName: 'rsim', worldMapW: 22142, worldMapH: 22142,
    pelletCount: +(process.env.PELLETS || 21000), worldMaxCount: 1,
});
const handle = new (req('src/ServerHandle'))(settings);
handle.protocols.register(req('src/protocols/SigmallyProtocol'), req('src/protocols/LegacyProtocol'), req('src/protocols/ModernProtocol'));
handle.gamemodes.register(req('src/gamemodes/FFA'), req('src/gamemodes/Teams'), req('src/gamemodes/LastManStanding'));
handle.logger.onlog = (d, level, m) => { if (level === 'ERROR') console.error('[server]', m); };
handle.start();
const PlayerCell = req('src/cells/PlayerCell'), Virus = req('src/cells/Virus'), Bot = req('src/bots/Bot');

// ------------------------------------------------------------------ the browser the userscript expects, then the bot
const cfg = Object.assign({ bot: true, hud: false, lab: false, autoRespawn: false, multibox: true, squad: 'rsim', observe: false, teamJournal: true, maxCells: 16 },
    JSON.parse(process.env.CFG || '{}'));
const store = new Map([['sigMegaBot.cfg', JSON.stringify(cfg)]]);
global.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
global.document = { body: null, hidden: false, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
global.location = { href: 'https://one.sigmally.com/', reload() { } };
global.window = global;
global.addEventListener = () => { };
global.WebSocket = wsLib.WebSocket;
const _log = console.log; console.log = () => { };
new Function(fs.readFileSync(SCRIPT, 'utf8'))();
console.log = _log;
const mb = global.megaBot;

// ------------------------------------------------------------------ one minimal game client per bot player
const enc = new TextEncoder();
const clients = {};
function botClient(name) {
    return new Promise(resolve => {
        const ws = new wsLib.WebSocket('ws://127.0.0.1:' + PORT);
        ws.binaryType = 'arraybuffer';
        let shuf = null, unshuf = null, inWorld = false;
        ws.addEventListener('open', () => ws.send(enc.encode('SIG 0.0.1\0')));
        ws.addEventListener('message', ev => {
            const u = new Uint8Array(ev.data);
            if (shuf) {
                if (!inWorld && unshuf[u[0]] === 64) {
                    inWorld = true;
                    const body = enc.encode(JSON.stringify({ name, skin: '', clan: '', showClanmates: false }));
                    const b = new Uint8Array(body.length + 2); b[0] = shuf[0]; b.set(body, 1); ws.send(b);
                    resolve(ws);
                }
                return;
            }
            let o = 0; while (o < u.length && u[o] !== 0) o++;
            shuf = u.slice(o + 1, o + 1 + 256); unshuf = new Uint8Array(256); for (let i = 0; i < 256; i++) unshuf[shuf[i]] = i;
            // the real client keeps sending its mouse; the bot drops these while it drives
            setInterval(() => { const dv = new DataView(new ArrayBuffer(13)); dv.setUint8(0, shuf[16]); if (ws.readyState === 1) ws.send(dv.buffer); }, 40);
        });
        clients[name] = ws;
    });
}

// ------------------------------------------------------------------ scripted opponents: server-side players
const canEat = (a, b) => a > b * settings.worldEatMult, mass = s => s * s / 100, size = m => Math.sqrt(m * 100);
class Npc extends Bot {
    constructor(world, name, spec) { super(world); this.npcName = name; this.spec = spec; this.lastSplit = -99; }
    static get type() { return 'playerbot'; }
    get shouldClose() { return false; }
    update() {
        const p = this.player; p.updateVisibleCells();
        if (p.state === -1 && !this.spawnedOnce) { this.spawnedOnce = true; this.spawningAttributes = { name: this.npcName, skin: '', spectating: false, clan: '', showClanmates: false }; return; }
        if (!p.ownedCells.length) return;
        npcStep(this);
    }
}
const ownedBy = name => { const w = world(); const p = w && w.players.find(x => x.cellName === name); return p ? p.ownedCells : []; };
const botNames = Object.keys(sc.bots);
function npcStep(n) {
    const me = n.player.ownedCells, c = me.reduce((a, x) => (x.size > a.size ? x : a));
    const S = n.spec, tick = handle.tick;
    const edible = names => { let best = null; for (const nm of names) for (const t of ownedBy(nm)) if (canEat(c.size, t.size) && (!best || Math.hypot(t.x - c.x, t.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y))) best = t; return best; };
    let tgt = null;
    if (S.kind === 'chase') tgt = ownedBy(S.target).reduce((a, x) => (!a || x.size > a.size ? x : a), null);
    else if (S.kind === 'chaseboth') tgt = edible(botNames) || edible(botNames.concat([]));
    if (tgt) { n.mouseX = tgt.x; n.mouseY = tgt.y; }
    if (tgt && S.splits && me.length === 1 && canEat(c.size / Math.SQRT2, tgt.size) && Math.hypot(tgt.x - c.x, tgt.y - c.y) < c.size + 700 && tick - n.lastSplit > 50) {
        n.lastSplit = tick; n.splitAttempts++; log.push(`t${tick - t0}: ${n.npcName} split at ${tgt.owner.cellName}`);
    }
    if (S.kind === 'flee') {
        let fx = 0, fy = 0;
        for (const nm of botNames) for (const t of ownedBy(nm)) if (canEat(t.size, c.size)) { const dx = c.x - t.x, dy = c.y - t.y, d = Math.max(1, Math.hypot(dx, dy) - t.size); fx += dx / d; fy += dy / d; }
        const fl = Math.hypot(fx, fy); if (fl) { n.mouseX = c.x + fx / fl * 600; n.mouseY = c.y + fy / fl * 600; } else { n.mouseX = c.x; n.mouseY = c.y; }
    }
    if (S.kind === 'idle') { n.mouseX = c.x; n.mouseY = c.y; }
}

// ------------------------------------------------------------------ scene setup: place every player's pieces exactly
const world = () => Object.values(handle.worlds)[0];
function place(player, pieces) {
    const w = world();
    for (const c of player.ownedCells.slice()) w.removeCell(c);
    for (const [x, y, m] of pieces) w.addCell(new PlayerCell(player, x, y, size(m)));
    // removing every cell marks the player dead (state -1: a frozen view elsewhere, it sees only its own cells) - alive again
    player.updateState(0); player.updateViewArea();
}
const log = [], splits = [], events = [];
let t0 = 0;

(async () => {
    for (const n of botNames) await botClient(n);
    for (let i = 0; i < 100 && !(world() && botNames.every(n => ownedBy(n).length)); i++) await new Promise(r => setTimeout(r, 50));
    const w = world();
    if (!w) { console.error('no world'); process.exit(1); }
    const npcs = {};
    for (const [n, spec] of Object.entries(sc.npcs || {})) npcs[n] = new Npc(w, n, spec);
    for (let i = 0; i < 100 && !Object.keys(npcs).every(n => ownedBy(n).length); i++) await new Promise(r => setTimeout(r, 50));
    // events: who ate whom, splits
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
    t0 = handle.tick;
    console.log('FOOD ' + w.pelletCount + ' pellets on the map (' + Math.round(w.pelletCount / Math.pow(settings.worldMapW / 1000, 2) * 10) / 10 + ' per million sq units; the repo default is 21000)');
    const start = {}; for (const n of botNames) start[n] = centre(ownedBy(n));

    // ------------------------------------------------------------------ record
    const F = { scene: SCENE, desc: sc.desc, real: true, border: settings.worldMapW / 2, frames: [], owners: [], events, splits, relay: [] };
    const cols = {};
    const nameOfConn = c => { for (const n of botNames) if (ownedBy(n).some(x => c.mine.has(x.id))) return n; return null; };
    const rec = setInterval(() => {
        const t = handle.tick - t0, list = [];
        const cx = centre(botNames.flatMap(n => ownedBy(n)));
        for (const c of w.cells) {
            if (c.type === 1 && (Math.abs(c.x - cx.x) > 2600 || Math.abs(c.y - cx.y) > 1800)) continue;   // food: only near us
            if (Math.abs(c.x - cx.x) > 5000 || Math.abs(c.y - cx.y) > 5000) continue;
            const kind = c.type === 0 ? 'p' : c.type === 1 ? 'f' : c.type === 2 ? 'v' : c.type === 3 ? 'e' : 'o';
            const owner = c.type === 0 ? c.owner.cellName : '';
            if (owner && !cols[owner]) cols[owner] = c.color;
            list.push([c.id, Math.round(c.x), Math.round(c.y), Math.round(c.size), kind, owner]);
        }
        const modes = {}, aims = {};
        for (const k of mb.conns()) { const n = nameOfConn(k); if (!n) continue; modes[n] = k.mode || ''; if (k.botAim) aims[n] = [Math.round(k.botAim.x), Math.round(k.botAim.y)]; }
        F.frames.push({ t, c: list, m: modes, a: aims });
        if (process.env.TRACE && t % 25 < 2 && t - (F.lastTrace || -99) >= 20) {
            F.lastTrace = t;
            for (const k of mb.conns()) {
                const n = nameOfConn(k); if (!n) continue;
                const p = k.lastPlan;
                console.log(`  t${t} ${n} ${Math.round(ownedBy(n).reduce((a, c) => a + mass(c.size), 0))}m/${ownedBy(n).length}pc danger ${Math.round(k.danger || 0)} | ${k.mode}` +
                    (p ? ` | plan k${p.k} score ${Math.round(p.score)} gain ${Math.round(p.gain)} risk ${Math.round(p.risk)} lost ${Math.round(p.lost)}` : ' | no split plan'));
            }
        }
    }, 40);

    await new Promise(r => setTimeout(r, SECS * 1000));
    clearInterval(rec);
    F.owners = Object.keys(cols).map(n => ({ name: n, col: cols[n], bot: botNames.includes(n) }));
    // ------------------------------------------------------------------ outcome
    const m = n => Math.round(ownedBy(n).reduce((a, c) => a + mass(c.size), 0));
    const parts = botNames.map(n => `${n} ${m(n)}`).concat(Object.keys(npcs).map(n => `${n} ${m(n)}`));
    console.log(`${SCENE}: ${parts.join('  ')}  pieces ${botNames.map(n => n + ' ' + ownedBy(n).length).join(' ')}`);
    const team = botNames.reduce((a, n) => a + m(n), 0), big = Math.max(...botNames.map(m));
    const moved = botNames.map(n => { const a = start[n], b = centre(ownedBy(n)); return ownedBy(n).length ? Math.round(Math.hypot(b.x - a.x, b.y - a.y)) : 0; });
    const walk = botNames.map(n => Math.round(88 * Math.pow(size(sc.bots[n].reduce((a, p) => a + p[2], 0)), -0.4396754) * 2.5 * 25 * SECS));
    console.log(`TEAM total ${team}, biggest ${big}, alive ${botNames.filter(n => ownedBy(n).length).length}/${botNames.length}, moved ${moved.join('/')} in ${SECS} s (walking at the start size: ${walk.join('/')})`);
    const mateEats = events.filter(e => botNames.some(a => e.includes(a + ' ate ')) && botNames.some(b => e.includes('ate ' + b + ' ')));
    console.log(`HANDOFFS ${mateEats.length} teammate pieces eaten; splits ${splits.length}; enemy eats of ours ${events.filter(e => !botNames.some(a => e.includes(': ' + a + ' ate'))).length}`);
    for (const e of events.slice(0, 30)) console.log('  ' + e);
    if (process.env.FRAMES) fs.writeFileSync(process.env.FRAMES, JSON.stringify(F));
    process.exit(0);
})();
function centre(cs) { let x = 0, y = 0, m = 0; for (const c of cs) { const w2 = c.size * c.size; x += c.x * w2; y += c.y * w2; m += w2; } return m ? { x: x / m, y: y / m } : { x: 0, y: 0 }; }
