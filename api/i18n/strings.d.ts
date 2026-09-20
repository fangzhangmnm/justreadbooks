export type Lang = "zh" | "en";
export declare const S: {
    readonly "common.ok": {
        readonly zh: "确定";
        readonly en: "OK";
    };
    readonly "common.cancel": {
        readonly zh: "取消";
        readonly en: "Cancel";
    };
    readonly "common.close": {
        readonly zh: "关闭";
        readonly en: "Close";
    };
    readonly "common.later": {
        readonly zh: "稍后";
        readonly en: "Later";
    };
    readonly "ui.appTitle": {
        readonly zh: "读书";
        readonly en: "JustReadBooks";
    };
    readonly "ui.shelf": {
        readonly zh: "书架";
        readonly en: "Shelf";
    };
    readonly "ui.chapters": {
        readonly zh: "目录";
        readonly en: "Chapters";
    };
    readonly "ui.settings": {
        readonly zh: "设置";
        readonly en: "Settings";
    };
    readonly "ui.cloud": {
        readonly zh: "云端";
        readonly en: "Cloud";
    };
    readonly "ui.readerAria": {
        readonly zh: "阅读区";
        readonly en: "Reader";
    };
    readonly "ui.busy": {
        readonly zh: "处理中…";
        readonly en: "Working…";
    };
    readonly "ui.busyHint": {
        readonly zh: "请稍候";
        readonly en: "Please wait";
    };
    readonly "ui.busyAria": {
        readonly zh: "处理中";
        readonly en: "Working";
    };
    readonly "ui.updateText": {
        readonly zh: "有新版本";
        readonly en: "Update available";
    };
    readonly "ui.updateReload": {
        readonly zh: "刷新";
        readonly en: "Reload";
    };
    readonly "ui.updateDismiss": {
        readonly zh: "忽略";
        readonly en: "Dismiss";
    };
    readonly "ui.sheetInput2Ph": {
        readonly zh: "再次输入以确认";
        readonly en: "Repeat to confirm";
    };
    readonly "ui.landingTitle": {
        readonly zh: "还没有打开的书";
        readonly en: "No book open";
    };
    readonly "ui.landingHint": {
        readonly zh: "去书架挑一本，或把 txt 拖进来。";
        readonly en: "Pick one from the shelf, or drop a .txt here.";
    };
    readonly "ui.openShelf": {
        readonly zh: "打开书架";
        readonly en: "Open shelf";
    };
    readonly "ui.dropHint": {
        readonly zh: "松手上传到当前文件夹";
        readonly en: "Drop to upload into this folder";
    };
    readonly "ui.uploadTxt": {
        readonly zh: "上传 txt";
        readonly en: "Upload .txt";
    };
    readonly "err.dismissHint": {
        readonly zh: "点击关闭";
        readonly en: "tap to dismiss";
    };
    readonly "err.cloudNetwork": {
        readonly zh: "云端连不上（网络问题），稍后再试。";
        readonly en: "Cloud unreachable (network problem), try again later.";
    };
    readonly "gal.title": {
        readonly zh: "书架";
        readonly en: "Shelf";
    };
    readonly "gal.aria": {
        readonly zh: "书架";
        readonly en: "Shelf";
    };
    readonly "gal.back": {
        readonly zh: "回到阅读";
        readonly en: "Back to reading";
    };
    readonly "gal.trash": {
        readonly zh: "回收站";
        readonly en: "Trash";
    };
    readonly "gal.trashBack": {
        readonly zh: "回到书架";
        readonly en: "Back to shelf";
    };
    readonly "gal.emptyTrash": {
        readonly zh: "清空回收站";
        readonly en: "Empty trash";
    };
    readonly "gal.emptyTrashWhich": {
        readonly zh: "清空哪一边？";
        readonly en: "Empty which side?";
    };
    readonly "gal.emptyTrashLocal": {
        readonly zh: "只清本机";
        readonly en: "Local only";
    };
    readonly "gal.emptyTrashCloud": {
        readonly zh: "只清云端";
        readonly en: "Cloud only";
    };
    readonly "gal.emptyTrashBoth": {
        readonly zh: "本机和云端";
        readonly en: "Both";
    };
    readonly "gal.settings": {
        readonly zh: "设置";
        readonly en: "Settings";
    };
    readonly "gal.refresh": {
        readonly zh: "刷新云端";
        readonly en: "Refresh cloud";
    };
    readonly "galx.emptyNone": {
        readonly zh: "书架还是空的。把 txt 拖进来，或在 OneDrive 的 Apps/JustReadBooks 里放书。";
        readonly en: "The shelf is empty. Drop a .txt here, or put books into OneDrive › Apps › JustReadBooks.";
    };
    readonly "galx.emptyFolder": {
        readonly zh: "「{f}」是空的";
        readonly en: "“{f}” is empty";
    };
    readonly "galx.emptyTrash": {
        readonly zh: "回收站是空的。";
        readonly en: "Trash is empty.";
    };
    readonly "galx.tileActive": {
        readonly zh: "在读";
        readonly en: "Reading";
    };
    readonly "galx.otherFile": {
        readonly zh: "文件（不是 txt）";
        readonly en: "File (not .txt)";
    };
    readonly "galx.firstFrameFailed": {
        readonly zh: "书架读取失败（详见诊断日志）";
        readonly en: "Shelf listing failed (see diagnostic log)";
    };
    readonly "galx.firstFrameTimeout": {
        readonly zh: "书架读取超时：本地存储没有响应";
        readonly en: "Shelf listing timed out: local storage did not respond";
    };
    readonly "galx.recent": {
        readonly zh: "继续读";
        readonly en: "Continue";
    };
    readonly "cloud.account": {
        readonly zh: "云端：{who}";
        readonly en: "Cloud: {who}";
    };
    readonly "cloud.accountOffline": {
        readonly zh: "云端：{who}（离线）";
        readonly en: "Cloud: {who} (offline)";
    };
    readonly "cloud.notConnected": {
        readonly zh: "未连接 OneDrive";
        readonly en: "Not connected to OneDrive";
    };
    readonly "cloud.connect": {
        readonly zh: "连接 OneDrive";
        readonly en: "Connect OneDrive";
    };
    readonly "cloud.disconnect": {
        readonly zh: "断开";
        readonly en: "Disconnect";
    };
    readonly "cloud.refresh": {
        readonly zh: "刷新云端";
        readonly en: "Refresh cloud";
    };
    readonly "cloud.titleIn": {
        readonly zh: "云端：{who}（点开账号菜单）";
        readonly en: "Cloud: {who} (tap for account menu)";
    };
    readonly "cloud.titleOffline": {
        readonly zh: "云端：{who}（离线）";
        readonly en: "Cloud: {who} (offline)";
    };
    readonly "cloud.titleOut": {
        readonly zh: "未连接 OneDrive（点击连接）";
        readonly en: "Not connected (tap to connect)";
    };
    readonly "auth.readyTitle": {
        readonly zh: "去登录？";
        readonly en: "Sign in?";
    };
    readonly "auth.readyMsg": {
        readonly zh: "会跳到微软登录页，登录后回到这里。";
        readonly en: "You will be taken to the Microsoft sign-in page and brought back here.";
    };
    readonly "auth.go": {
        readonly zh: "去登录";
        readonly en: "Sign in";
    };
    readonly "auth.later": {
        readonly zh: "暂不";
        readonly en: "Not now";
    };
    readonly "auth.redirecting": {
        readonly zh: "正在跳转登录…";
        readonly en: "Redirecting to sign-in…";
    };
    readonly "auth.signInFailed": {
        readonly zh: "登录失败：{e}";
        readonly en: "Sign-in failed: {e}";
    };
    readonly "auth.signOutTitle": {
        readonly zh: "断开 OneDrive？";
        readonly en: "Disconnect OneDrive?";
    };
    readonly "auth.signOutMsg": {
        readonly zh: "只清本 app 的登录，书的本机副本保留。";
        readonly en: "Only this app’s sign-in is cleared; local copies of books stay.";
    };
    readonly "auth.signedOut": {
        readonly zh: "已断开";
        readonly en: "Disconnected";
    };
    readonly "auth.flushFailed": {
        readonly zh: "落盘失败，没有跳转登录";
        readonly en: "Could not save first — not navigating";
    };
    readonly "auth.signedIn": {
        readonly zh: "已登录";
        readonly en: "Signed in";
    };
    readonly "rd.prev": {
        readonly zh: "‹ 上一章";
        readonly en: "‹ Prev";
    };
    readonly "rd.next": {
        readonly zh: "下一章 ›";
        readonly en: "Next ›";
    };
    readonly "rd.chapterN": {
        readonly zh: "第 {n} 章";
        readonly en: "Chapter {n}";
    };
    readonly "rd.head": {
        readonly zh: "（开头）";
        readonly en: "(Beginning)";
    };
    readonly "rd.whole": {
        readonly zh: "全文";
        readonly en: "Full text";
    };
    readonly "rd.progress": {
        readonly zh: "{i} / {n}";
        readonly en: "{i} / {n}";
    };
    readonly "rd.updated": {
        readonly zh: "这本书有更新：+{n} 章";
        readonly en: "This book was updated: +{n} chapters";
    };
    readonly "rd.updatedCurrent": {
        readonly zh: "本章有更新";
        readonly en: "This chapter was updated";
    };
    readonly "rd.updatedPlain": {
        readonly zh: "这本书有更新";
        readonly en: "This book was updated";
    };
    readonly "rd.reload": {
        readonly zh: "刷新";
        readonly en: "Reload";
    };
    readonly "rd.opening": {
        readonly zh: "打开中…";
        readonly en: "Opening…";
    };
    readonly "rd.downloading": {
        readonly zh: "下载中 {pct}%";
        readonly en: "Downloading {pct}%";
    };
    readonly "rd.downloadingUnknown": {
        readonly zh: "下载中…";
        readonly en: "Downloading…";
    };
    readonly "rd.unavailable": {
        readonly zh: "本机没有这本书，云端也够不着。";
        readonly en: "Not on this device, and the cloud is unreachable.";
    };
    readonly "rd.bigTitle": {
        readonly zh: "这本书很大";
        readonly en: "Big book";
    };
    readonly "rd.bigMsg": {
        readonly zh: "「{name}」有 {size}，手机上可能开不动。仍要打开？";
        readonly en: "“{name}” is {size}; it may not open on a phone. Open anyway?";
    };
    readonly "rd.bigOpen": {
        readonly zh: "仍要打开";
        readonly en: "Open anyway";
    };
    readonly "rd.badTxt": {
        readonly zh: "读不出这个文件的文字。";
        readonly en: "Could not read this file as text.";
    };
    readonly "rd.chaptersTitle": {
        readonly zh: "目录 · {n} 章";
        readonly en: "Chapters · {n}";
    };
    readonly "rd.chaptersSearchPh": {
        readonly zh: "搜章名";
        readonly en: "Search chapters";
    };
    readonly "rd.chaptersEmpty": {
        readonly zh: "没有匹配的章";
        readonly en: "No matching chapter";
    };
    readonly "rd.jump": {
        readonly zh: "跳转";
        readonly en: "Go";
    };
    readonly "rd.statusOpening": {
        readonly zh: "正在打开「{name}」";
        readonly en: "Opening “{name}”";
    };
    readonly "st.synced": {
        readonly zh: "已同步";
        readonly en: "Synced";
    };
    readonly "st.offline": {
        readonly zh: "离线";
        readonly en: "Offline";
    };
    readonly "st.online": {
        readonly zh: "已联网";
        readonly en: "Online";
    };
    readonly "st.upToDate": {
        readonly zh: "已是最新";
        readonly en: "Up to date";
    };
    readonly "st.refreshed": {
        readonly zh: "已更新到云端最新版";
        readonly en: "Updated to the latest cloud version";
    };
    readonly "st.syncing": {
        readonly zh: "同步中…";
        readonly en: "Syncing…";
    };
    readonly "st.uploading": {
        readonly zh: "上传中…";
        readonly en: "Uploading…";
    };
    readonly "st.uploaded": {
        readonly zh: "已上传：{name}";
        readonly en: "Uploaded: {name}";
    };
    readonly "st.uploadedLocal": {
        readonly zh: "已存到本机：{name}（未登录，联网登录后再推）";
        readonly en: "Saved locally: {name} (will upload once signed in)";
    };
    readonly "st.uploadFail": {
        readonly zh: "上传失败：{e}";
        readonly en: "Upload failed: {e}";
    };
    readonly "st.notTxt": {
        readonly zh: "跳过 {name}：不是 txt";
        readonly en: "Skipped {name}: not a .txt";
    };
    readonly "st.keptOffline": {
        readonly zh: "已留离线：{name}";
        readonly en: "Kept offline: {name}";
    };
    readonly "st.keepOfflineFail": {
        readonly zh: "留离线失败：{e}";
        readonly en: "Keep offline failed: {e}";
    };
    readonly "st.offloaded": {
        readonly zh: "已移除本机副本：{name}";
        readonly en: "Removed local copy: {name}";
    };
    readonly "st.pushed": {
        readonly zh: "已推送到云端：{name}";
        readonly en: "Pushed to cloud: {name}";
    };
    readonly "st.pushFail": {
        readonly zh: "推送失败（离线或未登录）";
        readonly en: "Push failed (offline or not signed in)";
    };
    readonly "st.renamed": {
        readonly zh: "已改名：{name}";
        readonly en: "Renamed: {name}";
    };
    readonly "st.renameFail": {
        readonly zh: "改名失败：{e}";
        readonly en: "Rename failed: {e}";
    };
    readonly "st.renameTaken": {
        readonly zh: "{loc}已有同名";
        readonly en: "Name already used in {loc}";
    };
    readonly "st.locLocal": {
        readonly zh: "本机";
        readonly en: "local";
    };
    readonly "st.locCloud": {
        readonly zh: "云端";
        readonly en: "cloud";
    };
    readonly "st.forceUpdated": {
        readonly zh: "已清缓存重启 · {v}";
        readonly en: "Cache cleared and restarted · {v}";
    };
    readonly "st.updateChecking": {
        readonly zh: "正在检查更新…";
        readonly en: "Checking for updates…";
    };
    readonly "st.updateFound": {
        readonly zh: "有新版本，点「刷新」应用";
        readonly en: "Update found — tap Reload to apply";
    };
    readonly "st.updateLatest": {
        readonly zh: "已是最新 · {v}";
        readonly en: "Up to date · {v}";
    };
    readonly "st.updateUnavailable": {
        readonly zh: "此环境无法检查更新 · {v}";
        readonly en: "Update check unavailable here · {v}";
    };
    readonly "st.syncPushing": {
        readonly zh: "正在推送到云端…";
        readonly en: "Pushing to cloud…";
    };
    readonly "st.fileRenaming": {
        readonly zh: "正在改名…";
        readonly en: "Renaming…";
    };
    readonly "st.filePulling": {
        readonly zh: "正在拉取云端新版…";
        readonly en: "Pulling latest from cloud…";
    };
    readonly "st.cloudChecking": {
        readonly zh: "正在检查云端…";
        readonly en: "Checking cloud…";
    };
    readonly "st.fileDeleting": {
        readonly zh: "正在删除…";
        readonly en: "Deleting…";
    };
    readonly "st.trashRestoring": {
        readonly zh: "正在恢复…";
        readonly en: "Restoring…";
    };
    readonly "st.trashPurging": {
        readonly zh: "正在永久删除…";
        readonly en: "Deleting forever…";
    };
    readonly "st.trashEmptyTrash": {
        readonly zh: "正在清空回收站…";
        readonly en: "Emptying trash…";
    };
    readonly "st.trashEmptyBackups": {
        readonly zh: "正在清空备份箱…";
        readonly en: "Emptying backups…";
    };
    readonly "st.fileEncrypting": {
        readonly zh: "正在加密…";
        readonly en: "Encrypting…";
    };
    readonly "st.fileDecrypting": {
        readonly zh: "正在解密…";
        readonly en: "Decrypting…";
    };
    readonly "st.fileRekeying": {
        readonly zh: "正在换密码…";
        readonly en: "Changing password…";
    };
    readonly "st.fileReuploading": {
        readonly zh: "正在重新上传…";
        readonly en: "Re-uploading…";
    };
    readonly "st.folderCreating": {
        readonly zh: "正在新建文件夹…";
        readonly en: "Creating folder…";
    };
    readonly "st.folderDeleting": {
        readonly zh: "正在删除文件夹…";
        readonly en: "Deleting folder…";
    };
    readonly "cf.title": {
        readonly zh: "云端和本机不一致";
        readonly en: "Cloud and local differ";
    };
    readonly "cf.bodyOpen": {
        readonly zh: "「{name}」本机有未上传的改动。";
        readonly en: "“{name}” has local changes not uploaded yet.";
    };
    readonly "cf.bodyPush": {
        readonly zh: "「{name}」在云端和本机各有一版。";
        readonly en: "“{name}” has a different version in the cloud and on this device.";
    };
    readonly "cf.noteKeptSafe": {
        readonly zh: "被替换的那份会进备份箱，不会丢。";
        readonly en: "The replaced copy goes to the backup box; nothing is lost.";
    };
    readonly "cf.openLocal": {
        readonly zh: "先开本机这份";
        readonly en: "Open local for now";
    };
    readonly "cf.cloudWins": {
        readonly zh: "用云端的";
        readonly en: "Use cloud";
    };
    readonly "cf.localWins": {
        readonly zh: "用本机的";
        readonly en: "Use local";
    };
    readonly "cf.checkingCloud": {
        readonly zh: "正在检查云端…";
        readonly en: "Checking cloud…";
    };
    readonly "cf.skipToOffline": {
        readonly zh: "跳过，先读本机";
        readonly en: "Skip, read local";
    };
    readonly "replay.collision": {
        readonly zh: "「{name}」云端已有同名，没有覆盖";
        readonly en: "“{name}” already exists in the cloud; not overwritten";
    };
    readonly "replay.done": {
        readonly zh: "已补推 {done}/{total} 本";
        readonly en: "Uploaded {done}/{total}";
    };
    readonly "replay.progress": {
        readonly zh: "正在补推 {done}/{total}…";
        readonly en: "Uploading {done}/{total}…";
    };
    readonly "replay.askTitle": {
        readonly zh: "同步离线时上传的书？";
        readonly en: "Upload books added offline?";
    };
    readonly "replay.askMsg": {
        readonly zh: "有 {n} 本是离线时存到本机的，现在推到云端？";
        readonly en: "{n} book(s) were saved locally while offline. Push them to the cloud now?";
    };
    readonly "settings.title": {
        readonly zh: "设置";
        readonly en: "Settings";
    };
    readonly "settings.reading": {
        readonly zh: "阅读";
        readonly en: "Reading";
    };
    readonly "settings.fontSize": {
        readonly zh: "字号";
        readonly en: "Font size";
    };
    readonly "settings.lineHeight": {
        readonly zh: "行高";
        readonly en: "Line height";
    };
    readonly "settings.font": {
        readonly zh: "字体";
        readonly en: "Font";
    };
    readonly "settings.fontSans": {
        readonly zh: "黑体";
        readonly en: "Sans";
    };
    readonly "settings.fontSerif": {
        readonly zh: "宋体";
        readonly en: "Serif";
    };
    readonly "settings.width": {
        readonly zh: "行宽";
        readonly en: "Line width";
    };
    readonly "settings.widthNovel": {
        readonly zh: "窄（轻小说，约 22 字/行）";
        readonly en: "Narrow (light-novel, ~22 chars)";
    };
    readonly "settings.widthClassic": {
        readonly zh: "宽（纸书，约 30 字/行）";
        readonly en: "Wide (paperback, ~30 chars)";
    };
    readonly "settings.shelfLayout": {
        readonly zh: "书架布局";
        readonly en: "Shelf layout";
    };
    readonly "settings.shelfList": {
        readonly zh: "列表（长书名整行）";
        readonly en: "List (full titles)";
    };
    readonly "settings.shelfCards": {
        readonly zh: "卡片";
        readonly en: "Cards";
    };
    readonly "settings.theme": {
        readonly zh: "主题";
        readonly en: "Theme";
    };
    readonly "settings.themeAuto": {
        readonly zh: "跟随系统";
        readonly en: "System";
    };
    readonly "settings.themeDay": {
        readonly zh: "象牙白金（日）";
        readonly en: "Ivory (day)";
    };
    readonly "settings.themeNight": {
        readonly zh: "黑金（夜）";
        readonly en: "Black gold (night)";
    };
    readonly "settings.lang": {
        readonly zh: "语言";
        readonly en: "Language";
    };
    readonly "settings.thisBook": {
        readonly zh: "这本书";
        readonly en: "This book";
    };
    readonly "settings.chapterRule": {
        readonly zh: "切章规则";
        readonly en: "Chapter rule";
    };
    readonly "settings.chapterAuto": {
        readonly zh: "自动";
        readonly en: "Auto";
    };
    readonly "settings.chapterCustom": {
        readonly zh: "自定义正则…";
        readonly en: "Custom regex…";
    };
    readonly "settings.chapterCustomTitle": {
        readonly zh: "自定义切章正则";
        readonly en: "Custom chapter regex";
    };
    readonly "settings.chapterCustomMsg": {
        readonly zh: "按行匹配（多行模式）。一个括号 = 标题；两个括号 = 层级 + 标题。";
        readonly en: "Matched per line (multiline). One group = title; two groups = level + title.";
    };
    readonly "settings.chapterBad": {
        readonly zh: "正则不合法：{e}";
        readonly en: "Invalid regex: {e}";
    };
    readonly "settings.chapterCustomPh": {
        readonly zh: "^第.+章$";
        readonly en: "^Chapter .+$";
    };
    readonly "settings.encoding": {
        readonly zh: "编码：{enc}";
        readonly en: "Encoding: {enc}";
    };
    readonly "settings.noBook": {
        readonly zh: "（没有打开的书）";
        readonly en: "(no book open)";
    };
    readonly "settings.app": {
        readonly zh: "应用";
        readonly en: "App";
    };
    readonly "settings.build": {
        readonly zh: "版本";
        readonly en: "Version";
    };
    readonly "settings.checkUpdate": {
        readonly zh: "检查更新";
        readonly en: "Check for updates";
    };
    readonly "settings.forceUpdate": {
        readonly zh: "清缓存重启";
        readonly en: "Clear cache & restart";
    };
    readonly "settings.diag": {
        readonly zh: "诊断日志";
        readonly en: "Diagnostic log";
    };
    readonly "settings.diagCopy": {
        readonly zh: "复制";
        readonly en: "Copy";
    };
    readonly "settings.diagCopied": {
        readonly zh: "已复制";
        readonly en: "Copied";
    };
    readonly "settings.diagEmpty": {
        readonly zh: "（空）";
        readonly en: "(empty)";
    };
    readonly "settings.storage": {
        readonly zh: "本机已存 {n} 本，{size}";
        readonly en: "{n} books on this device, {size}";
    };
    readonly "chapters.builtin.md": {
        readonly zh: "Markdown 多级 (# / ## / ###)";
        readonly en: "Markdown headings (# / ## / ###)";
    };
    readonly "chapters.builtin.md1": {
        readonly zh: "Markdown 只 #";
        readonly en: "Markdown # only";
    };
    readonly "chapters.builtin.md2": {
        readonly zh: "Markdown 只 ##";
        readonly en: "Markdown ## only";
    };
    readonly "chapters.builtin.md3": {
        readonly zh: "Markdown 只 ###";
        readonly en: "Markdown ### only";
    };
    readonly "chapters.builtin.md4": {
        readonly zh: "Markdown 只 ####";
        readonly en: "Markdown #### only";
    };
    readonly "chapters.builtin.zh-chap": {
        readonly zh: "第N章";
        readonly en: "第N章";
    };
    readonly "chapters.builtin.zh-hui": {
        readonly zh: "第N回";
        readonly en: "第N回";
    };
    readonly "chapters.builtin.zh-jie": {
        readonly zh: "第N节";
        readonly en: "第N节";
    };
    readonly "chapters.builtin.zh-juan": {
        readonly zh: "第N卷";
        readonly en: "第N卷";
    };
    readonly "chapters.builtin.zh-pian": {
        readonly zh: "第N篇";
        readonly en: "第N篇";
    };
    readonly "chapters.builtin.zh-spec": {
        readonly zh: "楔子/序章/番外/后记";
        readonly en: "Prologue/epilogue markers";
    };
    readonly "chapters.builtin.en-chap": {
        readonly zh: "Chapter N";
        readonly en: "Chapter N";
    };
};
