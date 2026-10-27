// Friends & foes: edits the Sigmally Lab's shared lists (friends, enemies, VIP) over its local HTTP endpoint;
// the Lab hands them to every game tab. Names are exact (as shown in the game).
const LAB = 'http://127.0.0.1:47800';
let last = { error: 'not loaded yet', friends: [], enemies: [], vipName: '', vipMode: '', seen: [] }, timer = null;

async function get(api) {
    try {
        const r = await fetch(LAB + '/lists', { signal: AbortSignal.timeout(6000) });
        if (r.status === 404) throw new Error('the Lab is too old for lists (it restarts by itself after an update)');
        last = { ...(await r.json()), error: '' };
    } catch (e) { last = { ...last, error: /fetch failed|ECONNREFUSED/.test(String(e.message || e.cause)) ? 'the Sigmally Lab is not running (open it)' : String(e.message || e) }; }
    api.emit('lists', last);
    return last;
}
async function put(api, l) {
    const data = { friends: l.friends ?? last.friends, enemies: l.enemies ?? last.enemies, vipName: l.vipName ?? last.vipName, vipMode: l.vipMode ?? last.vipMode };
    try {
        const r = await fetch(LAB + '/lists/set?data=' + encodeURIComponent(JSON.stringify(data)), { signal: AbortSignal.timeout(6000) });
        last = { ...(await r.json()), error: '' };
    } catch (e) { last = { ...last, error: String(e.message || e) }; }
    api.emit('lists', last);
    return last;
}
const clean = n => String(n || '').slice(0, 40);
function add(list, name) { name = clean(name); return name ? [...new Set([...(list || []), name])] : list; }
async function setRole(api, name, role) {
    name = clean(name); if (!name) return last;
    const friends = (last.friends || []).filter(x => x !== name), enemies = (last.enemies || []).filter(x => x !== name);
    if (role === 'friend') friends.push(name);
    if (role === 'enemy') enemies.push(name);
    const out = { friends, enemies };
    if (role !== 'friend' && last.vipName === name) { out.vipName = ''; out.vipMode = ''; }
    return put(api, out);
}
function text(d) {
    if (d.error) return 'Friends & foes: ' + d.error;
    return `VIP: ${d.vipName && d.vipMode ? d.vipName + ' (' + d.vipMode + ')' : 'none'}\nFriends (${d.friends.length}): ${d.friends.join(', ') || '-'}\nEnemies (${d.enemies.length}): ${d.enemies.join(', ') || '-'}\nGame tabs getting them: ${d.tabs}`;
}

export default {
    async start(api) { get(api); timer = setInterval(() => get(api), 15000); },
    async stop() { clearInterval(timer); },
    handlers: {
        async state(_, api) { return get(api); },
        async role({ name, role }, api) { return setRole(api, name, role); },
        async vip({ name, mode }, api) {
            name = clean(name);
            if (!mode || !name) return put(api, { vipName: '', vipMode: '' });
            // the VIP is a friend too
            const friends = add(last.friends, name), enemies = (last.enemies || []).filter(x => x !== name);
            return put(api, { friends, enemies, vipName: name, vipMode: mode });
        },
        async widget(_, api) {
            const d = last.t || !last.error ? last : await get(api);
            if (d.error) return { title: 'Friends & foes', value: '?', detail: d.error };
            return { title: 'Friends & foes', value: d.vipName && d.vipMode ? (d.vipMode === 'feed' ? 'feeding ' : 'protecting ') + d.vipName : `${d.friends.length} / ${d.enemies.length}`, detail: `${d.friends.length} friends · ${d.enemies.length} enemies` };
        },
    },
    tools: [
        { name: 'foes_lists', description: 'Show the Sigmally friends list (never targeted), enemies list (go after) and the VIP all bots feed or protect.',
            parameters: { type: 'object', properties: {} },
            async execute(_, api) { return text(await get(api)); } },
        { name: 'foes_set', description: "Put a player (exact in-game name) on a list: role 'friend', 'enemy' or 'none'.",
            parameters: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string', enum: ['friend', 'enemy', 'none'] } }, required: ['name', 'role'] },
            async execute({ name, role }, api) { await get(api); return text(await setRole(api, name, role)); } },
        { name: 'foes_vip', description: "Make a player the VIP: mode 'feed' (every bot keeps diving into them), 'protect' (bots guard them), or '' to stop.",
            parameters: { type: 'object', properties: { name: { type: 'string' }, mode: { type: 'string', enum: ['feed', 'protect', ''] } }, required: ['mode'] },
            async execute({ name, mode }, api) {
                await get(api);
                if (mode && !name) return { content: 'give the player name', isError: true };
                if (!mode) return text(await put(api, { vipName: '', vipMode: '' }));
                const friends = add(last.friends, name), enemies = (last.enemies || []).filter(x => x !== name);
                return text(await put(api, { friends, enemies, vipName: clean(name), vipMode: mode }));
            } },
    ],
};
