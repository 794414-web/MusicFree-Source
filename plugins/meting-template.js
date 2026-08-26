/**
 * ============================================================================
 *  Meting 插件模板
 * ============================================================================
 *
 *  本文件是 meting-kugou.js / meting-kuwo.js / meting-netease.js /
 *  meting-tencent.js 四个具体插件的"母本"。四个具体插件代码与本模板
 *  完全一致,仅 PLATFORM / SERVER 两个常量不同。
 *
 *  为什么不通过 require('./meting-template') 共享代码?
 *  -----------------------------------------------------------------------
 *  MusicFree 插件加载器 (src/core/pluginManager/plugin.ts#L74-L78 的 _require)
 *  只支持预设的包名映射 (axios/crypto-js/cheerio/dayjs/qs/he 等),
 *  不支持相对路径 require。因此各 .js 插件必须自包含全部逻辑。
 *
 *  修改指南:
 *  -----------------------------------------------------------------------
 *  1. 修改本模板的逻辑后,运行 `node meting-template.js` 即可在同目录下
 *     重新生成 4 个具体插件。
 *  2. 生成后会覆盖同名文件,请先 commit 当前修改以防丢失。
 *  3. 生成的具体插件包含与本模板一致的逻辑,仅 PLATFORM / SERVER 常量不同。
 *
 *  本文件既是模板,也是 Node 脚本:直接运行会执行生成逻辑,
 *  被 require 时不会执行生成(由 if(require.main===module) 守卫)。
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

/**
 * 4 个具体插件对应的 (平台名, meting server 名)。
 * 新增平台时只需在此数组追加一项,再运行 `node meting-template.js`。
 */
const METING_VARIANTS = [
    { platform: '网易云',   server: 'netease' },
    { platform: 'QQ音乐',   server: 'tencent' },
    { platform: '酷狗音乐', server: 'kugou' },
    { platform: '酷我音乐', server: 'kuwo' },
];

/**
 * 模板正文:运行时由具体插件执行的实际逻辑。
 * 占位符 __PLATFORM__ 和 __SERVER__ 会在生成时被替换为具体值。
 */
function templateBody() {
    const axios = require('axios');

    const BASE_URL = 'https://api.i-meto.com/meting/api';
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

    // ========= 可配置部分 =========
    const PLATFORM = '__PLATFORM__';
    const SERVER = '__SERVER__';
    // ==============================

    function formatDuration(raw) {
        if (!raw) return 0;
        if (typeof raw === 'number') return raw;
        const parts = String(raw).split(':');
        if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
        if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
        return Number(raw) || 0;
    }

    module.exports = {
        platform: PLATFORM,
        version: '1.0.0',
        author: 'Meting',
        supportedSearchType: ['music'],
        primaryKey: ['id'],
        srcUrl: BASE_URL,

        async search(query, page, type) {
            const { data } = await axios.get(BASE_URL, {
                params: { server: SERVER, type: 'search', id: query },
                headers: { 'User-Agent': UA },
                timeout: 15000,
            });
            // 统一过滤掉缺 title 的脏数据(meting 偶尔返回空项),
            // 此前仅 meting-kuwo 有此保护,其余三个平台缺失,现统一加
            const list = Array.isArray(data) ? data.filter(item => item && item.title) : [];
            return {
                isEnd: true,
                data: list.map(item => ({
                    id: String(item.url_id || item.id || Math.random()),
                    platform: PLATFORM,
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
        },

        async getMediaSource(musicItem, quality) {
            if (musicItem.url) {
                return { url: musicItem.url, userAgent: UA };
            }
            const raw = musicItem._raw;
            if (raw && raw.url) {
                return { url: raw.url, userAgent: UA };
            }
            return null;
        },

        async getLyric(musicItem) {
            const lrcUrl = musicItem.lrc || musicItem._raw?.lrc;
            if (!lrcUrl) return null;
            try {
                const { data } = await axios.get(lrcUrl, { timeout: 10000 });
                return { rawLrc: typeof data === 'string' ? data : JSON.stringify(data) };
            } catch (e) {
                return null;
            }
        },
    };
}

/**
 * 生成具体插件文件。
 * 把模板正文的源码字符串里的 '__PLATFORM__' / '__SERVER__' 占位符
 * 替换为具体值,写入 meting-<server>.js。
 */
function generatePlugins() {
    const bodySource = templateBody.toString();
    const firstBrace = bodySource.indexOf('{');
    const lastBrace = bodySource.lastIndexOf('}');
    const bodyInner = bodySource.slice(firstBrace + 1, lastBrace).trim();

    const header = `/**\n * 由 meting-template.js 自动生成,请勿手动修改。\n * 修改逻辑请编辑 meting-template.js 后运行: node meting-template.js\n */\n`;

    for (const variant of METING_VARIANTS) {
        const replaced = bodyInner
            .replace(/'__PLATFORM__'/g, `'${variant.platform}'`)
            .replace(/'__SERVER__'/g, `'${variant.server}'`);
        const fileContent = `${header}${replaced}\n`;
        const outPath = path.join(__dirname, `meting-${variant.server}.js`);
        fs.writeFileSync(outPath, fileContent, 'utf8');
        console.log(`[meting-template] generated: ${outPath}`);
    }
}

if (require.main === module) {
    generatePlugins();
} else {
    // 作为模块被 require 时,执行模板逻辑(保留原行为)
    templateBody();
}
