import { fileAsyncTransport, logger } from "react-native-logs";
import RNFS, { readDir, readFile } from "react-native-fs";
import pathConst from "@/constants/pathConst";
import Config from "../core/appConfig.ts";
import { addLog } from "@/lib/react-native-vdebug/src/log";

const config = {
    transport: fileAsyncTransport,
    transportOptions: {
        FS: RNFS,
        filePath: pathConst.logPath,
        fileName: "error-log-{date-today}.log",
    },
    dateFormat: "local",
};

const traceConfig = {
    transport: fileAsyncTransport,
    transportOptions: {
        FS: RNFS,
        filePath: pathConst.logPath,
        fileName: "trace-log.log",
    },
    dateFormat: "local",
};

const log = logger.createLogger(config);
const traceLogger = logger.createLogger(traceConfig);

export function trace(
    desc: string,
    message?: any,
    level: "info" | "error" = "info",
) {
    if (__DEV__) {
        console.log(desc, message);
    }
    // 特殊情况记录操作路径
    if (Config.getConfig("debug.traceLog")) {
        traceLogger[level]({
            desc,
            message,
        });
    }
}

export async function clearLog() {
    const files = await RNFS.readDir(pathConst.logPath);
    await Promise.all(
        files.map(async file => {
            if (file.isFile()) {
                try {
                    await RNFS.unlink(file.path);
                } catch {}
            }
        }),
    );
}

export async function getErrorLogContent() {
    try {
        const files = await readDir(pathConst.logPath);
        console.log(files);
        const today = new Date();
        // 两天的错误日志
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);
        const todayLog = files.find(
            _ =>
                _.isFile() &&
                _.path.endsWith(
                    `error-log-${today.getDate()}-${
                        today.getMonth() + 1
                    }-${today.getFullYear()}.log`,
                ),
        );
        const yesterdayLog = files.find(
            _ =>
                _.isFile() &&
                _.path.endsWith(
                    `error-log-${yesterday.getDate()}-${
                        yesterday.getMonth() + 1
                    }-${yesterday.getFullYear()}.log`,
                ),
        );
        let logContent = "";
        if (todayLog) {
            logContent += await readFile(todayLog.path, "utf8");
        }
        if (yesterdayLog) {
            logContent += await readFile(yesterdayLog.path, "utf8");
        }
        return logContent;
    } catch {
        return "";
    }
}

export function errorLog(desc: string, message: any) {
    if (Config.getConfig("debug.errorLog")) {
        log.error({
            desc,
            message,
        });
        trace(desc, message, "error");
    }
}

/**
 * 无条件崩溃日志
 * 不受 debug.errorLog 开关限制，始终写入错误日志文件（error-log-{date}.log），
 * 用于定位启动闪退等必须记录的问题。
 */
export function crashLog(desc: string, message?: any) {
    try {
        log.error({
            desc: `[CRASH] ${desc}`,
            message,
        });
    } catch {}
}

/**
 * 尽早注册全局 JS 错误处理器
 * 在 bootstrap 最早期调用，捕获任何未捕获异常/致命错误并写入崩溃日志，
 * 避免启动阶段闪退后无法定位问题。
 */
export function setupGlobalErrorHandler() {
    try {
        // ErrorUtils 是 React Native 的全局对象（global.ErrorUtils），
        // 覆盖其全局错误处理函数，捕获所有未捕获异常
        const ErrorUtils = (globalThis as any)?.ErrorUtils;
        if (ErrorUtils?.setGlobalHandler) {
            ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
                const message =
                    error?.stack || error?.message || String(error);
                crashLog("未捕获的错误", { message, isFatal });
                // 同时打印到控制台，方便 logcat 捕获
                console.error("[CRASH]", message);
            });
        }
    } catch {}
}

export function devLog(
    method: "log" | "error" | "warn" | "info",
    ...args: any[]
) {
    if (Config.getConfig("debug.devLog")) {
        addLog(method, args);
    }
}

export { log };
