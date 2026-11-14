// Say it: speaks typed text out loud on this computer with the Windows voices (System.Speech), through a small
// PowerShell script. The text goes over in a file, never on the command line, so any characters are fine.
import fs from 'node:fs';
import path from 'node:path';

let api, current = null, history = [];
const PS1 = `param([string]$TextFile, [string]$Voice, [int]$Rate, [int]$Volume, [string]$Wav)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($Voice) { try { $s.SelectVoice($Voice) } catch { } }
$s.Rate = $Rate
$s.Volume = $Volume
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
if ($Wav) { $s.SetOutputToWaveFile($Wav); $s.Speak($text); $s.SetOutputToDefaultAudioDevice() }
$s.Speak($text)
$s.Dispose()
`;
const VOICES_PS = `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture + '|' + $_.VoiceInfo.Gender }`;
let voices = null;

async function listVoices() {
    if (voices) return voices;
    const f = path.join(api.dataDir, 'voices.ps1');
    fs.writeFileSync(f, VOICES_PS);
    const r = await api.shell(`powershell -NoProfile -ExecutionPolicy Bypass -File "${f}"`, { timeoutMs: 30000 });
    voices = String(r.stdout || '').split(/\r?\n/).filter(Boolean).map(l => { const [name, culture, gender] = l.split('|'); return { name, culture, gender }; });
    return voices;
}
function stop() { if (current) { try { current.kill(); } catch (_) { } current = null; api.emit('state', { speaking: false }); } }
async function say({ text, voice = '', rate = 0, volume = 100, save = false }) {
    text = String(text || '').trim();
    if (!text) return { error: 'Nothing to say.' };
    if (text.length > 2000) text = text.slice(0, 2000);
    stop();
    fs.mkdirSync(api.dataDir, { recursive: true });
    const ps1 = path.join(api.dataDir, 'say.ps1'), tf = path.join(api.dataDir, 'text.txt');
    fs.writeFileSync(ps1, PS1); fs.writeFileSync(tf, text, 'utf8');
    let wav = '';
    if (save) { const dl = path.join(process.env.USERPROFILE || api.dataDir, 'Downloads'); wav = path.join(fs.existsSync(dl) ? dl : api.dataDir, 'say-' + text.replace(/[^a-z0-9]+/gi, '-').slice(0, 30).replace(/-+$/, '') + '.wav'); }
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-TextFile', tf, '-Voice', voice, '-Rate', String(Math.max(-10, Math.min(10, +rate || 0))), '-Volume', String(Math.max(0, Math.min(100, +volume || 100)))];
    if (wav) args.push('-Wav', wav);
    const p = api.spawn('powershell', args, { onExit: () => { if (current === p) { current = null; api.emit('state', { speaking: false }); } } });
    current = p;
    history = [{ text, voice, rate, at: Date.now() }, ...history.filter(h => h.text !== text)].slice(0, 20);
    api.state.set('history', history);
    api.emit('state', { speaking: true, history });
    return { ok: true, wav: wav || null };
}

export default {
    async start(a) { api = a; history = (await api.state.get('history', [])) || []; },
    async stop() { stop(); },
    handlers: {
        async info() { return { voices: await listVoices(), history, speaking: !!current }; },
        async say(args) { return say(args || {}); },
        async stop() { stop(); return true; },
        async clear() { history = []; api.state.set('history', history); api.emit('state', { history, speaking: !!current }); return true; },
    },
    tools: [
        { name: 'say_out_loud', description: 'Say something out loud on this computer with a Windows voice. voice: a name from say_voices (default the system voice); rate -10..10; volume 0..100; save: also write a WAV to Downloads.',
            parameters: { type: 'object', properties: { text: { type: 'string' }, voice: { type: 'string' }, rate: { type: 'number' }, volume: { type: 'number' }, save: { type: 'boolean' } }, required: ['text'] },
            async execute(args) { const r = await say(args); return r.error ? { content: r.error, isError: true } : 'Speaking.' + (r.wav ? ' Saved to ' + r.wav : ''); } },
        { name: 'say_voices', description: 'The voices installed on this computer.', parameters: { type: 'object', properties: {} },
            async execute() { return (await listVoices()).map(v => `${v.name} (${v.culture}, ${v.gender})`).join('\n'); } },
        { name: 'say_stop', description: 'Stop speaking.', parameters: { type: 'object', properties: {} }, async execute() { stop(); return 'Stopped.'; } },
    ],
};
