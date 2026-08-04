const axios = require('axios');

const LX_EVENT_NAMES = {
    inited: 'inited',
    request: 'request',
};

const METING_SERVER_MAP = {
    wy: 'netease',
    kw: 'kuwo',
    kg: 'kugou',
    tx: 'tencent',
    mg: 'tencent',
};

const SOURCE_NAME_MAP = {
    wy: '网易云(LX)',
    kw: '酷我(LX)',
    kg: '酷狗(LX)',
    tx: 'QQ音乐(LX)',
    mg: '咪咕(LX)',
};

const LX_SOURCE_URL = 'https://ghproxy.net/https://raw.githubusercontent.com/pdone/lx-music-source/main/huibq/latest.js';
const METING_API = 'https://api.i-meto.com/meting/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// ========= 可配置部分 =========
const LX_SOURCE = 'wy'; // wy/kw/kg/tx/mg
// ==============================

function createLxEnv() {
    const eventHandlers = {};
    let initResult = null;

    const on = (event, handler) => {
        if (!eventHandlers[event]) eventHandlers[event] = [];
        eventHandlers[event].push(handler);
    };

    const send = (event, data) => {
        if (event === LX_EVENT_NAMES.inited) initResult = data;
        if (eventHandlers[event]) {
            eventHandlers[event].forEach(h => { try { h(data); } catch(e) {} });
        }
    };

    const request = (url, options, callback) => {
        const method = options.method || 'GET';
        const headers = options.headers || {};
        const body = options.body;
        axios({ url, method, headers, data: body, timeout: 30000, responseType: 'json', validateStatus: () => true })
            .then(resp => callback(null, { statusCode: resp.status, headers: resp.headers, body: resp.data }))
            .catch(err => callback(err, null));
    };

    const fireRequest = async (action, source, info) => {
        const handlers = eventHandlers[LX_EVENT_NAMES.request] || [];
        for (const handler of handlers) {
            try { return await handler({ action, source, info }); } catch (e) {}
        }
        throw new Error(`No handler for action=${action}`);
    };

    return {
        lx: { EVENT_NAMES: LX_EVENT_NAMES, request, on, send, utils: { toFixed: (n, d) => Number(n).toFixed(d) }, env: 'mobile', version: '2.10.0' },
        fireRequest,
        waitForInit: (timeout = 15000) => new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                if (initResult) resolve(initResult);
                else if (Date.now() - start > timeout) reject(new Error('init timeout'));
                else setTimeout(check, 100);
            };
            check();
        }),
    };
}

let loadedEnv = null;
let loadPromise = null;

async function ensureLoaded() {
    if (loadedEnv) return loadedEnv;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        const { data: sourceCode } = await axios.get(LX_SOURCE_URL, { timeout: 30000, responseType: 'text', headers: { 'User-Agent': UA } });
        const env = createLxEnv();
        const CryptoJs = require('crypto-js');
        const cheerio = require('cheerio');
        const he = require('he');
        const dayjs = require('dayjs');
        const qs = require('qs');

        const fn = new Function('globalThis', 'require', 'module', 'exports', 'console', 'Promise',
            `globalThis.lx = this.lx; globalThis.Promise = Promise; try { ${sourceCode} } catch(e) { console.error('LX_ERR:', e.message); }`);

        fn.call({ lx: env.lx }, { lx: env.lx }, (p) => {
            const pkgs = { axios, 'crypto-js': CryptoJs, cheerio, he, dayjs, qs, 'big-integer': () => 0, '@react-native-cookies/cookies': { get: ()=>{}, set: ()=>{}, flush: ()=>{} } };
            return pkgs[p] || {};
        }, { exports: {} }, { exports: {} }, console, Promise);

        await env.waitForInit(15000);
        loadedEnv = env;
        return env;
    })();
    return loadPromise;
}

function formatDuration(raw) {
    if (!raw) return 0;
    if (typeof raw === 'number') return raw;
    const parts = String(raw).split(':');
    if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
    if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
    return Number(raw) || 0;
}

const platformName = SOURCE_NAME_MAP[LX_SOURCE] || `LX(${LX_SOURCE})`;
const metingServer = METING_SERVER_MAP[LX_SOURCE] || 'netease';

module.exports = {
    platform: platformName,
    version: '1.0.0',
    author: 'LX-Hybrid',
    supportedSearchType: ['music'],
    primaryKey: ['id'],
    srcUrl: LX_SOURCE_URL,

    async search(query, page, type) {
        try {
            const { data } = await axios.get(METING_API, {
                params: { server: metingServer, type: 'search', id: query },
                headers: { 'User-Agent': UA },
                timeout: 15000,
            });
            const list = Array.isArray(data) ? data : [];
            return {
                isEnd: true,
                data: list.map(item => ({
                    id: String(item.url_id || item.songmid || item.id || item.hash || Math.random()),
                    platform: platformName,
                    title: item.title || '',
                    artist: item.author || '',
                    album: item.album || '',
                    artwork: item.pic || '',
                    url: item.url || '',
                    lrc: item.lrc || '',
                    duration: formatDuration(item.time),
                    _raw: item,
                })),
            };
        } catch (e) {
            return { isEnd: true, data: [] };
        }
    },

    async getMediaSource(musicItem, quality) {
        if (musicItem.url) return { url: musicItem.url, userAgent: UA };

        try {
            const env = await ensureLoaded();
            const qualityMap = { high: '320k', standard: '128k', low: '128k', super: '320k' };
            const url = await env.fireRequest('musicUrl', LX_SOURCE, {
                musicInfo: { songmid: musicItem._raw?.url_id || musicItem._raw?.songmid || musicItem.id, hash: musicItem._raw?.hash, ...musicItem._raw },
                type: qualityMap[quality] || '128k',
            });
            return url ? { url, userAgent: UA } : null;
        } catch (e) {
            return musicItem.url ? { url: musicItem.url } : null;
        }
    },

    async getLyric(musicItem) {
        const lrcUrl = musicItem.lrc || musicItem._raw?.lrc;
        if (!lrcUrl) return null;
        try {
            const { data } = await axios.get(lrcUrl, { timeout: 10000 });
            return { rawLrc: typeof data === 'string' ? data : JSON.stringify(data) };
        } catch (e) { return null; }
    },
};
