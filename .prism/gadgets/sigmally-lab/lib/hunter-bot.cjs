// Human-style arena players: what real people do that server bots never do. Chase and intercept,
// single and *delayed double* splits (second press from the flying half: ~1.4k reach), W-bait
// (shoot mass toward a smaller player, then split when it comes), and teams of two: the smaller
// one feeds the chaser and splits into it to make a kill.
// usage: node hunter-bot.cjs --server ws://127.0.0.1:47900 --name Hunter --count 2 --team 1
//   --team 1: the `count` players in this process team up (feed and split into each other)
const { WebSocket } = require('ws');
const argv = process.argv.slice(2), arg = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
const server = arg('server') || 'ws://127.0.0.1:47900';
const baseName = arg('name') || 'Hunter';
const count = +(arg('count') || 1);
const team = arg('team') === '1';

const speed = s => 88 * Math.pow(s, -0.4396754) * 2.5;
const canEat = (a, b) => a > b * 1.140175425099138;
const mass = s => s * s / 100;
const enc = new TextEncoder(), dec = new TextDecoder();
const players = [];

function makePlayer(name) {
    const P = { name, ws: new WebSocket(server), shuf: null, unshuf: null, cells: new Map(), mine: new Set(), inWorld: false, tick: 0,
        mouse: [0, 0], lastSplit: -99, again: 0, lastEject: -99, alive: false, diedAt: 0, color: -1, bait: null };
    const ws = P.ws; ws.binaryType = 'arraybuffer';
    const send = (op, extra) => { const b = new Uint8Array(1 + (extra ? extra.length : 0)); b[0] = P.shuf[op]; if (extra) b.set(extra, 1); ws.send(b); };
    P.spawn = () => { if (!P.inWorld) return; const body = enc.encode(JSON.stringify({ name, skin: '', clan: '', showClanmates: false })); const b = new Uint8Array(body.length + 2); b[0] = P.shuf[0]; b.set(body, 1); ws.send(b); };
    P.split = () => send(17);
    P.eject = () => send(21);
    P.sendMouse = (x, y) => { const dv = new DataView(new ArrayBuffer(13)); dv.setUint8(0, P.shuf[16]); dv.setInt32(1, Math.round(x), true); dv.setInt32(5, Math.round(y), true); ws.send(dv.buffer); };
    ws.on('open', () => ws.send(enc.encode('SIG 0.0.1\0')));
    ws.on('message', data => {
        const u = new Uint8Array(data);
        if (!P.shuf) {
            let o = 0; while (o < u.length && u[o] !== 0) o++;
            P.shuf = u.slice(o + 1, o + 257); P.unshuf = new Uint8Array(256); for (let i = 0; i < 256; i++) P.unshuf[P.shuf[i]] = i;
            return;
        }
        const dv = new DataView(data), op = P.unshuf[u[0]];
        if (op === 64 && !P.inWorld) { P.inWorld = true; P.spawn(); }
        else if (op === 32) { P.mine.add(dv.getUint32(1, true)); P.alive = true; }
        else if (op === 20) P.mine.clear();
        else if (op === 18) P.cells.clear();
        else if (op === 16) { parse(P, dv); think(P); }
    });
    ws.on('close', () => process.exit(0));
    ws.on('error', () => process.exit(1));
    return P;
}

function parse(P, dv) {
    let o = 1; const n16 = () => { const v = dv.getUint16(o, true); o += 2; return v; }, n32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
    const str = () => { const s = o; while (o < dv.byteLength && dv.getUint8(o) !== 0) o++; const b = new Uint8Array(dv.buffer, s, o - s); o++; return b.length ? dec.decode(b) : ''; };
    P.tick++;
    const ne = n16();
    for (let i = 0; i < ne; i++) { n32(); const id = n32(); P.cells.delete(id); P.mine.delete(id); }
    for (; ;) {
        const id = n32(); if (!id) break;
        const x = dv.getInt16(o, true), y = dv.getInt16(o + 2, true), s = dv.getUint16(o + 4, true), fl = dv.getUint8(o + 6); o += 10;
        str();
        let color = null, name = null;
        if (fl & 2) { color = (dv.getUint8(o) << 16) | (dv.getUint8(o + 1) << 8) | dv.getUint8(o + 2); o += 3; }
        if (fl & 4) str();
        if (fl & 8) name = str();
        let c = P.cells.get(id);
        if (!c) P.cells.set(id, c = { id, x, y, s, vx: 0, vy: 0, color: 0, name: '' });
        else { c.vx = c.vx * 0.4 + (x - c.x) * 0.6; c.vy = c.vy * 0.4 + (y - c.y) * 0.6; }
        c.x = x; c.y = y; c.s = s; c.virus = !!(fl & 1); c.eject = !!(fl & 0x20); c.player = !c.virus && !c.eject && s > 40;
        if (color !== null) c.color = color; if (name !== null) c.name = name;
        if (P.mine.has(id)) P.color = c.color;
    }
    const nd = n16(); for (let i = 0; i < nd; i++) { const id = n32(); P.cells.delete(id); P.mine.delete(id); }
}

const partnerOf = P => (team ? players.find(q => q !== P && q.alive && q.mine.size) : null);
const isPartnerCell = (P, c) => { const q = partnerOf(P); return !!q && q.mine.has(c.id); };

function think(P) {
    const mine = [...P.mine].map(id => P.cells.get(id)).filter(Boolean);
    if (!mine.length) {
        if (P.alive) { P.alive = false; P.diedAt = P.tick; }
        if (P.tick - P.diedAt === 30) P.spawn();
        if (P.tick - P.diedAt > 30 && (P.tick - P.diedAt) % 100 === 0) P.spawn();
        return;
    }
    let cx = 0, cy = 0, mm = 0; for (const c of mine) { const w = c.s * c.s; cx += c.x * w; cy += c.y * w; mm += w; } cx /= mm; cy /= mm;
    const big = mine.reduce((a, c) => (c.s > a.s ? c : a)), small = mine.reduce((a, c) => (c.s < a.s ? c : a));
    const others = [...P.cells.values()].filter(c => c.player && !P.mine.has(c.id) && !isPartnerCell(P, c));
    // 1. second press of a delayed double split
    if (P.again && P.tick >= P.again) { P.again = 0; P.split(); }
    // 2. run from anything that can eat our smallest piece and is close
    let fx = 0, fy = 0;
    // (2026-10-20: was "anything that eats our smallest piece within 700" - far shyer than live players, who only guard
    // their main cell; the arena killed ~5x less than the live server)
    for (const e of others) if (canEat(e.s, big.s)) { const dx = cx - e.x, dy = cy - e.y, d = Math.max(1, Math.hypot(dx, dy) - e.s); if (d < 600) { fx += dx / d; fy += dy / d; } }
    if (fx || fy) { const l = Math.hypot(fx, fy); P.sendMouse(cx + fx / l * 800, cy + fy / l * 800); return; }
    // 3. team: the smaller partner feeds the bigger one when it's close (and splits in when it's hunting)
    const Q = partnerOf(P);
    if (Q) {
        const qc = [...Q.mine].map(id => P.cells.get(id) || Q.cells.get(id)).filter(Boolean);
        const qbig = qc.reduce((a, c) => (!a || c.s > a.s ? c : a), null);
        const qm = qc.reduce((a, c) => a + mass(c.s), 0);
        if (qbig && qm > mm / 100 * 1.2) {
            const d = Math.hypot(qbig.x - big.x, qbig.y - big.y);
            P.sendMouse(qbig.x, qbig.y);
            if (d - big.s - qbig.s < 650 && big.s >= 100 && P.tick - P.lastEject >= 2) { P.lastEject = P.tick; P.eject(); }
            // a prey right next to the partner that it can't quite eat: tricksplit our mass into it
            if (Q.hunting && d < 60 + 780 * 0.9 + qbig.s && canEat(qbig.s, big.s / Math.SQRT2) && P.tick - P.lastSplit > 40 && big.s >= 128) { P.lastSplit = P.tick; P.split(); }
            return;
        }
    }
    // 4. hunt: the most mass per distance that we (or our halves / quarters) can eat
    let tgt = null, best = 0;
    for (const e of others) {
        if (!canEat(big.s, e.s) && !canEat(big.s / 2, e.s) && !canEat(big.s / Math.SQRT2, e.s)) continue;
        const d = Math.hypot(e.x - big.x, e.y - big.y), v = mass(e.s) / (d + 300);
        if (v > best) { best = v; tgt = e; }
    }
    P.hunting = !!tgt;
    if (!tgt) {
        // farm: nearest pellets
        let f = null, fd = Infinity;
        for (const c of P.cells.values()) if (!c.player && !c.virus) { const d = Math.hypot(c.x - cx, c.y - cy); if (d < fd) { fd = d; f = c; } }
        if (f) P.sendMouse(f.x, f.y); else P.sendMouse(cx + 500, cy);
        return;
    }
    const lead = 8, tx = tgt.x + tgt.vx * lead, ty = tgt.y + tgt.vy * lead;
    const d = Math.hypot(tx - big.x, ty - big.y);
    P.sendMouse(tx, ty);
    if (P.tick - P.lastSplit < 12 || mine.length > 8 || big.s < 128) return;
    const r1 = 60 + 780 * 0.9 + big.s / Math.SQRT2 - tgt.s / 3, r2 = 60 + 780 * 0.75 + 60 + 780 * 0.85 + big.s / 2 - tgt.s / 3;
    // humans split for ~10% of their mass, single if it reaches, else a delayed double
    if (mass(tgt.s) < mass(big.s) * 0.03) return;
    if (canEat(big.s / Math.SQRT2, tgt.s) && d < r1) { P.lastSplit = P.tick; P.split(); return; }
    if (canEat(big.s / 2, tgt.s) && d < r2 && mine.length <= 4) { P.lastSplit = P.tick; P.split(); P.again = P.tick + 5; return; }
    // W-bait: out of reach and it's not running: drop a blob halfway to pull it in
    if (d < r2 + 600 && big.s > 180 && P.tick - P.lastEject > 50 && Math.hypot(tgt.vx, tgt.vy) < 4) { P.lastEject = P.tick; P.eject(); }
}

for (let i = 1; i <= count; i++) players.push(makePlayer(count > 1 ? `${baseName}${team ? '' : i}` : baseName));
console.log(JSON.stringify({ type: 'hunter-ready', name: baseName, count, team }));
