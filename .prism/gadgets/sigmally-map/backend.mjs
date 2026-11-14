// Sigmally map: reaches the Sigmally Lab's chat for the panel. The Lab answers chat requests only from this computer's
// programs (never from web pages), so the panel goes through here rather than fetching it itself.
const LAB = 'http://127.0.0.1:47800';

async function lab(path) {
    const r = await fetch(LAB + path, { cache: 'no-store' });
    if (!r.ok) throw new Error('Lab answered ' + r.status);
    return r.json();
}

export default {
    async start(api) { },
    async stop(api) { },
    handlers: {
        async chat({ since = 0 } = {}) {
            try { const j = await lab('/chat?since=' + Number(since || 0)); return { ok: true, t: j.t, lines: j.lines || [] }; }
            catch (e) { return { ok: false, error: 'Can\'t reach the Sigmally Lab' }; }
        },
        async servers() {
            try { return await lab('/servers'); } catch (e) { return { ok: false, error: 'Can\'t reach the Sigmally Lab' }; }
        },
        async switchTo({ url, ids } = {}) {
            if (!url) return { ok: false, error: 'No server picked' };
            const q = '/switch?url=' + encodeURIComponent(url) + (ids && ids.length ? '&ids=' + ids.map(Number).join(',') : '');
            try { return await lab(q); } catch (e) { return { ok: false, error: 'Can\'t reach the Sigmally Lab' }; }
        },
        async wiggle({ auto, now: id } = {}) {
            try {
                if (id) return await lab('/wiggle/now?id=' + Number(id));
                if (auto === true || auto === false) return await lab('/wiggle/set?auto=' + (auto ? 1 : 0));
                return await lab('/wiggle');
            } catch (e) { return { ok: false, error: 'Can\'t reach the Sigmally Lab' }; }
        },
        async captcha({ front } = {}) {
            try { return front ? await lab('/front?id=' + Number(front)) : await lab('/captcha'); }
            catch (e) { return { ok: false, error: 'Can\'t reach the Sigmally Lab' }; }
        },
        async wire({ since = 0 } = {}) {
            try { return await lab('/wire?since=' + Number(since || 0)); } catch (e) { return { ok: false, error: 'Can\'t reach the Sigmally Lab' }; }
        },
        async send({ id, text } = {}) {
            text = String(text || '').trim();
            if (!text) return { ok: false, error: 'Nothing to send' };
            try { return await lab('/chat/send?id=' + Number(id) + '&text=' + encodeURIComponent(text.slice(0, 120))); }
            catch (e) { return { ok: false, error: 'Can\'t reach the Sigmally Lab' }; }
        },
    },
};
