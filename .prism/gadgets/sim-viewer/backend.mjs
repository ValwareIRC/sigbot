// Sim viewer: runs a team scene and hands the recorded ticks to the panel for playback.
// Two sims: rsim.js runs scenes on the REAL Sigmally server code (exact eating, splitting, merging, virus pops) - these
// come first and are the ones to trust; sqsim.js is the old hand-written sim (its pieces never merge, viruses don't pop).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// a checkout of the repo: sim/ and userscript/ three levels up from this gadget (this computer: the working copies)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = [path.join(process.env.LOCALAPPDATA || '', 'sighack_test'), path.join(REPO, 'sim')].find(d => fs.existsSync(path.join(d, 'frsim.js'))) || path.join(REPO, 'sim');
const SIM = path.join(DIR, 'sqsim.js');
const RSIM = path.join(DIR, 'frsim.js');   // the fast real-server sim (same server code, live-like lag, ~10x quicker)
const LIVE = [path.join(process.env.LOCALAPPDATA || '', 'sighack_live', 'sigmally-mega-bot.user.js'), path.join(REPO, 'userscript', 'sigmally-mega-bot.user.js')].find(f => fs.existsSync(f)) || path.join(REPO, 'userscript', 'sigmally-mega-bot.user.js');
const NICE = { fast: 'Fast travel (2 bots)', fast4: 'Fast travel (4 bots)', rally: 'Rally: surrounded & split up', boostkill: 'Boost kill',
    escape: 'Escape', mines: 'Mines', calm: 'Calm', detour: 'Detour round a big player' };
let api, running = null, last = null;

// real-server scenes: the SCENES table in rsim.js ("    name: {" then "        desc: '...'")
function realScenes() {
    let src = '';
    try { src = fs.readFileSync(path.join(DIR, 'rscenes.js'), 'utf8'); } catch (_) { return []; }
    const out = [];
    const lines = src.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
        const m = /^ {4}([a-z0-9]+): \{\s*$/.exec(lines[i]);
        const d = m && /^ {8}desc: '(.*)',\s*$/.exec(lines[i + 1]);
        if (m && d) out.push({ name: 'real:' + m[1], label: (NICE[m[1]] || m[1]) + ' (real server)', desc: d[1].replace(/\\'/g, "'"), real: true });
    }
    return out;
}
function oldScenes() {
    let src = '';
    try { src = fs.readFileSync(SIM, 'utf8'); } catch (_) { return []; }
    const out = [], seen = new Set();
    const re = /scene === ['"]([a-z0-9]+)['"]/g;
    let m;
    while ((m = re.exec(src))) {
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        const lineEnd = src.indexOf('\n', m.index);
        const rest = src.slice(lineEnd + 1, lineEnd + 800).split('\n');
        const desc = [];
        for (const l of rest) { const t = l.trim(); if (t.startsWith('//')) desc.push(t.replace(/^\/\/\s?/, '')); else break; }
        out.push({ name, label: 'old sim: ' + name + (name === 'pair' ? ' (the old DNA pair travel)' : ''), desc: desc.join(' ') });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}
// only the real server's scenes: the old hand-written sim (sqsim) has different physics and is not shown any more
const scenes = () => realScenes();
function versions() {
    const list = [];
    const dev = path.join(DIR, 'dev3.user.js');
    if (fs.existsSync(dev)) list.push({ id: 'dev', label: 'Development (newest, not deployed yet)', file: dev });
    if (fs.existsSync(LIVE)) list.push({ id: 'live', label: 'Live (what the browsers run)', file: LIVE });
    let olds = [];
    try { olds = fs.readdirSync(DIR).filter(f => /^pre-r\d+\.user\.js$/.test(f)).map(f => ({ f, n: +f.match(/\d+/)[0] })).sort((a, b) => b.n - a.n).slice(0, 12); } catch (_) { }
    for (const o of olds) list.push({ id: o.f, label: 'Before change r' + o.n, file: path.join(DIR, o.f) });
    return list;
}
const versionOf = file => { try { const m = fs.readFileSync(file, 'utf8').match(/@version\s+([\d.]+)/); return m ? m[1] : ''; } catch (_) { return ''; } };

async function run({ scene = 'real:fast', version = 'dev', ticks = 375, seed = 1, lag = 2 } = {}) {
    if (running) return { error: 'A run is already going.' };
    const v = versions().find(x => x.id === version) || versions()[0];
    if (!v) return { error: 'No bot script found in ' + DIR };
    const all = scenes(), S = all.find(s => s.name === scene) || all.find(s => s.name === 'real:' + scene);
    if (!S) return { error: 'Unknown scene: ' + scene };
    scene = S.name;
    ticks = Math.max(25, Math.min(1500, +ticks || 375));
    const out = path.join(api.dataDir, 'run.json');
    try { fs.unlinkSync(out); } catch (_) { }
    const started = Date.now();
    running = { scene, label: S.label, version: v.id, ticks, started, real: !!S.real };
    api.emit('status', { running });
    let stdout = '';
    const args = S.real ? [RSIM, v.file, scene.slice(5), String(Math.max(1, Math.round(ticks / 25)))] : [SIM, v.file, scene, String(ticks)];
    const p = api.spawn('node', args, { cwd: DIR, env: { ...process.env, FRAMES: out, SEED: String(seed), LAG: String(lag), TEAMLOG: '1' },
        onData: (chunk) => { stdout += chunk; } });
    const code = await p.exited;
    running = null;
    let data = null;
    try { data = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (_) { }
    if (!data) { api.emit('status', { running: null }); return { error: 'The sim did not finish (exit ' + code + ').', output: stdout.slice(-2000) }; }
    data.relay = data.relay || []; data.events = data.events || []; data.splits = data.splits || [];
    const lines = stdout.split('\n').map(l => l.trimEnd()).filter(Boolean);
    const summary = S.real ? lines.filter(l => !/Warning|trace-warnings|Timeout duration/.test(l)).map(l => l.trim())
        : lines.filter(l => !/^t\d+/.test(l) && /^\s*(team travelled|gap between|BIGGEST|WALL|LEADPATH)|^[a-z0-9]+( \(solo\))?: Lead/.test(l)).map(l => l.trim());
    const journal = lines.filter(l => l.startsWith('LOG ')).map(l => l.slice(4));
    last = { scene, label: S.label, real: !!S.real, desc: S.desc || '', version: v.id, versionLabel: v.label, botVersion: versionOf(v.file), ticks, seed, lag,
        secs: Math.round((Date.now() - started) / 100) / 10, summary, journal, data };
    api.emit('status', { running: null });
    api.emit('run', { scene, version: v.id });
    return last;
}
const brief = r => r.error ? r.error + (r.output ? '\n' + r.output : '') :
    `${r.label} on ${r.versionLabel} (bot ${r.botVersion}), ${Math.round(r.ticks / 25)} s, seed ${r.seed}:\n` + r.summary.join('\n') +
    (r.data.events.length ? '\nevents:\n  ' + r.data.events.slice(0, 20).join('\n  ') : '') +
    (r.data.splits.length ? '\nsplits: ' + r.data.splits.slice(0, 20).join(', ') : '') + '\n(shown in the Sim viewer panel)';

export default {
    async start(a) { api = a; },
    async stop() { },
    handlers: {
        async info() { return { scenes: scenes(), versions: versions().map(({ id, label, file }) => ({ id, label, botVersion: versionOf(file) })), running, hasLast: !!last }; },
        async run(args) { return run(args || {}); },
        async last() { return last; },
    },
    tools: [
        { name: 'sim_scenes', description: 'List the team-sim scenes (real-server ones first) with what each one sets up.', parameters: { type: 'object', properties: {} },
            async execute() { return scenes().map(s => `${s.name} = ${s.label}: ${s.desc || '(no description)'}`).join('\n'); } },
        { name: 'sim_run', description: 'Run a team-sim scene with a bot version and show it in the Sim viewer panel (the user can watch it). Scenes named real:* run on the real server code. Returns the outcome summary, eats and splits.',
            parameters: { type: 'object', properties: { scene: { type: 'string', description: "e.g. 'real:dna', 'real:rally', 'real:boostkill'" }, version: { type: 'string', description: "'dev' (default), 'live', or a pre-rNN.user.js file name" }, ticks: { type: 'number', description: '25 ticks = 1 s (default 375 = 15 s)' }, seed: { type: 'number' } }, required: ['scene'] },
            async execute(args) { const r = await run(args || {}); return brief(r); } },
    ],
};
