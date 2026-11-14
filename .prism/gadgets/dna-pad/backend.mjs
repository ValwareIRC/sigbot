// DNA scratchpad: stores the user's demos (the simulation itself runs in the panel) and gives them to the agent.
import fs from 'node:fs';
import path from 'node:path';

let api;
const file = () => path.join(api.dataDir, 'demos.json');
function load() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (_) { return []; } }
function save(list) { fs.mkdirSync(api.dataDir, { recursive: true }); fs.writeFileSync(file(), JSON.stringify(list, null, 1)); }

const deg = a => Math.round(a);
function side(a) { const x = ((a % 360) + 540) % 360 - 180; return x === 0 ? 'straight ahead' : Math.abs(x) === 180 ? 'straight back' : `${Math.abs(x)}° ${x > 0 ? 'right' : 'left'} of the travel direction`; }
function recipe(d) {
    const L = [];
    L.push(`Demo "${d.name}" (saved ${new Date(d.saved).toLocaleString()})`);
    if (d.note) L.push(`User's note: ${d.note}`);
    L.push(`Travel direction: up. Start: A ${d.setup.massA} mass, B ${d.setup.massB} mass; B starts ${Math.round(d.setup.bRight)} to the ${d.setup.bRight >= 0 ? 'right' : 'left'} of A and ${Math.round(Math.abs(d.setup.bAhead))} ${d.setup.bAhead >= 0 ? 'ahead' : 'behind'}.`);
    L.push('Steps (aim = where that player points, from its centre of mass; partner = where the other player was at that moment):');
    for (const s of d.steps) {
        const r = s.rel || {};
        L.push(`  ${s.t.toFixed(2)} s  ${s.who} ${s.action === 'split' ? 'SPLITS toward' : 'aims at'} ${side(r.aimDeg ?? 0)}, ${Math.round(r.aimDist ?? 0)} away` +
            (r.partnerDeg !== undefined ? `; partner at ${side(r.partnerDeg)}, ${Math.round(r.partnerDist)} away` : '') +
            (r.pieces !== undefined ? `; ${s.who} had ${r.pieces} piece(s), ${Math.round(r.mass)} mass` : '') +
            (s.keep === false ? '; then it goes to that point and stops' : '; then it keeps going that way'));
    }
    const o = d.outcome || {};
    if (o.eats && o.eats.length) { L.push('What got eaten:'); for (const e of o.eats) L.push(`  ${e.t.toFixed(2)} s  ${e.text}`); }
    else L.push('Nothing got eaten.');
    if (o.end) L.push(`End (${o.end.t.toFixed(1)} s): A ${o.end.massA} mass in ${o.end.piecesA} piece(s), B ${o.end.massB} in ${o.end.piecesB}; the pair moved ${o.end.forward} forward (just moving would be ${o.end.plainForward}).`);
    return L.join('\n');
}

export default {
    async start(a) { api = a; },
    async stop() { },
    handlers: {
        async list() { return load(); },
        async save(d) {
            const list = load().filter(x => x.name !== d.name);
            list.push({ ...d, saved: Date.now() });
            save(list);
            api.emit('demos', list);
            return list;
        },
        async remove({ name }) { const list = load().filter(x => x.name !== name); save(list); api.emit('demos', list); return list; },
    },
    tools: [
        { name: 'dna_demos', description: "The user's saved DNA demos as step-by-step recipes (who splits when, aim angles relative to the travel direction and the partner, piece counts), what got eaten, how far the pair got, and the user's notes.",
            parameters: { type: 'object', properties: { name: { type: 'string', description: 'one demo (default: all, newest first)' } } },
            async execute(args) {
                let list = load().sort((a, b) => b.saved - a.saved);
                if (args && args.name) list = list.filter(d => d.name === args.name);
                return list.length ? list.map(recipe).join('\n\n') : 'No demos saved yet.';
            } },
    ],
};
