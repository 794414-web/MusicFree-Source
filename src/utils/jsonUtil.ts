export function safeStringify(raw: any): string {
    try {
        return JSON.stringify(raw);
    } catch {
        return "";
    }
}


export function safeParse<T = any>(raw?: string | null) {
    try {
        if (!raw) {
            return null;
        }
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

/**
 * 安全解析 JSON 字符串为数组。
 *
 * 统一封装历史/歌单/缓存等"读取列表"场景的容错逻辑:
 *  - 解析失败兜底为空数组,避免启动阶段 JSON.parse 抛异常导致闪退
 *  - 非数组结果兜底为空数组,过滤其他源残留的脏数据
 *  - 可选传入校验函数,逐项过滤非法元素
 *
 * @param raw 原始字符串
 * @param itemValidator 可选的逐项校验函数,返回 false 表示该项非法需过滤
 * @returns 始终返回数组(永不为 null/undefined)
 */
export function safeParseArray<T = any>(
    raw: string | undefined | null,
    itemValidator?: (item: any) => boolean,
): T[] {
    const parsed = safeParse<T[]>(raw);
    if (!Array.isArray(parsed)) {
        return [];
    }
    if (itemValidator) {
        return parsed.filter(itemValidator);
    }
    return parsed;
}
