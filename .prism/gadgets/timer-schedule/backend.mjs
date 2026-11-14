// Timer Schedule: the timers (cron jobs) the agent sets, when each should fire, and whether its prompt actually reached
// the session. The agent registers jobs (timer_add / timer_sync) and reports arrivals (timer_arrived); a job's prompt can
// also prove arrival itself by writing %LOCALAPPDATA%\sighack_test\timer-arrivals\<id>.txt. A run that is 5 minutes
// past its time with no arrival counts as missed.
import fs from 'node:fs';
import path from 'node:path';

const ARRIVALS = path.join(process.env.LOCALAPPDATA || '', 'sighack_test', 'timer-arrivals');
const GRACE = 5 * 60000;
let api, jobs = [], timer = null;
const save = () => api.state.set('jobs', jobs);

// next time (after `from`) a 5-field cron matches, minute by minute, up to 8 days ahead
function field(spec, v, lo, hi) {
    return spec.split(',').some(part => {
        let [r, step] = part.split('/'); step = +step || 1;
        let a = lo, b = hi;
        if (r !== '*') { const [x, y] = r.split('-').map(Number); a = x; b = y === undefined ? (part.includes('/') ? hi : x) : y; }
        return v >= a && v <= b && (v - a) % step === 0;
    });
}
function nextFire(cron, from) {
    const f = cron.trim().split(/\s+/); if (f.length !== 5) return null;
    const d = new Date(from); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
    for (let i = 0; i < 8 * 1440; i++) {
        if (field(f[0], d.getMinutes(), 0, 59) && field(f[1], d.getHours(), 0, 23) && field(f[2], d.getDate(), 1, 31) && field(f[3], d.getMonth() + 1, 1, 12) && field(f[4], d.getDay(), 0, 6)) return d.getTime();
        d.setMinutes(d.getMinutes() + 1);
    }
    return null;
}
// one-offs: the single time they're for (looked for from a day before they were added, so a past one still shows)
function plan(j) {
    if (!j.recurring) { if (!j.due) j.due = nextFire(j.cron, j.addedAt - 60000); return; }
    j.runs = j.runs || [];
    // every fire time from when it was added to now becomes a run to account for, plus the next one
    let t = j.lastPlanned || j.addedAt;
    for (let n = 0; n < 400; n++) { const nx = nextFire(j.cron, t); if (!nx || nx > Date.now()) { j.next = nx; break; } if (!j.runs.some(r => r.due === nx)) j.runs.push({ due: nx }); t = nx; j.lastPlanned = nx; }
}
function status(due, arrived, deleted) {
    if (arrived) return 'arrived';
    if (deleted && !due) return 'cancelled';
    if (!due) return 'unknown';
    const late = Date.now() - due;
    if (late < 0) return deleted ? 'cancelled' : 'waiting';
    return late < GRACE ? 'due' : 'missed';
}
function readArrivalFiles() {
    let changed = false;
    try {
        for (const f of fs.readdirSync(ARRIVALS)) {
            const id = f.replace(/\.txt$/, ''), j = jobs.find(x => x.id === id);
            if (!j) continue;
            const at = fs.statSync(path.join(ARRIVALS, f)).mtimeMs;
            if (!j.recurring && !j.arrivedAt) { j.arrivedAt = at; j.via = 'trace file'; changed = true; }
            if (j.recurring) { const r = (j.runs || []).filter(r => !r.arrivedAt && r.due <= at + 60000).pop(); if (r) { r.arrivedAt = at; r.via = 'trace file'; changed = true; } }
        }
    } catch (_) { }
    return changed;
}
function view() {
    for (const j of jobs) plan(j);
    const rows = [];
    for (const j of jobs) {
        if (!j.recurring) rows.push({ id: j.id, name: j.name, cron: j.cron, recurring: false, due: j.due, arrivedAt: j.arrivedAt || null, via: j.via || '', test: !!j.test, deleted: !!j.deleted, status: status(j.due, j.arrivedAt, j.deleted) });
        else {
            for (const r of j.runs) rows.push({ id: j.id, name: j.name, cron: j.cron, recurring: true, due: r.due, arrivedAt: r.arrivedAt || null, via: r.via || '', test: !!j.test, deleted: false, status: status(r.due, r.arrivedAt) });
            if (!j.deleted && j.next) rows.push({ id: j.id, name: j.name, cron: j.cron, recurring: true, due: j.next, arrivedAt: null, via: '', test: !!j.test, deleted: false, status: 'waiting' });
        }
    }
    rows.sort((a, b) => (a.due || 0) - (b.due || 0));
    const count = s => rows.filter(r => r.status === s).length;
    const next = rows.find(r => r.status === 'waiting');
    return { rows, counts: { arrived: count('arrived'), missed: count('missed'), due: count('due'), waiting: count('waiting') }, next: next || null, now: Date.now() };
}
const hm = t => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
function text() {
    const v = view();
    if (!v.rows.length) return 'No timers registered.';
    return `${v.counts.arrived} arrived, ${v.counts.missed} missed, ${v.counts.due} due now, ${v.counts.waiting} waiting\n` +
        v.rows.map(r => `${hm(r.due)} ${r.status.toUpperCase()}${r.arrivedAt ? ' (arrived ' + hm(r.arrivedAt) + (r.via ? ', ' + r.via : '') + ')' : ''} - ${r.name} [${r.id}${r.test ? ', test' : ''}]`).join('\n');
}
function tick() { const ch = readArrivalFiles(); if (ch) save(); api.emit('view', view()); }

export default {
    async start(a) {
        api = a;
        jobs = (await api.state.get('jobs', [])) || [];
        try { fs.mkdirSync(ARRIVALS, { recursive: true }); } catch (_) { }
        tick();
        timer = setInterval(tick, 15000);
    },
    async stop() { clearInterval(timer); },
    handlers: {
        async view() { readArrivalFiles(); return view(); },
        async remove({ id }) { jobs = jobs.filter(j => j.id !== id); save(); api.emit('view', view()); return true; },
        async widget() {
            const v = view();
            return { title: 'Timers', value: v.counts.missed ? `${v.counts.missed} missed` : `${v.counts.arrived} arrived`,
                detail: v.next ? `next ${hm(v.next.due)}: ${v.next.name}` : 'nothing scheduled' };
        },
    },
    tools: [
        { name: 'timer_add', description: 'Register a scheduled timer (cron job) so the panel tracks it: its id (from CronCreate), a short name, the 5-field cron in local time, whether it repeats, and whether it is a test timer.',
            parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, cron: { type: 'string' }, recurring: { type: 'boolean' }, test: { type: 'boolean' }, addedAt: { type: 'string', description: 'ISO time the job was created (default now)' } }, required: ['id', 'name', 'cron'] },
            async execute({ id, name, cron, recurring = false, test = false, addedAt }) {
                if (!nextFire(cron, Date.now() - 86400e3)) return { content: 'Could not read that cron expression: ' + cron, isError: true };
                jobs = jobs.filter(j => j.id !== id);
                jobs.push({ id, name, cron, recurring, test, addedAt: addedAt ? Date.parse(addedAt) : Date.now() });
                save(); api.emit('view', view());
                return 'Tracking ' + id + '.\n' + text();
            } },
        { name: 'timer_arrived', description: "Record that a timer's prompt actually arrived in the session (call this first thing when a scheduled prompt arrives). For a repeating job it marks the latest run that was due.",
            parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
            async execute({ id }) {
                const j = jobs.find(x => x.id === id); if (!j) return { content: 'Unknown timer ' + id + ' (register it with timer_add).', isError: true };
                plan(j);
                if (!j.recurring) { j.arrivedAt = Date.now(); j.via = 'reported'; }
                else { const r = j.runs.filter(r => !r.arrivedAt && r.due <= Date.now() + 60000).pop(); if (r) { r.arrivedAt = Date.now(); r.via = 'reported'; } }
                save(); api.emit('view', view());
                return text();
            } },
        { name: 'timer_deleted', description: 'Mark a timer as cancelled (after CronDelete): it stops counting as waiting or missed.',
            parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
            async execute({ id }) { const j = jobs.find(x => x.id === id); if (!j) return { content: 'Unknown timer ' + id, isError: true }; j.deleted = true; save(); api.emit('view', view()); return text(); } },
        { name: 'timer_list', description: 'All tracked timers: when each should fire and whether it arrived, is due, waiting, or was missed (5+ minutes late with no arrival).',
            parameters: { type: 'object', properties: {} },
            async execute() { readArrivalFiles(); return text(); } },
    ],
};
