// Team study runs: every run of sighack_test/study-teams.js (the scheduled runs write study-last.json; this gadget
// archives each new version as a run, or runs the study itself) with a note of what that run changed.
import fs from 'node:fs';
import path from 'node:path';

const TEST = path.join(process.env.LOCALAPPDATA || '', 'sighack_test');
const LAST = path.join(TEST, 'study-last.json');
let api, runs = [], watching = false, fallback = null;
// the agent's scheduled runs (local time): if no run shows up within 4 min of one, run the study here so the
// measurements aren't lost (the agent's timer can fire and never reach the session after a long idle stretch)
const SLOTS = ['2026-10-17T20:46', '2026-10-17T21:31', '2026-10-17T22:16', '2026-10-17T23:01'];
async function fallbackCheck() {
    const t = Date.now();
    for (const sl of SLOTS) {
        const due = new Date(sl).getTime();                        // local time (no zone in the string)
        if (t < due + 4 * 60000 || t > due + 30 * 60000) continue;
        if (runs.some(r => Date.parse(r.at) >= due - 60000)) continue;
        const r = await runNow(50);
        if (r && !r.error) { r.source = 'fallback'; r.note = "automatic: the agent's " + sl.slice(11) + ' timer did not arrive - measurements only, no bot change'; save(); api.emit('runs', { runs }); api.log('fallback run for ' + sl); }
    }
}
const runsFile = () => path.join(api.dataDir, 'runs.json');
const save = () => { try { fs.writeFileSync(runsFile(), JSON.stringify(runs)); } catch (_) { } };

function summarize(r) {
    const med = (a) => { a = a.filter(x => typeof x === 'number'); if (!a.length) return null; a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
    const pick = ts => ({
        n: ts.length,
        spacing: med(ts.map(t => t.spacing)), ratio: med(ts.map(t => t.ratio)), handoffs: med(ts.map(t => t.handoffsPerMin)),
        fwdShare: (() => { const f = ts.reduce((a, t) => a + t.dir.forward, 0), all = ts.reduce((a, t) => a + t.dir.forward + t.dir.back + t.dir.side, 0); return all ? Math.round(100 * f / all) : null; })(),
        pours: ts.reduce((a, t) => a + t.pours, 0), kills: ts.reduce((a, t) => a + t.kills, 0), killsOfOurs: ts.reduce((a, t) => a + t.killsOfOurs, 0),
        speed: med(ts.map(t => t.speedVsSingle)),
    });
    const seen = (r.teams || []).filter(t => t.seenSec >= 10);
    return { wild: pick(seen.filter(t => !t.ours)), ours: pick(seen.filter(t => t.ours)) };
}
function addRun(data, source) {
    if (!data || !data.at) return null;
    if (runs.some(r => r.at === data.at)) return null;
    const run = { id: runs.length + 1, at: data.at, minutes: data.minutes, snaps: data.snaps, teams: data.teams || [], source, note: '', sum: summarize(data) };
    runs.push(run); save();
    api.emit('runs', { runs });
    return run;
}
function checkLast() {
    try { const d = JSON.parse(fs.readFileSync(LAST, 'utf8')); const r = addRun(d, 'scheduled'); if (r) api.log('archived run ' + r.id + ' from study-last.json'); } catch (_) { }
}
async function runNow(minutes = 50) {
    const out = path.join(api.dataDir, 'now.json');
    const r = await api.shell(`node study-teams.js ${Math.max(5, Math.min(600, +minutes || 50))} --json "${out}"`, { cwd: TEST, timeoutMs: 240000 });
    let data = null; try { data = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (_) { }
    if (!data) return { error: (r.stdout || '') + (r.stderr || '') || 'the study produced nothing' };
    return addRun(data, 'manual') || { error: 'no new data' };
}
const f1 = v => v === null || v === undefined ? '–' : v;
function text(r) {
    const s = r.sum, row = (k, x) => `${k}: ${x.n} team(s) | spacing ${f1(x.spacing)} | ratio ${f1(x.ratio)} | handoffs ${f1(x.handoffs)}/min (${f1(x.fwdShare)}% forward) | pours ${x.pours} | kills ${x.kills} | speed x${f1(x.speed)}`;
    return `Run ${r.id} (${new Date(r.at).toLocaleTimeString()}, ${r.minutes} min, ${r.snaps} snapshots)${r.note ? ' - ' + r.note : ''}\n${row('wild', s.wild)}\n${row('ours', s.ours)}${s.wild.killsOfOurs ? `\nwild teams killed ${s.wild.killsOfOurs} of ours` : ''}`;
}

export default {
    async start(a) {
        api = a;
        try { runs = JSON.parse(fs.readFileSync(runsFile(), 'utf8')); } catch (_) { runs = []; }
        checkLast();
        if (!watching) { watching = true; fs.watchFile(LAST, { interval: 5000 }, () => checkLast()); }
        fallback = setInterval(() => fallbackCheck().catch(() => { }), 60000);
    },
    async stop() { fs.unwatchFile(LAST); watching = false; clearInterval(fallback); },
    handlers: {
        async list() { return { runs }; },
        async run({ minutes }) { return runNow(minutes); },
        async note({ id, note }) { const r = runs.find(x => x.id === +id) || runs[runs.length - 1]; if (!r) return { error: 'no runs' }; r.note = String(note || ''); save(); api.emit('runs', { runs }); return r; },
        async widget() {
            const r = runs[runs.length - 1];
            if (!r) return { title: 'Team study', value: 'no runs yet', detail: 'first run 17:46' };
            return { title: 'Team study', value: `ours x${f1(r.sum.ours.speed)} · wild x${f1(r.sum.wild.speed)}`, detail: `run ${r.id}: ${r.sum.wild.n} wild teams, ${r.sum.wild.handoffs ?? '–'} handoffs/min` };
        },
    },
    tools: [
        { name: 'study_runs', description: 'All team-study runs so far: per run the median spacing, size ratio, handoffs/min (+% forward), pours, kills and speed vs one cell, for the wild teams and for our bots.',
            parameters: { type: 'object', properties: {} },
            async execute() { return runs.length ? runs.map(text).join('\n\n') : 'No runs yet.'; } },
        { name: 'study_run_now', description: 'Run the team study now over the last N minutes of observations (default 50) and add it as a run.',
            parameters: { type: 'object', properties: { minutes: { type: 'number' } } },
            async execute({ minutes }) { const r = await runNow(minutes); return r.error ? { content: r.error, isError: true } : text(r); } },
        { name: 'study_note', description: 'Attach a short note to a run (default: the latest), e.g. what that run changed in the bot.',
            parameters: { type: 'object', properties: { note: { type: 'string' }, id: { type: 'number' } }, required: ['note'] },
            async execute({ note, id }) { const r = runs.find(x => x.id === +id) || runs[runs.length - 1]; if (!r) return { content: 'No runs yet.', isError: true }; r.note = note; save(); api.emit('runs', { runs }); return 'Noted on run ' + r.id + '.'; } },
    ],
};
