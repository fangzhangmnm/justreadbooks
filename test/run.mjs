// 跑全部测：`npm test`（node 直跑 .ts：node 24 strip-types）。新测文件在这里 import 一行即可。created 2026-09-19 by Claude Fable 5.1
import "./redline-guard.test.mjs";
import "./i18n-and-assets.test.mjs";
import "./chapters.test.mjs";
import "./chapters-view.test.mjs";
import "./encoding.test.mjs";
import "./valuable-save.test.mjs";
import { run } from "./runner.mjs";
console.log("\n  JustReadBooks —— app 域测试（store / gallery 契约在各包 test/）\n");
await run();
