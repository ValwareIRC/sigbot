// Sigmally Lab backend.
// - Bridge on ws://127.0.0.1:47800: the Mega Bot userscript (your browser, Prism's browser, arena bots)
//   streams snapshots/events/deaths here and takes setting changes back. Only this computer can reach it.
// - Deaths are saved to the data folder with their last 10 s, for replays.
// - Arena: the real Sigmally server code (sig-server) on 127.0.0.1:47900 with server bots and headless
//   Mega Bots running the real userscript; can compare settings over timed runs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const PORT = 47800, ARENA_PORT = 47900;
let api, server, wss, renderMod, timers = [];
const clients = new Map();          // id -> live connection
const needPings = new Map();       // "needs you" problem -> { first, last } (one phone ping per problem)
let nextId = 1, focus = null;
const deaths = [];                   // newest first: { file, t, client, kind, cause, mass }
const pending = new Map();
let reqId = 1;
const renderCache = new Map();
const chat = [];                     // recent chat lines on the servers our tabs are on (deduplicated)
// friends / enemies / VIP (exact names), one set for every tab; kept in the gadget state
let lists = { friends: [], enemies: [], vipName: '', vipMode: '' };
const LIST_KEYS = ['friends', 'enemies', 'vipName', 'vipMode'];
function cleanLists(l) {
    const arr = a => [...new Set((Array.isArray(a) ? a : []).filter(x => typeof x === 'string' && x).map(x => x.slice(0, 40)))].slice(0, 100);
    const friends = arr(l.friends), enemies = arr(l.enemies).filter(x => !friends.includes(x));
    const vipMode = ['feed', 'protect'].includes(l.vipMode) ? l.vipMode : '';
    return { friends, enemies, vipName: vipMode && typeof l.vipName === 'string' ? l.vipName.slice(0, 40) : '', vipMode };
}
async function pushLists(except) {
    for (const c of clients.values()) {
        if (c === except || c.kind !== 'browser' || c.ws.readyState !== 1) continue;
        for (const k of LIST_KEYS) command(c, { cmd: 'set', key: k, value: lists[k] });
    }
}
function setListsAll(l, from) {
    lists = cleanLists(l);
    api.state.set('lists', lists);
    api.emit('lists', lists);
    pushLists(from);
}
// names worth picking from: the leaderboard, who killed us lately, who's been talking
function seenNames() {
    const n = new Map();
    const add = (name, why) => { if (name && !n.has(name)) n.set(name, why); };
    for (const c of clients.values()) for (const x of (c.lb && c.lb.names) || []) add(x, 'leaderboard');
    for (const d of deaths.slice(0, 80)) { const m = /(?:eaten|split-killed|cornered) by (?:teamer )?(.+)$/.exec(d.cause || ''); if (m) add(m[1].replace(/ \(server bot\)$/, '').trim(), 'killed us'); }
    for (const l of chat.slice(-60).reverse()) if (!l.fromServer) add(l.name, 'chat');
    return [...n.entries()].map(([name, why]) => ({ name, why })).slice(0, 60);
}
const arena = { server: null, bots: new Map(), board: [], status: 'off', startedAt: 0, opts: null, stats: new Map(), top: new Map(), log: [], compare: null, ready: null, gen: 0 };

const paths = () => ({
    // the working copy lives outside the project: Prism reloads its browser on any project file change,
    // which kicked the game tab back to the menu on every edit
    // (outside Downloads altogether: edits anywhere under it seemed to reload the game tab too)
    // (MEGABOT_USERSCRIPT overrides; a fresh checkout of the repo uses userscript/ in it)
    userscript: [process.env.MEGABOT_USERSCRIPT, path.join(process.env.LOCALAPPDATA || '', 'sighack_live', 'sigmally-mega-bot.user.js'),
        path.resolve(api.root, '..', 'sighack_live', 'sigmally-mega-bot.user.js'), path.join(api.root, 'userscript', 'sigmally-mega-bot.user.js'),
        path.join(api.root, 'sigmally-mega-bot.user.js')]
        .find(f => f && fs.existsSync(f)),
    // the server code for the arena: https://github.com/8y8x/sig-server (SIG_SERVER overrides; else sig-server/ in the
    // repo, or next to it)
    sig: [process.env.SIG_SERVER, path.join(api.root, 'sig-server'), path.resolve(api.root, '..', 'sighack_ref', 'sig-server'),
        path.resolve(api.root, '..', 'sig-server')].find(p => p && fs.existsSync(path.join(p, 'src', 'ServerHandle.js'))) || path.join(api.root, 'sig-server'),
    deaths: path.join(api.dataDir, 'deaths'),
    lib: path.join(api.dir, 'lib'),
});
const nodeEnv = () => ({ ...process.env, NODE_PATH: path.join(api.dir, 'node_modules') });

// ------------------------------------------------------------------ helpers
const now = () => Date.now();
const slug = s => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'game';
function summary(c) {
    return { id: c.id, kind: c.kind, name: c.name, label: c.label, connectedAt: c.connectedAt, lastSeen: c.lastSeen,
        mass: c.snap ? c.snap.mass : 0, mode: c.snap ? c.snap.mode : '', pieces: c.snap ? c.snap.pieces : 0,
        bot: c.snap ? c.snap.bot : c.cfg && c.cfg.bot, deaths: c.deaths, peak: c.peak, squad: c.snap ? c.snap.squad : '' };
}
function pickFocus() {
    const list = [...clients.values()];
    return (list.find(c => c.kind === 'browser') || list[0] || {}).id ?? null;
}
const emitClients = () => api.emit('clients', { clients: [...clients.values()].map(summary), focus });
const emitArena = () => api.emit('arena', arenaState());

function resolveTargets(spec) {
    if (spec === undefined || spec === null || spec === 'focus') return focus && clients.has(focus) ? [clients.get(focus)] : [];
    if (spec === 'all') return [...clients.values()];
    if (spec === 'browser' || spec === 'arena') return [...clients.values()].filter(c => c.kind === spec);
    const c = clients.get(+spec) || [...clients.values()].find(c => c.name === spec);
    return c ? [c] : [];
}
function command(c, payload) {
    const id = reqId++;
    return new Promise(resolve => {
        const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'no answer from the game (is the tab open?)' }); }, 4000);
        pending.set(id, r => { clearTimeout(timer); resolve(r); });
        try { c.ws.send(JSON.stringify({ ...payload, id })); } catch (e) { clearTimeout(timer); pending.delete(id); resolve({ ok: false, error: e.message }); }
    });
}

// ------------------------------------------------------------------ deaths
function loadDeaths() {
    const dir = paths().deaths;
    fs.mkdirSync(dir, { recursive: true });
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 500);
    for (const f of files) {
        try {
            const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
            deaths.push({ file: f, t: d.t, client: d.client, kind: d.kind, cause: d.cause, mass: d.massBefore, frames: (d.frames || []).length });
        } catch (_) { }
    }
}
function saveDeath(c, d) {
    const file = `${d.t}-${slug(c.name)}.json`;
    const rec = { client: c.name, kind: c.kind, label: c.label, ...d };
    try { fs.writeFileSync(path.join(paths().deaths, file), JSON.stringify(rec)); } catch (e) { api.log('could not save death', e.message); }
    const s = { file, t: d.t, client: c.name, kind: c.kind, cause: d.cause, mass: d.massBefore, frames: (d.frames || []).length };
    deaths.unshift(s);
    if (deaths.length > 500) deaths.length = 500;
    api.emit('death', s);
}
// ------------------------------------------------------------------ team journal (what each team action did)
const teamlog = [];                  // oldest first, capped
const teamlogFile = () => path.join(api.dataDir, 'teamlog.jsonl');
function loadTeamlog() {
    try {
        const lines = fs.readFileSync(teamlogFile(), 'utf8').trim().split('\n').slice(-3000);
        for (const l of lines) { try { teamlog.push(JSON.parse(l)); } catch (_) { } }
    } catch (_) { }
}
function saveTeamlog(c, e) {
    const rec = { client: c.name, cid: c.id, ...e };
    teamlog.push(rec);
    if (teamlog.length > 3000) teamlog.shift();
    api.emit('teamlog', rec);
    try { fs.appendFileSync(teamlogFile(), JSON.stringify(rec) + '\n'); } catch (_) { }
    // a relay's swap result also goes to the Relay watch feed
    if (/^DNA relay/.test(e.kind || '')) saveRelay(c, { ev: 'result', t: e.t || now(), why: (/\((.*)\)/.exec(e.kind) || [])[1] || '', verdict: e.verdict,
        toMate: e.toMate || 0, fromMate: e.fromMate || 0, toEnemy: e.toEnemy || 0, myMass: e.myMass, myAfter: e.myAfter, mateMass: e.mateMass, mateAfter: e.mateAfter });
}
// ------------------------------------------------------------------ relay feed (read by the Relay watch gadget)
// the bot's relay starts / splits / ends / sampled block reasons, one JSON line each, in a folder both gadgets know
const relayFile = () => path.join(process.env.LOCALAPPDATA || api.dataDir, 'sighack_live', 'relay.jsonl');
function saveRelay(c, m) {
    const { type, ...rest } = m;
    const rec = { ...rest, t: m.t || now(), cid: c.id, client: c.name, kind: c.kind, v: m.v || c.version || '' };
    try { fs.appendFileSync(relayFile(), JSON.stringify(rec) + '\n'); } catch (_) { }
}
// ------------------------------------------------------------------ watch-me recordings
// a tab with the bot off and recording on sends its frames (what we see + what the player pressed); one JSON line per
// frame, one file per session, in sighack_live/recordings (read by the analysis scripts in sighack_test)
const recDir = () => path.join(process.env.LOCALAPPDATA || api.dataDir, 'sighack_live', 'recordings');
function saveRec(c, m) {
    try {
        fs.mkdirSync(recDir(), { recursive: true });
        const f = path.join(recDir(), 'rec-' + String(m.session || 'x').replace(/[^\w.-]/g, '_') + '.jsonl');
        const lines = (m.frames || []).map(fr => JSON.stringify(fr)).join('\n');
        if (lines) fs.appendFileSync(f, lines + '\n');
        c.recFrames = (c.recFrames || 0) + (m.frames || []).length;
    } catch (_) { }
}
// ------------------------------------------------------------------ observe: what the bots see of the other players
// every bot tab sends 3 frames a second of the big players around it; one file per hour per browser in
// sighack_live/observe (read by the team-study scripts in sighack_test). Files older than 2 days are removed.
const obsDir = () => path.join(process.env.LOCALAPPDATA || api.dataDir, 'sighack_live', 'observe');
let obsPruned = 0;
function saveObs(c, m) {
    try {
        fs.mkdirSync(obsDir(), { recursive: true });
        const d = new Date(), hour = d.toISOString().slice(0, 13).replace('T', '-');
        const f = path.join(obsDir(), `obs-${hour}-${String(m.who || 'x').replace(/\W/g, '')}.jsonl`);
        const lines = (m.frames || []).map(fr => JSON.stringify({ ...fr, who: m.who, srv: m.srv })).join('\n');
        if (lines) fs.appendFileSync(f, lines + '\n');
        c.obsFrames = (c.obsFrames || 0) + (m.frames || []).length;
        if (now() - obsPruned > 3600e3) {
            obsPruned = now();
            for (const g of fs.readdirSync(obsDir())) { const p = path.join(obsDir(), g); if (now() - fs.statSync(p).mtimeMs > 2 * 86400e3) fs.unlinkSync(p); }
        }
    } catch (_) { }
}
// structured version for the Lab panel's Team tab
function teamlogData({ minutes = 30 } = {}) {
    const since = now() - minutes * 60000;
    const list = teamlog.filter(r => r.t >= since);
    const by = new Map();
    for (const r of list) {
        const k = r.kind;
        const g = by.get(k) || { kind: k, n: 0, worked: 0, verdicts: {}, toMate: 0, fromMate: 0, toEnemy: 0, killed: 0 };
        g.n++; if (r.verdict === 'worked') g.worked++;
        g.verdicts[r.verdict] = (g.verdicts[r.verdict] || 0) + 1;
        g.toMate += r.toMate || 0; g.fromMate += r.fromMate || 0; g.toEnemy += r.toEnemy || 0; g.killed += r.killed || 0;
        by.set(k, g);
    }
    return { minutes, total: list.length, groups: [...by.values()].sort((a, b) => b.n - a.n), recent: list.slice(-60).reverse() };
}
function teamlogReport({ minutes = 30, kind = '', limit = 15 } = {}) {
    const since = now() - minutes * 60000;
    const list = teamlog.filter(r => r.t >= since && (!kind || r.kind.includes(kind)));
    if (!list.length) return `No team actions logged in the last ${minutes} min.`;
    const by = new Map();
    for (const r of list) {
        const k = r.kind.replace(/ \(.*\)$/, '') + (r.kind.match(/\((escape|feed[^)]*|defend|travel|redistribute)\)/) ? ' (' + r.kind.match(/\(([^)]*)\)/)[1] + ')' : '');
        const g = by.get(k) || { n: 0, worked: 0, verdicts: {}, toMate: 0, fromMate: 0, toEnemy: 0, killed: 0, dist: [] };
        g.n++; if (r.verdict === 'worked') g.worked++;
        g.verdicts[r.verdict] = (g.verdicts[r.verdict] || 0) + 1;
        g.toMate += r.toMate || 0; g.fromMate += r.fromMate || 0; g.toEnemy += r.toEnemy || 0; g.killed += r.killed || 0;
        if (r.info && typeof r.info.dist === 'number') g.dist.push(r.info.dist);
        by.set(k, g);
    }
    const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : '-';
    const rows = [...by.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, g]) =>
        `${k}: ${g.n}x, worked ${Math.round(100 * g.worked / g.n)}% [${Object.entries(g.verdicts).map(([v, n]) => `${v} ${n}`).join(', ')}]` +
        ` | per try: into mate ${Math.round(g.toMate / g.n)}, from mate ${Math.round(g.fromMate / g.n)}, lost ${Math.round(g.toEnemy / g.n)}, killed ${Math.round(g.killed / g.n)}` +
        (g.dist.length ? ` | avg distance ${avg(g.dist)}` : ''));
    const recent = list.slice(-limit).reverse().map(r => `  ${new Date(r.t).toLocaleTimeString()} ${r.client}#${r.cid} ${r.kind} -> ${r.verdict}` +
        ` (into mate ${r.toMate}, from mate ${r.fromMate}, lost ${r.toEnemy}, killed ${r.killed}; me ${r.myMass}->${r.myAfter}, mate ${r.mate || '?'} ${r.mateMass}->${r.mateAfter}${r.died ? ', we died' : ''}) ${JSON.stringify(r.info)}`);
    return `Team actions, last ${minutes} min (${list.length}):\n` + rows.join('\n') + `\n\nMost recent:\n` + recent.join('\n');
}
function readDeath(file) {
    const f = path.join(paths().deaths, path.basename(file || deaths[0]?.file || ''));
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// ------------------------------------------------------------------ messages from the userscript
function onMessage(c, raw) {
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    c.lastSeen = now();
    if (m.type === 'hello') {
        c.page = m.page || '';
        c.kind = c.page.startsWith('arena://') ? 'arena' : 'browser';
        const nm = c.kind === 'arena' ? c.page.slice(8) : 'Your game';
        const lab = /\[(.*)\]$/.exec(nm);
        c.label = lab ? lab[1] : '';
        c.name = lab ? nm.slice(0, lab.index).trim() : nm;
        if (c.kind === 'browser' && /prism|electron/i.test((m.ua || '') + ' ' + (m.page || ''))) c.name = 'Prism browser';
        c.cfg = m.cfg;
        c.version = m.version || '';
        c.ua = m.ua || c.ua || '';
        if (m.cfg && m.cfg.multibox) c.squad = m.cfg.squad;
        const cur = clients.get(focus);
        if (!cur || (c.kind === 'browser' && cur.kind === 'arena')) focus = c.id;
        emitClients();
        if (c.kind === 'browser') setTimeout(() => { if (c.ws.readyState === 1) for (const k of LIST_KEYS) command(c, { cmd: 'set', key: k, value: lists[k] }); }, 1500);
    } else if (m.type === 'snap') {
        const s = m.snap; c.snap = s;
        c.peak = Math.max(c.peak, s.mass || 0);
        if (!c.massHist.length || s.t - c.massHist[c.massHist.length - 1][0] >= 1000) {
            c.massHist.push([s.t, s.mass]);
            if (c.massHist.length > 900) c.massHist.shift();
        }
        // only bots of the arena that's running now count (not ones still shutting down from the last)
        if (c.kind === 'arena' && arena.status === 'running' && arena.bots.has(c.name)) {
            const st = arena.stats.get(c.name) || { name: c.name, label: c.label, sum: 0, n: 0, deaths: 0, peak: 0 };
            st.sum += s.mass; st.n++; st.peak = Math.max(st.peak, s.mass); st.label = c.label; st.last = s.mass;
            arena.stats.set(c.name, st);
            // the group's biggest bot right now, once a second: what a leaderboard sees of a team (the #1 goal)
            const sec = Math.floor(now() / 1000), gt = arena.top.get(c.label) || { sum: 0, n: 0, sec: -1, best: 0 };
            if (gt.sec !== sec) { gt.sec = sec; let mx = 0; for (const o of arena.stats.values()) if (o.label === c.label) mx = Math.max(mx, o.last || 0); gt.sum += mx; gt.n++; gt.best = Math.max(gt.best, mx); arena.top.set(c.label, gt); }
        }
        if (c.id === focus) api.emit('snap', { id: c.id, snap: s });
    } else if (m.type === 'event') {
        c.events.push({ t: m.t, text: m.text });
        if (c.events.length > 100) c.events.shift();
        if (c.id === focus) api.emit('event', { id: c.id, t: m.t, text: m.text });
        // the one notification worth a ping: the bot can't respawn until a human clicks the captcha
        // ...and the site's ~1 h session drop in a page where the bot was injected (it can't reload itself)
        const need = /captcha/i.test(m.text) ? 'click the captcha so it can respawn' : /timed out.*please reload/i.test(m.text) ? 'the session timed out, reload the page' : '';
        // one ping per problem: while the same problem keeps being reported (every few minutes, from any tab, across
        // reconnects) stay quiet; only after it has gone quiet for 10 minutes does a new occurrence ping again
        if (need) {
            const p = needPings.get(need);
            if (!p || now() - p.last > 10 * 60000) { needPings.set(need, { first: now(), last: now() }); api.ui.notify?.('Mega Bot needs you', `${c.name}: ${need}`); }
            else p.last = now();
        }
    } else if (m.type === 'teamlog') {
        if (m.entry) saveTeamlog(c, m.entry);
    } else if (m.type === 'rec') {
        saveRec(c, m);
    } else if (m.type === 'chat') {
        if (m.me) c.myName = m.me;
        // the same line reaches every tab on that server: keep it once
        const k = m.server + '|' + m.name + '|' + m.text;
        if (!chat.some(l => l.k === k && Math.abs(l.t - m.t) < 5000)) {
            const line = { k, t: m.t || now(), server: m.server, name: m.name, color: m.color, text: m.text, fromServer: !!m.fromServer, by: c.id };
            chat.push(line); if (chat.length > 300) chat.shift();
            try { fs.appendFileSync(path.join(api.dataDir, 'chat.jsonl'), JSON.stringify(line) + String.fromCharCode(10)); } catch (_) { }
        }
    } else if (m.type === 'chatraw') {
        api.log('chat packet sample: ' + m.hex);
    } else if (m.type === 'lbraw') {
        api.log('leaderboard packet sample: ' + m.hex);
    } else if (m.type === 'lb') {
        // the game's leaderboard as one tab sees it: names top-down and our place (0 = not on it)
        c.lb = { t: now(), names: m.names || [], pos: m.pos || 0, me: m.me || '' };
        if (!c.lbSavedAt || now() - c.lbSavedAt > 30000 || m.pos) {
            c.lbSavedAt = now();
            try { fs.appendFileSync(path.join(api.dataDir, 'lb.jsonl'), JSON.stringify({ t: now(), who: c.name, label: c.label || '', ...c.lb }) + String.fromCharCode(10)); } catch (_) { }
        }
    } else if (m.type === 'lists') {
        setListsAll({ friends: m.friends, enemies: m.enemies, vipName: m.vipName, vipMode: m.vipMode }, c);
    } else if (m.type === 'obs') {
        saveObs(c, m);
    } else if (m.type === 'relay') {
        saveRelay(c, m);
    } else if (m.type === 'death') {
        c.deaths++;
        if (c.kind === 'arena' && arena.bots.has(c.name)) { const st = arena.stats.get(c.name); if (st) st.deaths++; }
        saveDeath(c, m.death);
    } else if (m.type === 'squad') {
        // multibox: pass a member's state on to the other members of its squad (other tabs / arena bots)
        c.squad = m.squad;
        for (const o of clients.values())
            if (o !== c && o.squad === m.squad && o.ws.readyState === 1) try { o.ws.send(raw); } catch (_) { }
    } else if (m.type === 'reply') {
        const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); }
        if (m.cfg) c.cfg = m.cfg;
        if (m.key) { c.cfg = c.cfg || {}; c.cfg[m.key] = m.value; }
    }
}

// ------------------------------------------------------------------ http + bridge
async function onHttp(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    // same file under a .user.js name, so Tampermonkey/Violentmonkey offer to install it
    if (url.pathname === '/megabot.js' || url.pathname === '/sigmally-mega-bot.user.js') {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        return res.end(fs.readFileSync(paths().userscript, 'utf8'));
    }
    // the arena viewer: what each arena bot says it's doing, by name
    if (url.pathname === '/arena/modes') {
        const out = {};
        for (const c of clients.values()) if (c.kind === 'arena' && c.snap) out[c.name] = { mode: c.snap.mode || '', label: c.label || '', mass: c.snap.mass || 0, danger: c.snap.danger || 0 };
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ status: arena.status, compare: arena.compare ? { setting: arena.compare.setting, endsAt: arena.compare.endsAt } : null, bots: out }));
    }
    if (url.pathname === '/inject.js') {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        return res.end(`(async () => {
  if (!window.megaBot) { const src = await (await fetch('http://127.0.0.1:${PORT}/megabot.js')).text(); (0, eval)(src); }
  return 'Mega Bot loaded; reconnecting game sockets: ' + window.megaBot.reconnect();
})()`);
    }
    if (url.pathname === '/render') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        const svg = renderCache.get(url.searchParams.get('t')) || '';
        return res.end(`<!doctype html><html><body style="margin:0;background:#0b0f17">${svg}</body></html>`);
    }
    if (url.pathname === '/health') return res.end('ok');
    // for the Tab status gadget: every game tab's script version and whether it answers commands
    // (only local processes: a web page sends an Origin header)
    if (url.pathname === '/tabs' || url.pathname === '/tabs/swap') {
        if (req.headers.origin) { res.statusCode = 403; return res.end('local only'); }
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname === '/tabs/swap') {
            const c = clients.get(+url.searchParams.get('id'));
            if (!c) return res.end(JSON.stringify({ ok: false, error: 'no such tab' }));
            const r = await command(c, { cmd: 'eval', code: `window.__megaHandoff = true; const s = document.createElement('script'); s.src = 'http://127.0.0.1:${PORT}/megabot.js?' + Date.now(); document.head.appendChild(s); return 'swapping';` });
            return res.end(JSON.stringify(r.ok ? { ok: true } : { ok: false, error: r.error }));
        }
        let latest = '';
        try { latest = (/const VERSION = '([^']+)'/.exec(fs.readFileSync(paths().userscript, 'utf8')) || [])[1] || ''; } catch (_) { }
        const tabs = await Promise.all([...clients.values()].map(async c => {
            const t0 = now();
            const r = await command(c, { cmd: 'eval', code: `return JSON.stringify({ v: window.megaBot && window.megaBot.version, ua: navigator.userAgent, hidden: document.hidden })` });
            let info = {}; try { info = r.ok ? JSON.parse(r.result) : {}; } catch (_) { }
            return { id: c.id, name: c.name, kind: c.kind, hello: c.version || '', version: info.v || c.version || '', answers: !!r.ok, ms: now() - t0,
                ua: info.ua || c.ua || '', hidden: !!info.hidden, mode: c.snap ? c.snap.mode : '', mass: c.snap ? c.snap.mass : 0, bot: c.snap ? c.snap.bot : null,
                lastSeen: c.lastSeen, connectedAt: c.connectedAt };
        }));
        return res.end(JSON.stringify({ latest, t: now(), tabs }));
    }
    // for the Friends & foes gadget (local processes only): the lists, names to pick from, and changing them
    if (url.pathname === '/lists' || url.pathname === '/lists/set') {
        if (req.headers.origin) { res.statusCode = 403; return res.end('local only'); }
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname === '/lists/set') { try { setListsAll(JSON.parse(url.searchParams.get('data') || '{}'), null); } catch (e) { return res.end(JSON.stringify({ ok: false, error: e.message })); } }
        return res.end(JSON.stringify({ ok: true, ...lists, seen: seenNames(), tabs: [...clients.values()].filter(c => c.kind === 'browser').length }));
    }
    // for the Chat brain gadget (local processes only): recent chat + what happened in the game, and saying something
    if (url.pathname === '/chat' || url.pathname === '/chat/send') {
        if (req.headers.origin) { res.statusCode = 403; return res.end('local only'); }
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname === '/chat/send') {
            const c = clients.get(+url.searchParams.get('id'));
            if (!c) return res.end(JSON.stringify({ ok: false, error: 'no such tab' }));
            const r = await command(c, { cmd: 'chat', text: url.searchParams.get('text') || '' });
            return res.end(JSON.stringify(r));
        }
        const since = +url.searchParams.get('since') || 0;
        const tabs = [...clients.values()].filter(c => c.kind === 'browser').map(c => ({ id: c.id, name: c.myName || '', mode: c.snap ? c.snap.mode : '', mass: c.snap ? c.snap.mass : 0, bot: c.snap ? c.snap.bot : null, deaths: c.deaths, peak: c.peak }));
        const events = [
            ...deaths.filter(d => d.t > since && d.kind === 'browser').map(d => ({ t: d.t, what: 'one of us died: ' + d.cause + ' (had ' + d.mass + ' mass)' })),
            ...teamlog.filter(r => r.t > since && (r.killed || 0) > 300).map(r => ({ t: r.t, what: 'our team ' + r.kind + ': killed ' + r.killed + ' mass' })),
        ].sort((a, b) => a.t - b.t).slice(-30);
        return res.end(JSON.stringify({ t: now(), lines: chat.filter(l => l.t > since).map(({ k, ...l }) => l), events, tabs }));
    }
    res.statusCode = 404; res.end('not found');
}

async function startBridge() {
    const require = createRequire(path.join(api.dir, 'backend.mjs'));
    const { WebSocketServer } = require('ws');
    server = http.createServer((q, s) => onHttp(q, s).catch(e => { s.statusCode = 500; s.end(String(e)); }));
    // only Sigmally pages (any subdomain) and local processes without an Origin (arena bots)
    wss = new WebSocketServer({ server, verifyClient: ({ origin }) => !origin || origin === 'null' || /^https?:\/\/([a-z0-9-]+\.)*sigmally\.com$/i.test(origin) });
    wss.on('connection', ws => {
        const c = { id: nextId++, ws, kind: 'browser', name: 'connecting…', label: '', connectedAt: now(), lastSeen: now(), snap: null, events: [], massHist: [], deaths: 0, peak: 0, cfg: null };
        clients.set(c.id, c);
        ws.on('message', d => onMessage(c, d.toString()));
        ws.on('close', () => { clients.delete(c.id); if (focus === c.id) focus = pickFocus(); emitClients(); });
        ws.on('error', () => { });
    });
    await new Promise((resolve) => {
        server.once('error', e => { api.log(`bridge could not listen on ${PORT}: ${e.message}`); resolve(); });
        server.listen(PORT, '127.0.0.1', () => { api.log(`bridge listening on ws://127.0.0.1:${PORT}`); resolve(); });
    });
}

// ------------------------------------------------------------------ pictures for tools
// Drawn in-process (SVG -> PNG with resvg). Prism's page capture is deliberately not used: calling it
// from this gadget brought Prism down.
let resvg = null;
async function picture(snap, opts = {}) {
    const W = opts.width || 900, H = opts.height || 600;
    const svg = renderMod.renderSnapshot(snap, { ...opts, width: W, height: H });
    if (!resvg) resvg = createRequire(path.join(api.dir, 'backend.mjs'))('@resvg/resvg-js').Resvg;
    const png = new resvg(svg, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng();
    return { mime: 'image/png', base64: Buffer.from(png).toString('base64') };
}

// ------------------------------------------------------------------ arena
function arenaState() {
    const groups = new Map();
    for (const st of arena.stats.values()) {
        const g = groups.get(st.label) || { label: st.label, bots: 0, avgMass: 0, deaths: 0, peak: 0, samples: 0 };
        g.bots++; g.avgMass += st.n ? st.sum / st.n : 0; g.deaths += st.deaths; g.peak = Math.max(g.peak, st.peak); g.samples += st.n;
        groups.set(st.label, g);
    }
    const minutes = arena.startedAt ? (now() - arena.startedAt) / 60000 : 0;
    const gl = [...groups.values()].map(g => ({ ...g, avgMass: Math.round(g.avgMass / Math.max(1, g.bots)),
        topAvg: arena.top.get(g.label) ? Math.round(arena.top.get(g.label).sum / Math.max(1, arena.top.get(g.label).n)) : 0,
        deathsPerMin: minutes ? +(g.deaths / g.bots / minutes).toFixed(2) : 0 }));
    return { status: arena.status, startedAt: arena.startedAt, opts: arena.opts, board: arena.board, groups: gl,
        bots: [...arena.bots.keys()], compare: arena.compare, log: arena.log.slice(-15) };
}
function arenaLog(line) { arena.log.push(`${new Date().toLocaleTimeString()} ${line}`); if (arena.log.length > 200) arena.log.shift(); }

// Each start/stop bumps the generation; anything from an older generation (a bot's exit handler,
// a late snapshot) is ignored, so old bots can't respawn into, or score in, a new arena.
function spawnBot(name, label, cfg, gen) {
    const p = paths();
    const proc = api.spawn(process.execPath, [path.join(p.lib, 'headless-bot.cjs'), '--server', `ws://127.0.0.1:${ARENA_PORT}`,
        '--script', p.userscript, '--name', name, '--label', label, '--cfg', JSON.stringify(cfg), '--lab', `ws://127.0.0.1:${PORT}`], {
        env: nodeEnv(),
        onData: (chunk, stream) => { if (stream === 'stderr') arenaLog(`${name}: ${String(chunk).trim().slice(0, 200)}`); },
        onExit: () => {
            if (arena.gen !== gen) return;
            arena.bots.delete(name);
            // keep the arena populated: a bot that crashed or got disconnected comes back
            if (arena.status === 'running') setTimeout(() => {
                if (arena.gen === gen && arena.status === 'running' && !arena.bots.has(name)) arena.bots.set(name, spawnBot(name, label, cfg, gen));
            }, 1500);
        },
    });
    return proc;
}

function spawnHunter(name, count, team, gen) {
    const p = paths();
    return api.spawn(process.execPath, [path.join(p.lib, 'hunter-bot.cjs'), '--server', `ws://127.0.0.1:${ARENA_PORT}`, '--name', name,
        '--count', String(count), '--team', team ? '1' : '0'], {
        env: nodeEnv(),
        onData: (chunk, stream) => { if (stream === 'stderr') arenaLog(`${name}: ${String(chunk).trim().slice(0, 200)}`); },
        onExit: () => { if (arena.gen === gen && arena.status === 'running') arenaLog(`${name} stopped`); },
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// resolves once nothing is listening on the port any more (or after `ms`)
async function portFree(port, ms = 6000) {
    const net = await import('node:net');
    const end = now() + ms;
    while (now() < end) {
        const free = await new Promise(res => {
            const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true)));
            s.listen(port);
        });
        if (free) return true;
        await sleep(200);
    }
    return false;
}

async function startArena(opts = {}) {
    await stopArena();
    const p = paths();
    if (!fs.existsSync(path.join(p.sig, 'src', 'ServerHandle.js'))) throw new Error(`can't find the Sigmally server code at ${p.sig}`);
    if (!(await portFree(ARENA_PORT))) throw new Error(`port ${ARENA_PORT} is still in use by something else`);
    const o = { serverBots: 10, maxCells: 8, groups: [{ label: 'default', cfg: {}, count: 2 }], ...opts };
    const gen = ++arena.gen;
    arena.opts = o; arena.stats.clear(); arena.top.clear(); arena.board = []; arena.status = 'starting'; arena.startedAt = 0;
    emitArena();
    let buf = '';
    const ready = new Promise((resolve, reject) => {
        arena.ready = { resolve, reject };
        setTimeout(() => reject(new Error('arena server did not start in 15 s')), 15000);
    });
    arena.server = api.spawn(process.execPath, [path.join(p.lib, 'arena-server.cjs'), '--sig', p.sig, '--port', String(ARENA_PORT),
        '--bots', String(o.serverBots), '--maxCells', String(o.maxCells)], {
        env: nodeEnv(),
        onData: (chunk, stream) => {
            if (stream === 'stderr') { arenaLog(String(chunk).trim().slice(0, 300)); return; }
            buf += chunk;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i); buf = buf.slice(i + 1);
                try {
                    const m = JSON.parse(line);
                    if (m.type === 'ready') arena.ready?.resolve();
                    else if (m.type === 'board') { arena.board = m.players; emitArena(); }
                } catch (_) { }
            }
        },
        onExit: code => {
            arenaLog(`server stopped (${code})`);
            arena.ready?.reject(new Error(`arena server stopped (${code}) — see the arena log`));
            if (arena.gen === gen && arena.status !== 'off') {
                arena.status = 'off';
                for (const b of [...arena.bots.values(), ...(arena.hunters || [])]) try { b.kill(); } catch (_) { }
                arena.bots.clear(); arena.hunters = [];
                emitArena();
            }
        },
    });
    try { await ready; } catch (e) { arena.status = 'off'; emitArena(); throw e; }
    arena.ready = null;
    o.groups.forEach((g, gi) => {
        for (let i = 1; i <= (g.count || 1); i++) {
            // one letter per group (A1, A2, B1…) so names never clash
            const name = `Mega-${o.groups.length > 1 ? String.fromCharCode(65 + gi) : ''}${i}`;
            // squads (multibox): bots of a group with multibox on team up, squadSize at a time (default: the whole group)
            const per = g.squadSize || g.count || 1;
            arena.bots.set(name, spawnBot(name, g.label, { maxCells: o.maxCells, multibox: false, squad: `arena-${gen}-${gi}-${Math.floor((i - 1) / per)}`, ...g.cfg }, gen));
        }
    });
    // human-style players: solo hunters and two-player teams (double splits, W-bait, feeding, tricksplits)
    arena.hunters = [];
    for (let i = 1; i <= (o.hunters || 0); i++) arena.hunters.push(spawnHunter(`Hunter${i}`, 1, false, gen));
    for (let i = 1; i <= (o.hunterTeams || 0); i++) arena.hunters.push(spawnHunter(`Team${i}`, 2, true, gen));
    arena.status = 'running'; arena.startedAt = now();
    arenaLog(`arena running: ${o.serverBots} server bots, ${arena.bots.size} Mega Bots, ${o.hunters || 0} hunters, ${o.hunterTeams || 0} hunter teams, piece limit ${o.maxCells}`);
    emitArena();
    return arenaState();
}
async function stopArena() {
    arena.gen++;
    const procs = [...arena.bots.values(), ...(arena.hunters || [])];
    arena.hunters = [];
    if (arena.server) procs.push(arena.server);
    arena.status = 'off';
    arena.bots.clear();
    arena.server = null;
    if (!procs.length) return;
    for (const pr of procs) try { pr.kill(); } catch (_) { }
    // wait for them to really be gone (and the port released) before anything restarts
    await Promise.race([Promise.all(procs.map(pr => pr.exited).filter(Boolean)), sleep(4000)]);
    await portFree(ARENA_PORT, 4000);
    emitArena();
}

// Compare values of one setting: a group of bots per value, same server, same time; score by
// average mass over the run (time spent dead counts as 0), deaths per minute, and peak mass.
async function compare({ setting, values, botsPerValue = 3, minutes = 3, serverBots = 10, maxCells = 16, hunters = 0, hunterTeams = 0, cfg = {}, squadSize = 0 }) {
    if (!setting || !Array.isArray(values) || !values.length) throw new Error('give a setting and a list of values');
    // cfg: settings for every group (e.g. multibox on); squadSize: bots of a group team up this many at a time
    if (squadSize > 1) cfg = { multibox: true, ...cfg };
    const groups = values.map(v => ({ label: `${setting}=${JSON.stringify(v)}`, cfg: { ...cfg, [setting]: v }, count: botsPerValue, squadSize: squadSize > 1 ? squadSize : 0 }));
    arena.compare = { setting, values, botsPerValue, minutes, endsAt: now() + minutes * 60000, results: null };
    try { await startArena({ serverBots, maxCells, groups, hunters, hunterTeams }); }
    catch (e) { arena.compare = { ...arena.compare, error: e.message }; emitArena(); throw e; }
    arena.compare.endsAt = now() + minutes * 60000;
    emitArena();
    const gen = arena.gen;
    const t = setTimeout(async () => {
        if (arena.gen !== gen) { arena.compare = { ...arena.compare, error: 'cancelled: the arena was stopped or restarted' }; emitArena(); return; }
        const st = arenaState();
        const results = st.groups.sort((a, b) => b.avgMass - a.avgMass);
        arena.compare.results = results;
        arena.compare.finishedAt = now();
        await stopArena();
        arena.compare = { ...arena.compare };
        api.state.set('lastCompare', arena.compare);
        emitArena();
    }, minutes * 60000);
    timers.push(t);
    return arena.compare;
}

// ------------------------------------------------------------------ text views for tools
function statusText() {
    const lines = [];
    if (!clients.size) lines.push('No game connected. Open one.sigmally.com with the Mega Bot userscript (lab setting on), or start the arena.');
    for (const c of clients.values())
        lines.push(`#${c.id} ${c.kind === 'arena' ? 'arena bot' : 'game'} "${c.name}"${c.label ? ' [' + c.label + ']' : ''}${c.id === focus ? ' (focused)' : ''}: ` +
            (c.snap ? `${c.snap.mode || '—'}, mass ${c.snap.mass}, ${c.snap.pieces} piece(s), danger ${c.snap.danger}, bot ${c.snap.bot ? 'on' : 'off'}, ping ${c.snap.rtt}ms` : 'no data yet') +
            `; deaths ${c.deaths}, peak ${c.peak}` + (c.recFrames ? `; RECORDING (${c.recFrames} frames)` : ""));
    lines.push(`Arena: ${arena.status}${arena.status === 'running' ? ` for ${Math.round((now() - arena.startedAt) / 1000)} s, ${arena.bots.size} Mega Bots` : ''}`);
    lines.push(`Deaths recorded: ${deaths.length}${deaths[0] ? `; last: ${deaths[0].cause} (${deaths[0].client}, ${deaths[0].mass} mass)` : ''}`);
    const lbs = [...clients.values()].filter(c => c.lb && now() - c.lb.t < 30000);
    if (lbs.length) {
        const best = lbs.reduce((a, c) => (c.lb.pos && (!a || c.lb.pos < a.lb.pos)) ? c : a, null);
        lines.push(`Leaderboard: ${best ? `our best place #${best.lb.pos} (#${best.id})` : 'none of us on it'}; top: ${lbs[0].lb.names.slice(0, 10).join(', ')}`);
    }
    return lines.join('\n');
}

// ------------------------------------------------------------------ module
export default {
    async start(a) {
        api = a;
        const src = fs.readFileSync(path.join(api.dir, 'render.js'), 'utf8');
        const holder = {};
        new Function('globalThis', 'window', src)(holder, holder);
        renderMod = holder.SigRender;
        loadDeaths();
        loadTeamlog();
        await startBridge();
        lists = cleanLists((await api.state.get('lists', null)) || {});
        const last = await api.state.get('lastCompare', null);
        if (last) arena.compare = last;
        timers.push(setInterval(emitClients, 1000));
    },
    async stop() {
        for (const t of timers) { clearInterval(t); clearTimeout(t); }
        await stopArena();
        for (const c of clients.values()) try { c.ws.close(); } catch (_) { }
        try { wss && wss.close(); } catch (_) { }
        try { server && server.close(); } catch (_) { }
    },
    handlers: {
        async state() {
            const c = clients.get(focus);
            return { clients: [...clients.values()].map(summary), focus, snap: c ? c.snap : null, events: c ? c.events.slice(-40) : [],
                massHist: c ? c.massHist : [], deaths: deaths.slice(0, 200), arena: arenaState(), cfg: c ? c.cfg : null, port: PORT };
        },
        async focus({ id }) {
            if (clients.has(+id)) focus = +id;
            emitClients();
            const c = clients.get(focus);
            return { focus, snap: c ? c.snap : null, events: c ? c.events.slice(-40) : [], massHist: c ? c.massHist : [], cfg: c ? c.cfg : null };
        },
        async death({ file }) { return readDeath(file); },
        async setCfg({ key, value, target }) {
            const out = [];
            for (const c of resolveTargets(target)) out.push({ client: c.name, ...(await command(c, { cmd: 'set', key, value })) });
            return out;
        },
        async getCfg({ target }) {
            const c = resolveTargets(target)[0];
            if (!c) return { ok: false, error: 'no game connected' };
            const r = await command(c, { cmd: 'get' });
            if (r.cfg) c.cfg = r.cfg;
            return r;
        },
        async bot({ on, target }) {
            const out = [];
            for (const c of resolveTargets(target)) out.push({ client: c.name, ...(await command(c, { cmd: 'bot', on })) });
            return out;
        },
        async respawn({ target }) { const c = resolveTargets(target)[0]; return c ? command(c, { cmd: 'respawn' }) : { ok: false }; },
        async arenaStart(opts) { return startArena(opts || {}); },
        async arenaStop() { await stopArena(); return arenaState(); },
        async arenaState() { return arenaState(); },
        async compare(opts) { return compare(opts); },
        async teamlog(args) { return teamlogData(args || {}); },
    },
    tools: [
        { name: 'lab_status', description: 'Which games and arena bots are connected to the Sigmally Lab, what each is doing (mode, mass, pieces, danger), arena status and the last recorded death.',
            parameters: { type: 'object', properties: {} },
            async execute() { return statusText(); } },
        { name: 'lab_view', description: 'A picture of what the Mega Bot currently sees in a game (default: the focused one), plus a text summary of nearby threats and prey.',
            parameters: { type: 'object', properties: { client: { type: 'string', description: 'client id or name; default the focused game' } } },
            async execute({ client }) {
                const c = resolveTargets(client ?? 'focus')[0];
                if (!c || !c.snap) return { content: 'No game data yet. ' + statusText(), isError: true };
                const img = await picture(c.snap);
                const ev = c.events.slice(-6).map(e => `  ${new Date(e.t).toLocaleTimeString()} ${e.text}`).join('\n');
                return { content: `${c.name}: ${renderMod.describeSnapshot(c.snap)}\nRecent events:\n${ev || '  none'}`, images: [img] };
            } },
        { name: 'lab_teamlog', description: 'The team journal: every multibox team action (split into teammate, dive, defend split, DNA relay, feeding, collecting pieces, kill with cover) with what it achieved a few seconds later — success rate per action type, mass moved into/out of the teammate, mass lost to enemies, and the most recent entries.',
            parameters: { type: 'object', properties: { minutes: { type: 'number', description: 'look back this many minutes (default 30)' },
                kind: { type: 'string', description: 'only actions whose name contains this text, e.g. "split into", "DNA", "feed"' },
                limit: { type: 'number', description: 'how many recent entries to list (default 15)' } } },
            async execute(args) { return teamlogReport(args || {}); } },
        { name: 'lab_deaths', description: 'Recorded Mega Bot deaths (newest first) with cause, mass lost and which game. Use lab_replay to look at one.',
            parameters: { type: 'object', properties: { limit: { type: 'number' }, kind: { type: 'string', enum: ['browser', 'arena', 'all'] } } },
            async execute({ limit = 20, kind = 'all' }) {
                const list = deaths.filter(d => kind === 'all' || d.kind === kind).slice(0, limit);
                if (!list.length) return 'No deaths recorded yet.';
                const causes = {};
                for (const d of deaths) { const k = d.cause.replace(/ (by|teamer) .*/, ' $1 …'); causes[k] = (causes[k] || 0) + 1; }
                return list.map(d => `${d.file}: ${new Date(d.t).toLocaleString()} ${d.client} — ${d.cause}, had ${d.mass} mass`).join('\n') +
                    '\n\nBy cause (all recorded): ' + Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
            } },
        { name: 'lab_replay', description: 'Replay a recorded death: a picture of one frame (default: the last frame before death) and a timeline of the last 10 seconds (mode, danger, nearest threats).',
            parameters: { type: 'object', properties: { death: { type: 'string', description: 'death file name from lab_deaths; default the latest' },
                frame: { type: 'number', description: 'frame index, negative counts from the end (-1 = last)' } } },
            async execute({ death, frame = -1 }) {
                const d = readDeath(death);
                if (!d) return { content: 'No such death recorded.', isError: true };
                const fr = d.frames || [];
                if (!fr.length) return `${d.cause}: no frames were recorded.`;
                const i = frame < 0 ? Math.max(0, fr.length + frame) : Math.min(fr.length - 1, frame);
                const t0 = fr[fr.length - 1].t;
                const timeline = fr.filter((_, j) => j % 5 === 4 || j >= fr.length - 5)
                    .map(f => `  ${((f.t - t0) / 1000).toFixed(1)}s: ${renderMod.describeSnapshot(f)}`).join('\n');
                const img = await picture(fr[i], { caption: `${d.cause} — frame ${i + 1}/${fr.length} (${((fr[i].t - t0) / 1000).toFixed(1)} s)` });
                return { content: `${d.client}: ${d.cause}. Had ${d.massBefore} mass. Killer: ${d.killer ? JSON.stringify(d.killer) : 'unknown'}. Modes in the last 2 s: ${(d.modesBefore || []).join(', ')}\nTimeline:\n${timeline}`, images: [img] };
            } },
        { name: 'lab_set', description: 'Change a Mega Bot setting live (no reload) in a game or arena bots. Example: key "dangerWeight", value 4.',
            parameters: { type: 'object', properties: { key: { type: 'string' }, value: {}, target: { type: 'string', description: "'focus' (default), 'all', 'browser', 'arena', or a client id/name" } }, required: ['key', 'value'] },
            async execute({ key, value, target }) {
                const tg = resolveTargets(target);
                if (!tg.length) return { content: 'No game connected.', isError: true };
                const out = [];
                for (const c of tg) out.push(`${c.name}: ${JSON.stringify(await command(c, { cmd: 'set', key, value }))}`);
                return out.join('\n');
            } },
        { name: 'lab_config', description: 'Current Mega Bot settings in a game (and their defaults).',
            parameters: { type: 'object', properties: { target: { type: 'string' } } },
            async execute({ target }) {
                const c = resolveTargets(target)[0];
                if (!c) return { content: 'No game connected.', isError: true };
                const r = await command(c, { cmd: 'get' });
                if (!r.ok) return { content: r.error || 'no answer', isError: true };
                c.cfg = r.cfg;
                return Object.entries(r.cfg).filter(([k]) => k !== 'keys').map(([k, v]) => `${k} = ${JSON.stringify(v)}${JSON.stringify(r.defaults?.[k]) !== JSON.stringify(v) ? `  (default ${JSON.stringify(r.defaults?.[k])})` : ''}`).join('\n');
            } },
        { name: 'lab_bot', description: 'Turn the Mega Bot autopilot on or off in a game.',
            parameters: { type: 'object', properties: { on: { type: 'boolean' }, target: { type: 'string' } }, required: ['on'] },
            async execute({ on, target }) {
                const out = [];
                for (const c of resolveTargets(target)) out.push(`${c.name}: ${JSON.stringify(await command(c, { cmd: 'bot', on }))}`);
                return out.join('\n') || 'No game connected.';
            } },
        { name: 'lab_eval', description: 'Run JavaScript inside a connected game page with megaBot, CFG and GAME in scope; returns the result as text. For debugging the bot.',
            parameters: { type: 'object', properties: { code: { type: 'string', description: 'function body; use return' }, target: { type: 'string' } }, required: ['code'] },
            async execute({ code, target }) {
                const c = resolveTargets(target)[0];
                if (!c) return { content: 'No game connected.', isError: true };
                const r = await command(c, { cmd: 'eval', code });
                return r.ok ? r.result : { content: r.error || 'failed', isError: true };
            } },
        { name: 'lab_inject_info', description: 'How to load the Mega Bot into a page that does not have the userscript (e.g. Prism\'s browser): returns the JS to run there with browser_eval.',
            parameters: { type: 'object', properties: {} },
            async execute() {
                return `Run in the game page (browser_eval):\n(async () => { if (!window.megaBot) { const s = await (await fetch('http://127.0.0.1:${PORT}/megabot.js')).text(); (0, eval)(s); } return window.megaBot.reconnect(); })()\n` +
                    'It loads the current userscript, then closes the game socket so the client reconnects through the bot. The game then shows up in lab_status.';
            } },
        { name: 'arena_start', description: 'Start the local arena: the real Sigmally server code on 127.0.0.1 with server bots and headless Mega Bots running the current userscript.',
            parameters: { type: 'object', properties: { serverBots: { type: 'number' }, megaBots: { type: 'number' }, maxCells: { type: 'number' },
                cfg: { type: 'object', description: 'setting overrides for the Mega Bots' },
                squadSize: { type: 'number', description: 'multibox: Mega Bots team up in squads of this many (0 = every bot for itself)' },
                hunters: { type: 'number', description: 'human-style solo hunters (double splits, W-bait)' }, hunterTeams: { type: 'number', description: 'human-style two-player teams' } } },
            async execute({ serverBots = 10, megaBots = 2, maxCells = 8, cfg = {}, squadSize = 0, hunters = 0, hunterTeams = 0 }) {
                if (squadSize > 1) cfg = { multibox: true, ...cfg };
                const st = await startArena({ serverBots, maxCells, hunters, hunterTeams, groups: [{ label: 'default', cfg, count: megaBots, squadSize: squadSize > 1 ? squadSize : 0 }] });
                return `Arena running with ${serverBots} server bots and ${st.bots.length} Mega Bots (piece limit ${maxCells}). They appear in lab_status in a few seconds.`;
            } },
        { name: 'arena_stop', description: 'Stop the local arena and all its bots.', parameters: { type: 'object', properties: {} },
            async execute() { await stopArena(); return 'Arena stopped.'; } },
        { name: 'arena_board', description: 'Arena leaderboard (server bots and Mega Bots) and per-group results so far: average mass (dead time counts as 0), deaths per minute, peak.',
            parameters: { type: 'object', properties: {} },
            async execute() {
                const st = arenaState();
                const board = st.board.slice(0, 15).map((p, i) => `${i + 1}. ${p.name}${p.bot ? ' (server bot)' : ''}: ${p.mass} mass, ${p.cells} piece(s)`).join('\n');
                const groups = st.groups.map(g => `${g.label || 'default'}: ${g.bots} bots, avg mass ${g.avgMass}, deaths/min ${g.deathsPerMin}, peak ${g.peak}`).join('\n');
                return `Arena ${st.status}${st.startedAt ? ` (${Math.round((now() - st.startedAt) / 1000)} s)` : ''}\n${board || 'no players yet'}\n\nGroups:\n${groups || 'none'}` +
                    (st.compare ? `\n\nComparison of ${st.compare.setting}: ${st.compare.results ? 'finished' : 'running, ends ' + new Date(st.compare.endsAt).toLocaleTimeString()}` : '');
            } },
        { name: 'arena_compare', description: 'Compare values of one Mega Bot setting in the arena: a group of bots per value playing at the same time for N minutes, then ranked by average mass (dead time = 0), deaths/min and peak. Returns immediately; read results with arena_results.',
            parameters: { type: 'object', properties: { setting: { type: 'string' }, values: { type: 'array', items: {} }, botsPerValue: { type: 'number' }, minutes: { type: 'number' },
                serverBots: { type: 'number' }, maxCells: { type: 'number' },
                hunters: { type: 'number', description: 'human-style solo hunters (double splits, W-bait)' }, hunterTeams: { type: 'number', description: 'human-style two-player teams' },
                cfg: { type: 'object', description: 'settings for every group (e.g. {"fastTravel":false})' }, squadSize: { type: 'number', description: 'multibox: bots of a group team up this many at a time (default solo)' } }, required: ['setting', 'values'] },
            async execute(args) {
                const c = await compare(args);
                return `Comparing ${c.setting} = ${c.values.map(v => JSON.stringify(v)).join(' / ')} with ${c.botsPerValue} bots each for ${c.minutes} min (ends ${new Date(c.endsAt).toLocaleTimeString()}). Use arena_results then.`;
            } },
        { name: 'arena_results', description: 'Results of the latest arena comparison (or progress if it is still running).',
            parameters: { type: 'object', properties: {} },
            async execute() {
                const c = arena.compare;
                if (!c) return 'No comparison has been run yet.';
                if (c.error) return `The comparison of ${c.setting} didn't finish: ${c.error}`;
                if (!c.results) { const st = arenaState(); return `Still running (ends ${new Date(c.endsAt).toLocaleTimeString()}). So far:\n` + st.groups.map(g => `${g.label}: team top ${g.topAvg} (biggest bot over time), avg mass ${g.avgMass}, deaths/min ${g.deathsPerMin}, peak ${g.peak}`).join('\n'); }
                return `${c.setting}, ${c.minutes} min, ${c.botsPerValue} bots per value (best first):\n` +
                    c.results.map((g, i) => `${i + 1}. ${g.label}: team top ${g.topAvg} (biggest bot over time), avg mass ${g.avgMass}, deaths/min ${g.deathsPerMin}, peak ${g.peak}`).join('\n');
            } },
    ],
};
