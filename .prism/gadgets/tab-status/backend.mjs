// Tab status: asks the Sigmally Lab bridge (127.0.0.1:47800/tabs) which game tabs are connected, what script version
// each runs and whether it answers a command; a tab that's behind the userscript file or silent stands out.
const LAB = 'http://127.0.0.1:47800';
const seen = new Map();   // browser -> last time it was connected (a tab that drops off the Lab still shows, as gone)
let last = { latest: '', t: 0, tabs: [], error: 'not checked yet' }, timer = null, busy = null;

const browserOf = ua => /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Electron|Prism/i.test(ua) ? 'Prism' : /Chrome\//.test(ua) ? 'Chrome' : '';
function verdict(tab, latest) {
    if (!tab.answers) return 'silent';
    if (latest && tab.version !== latest) return 'stale';
    return 'ok';
}
async function check(api) {
    if (busy) return busy;
    busy = (async () => {
        try {
            const r = await fetch(LAB + '/tabs', { signal: AbortSignal.timeout(10000) });
            if (!r.ok) throw new Error('the Lab answered ' + r.status + (r.status === 404 ? ' (restart the Sigmally Lab gadget)' : ''));
            const d = await r.json();
            d.tabs = d.tabs.filter(t => t.kind === 'browser').map(t => ({ ...t, browser: browserOf(t.ua), state: verdict(t, d.latest) }));
            const nowT = Date.now(), here = new Set(d.tabs.map(t => t.browser || t.name));
            for (const t of d.tabs) if (t.browser) seen.set(t.browser, { version: t.version, at: nowT });   // (only tabs we can name)
            for (const [br, s] of seen) {
                if (here.has(br)) continue;
                if (nowT - s.at > 2 * 3600e3) { seen.delete(br); continue; }
                d.tabs.push({ id: 0, browser: br, name: br, state: 'gone', version: s.version, hello: s.version, lastSeen: s.at, answers: false, ms: 0, mode: '', bot: null });
            }
            api.state.set('seen', [...seen]);
            last = { ...d, error: '' };
        } catch (e) {
            last = { ...last, t: Date.now(), error: /fetch failed|ECONNREFUSED/.test(String(e.message || e.cause)) ? 'the Sigmally Lab is not running (open it)' : String(e.message || e) };
        }
        api.emit('tabs', last);
        busy = null;
        return last;
    })();
    return busy;
}
function text(d) {
    if (d.error) return 'Tab status: ' + d.error;
    if (!d.tabs.length) return 'No game tabs connected. Userscript file is ' + d.latest + '.';
    const lines = d.tabs.map(t => `${t.id ? '#' + t.id + ' ' : ''}${t.browser || t.name}: ${t.state === 'gone' ? (t.version ? 'GONE from the Lab since ' + new Date(t.lastSeen).toLocaleTimeString() + ' (was ' + t.version + ')' : 'NOT CONNECTED to the Lab') : t.state === 'silent' ? 'FROZEN - not answering, last heard ' + Math.round((Date.now() - t.lastSeen) / 1000) + ' s ago (' + (t.hello || '?') + ')' : t.version + (t.state === 'stale' ? ' - STALE' : ' ok') + `, ${t.ms} ms`}` +
        `${t.bot === false ? ', bot off' : ''}${t.hidden ? ', hidden' : ''}${t.mode ? ', ' + t.mode : ''}`);
    const bad = d.tabs.filter(t => t.state !== 'ok').length;
    return `Userscript file: ${d.latest}. ${d.tabs.length} tab(s), ${bad ? bad + ' need attention' : 'all current'}:\n` + lines.join('\n');
}
async function swap(api, id) {
    try { const r = await fetch(LAB + '/tabs/swap?id=' + id, { signal: AbortSignal.timeout(8000) }); return await r.json(); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
}

export default {
    async start(api) { const saved = await api.state.get('seen', null);
        // the squad's four browsers are always expected, so one that never connects shows as gone too
        for (const [k, v] of saved || []) if (['Firefox', 'Chrome', 'Opera', 'Edge', 'Prism'].includes(k)) seen.set(k, v);
        for (const k of ['Firefox', 'Chrome', 'Opera', 'Edge']) if (!seen.has(k)) seen.set(k, { version: '', at: Date.now() }); check(api); timer = setInterval(() => check(api), 20000); },
    async stop() { clearInterval(timer); },
    handlers: {
        async state(_, api) { return last.t ? last : check(api); },
        async refresh(_, api) { return check(api); },
        async swap({ id }, api) { const r = await swap(api, id); setTimeout(() => check(api), 4000); return r; },
        async widget(_, api) {
            const d = last.t ? last : await check(api);
            if (d.error) return { title: 'Tabs', value: '?', detail: d.error };
            const bad = d.tabs.filter(t => t.state !== 'ok').length;
            return { title: 'Tabs', value: bad ? `${bad} need you` : 'all current', detail: `${d.tabs.length} tab(s), script ${d.latest}` };
        },
    },
    tools: [
        { name: 'tabs_check', description: 'Check every Mega Bot game tab now: script version vs the userscript file, whether it answers remote commands, response time, bot on/off.',
            parameters: { type: 'object', properties: {} },
            async execute(_, api) { return text(await check(api)); } },
        { name: 'tabs_swap_stale', description: 'Hot-swap the current userscript into every tab that answers but runs an older version (silent tabs cannot be swapped remotely), then re-check.',
            parameters: { type: 'object', properties: {} },
            async execute(_, api) {
                const d = await check(api);
                if (d.error) return { content: d.error, isError: true };
                const stale = d.tabs.filter(t => t.state === 'stale');
                if (!stale.length) return 'Nothing to swap.\n' + text(d);
                const res = [];
                for (const t of stale) { const r = await swap(api, t.id); res.push(`#${t.id} ${t.browser}: ${r.ok ? 'swapping' : r.error}`); }
                await new Promise(r => setTimeout(r, 5000));
                return res.join('\n') + '\n\nAfter:\n' + text(await check(api));
            } },
    ],
};
