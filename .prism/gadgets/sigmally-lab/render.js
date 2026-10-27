(function (root) {
// Draws one snapshot from the bot (what it sees) as an SVG string. Shared by the panel and the backend.
// cells: [id, x, y, size, role, name?]; roles: 0 me, 1 threat, 2 prey, 3 virus, 4 blob, 5 master, 6 neutral, 7 pellet
const ROLE_COLORS = ['#5ab4ff', '#ff5d6c', '#6fdc8c', '#2fbf4a', '#ffd166', '#c792ea', '#98a2b3', '#4b5563', '#7ee8fa'];
const ROLE_NAMES = ['me', 'threat', 'prey', 'virus', 'mass blob', 'master', 'player', 'pellet', 'teammate'];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderSnapshot(snap, opts = {}) {
    const W = opts.width || 900, H = opts.height || 600;
    if (!snap || !snap.cells || !snap.cells.length)
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#0b0f17"/>` +
            `<text x="${W / 2}" y="${H / 2}" fill="#98a2b3" font-family="sans-serif" font-size="16" text-anchor="middle">${esc(opts.empty || 'Waiting for the game…')}</text></svg>`;
    // frame the view: everything that isn't a pellet, plus a margin
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of snap.cells) {
        if (c[4] === 7) continue;
        minX = Math.min(minX, c[1] - c[3]); maxX = Math.max(maxX, c[1] + c[3]);
        minY = Math.min(minY, c[2] - c[3]); maxY = Math.max(maxY, c[2] + c[3]);
    }
    if (!isFinite(minX)) { const c = snap.cells[0]; minX = c[1] - 1000; maxX = c[1] + 1000; minY = c[2] - 700; maxY = c[2] + 700; }
    const cx = snap.center ? snap.center.x : (minX + maxX) / 2, cy = snap.center ? snap.center.y : (minY + maxY) / 2;
    let halfW = Math.max(cx - minX, maxX - cx, 900) * 1.08, halfH = Math.max(cy - minY, maxY - cy, 600) * 1.08;
    if (halfW / halfH > W / H) halfH = halfW * H / W; else halfW = halfH * W / H;
    const k = W / (2 * halfW);
    const X = x => ((x - cx) * k + W / 2).toFixed(1), Y = y => ((y - cy) * k + H / 2).toFixed(1), Rd = r => Math.max(1.2, r * k).toFixed(1);
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,sans-serif">`,
        `<rect width="100%" height="100%" fill="#0b0f17"/>`];
    // grid every 500 units, and the map border
    const g0x = Math.floor((cx - halfW) / 500) * 500, g0y = Math.floor((cy - halfH) / 500) * 500;
    for (let x = g0x; x < cx + halfW; x += 500) out.push(`<line x1="${X(x)}" y1="0" x2="${X(x)}" y2="${H}" stroke="#141b27"/>`);
    for (let y = g0y; y < cy + halfH; y += 500) out.push(`<line x1="0" y1="${Y(y)}" x2="${W}" y2="${Y(y)}" stroke="#141b27"/>`);
    if (snap.border) {
        const b = snap.border;
        out.push(`<rect x="${X(b.minX)}" y="${Y(b.minY)}" width="${((b.maxX - b.minX) * k).toFixed(1)}" height="${((b.maxY - b.minY) * k).toFixed(1)}" fill="none" stroke="#7c5c2a" stroke-width="2"/>`);
    }
    // small things first, big on top; me last
    const order = [7, 4, 6, 2, 3, 1, 5, 0];
    const sorted = snap.cells.slice().sort((a, b) => order.indexOf(a[4]) - order.indexOf(b[4]) || a[3] - b[3]);
    for (const c of sorted) {
        const col = ROLE_COLORS[c[4]] || '#98a2b3';
        if (c[4] === 7) { out.push(`<circle cx="${X(c[1])}" cy="${Y(c[2])}" r="${Rd(c[3])}" fill="${col}"/>`); continue; }
        if (c[4] === 3) { out.push(`<circle cx="${X(c[1])}" cy="${Y(c[2])}" r="${Rd(c[3])}" fill="${col}33" stroke="${col}" stroke-width="2" stroke-dasharray="4 3"/>`); continue; }
        out.push(`<circle cx="${X(c[1])}" cy="${Y(c[2])}" r="${Rd(c[3])}" fill="${col}${c[4] === 0 ? 'cc' : '88'}" stroke="${col}" stroke-width="${c[4] === 0 ? 2.5 : 1.5}"/>`);
        if (c[5] && c[3] * k > 9) {
            const fs = Math.min(16, Math.max(9, c[3] * k * 0.35));
            out.push(`<text x="${X(c[1])}" y="${(+Y(c[2]) + fs * 0.35).toFixed(1)}" fill="#e6edf3" font-size="${fs.toFixed(0)}" text-anchor="middle">${esc(c[5].slice(0, 16))}</text>`);
        }
    }
    // where the bot is steering
    if (snap.aim && snap.center) out.push(`<line x1="${X(snap.center.x)}" y1="${Y(snap.center.y)}" x2="${X(snap.aim[0])}" y2="${Y(snap.aim[1])}" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2" stroke-dasharray="6 5"/>`,
        `<circle cx="${X(snap.aim[0])}" cy="${Y(snap.aim[1])}" r="5" fill="#ffffff" fill-opacity="0.7"/>`);
    if (!opts.bare) {
        const label = `${snap.mode || '—'} · mass ${snap.mass ?? '?'} · ${snap.pieces ?? 0} piece(s) · danger ${snap.danger ?? 0}`;
        out.push(`<rect x="8" y="8" width="${Math.min(W - 16, 12 + label.length * 7.4)}" height="26" rx="6" fill="#000000" fill-opacity="0.6"/>`,
            `<text x="16" y="26" fill="#e6edf3" font-size="13">${esc(label)}</text>`);
        if (opts.caption) out.push(`<rect x="8" y="${H - 34}" width="${Math.min(W - 16, 12 + opts.caption.length * 7.4)}" height="26" rx="6" fill="#000000" fill-opacity="0.6"/>`,
            `<text x="16" y="${H - 16}" fill="#ffd166" font-size="13">${esc(opts.caption)}</text>`);
    }
    out.push('</svg>');
    return out.join('');
}

// one-line description of a frame, for text tools: nearest threats and prey with distances
function describeSnapshot(snap) {
    if (!snap || !snap.center) return 'no data';
    const c = snap.center, near = role => snap.cells.filter(x => x[4] === role)
        .map(x => ({ name: x[5] || '?', s: x[3], d: Math.round(Math.hypot(x[1] - c.x, x[2] - c.y) - x[3]) }))
        .sort((a, b) => a.d - b.d).slice(0, 3);
    const fmt = l => l.map(x => `${x.name}(${x.s}) ${x.d} away`).join(', ') || 'none';
    const v = snap.cells.filter(x => x[4] === 3).length;
    return `mode ${snap.mode}, mass ${snap.mass} in ${snap.pieces} piece(s), danger ${snap.danger}; threats: ${fmt(near(1))}; prey: ${fmt(near(2))}; viruses in view: ${v}`;
}

root.SigRender = { renderSnapshot, describeSnapshot, ROLE_COLORS, ROLE_NAMES };
})(typeof globalThis !== "undefined" ? globalThis : window);
