// frbatch: run a frsim scene over many seeds (several at once) and summarise.
// usage: node frbatch.js <userscript> <scene> [seeds=24] [seconds=16] [parallel=6]   env: CFG passes through
const { spawn } = require('child_process');
const [script, scene] = [process.argv[2], process.argv[3] || 'fast'];
const N = +(process.argv[4] || 24), SECS = process.argv[5] || '16', PAR = +(process.argv[6] || 6);
const results = [];
let next = 1, running = 0;
function launch() {
    while (running < PAR && next <= N) {
        const sd = next++; running++;
        const p = spawn(process.execPath, [__dirname + '/frsim.js', script, scene, SECS], { env: { ...process.env, SEED: String(sd) } });
        let out = '';
        p.stdout.on('data', d => out += d);
        p.on('close', () => {
            running--;
            const line = out.split('\n').find(l => l.startsWith('RESULT '));
            if (line) results.push(JSON.parse(line.slice(7))); else results.push({ seed: sd, error: true });
            if (results.length === N) report(); else launch();
        });
    }
}
function report() {
    const ok = results.filter(r => !r.error);
    const both = ok.filter(r => r.alive === r.of);
    const ratio = r => r.moved.reduce((a, b) => a + b, 0) / r.walk.reduce((a, b) => a + b, 0);
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const deaths = ok.filter(r => r.death).map(r => r.death.t / 25);
    console.log(`${scene}: all alive ${both.length}/${ok.length}` + (ok.length < N ? ` (${N - ok.length} errors)` : '') +
        ` | travel vs walking: ${avg(ok.map(ratio)).toFixed(2)}x all, ${avg(both.map(ratio)).toFixed(2)}x when all alive` +
        ` | handoffs ${avg(ok.map(r => r.handoffs)).toFixed(1)} | splits ${avg(ok.map(r => r.splits)).toFixed(1)}` +
        ` | team ${Math.round(avg(ok.map(r => r.team)))} | still splitting at the end: ${ok.filter(r => r.lastSplit >= +SECS - 3).length}/${ok.length}` + ` | jitter ${avg(ok.map(r => (r.jitter || []).reduce((a, b) => a + b, 0) / (r.of || 1))).toFixed(1)} s/bot` + ` | frozen ${avg(ok.map(r => (r.frozen || []).reduce((a, b) => a + b, 0) / (r.of || 1))).toFixed(1)} s/bot` + (deaths.length ? ` | first death at ${avg(deaths).toFixed(1)} s avg` : ''));
    if (process.env.V) for (const r of ok.sort((a, b) => a.seed - b.seed)) console.log(`  seed ${r.seed}: alive ${r.alive}/${r.of} moved ${r.moved.join('/')} handoffs ${r.handoffs}` + (r.death ? ` ${r.death.n} died ${(r.death.t / 25).toFixed(1)}s while ${JSON.stringify(r.death.modes || {})}` : ''));
}
launch();
