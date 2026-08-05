import DeviceInfo from "react-native-device-info";
import { ApkUpdateModule } from "@/native/apkUpdate";

export default async function checkUpdate() {
    const currentVersion = DeviceInfo.getVersion();

    try {
        const result = await ApkUpdateModule.checkUpdate(currentVersion);

        if (!result.needUpdate) {
            return {};
        }

        return {
            updateInfo: {
                needUpdate: true,
                data: {
                    version: result.version!,
                    changeLog: result.changeLog || ["新版本可用"],
                    download: result.download || [],
                },
            },
        };
    } catch (e: any) {
        const msg = e?.message || "检查更新失败";
        return { error: msg };
    }
}
