import { useCallback } from "react";
import Clipboard from "@react-native-clipboard/clipboard";
import Toast from "@/utils/toast";
import { useI18N } from "@/core/i18n";

/**
 * 统一的剪贴板粘贴 Hook。
 *
 * 抽取自 simpleInput / createMusicSheet / associateLrc / setUserVariables
 * 四个面板组件中重复出现的"读剪贴板 → 写入 state → Toast 提示"流程。
 *
 * 使用方式:
 *   const paste = usePaste();
 *   <TouchableOpacity onPress={() => paste(setInput)}>...</TouchableOpacity>
 *
 * 对于多字段场景(如 setUserVariables),传入自定义 setter:
 *   onPress={() => paste((content) => {
 *       resultRef.current[key] = content;
 *       setValues(prev => ({ ...prev, [key]: content }));
 *   })}
 *
 * @returns paste 函数,接受一个 setter 回调,setter 收到剪贴板内容字符串
 */
export function usePaste(): (setter: (content: string) => void) => Promise<void> {
    const { t } = useI18N();

    return useCallback(
        async (setter: (content: string) => void) => {
            try {
                const content = await Clipboard.getString();
                if (content) {
                    setter(content);
                    Toast.success(t("common.pasted"));
                } else {
                    Toast.warn(t("common.clipboardEmpty"));
                }
            } catch {
                Toast.warn(t("common.pasteFail"));
            }
        },
        [t],
    );
}

export default usePaste;
