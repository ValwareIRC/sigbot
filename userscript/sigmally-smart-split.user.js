// ==UserScript==
// @name         Sigmally Smart Split
// @namespace    https://github.com/ValwareIRC/sigbot
// @version      1.0.0
// @description  Auto-splits onto split-up (teaming) players on one.sigmally.com, picking the fewest splits that land the kill and keeping you safe.
// @match        https://one.sigmally.com/*
// @match        https://*.sigmally.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // ---------------------------------------------------------------- config
    // Game constants mirror sig-server's Settings.js (Sigmally's server).
    const GAME = {
        eatMult: 1.140175425099138,  // size ratio needed to eat (mass ratio 1.3)
        eatOverlapDiv: 3,            // must overlap until dist <= a - b/3
        minSplitSize: 128,
        maxCells: 16,
        splitDistance: 60,
        splitBoost: 780,
        boostDecay: 8 / 9,           // boost moves d/9 per tick
        moveMult: 2.5,
        virusSize: 100,
        tickMs: 40,
    };

    const DEFAULTS = {
        auto: true,             // fire automatically when a good plan exists
        teamersOnly: false,     // only target players flagged as teaming
        hud: true,
        maxSplits: 4,           // consider 1..N splits (2^N pieces)
        simTicks: 20,           // how far ahead to simulate (20 ticks = 800ms)
        minGainMass: 40,        // minimum net gain (mass) to auto-fire
        minGainFrac: 0.04,      // ...and at least this fraction of my mass
        splitCostFrac: 0.025,   // penalty per split, as fraction of my mass (being split = slow merge)
        riskWeight: 1.0,        // how much expected loss counts against gain
        splitThreatWeight: 0.65,// weight of threats that need to split to reach me
        reactTicks: 8,          // how many ticks enemies get to chase my pieces
        eatMargin: 12,          // safety margin on overlap (units)
        marginPerTick: 2.5,     // margin grows with prediction distance
        teamerBonus: 1.35,      // multiplier on mass gained from flagged teamers
        lockMs: 260,            // hold the aim on the target after splitting
        cooldownMs: 320,        // minimum time between auto actions
        defaultRttMs: 90,       // used until RTT is measured from our own splits
        ignoreSameClan: true,
        keys: { toggleAuto: 'KeyG', toggleTeamers: 'KeyT', manual: 'KeyX', toggleHud: 'KeyH' },
    };

    const STORE = 'sigSmartSplit.cfg';
    const CFG = (() => {
        try {
            const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
            return { ...DEFAULTS, ...saved, keys: { ...DEFAULTS.keys, ...(saved.keys || {}) } };
        } catch (_) { return { ...DEFAULTS }; }
    })();
    const saveCfg = () => { try { localStorage.setItem(STORE, JSON.stringify(CFG)); } catch (_) { } };
    W.smartSplit = { cfg: CFG, save: saveCfg, get active() { return activeConn; } }; // tweak from devtools: smartSplit.cfg.minGainMass = 60; smartSplit.save()

    // ---------------------------------------------------------------- helpers
    const now = () => performance.now();
    const moveSpeed = s => 88 * Math.pow(s, -0.4396754) * GAME.moveMult;
    const mass = s => s * s / 100;
    const canEat = (a, b) => a > b * GAME.eatMult;
    const SQRT2 = Math.SQRT2;
    const R = GAME.boostDecay;
    const UTF8 = new TextDecoder();

    // ---------------------------------------------------------------- teamer tracking
    // Owners are identified by name + colour (the protocol carries no owner id).
    const teamers = new Map(); // ownerKey -> { score, t, name, mates:Set }
    const HALF_LIFE = 45000;
    function flagTeamer(key, name, mateKey, amount) {
        if (!key) return;
        let e = teamers.get(key);
        const t = now();
        if (!e) teamers.set(key, e = { score: 0, t, name, mates: new Set() });
        e.score = e.score * Math.pow(0.5, (t - e.t) / HALF_LIFE) + amount;
        e.t = t;
        e.name = name || e.name;
        if (mateKey) e.mates.add(mateKey);
    }
    function teamerScore(key) {
        const e = teamers.get(key);
        return e ? e.score * Math.pow(0.5, (now() - e.t) / HALF_LIFE) : 0;
    }
    const isTeamer = key => teamerScore(key) >= 1;

    // ---------------------------------------------------------------- connection state
    const conns = new Map();
    let activeConn = null;
    const NativeWS = W.WebSocket;
    const nativeSend = NativeWS.prototype.send;

    class Conn {
        constructor(ws) {
            this.ws = ws;
            this.ready = false;
            this.shuf = new Uint8Array(256);   // logical opcode -> wire byte
            this.unshuf = new Uint8Array(256); // wire byte -> logical opcode
            this.cells = new Map();
            this.mine = new Set();
            this.tick = 0;
            this.mouse = { x: 0, y: 0 };      // last mouse position the game client sent
            this.lastClientMouse = 0;
            this.lockUntil = 0;
            this.lockTargetId = 0;
            this.lockOvershoot = 0;
            this.lastAction = -Infinity;
            this.pendingSplitAt = 0;
            this.rtt = CFG.defaultRttMs;
            this.lastPlan = null;
            ws.addEventListener('message', ev => {
                try { this.onMessage(ev.data); } catch (err) { console.error('[SmartSplit]', err); }
            });
            ws.addEventListener('close', () => { conns.delete(ws); if (activeConn === this) activeConn = null; });
        }

        raw(buf) { nativeSend.call(this.ws, buf); }
        sendMouse(x, y) {
            const dv = new DataView(new ArrayBuffer(13));
            dv.setUint8(0, this.shuf[16]);
            dv.setInt32(1, Math.round(x), true);
            dv.setInt32(5, Math.round(y), true);
            this.raw(dv.buffer);
        }
        sendSplit(n) {
            const b = new Uint8Array([this.shuf[17]]);
            for (let i = 0; i < n; i++) this.raw(b);
            this.pendingSplitAt = now();
        }

        // returns false to drop the client's packet
        onOutgoing(data) {
            if (!this.ready) return true;
            let u8;
            if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
            else if (ArrayBuffer.isView(data)) u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            else return true;
            if (u8.length === 0) return true;
            const op = this.unshuf[u8[0]];
            if (op === 16 && u8.length === 13) {
                const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
                this.mouse.x = dv.getInt32(1, true);
                this.mouse.y = dv.getInt32(5, true);
                this.lastClientMouse = now();
                activeConn = this;
                if (now() < this.lockUntil) return false; // we're steering
            } else if (op === 17) {
                this.pendingSplitAt = now(); // user split: also useful for RTT
            }
            return true;
        }

        onMessage(data) {
            if (!(data instanceof ArrayBuffer)) return;
            const dv = new DataView(data);
            if (!this.ready) {
                let o = 0, s = '';
                while (o < dv.byteLength) { const c = dv.getUint8(o++); if (!c) break; s += String.fromCharCode(c); }
                if (!s.startsWith('SIG')) return;
                for (let i = 0; i < 256; i++) {
                    this.shuf[i] = dv.getUint8(o + i);
                    this.unshuf[this.shuf[i]] = i;
                }
                this.ready = true;
                return;
            }
            const op = this.unshuf[dv.getUint8(0)];
            switch (op) {
                case 16: this.parseUpdate(dv); this.afterUpdate(); break;
                case 18: this.cells.clear(); break;
                case 20: this.mine.clear(); break;
                case 32: {
                    this.mine.add(dv.getUint32(1, true));
                    if (this.pendingSplitAt) {
                        const sample = now() - this.pendingSplitAt;
                        if (sample > 5 && sample < 600) this.rtt = this.rtt * 0.7 + sample * 0.3;
                        this.pendingSplitAt = 0;
                    }
                    break;
                }
            }
        }

        parseUpdate(dv) {
            let o = 1;
            const u8 = () => dv.getUint8(o++);
            const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
            const i16 = () => { const v = dv.getInt16(o, true); o += 2; return v; };
            const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
            const str = () => {
                const start = o;
                while (o < dv.byteLength && dv.getUint8(o) !== 0) o++;
                const bytes = new Uint8Array(dv.buffer, dv.byteOffset + start, o - start);
                o++;
                return bytes.length ? UTF8.decode(bytes) : '';
            };
            this.tick++;
            const tick = this.tick;

            const nEat = u16();
            for (let i = 0; i < nEat; i++) {
                const eater = this.cells.get(u32()), eatenId = u32(), eaten = this.cells.get(eatenId);
                if (eater && eaten) this.onEat(eater, eaten);
                this.cells.delete(eatenId);
                this.mine.delete(eatenId);
            }
            for (; ;) {
                const id = u32();
                if (id === 0) break;
                const x = i16(), y = i16(), s = u16(), flags = u8();
                u8(); u8(); u8(); // isUpdate, isPlayer, isSub
                const clan = str();
                let color = null, skin = null, name = null;
                if (flags & 2) color = (u8() << 16) | (u8() << 8) | u8();
                if (flags & 4) skin = str();
                if (flags & 8) name = str();
                let c = this.cells.get(id);
                if (!c) {
                    c = { id, x, y, s, vx: 0, vy: 0, vt: tick, born: tick, color: 0, name: '', clan: '', key: '' };
                    this.cells.set(id, c);
                } else {
                    const dt = Math.max(1, tick - c.vt);
                    const nvx = (x - c.x) / dt, nvy = (y - c.y) / dt;
                    // fast (boosting) cells: take raw velocity, otherwise smooth a bit
                    const fast = Math.hypot(nvx, nvy) > moveSpeed(s) * 1.5 + 3;
                    const k = fast ? 1 : 0.6;
                    c.vx = c.vx * (1 - k) + nvx * k;
                    c.vy = c.vy * (1 - k) + nvy * k;
                    c.vt = tick;
                }
                c.x = x; c.y = y; c.s = s; c.flags = flags; c.clan = clan;
                if (color !== null) c.color = color;
                if (name !== null) c.name = name;
                c.virus = !!(flags & 1);
                c.eject = !!(flags & 0x20);
                c.player = !c.virus && !c.eject && s > 40;
                c.key = c.player ? c.name + '|' + c.color : '';
            }
            const nDel = u16();
            for (let i = 0; i < nDel; i++) {
                const id = u32();
                this.cells.delete(id);
                this.mine.delete(id);
            }
        }

        // Teaming signals: a player cell that flies into another player's cell,
        // or ejected mass of one colour fed to a different player.
        onEat(eater, eaten) {
            if (!eater.player || this.mine.has(eater.id) || this.mine.has(eaten.id)) return;
            if (eaten.player && eaten.key !== eater.key) {
                const dx = eater.x - eaten.x, dy = eater.y - eaten.y;
                const toward = eaten.vx * dx + eaten.vy * dy;
                const speed = Math.hypot(eaten.vx, eaten.vy);
                const flying = speed > moveSpeed(eaten.s) * 1.5 + 3;
                // a cell rushing into a bigger one, or a big chunk being absorbed while moving toward it
                if (toward > 0 && (flying || eaten.s > eater.s * 0.45)) {
                    const amt = flying ? 1 : 0.5;
                    flagTeamer(eaten.key, eaten.name, eater.key, amt);
                    flagTeamer(eater.key, eater.name, eaten.key, amt);
                }
            } else if (eaten.eject && eaten.color !== eater.color) {
                flagTeamer(eater.key, eater.name, null, 0.15);
                for (const c of this.cells.values())
                    if (c.player && c.color === eaten.color && c.key !== eater.key) { flagTeamer(c.key, c.name, eater.key, 0.15); break; }
            }
        }

        afterUpdate() {
            const t = now();
            // keep steering locked splits onto the moving target
            if (t < this.lockUntil) {
                const tgt = this.cells.get(this.lockTargetId);
                if (!tgt) { this.release(); }
                else {
                    const L = this.leadTicks();
                    const p = predict(tgt, L, this.tick);
                    const c = centroid(this.myCells());
                    const d = Math.hypot(p.x - c.x, p.y - c.y) || 1;
                    this.sendMouse(p.x + (p.x - c.x) / d * this.lockOvershoot, p.y + (p.y - c.y) / d * this.lockOvershoot);
                }
            } else if (this.lockUntil) {
                this.release();
            }

            if (this !== activeConn && activeConn) return;
            const ready = t - this.lastAction > CFG.cooldownMs && t >= this.lockUntil;
            const plan = (CFG.auto || CFG.hud) ? this.plan() : null;
            this.lastPlan = plan;
            if (plan && CFG.auto && ready && this.worthIt(plan)) this.execute(plan, 'auto');
            hud.update(this);
        }

        release() {
            this.lockUntil = 0;
            this.lockTargetId = 0;
            this.sendMouse(this.mouse.x, this.mouse.y);
        }

        leadTicks() { return this.rtt / GAME.tickMs + 0.5; }
        myCells() {
            const out = [];
            for (const id of this.mine) { const c = this.cells.get(id); if (c) out.push(c); }
            return out;
        }

        worthIt(plan) {
            const need = Math.max(CFG.minGainMass, CFG.minGainFrac * plan.myMass);
            return plan.score >= need && plan.risk <= plan.gain * 0.5;
        }

        execute(plan, why) {
            this.sendMouse(plan.aim.x, plan.aim.y);
            this.sendSplit(plan.k);
            this.lastAction = now();
            this.lockUntil = now() + CFG.lockMs;
            this.lockTargetId = plan.targetId;
            this.lockOvershoot = plan.overshoot;
            hud.flash(`${why}: ${plan.k}x split → +${Math.round(plan.gain)} mass` +
                (plan.risk > 1 ? ` (risk ${Math.round(plan.risk)})` : '') + (plan.teamer ? ' [teamer]' : ''));
        }

        // ------------------------------------------------------------ the solver
        plan() {
            const mine = this.myCells();
            if (!mine.length) return null;
            const tick = this.tick;
            const L = this.leadTicks();
            const center = centroid(mine);
            let myMass = 0, maxMine = 0;
            for (const c of mine) { myMass += mass(c.s); if (c.s > maxMine) maxMine = c.s; }
            if (maxMine < GAME.minSplitSize || mine.length >= GAME.maxCells) return null;

            const myKeys = new Set(mine.map(c => c.key));
            const myClan = mine[0].clan;
            const reach = GAME.splitDistance * CFG.maxSplits + GAME.splitBoost + moveSpeed(maxMine) * CFG.simTicks + maxMine;

            const enemies = [], viruses = [], targets = [];
            for (const c of this.cells.values()) {
                if (this.mine.has(c.id)) continue;
                const d = Math.hypot(c.x - center.x, c.y - center.y);
                if (d > reach + 1400) continue;
                if (c.virus) { if (d < reach + 200) viruses.push(c); continue; }
                if (!c.player || myKeys.has(c.key)) continue;
                enemies.push(c);
                if (d > reach) continue;
                if (!canEat(maxMine / SQRT2, c.s)) continue;
                if (CFG.ignoreSameClan && myClan && c.clan === myClan) continue;
                if (CFG.teamersOnly && !isTeamer(c.key)) continue;
                targets.push(c);
            }
            if (!targets.length) return null;

            // when (if ever) is each enemy cell absorbed by someone else (its teammate)?
            const ctx = { tick, L, enemies, viruses, deadline: new Map(), growth: new Map() };
            for (const e of enemies) {
                for (const big of enemies) {
                    if (big === e || big.key === e.key || !canEat(big.s, e.s)) continue;
                    for (let n = 0; n <= CFG.simTicks; n += 2) {
                        const a = predict(e, L + n, tick), b = predict(big, L + n, tick);
                        if (Math.hypot(a.x - b.x, a.y - b.y) <= big.s - e.s / GAME.eatOverlapDiv) {
                            const prev = ctx.deadline.get(e.id);
                            if (prev === undefined || n < prev.n) ctx.deadline.set(e.id, { n, by: big.id });
                            break;
                        }
                    }
                }
            }

            // nearest / juiciest targets first, cap the work
            targets.sort((a, b) => score0(b) - score0(a));
            function score0(c) { return mass(c.s) / (300 + Math.hypot(c.x - center.x, c.y - center.y)); }
            targets.length = Math.min(targets.length, 12);

            const baseRisk = simulate(mine, this.mouse, 0, ctx).risk;
            let best = null;
            for (const tgt of targets) {
                for (let k = 1; k <= CFG.maxSplits; k++) {
                    const aimInfo = interceptAim(mine, tgt, k, ctx);
                    if (!aimInfo) continue;
                    const r = simulate(mine, aimInfo.aim, k, ctx);
                    if (!r.eaten.has(tgt.id) && r.gain <= 0) continue;
                    const risk = Math.max(0, r.risk - baseRisk);
                    const score = r.gain - CFG.riskWeight * risk - CFG.splitCostFrac * myMass * k - (r.virus ? myMass : 0);
                    if (!best || score > best.score) {
                        best = { score, gain: r.gain, risk, k, aim: aimInfo.aim, overshoot: aimInfo.overshoot,
                            targetId: tgt.id, teamer: isTeamer(tgt.key), myMass, eaten: r.eaten.size };
                    }
                    if (r.eaten.has(tgt.id)) break; // fewer splits already lands it: stay as big as possible
                }
            }
            return best;
        }
    }

    function centroid(cells) {
        let x = 0, y = 0, m = 0;
        for (const c of cells) { const w = c.s * c.s; x += c.x * w; y += c.y * w; m += w; }
        return m ? { x: x / m, y: y / m } : { x: 0, y: 0 };
    }

    // Where a cell will be in n ticks. Boosting cells decay like the server's boost.
    function predict(c, n, tick) {
        if (c.vt < tick - 1) return { x: c.x, y: c.y };
        const sp = Math.hypot(c.vx, c.vy);
        let f;
        if (sp > moveSpeed(c.s) * 1.5 + 3) f = R * (1 - Math.pow(R, n)) / (1 - R);
        else f = Math.min(n, 30);
        return { x: c.x + c.vx * f, y: c.y + c.vy * f };
    }

    // Pick the aim point so the front piece meets the target where it will be.
    function interceptAim(mine, tgt, k, ctx) {
        const div = Math.pow(SQRT2, k);
        let src = null, bestD = Infinity;
        for (const c of mine) {
            if (c.s / Math.pow(SQRT2, k - 1) < GAME.minSplitSize || !canEat(c.s / div, tgt.s)) continue;
            const d = Math.hypot(c.x - tgt.x, c.y - tgt.y);
            if (d < bestD) { bestD = d; src = c; }
        }
        if (!src) return null;
        const ps = src.s / div;
        const sp = predict(src, ctx.L, ctx.tick);
        let aim = null;
        for (let n = 1; n <= CFG.simTicks; n++) {
            const tp = predict(tgt, ctx.L + n, ctx.tick);
            const travel = GAME.splitDistance * k + GAME.splitBoost * (1 - Math.pow(R, n)) + moveSpeed(ps) * n;
            if (travel >= Math.hypot(tp.x - sp.x, tp.y - sp.y) - (ps - tgt.s / GAME.eatOverlapDiv)) { aim = tp; break; }
        }
        if (!aim) aim = predict(tgt, ctx.L + CFG.simTicks, ctx.tick);
        const d = Math.hypot(aim.x - sp.x, aim.y - sp.y) || 1;
        const overshoot = 120;
        return { aim: { x: aim.x + (aim.x - sp.x) / d * overshoot, y: aim.y + (aim.y - sp.y) / d * overshoot }, overshoot };
    }

    // Replays the server's split + boost + move + eat rules for my cells.
    function simulate(mine, aim, k, ctx) {
        const { L, tick, enemies, viruses, deadline } = ctx;
        const pieces = mine.map(c => {
            const sp = Math.hypot(c.vx, c.vy), ms = moveSpeed(c.s);
            const boosting = sp > ms * 1.5 + 3;
            const p = predict(c, L, tick);
            return { x: p.x, y: p.y, s: c.s, b: boosting ? (sp - ms) * 9 * Math.pow(R, L) : 0,
                bx: boosting ? c.vx / sp : 0, by: boosting ? c.vy / sp : 0 };
        });
        let count = pieces.length;
        for (let step = 0; step < k; step++) {
            const n = pieces.length;
            for (let i = 0; i < n; i++) {
                if (count >= GAME.maxCells) break;
                const p = pieces[i];
                if (p.s < GAME.minSplitSize) continue;
                let dx = aim.x - p.x, dy = aim.y - p.y;
                const d = Math.hypot(dx, dy);
                if (d < 1) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
                const ns = p.s / SQRT2;
                p.s = ns;
                pieces.push({ x: p.x + GAME.splitDistance * dx, y: p.y + GAME.splitDistance * dy, s: ns, b: GAME.splitBoost, bx: dx, by: dy });
                count++;
            }
        }

        const eaten = new Set();
        let gain = 0, virus = false, risk = 0;
        const pieceRisk = new Float64Array(pieces.length);
        const T = CFG.simTicks;
        for (let t = 1; t <= T; t++) {
            for (const p of pieces) {
                if (p.b >= 1) { const d = p.b / 9; p.x += p.bx * d; p.y += p.by * d; p.b -= d; }
                const dx = aim.x - p.x, dy = aim.y - p.y, d = Math.hypot(dx, dy);
                if (d >= 1) { const m = Math.min(moveSpeed(p.s), d); p.x += dx / d * m; p.y += dy / d * m; }
            }
            if (k === 0) continue;
            const margin = CFG.eatMargin + CFG.marginPerTick * t;
            for (const e of enemies) {
                if (eaten.has(e.id)) continue;
                const dl = deadline.get(e.id);
                if (dl && dl.n < t) continue; // already swallowed by its teammate
                const ep = predict(e, L + t, tick);
                for (const p of pieces) {
                    if (!canEat(p.s, e.s)) continue;
                    if (Math.hypot(p.x - ep.x, p.y - ep.y) <= p.s - e.s / GAME.eatOverlapDiv - margin) {
                        p.s = Math.sqrt(p.s * p.s + e.s * e.s);
                        eaten.add(e.id);
                        gain += mass(e.s) * (isTeamer(e.key) ? CFG.teamerBonus : 1);
                        break;
                    }
                }
            }
            for (const v of viruses) {
                for (const p of pieces) {
                    if (canEat(p.s, v.s) && Math.hypot(p.x - v.x, p.y - v.y) <= p.s - v.s / GAME.eatOverlapDiv) virus = true;
                }
            }
        }

        // Risk: after the move, who can catch each of my pieces? (enemies grow by what their teammates absorb)
        const grown = new Map();
        for (const [id, dl] of deadline) {
            if (eaten.has(id)) continue;
            const e = ctx.enemies.find(c => c.id === id);
            if (e) grown.set(dl.by, (grown.get(dl.by) || 0) + e.s * e.s);
        }
        for (const e of enemies) {
            if (eaten.has(e.id)) continue;
            const dl = deadline.get(e.id);
            if (dl && dl.n < T) continue;
            const es = Math.sqrt(e.s * e.s + (grown.get(e.id) || 0));
            const ep = predict(e, L + T, tick);
            const chase = moveSpeed(es) * CFG.reactTicks;
            for (let i = 0; i < pieces.length; i++) {
                const p = pieces[i];
                if (!canEat(es, p.s)) continue;
                const d = Math.hypot(p.x - ep.x, p.y - ep.y);
                let w = 0;
                if (d <= es - p.s / GAME.eatOverlapDiv + chase) w = 1;
                else if (es >= GAME.minSplitSize && canEat(es / SQRT2, p.s) &&
                    d <= es / SQRT2 + GAME.splitDistance + GAME.splitBoost * 0.92 + chase) w = CFG.splitThreatWeight;
                if (w * mass(p.s) > pieceRisk[i]) pieceRisk[i] = w * mass(p.s);
            }
        }
        for (const r of pieceRisk) risk += r;
        return { gain, risk, virus, eaten };
    }

    // ---------------------------------------------------------------- WebSocket hook
    NativeWS.prototype.send = function (data) {
        let c = conns.get(this);
        if (!c) { c = new Conn(this); conns.set(this, c); }
        if (!c.onOutgoing(data)) return;
        return nativeSend.call(this, data);
    };

    // ---------------------------------------------------------------- HUD + keys
    const hud = {
        el: null, msg: '', msgUntil: 0, lastDraw: 0,
        ensure() {
            if (this.el || !document.body) return this.el;
            const el = document.createElement('div');
            el.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999;pointer-events:none;' +
                'font:13px/1.45 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.72);padding:8px 11px;' +
                'border-radius:8px;max-width:360px;white-space:pre-wrap;text-shadow:0 1px 2px #000';
            document.body.appendChild(el);
            return this.el = el;
        },
        flash(m) { this.msg = m; this.msgUntil = now() + 2500; },
        update(conn) {
            const t = now();
            if (t - this.lastDraw < 100) return;
            this.lastDraw = t;
            if (!this.ensure()) return;
            this.el.style.display = CFG.hud ? '' : 'none';
            if (!CFG.hud) return;
            const k = CFG.keys, p = conn.lastPlan;
            const list = [...teamers.entries()].map(([key, e]) => [e.name, teamerScore(key)])
                .filter(([, s]) => s >= 1).sort((a, b) => b[1] - a[1]).slice(0, 5)
                .map(([n]) => n || '(unnamed)');
            const lines = [
                `Smart Split  ·  auto ${CFG.auto ? 'ON' : 'off'} [${k.toggleAuto.replace('Key', '')}]` +
                `  ·  ${CFG.teamersOnly ? 'teamers only' : 'all players'} [${k.toggleTeamers.replace('Key', '')}]`,
                `rtt ${Math.round(conn.rtt)}ms  ·  manual [${k.manual.replace('Key', '')}]` +
                (p ? `  ·  best: ${p.k}x → ${Math.round(p.score)}` : ''),
            ];
            if (list.length) lines.push('teamers: ' + list.join(', '));
            if (t < this.msgUntil) lines.push('▶ ' + this.msg);
            this.el.textContent = lines.join('\n');
        },
    };

    W.addEventListener('keydown', e => {
        const tgt = e.target;
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
        if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        const k = CFG.keys;
        let handled = true;
        if (e.code === k.toggleAuto) { CFG.auto = !CFG.auto; hud.flash('auto ' + (CFG.auto ? 'ON' : 'off')); }
        else if (e.code === k.toggleTeamers) { CFG.teamersOnly = !CFG.teamersOnly; hud.flash(CFG.teamersOnly ? 'targeting teamers only' : 'targeting all players'); }
        else if (e.code === k.toggleHud) { CFG.hud = !CFG.hud; }
        else if (e.code === k.manual) {
            const c = activeConn;
            const plan = c && c.plan();
            if (plan && plan.score > 0) c.execute(plan, 'manual');
            else hud.flash('manual: nothing worth splitting on');
        } else handled = false;
        if (handled) { saveCfg(); e.stopImmediatePropagation(); e.preventDefault(); if (activeConn) { hud.lastDraw = 0; hud.update(activeConn); } }
    }, true);

    console.log('[SmartSplit] loaded');
})();
