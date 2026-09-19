"use strict";

/**
 * GD音乐台（music.gdstudio.xyz）音乐源插件
 *
 * 直接对接 GD Studio 的公开聚合 API（基于 Meting），
 * 聚合搜索网易云 / JOOX / B站 等稳定源，无需各自平台的私密接口。
 *
 * 接口：
 *   https://music-api.gdstudio.xyz/api.php
 *   - types=search&source=&name=&count=&pages=   搜索，返回 id/name/artist/album/pic_id/lyric_id/source
 *   - types=url&source=&id=&br=                 获取播放地址，返回 { url, br, size }
 *   - types=lyric&source=&id=                   获取歌词，返回 { lyric, tlyric }
 *   - types=pic&source=&id=&size=               获取封面，返回 { url }
 *
 * 注意：插件沙箱为 Hermes 直接编译，不支持 async/await，故全部使用 Promise 链写法；
 *       该接口有访问频率限制（5分钟内不超过50次），故搜索时仅聚合稳定源，
 *       且失败时静默降级，保证其他音源不受影响。
 */

const axios = require("axios");

const BASE_URL = "https://music-api.gdstudio.xyz/api.php";

// GD 接口响应较慢，显式覆盖插件级默认 2000ms 超时，避免请求被过早中断
const REQUEST_TIMEOUT = 15000;

// 稳定音乐源（GD音乐台 2026-06-26 动态更新：netease / joox / bilibili）
const STABLE_SOURCES = ["netease", "joox", "bilibili"];

// MusicFree 音质 -> GD br 映射
// 740 为 16bit 无损，比 999(24bit) 文件更小更稳；super 播不出时 getMediaSource 会自动降级 320
const QUALITY_BR = {
    low: 128,
    standard: 320,
    high: 320,
    super: 740,
};

// GD 接口 5 分钟 50 次的限流，被限流时返回 HTTP 429 或在业务字段带 status=429。
// 命中限流时按 1s/2s/4s 指数退避最多重试 2 次，避免连打请求被永久拉黑。
var GD_RETRY_DELAYS = [1000, 2000];

function isRateLimited(error) {
    if (!error) return false;
    var status = error.response && error.response.status;
    if (status === 429) return true;
    if (error.code === "ECONNABORTED") return false;
    var msg = String(error.message || "").toLowerCase();
    return msg.indexOf("429") !== -1 || msg.indexOf("rate limit") !== -1;
}

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function requestGD(params, retryCount) {
    var attempt = retryCount || 0;
    return axios
        .get(BASE_URL, { params: params, timeout: REQUEST_TIMEOUT })
        .then(function (res) {
            return res.data;
        })
        .catch(function (error) {
            if (isRateLimited(error) && attempt < GD_RETRY_DELAYS.length) {
                return sleep(GD_RETRY_DELAYS[attempt]).then(function () {
                    return requestGD(params, attempt + 1);
                });
            }
            throw error;
        });
}

function formatSearchItem(item) {
    var source = item.source || "netease";
    var trackId = String(item.id);
    var artists = Array.isArray(item.artist)
        ? item.artist.join(" / ")
        : item.artist || "";
    var album = item.album;
    if (album && typeof album === "object") album = album.name || "";
    return {
        id: source + "-" + trackId,
        platform: "GD音乐台",
        title: item.name || item.title || "",
        artist: artists,
        album: album || "",
        duration: item.duration || item.dt || item.interval || undefined,
        artwork: item.pic || item.picUrl || undefined,
        _gdSource: source,
        _gdId: trackId,
        _gdPicId: item.pic_id || item.picId,
        _gdLyricId: item.lyric_id || item.lyricId || trackId,
    };
}

// ===== 匹配辅助 =====
// 常用繁体字 -> 简体映射（覆盖歌名/歌手常见字，用于归一化匹配）
var TRAD_TO_SIMPLE = {
    "倫":"伦","傑":"杰","葉":"叶","黃":"黄","陳":"陈","張":"张","劉":"刘","楊":"杨",
    "吳":"吴","鄭":"郑","馬":"马","謝":"谢","蘇":"苏","許":"许","趙":"赵","錢":"钱",
    "孫":"孙","萬":"万","軍":"军","國":"国","華":"华","漢":"汉","愛":"爱","會":"会",
    "還":"还","這":"这","個":"个","們":"们","來":"来","為":"为","麼":"么","說":"说",
    "時":"时","間":"间","點":"点","龍":"龙","鳳":"凤","夢":"梦","獨":"独","潔":"洁",
    "純":"纯","靜":"静","樂":"乐","館":"馆","觀":"观","歡":"欢","發":"发","長":"长",
    "門":"门","問":"问","開":"开","關":"关","對":"对","錯":"错","過":"过","遠":"远",
    "邊":"边","讓":"让","請":"请","詩":"诗","詞":"词","語":"语","話":"话","讀":"读",
    "寫":"写","學":"学","習":"习","書":"书","畫":"画","紙":"纸","筆":"笔","電":"电",
    "腦":"脑","機":"机","車":"车","輪":"轮","飛":"飞","風":"风","雲":"云","興":"兴",
    "東":"东","頭":"头","兒":"儿","轉":"转","歷":"历","單":"单","雙":"双","聲":"声",
    "聽":"听","歸":"归","舊":"旧","廣":"广","園":"园","燈":"灯","號":"号","線":"线",
    "紅":"红","綠":"绿","藍":"蓝","銀":"银","鋼":"钢","錄":"录","簡":"简","編":"编",
    "維":"维","結":"结","網":"网","組":"组","總":"总","經":"经","絕":"绝","續":"续",
    "繼":"继","約":"约","級":"级","紀":"纪","繞":"绕","緣":"缘","縮":"缩","議":"议",
    "譯":"译","護":"护","買":"买","賣":"卖","贊":"赞","貝":"贝","貴":"贵","賓":"宾",
    "賬":"账","贈":"赠","質":"质","賭":"赌","贏":"赢","賢":"贤","賴":"赖","趣":"趣",
    "躍":"跃","認":"认","誤":"误","誘":"诱","謊":"谎","謙":"谦","證":"证","譚":"谭",
    "譜":"谱","響":"响","項":"项","順":"顺","須":"须","預":"预","頑":"顽","顧":"顾",
    "顫":"颤","顯":"显","驗":"验","驚":"惊","騙":"骗","體":"体","髮":"发","鬍":"胡",
    "魚":"鱼","魯":"鲁","鯊":"鲨","鯨":"鲸","鳥":"鸟","鴨":"鸭","鶯":"莺","鶴":"鹤",
    "麥":"麦","麻":"麻","黑":"黑","齊":"齐","齒":"齿","齣":"出","龜":"龟","鼓":"鼓",
    "臺":"台","颱":"台","鵬":"鹏","鷹":"鹰","麗":"丽","麋":"麋",
};

// 补充映射：原表遗漏的人名 / 歌名高频繁体字
// 典型漏字：「周杰倫」的倫、「告白氣球」的氣、「鄧紫棋」的鄧、「蕭敬騰」的蕭，
// 漏转会让 normText 认为原唱与搜索词不匹配，从而误判为翻唱并降权。
var TRAD_TO_SIMPLE_EXTRA = {
    "氣":"气","鄧":"邓","蕭":"萧","羅":"罗","盧":"卢","韋":"韦","費":"费","韓":"韩",
    "蔣":"蒋","騰":"腾","慶":"庆","曉":"晓","憶":"忆","蓮":"莲","嫻":"娴","艷":"艳",
    "豔":"艳","嶽":"岳","凱":"凯","啟":"启","詠":"咏","榮":"荣","鈞":"钧","竇":"窦",
    "樸":"朴","瑋":"玮","濱":"滨","昇":"升","駿":"骏","燁":"烨","瑩":"莹","鵬":"鹏",
    "馮":"冯","陸":"陆","嚴":"严","鄒":"邹","鮑":"鲍","賀":"贺","湯":"汤","畢":"毕",
    "鄔":"邬","呂":"吕","計":"计","談":"谈","龐":"庞","強":"强","賈":"贾","婁":"娄",
    "顏":"颜","鍾":"钟","駱":"骆","繆":"缪","應":"应","賁":"贲","鬱":"郁","諸":"诸",
    "龔":"龚","烏":"乌","宮":"宫","寧":"宁","欒":"栾","厲":"厉","薊":"蓟","藺":"蔺",
    "喬":"乔","陰":"阴","蒼":"苍","聞":"闻","貢":"贡","勞":"劳","酈":"郦","壽":"寿",
    "郟":"郏","農":"农","溫":"温","閻":"阎","連":"连","終":"终","滿":"满","祿":"禄",
    "闕":"阙","歐":"欧","師":"师","鞏":"巩","厙":"厍","聶":"聂","闞":"阚","養":"养",
    "豐":"丰","後":"后","荊":"荆","權":"权","蓋":"盖","從":"从","懷":"怀",
    "淚":"泪","傷":"伤","殤":"殇","執":"执","癡":"痴","纏":"缠","綿":"绵","縫":"缝",
    "織":"织","腳":"脚","臉":"脸","膚":"肤","腸":"肠","舉":"举","艙":"舱","艦":"舰",
    "艱":"艰","藝":"艺","藥":"药","蘋":"苹","蘭":"兰","蘿":"萝","螞":"蚂","蠟":"蜡",
    "蟲":"虫","蠅":"蝇","蠻":"蛮","補":"补","襪":"袜","褲":"裤","襯":"衬","釋":"释",
    "鐵":"铁","鑰":"钥","鏡":"镜","鐘":"钟","閉":"闭","閏":"闰","閱":"阅","闊":"阔",
    "隊":"队","階":"阶","隨":"随","險":"险","隱":"隐","難":"难","雛":"雏","雜":"杂",
    "韌":"韧","頂":"顶","頓":"顿","飄":"飘","飆":"飙","鯉":"鲤","鯽":"鲫","鴉":"鸦",
    "鴿":"鸽","鵑":"鹃","鵝":"鹅","麵":"面","黨":"党","黴":"霉","齡":"龄","齋":"斋",
    "礙":"碍","襖":"袄","壩":"坝","擺":"摆","敗":"败","綁":"绑","飽":"饱","寶":"宝",
    "報":"报","備":"备","憊":"惫","幣":"币","變":"变","辯":"辩","標":"标","錶":"表",
    "癟":"瘪","瀕":"濒","餅":"饼","撥":"拨","鉑":"铂","駁":"驳","佈":"布","參":"参",
    "慚":"惭","殘":"残","蠶":"蚕","慘":"惨","層":"层","詫":"诧","攙":"搀","讒":"谗",
    "禪":"禅","產":"产","闡":"阐","場":"场","嘗":"尝","償":"偿","廠":"厂","暢":"畅",
    "鈔":"钞","徹":"彻","塵":"尘","稱":"称","懲":"惩","誠":"诚","騁":"骋","遲":"迟",
    "馳":"驰","恥":"耻","沖":"冲","寵":"宠","籌":"筹","綢":"绸","醜":"丑","廚":"厨",
    "鋤":"锄","礎":"础","儲":"储","觸":"触","處":"处","傳":"传","瘡":"疮","闖":"闯",
    "創":"创","辭":"辞","叢":"丛","湊":"凑","竄":"窜","達":"达","帶":"带","貸":"贷",
    "擔":"担","膽":"胆","彈":"弹","當":"当","檔":"档","導":"导","島":"岛","禱":"祷",
    "敵":"敌","滌":"涤","遞":"递","締":"缔","墊":"垫","澱":"淀","釣":"钓","疊":"叠",
    "釘":"钉","訂":"订","動":"动","凍":"冻","棟":"栋","鬥":"斗","鍛":"锻","斷":"断",
    "緞":"缎","噸":"吨","奪":"夺","墮":"堕","惡":"恶","爾":"尔","餌":"饵","貳":"贰",
    "罰":"罚","閥":"阀","煩":"烦","範":"范","販":"贩","飯":"饭","訪":"访","紡":"纺",
    "廢":"废","紛":"纷","墳":"坟","奮":"奋","憤":"愤","糞":"粪","瘋":"疯","婦":"妇",
    "復":"复","負":"负","賦":"赋","縛":"缚","該":"该","乾":"干","尷":"尴","岡":"冈",
    "剛":"刚","崗":"岗","綱":"纲","槓":"杠","給":"给","溝":"沟","構":"构","購":"购",
    "夠":"够","穀":"谷","颳":"刮","慣":"惯","貫":"贯","規":"规","閨":"闺","軌":"轨",
    "詭":"诡","櫃":"柜","劊":"刽","滾":"滚","鍋":"锅","駭":"骇","閡":"阂","恆":"恒",
    "轟":"轰","鴻":"鸿","壺":"壶","滬":"沪","戶":"户","壞":"坏","環":"环","緩":"缓",
    "換":"换","喚":"唤","揮":"挥","輝":"辉","毀":"毁","匯":"汇","賄":"贿","穢":"秽",
    "檜":"桧","渾":"浑","夥":"伙","獲":"获","貨":"货","禍":"祸","擊":"击","積":"积",
    "績":"绩","飢":"饥","譏":"讥","雞":"鸡","極":"极","擠":"挤","幾":"几","劑":"剂",
    "濟":"济","記":"记","際":"际","夾":"夹","莢":"荚","頰":"颊","價":"价","駕":"驾",
    "殲":"歼","監":"监","堅":"坚","箋":"笺","繭":"茧","檢":"检","鹼":"碱","揀":"拣",
    "撿":"捡","儉":"俭","減":"减","薦":"荐","檻":"槛","鑑":"鉴","踐":"践","賤":"贱",
    "見":"见","鍵":"键","濺":"溅","將":"将","漿":"浆","獎":"奖","醬":"酱","膠":"胶",
    "澆":"浇","驕":"骄","嬌":"娇","攪":"搅","鉸":"铰","繳":"缴","較":"较","節":"节",
    "詰":"诘","頡":"颉","屆":"届","僅":"仅","緊":"紧","錦":"锦","進":"进","晉":"晋",
    "燼":"烬","盡":"尽","勁":"劲","莖":"茎","競":"竞","淨":"净","糾":"纠","廄":"厩",
    "駒":"驹","劇":"剧","懼":"惧","據":"据","鋸":"锯","覺":"觉","決":"决","殼":"壳",
    "課":"课","墾":"垦","懇":"恳","摳":"抠","庫":"库","誇":"夸","塊":"块","儈":"侩",
    "寬":"宽","礦":"矿","曠":"旷","虧":"亏","窺":"窥","潰":"溃","擴":"扩","臘":"腊",
    "欄":"栏","爛":"烂","濫":"滥","覽":"览","懶":"懒","纜":"缆","撈":"捞","澇":"涝",
    "壘":"垒","類":"类","離":"离","裡":"里","禮":"礼","勵":"励","曆":"历","憐":"怜",
    "聯":"联","練":"练","煉":"炼","戀":"恋","鏈":"链","糧":"粮","兩":"两","輛":"辆",
    "諒":"谅","療":"疗","遼":"辽","獵":"猎","臨":"临","鄰":"邻","鱗":"鳞","凜":"凛",
    "靈":"灵","嶺":"岭","領":"领","瀏":"浏","聾":"聋","籠":"笼","壟":"垄","隴":"陇",
    "樓":"楼","摟":"搂","簍":"篓","廬":"庐","爐":"炉","虜":"虏","賂":"赂","驢":"驴",
    "鋁":"铝","屢":"屡","縷":"缕","慮":"虑","濾":"滤","巒":"峦","攣":"挛","孿":"孪",
    "亂":"乱","掄":"抡","邏":"逻","鑼":"锣","騾":"骡","罵":"骂","嗎":"吗","邁":"迈",
    "脈":"脉","瞞":"瞒","饅":"馒","貓":"猫","錨":"锚","鉚":"铆","貿":"贸","沒":"没",
    "悶":"闷","彌":"弥","謎":"谜","覓":"觅","廟":"庙","滅":"灭","憫":"悯","鳴":"鸣",
    "銘":"铭","畝":"亩","納":"纳","撓":"挠","鬧":"闹","餒":"馁","內":"内","擬":"拟",
    "膩":"腻","攆":"撵","釀":"酿","擰":"拧","檸":"柠","濘":"泞","濃":"浓","膿":"脓",
    "毆":"殴","甌":"瓯","嘔":"呕","盤":"盘","賠":"赔","噴":"喷","貧":"贫","評":"评",
    "憑":"凭","潑":"泼","頗":"颇","撲":"扑","鋪":"铺","臍":"脐","騎":"骑","豈":"岂",
    "棄":"弃","遷":"迁","簽":"签","鉗":"钳","淺":"浅","譴":"谴","槍":"枪","嗆":"呛",
    "牆":"墙","搶":"抢","橋":"桥","僑":"侨","蕎":"荞","竅":"窍","翹":"翘","親":"亲",
    "欽":"钦","輕":"轻","氫":"氢","傾":"倾","頃":"顷","瓊":"琼","窮":"穷","區":"区",
    "驅":"驱","齲":"龋","詮":"诠","勸":"劝","確":"确","擾":"扰","饒":"饶","熱":"热",
    "紉":"纫","絨":"绒","軟":"软","銳":"锐","灑":"洒","薩":"萨","鰓":"鳃","賽":"赛",
    "傘":"伞","喪":"丧","掃":"扫","澀":"涩","殺":"杀","紗":"纱","篩":"筛","曬":"晒",
    "刪":"删","閃":"闪","陝":"陕","贍":"赡","繕":"缮","賞":"赏","燒":"烧","紹":"绍",
    "攝":"摄","懾":"慑","紳":"绅","審":"审","瀋":"沈","腎":"肾","滲":"渗","繩":"绳",
    "勝":"胜","聖":"圣","獅":"狮","濕":"湿","屍":"尸","蝕":"蚀","實":"实","識":"识",
    "駛":"驶","勢":"势","適":"适","飾":"饰","視":"视","試":"试","獸":"兽","樞":"枢",
    "輸":"输","術":"术","樹":"树","帥":"帅","誰":"谁","稅":"税","碩":"硕","絲":"丝",
    "廝":"厮","飼":"饲","聳":"耸","慫":"怂","頌":"颂","訟":"讼","誦":"诵","擻":"擞",
    "訴":"诉","肅":"肃","雖":"虽","歲":"岁","損":"损","瑣":"琐","鎖":"锁","態":"态",
    "攤":"摊","灘":"滩","癱":"瘫","壇":"坛","歎":"叹","燙":"烫","濤":"涛","韜":"韬",
    "謄":"誊","銻":"锑","題":"题","條":"条","貼":"贴","廳":"厅","烴":"烃","銅":"铜",
    "統":"统","圖":"图","塗":"涂","團":"团","頹":"颓","蛻":"蜕","脫":"脱","鴕":"鸵",
    "橢":"椭","窪":"洼","彎":"弯","灣":"湾","違":"违","圍":"围","濰":"潍","偉":"伟",
    "偽":"伪","緯":"纬","謂":"谓","衛":"卫","紋":"纹","穩":"稳","甕":"瓮","撾":"挝",
    "渦":"涡","窩":"窝","臥":"卧","嗚":"呜","無":"无","蕪":"芜","塢":"坞","霧":"雾",
    "務":"务","錫":"锡","犧":"牺","襲":"袭","係":"系","戲":"戏","細":"细","蝦":"虾",
    "轄":"辖","峽":"峡","俠":"侠","狹":"狭","廈":"厦","嚇":"吓","銑":"铣","現":"现",
    "獻":"献","縣":"县","憲":"宪","廂":"厢","鑲":"镶","詳":"详","銷":"销","嘯":"啸",
    "蠍":"蝎","協":"协","挾":"挟","攜":"携","瀉":"泻","洩":"泄","鋅":"锌","釁":"衅",
    "陘":"陉","兇":"凶","洶":"汹","鏽":"锈","繡":"绣","虛":"虚","噓":"嘘","鬚":"须",
    "緒":"绪","軒":"轩","懸":"悬","選":"选","癬":"癣","勳":"勋","詢":"询","尋":"寻",
    "馴":"驯","訓":"训","訊":"讯","遜":"逊","壓":"压","啞":"哑","亞":"亚","訝":"讶",
    "煙":"烟","閹":"阉","鹽":"盐","儼":"俨","厭":"厌","硯":"砚","鴦":"鸯","癢":"痒",
    "樣":"样","謠":"谣","搖":"摇","遙":"遥","瑤":"瑶","爺":"爷","頁":"页","業":"业",
    "醫":"医","儀":"仪","遺":"遗","蟻":"蚁","義":"义","詣":"诣","異":"异","繹":"绎",
    "蔭":"荫","飲":"饮","櫻":"樱","嬰":"婴","纓":"缨","螢":"萤","營":"营","熒":"荧",
    "穎":"颖","喲":"哟","擁":"拥","傭":"佣","踴":"踊","憂":"忧","優":"优","郵":"邮",
    "鈾":"铀","猶":"犹","遊":"游","於":"于","輿":"舆","漁":"渔","娛":"娱","與":"与",
    "嶼":"屿","馭":"驭","籲":"吁","淵":"渊","員":"员","圓":"圆","願":"愿","粵":"粤",
    "悅":"悦","鄖":"郧","運":"运","蘊":"蕴","暈":"晕","韻":"韵","災":"灾","載":"载",
    "攢":"攒","暫":"暂","臟":"脏","髒":"脏","鑿":"凿","棗":"枣","責":"责","擇":"择",
    "澤":"泽","賊":"贼","軋":"轧","閘":"闸","詐":"诈","氈":"毡","盞":"盏","嶄":"崭",
    "輾":"辗","棧":"栈","戰":"战","綻":"绽","漲":"涨","帳":"帐","脹":"胀","貞":"贞",
    "針":"针","偵":"侦","診":"诊","鎮":"镇","陣":"阵","掙":"挣","睜":"睁","崢":"峥",
    "猙":"狰","幀":"帧","職":"职","摯":"挚","擲":"掷","幟":"帜","滯":"滞","種":"种",
    "腫":"肿","眾":"众","謅":"诌","軸":"轴","皺":"皱","晝":"昼","驟":"骤","豬":"猪",
    "硃":"朱","燭":"烛","囑":"嘱","矚":"瞩","築":"筑","駐":"驻","專":"专","磚":"砖",
    "賺":"赚","莊":"庄","裝":"装","妝":"妆","壯":"壮","狀":"状","錐":"锥","墜":"坠",
    "綴":"缀","諄":"谆","準":"准","濁":"浊","諮":"谘","資":"资","漬":"渍","蹤":"踪",
    "縱":"纵","詛":"诅","鑽":"钻","鼕":"冬","龕":"龛",
};

Object.keys(TRAD_TO_SIMPLE_EXTRA).forEach(function (key) {
    if (!TRAD_TO_SIMPLE[key]) TRAD_TO_SIMPLE[key] = TRAD_TO_SIMPLE_EXTRA[key];
});

// 繁体转简体（仅处理映射表覆盖的常用字）
function toSimplified(str) {
    var s = String(str || "");
    var out = "";
    for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        out += TRAD_TO_SIMPLE[ch] || ch;
    }
    return out;
}

// 归一化：繁体转简体、去空白、去括号及括号内容、转小写、去除常见标点
// 用于「歌名 + 歌手」匹配，忽略繁简体/空格/括号注释差异，提高命中原唱概率
function normText(str) {
    return toSimplified(String(str || ""))
        .toLowerCase()
        .replace(/[\s\u3000]/g, "")
        .replace(/[（(【\[][\s\S]*?[）)】\]]/g, "")
        .replace(/[，。、；：！？!?·,.'"“”‘’\-—~：]/g, "");
}

// 格式化条目歌手（数组 -> 字符串）
function artistText(item) {
    return Array.isArray(item.artist)
        ? item.artist.join("/")
        : String(item.artist || "");
}

// 翻唱/伴奏/纯音乐/现场版等"非原唱版本"特征词（命中任一条即视为翻唱版本）
// 用于搜索排序降权，让原唱版本排在翻唱、钢琴版、DJ版、现场版之前，
// 避免用户点进纯音乐/翻唱版本导致歌词对不上（甚至无歌词）
var COVER_PATTERNS = [
    "live", "现场", "cover", "翻唱", "钢琴", "吉他", "伴奏",
    "纯音乐", "instrumental", "remix", "dj", "女声版", "男声版",
    "串烧", "电音版", "acoustic", "karaoke", "伴唱", "消音版",
];

// 判断条目是否为"非原唱版本"（标题含翻唱特征词）
function isCoverVersion(item) {
    var title = String(item.title || item.name || "").toLowerCase();
    for (var i = 0; i < COVER_PATTERNS.length; i++) {
        if (title.indexOf(COVER_PATTERNS[i]) !== -1) return true;
    }
    return false;
}

// 命中分数：2 = 标题 + 歌手都完全一致（原唱）；1 = 仅标题一致；0 = 其他
// 翻唱/伴奏/纯音乐等版本在此基础上降权 1 分，保证原唱版本排在前面；
// joox 源曲库以原唱录音为主，对「标题一致且非翻唱」的 joox 结果再加 0.5 分，
// 让"晴天""夜曲"这类不带歌手的搜索也能把原唱顶到最前；
// 搜索聚合后按分数排序，让原唱版本排在翻唱/钢琴版/现场版之前
function artistMatches(candidate, expected) {
    var actual = normText(artistText(candidate));
    var target = normText(expected);
    if (!target) return true;
    if (!actual) return false;
    return actual === target || actual.indexOf(target) !== -1 || target.indexOf(actual) !== -1;
}

function matchScore(item, title, artist) {
    var t = normText(title);
    var a = normText(artist);
    var it = normText(item.title || item.name);
    var score = 0;
    if (!t || !it) return -50;
    if (it === t) score += 24;
    else if (it.indexOf(t) !== -1 || t.indexOf(it) !== -1) score += 8;
    else return -50;
    if (a) score += artistMatches(item, artist) ? 24 : -40;
    if (isCoverVersion(item) && !isCoverVersion({ title: title })) score -= 24;
    if (!isCoverVersion(item) && (item._gdSource === "joox" || item.source === "joox")) {
        score += 0.5;
    }
    return score;
}

function queryScore(item, query) {
    var q = normText(query);
    var title = normText(item.title || item.name);
    var artist = normText(artistText(item));
    var combined = title + artist;
    var score = 0;
    if (!q || !title) return -20;
    if (q === title) score += 12;
    else if (q === combined || combined.indexOf(q) !== -1) score += 16;
    else if (q.indexOf(title) !== -1) score += 10;
    else if (title.indexOf(q) !== -1) score += 5;
    if (artist && q.indexOf(artist) !== -1) score += 8;
    if (isCoverVersion(item)) score -= 10;
    return score;
}

// 单个音源搜索，失败静默降级为空数组
function searchOneSource(source, query, page) {
    return requestGD({
        types: "search",
        source: source,
        name: query,
        count: 20,
        pages: page,
    })
        .then(function (data) {
            return Array.isArray(data) ? data : [];
        })
        .catch(function () {
            return [];
        });
}

// 解析用户输入的歌单链接 / 歌单ID，返回 { source, id }，无法识别返回 null
// 支持常见国内平台：网易云(默认)、QQ音乐、酷狗、酷我、咪咕，均可映射到 GD 聚合音源
function parsePlaylistInput(text) {
    var s = String(text || "").trim();
    if (!s) return null;
    var source = null;
    var id = null;
    // 网易云：兼容 PC 分享(music.163.com/#/playlist?id=)、移动端(y.music.163.com/m/playlist?id=)、
    // 简洁链接(music.163.com/playlist?id= 或 /playlist/xxx)、纯数字ID
    var m = s.match(/(?:music\.163\.com|y\.music\.163\.com)[^#?\s]*(?:#\/)?playlist(?:\?[^\s]*?id=|\/)(\d+)/i);
    if (m) { source = "netease"; id = m[1]; }
    // QQ音乐：y.qq.com .../playlist/xxx 或 .../playlist?id=xxx
    if (!source) {
        var q = s.match(/y\.qq\.com[^\s]*?playlist(?:\/|(?:\?[^\s]*?id=))(\d+)/i);
        if (q) { source = "tencent"; id = q[1]; }
    }
    // QQ音乐分享页：i.y.qq.com/n2/m/share/details/taoge.html? ... id=xxx
    if (!source) {
        var q2 = s.match(/i\.y\.qq\.com[^\s]*?id=(\d+)/i);
        if (q2) { source = "tencent"; id = q2[1]; }
    }
    // 酷狗：kugou.com/yy/special/single/{id}
    if (!source) {
        var kg = s.match(/kugou\.com[^#\s]*special\/single\/([a-z0-9]+)/i);
        if (kg) { source = "kugou"; id = kg[1]; }
    }
    // 酷我：kuwo.cn/playlist_detail/{id}
    if (!source) {
        var kw = s.match(/kuwo\.cn[^#\s]*playlist[^\/]*\/(\d+)/i);
        if (kw) { source = "kuwo"; id = kw[1]; }
    }
    // 咪咕：music.migu.cn 歌单链接 m.migu.cn/playlist/{id}
    if (!source) {
        var mg = s.match(/migu\.cn[^#\s]*playlist[^\/]*\/(\d+)/i);
        if (mg) { source = "migu"; id = mg[1]; }
    }
    // 纯数字ID默认网易云歌单
    if (!source && /^\d+$/.test(s)) { source = "netease"; id = s; }
    if (!source || !id) return null;
    return { source: source, id: id };
}

// 将歌单接口返回的单曲格式化为 MusicFree 歌曲条目
// source 为发起歌单的音源，歌单内所有歌曲均按该音源取播放地址 / 歌词
function formatPlaylistTrack(track, source) {
    var trackId = String(track.id || track.songmid || track.hash || track.rid || track.copyrightId || "");
    if (!trackId) return null;
    var album = track.al || track.album || {};
    var albumName = typeof album === "string" ? album : album.name || album.title || "";
    var picId = album.pic || album.picUrl || track.pic_id || track.picId || track.cover || null;
    var artistList = track.ar || track.artist || track.singer || track.artists || [];
    var artists = Array.isArray(artistList)
        ? artistList.map(function (a) { return typeof a === "string" ? a : a.name || a.title || ""; }).filter(Boolean).join(" / ")
        : String(artistList || "");
    return {
        id: source + "-" + trackId,
        platform: "GD音乐台",
        title: track.name || track.title || track.songname || "",
        artist: artists,
        album: albumName,
        duration: track.duration || track.dt || track.interval || undefined,
        artwork: typeof picId === "string" && /^https?:\/\//.test(picId) ? picId : undefined,
        _gdSource: source,
        _gdId: trackId,
        _gdPicId: picId,
        _gdLyricId: track.lyric_id || track.lyricId || trackId,
    };
}

// ===== QQ 歌单导入 =====
// GD 聚合接口不支持 tencent 源（types=playlist/url/lyric 对 source=tencent 均返回 400），
// 因此 QQ 歌单直接调用 QQ 官方公开接口获取曲目元数据（歌名/歌手/专辑/时长/封面）。
// 导入的曲目不携带 GD 原始 ID，播放时由 findTrackInSource 通过「歌名 + 歌手」
// 在 GD 支持的源（netease/joox/bilibili）中重新检索匹配，从而拿到可播放地址与歌词。
var QQ_PLAYLIST_API = "https://u.y.qq.com/cgi-bin/musicu.fcg";
var QQ_REQUEST_HEADERS = {
    Referer: "https://y.qq.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Content-Type": "application/json",
};

function fetchQQPlaylistPage(disstid, songBegin, songNum) {
    var numericId = Number(disstid);
    var body = JSON.stringify({
        comm: { ct: 24, cv: 0 },
        req: {
            module: "music.srfDissInfo.aiDissInfo",
            method: "uniform_get_Dissinfo",
            param: {
                disstid: isNaN(numericId) ? disstid : numericId,
                enc_host_uin: "",
                tag: 1,
                userinfo: 1,
                song_begin: songBegin,
                song_num: songNum,
                onlysonglist: 1,
            },
        },
    });
    return axios
        .post(QQ_PLAYLIST_API, body, { headers: QQ_REQUEST_HEADERS, timeout: REQUEST_TIMEOUT })
        .then(function (res) {
            var data = res.data;
            if (!data || !data.req || data.req.code !== 0) {
                return { songlist: [], songnum: 0 };
            }
            var dirinfo = (data.req.data && data.req.data.dirinfo) || {};
            var songlist = (data.req.data && data.req.data.songlist) || [];
            return { songlist: songlist, songnum: dirinfo.songnum || songlist.length };
        });
}

function formatQQTrack(track) {
    var trackId = track.mid || track.songmid || "";
    if (!trackId) return null;
    var album = track.album || {};
    var albumName = typeof album === "string" ? album : (album.name || album.title || "");
    var albumMid = typeof album === "string" ? "" : (album.mid || track.albummid || "");
    var picUrl = albumMid
        ? "https://y.qq.com/music/photo_new/T002R300x300M000" + albumMid + ".jpg"
        : "";
    var singerList = track.singer || [];
    var artists = Array.isArray(singerList)
        ? singerList.map(function (a) { return a.name || ""; }).filter(Boolean).join(" / ")
        : String(singerList || "");
    return {
        id: "qq-" + trackId,
        platform: "GD音乐台",
        title: track.name || track.songname || "",
        artist: artists,
        album: albumName,
        duration: track.interval ? track.interval * 1000 : undefined,
        artwork: picUrl || undefined,
        // 标记为 QQ 元数据，无 GD 原始 ID；播放时由 findTrackInSource
        // 通过「歌名 + 歌手」在 GD 支持源中重新检索匹配。
        _gdSource: "qqmeta",
        _gdId: "",
        _gdPicId: albumMid,
        _gdLyricId: "",
    };
}

function importQQPlaylist(id) {
    var disstid = String(id);
    var tracks = [];
    var seen = {};
    var songBegin = 0;
    var songNum = 1000;
    var total = -1;
    function nextPage() {
        return fetchQQPlaylistPage(disstid, songBegin, songNum).then(function (res) {
            if (total < 0) total = res.songnum || 0;
            if (!res.songlist.length) return tracks;
            res.songlist.forEach(function (track) {
                var formatted = formatQQTrack(track);
                if (!formatted) return;
                if (seen[formatted.id]) return;
                seen[formatted.id] = true;
                tracks.push(formatted);
            });
            songBegin += res.songlist.length;
            if (songBegin < total) return nextPage();
            return tracks;
        });
    }
    return nextPage()
        .then(function (result) { return result.length ? result : null; })
        .catch(function () { return tracks.length ? tracks : null; });
}

// 源记忆：曲目ID -> 上次成功播放的源
// 播放时优先使用上次成功的源，避免每次歌单都从默认（可能是失效的）源开始，节省切换时间
// 仅进程内生效，App 重启后回到默认源；换源成功后也会写回歌单条目（由 App 层持久化）
var SOURCE_MEMORY = {};

// 构建候选音源顺序：记忆源 -> 默认源 -> 其他稳定源
// 对于 QQ 歌单导入的 qqmeta 条目（无 GD 原始 ID），其默认源不是真实 GD 源，
// 不能直接搜索，故跳过，直接从稳定源开始匹配。
function buildSourceCandidates(musicItem) {
    var defaultSource = musicItem._gdSource || "netease";
    var id = String(musicItem._gdId || musicItem.id || "");
    var memoryKey = defaultSource + ":" + id;
    var candidates = [];
    var remembered = id ? SOURCE_MEMORY[memoryKey] : null;
    if (remembered && remembered !== defaultSource) candidates.push(remembered);
    var defaultSourceUsable = STABLE_SOURCES.indexOf(defaultSource) !== -1;
    if (defaultSourceUsable && candidates.indexOf(defaultSource) === -1) {
        candidates.push(defaultSource);
    }
    STABLE_SOURCES.forEach(function (s) {
        if (candidates.indexOf(s) === -1) candidates.push(s);
    });
    return { candidates: candidates, id: id, defaultSource: defaultSource, memoryKey: memoryKey };
}

// 对一批搜索结果按「歌名 + 歌手」打分排序，返回最佳匹配项；不满足阈值返回 null。
// 用于 findTrackInSource 的两轮匹配（带歌手 / 仅歌名回退）。
function pickBestMatch(items, title, artist, requireArtist) {
    var scored = items.map(function (item) {
        return { item: item, score: matchScore(item, title, artist) };
    }).sort(function (a, b) { return b.score - a.score; });
    var minimum = requireArtist ? 32 : 20;
    if (!scored.length || scored[0].score < minimum) return null;
    if (requireArtist && scored[1] && scored[0].score - scored[1].score < 6 &&
        !artistMatches(scored[1].item, artist)) return null;
    // 仅歌名回退时，额外排除翻唱/伴奏/纯音乐等非原唱版本，
    // 避免 QQ 歌单里错误的歌手名（如把「逆战」标成翻唱歌手）导致播到错版本。
    if (!requireArtist && isCoverVersion(scored[0].item) && !isCoverVersion({ title: title })) {
        var original = scored.find(function (e) { return !isCoverVersion(e.item); });
        if (!original || original.score < minimum) return null;
        return original.item;
    }
    return scored[0].item;
}

function findTrackInSource(source, musicItem) {
    if (source === (musicItem._gdSource || "netease") && musicItem._gdId) {
        return Promise.resolve({
            id: musicItem._gdId,
            lyric_id: musicItem._gdLyricId || musicItem._gdId,
            source: source,
        });
    }
    var title = String(musicItem.title || "").trim();
    var artist = String(musicItem.artist || "").trim();
    if (!title) return Promise.resolve(null);

    function searchAndPick(keyword, useArtist) {
        return searchOneSource(source, keyword, 1).then(function (items) {
            items.forEach(function (item) { item.source = item.source || source; });
            return pickBestMatch(items, title, useArtist ? artist : "", useArtist);
        });
    }

    // 第一轮：「歌名 + 歌手」严格匹配原唱
    var firstKeyword = artist ? title + " " + artist : title;
    return searchAndPick(firstKeyword, !!artist).then(function (found) {
        if (found) return found;
        // 回退：仅用歌名搜索。适用于 QQ 歌单里歌手名是翻唱者/标注错误的情况，
        // 此时忽略歌手约束，取最高分的原唱版本。
        if (!artist) return null;
        return searchAndPick(title, false);
    });
}

// 歌词兜底：候选源（joox/bilibili/tencent 等）歌词为空时，
// 用「歌名 + 歌手」并发搜索多个稳定源，按命中质量优先取原唱歌曲，再取其歌词。
// 若带歌手匹配不到（QQ 歌单歌手名错误等），回退到仅歌名搜索，取最高分原唱。
// 仅在直接取歌词失败时才调用，尽量节省接口频率额度。
function fallbackSearchLyric(musicItem) {
    var title = String(musicItem.title || "").trim();
    if (!title) {
        return Promise.resolve(null);
    }
    var artist = String(musicItem.artist || "").trim();

    function searchAcrossSources(keyword, useArtist) {
        var tasks = STABLE_SOURCES.map(function (source) {
            return searchOneSource(source, keyword, 1);
        });
        return Promise.all(tasks).then(function (results) {
            var scored = [];
            results.forEach(function (items, index) {
                items.forEach(function (item) {
                    item.source = item.source || STABLE_SOURCES[index];
                    scored.push({
                        item: item,
                        score: matchScore(item, title, useArtist ? artist : ""),
                    });
                });
            });
            scored.sort(function (a, b) { return b.score - a.score; });
            var minimum = useArtist ? 32 : 20;
            var candidates = scored.filter(function (entry) {
                return entry.score >= minimum;
            });
            // 仅歌名回退时跳过翻唱/伴奏版本
            if (!useArtist) {
                candidates = candidates.filter(function (entry) {
                    return !isCoverVersion(entry.item) || isCoverVersion({ title: title });
                });
            }
            return candidates.slice(0, 8);
        });
    }

    function tryLyrics(candidates) {
        var index = 0;
        function next() {
            if (index >= candidates.length) return null;
            var found = candidates[index].item;
            index += 1;
            var nid = found.lyric_id || found.lyricId || found.id;
            if (!nid) return next();
            return requestGD({
                types: "lyric",
                source: found.source || "netease",
                id: nid,
            }).then(function (data) {
                if (data && data.lyric && !data.lyric.includes("暂无歌词")) {
                    return {
                        rawLrc: data.lyric,
                        translation: data.tlyric || undefined,
                    };
                }
                return next();
            }).catch(next);
        }
        return next();
    }

    var firstKeyword = artist ? title + " " + artist : title;
    return searchAcrossSources(firstKeyword, !!artist)
        .then(function (candidates) {
            if (candidates.length) return candidates;
            if (!artist) return [];
            return searchAcrossSources(title, false);
        })
        .then(function (candidates) {
            return tryLyrics(candidates);
        })
        .catch(function () {
            return null;
        });
}

module.exports = {
    platform: "GD音乐台",
    author: "GD Studio",
    version: "1.3.0",
    cacheControl: "no-cache",
    supportedSearchType: ["music", "lyric"],
    primaryKey: ["id"],
    hints: {
        search: [
            "音源由 GD音乐台(music.gdstudio.xyz) 聚合 API 提供，仅限学习交流使用",
            "一次搜索聚合 网易云 / JOOX / B站 等稳定源结果",
            "该接口有访问频率限制（5分钟内50次），请勿频繁搜索",
        ],
        importMusicSheet: [
            "支持导入网易云 / QQ音乐歌单：粘贴歌单链接或歌单ID",
            "酷狗 / 酷我 / 咪咕歌单走 GD 聚合接口，可能返回空",
            "该接口有访问频率限制（5分钟内50次），请勿频繁导入",
        ],
    },

    // 搜索：并发请求多个稳定源并聚合，按「歌名+歌手」命中质量排序，
    // 让原唱版本排在翻唱/钢琴版/现场版之前，避免播放/歌词匹配到错误版本
    search: function (query, page, type) {
        if (type !== "music" && type !== "lyric") {
            return Promise.resolve({ isEnd: true, data: [] });
        }
        var rawQuery = String(query || "").trim();
        if (!rawQuery) return Promise.resolve({ isEnd: true, data: [] });
        var pageNumber = Math.max(1, Number(page) || 1);
        var tasks = STABLE_SOURCES.map(function (source) {
            return searchOneSource(source, rawQuery, pageNumber);
        });
        return Promise.all(tasks).then(function (results) {
            var list = [];
            var hasFullPage = false;
            results.forEach(function (arr) {
                if (arr.length >= 20) hasFullPage = true;
                list = list.concat(arr);
            });
            var seen = {};
            var mapped = list.map(formatSearchItem).filter(function (item) {
                var key = item._gdSource + ":" + item._gdId;
                if (seen[key]) return false;
                seen[key] = true;
                return true;
            });
            mapped.sort(function (a, b) {
                return queryScore(b, rawQuery) - queryScore(a, rawQuery);
            });
            return {
                isEnd: !hasFullPage,
                data: mapped,
            };
        });
    },

    // 获取播放地址：优先记忆源 -> 默认源 -> 其他稳定源；每源内优先目标音质，失败降级 320
    // 成功后记录到源记忆，下次播放直接使用，避免每次歌单都从失效的默认源重新切换
    getMediaSource: function (musicItem, quality) {
        var srcInfo = buildSourceCandidates(musicItem);
        var brList = [QUALITY_BR[quality] || 320, 320];
        var candidateIdx = 0;
        function nextCandidate() {
            if (candidateIdx >= srcInfo.candidates.length) return Promise.resolve(null);
            var source = srcInfo.candidates[candidateIdx];
            candidateIdx += 1;
            return findTrackInSource(source, musicItem).then(function (track) {
                if (!track || !track.id) return nextCandidate();
                var brIdx = 0;
                function nextQuality() {
                    if (brIdx >= brList.length) return nextCandidate();
                    var br = brList[brIdx];
                    brIdx += 1;
                    return requestGD({ types: "url", source: source, id: track.id, br: br })
                        .then(function (data) {
                            if (data && data.url) {
                                if (srcInfo.id) SOURCE_MEMORY[srcInfo.memoryKey] = source;
                                return { url: data.url };
                            }
                            return nextQuality();
                        })
                        .catch(nextQuality);
                }
                return nextQuality();
            }).catch(nextCandidate);
        }
        return nextCandidate();
    },

    // 获取歌词（含翻译）：依次尝试候选源（记忆源 -> 默认源 -> 其他稳定源），
    // 单个源歌词缺失/失败/占位（如「暂无歌词」）时降级到下一个源，提高歌词命中率；
    // 候选源全部无歌词（joox/bilibili 等源歌词常为空）时，用「歌名+歌手」
    // 并发搜索稳定源取原唱歌词
    getLyric: function (musicItem) {
        var srcInfo = buildSourceCandidates(musicItem);
        var candidateIdx = 0;
        function nextCandidate() {
            if (candidateIdx >= srcInfo.candidates.length) {
                return fallbackSearchLyric(musicItem);
            }
            var source = srcInfo.candidates[candidateIdx];
            candidateIdx += 1;
            return findTrackInSource(source, musicItem).then(function (track) {
                if (!track) return nextCandidate();
                var lyricId = track.lyric_id || track.lyricId || track.id;
                if (!lyricId) return nextCandidate();
                return requestGD({
                    types: "lyric",
                    source: source,
                    id: lyricId,
                }).then(function (data) {
                    if (data && data.lyric && !data.lyric.includes("暂无歌词")) {
                        return {
                            rawLrc: data.lyric,
                            translation: data.tlyric || undefined,
                        };
                    }
                    return nextCandidate();
                }).catch(nextCandidate);
            }).catch(nextCandidate);
        }
        return nextCandidate();
    },

    // 播放成功后补充封面图（列表封面不逐个请求，避免快速消耗接口频率额度）
    getMusicInfo: function (musicItem) {
        const source = musicItem._gdSource || "netease";
        const picId = musicItem._gdPicId;
        if (!picId) {
            return Promise.resolve(null);
        }
        return requestGD({
            types: "pic",
            source: source,
            id: picId,
            size: 300,
        })
            .then(function (data) {
                if (data && data.url) {
                    return { artwork: data.url };
                }
                return null;
            })
            .catch(function () {
                return null;
            });
    },

    // 导入歌单：解析链接/ID 后请求歌单接口，返回歌曲列表
    // - QQ 音乐歌单走 QQ 官方接口取曲目元数据（GD 不支持 tencent 歌单），
    //   导入曲目播放时由 findTrackInSource 重新在 GD 源中检索匹配；
    // - 其他平台走 GD 聚合歌单接口。
    // 返回 null 或空数组表示无法识别/歌单为空，由 App 提示
    importMusicSheet: function (urlLike) {
        var parsed = parsePlaylistInput(urlLike);
        if (!parsed) return Promise.resolve(null);
        if (parsed.source === "tencent") {
            return importQQPlaylist(parsed.id);
        }
        var page = 1;
        var count = 100;
        var maxPages = 20;
        var tracks = [];
        var seenTracks = {};
        var seenPages = {};
        function nextPage() {
            return requestGD({
                types: "playlist",
                source: parsed.source,
                id: parsed.id,
                count: count,
                pages: page,
            }).then(function (data) {
                var pageTracks = [];
                if (data && data.playlist && Array.isArray(data.playlist.tracks)) {
                    pageTracks = data.playlist.tracks;
                } else if (data && Array.isArray(data.tracks)) {
                    pageTracks = data.tracks;
                } else if (Array.isArray(data)) {
                    pageTracks = data;
                }
                if (!pageTracks.length) return tracks;
                var pageKeys = [];
                pageTracks.forEach(function (track) {
                    var formatted = formatPlaylistTrack(track, parsed.source);
                    if (!formatted) return;
                    var key = formatted._gdSource + ":" + formatted._gdId;
                    pageKeys.push(key);
                    if (seenTracks[key]) return;
                    seenTracks[key] = true;
                    tracks.push(formatted);
                });
                var pageSignature = pageKeys.join("|");
                if (!pageSignature || seenPages[pageSignature]) return tracks;
                seenPages[pageSignature] = true;
                var total = data && data.playlist && Number(data.playlist.trackCount || data.playlist.total || 0);
                var hasMore = total > 0 ? tracks.length < total : pageTracks.length >= count;
                if (hasMore && page < maxPages) {
                    page += 1;
                    return nextPage();
                }
                return tracks;
            });
        }
        return nextPage().then(function (result) {
            return result.length ? result : null;
        }).catch(function () {
            return tracks.length ? tracks : null;
        });
    },
};
