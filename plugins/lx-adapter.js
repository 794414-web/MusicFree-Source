const axios = require('axios');

const LX_EVENT_NAMES = {
    inited: 'inited',
    request: 'request',
};

const SOURCE_MAP = {
    wy: '网易云',
    kw: '酷我',
    kg: '酷狗',
    tx: 'QQ音乐',
    mg: '咪咕',
};

const PLATFORM_CONFIG = {
    // ⬇️ 在这里修改你要加载的洛雪音源 URL 和 source
    lxSourceUrl: 'https://ghproxy.net/https://raw.githubusercontent.com/pdone/lx-music-source/main/huibq/latest.js',
    source: 'wy', // wy/kw/kg/tx/mg
};

function getPlatformName(source) {
    return SOURCE_MAP[source] || `洛雪(${source})`;
}

function createLxEnv() {
    const eventHandlers = {};
    let initResult = null;

    const on = (event, handler) => {
        if (!eventHandlers[event]) eventHandlers[event] = [];
        eventHandlers[event].push(handler);
    };

    const send = (event, data) => {
        if (event === LX_EVENT_NAMES.inited) {
            initResult = data;
        }
        if (eventHandlers[event]) {
            eventHandlers[event].forEach(h => {
                try { h(data); } catch(e) {}
            });
        }
    };

    const request = (url, options, callback) => {
        const method = options.method || 'GET';
        const headers = options.headers || {};
        const body = options.body;
        axios({
            url,
            method,
            headers,
            data: body,
            timeout: 30000,
            responseType: 'json',
            validateStatus: () => true,
        }).then(resp => {
            callback(null, {
                statusCode: resp.status,
                headers: resp.headers,
                body: resp.data,
            });
        }).catch(err => {
            callback(err, null);
        });
    };

    const fireRequest = async (action, source, info) => {
        const handlers = eventHandlers[LX_EVENT_NAMES.request] || [];
        for (const handler of handlers) {
            try {
                return await handler({ action, source, info });
            } catch (e) {}
        }
        throw new Error(`No handler for action=${action} source=${source}`);
    };

    return {
        lx: {
            EVENT_NAMES: LX_EVENT_NAMES,
            request,
            on,
            send,
            utils: { toFixed: (n, d) => Number(n).toFixed(d) },
            env: 'mobile',
            version: '2.10.0',
        },
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
        const { data: sourceCode } = await axios.get(PLATFORM_CONFIG.lxSourceUrl, {
            timeout: 30000,
            responseType: 'text',
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        const env = createLxEnv();
        const CryptoJs = require('crypto-js');
        const cheerio = require('cheerio');
        const he = require('he');
        const dayjs = require('dayjs');
        const qs = require('qs');

        const fn = new Function(
            'globalThis',
            'require',
            'module',
            'exports',
            'console',
            'Promise',
            `
                globalThis.lx = this.lx;
                globalThis.Promise = Promise;
                try {
                    ${sourceCode}
                } catch(e) {
                    console.error('LX_SOURCE_ERROR:', e.message);
                }
            `
        );

        fn.call(
            { lx: env.lx },
            { lx: env.lx },
            (p) => {
                const pkgs = {
                    axios, 'crypto-js': CryptoJs, cheerio, he, dayjs, qs,
                    'big-integer': () => 0,
                    '@react-native-cookies/cookies': { get: ()=>{}, set: ()=>{}, flush: ()=>{} },
                };
                return pkgs[p] || {};
            },
            { exports: {} },
            { exports: {} },
            console,
            Promise
        );

        await env.waitForInit(15000);
        loadedEnv = env;
        return env;
    })();

    return loadPromise;
}

const platformName = getPlatformName(PLATFORM_CONFIG.source);

module.exports = {
    platform: platformName,
    version: '1.0.0',
    author: 'LX-Adapter',
    supportedSearchType: ['music'],
    primaryKey: ['id'],
    srcUrl: PLATFORM_CONFIG.lxSourceUrl,

    async search(query, page, type) {
        const env = await ensureLoaded();
        try {
            const result = await env.fireRequest('search', PLATFORM_CONFIG.source, {
                name: query,
                page,
                pageSize: 30,
            });
            const list = (result && (result.list || result.data)) || [];
            return {
                isEnd: true,
                data: list.map(item => ({
                    id: String(item.songmid || item.id || item.hash || Math.random()),
                    platform: platformName,
                    title: item.name || item.songname || item.title || '',
                    artist: (item.artist || item.singer || []).map(a => a.name || a).join(' / ') || item.author || '',
                    album: item.albumName || item.album || '',
                    artwork: item.pic || item.img || item.cover || '',
                    url: item.url || '',
                    duration: item.interval || item.duration || 0,
                    _raw: item,
                })),
            };
        } catch (e) {
            return { isEnd: true, data: [] };
        }
    },

    async getMediaSource(musicItem, quality) {
        const env = await ensureLoaded();
        const qualityMap = { high: '320k', standard: '128k', low: '128k', super: '320k' };
        const lxQuality = qualityMap[quality] || '128k';

        if (musicItem.url) {
            return { url: musicItem.url };
        }

        try {
            const url = await env.fireRequest('musicUrl', PLATFORM_CONFIG.source, {
                musicInfo: {
                    hash: musicItem._raw?.hash,
                    songmid: musicItem._raw?.songmid || musicItem.id,
                    ...musicItem._raw,
                },
                type: lxQuality,
            });
            return { url: url || null };
        } catch (e) {
            return null;
        }
    },

    async getLyric(musicItem) {
        const env = await ensureLoaded();
        try {
            const result = await env.fireRequest('lyric', PLATFORM_CONFIG.source, {
                musicInfo: {
                    hash: musicItem._raw?.hash,
                    songmid: musicItem._raw?.songmid || musicItem.id,
                    ...musicItem._raw,
                },
            });
            if (result) {
                return {
                    rawLrc: typeof result === 'string' ? result : (result.lrc || result.lyric || ''),
                    translation: result.tlrc || result.translation || undefined,
                };
            }
        } catch (e) {}
        return null;
    },
};
