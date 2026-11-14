// How we die: reads the death recordings the Sigmally Lab keeps (LAB_DATA, else the Lab's gadget data folder),
// newest first, and summarises what kills our bots: causes, killers, mass lost and the trend over the window.
// Each recording is parsed once and cached (also to the data folder), so repeated windows and restarts are cheap.
import fs from 'node:fs';
import path from 'node:path';

const LAB = 'http://127.0.0.1:47800';
const PARSE_CAP = 3000;              // recordings parsed per scan at most (files average ~150 KB)
let api, saveTimer = null;
const cache = new Map();             // file -> summary record (false = unreadable)

const deathsDir = () => process.env.LAB_DATA
    ? path.join(process.env.LAB_DATA, 'deaths')
    : path.join(process.env.APPDATA || process.env.USERPROFILE || '', 'prism', 'gadget-data', 'sigmally-lab', 'deaths');
const cacheFile = () => path.join(api.dataDir, 'deaths-cache.json');
const spanOf = h => h * 3600e3;
const fmt = n => n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

function parseOne(dir, f) {
    try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const k = d.killer || {};
        return {
            t: d.t || +String(f).split('-')[0] || 0, kind: d.kind || 'browser', client: d.client || '',
            cause: d.cause || '?', mass: d.massBefore || 0, mate: /teammate|master/.test(d.cause || ''),
            killer: k.name ? { name: k.name, bot: !!k.bot, teamer: !!k.teamer } : null,
        };
    } catch (_) { return null; }
}

// "eaten by Goku 42" -> "eaten by …"; numbers -> #
const norm = s => (s || '?').replace(/ by (?:teamer )?.+$/, ' by …').replace(/\d+/g, '#').replace(/ +/g, ' ').trim();

function summarize(hours, kind) {
    const dir = deathsDir();
    if (!fs.existsSync(dir))
        return { error: `no death recordings found (${dir}) - the Sigmally Lab writes them while a game runs` };
    const since = Date.now() - spanOf(hours);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
    const rows = [];
    let parsed = 0, truncated = false;
    for (const f of files) {
        const t = +String(f).split('-')[0] || 0;
        if (t < since) break;
        let r = cache.get(f);
        if (r === undefined) {
            if (parsed >= PARSE_CAP) { truncated = true; break; }
            parsed++;
            r = parseOne(dir, f) || false;
            cache.set(f, r);
        }
        if (r) rows.push(r);
    }
    if (parsed >= 100) scheduleSave();
    const list = rows.filter(r => kind === 'all' || r.kind === kind);
    const masses = list.map(r => r.mass).sort((a, b) => a - b);
    const nb = 12, bl = new Array(nb).fill(0);
    for (const r of list) { const i = Math.floor((r.t - since) / (spanOf(hours) / nb)); if (i >= 0 && i < nb) bl[i]++; }
    const causes = new Map(), killers = new Map();
    for (const r of list) {
        const c = causes.get(norm(r.cause)) || { k: norm(r.cause), n: 0, mass: 0 };
        c.n++; c.mass += r.mass; causes.set(c.k, c);
        if (r.killer && !r.mate) {
            const g = killers.get(r.killer.name) || { name: r.killer.name, kills: 0, mass: 0, last: 0, bot: r.killer.bot, teamer: r.killer.teamer };
            g.kills++; g.mass += r.mass; g.last = Math.max(g.last, r.t); killers.set(r.killer.name, g);
        }
    }
    const foes = list.filter(r => !r.mate);
    const foeMass = foes.map(r => r.mass).sort((a, b) => a - b);
    return {
        t: Date.now(), hours, kind, dir, n: list.length, foeN: foes.length, teamN: list.length - foes.length,
        totalFiles: files.length, truncated, parsedNow: parsed,
        mass: { sum: masses.reduce((a, b) => a + b, 0), med: med(masses), max: masses[masses.length - 1] || 0,
            foeSum: foeMass.reduce((a, b) => a + b, 0), foeMax: foeMass[foeMass.length - 1] || 0 },
        hist: bl.map((n, i) => ({ n, from: since + i * spanOf(hours) / nb })),
        causes: [...causes.values()].sort((a, b) => b.n - a.n).slice(0, 12),
        killers: [...killers.values()].sort((a, b) => b.kills - a.kills).slice(0, 12),
        recent: list.slice(0, 14).map(r => ({ t: r.t, client: r.client, cause: r.cause, mass: r.mass, kind: r.kind })),
    };
}

function reportText(s) {
    if (s.error) return s.error;
    const L = [];
    L.push(`Deaths in the last ${s.hours} h (${s.kind === 'all' ? 'game tabs + arena' : 'game tabs only'}): ${s.n} (${s.foeN} to enemies, ${s.teamN} team transfers); mass lost to enemies ${fmt(s.mass.foeSum)} (worst ${s.mass.foeMax}).`);
    if (s.n) {
        L.push('Causes: ' + s.causes.slice(0, 8).map(c => `${c.k} ${c.n}x`).join(', '));
        L.push('Killers: ' + (s.killers.slice(0, 8).map(k => `${k.name} ${k.kills}x (${fmt(k.mass)} mass${k.bot ? ', server bot' : ''}${k.teamer ? ', teamer' : ''})`).join(', ') || 'none named'));
        const peak = s.hist.reduce((a, b) => (b.n > a.n ? b : a), { n: 0 });
        if (peak.n) L.push(`Busiest stretch: hour ${s.hist.indexOf(peak) + 1}/${s.hist.length} of the window, with ${peak.n} deaths.`);
    }
    if (s.truncated) L.push(`(only the newest ${PARSE_CAP} recordings were read for this window)`);
    return L.join('\n');
}

// one click on a killer: add them to the Lab's shared enemy list (read-modify-write so friends and VIP stay)
async function foeAdd(name) {
    try {
        const r = await fetch(LAB + '/lists', { signal: AbortSignal.timeout(6000) });
        const d = await r.json();
        if (!d.ok) return { ok: false, error: 'the Lab answered oddly' };
        if ((d.enemies || []).includes(name)) return { ok: true, note: 'already an enemy' };
        const set = await (await fetch(LAB + '/lists/set?data=' + encodeURIComponent(JSON.stringify({
            friends: d.friends || [], enemies: [...(d.enemies || []), name], vipName: d.vipName || '', vipMode: d.vipMode || '',
        })), { signal: AbortSignal.timeout(6000) })).json();
        return set.ok ? { ok: true, note: 'marked as enemy in every tab' } : set;
    } catch (e) {
        return { ok: false, error: /fetch failed|ECONNREFUSED/.test(String(e.message || e.cause)) ? 'the Sigmally Lab is not running' : String(e.message || e) };
    }
}

function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            fs.mkdirSync(api.dataDir, { recursive: true });
            fs.writeFileSync(cacheFile(), JSON.stringify({ v: 1, recs: [...cache.entries()].filter(([, r]) => r) }));
        } catch (_) { }
    }, 5000);
}

export default {
    async start(a) {
        api = a;
        try {
            const saved = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
            if (saved && Array.isArray(saved.recs)) for (const [f, r] of saved.recs) cache.set(f, r);
            api.log(`death cache: ${cache.size} recordings known`);
        } catch (_) { }
        // warm the common windows in the background so the panel's first click is fast
        setTimeout(() => { try { summarize(24, 'browser'); } catch (_) { } }, 1500);
    },
    async stop() {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        try { fs.writeFileSync(cacheFile(), JSON.stringify({ v: 1, recs: [...cache.entries()].filter(([, r]) => r) })); } catch (_) { }
    },
    handlers: {
        async summary({ hours = 6, kind = 'browser' }) { return summarize(Math.min(24 * 30, Math.max(1, +hours || 6)), kind === 'all' ? 'all' : 'browser'); },
        async foe_add({ name }) {
            if (!name || typeof name !== 'string') return { ok: false, error: 'no name' };
            return foeAdd(name.slice(0, 40));
        },
        async widget(_, ap) {
            const s = summarize(6, 'browser');
            if (s.error) return { title: 'Deaths', value: '?', detail: s.error };
            const top = s.killers[0];
            return { title: 'Deaths', value: String(s.n), detail: `last 6 h · lost ${fmt(s.mass.sum)} mass${top ? ` · top killer ${top.name} (${top.kills}x)` : ''}` };
        },
    },
    tools: [{
        name: 'deaths_report',
        description: 'What killed our bots, from the deaths the Sigmally Lab records: counts, causes, the players who eat us most (with mass they took, server-bot and teamer flags), mass lost and median mass at death.',
        parameters: { type: 'object', properties: {
            hours: { type: 'number', description: 'look back this many hours (default 6, max 720)' },
            kind: { type: 'string', enum: ['browser', 'all'], description: 'browser = our game tabs only (default), all = include arena bots' } } },
        async execute({ hours = 6, kind = 'browser' }) { return reportText(summarize(Math.min(720, Math.max(1, +hours || 6)), kind)); },
    }],
};
