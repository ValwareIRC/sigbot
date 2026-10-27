// Runs the real Mega Bot userscript in Node against an arena server, with a minimal stand-in for
// the Sigmally web client (handshake, spawn, mouse) and a fake "Play" button the bot clicks to respawn.
// usage: node headless-bot.cjs --server ws://127.0.0.1:47900 --script <userscript> --name MegaBot1
//        --cfg <json> --lab ws://127.0.0.1:47800 --label A
const fs = require('fs');
const { WebSocket } = require('ws');
const argv = process.argv.slice(2), arg = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
const server = arg('server') || 'ws://127.0.0.1:47900';
const name = arg('name') || 'MegaBot';
const label = arg('label') || '';
const cfg = Object.assign({ bot: true, hud: false, autoRespawn: true, lab: true, labUrl: arg('lab') || 'ws://127.0.0.1:47800' },
    JSON.parse(arg('cfg') || '{}'));

// --- browser stand-ins the userscript expects
const store = new Map([['sigMegaBot.cfg', JSON.stringify(cfg)]]);
global.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
let spawn = () => { };
global.document = { body: null, getElementById: id => (id === 'play-btn' ? { disabled: false, offsetParent: {}, click: () => spawn() } : null) };
global.location = { href: `arena://${name}${label ? ' [' + label + ']' : ''}`, reload() { } };
global.window = global;
global.addEventListener = () => { };
global.WebSocket = WebSocket;

// --- load the bot
const src = fs.readFileSync(arg('script'), 'utf8');
new Function(src)();

// --- minimal game client
const enc = new TextEncoder();
let shuf = null, unshuf = null, inWorld = false, mouse = [0, 0];
const ws = new WebSocket(server);
ws.binaryType = 'arraybuffer';
ws.addEventListener('open', () => ws.send(enc.encode('SIG 0.0.1\0')));
ws.addEventListener('message', ev => {
    const u = new Uint8Array(ev.data);
    if (shuf) {
        // the server sends the map border (op 64) once we're placed in a world. Spawn only then:
        // a spawn request before that toggles us *out* of the matchmaking queue.
        if (!inWorld && unshuf[u[0]] === 64) { inWorld = true; spawn(); }
        return;
    }
    let o = 0; while (o < u.length && u[o] !== 0) o++;
    shuf = u.slice(o + 1, o + 1 + 256);
    unshuf = new Uint8Array(256); for (let i = 0; i < 256; i++) unshuf[shuf[i]] = i;
    spawn = () => {
        if (!inWorld) return;
        const body = enc.encode(JSON.stringify({ name, skin: '', clan: '', showClanmates: false }));
        const b = new Uint8Array(body.length + 2); b[0] = shuf[0]; b.set(body, 1); b[b.length - 1] = 0;
        ws.send(b);
    };
    // the real client sends its mouse ~25x a second; the bot drops these while it's driving
    setInterval(() => {
        const dv = new DataView(new ArrayBuffer(13));
        dv.setUint8(0, shuf[16]); dv.setInt32(1, mouse[0], true); dv.setInt32(5, mouse[1], true);
        ws.send(dv.buffer);
    }, 40);
});
ws.addEventListener('close', () => process.exit(0));
ws.addEventListener('error', err => { console.error('[bot] socket error', err.message); process.exit(1); });
console.log(JSON.stringify({ type: 'bot-ready', name, label }));
