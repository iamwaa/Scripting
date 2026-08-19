// 入口：以全屏方式展示主页面，关闭后退出脚本

import { Navigation, Script } from "scripting";

import { HomePage } from "./pages/HomePage";

async function run() {
  await Navigation.present({ element: <HomePage />, modalPresentationStyle: "fullScreen" });
  Script.exit();
}

run();
