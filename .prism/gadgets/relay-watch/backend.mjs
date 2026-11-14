// Relay watch: follows the relay feed the Sigmally Lab writes (sighack_live/relay.jsonl): the bot's DNA relay starts,
// splits, ends, swap results and sampled reasons a relay couldn't start, and sums them up for a window of time.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.env.LOCALAPPDATA || '', 'sighack_live', 'relay.jsonl');
const KEEP_MS = 24 * 3600e3, SAMPLE_S = 0.5;
let api, timer, recs = [], pos = 0, rest = '', emitT = null;
let mark = null, win = 'version';

const now = () => Date.now();

// ------------------------------------------------------------------ reading the feed
function poll() {
    let st; try { st = fs.statSync(FILE); } catch (_) { return; }
    if (st.size < pos) { pos = 0; rest = ''; recs = []; }          // file replaced
    if (st.size === pos) return;
    if (!pos && st.size > 4e6) pos = st.size - 4e6;                 // first read: the last few MB are plenty
    const fd = fs.openSync(FILE, 'r');
    try {
        const buf = Buffer.alloc(st.size - pos);
        fs.readSync(fd, buf, 0, buf.length, pos);
        pos = st.size;
        const lines = (rest + buf.toString('utf8')).split('\n');
        rest = lines.pop();
        let added = 0;
        for (const l of lines) { if (!l.trim()) continue; try { recs.push(JSON.parse(l)); added++; } catch (_) { } }
        const cut = now() - KEEP_MS;
        if (recs.length && recs[0].t < cut) recs = recs.filter(r => r.t >= cut);
        if (added) scheduleEmit();
    } finally { fs.closeSync(fd); }
}
function scheduleEmit() {
    if (emitT) return;
    emitT = setTimeout(() => { emitT = null; api.emit('update', summary(win)); }, 700);
}

// ------------------------------------------------------------------ summing up
const games = () => recs.filter(r => r.kind !== 'arena');
function currentVersion() {
    const g = games();
    for (let i = g.length - 1; i >= 0; i--) if (g[i].v) return g[i].v;
    return '';
}
function windowStart(w) {
    const g = games();
    if (w === 'mark') return mark ? mark.t : (g[0] ? g[0].t : now());
    if (w === 'version') {
        const v = currentVersion();
        const first = g.find(r => r.v === v);
        return first ? first.t : now();
    }
    return now() - (+w || 10) * 60e3;
}
function windowLabel(w) {
    if (w === 'mark') return mark ? 'since the check-up mark' + (mark.label ? ' (' + mark.label + ')' : '') : 'everything kept (no mark yet)';
    if (w === 'version') { const v = currentVersion(); return v ? 'since bot ' + v + ' arrived' : 'since this bot version'; }
    return 'last ' + (+w >= 60 ? (+w / 60) + ' h' : (+w || 10) + ' min');
}
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
function summary(w = win) {
    const since = windowStart(w), t1 = now();
    const list = games().filter(r => r.t >= since);
    const starts = list.filter(r => r.ev === 'start');
    const startWhy = {};
    for (const r of starts) inc(startWhy, r.why || 'other');
    const splits = { eat: 0, advance: 0 };
    for (const r of list) if (r.ev === 'split') inc(splits, r.stage === 'eat' ? 'eat' : 'advance');
    // both bots can report the same relay ending: count one per relay (same seq within a few seconds)
    const endWhy = {}, seen = new Map();
    let ends = 0;
    for (const r of list) {
        if (r.ev !== 'end') continue;
        const k = r.seq, prev = seen.get(k);
        if (prev && Math.abs(r.t - prev) < 6000) continue;
        seen.set(k, r.t); ends++; inc(endWhy, r.why || 'ended');
    }
    const results = list.filter(r => r.ev === 'result');
    let swapped = 0, moved = 0, lost = 0;
    const verdicts = {};
    for (const r of results) {
        const m = (r.toMate || 0) + (r.fromMate || 0);
        if (m > 0) swapped++;
        moved += m; lost += r.toEnemy || 0;
        inc(verdicts, r.verdict || '?');
    }
    // sampled reasons (twice a second per bot); the bot that doesn't decide just says so: leave it out
    const blocks = {};
    for (const r of list) if (r.ev === 'blocks' && r.counts) for (const [k, n] of Object.entries(r.counts)) if (k !== 'partner decides' && k !== 'not checked') inc(blocks, k, n);
    const running = blocks['relay running'] || 0;
    delete blocks['relay running'];
    const blockTotal = Object.values(blocks).reduce((a, b) => a + b, 0);
    const sampleTotal = blockTotal + running;
    const minutes = Math.max(0.1, (t1 - since) / 60e3);
    // per-minute timeline (at most 40 bars)
    const span = t1 - since, step = Math.max(60e3, Math.ceil(span / 40 / 60e3) * 60e3), nb = Math.min(40, Math.max(1, Math.ceil(span / step)));
    const bars = Array.from({ length: nb }, (_, i) => ({ t: t1 - (nb - i) * step, starts: 0, swaps: 0 }));
    const bi = t => Math.min(nb - 1, Math.max(0, Math.floor((t - (t1 - nb * step)) / step)));
    for (const r of starts) bars[bi(r.t)].starts++;
    for (const r of results) if ((r.toMate || 0) + (r.fromMate || 0) > 0) bars[bi(r.t)].swaps++;
    const recent = list.filter(r => r.ev === 'start' || r.ev === 'end' || r.ev === 'result').slice(-40).reverse().map(describe);
    const lastAny = games().slice(-1)[0];
    const bots = [...new Map(games().filter(r => r.t > t1 - 30e3).map(r => [r.cid, { cid: r.cid, client: r.client, v: r.v }])).values()];
    return {
        window: w, label: windowLabel(w), since, minutes: +minutes.toFixed(1), version: currentVersion(), mark,
        starts: starts.length, perMin: +(starts.length / minutes).toFixed(2), startWhy,
        splits, ends, endWhy, results: results.length, swapped, moved: Math.round(moved), lost: Math.round(lost), verdicts,
        blocks: Object.entries(blocks).sort((a, b) => b[1] - a[1]).map(([why, n]) => ({ why, n, share: blockTotal ? n / blockTotal : 0, secs: Math.round(n * SAMPLE_S) })),
        runningShare: sampleTotal ? running / sampleTotal : 0, sampleSecs: Math.round(sampleTotal * SAMPLE_S),
        bars, step, recent, lastAt: lastAny ? lastAny.t : 0, bots, fileFound: fs.existsSync(FILE),
    };
}
function describe(r) {
    let text;
    if (r.ev === 'start') text = `relay started (${r.why || '?'}), ${r.stepper === 'us' ? 'this bot' : 'its teammate'} steps first` + (r.mass ? ` · ${r.mass} / ${r.mateMass}` : '');
    else if (r.ev === 'end') text = `relay ended: ${r.why || 'ended'}` + (r.rounds ? ` after ${r.rounds} turn${r.rounds === 1 ? '' : 's'}` : '');
    else { const m = (r.toMate || 0) + (r.fromMate || 0); text = m > 0 ? `swapped ${Math.round(m)} mass (gave ${r.toMate || 0}, got ${r.fromMate || 0})` : `no swap (${r.verdict || '?'})`; if (r.toEnemy) text += ` · lost ${r.toEnemy}`; }
    return { t: r.t, ev: r.ev, client: r.client, cid: r.cid, text, good: r.ev === 'result' ? (r.toMate || 0) + (r.fromMate || 0) > 0 : null };
}
function text(s) {
    const pct = x => Math.round(x * 100) + '%';
    const lines = [];
    lines.push(`Relay watch, ${s.label} (${s.minutes} min${s.version ? ', bot ' + s.version : ''}):`);
    lines.push(`- relays started: ${s.starts} (${s.perMin}/min)` + (Object.keys(s.startWhy).length ? ' - ' + Object.entries(s.startWhy).map(([k, n]) => `${k} ${n}`).join(', ') : ''));
    lines.push(`- swapped mass: ${s.swapped} of ${s.results} finished relays, ${s.moved} mass moved between the two` + (s.lost ? `, ${s.lost} lost to others` : ''));
    lines.push(`- relay splits: ${s.splits.eat} eating, ${s.splits.advance} advancing`);
    lines.push(`- ended: ${s.ends}` + (s.ends ? ' - ' + Object.entries(s.endWhy).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') : ''));
    lines.push(`- time relaying: ${pct(s.runningShare)} of ${s.sampleSecs} s sampled`);
    lines.push(`- why no relay started (share of the time): ` + (s.blocks.length ? s.blocks.slice(0, 8).map(b => `${b.why} ${pct(b.share)}`).join(', ') : 'no samples'));
    if (!s.lastAt) lines.push(s.fileFound ? '(the feed is empty: are the bots on v3.20.2 or newer?)' : '(no relay feed yet: the Lab writes it once a bot on v3.20.2+ reports)');
    else lines.push(`- last report ${Math.round((now() - s.lastAt) / 1000)} s ago; bots reporting: ${s.bots.map(b => `#${b.cid} ${b.v}`).join(', ') || 'none in the last 30 s'}`);
    return lines.join('\n');
}

// ------------------------------------------------------------------ gadget
const parseWin = w => (w === 'mark' || w === 'version') ? w : (+w > 0 ? +w : 'version');
export default {
    async start(a) {
        api = a;
        mark = await api.state.get('mark', null);
        win = await api.state.get('window', 'version');
        poll();
        timer = setInterval(poll, 1000);
    },
    async stop() { clearInterval(timer); clearTimeout(emitT); },
    handlers: {
        async summary(args) { poll(); return summary(args && args.window !== undefined ? parseWin(args.window) : win); },
        async setWindow(args) { win = parseWin(args && args.window); await api.state.set('window', win); const s = summary(win); api.emit('update', s); return s; },
        async mark(args) {
            mark = { t: now(), label: (args && args.label) || '' };
            await api.state.set('mark', mark);
            win = 'mark'; await api.state.set('window', win);
            const s = summary(win); api.emit('update', s); return s;
        },
        async clearMark() { mark = null; await api.state.set('mark', null); if (win === 'mark') { win = 'version'; await api.state.set('window', win); } const s = summary(win); api.emit('update', s); return s; },
    },
    tools: [
        { name: 'relay_summary', description: 'One-glance count of the Mega Bot DNA relays: starts (and per minute), swaps and mass moved, relay splits, how relays ended, share of time relaying, and the sampled reasons no relay started.',
            parameters: { type: 'object', properties: { window: { description: "'version' (since the current bot version first reported, default), 'mark' (since relay_mark), or a number of minutes" } } },
            async execute(args) { poll(); return text(summary(args && args.window !== undefined ? parseWin(args.window) : 'version')); } },
        { name: 'relay_mark', description: 'Set the check-up mark to now (e.g. right after deploying a bot change); the panel then counts from here.',
            parameters: { type: 'object', properties: { label: { type: 'string', description: 'what changed, e.g. "v3.20.2 relaxed gates"' } } },
            async execute(args) { mark = { t: now(), label: (args && args.label) || '' }; await api.state.set('mark', mark); win = 'mark'; await api.state.set('window', win); api.emit('update', summary(win)); return 'Check-up mark set at ' + new Date(mark.t).toLocaleTimeString() + (mark.label ? ' (' + mark.label + ')' : '') + '.'; } },
        { name: 'relay_wait', description: 'Wait (instead of sleeping) until N relays have started since the check-up mark, or until max minutes pass, then return the summary since the mark.',
            parameters: { type: 'object', properties: { starts: { type: 'number', description: 'relays to wait for (default 10)' }, minutes: { type: 'number', description: 'give up after this long (default 8, at most 10)' } } },
            async execute(args) {
                const want = (args && args.starts) || 10, until = now() + Math.min(10, (args && args.minutes) || 8) * 60e3;
                if (!mark) { mark = { t: now(), label: '' }; await api.state.set('mark', mark); }
                while (now() < until) { poll(); if (summary('mark').starts >= want) break; await new Promise(r => setTimeout(r, 2000)); }
                const s = summary('mark');
                return (s.starts >= want ? `${s.starts} relays started.\n` : `Waited; only ${s.starts} of ${want} relays started.\n`) + text(s);
            } },
        { name: 'relay_recent', description: 'The latest relay starts, ends and swap results, newest first.',
            parameters: { type: 'object', properties: { limit: { type: 'number' } } },
            async execute(args) { poll(); const s = summary(win); const l = s.recent.slice(0, (args && args.limit) || 20); return l.length ? l.map(r => `${new Date(r.t).toLocaleTimeString()} #${r.cid} ${r.text}`).join('\n') : 'Nothing yet in ' + s.label + '.'; } },
    ],
};
