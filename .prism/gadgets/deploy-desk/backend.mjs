// Deploy desk: which userscript version the file has, which version each game tab runs, and one button that
// hot-swaps the file into every answering tab through the Lab and verifies each came back on the new version.
// It never edits the userscript - bumping VERSION stays with the release itself.
import fs from 'node:fs';
import path from 'node:path';

const LAB = 'http://127.0.0.1:47800';
let api, history = [], busy = false, lastTabs = null;

const browserOf = ua => /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Electron|Prism/i.test(ua) ? 'Prism' : /Chrome\//.test(ua) ? 'Chrome' : '';
const versionOf = f => { try { return (/const VERSION = '([^']+)'/.exec(fs.readFileSync(f, 'utf8')) || [])[1] || ''; } catch (_) { return ''; } };
const ago = t => t ? Math.round((Date.now() - t) / 60000) + ' min ago' : '';

function scriptPaths() {
    const la = process.env.LOCALAPPDATA || '';
    return {
        live: [process.env.MEGABOT_USERSCRIPT, la && path.join(la, 'sighack_live', 'sigmally-mega-bot.user.js'),
            api.root && path.resolve(api.root, '..', 'sighack_live', 'sigmally-mega-bot.user.js')]
            .filter(Boolean).find(f => fs.existsSync(f)) || null,
        workspace: api.root ? path.join(api.root, 'userscript', 'sigmally-mega-bot.user.js') : null,
    };
}
function backups(livePath) {
    const dir = livePath && path.dirname(livePath);
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).map(f => /^backup-(.+)\.user\.js$/.exec(f)).filter(Boolean).map(m => {
        const p = path.join(dir, m[0]);
        return { v: m[1], t: fs.statSync(p).mtimeMs };
    }).sort((a, b) => b.t - a.t).slice(0, 12);
}
async function fetchTabs() {
    try {
        const r = await fetch(LAB + '/tabs', { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error('the Lab answered ' + r.status);
        const d = await r.json();
        d.tabs = (d.tabs || []).filter(t => t.kind === 'browser').map(t => ({
            ...t, browser: browserOf(t.ua || ''),
            state: !t.answers ? 'silent' : (d.latest && t.version !== d.latest ? 'stale' : 'ok'),
        }));
        lastTabs = { ...d, t: Date.now(), error: '' };
        return lastTabs;
    } catch (e) {
        return { error: /fetch failed|ECONNREFUSED/.test(String(e.message || e.cause)) ? 'the Sigmally Lab is not running (open the Sigmally Lab gadget)' : String(e.message || e) };
    }
}
function snapshot() {
    const p = scriptPaths();
    let live = null, ws = null;
    if (p.live) { const st = fs.statSync(p.live); live = { path: p.live, version: versionOf(p.live), t: st.mtimeMs, size: st.size }; }
    if (p.workspace && fs.existsSync(p.workspace)) ws = { path: p.workspace, version: versionOf(p.workspace) };
    return { live, workspace: ws, backups: backups(p.live), history };
}

async function deploy() {
    if (busy) return { ok: false, error: 'a deploy is already going' };
    busy = true;
    try {
        const first = await fetchTabs();
        if (first.error) return { ok: false, error: first.error };
        const targets = first.tabs.filter(t => t.answers);
        if (!targets.length) return { ok: false, error: 'no game tab is answering commands' };
        const latest = first.latest || '';
        api.emit('deploy', { phase: 'swap', of: targets.length, done: 0, latest });
        let i = 0;
        for (const t of targets) {
            try { await fetch(`${LAB}/tabs/swap?id=${t.id}`, { signal: AbortSignal.timeout(8000) }); } catch (_) { }
            api.emit('deploy', { phase: 'swap', of: targets.length, done: ++i, latest });
        }
        api.emit('deploy', { phase: 'wait', of: targets.length, done: targets.length, latest });
        let after = first;
        for (let k = 0; k < 10; k++) {
            await new Promise(r => setTimeout(r, 2500));
            after = await fetchTabs();
            if (after.error) break;
            if (after.tabs.every(t => !t.answers || t.version === latest)) break;
            api.emit('deploy', { phase: 'wait', of: targets.length, done: targets.length, try: k + 1, latest });
        }
        const rows = targets.map(t => {
            const a = after.tabs ? after.tabs.find(x => x.id === t.id) : null;
            const verdict = !a ? 'gone' : !a.answers ? 'silent' : (latest && a.version !== latest ? 'still old' : 'swapped');
            return { id: t.id, browser: t.browser || t.name || '', from: t.version, to: a ? a.version : '', verdict };
        });
        const rec = { t: Date.now(), latest, rows };
        history.unshift(rec); if (history.length > 25) history.length = 25;
        api.state.set('history', history);
        api.emit('deployed', rec);
        return { ok: rows.every(r => r.verdict === 'swapped'), latest, rows };
    } finally { busy = false; }
}

function statusText() {
    const snap = snapshot();
    const L = [];
    if (!snap.live) L.push('No live userscript file found.');
    else L.push(`Live file: ${snap.live.version} (${ago(snap.live.t)}, ${Math.round(snap.live.size / 1024)} KB) at ${snap.live.path}`);
    if (snap.workspace) L.push(`Workspace copy: ${snap.workspace.version || '?'}${snap.live && snap.workspace.version && snap.workspace.version !== snap.live.version ? '  (DIFFERENT from live)' : ''}`);
    if (snap.backups.length) L.push('Backups: ' + snap.backups.slice(0, 6).map(b => b.v).join(', '));
    L.push('');
    const d = lastTabs || {};
    if (d.error) L.push('Tabs: ' + d.error);
    else if (!d.tabs) L.push('Tabs: not checked yet.');
    else {
        L.push(`Tabs (file ${d.latest}):`);
        for (const t of d.tabs) L.push(`  #${t.id} ${t.browser}: ${t.version || '?'} ${t.state === 'ok' ? 'ok' : t.state === 'stale' ? 'STALE' : 'not answering'}${t.mode ? ', ' + t.mode : ''}${t.mass ? ', ' + t.mass + ' mass' : ''}`);
    }
    if (history.length) {
        L.push('');
        L.push('Deploys:');
        for (const r of history.slice(0, 3)) L.push(`  ${new Date(r.t).toLocaleTimeString()} ${r.latest}: ` + r.rows.map(x => `${x.browser} ${x.verdict}`).join(', '));
    }
    return L.join('\n');
}

export default {
    async start(a) {
        api = a;
        history = (await api.state.get('history', null)) || [];
    },
    handlers: {
        async state() { return { ...snapshot(), tabs: lastTabs }; },
        async refresh() { return { ...snapshot(), tabs: await fetchTabs() }; },
        async deploy() { return deploy(); },
        async widget() {
            const d = lastTabs;
            if (!d) return { title: 'Deploy', value: '?', detail: 'not checked yet' };
            if (d.error) return { title: 'Deploy', value: '?', detail: d.error };
            const bad = d.tabs.filter(t => t.state !== 'ok').length;
            return { title: 'Deploy', value: bad ? `${bad} stale/silent` : 'all current', detail: `file ${d.latest || '?'} · ${d.tabs.length} tab(s)` };
        },
    },
    tools: [{
        name: 'deploy_status',
        description: 'Userscript versions: the live file, the workspace copy, the kept backups, and each game tab (version, answering, mode). Plus recent deploys.',
        parameters: { type: 'object', properties: {} },
        async execute(_, ap) { api = api || ap; lastTabs = await fetchTabs(); return statusText(); },
    }, {
        name: 'deploy_run',
        description: 'Hot-swap the current userscript file into every answering game tab (through the Lab), wait, and verify each tab came back on the new version and still answers. Does not edit the file - bump VERSION first if this is a release.',
        parameters: { type: 'object', properties: {} },
        async execute(_, ap) {
            api = api || ap;
            const r = await deploy();
            if (r.error) return { content: r.error, isError: true };
            return `Deploy ${r.latest}: ` + r.rows.map(x => `${x.browser} #${x.id} ${x.from} → ${x.to || '?'} (${x.verdict})`).join('; ');
        },
    }],
};
