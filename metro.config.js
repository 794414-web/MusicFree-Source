const {getDefaultConfig} = require('expo/metro-config');
const {mergeConfig} = require('@react-native/metro-config');
const path = require('path');
const fs = require('fs');

// Junction/相对路径双重解析修复：
// 1. projectRoot 始终使用物理绝对路径（通过 realpathSync），避免 Junction 展示名与物理路径混用。
// 2. 自定义 resolver.resolveRequest，将 build 阶段 CLI 传入的「项目根相对入口」（如
//    ..\nnnn\MusicFree-Source\index.js 或 ../nnnn/MusicFree-Source/index.js）直接重写为
//    `${PROJECT_ROOT}/index.js` 绝对路径，彻底避免 Metro _resolveRelativePath 生成
//    `./../nnnn/MusicFree-Source/index.js` 这种再规范化后指向 `../nnnn/nnnn/...` 的错误相对路径。
function resolveRealProjectRoot() {
    const candidate = __dirname;
    try {
        return fs.realpathSync.native ? fs.realpathSync.native(candidate) : fs.realpathSync(candidate);
    } catch {
        return candidate;
    }
}
const PROJECT_ROOT = resolveRealProjectRoot();
const INDEX_JS = path.join(PROJECT_ROOT, 'index.js').split(path.sep).join('/');

/**
 * Reference: https://github.com/software-mansion/react-native-svg/blob/main/USAGE.md
 */
const defaultConfig = getDefaultConfig(PROJECT_ROOT);
const {assetExts, sourceExts} = defaultConfig.resolver;

function normalizeSlashes(p) {
    return p.split(path.sep).join('/').replace(/\/+/g, '/');
}

const baseResolveRequest = defaultConfig.resolver.resolveRequest;

/**
 * 修复 Windows + Junction 下入口文件相对路径的双重解析问题。
 * 仅对 context 为 serverRoot/projectRoot 的入口解析出手，其他全部原样走默认 resolver。
 */
function resolveRequest(context, moduleName, platform) {
    const originDir = normalizeSlashes(context.originModulePath || context?.originModule?.path || '');
    const isRootLookup =
        originDir === '' ||
        originDir === normalizeSlashes(PROJECT_ROOT) ||
        originDir.endsWith('/' + normalizeSlashes(PROJECT_ROOT)) ||
        /^(?:[A-Z]:)?\/?\.?$/.test(originDir);
    const norm = normalizeSlashes(moduleName || '');
    if (
        isRootLookup &&
        (norm === 'index' || norm === './index' || norm.endsWith('/index.js') || norm.endsWith('/index'))
    ) {
        // 命中 build 入口：直接返回物理 index.js
        return context.resolveRequest
            ? context.resolveRequest({...context, doThrowOnUnresolvedFailure: false}, INDEX_JS, platform)
            : baseResolveRequest(context, INDEX_JS, platform);
    }
    return context.resolveRequest
        ? context.resolveRequest(context, moduleName, platform)
        : baseResolveRequest(context, moduleName, platform);
}

/**
 * @type {import('metro-config').MetroConfig}
 */
const config = {
    projectRoot: PROJECT_ROOT,
    watchFolders: [PROJECT_ROOT],
    transformer: {
        babelTransformerPath: require.resolve('react-native-svg-transformer'),
    },
    resolver: {
        assetExts: assetExts.filter(ext => ext !== 'svg'),
        sourceExts: [...sourceExts, 'svg'],
        nodeModulesPaths: [path.join(PROJECT_ROOT, 'node_modules')],
        resolveRequest: resolveRequest,
    },
};

module.exports = mergeConfig(defaultConfig, config);
