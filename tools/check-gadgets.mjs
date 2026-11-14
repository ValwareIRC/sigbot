// check-gadgets: run this when the Prism gadgets of this repo do not show up or do not start on a machine.
// usage (from anywhere): node tools/check-gadgets.mjs
// It checks the three things that go wrong: the folder Prism has open, the gadget files themselves, and the Lab's
// packages. It changes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gdir = path.join(root, '.prism', 'gadgets');
let bad = 0;
const ok = t => console.log('  ok   ' + t), no = (t, fix) => { bad++; console.log('  NO   ' + t + (fix ? '\n       -> ' + fix : '')); };

console.log('\n1. The folder to open in Prism');
console.log('  Prism only looks for project gadgets in  <the folder you opened>/.prism/gadgets/<name>/gadget.json');
console.log('  so the folder to open is exactly:\n\n       ' + root + '\n');
console.log('  (not its parent, not a folder inside it. A ZIP download often unpacks to sigbot-main/sigbot-main: open the inner one.)');
if (fs.existsSync(gdir)) ok('.prism/gadgets is here'); else no('.prism/gadgets is missing from this copy', 'the copy was made without hidden folders: clone with git, or unpack the ZIP with hidden files shown');

console.log('\n2. The gadgets');
const names = fs.existsSync(gdir) ? fs.readdirSync(gdir).filter(n => fs.statSync(path.join(gdir, n)).isDirectory()) : [];
let found = 0;
for (const n of names) {
    const mf = path.join(gdir, n, 'gadget.json');
    if (!fs.existsSync(mf)) { no(n + ': no gadget.json'); continue; }
    let m;
    try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { no(n + ': gadget.json does not parse (' + e.message + ')', 'Prism skips a gadget whose gadget.json is not valid JSON, without saying so'); continue; }
    const miss = [m.ui || 'index.html', m.backend].filter(Boolean).filter(f => !fs.existsSync(path.join(gdir, n, f)));
    if (miss.length) { no(n + ': missing ' + miss.join(', ')); continue; }
    found++;
    const deps = Object.keys(m.dependencies || {}), lack = deps.filter(d => !fs.existsSync(path.join(gdir, n, 'node_modules', d)));
    if (lack.length) console.log('  ..   ' + (m.name || n) + ': packages not installed yet (' + lack.join(', ') + '). Prism installs them the first time the gadget opens; or: cd ' + path.join('.prism', 'gadgets', n) + ' && npm install');
    else ok((m.name || n) + (deps.length ? ' (packages installed)' : ''));
}
console.log('  ' + found + ' of ' + names.length + ' gadget folders are complete');

console.log('\n3. Node and npm (gadget backends are Node programs; the Lab needs npm for its packages)');
try { ok('node ' + process.version); const v = +process.versions.node.split('.')[0]; if (v < 20) no('node is older than 20', 'install a current Node.js'); } catch (_) { }
try { ok('npm ' + execSync('npm --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch (_) { no('npm was not found', 'install Node.js (it brings npm), then restart Prism'); }

console.log('\n4. The bot and the Lab');
const us = path.join(root, 'userscript', 'sigmally-mega-bot.user.js');
if (fs.existsSync(us)) ok('bot file: version ' + ((/@version\s+(\S+)/.exec(fs.readFileSync(us, 'utf8')) || [])[1] || '?') + ' (install this one in Tampermonkey: the game tab and the Lab must be from the same copy)');
else no('userscript/sigmally-mega-bot.user.js is missing');
console.log('  The game tab reaches the Lab at ws://127.0.0.1:47800. If the Lab shows no game: open the Sigmally Lab panel first,\n  reload the game tab, and allow the browser\'s "local network" question for one.sigmally.com if it asks.');
console.log('  The arena and the sims also need the server code: git clone https://github.com/8y8x/sig-server  (into this folder).');

console.log(bad ? '\n' + bad + ' thing(s) to fix above.\n' : '\nNothing wrong in this copy. If the gadgets still do not show, the folder open in Prism is not the one in step 1.\n');
process.exit(bad ? 1 : 0);
