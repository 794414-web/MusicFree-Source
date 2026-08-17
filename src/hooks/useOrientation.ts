import { atom, useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import { Dimensions } from "react-native";

const orientationAtom = atom<"vertical" | "horizontal">("vertical");

export function useListenOrientationChange() {
    const setOrientationAtom = useSetAtom(orientationAtom);
    useEffect(() => {
        // 注意：方向判断必须使用 screen 尺寸，不能用 window 尺寸。
        // 当 windowSoftInputMode=adjustResize 时，输入法弹出会压缩 window 高度，
        // 一旦压缩后的高度小于宽度，方向会被误判为横屏，导致面板整体重新布局、
        // 输入框焦点被破坏、输入法自动关闭。
        const screenSize = Dimensions.get("screen");
        const { width, height } = screenSize;
        if (width < height) {
            setOrientationAtom("vertical");
        } else {
            setOrientationAtom("horizontal");
        }
        const subscription = Dimensions.addEventListener("change", e => {
            const s = e.screen ?? Dimensions.get("screen");
            if (s.width < s.height) {
                setOrientationAtom("vertical");
            } else {
                setOrientationAtom("horizontal");
            }
        });

        return () => {
            subscription?.remove();
        };
    }, []);
}

export default function useOrientation() {
    return useAtomValue(orientationAtom);
}
