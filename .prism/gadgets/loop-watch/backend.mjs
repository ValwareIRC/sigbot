// Loop Watch: the tuning loop's state (rounds the agent reports, pause, next check) plus its own bot watcher, which checks
// the Sigmally Lab every 15 s and alerts the phone when two or fewer bots are in the game for 2 minutes, or the Lab is down.
import fs from 'node:fs';
import path from 'node:path';

const LAB = 'http://127.0.0.1:47800';
const DEADLINE = new Date(2026, 10, 15, 23, 0, 0).getTime();   // Sunday 15 November 2026, 23:00 local
let api = null, timer = null, saveTimer = null;
let st = { paused: false, rounds: [], alerts: [], next: 0, alerted: null };
let samples = [];          // [t, inGame, tabs]
const live = { lastCheck: 0, lastOk: 0, n: null, tabs: 0, lowSince: 0, highSince: 0, downSince: 0, error: '' };
const deadSince = new Map();
const lastChange = new Map();   // tab id -> { sig: mass|mode, t: when it last changed }
const now = () => Date.now();
const sampleFile = () => path.join(api.dataDir, 'samples.json');

function status() {
    const t = now();
    if (t > DEADLINE) return 'finished';
    if (st.paused) return 'paused';
    if (st.next && t > st.next + 10 * 60e3) return 'overdue';
    if (!st.rounds.length) return 'waiting';
    return 'running';
}
function hhmm(t) { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

async function save() {
    try { await api.state.set('st', st); } catch (_) { }
    try { fs.mkdirSync(api.dataDir, { recursive: true }); fs.writeFileSync(sampleFile(), JSON.stringify(samples)); } catch (_) { }
}
function alert(text) {
    const a = { t: now(), text };
    st.alerts.unshift(a); if (st.alerts.length > 50) st.alerts.length = 50;
    try { api.ui.notify('Sigmally bots', text); } catch (_) { }
    api.log('ALERT ' + text);
    api.emit('state', view());
    save();
}

async function check() {
    const t = now();
    live.lastCheck = t;
    try {
        const r = await fetch(LAB + '/tabs', { signal: AbortSignal.timeout(8000) });
        const j = await r.json();
        live.lastOk = t; live.downSince = 0; live.error = '';
        const tabs = (j.tabs || []).filter(x => x.bot && x.answers !== false);
        let n = 0;
        for (const x of tabs) {
            // a tab whose game connection dropped keeps reporting its last mass and mode: a live bot's mass changes every
            // second (decay), so the same mass + mode for 90 s means it is not in the game (2026-11-14: two "evading" tabs
            // sat at 463 and 190 for an hour while only 2 bots played, and no alert went out)
            const sig = Math.round(x.mass || 0) + '|' + (x.mode || '');
            const ch = lastChange.get(x.id);
            if (!ch || ch.sig !== sig) lastChange.set(x.id, { sig, t });
            const frozen = (x.mass || 0) > 0 && t - lastChange.get(x.id).t > 90000;
            if ((x.mass || 0) > 0 && !frozen) { deadSince.delete(x.id); n++; continue; }
            if (!deadSince.has(x.id)) deadSince.set(x.id, t);
            if (t - deadSince.get(x.id) < 60000) n++;   // respawning still counts
        }
        live.n = n; live.tabs = tabs.length;
        samples.push([t, n, tabs.length]);
        if (st.alerted === 'lab') { st.alerted = null; alert(`The Lab is answering again (${n} bots in the game).`); }
        if (n <= 2) {
            live.highSince = 0;
            if (!live.lowSince) live.lowSince = t;
            if (t - live.lowSince > 120000 && st.alerted !== 'low') { st.alerted = 'low'; alert(`Only ${n} bot${n === 1 ? '' : 's'} in the game (for 2 min). ${tabs.length} bot tab${tabs.length === 1 ? '' : 's'} connected.`); }
        } else {
            live.lowSince = 0;
            if (st.alerted === 'low') { if (!live.highSince) live.highSince = t; if (t - live.highSince > 120000) { st.alerted = null; alert(`Back to ${n} bots in the game.`); } }
        }
    } catch (e) {
        live.error = String(e.message || e);
        live.n = null;
        samples.push([t, null, 0]);
        if (!live.downSince) live.downSince = t;
        if (t - live.downSince > 180000 && st.alerted !== 'lab') { st.alerted = 'lab'; alert('The Sigmally Lab has not answered for 3 min: no bots are connected to it.'); }
    }
    nudge(t);
    const cut = t - 12 * 3600e3;
    while (samples.length && samples[0][0] < cut) samples.shift();
    api.emit('state', view());
}

// THE LOOP'S CLOCK (the user, 2026-11-14: 'it's been 45 mins and you haven't looped'): the agent's own timers die when its
// session restarts. So this backend wakes the agent: a round more than 2 min overdue (or none recorded for 20 min) ->
// send it a message, at most once every 10 min, until the deadline. Paused rounds still run (they only read the numbers).
function nudge(t) {
    // (2026-11-14) api.agent.send reaches whichever session is ACTIVE in Prism: the user keeps this loop's session as the only one.
    // (2026-11-14 ~16:00) the user: "stop the loop, it keeps starting a new session" - the automatic wake-up is OFF for good.
    return;
    if (t > DEADLINE) return;
    const lastRound = st.rounds[0] ? st.rounds[0].t : 0;
    const due = st.next ? st.next + 2 * 60e3 : (lastRound ? lastRound + 20 * 60e3 : 0);
    if (!due || t < due) return;
    if (t - (st.nudgedAt || 0) < 10 * 60e3) return;
    st.nudgedAt = t; st.nudges = (st.nudges || 0) + 1;
    try { askRound('the loop clock (round overdue)'); } catch (e) { api.log('nudge failed: ' + e.message); }
    save();
}
function view() {
    // at most ~360 points for the graph: the lowest count in each slot (a dip must show)
    const pts = []; const slot = 120000;
    for (const s of samples) {
        const k = Math.floor(s[0] / slot);
        const last = pts[pts.length - 1];
        if (last && last.k === k) { if (s[1] === null || (last.n !== null && s[1] < last.n)) last.n = s[1]; }
        else pts.push({ k, t: s[0], n: s[1] });
    }
    const t = now();
    return {
        status: status(), paused: st.paused, deadline: DEADLINE,
        round: st.rounds.length, last: st.rounds[0] || null, rounds: st.rounds.slice(0, 12), next: st.next,
        alerts: st.alerts.slice(0, 20),
        watcher: { alive: t - live.lastCheck < 45000, lastCheck: live.lastCheck, labOk: !!live.lastOk && t - live.lastOk < 45000, error: live.error },
        n: live.n, tabs: live.tabs,
        points: pts.map(p => [p.t, p.n]),
    };
}

function statusText() {
    const v = view(), t = now();
    const lines = [];
    lines.push(`Loop: ${v.status.toUpperCase()}${v.paused ? ' (do not change or deploy the bot; reading the numbers is fine)' : ''} - round ${v.round}, deadline ${new Date(DEADLINE).toLocaleString()}`);
    if (v.last) lines.push(`Last round (${hhmm(v.last.t)}): ${v.last.summary}`);
    lines.push(v.next ? `Next round due ${hhmm(v.next)}${t > v.next ? ` (${Math.round((t - v.next) / 60000)} min late)` : ''}` : 'Next round: not set');
    lines.push(`Watcher: ${v.watcher.alive ? 'running' : 'NOT running'}; Lab ${v.watcher.labOk ? 'answering' : 'not answering' + (v.watcher.error ? ' (' + v.watcher.error + ')' : '')}; bots in the game now: ${v.n === null ? '?' : v.n} (${v.tabs} bot tabs)`);
    if (v.alerts.length) lines.push('Recent alerts: ' + v.alerts.slice(0, 5).map(a => hhmm(a.t) + ' ' + a.text).join(' | '));
    return lines.join('\n');
}

function setPause(on) {
    st.paused = !!on;
    api.log(st.paused ? 'paused' : 'resumed');
    save(); api.emit('state', view());
    return st.paused;
}
function askRound(by) {
    const text = 'Loop Watch: please run a loop round now: read the live Sigmally numbers (Lab status, team journal, deaths), ' +
        (st.paused ? 'but the loop is PAUSED, so do not change or deploy the bot - just report.' : 'fix the biggest loss, check it on the same seeds, deploy with deploy4.js,') +
        ' then call loop_round with a one-line summary.';
    api.agent.send(text);
    api.log('round requested by ' + by);
    return 'Asked the agent to run a round now.';
}

export default {
    async start(a) {
        api = a;
        st = Object.assign(st, (await api.state.get('st', null)) || {});
        try { samples = JSON.parse(fs.readFileSync(sampleFile(), 'utf8')); } catch (_) { samples = []; }
        timer = setInterval(() => { check().catch(() => { }); }, 15000);
        saveTimer = setInterval(save, 60000);
        check().catch(() => { });
    },
    async stop() { clearInterval(timer); clearInterval(saveTimer); await save(); },
    handlers: {
        async state() { return view(); },
        async pause({ on } = {}) { return setPause(on); },
        async runRound() { return askRound('the panel'); },
        async widget() {
            const v = view();
            const word = { running: 'running', paused: 'paused', overdue: 'OVERDUE', waiting: 'waiting', finished: 'finished' }[v.status];
            return { title: 'Loop', value: `${word} · ${v.n === null ? '?' : v.n} bots`, detail: `round ${v.round}` + (v.next ? ` · next ${hhmm(v.next)}` : '') + (v.watcher.alive ? '' : ' · watcher stopped') };
        },
    },
    tools: [
        { name: 'loop_status', description: 'The tuning loop: running / paused / overdue, round number, last round summary, next round due, whether the bot watcher runs, bots in the game now, recent alerts. Check it at the start of every round: when paused, do not change or deploy the bot.',
          parameters: { type: 'object', properties: {} },
          async execute() { return statusText(); } },
        { name: 'loop_round', description: 'Record a finished loop round: a one-line summary for the user (what was found, what changed, version deployed) and how many minutes until the next round.',
          parameters: { type: 'object', properties: { summary: { type: 'string' }, next_minutes: { type: 'number' } }, required: ['summary'] },
          async execute({ summary, next_minutes }) {
              const r = { n: st.rounds.length + 1, t: now(), summary: String(summary).slice(0, 400) };
              st.rounds.unshift(r); if (st.rounds.length > 200) st.rounds.length = 200;
              st.next = next_minutes ? now() + next_minutes * 60000 : 0;
              save(); api.emit('state', view());
              return `Round ${r.n} recorded; next due ${st.next ? hhmm(st.next) : 'not set'}.`;
          } },
        { name: 'loop_pause', description: 'Pause (on: true) or resume (on: false) the loop. Paused = the agent keeps reading the numbers but does not change or deploy the bot; the bot watcher keeps alerting.',
          parameters: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
          async execute({ on }) { return setPause(on) ? 'Paused.' : 'Resumed.'; } },
    ],
};
