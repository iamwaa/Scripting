// ==UserScript==
// @name 解除文字复制限制
// @description 解除网站上的文字复制限制，允许选择和复制任何文字
// @version 1.0.0
// @author Waa
// @homepage https://github.com/iamwaa
// @updateURL https://raw.githubusercontent.com/iamwaa/Scripting/refs/heads/main/UserScript/enable-text-copy.user.js
// @downloadURL https://raw.githubusercontent.com/iamwaa/Scripting/refs/heads/main/UserScript/enable-text-copy.user.js
// @match *://*/*
// @run-at document-start
// @grant GM.addStyle
// @grant GM.log
// ==/UserScript==

(function() {
  'use strict';

  // 移除 CSS 中的 user-select: none 样式
  GM.addStyle(`
    * {
      -webkit-user-select: text !important;
      -moz-user-select: text !important;
      -ms-user-select: text !important;
      user-select: text !important;
    }
  `);

  // 移除事件监听器
  function removeEventListeners() {
    const events = ['selectstart', 'copy', 'cut', 'paste'];
    events.forEach(event => {
      document.addEventListener(event, function(e) {
        e.stopPropagation();
        e.stopImmediatePropagation();
        return true;
      }, true);
    });
  }

  // 移除内联事件处理程序
  function removeInlineEventHandlers() {
    const elements = document.querySelectorAll('[oncopy], [oncut], [onselectstart], [oncontextmenu]');
    elements.forEach(el => {
      el.removeAttribute('oncopy');
      el.removeAttribute('oncut');
      el.removeAttribute('onselectstart');
      el.removeAttribute('oncontextmenu');
    });
  }

  // 初始化
  function init() {
    GM.log('解除文字复制限制脚本已加载');

    // 移除事件监听器
    removeEventListeners();

    // 移除内联事件处理程序
    removeInlineEventHandlers();

    // 监听 DOM 变化，处理动态加载的内容
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.hasAttribute('oncopy')) node.removeAttribute('oncopy');
              if (node.hasAttribute('oncut')) node.removeAttribute('oncut');
              if (node.hasAttribute('onselectstart')) node.removeAttribute('onselectstart');
              if (node.hasAttribute('oncontextmenu')) node.removeAttribute('oncontextmenu');
            }
          });
        }
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    GM.log('解除文字复制限制脚本初始化完成');
  }

  // 在页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();