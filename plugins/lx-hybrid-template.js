/**
 * ============================================================================
 *  洛雪混合(LX-Hybrid)插件模板
 * ============================================================================
 *
 *  本文件是 lx-kg.js / lx-kw.js / lx-wy.js / lx-tx.js / lx-mg.js 五个具体
 *  插件的"母本"。五个具体插件代码与本模板完全一致,仅常量 LX_SOURCE 不同。
 *
 *  为什么不通过 require('./lx-hybrid-template') 共享代码?
 *  -----------------------------------------------------------------------
 *  MusicFree 插件加载器 (src/core/pluginManager/plugin.ts#L74-L78 的 _require)
 *  只支持预设的包名映射 (axios/crypto-js/cheerio/dayjs/qs/he 等),
 *  不支持相对路径 require。因此各 .js 插件必须自包含全部逻辑。
 *
 *  修改指南:
 *  -----------------------------------------------------------------------
 *  1. 修改本模板的逻辑后,运行 `node lx-hybrid-template.js` 即可在同目录下
 *     重新生成 5 个具体插件 (lx-kg.js / lx-kw.js / lx-wy.js / lx-tx.js / lx-mg.js)。
 *  2. 生成后会覆盖同名文件,请先 commit 当前修改以防丢失。
 *  3. 生成的具体插件包含与本模板一致的逻辑,仅 LX_SOURCE 常量不同。
 *
 *  本文件既是模板,也是 Node 脚本:直接运行会执行生成逻辑,
 *  被 require 时不会执行生成(由 if(require.main===module) 守卫)。
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

/**
 * 5 个具体插件对应的 LX_SOURCE 值。
 * 新增平台时只需在此数组追加一项,再运行 `node lx-hybrid-template.js`。
 */
const LX_SOURCES = ['wy', 'kw', 'kg', 'tx', 'mg'];

/**
 * 模板正文:运行时由具体插件执行的实际逻辑。
 * 占位符 __LX_SOURCE__ 会在生成时被替换为具体值。
 */
function templateBody() {
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
    const LX_SOURCE = '__LX_SOURCE__'; // wy/kw/kg/tx/mg
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
}

/**
 * 生成具体插件文件。
 * 把模板正文的源码字符串里的 '__LX_SOURCE__' 占位符替换为具体值,
 * 写入 lx-<source>.js。
 */
function generatePlugins() {
    // 取出 templateBody 函数源码,提取函数体
    const bodySource = templateBody.toString();
    // 匹配函数体内容(第一个 { 之后到最后一个 } 之前)
    const firstBrace = bodySource.indexOf('{');
    const lastBrace = bodySource.lastIndexOf('}');
    const bodyInner = bodySource.slice(firstBrace + 1, lastBrace).trim();

    const header = `/**\n * 由 lx-hybrid-template.js 自动生成,请勿手动修改。\n * 修改逻辑请编辑 lx-hybrid-template.js 后运行: node lx-hybrid-template.js\n */\n`;

    for (const source of LX_SOURCES) {
        const replaced = bodyInner.replace(/'__LX_SOURCE__'/g, `'${source}'`);
        // bodyInner 已包含 `const axios = require('axios');`,无需重复添加
        const fileContent = `${header}${replaced}\n`;
        const outPath = path.join(__dirname, `lx-${source}.js`);
        fs.writeFileSync(outPath, fileContent, 'utf8');
        console.log(`[lx-hybrid-template] generated: ${outPath}`);
    }
}

if (require.main === module) {
    generatePlugins();
} else {
    // 作为模块被 require 时,执行模板逻辑(保留原行为)
    templateBody();
}
