// Tab status: asks the Sigmally Lab bridge (127.0.0.1:47800/tabs) which game tabs are connected, what script version
// each runs and whether it answers a command; a tab that's behind the userscript file or silent stands out.
// Tabs are tracked one by one (each has a lasting id kept in its own sessionStorage), so three Operas are three tabs:
// one that drops off the Lab shows as gone, and so does any missing from the usual number per browser.
const LAB = 'http://127.0.0.1:47800';
const seen = new Map();     // tab key -> { key, browser, first, at, version, mode }
let usual = {};             // browser -> { n: how many tabs we usually see, at: last time we saw that many }
let last = { latest: '', t: 0, tabs: [], error: 'not checked yet' }, timer = null, busy = null;
const KEEP_MS = 2 * 3600e3, USUAL_MS = 6 * 3600e3;

const browserOf = ua => /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Electron|Prism/i.test(ua) ? 'Prism' : /Chrome\//.test(ua) ? 'Chrome' : '';
function verdict(tab, latest) {
    if (!tab.answers) return 'silent';
    if (latest && tab.version !== latest) return 'stale';
    return 'ok';
}
// "Opera 2": numbered by when we first saw each tab of that browser (only when there's more than one)
function label(t, all) {
    const same = all.filter(x => x.browser === t.browser);
    if (same.length < 2) return t.browser || t.name;
    const order = same.slice().sort((a, b) => (a.first || 0) - (b.first || 0) || String(a.key).localeCompare(String(b.key)));
    return t.browser + ' ' + (order.indexOf(t) + 1);
}
async function check(api) {
    if (busy) return busy;
    busy = (async () => {
        try {
            const r = await fetch(LAB + '/tabs', { signal: AbortSignal.timeout(10000) });
            if (!r.ok) throw new Error('the Lab answered ' + r.status + (r.status === 404 ? ' (restart the Sigmally Lab gadget)' : ''));
            const d = await r.json(), nowT = Date.now();
            const live = d.tabs.filter(t => t.kind === 'browser').map(t => ({ ...t, browser: browserOf(t.ua), state: verdict(t, d.latest) }));
            for (const t of live) {
                const key = t.key || ('id' + t.id);
                const s = seen.get(key) || { key, browser: t.browser, first: nowT };
                Object.assign(s, { browser: t.browser || s.browser, at: nowT, version: t.version, mode: t.mode || '' });
                seen.set(key, s); t.key = key; t.first = s.first;
            }
            const here = new Set(live.map(t => t.key));
            const gone = [];
            for (const [k, s] of seen) {
                if (here.has(k)) continue;
                if (nowT - s.at > KEEP_MS) { seen.delete(k); continue; }
                gone.push({ id: 0, key: k, browser: s.browser, name: s.browser, first: s.first, state: 'gone', version: s.version, hello: s.version, lastSeen: s.at, lastMode: s.mode, answers: false, ms: 0, mode: '', bot: null });
            }
            // the usual number of tabs per browser: missing ones we never got an id for still show
            // tabs, not links: one page with several links (the 3.54.16 leak: 115 from one Firefox tab) is one tab
            const keysOf = {};
            for (const t of live) if (t.browser) (keysOf[t.browser] || (keysOf[t.browser] = new Set())).add(t.key);
            const count = {}; for (const [br, ks] of Object.entries(keysOf)) count[br] = ks.size;
            for (const [br, n] of Object.entries(count)) if (!usual[br] || n >= usual[br].n) usual[br] = { n, at: nowT };
            for (const [br, u] of Object.entries(usual)) {
                if (nowT - u.at > USUAL_MS) { usual[br] = { n: count[br] || 0, at: nowT }; continue; }
                const missing = u.n - (count[br] || 0) - gone.filter(g => g.browser === br).length;
                for (let i = 0; i < missing; i++) gone.push({ id: 0, key: 'missing-' + br + '-' + i, browser: br, name: br, first: Infinity, state: 'gone', version: '', hello: '', lastSeen: 0, answers: false, ms: 0, mode: '', bot: null, usual: u.n });
            }
            const tabs = live.concat(gone);
            for (const t of tabs) t.label = label(t, tabs);
            api.state.set('seen', [...seen]); api.state.set('usual', usual);
            last = { ...d, tabs, error: '' };
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
    const lines = d.tabs.map(t => `${t.id ? '#' + t.id + ' ' : ''}${t.label || t.browser || t.name}: ${t.state === 'gone' ? (t.lastSeen ? 'GONE from the Lab since ' + new Date(t.lastSeen).toLocaleTimeString() + (t.version ? ' (was ' + t.version + (t.lastMode ? ', ' + t.lastMode : '') + ')' : '') : 'NOT CONNECTED to the Lab' + (t.usual ? ' (usually ' + t.usual + ' ' + t.browser + ' tabs)' : '')) : t.state === 'silent' ? 'FROZEN - not answering, last heard ' + Math.round((Date.now() - t.lastSeen) / 1000) + ' s ago (' + (t.hello || '?') + ')' : t.version + (t.state === 'stale' ? ' - STALE' : ' ok') + `, ${t.ms} ms`}` +
        `${t.bot === false ? ', bot off' : ''}${t.hidden ? ', hidden' : ''}${t.mode ? ', ' + t.mode : ''}`);
    const bad = d.tabs.filter(t => t.state !== 'ok').length;
    return `Userscript file: ${d.latest}. ${d.tabs.length} tab(s), ${bad ? bad + ' need attention' : 'all current'}:\n` + lines.join('\n');
}
async function swap(api, id) {
    try { const r = await fetch(LAB + '/tabs/swap?id=' + id, { signal: AbortSignal.timeout(8000) }); return await r.json(); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
}

export default {
    async start(api) {
        const saved = await api.state.get('seen', null);
        for (const [k, v] of saved || []) if (v && typeof v === 'object' && v.key) seen.set(k, v);   // (older saves were per browser: dropped)
        usual = (await api.state.get('usual', null)) || {};
        if (Object.values(usual).some(u => !u || u.n > 12)) usual = {};   // (learned from the link leak: start over)
        if (!Object.keys(usual).length) usual = { Firefox: { n: 1, at: Date.now() }, Chrome: { n: 1, at: Date.now() }, Edge: { n: 1, at: Date.now() }, Opera: { n: 3, at: Date.now() } };
        check(api); timer = setInterval(() => check(api), 20000);
    },
    async stop() { clearInterval(timer); },
    handlers: {
        async state(_, api) { return last.t ? last : check(api); },
        async refresh(_, api) { return check(api); },
        async swap({ id }, api) { const r = await swap(api, id); setTimeout(() => check(api), 4000); return r; },
        async forget({ key }, api) { seen.delete(key); if (String(key).startsWith('missing-')) { const br = String(key).split('-')[1]; if (usual[br]) usual[br] = { n: Math.max(0, usual[br].n - 1), at: Date.now() }; } return check(api); },
        async widget(_, api) {
            const d = last.t ? last : await check(api);
            if (d.error) return { title: 'Tabs', value: '?', detail: d.error };
            const bad = d.tabs.filter(t => t.state !== 'ok').length;
            return { title: 'Tabs', value: bad ? `${bad} need you` : 'all current', detail: `${d.tabs.length} tab(s), script ${d.latest}` };
        },
    },
    tools: [
        { name: 'tabs_check', description: 'Check every Mega Bot game tab now: script version vs the userscript file, whether it answers remote commands, response time, bot on/off, and tabs that have dropped off.',
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
                for (const t of stale) { const r = await swap(api, t.id); res.push(`#${t.id} ${t.label || t.browser}: ${r.ok ? 'swapping' : r.error}`); }
                await new Promise(r => setTimeout(r, 5000));
                return res.join('\n') + '\n\nAfter:\n' + text(await check(api));
            } },
    ],
};
