// modes: share of bot-ticks per mode in a FRAMES file
const F = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8')); const h = {}; let n = 0;
for (const f of F.frames) for (const v of Object.values(f.m || {})) { const k = v.replace(/fast travel: /, '').replace(/\(.*\)/, '').replace(/[0-9]+/g, '#').trim(); h[k] = (h[k] || 0) + 1; n++; }
console.log(Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, +(process.argv[3] || 10)).map(([k, v]) => Math.round(100 * v / n) + '% ' + k).join('\n'));
