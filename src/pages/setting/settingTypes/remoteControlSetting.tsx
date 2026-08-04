import ListItem from "@/components/base/listItem";
import ThemeSwitch from "@/components/base/switch";
import ThemeText from "@/components/base/themeText";
import { Button } from "@/components/base/button";
import RemoteControlService from "@/core/remoteControl";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import useColors from "@/hooks/useColors";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, TextInput, TouchableOpacity } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import Clipboard from "@react-native-clipboard/clipboard";

/**
 * 将完整 URL 转换为用户输入的简化格式
 * 只去掉 ws:// 或 wss:// 前缀，保留 /ws 等路径后缀
 *
 * ws://shadowext.cn:3789/ws → shadowext.cn:3789/ws
 * ws://shadowext.cn:3789   → shadowext.cn:3789
 */
function simplifyWsUrl(url: string): string {
    if (!url) {
        return "";
    }
    let s = url.trim();
    if (s.startsWith("ws://")) {
        s = s.substring(5);
    } else if (s.startsWith("wss://")) {
        s = s.substring(6);
    }
    return s;
}

/**
 * 将用户输入的简化地址转换为完整 WebSocket URL
 * 用户可以输入：
 *   - shadowext.cn:3789
 *   - shadowext.cn:3789/ws
 *   - ws://shadowext.cn:3789
 *   - ws://shadowext.cn:3789/ws
 *   - 完整 URL 原样返回
 */
function normalizeWsUrl(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
        return "";
    }
    if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) {
        return trimmed;
    }
    return `ws://${trimmed}`;
}

export default function RemoteControlSetting() {
    const colors = useColors();
    const [config, setConfig] = useState(RemoteControlService.currentConfig);
    const [isConnected, setIsConnected] = useState(RemoteControlService.isRunning);

    // 初始化：用已保存的地址设置输入框值
    const [addressInput, setAddressInput] = useState(() => {
        const savedUrl = RemoteControlService.currentConfig.wsUrl || "";
        return simplifyWsUrl(savedUrl);
    });

    // 记录上次显示的地址，用于检测外部变化（比如 WS 服务重启后配置更新）
    const lastUrlRef = useRef(RemoteControlService.currentConfig.wsUrl || "");

    // 定时刷新连接状态
    useEffect(() => {
        const timer = setInterval(() => {
            setIsConnected(RemoteControlService.isRunning);
            const latestConfig = RemoteControlService.currentConfig;

            // 只有当 wsUrl 发生真实变化时才更新 config 显示
            if (latestConfig.wsUrl !== lastUrlRef.current) {
                setConfig(latestConfig);
                lastUrlRef.current = latestConfig.wsUrl;
                // 同步输入框（只有在用户未聚焦时才同步，避免覆盖用户输入）
                const simplified = simplifyWsUrl(latestConfig.wsUrl || "");
                setAddressInput(simplified);
            } else {
                // 其他字段变化（如 enabled），只更新 config
                setConfig(prev => {
                    if (prev.enabled !== latestConfig.enabled) {
                        return { ...prev, enabled: latestConfig.enabled };
                    }
                    return prev;
                });
            }
        }, 2000);
        return () => clearInterval(timer);
    }, []);

    function toggleEnabled(value: boolean) {
        const newConfig = { ...config, enabled: value };
        RemoteControlService.saveConfig(newConfig);
        setConfig(newConfig);
        if (value) {
            RemoteControlService.restart();
            Toast.success("远程控制已启用");
        } else {
            RemoteControlService.stop();
            Toast.success("远程控制已关闭");
        }
    }

    function saveAddress() {
        const trimmed = addressInput.trim();
        if (!trimmed) {
            Toast.warn("地址不能为空");
            return;
        }
        const fullUrl = normalizeWsUrl(trimmed);
        if (!fullUrl) {
            Toast.warn("地址格式无效");
            return;
        }
        const newConfig = { ...config, wsUrl: fullUrl };
        RemoteControlService.saveConfig(newConfig);
        setConfig(newConfig);
        lastUrlRef.current = fullUrl;
        // 保存后更新输入框显示为简化格式
        setAddressInput(simplifyWsUrl(fullUrl));
        Toast.success("地址已保存");
        if (newConfig.enabled) {
            RemoteControlService.restart();
            Toast.success("正在重新连接...");
        }
    }

    function manualReconnect() {
        RemoteControlService.restart();
        Toast.success("正在重新连接...");
    }

    async function handlePaste() {
        try {
            const clipboardContent = await Clipboard.getString();
            if (clipboardContent) {
                setAddressInput(clipboardContent);
                Toast.success("已粘贴");
            } else {
                Toast.warn("剪贴板为空");
            }
        } catch {
            Toast.warn("粘贴失败");
        }
    }

    return (
        <ScrollView style={style.wrapper}>
            <View style={style.card}>
                <ListItem withHorizontalPadding heightType="smallest">
                    <ListItem.ListItemText fontSize="subTitle" fontWeight="bold">
                        远程控制
                    </ListItem.ListItemText>
                </ListItem>

                <ListItem
                    withHorizontalPadding
                    heightType="small"
                    onPress={() => toggleEnabled(!config.enabled)}
                >
                    <ListItem.Content title="启用远程控制" />
                    <ThemeSwitch
                        value={config.enabled ?? false}
                        onValueChange={toggleEnabled}
                    />
                </ListItem>

                {/* MCP 服务器地址 - 直接在页面内输入+确认 */}
                <View style={style.addressSection}>
                    <View style={style.addressTitleRow}>
                        <ThemeText fontSize="subTitle" fontWeight="bold">
                            MCP 服务器地址
                        </ThemeText>
                    </View>
                    <View style={style.addressInputRow}>
                        <TextInput
                            value={addressInput}
                            onChangeText={setAddressInput}
                            placeholder="例如: 192.168.1.54:3000"
                            placeholderTextColor={colors.textSecondary}
                            style={[
                                style.addressInput,
                                {
                                    color: colors.text,
                                    backgroundColor: colors.placeholder,
                                },
                            ]}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="default"
                        />
                        <TouchableOpacity
                            style={[
                                style.pasteBtn,
                                { backgroundColor: colors.placeholder },
                            ]}
                            onPress={handlePaste}
                        >
                            <ThemeText fontSize="subTitle">粘贴</ThemeText>
                        </TouchableOpacity>
                        <Button
                            type="primary"
                            text="确认"
                            style={style.confirmBtn}
                            onPress={saveAddress}
                        />
                    </View>
                    <View style={style.currentAddressRow}>
                        <ThemeText fontSize="small" fontColor="textSecondary">
                            当前: {config.wsUrl || "未设置"}
                        </ThemeText>
                    </View>
                </View>

                <ListItem
                    withHorizontalPadding
                    heightType="small"
                    onPress={manualReconnect}
                >
                    <ListItem.Content title="手动重连" />
                    <ThemeText fontSize="subTitle" style={style.rightText}>
                        {isConnected ? "已连接" : "未连接"}
                    </ThemeText>
                </ListItem>
            </View>

            <View style={style.card}>
                <ListItem withHorizontalPadding heightType="smallest">
                    <ListItem.ListItemText fontSize="subTitle" fontWeight="bold">
                        使用说明
                    </ListItem.ListItemText>
                </ListItem>
                <View style={style.hintContainer}>
                    <ThemeText style={style.hintText}>
                        1. 确保手机/车机和电脑在同一个局域网
                    </ThemeText>
                    <ThemeText style={style.hintText}>
                        2. 在电脑上启动 MCP 服务器
                    </ThemeText>
                    <ThemeText style={style.hintText}>
                        3. 在上方输入框填写：IP:端口
                    </ThemeText>
                    <ThemeText style={style.hintText}>
                        4. 例如：192.168.1.54:3000
                    </ThemeText>
                    <ThemeText style={style.hintText}>
                        5. 点击「确认」按钮保存地址
                    </ThemeText>
                    <ThemeText style={style.hintText}>
                        6. 查看电脑 IP：Windows 运行 cmd 输入 ipconfig
                    </ThemeText>
                </View>
            </View>
        </ScrollView>
    );
}

const style = StyleSheet.create({
    wrapper: {
        flex: 1,
        width: "100%",
    },
    card: {
        marginVertical: rpx(24),
    },
    rightText: {
        maxWidth: rpx(400),
        textAlign: "right",
    },
    addressSection: {
        paddingHorizontal: rpx(32),
        paddingVertical: rpx(20),
    },
    addressTitleRow: {
        marginBottom: rpx(16),
    },
    addressInputRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    addressInput: {
        flex: 1,
        height: rpx(88),
        borderRadius: rpx(12),
        paddingHorizontal: rpx(20),
        fontSize: rpx(28),
        marginRight: rpx(12),
    },
    pasteBtn: {
        width: rpx(120),
        height: rpx(88),
        borderRadius: rpx(12),
        justifyContent: "center",
        alignItems: "center",
        marginRight: rpx(12),
    },
    confirmBtn: {
        width: rpx(140),
        height: rpx(88),
        borderRadius: rpx(12),
    },
    currentAddressRow: {
        marginTop: rpx(12),
        paddingLeft: rpx(4),
    },
    hintContainer: {
        paddingHorizontal: rpx(32),
        paddingVertical: rpx(16),
    },
    hintText: {
        fontSize: rpx(24),
        lineHeight: rpx(40),
        opacity: 0.7,
    },
});
