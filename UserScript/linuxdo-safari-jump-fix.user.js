// ==UserScript==
// @name         修复 LinuxDO 跳转
// @description  修复 iOS Safari 上 window.open 弹窗被拦截的问题，支持 LinuxDO OAuth 登录和 LD士多支付跳转。
// @version      1.0.0
// @author       Waa
// @homepage     https://github.com/iamwaa
// @updateURL    https://raw.githubusercontent.com/iamwaa/Scripting/refs/heads/main/UserScript/linuxdo-safari-jump-fix.user.js
// @downloadURL  https://raw.githubusercontent.com/iamwaa/Scripting/refs/heads/main/UserScript/linuxdo-safari-jump-fix.user.js
// @match        *://*/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const ONLY_IOS = true;
  const MAX_GESTURE_AGE_MS = 3000;
  let lastGestureAt = 0;

  function isIOSWebKit() {
    const ua = navigator.userAgent || '';
    return (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && /AppleWebKit/i.test(ua);
  }

  function isLinuxDOJumpUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url, location.href);
      const host = u.hostname.toLowerCase();
      const path = u.pathname.toLowerCase();
      const search = u.search.toLowerCase();
      return (host === 'connect.linux.do' && path.startsWith('/oauth2/authorize')) ||
             (host === 'linux.do' && path.includes('/auth/')) ||
             (host === 'credit.linux.do' && path.includes('/paying'));
    } catch {
      return false;
    }
  }

  if (ONLY_IOS && !isIOSWebKit()) return;

  ['pointerdown', 'touchstart', 'click'].forEach(type => {
    document.addEventListener(type, () => { lastGestureAt = Date.now(); }, true);
  });

  const realOpen = window.open.bind(window);
  window.open = function (url, target, features) {
    if (isLinuxDOJumpUrl(url) && Date.now() - lastGestureAt <= MAX_GESTURE_AGE_MS) {
      location.assign(String(url));
      return window;
    }
    return realOpen(url, target, features);
  };
})();
