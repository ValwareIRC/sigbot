// deathview: the last ticks before the first bot death in a frsim/rsim FRAMES file - every bot's pieces (biggest
// first), aims and modes, and who ate what. usage: node deathview.js <frames.json> [ticksBefore=24] [step=2]
const F = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const before = +(process.argv[3] || 24), stepN = +(process.argv[4] || 2);
const bots = F.owners.filter(o => o.bot).map(o => o.name);
let death = null;
for (const f of F.frames) { for (const n of bots) if (!f.c.some(c => c[5] === n && c[4] === 'p')) { death = { n, t: f.t }; break; } if (death) break; }
if (!death) { console.log('nobody died'); process.exit(0); }
console.log(`${death.n} died at t${death.t} (${(death.t / 25).toFixed(1)} s)`);
for (const e of F.events.filter(e => { const t = +e.slice(1, e.indexOf(':')); return t > death.t - before && t <= death.t; })) console.log('  ' + e);
for (const f of F.frames) {
    if (f.t < death.t - before || f.t > death.t || (death.t - f.t) % stepN) continue;
    const parts = bots.map(n => {
        const cs = f.c.filter(c => c[5] === n && c[4] === 'p').sort((p, q) => q[3] - p[3]);
        return `${n}${cs.length}[${cs.slice(0, 5).map(c => `${c[1]},${c[2]}(${c[3]})`).join(' ')}] aim ${f.a && f.a[n] ? f.a[n].join(',') : '-'} "${(f.m[n] || '').replace('fast travel: ', '')}"`;
    });
    console.log(`t${f.t} ` + parts.join(' | '));
}
