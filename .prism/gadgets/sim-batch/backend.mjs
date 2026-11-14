// Sim batch: run the fast team sims (sim/frsim.js on the real Sigmally server code) over many seeds — optionally two
// userscript versions side by side on the SAME seeds — and compare: everyone alive, team mass, travel vs walking,
// deaths, handoffs, jitter, frozen time. The sim swings a lot between runs, so only same-batch numbers count.
/* v1.0.1 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

let api, run = null;   // the running (or last) batch

const sigDir = () => [process.env.SIG_SERVER, api.root && path.join(api.root, 'sig-server'),
    api.root && path.resolve(api.root, '..', 'sighack_ref', 'sig-server'), api.root && path.resolve(api.root, '..', 'sig-server')]
    .find(p => p && fs.existsSync(path.join(p, 'src', 'ServerHandle.js'))) || null;
const frsimPath = () => api.root ? path.join(api.root, 'sim', 'frsim.js') : null;
const versionOf = f => { try { return (/const VERSION = '([^']+)'/.exec(fs.readFileSync(f, 'utf8')) || [])[1] || ''; } catch (_) { return ''; } };

function scenes() {
    try {
        const req = createRequire(path.join(api.dir, 'backend.mjs'));
        const S = req(path.join(api.root, 'sim', 'rscenes.js'));
        return Object.entries(S).map(([name, sc]) => ({ name, desc: String(sc.desc || '').split('. ')[0] }));
    } catch (e) { return [{ name: '', desc: 'could not load sim/rscenes.js: ' + e.message }]; }
}
function scripts() {
    const la = process.env.LOCALAPPDATA || '';
    const liveDir = la && path.join(la, 'sighack_live');
    const out = [];
    const add = (key, label, p) => { if (p && fs.existsSync(p)) out.push({ key, label, path: p, version: versionOf(p) }); };
    add('live', 'live file', process.env.MEGABOT_USERSCRIPT || (liveDir ? path.join(liveDir, 'sigmally-mega-bot.user.js') : null));
    if (api.root) {
        add('workspace', 'workspace userscript', path.join(api.root, 'userscript', 'sigmally-mega-bot.user.js'));
        add('root', 'workspace root copy', path.join(api.root, 'sigmally-mega-bot.user.js'));
    }
    if (liveDir && fs.existsSync(liveDir))
        for (const f of fs.readdirSync(liveDir).sort().reverse()) {
            const m = /^backup-(.+)\.user\.js$/.exec(f);
            if (m) add('backup ' + m[1], 'backup ' + m[1], path.join(liveDir, f));
            if (out.length >= 14) break;
        }
    return out;
}

const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const travel = r => { const w = (r.walk || []).reduce((x, y) => x + y, 0); return w ? (r.moved || []).reduce((x, y) => x + y, 0) / w : 0; };
function agg(rows) {
    const ok = rows.filter(r => !r.error);
    return {
        n: rows.length, errors: rows.length - ok.length,
        allAlive: ok.filter(r => r.alive === r.of).length,
        team: Math.round(avg(ok.map(r => r.team || 0))),
        travel: +avg(ok.map(travel)).toFixed(2),
        deaths: ok.filter(r => r.death).length,
        handoffs: +avg(ok.map(r => r.handoffs || 0)).toFixed(1),
        splits: +avg(ok.map(r => r.splits || 0)).toFixed(1),
        jitter: +avg(ok.map(r => avg(r.jitter || []))).toFixed(1),
        frozen: +avg(ok.map(r => avg(r.frozen || []))).toFixed(1),
        perSeed: Object.fromEntries(ok.map(r => [r.seed, { team: r.team || 0, alive: r.alive, of: r.of }])),
    };
}
function aggregate() {
    const out = [];
    for (const [scene, sides] of Object.entries(run.results)) {
        const A = sides.A ? agg(sides.A) : null, B = sides.B ? agg(sides.B) : null;
        let pair = null;
        if (A && B) {
            const deltas = [];
            for (const [seed, ra] of Object.entries(A.perSeed)) { const rb = B.perSeed[seed]; if (rb) deltas.push(rb.team - ra.team); }
            deltas.sort((x, y) => x - y);
            pair = { dTeamMed: deltas.length ? deltas[deltas.length >> 1] : null, dAlive: B.allAlive - A.allAlive, paired: deltas.length };
        }
        out.push({ scene, A, B, pair });
    }
    return out;
}
function progress() {
    if (!run) return { status: 'idle' };
    const p = { status: run.status, t0: run.t0, params: run.params, done: run.done, total: run.total, running: run.procs.size, last: run.lastLine };
    if (run.status !== 'running') p.results = run.agg;
    return p;
}
function nextJob() {
    if (!run || run.status !== 'running') return;
    const j = run.jobs[run.next];
    if (!j) { if (!run.procs.size) finish('done'); return; }
    run.next++;
    let out = '', err = '';
    const child = api.spawn(process.execPath, [frsimPath(), j.script.path, j.scene, String(run.params.secs)], {
        env: { ...process.env, SIG_SERVER: sigDir(), SEED: String(j.seed) },
        onData: (chunk, stream) => { if (stream === 'stderr') err += chunk; else out += chunk; },
        onExit: () => {
            run.procs.delete(child);
            const line = out.split('\n').find(l => l.startsWith('RESULT '));
            let r = { seed: j.seed, error: true, why: (err || out || 'no result').slice(-300) };
            if (line) { try { r = JSON.parse(line.slice(7)); } catch (_) { } }
            if (!run.results[j.scene]) run.results[j.scene] = {};
            if (!run.results[j.scene][j.side]) run.results[j.scene][j.side] = [];
            run.results[j.scene][j.side].push(r);
            run.done++;
            run.lastLine = `${j.side} ${j.scene} seed ${j.seed}: ${r.error ? 'error' : `alive ${r.alive}/${r.of}, team ${r.team}`}`;
            api.emit('batch', progress());
            nextJob();
        },
    });
    run.procs.add(child);
}
function finish(status) {
    run.status = status;
    run.agg = aggregate();
    const last = { t: Date.now(), status, params: run.params, results: run.agg };
    api.state.set('last', last);
    api.emit('batch', progress());
}
function startBatch({ scenes: names, a = 'live', b = '', seeds = 8, secs = 16, parallel = 4 }) {
    if (run && run.status === 'running') return { ok: false, error: 'a batch is already running - stop it first' };
    if (!sigDir()) return { ok: false, error: 'sig-server checkout not found (SIG_SERVER, sig-server/ in the repo, or sighack_ref next to it)' };
    if (!frsimPath() || !fs.existsSync(frsimPath())) return { ok: false, error: 'sim/frsim.js not found in the workspace' };
    const list = scripts();
    const pick = k => list.find(s => s.key === k) || list.find(s => s.path === k);
    const A = pick(a); if (!A) return { ok: false, error: 'script A not found: ' + a };
    const B = b ? pick(b) : null; if (b && !B) return { ok: false, error: 'script B not found: ' + b };
    const all = scenes();
    if (all[0] && all[0].name === '') return { ok: false, error: all[0].desc };
    const sc = (names || []).filter(n => all.some(s => s.name === n));
    if (!sc.length) return { ok: false, error: 'pick at least one scene' };
    seeds = Math.max(1, Math.min(64, Math.round(+seeds) || 8));
    secs = Math.max(2, Math.min(180, Math.round(+secs) || 16));
    parallel = Math.max(1, Math.min(16, Math.round(+parallel) || 4));
    const jobs = [];
    for (const [side, script] of [['A', A], ...(B ? [['B', B]] : [])])
        for (const scene of sc) for (let seed = 1; seed <= seeds; seed++) jobs.push({ side, script, scene, seed });
    run = { status: 'running', t0: Date.now(), jobs, next: 0, done: 0, total: jobs.length, results: {}, procs: new Set(), lastLine: '',
        params: { scenes: sc, a: A.version && !A.label.includes(A.version) ? A.label + ' ' + A.version : A.label, b: B ? (B.version && !B.label.includes(B.version) ? B.label + ' ' + B.version : B.label) : '', seeds, secs, parallel } };
    for (let i = 0; i < parallel; i++) nextJob();
    api.emit('batch', progress());
    return { ok: true, total: jobs.length };
}
function stopBatch() {
    if (!run || run.status !== 'running') return { ok: false, error: 'nothing is running' };
    for (const c of run.procs) try { c.kill(); } catch (_) { }
    run.procs.clear();
    finish('stopped');
    return { ok: true };
}

function lastText(last, running) {
    if (running && running.status === 'running')
        return `Batch running: ${running.done}/${running.total} runs done${running.last ? ' · last: ' + running.last : ''}. Ask again or use simbatch_last when it finishes.`;
    if (!last) return 'No batch has been run yet.';
    const L = [`Batch ${new Date(last.t).toLocaleString()} (${last.status || 'done'}): A = ${last.params.a}${last.params.b ? ', B = ' + last.params.b : ''}, ${last.params.seeds} seeds, ${last.params.secs} s each.`];
    for (const r of last.results) {
        L.push(`${r.scene}: A ${r.A ? `alive ${r.A.allAlive}/${r.A.n}, team ${r.A.team}, travel ${r.A.travel}x, deaths ${r.A.deaths}, jitter ${r.A.jitter}s, frozen ${r.A.frozen}s` : '-'}${r.B ? ` | B alive ${r.B.allAlive}/${r.B.n}, team ${r.B.team}, travel ${r.B.travel}x, deaths ${r.B.deaths}` : ''}${r.pair ? ` | paired Δteam median ${r.pair.dTeamMed} (n=${r.pair.paired}), Δall-alive ${r.pair.dAlive}` : ''}${r.A && r.A.errors ? ` | A errors ${r.A.errors}` : ''}${r.B && r.B.errors ? ` | B errors ${r.B.errors}` : ''}`);
    }
    L.push('The sim swings a lot between runs - only compare numbers within this batch (same seeds).');
    return L.join('\n');
}

export default {
    async start(a) { api = a; },
    async stop() { if (run && run.status === 'running') stopBatch(); },
    handlers: {
        async state() {
            return { scenes: scenes(), scripts: scripts(), sig: !!sigDir(), running: progress(), last: (await api.state.get('last', null)) || null };
        },
        async run(args) { return startBatch(args || {}); },
        async stop() { return stopBatch(); },
        async widget() {
            if (run && run.status === 'running') return { title: 'Sim batch', value: `${run.done}/${run.total}`, detail: run.lastLine || 'running' };
            const last = await api.state.get('last', null);
            return last ? { title: 'Sim batch', value: `${last.params.scenes.length} scenes`, detail: `A ${last.params.a}${last.params.b ? ' vs B ' + last.params.b : ''} · ${last.params.seeds} seeds` } : { title: 'Sim batch', value: '—', detail: 'no batch yet' };
        },
    },
    tools: [{
        name: 'simbatch_run',
        description: 'Run fast team sims over many seeds (sim/frsim.js on the real server code): pick scenes, seeds (default 8), seconds (default 16), parallel (default 4), and optionally side B (e.g. the workspace userscript) to compare against A (default the live file) on the same seeds. Returns at once; read results with simbatch_last.',
        parameters: { type: 'object', properties: {
            scenes: { type: 'array', items: { type: 'string' }, description: 'scene names from sim/rscenes.js, e.g. escape, rally, mines, boostkill, calm, fast' },
            seeds: { type: 'number' }, secs: { type: 'number' }, parallel: { type: 'number' },
            a: { type: 'string', description: "script A: 'live', 'workspace', or a path" },
            b: { type: 'string', description: "script B to compare on the same seeds: 'workspace', 'live', a backup key, or a path; omit for a single-sided run" } } },
        async execute(args) {
            const r = startBatch(args || {});
            if (!r.ok) return { content: r.error, isError: true };
            return `Started ${r.total} runs (${args.scenes ? args.scenes.join(', ') : ''}). A few minutes; simbatch_last for results.`;
        },
    }, {
        name: 'simbatch_last', description: 'Progress or results of the last sim batch: per scene alive/team/travel/deaths/jitter/frozen for A and B, plus paired median Δteam on the same seeds.',
        parameters: { type: 'object', properties: {} },
        async execute() {
            const last = await api.state.get('last', null);
            return lastText(last, run && progress());
        },
    }, {
        name: 'simbatch_stop', description: 'Stop the running sim batch (kills its simulator processes); partial results are kept.',
        parameters: { type: 'object', properties: {} },
        async execute() { const r = stopBatch(); return r.ok ? 'Stopped.' : r.error; },
    }],
};
