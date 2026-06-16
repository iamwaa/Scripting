// ==UserScript==
// @name 元素屏蔽器
// @version 1.0.1
// @author Waa
// @homepage https://github.com/iamwaa
// @updateURL https://raw.githubusercontent.com/iamwaa/Scripting/refs/heads/main/UserScript/element-blocker.user.js
// @downloadURL https://raw.githubusercontent.com/iamwaa/Scripting/refs/heads/main/UserScript/element-blocker.user.js
// @match *://*/*
// @run-at document-start
// @grant GM.getValue
// @grant GM.setValue
// @grant GM.registerMenuCommand
// ==/UserScript==

(async () => {
  let isSelecting = false
  let overlay = null
  let exitButton = null
  let confirmBox = null
  let pendingTarget = null
  let blockedItems = await GM.getValue(location.hostname, [])
  let styleElement = null
  let reapplyTimer = null
  let burstTimers = []
  let domObserver = null
  let lastAppliedHref = location.href
  let lastRefreshAt = 0

  function getSelector(item) {
    return typeof item === 'string' ? item : item.selector
  }

  function ensureStyleElement() {
    if (styleElement?.isConnected) return styleElement
    styleElement = document.querySelector('#element-blocker-style')
    if (!styleElement) {
      styleElement = document.createElement('style')
      styleElement.id = 'element-blocker-style'
    }
    const mountTarget = document.head || document.documentElement || document.body
    if (mountTarget && !styleElement.isConnected) {
      mountTarget.appendChild(styleElement)
    }
    return styleElement
  }

  function applyBlockedStyles() {
    const style = ensureStyleElement()
    if (!style) return
    if (!blockedItems.length) {
      style.textContent = ''
      return
    }
    style.textContent = blockedItems
      .map(item => `${getSelector(item)} { display: none !important; }`)
      .join('\n')
  }

  function scheduleReapply(delay = 80) {
    if (reapplyTimer) clearTimeout(reapplyTimer)
    reapplyTimer = setTimeout(() => {
      reapplyTimer = null
      applyBlockedStyles()
    }, delay)
  }

  function scheduleReapplyBurst() {
    burstTimers.forEach(timer => clearTimeout(timer))
    burstTimers = [0, 80, 240, 600, 1200].map(delay => setTimeout(() => {
      applyBlockedStyles()
    }, delay))
  }

  async function refreshBlockedItemsIfNeeded(force = false) {
    const now = Date.now()
    if (!force && lastAppliedHref === location.href) return
    if (force && now - lastRefreshAt < 120) {
      scheduleReapplyBurst()
      return
    }
    lastRefreshAt = now
    lastAppliedHref = location.href
    blockedItems = await GM.getValue(location.hostname, [])
    scheduleReapply()
  }

  function watchPageChanges() {
    if (!domObserver && typeof MutationObserver !== 'undefined') {
      domObserver = new MutationObserver(() => {
        const styleMissing = !styleElement || !styleElement.isConnected
        const rootChanged = !document.documentElement || !document.documentElement.contains(styleElement)
        if (styleMissing || rootChanged || lastAppliedHref !== location.href) {
          refreshBlockedItemsIfNeeded(styleMissing || rootChanged)
          if (styleMissing || rootChanged) scheduleReapplyBurst()
        }
      })
      domObserver.observe(document.documentElement, { childList: true, subtree: true })
    }

    const wrapHistoryMethod = (methodName) => {
      const original = history[methodName]
      if (typeof original !== 'function' || original.__elementBlockerWrapped) return
      const wrapped = function (...args) {
        const result = original.apply(this, args)
        refreshBlockedItemsIfNeeded()
        return result
      }
      wrapped.__elementBlockerWrapped = true
      history[methodName] = wrapped
    }

    wrapHistoryMethod('pushState')
    wrapHistoryMethod('replaceState')
    window.addEventListener('popstate', () => {
      refreshBlockedItemsIfNeeded(true)
      scheduleReapplyBurst()
    }, true)
    window.addEventListener('hashchange', () => {
      refreshBlockedItemsIfNeeded(true)
      scheduleReapplyBurst()
    }, true)
    window.addEventListener('pageshow', () => {
      refreshBlockedItemsIfNeeded(true)
      scheduleReapplyBurst()
    }, true)
    window.addEventListener('pagehide', () => {
      scheduleReapplyBurst()
    }, true)
    window.addEventListener('load', () => {
      refreshBlockedItemsIfNeeded(true)
      scheduleReapplyBurst()
    }, true)
    window.addEventListener('focus', () => {
      refreshBlockedItemsIfNeeded(true)
      scheduleReapplyBurst()
    }, true)
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive' || document.readyState === 'complete') {
        refreshBlockedItemsIfNeeded(true)
        scheduleReapplyBurst()
      }
    }, true)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshBlockedItemsIfNeeded(true)
        scheduleReapplyBurst()
      }
    }, true)
  }

  applyBlockedStyles()
  refreshBlockedItemsIfNeeded(true)
  scheduleReapplyBurst()
  watchPageChanges()

  function createConfirmBox(target) {
    removeConfirmBox()

    const rect = target.getBoundingClientRect()

    // 选中元素的边框高亮
    const borderBox = document.createElement('div')
    borderBox.style.cssText = `
      position: absolute;
      left: ${rect.left + window.scrollX}px;
      top: ${rect.top + window.scrollY}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 3px solid #5B7FFF;
      border-radius: 12px;
      z-index: 2147483651;
      pointer-events: none;
      box-sizing: border-box;
    `

    // 模糊遮罩层
    const blurMask = document.createElement('div')
    blurMask.style.cssText = `
      position: absolute;
      left: ${rect.left + window.scrollX}px;
      top: ${rect.top + window.scrollY}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      background: rgba(255, 255, 255, 0.4);
      border-radius: 12px;
      z-index: 2147483649;
      pointer-events: none;
    `

    confirmBox = document.createElement('div')
    const button = document.createElement('button')
    button.textContent = '隐藏'

    const isSmall = rect.width < 150 || rect.height < 50
    button.style.cssText = `
      padding: ${isSmall ? '6px 16px' : '10px 24px'};
      background: #5B7FFF;
      color: white;
      border: none;
      border-radius: 20px;
      font-size: ${isSmall ? '12px' : '14px'};
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(91, 127, 255, 0.3);
    `

    confirmBox.style.cssText = `
      position: absolute;
      left: ${rect.left + window.scrollX}px;
      top: ${rect.top + window.scrollY}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483650;
      pointer-events: none;
    `

    button.style.pointerEvents = 'auto'
    confirmBox.appendChild(button)

    button.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()

      // 智能选择实际要屏蔽的元素（向上查找有实际高度的容器）
      const blockTarget = findBlockTarget(target)
      const selector = generateSelector(blockTarget)
      const label = getElementLabel(blockTarget)

      removeConfirmBox()
      blurMask.remove()

      document.querySelectorAll(selector).forEach(el => el.style.display = 'none')

      const newItem = { selector, label, time: Date.now() }
      blockedItems.push(newItem)

      // 检测并合并相似选择器
      const mergedItems = detectAndMergeSimilar(blockedItems)

      if (mergedItems.length < blockedItems.length) {
        mergedItems.forEach(item => {
          const sel = typeof item === 'string' ? item : item.selector
          document.querySelectorAll(sel).forEach(el => el.style.display = 'none')
        })
      }

      blockedItems = mergedItems
      await GM.setValue(location.hostname, mergedItems)
      applyBlockedStyles()

      const allData = await GM.getValue('_all_sites', {})
      allData[location.hostname] = mergedItems
      await GM.setValue('_all_sites', allData)

      GM.log('已屏蔽元素:', selector)
      stopSelecting()
    })

    document.body.appendChild(blurMask)
    document.body.appendChild(borderBox)
    document.body.appendChild(confirmBox)

    confirmBox._blurMask = blurMask
    confirmBox._borderBox = borderBox
  }

  function removeConfirmBox() {
    if (confirmBox) {
      if (confirmBox._blurMask) confirmBox._blurMask.remove()
      if (confirmBox._borderBox) confirmBox._borderBox.remove()
      confirmBox.remove()
      confirmBox = null
    }
    pendingTarget = null
  }

  function createExitButton() {
    exitButton = document.createElement('button')
    exitButton.textContent = '✕'
    exitButton.style.cssText = `
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483660;
      padding: 0;
      width: 46px;
      height: 46px;
      background: linear-gradient(135deg, #ff6b6b 0%, #ff5252 100%);
      color: white;
      border: none;
      border-radius: 50%;
      font-size: 32px;
      font-weight: 300;
      line-height: 1;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(255, 82, 82, 0.4);
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    `
    exitButton.onmouseenter = () => {
      exitButton.style.transform = 'translateX(-50%) scale(1.1)'
      exitButton.style.boxShadow = '0 6px 20px rgba(255, 82, 82, 0.5)'
    }
    exitButton.onmouseleave = () => {
      exitButton.style.transform = 'translateX(-50%) scale(1)'
      exitButton.style.boxShadow = '0 4px 16px rgba(255, 82, 82, 0.4)'
    }
    exitButton.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      stopSelecting()
    })
    document.body.appendChild(exitButton)
  }

  function createOverlay() {
    const handleClick = async (e) => {
      const target = document.elementFromPoint(e.clientX, e.clientY)

      if (target === exitButton || target?.closest('button')?.textContent === '隐藏') return

      if (target) {
        e.preventDefault()
        e.stopPropagation()

        removeConfirmBox()
        pendingTarget = target
        createConfirmBox(target)
      }
    }

    document.addEventListener('click', handleClick, true)

    _cleanup.handleClick = handleClick
    overlay = { _cleanup }
  }

  function _cleanup() {
    const { handleClick } = _cleanup
    if (handleClick) document.removeEventListener('click', handleClick, true)
  }

  // 智能选择要屏蔽的元素（向上查找合适的容器）
  function findBlockTarget(el) {
    // 如果点击的是 img/video/iframe 等内容元素，向上查找容器
    if (['IMG', 'VIDEO', 'IFRAME', 'PICTURE', 'SVG'].includes(el.tagName)) {
      let current = el.parentElement
      // 最多向上 3 层，找到有固定高度或明显容器特征的元素
      for (let i = 0; i < 3 && current && current !== document.body; i++) {
        const style = window.getComputedStyle(current)
        const height = parseFloat(style.height)
        
        // 如果父元素有固定高度且明显大于内容，说明是占位容器
        if (height > 50 && (style.minHeight !== 'auto' || style.height !== 'auto')) {
          return current
        }
        
        // 常见广告/图片容器类名
        const className = current.className || ''
        if (/banner|ad|carousel|slide|swiper|item|card|wrapper/.test(className)) {
          return current
        }
        
        current = current.parentElement
      }
    }
    
    return el
  }

  // 生成 CSS 选择器（平衡精准度和稳定性）
  function generateSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`

    // 优先使用类名组合
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).filter(c => c && !/^[\d-]/.test(c))
      if (classes.length > 0) {
        const selector = el.tagName.toLowerCase() + '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.')
        // 如果这个选择器在页面上唯一，直接返回
        if (document.querySelectorAll(selector).length === 1) {
          return selector
        }
        // 否则加上父元素限定
        const parent = el.parentElement
        if (parent) {
          let parentSelector = parent.tagName.toLowerCase()
          if (parent.id) {
            return `#${CSS.escape(parent.id)} > ${selector}`
          }
          if (parent.className && typeof parent.className === 'string') {
            const parentClasses = parent.className.trim().split(/\s+/).filter(c => c && !/^[\d-]/.test(c))
            if (parentClasses.length > 0) {
              parentSelector += '.' + parentClasses[0]
            }
          }
          return `${parentSelector} > ${selector}`
        }
        return selector
      }
    }

    // 没有类名时使用 nth-child
    const parent = el.parentElement
    if (parent) {
      const siblings = Array.from(parent.children)
      const index = siblings.indexOf(el) + 1
      return `${el.tagName.toLowerCase()}:nth-child(${index})`
    }

    return el.tagName.toLowerCase()
  }

  // 提取元素的可读标签
  function getElementLabel(el) {
    const text = el.innerText || el.textContent || ''
    const cleanText = text.trim().replace(/\s+/g, ' ').substring(0, 50)
    if (cleanText) return cleanText

    if (el.alt) return el.alt
    if (el.title) return el.title
    if (el.placeholder) return el.placeholder

    return getSelectorLabel(generateSelector(el))
  }

  // 从选择器提取可读标签
  function getSelectorLabel(selector) {
    if (selector.startsWith('#')) return selector.substring(1)

    const classMatch = selector.match(/\.(\S+)/)
    if (classMatch) return classMatch[1].split('.')[0]

    const nthMatch = selector.match(/(\w+):nth-of-type\((\d+)\)/)
    if (nthMatch) return `${nthMatch[1]} #${nthMatch[2]}`

    return selector
  }

  // 检测并合并相似选择器（3个以上相似规则自动合并）
  function detectAndMergeSimilar(items) {
    const selectorMap = new Map()

    items.forEach(item => {
      const selector = typeof item === 'string' ? item : item.selector
      
      // 提取模式：移除 ID/类名中的数字后缀和 nth-child
      const pattern = selector
        .replace(/#([\w-]+?)[-_](\d+)/g, '#$1-*')  // #id-123 → #id-*
        .replace(/\.([\w-]+?)[-_](\d+)/g, '.$1-*')  // .class-123 → .class-*
        .replace(/:nth-child\(\d+\)/g, ':nth-child(*)')  // nth-child(5) → nth-child(*)

      if (!selectorMap.has(pattern)) selectorMap.set(pattern, [])
      selectorMap.get(pattern).push(item)
    })

    const merged = []
    const toRemove = new Set()

    selectorMap.forEach((matches, pattern) => {
      if (matches.length >= 3) {
        const firstItem = matches[0]
        const baseSelector = typeof firstItem === 'string' ? firstItem : firstItem.selector
        
        // 提取 ID 或类名前缀用于合并选择器
        let mergedSelector = baseSelector
        const idMatch = baseSelector.match(/#([\w-]+?)[-_]\d+/)
        const classMatch = baseSelector.match(/\.([\w-]+?)[-_]\d+/)
        
        if (idMatch) {
          const prefix = idMatch[1]
          mergedSelector = baseSelector.replace(/#[\w-]+?[-_]\d+/, `[id^="${prefix}-"]`)
        } else if (classMatch) {
          const prefix = classMatch[1]
          mergedSelector = baseSelector.replace(/\.([\w-]+?)[-_]\d+/, `[class*="${prefix}-"]`)
        }

        merged.push({
          selector: mergedSelector,
          label: `${matches.length}个相似元素（自动合并）`,
          time: Date.now()
        })

        matches.forEach(item => toRemove.add(item))
      }
    })

    const remaining = items.filter(item => !toRemove.has(item))
    return [...merged, ...remaining]
  }

  function startSelecting() {
    if (isSelecting) return
    isSelecting = true
    createExitButton()
    createOverlay()
  }

  function stopSelecting() {
    if (!isSelecting) return
    isSelecting = false
    removeConfirmBox()
    if (overlay) {
      overlay._cleanup()
      overlay = null
    }
    if (exitButton) {
      exitButton.remove()
      exitButton = null
    }
  }

  // 显示所有站点的屏蔽列表面板
  async function showSiteList() {
    const allData = await GM.getValue('_all_sites', {})

    const panel = document.createElement('div')
    panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 90%;
      max-width: 480px;
      max-height: 75vh;
      background: linear-gradient(to bottom, #ffffff, #f8f9fa);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
      z-index: 2147483648;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    `

    const header = document.createElement('div')
    header.style.cssText = `
      padding: 10px 20px;
      background: #e9ecef;
      border-bottom: 1px solid #dee2e6;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `
    header.innerHTML = `<h3 style="margin:0;font-size:16px;color:#2c3e50;font-weight:600;">屏蔽列表</h3>`

    const closeBtn = document.createElement('button')
    closeBtn.textContent = '✕'
    closeBtn.style.cssText = `
      background: none;
      border: none;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      font-size: 18px;
      cursor: pointer;
      color: #6c757d;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s, color 0.2s;
    `
    closeBtn.onmouseenter = () => {
      closeBtn.style.background = '#e9ecef'
      closeBtn.style.color = '#2c3e50'
    }
    closeBtn.onmouseleave = () => {
      closeBtn.style.background = 'none'
      closeBtn.style.color = '#6c757d'
    }
    closeBtn.addEventListener('click', () => panel.remove())
    header.appendChild(closeBtn)

    const content = document.createElement('div')
    content.style.cssText = `
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    `

    const sites = Object.keys(allData)
    if (sites.length === 0) {
      content.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#999;font-size:15px;">暂无屏蔽记录</div>'
    } else {
      sites.forEach(site => {
        const siteItem = document.createElement('div')
        siteItem.style.cssText = `
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          margin-bottom: 12px;
          background: white;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        `
        siteItem.onmouseenter = () => {
          siteItem.style.transform = 'translateY(-2px)'
          siteItem.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'
        }
        siteItem.onmouseleave = () => {
          siteItem.style.transform = 'translateY(0)'
          siteItem.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'
        }

        const siteInfo = document.createElement('div')
        siteInfo.style.cssText = 'flex: 1;'
        siteInfo.innerHTML = `
          <div style="font-weight:600;font-size:15px;margin-bottom:4px;color:#2c3e50;">${site}</div>
          <div style="font-size:13px;color:#95a5a6;">${allData[site].length} 条规则</div>
        `

        const deleteBtn = document.createElement('button')
        deleteBtn.textContent = '删除'
        deleteBtn.style.cssText = `
          padding: 8px 16px;
          background: linear-gradient(135deg, #ff6b6b, #ff5252);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: transform 0.2s;
        `
        deleteBtn.onmouseenter = () => deleteBtn.style.transform = 'scale(1.05)'
        deleteBtn.onmouseleave = () => deleteBtn.style.transform = 'scale(1)'
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation()
          delete allData[site]
          await GM.setValue('_all_sites', allData)
          if (site === location.hostname) {
            await GM.setValue(location.hostname, [])
            location.reload()
          } else {
            siteItem.remove()
          }
        })

        siteItem.appendChild(siteInfo)
        siteItem.appendChild(deleteBtn)

        siteItem.addEventListener('click', (e) => {
          if (e.target !== deleteBtn) {
            panel.remove()
            showSiteDetail(site, allData[site])
          }
        })

        content.appendChild(siteItem)
      })
    }

    panel.appendChild(header)
    panel.appendChild(content)
    document.body.appendChild(panel)
  }

  // 显示单个站点的屏蔽规则详情
  async function showSiteDetail(site, items) {
    let needRefresh = false

    // 按时间倒序排列
    const sortedItems = [...items].sort((a, b) => {
      const timeA = (typeof a === 'string' ? 0 : a.time) || 0
      const timeB = (typeof b === 'string' ? 0 : b.time) || 0
      return timeB - timeA
    })

    const panel = document.createElement('div')
    panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 90%;
      max-width: 480px;
      max-height: 75vh;
      background: linear-gradient(to bottom, #ffffff, #f8f9fa);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
      z-index: 2147483648;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    `

    const header = document.createElement('div')
    header.style.cssText = `
      padding: 14px 20px;
      background: #e9ecef;
      border-bottom: 1px solid #dee2e6;
      display: flex;
      align-items: center;
      gap: 12px;
    `

    const backBtn = document.createElement('button')
    backBtn.textContent = '←'
    backBtn.style.cssText = `
      background: none;
      border: none;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      font-size: 18px;
      cursor: pointer;
      color: #6c757d;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s, color 0.2s;
    `
    backBtn.onmouseenter = () => {
      backBtn.style.background = '#e9ecef'
      backBtn.style.color = '#2c3e50'
    }
    backBtn.onmouseleave = () => {
      backBtn.style.background = 'none'
      backBtn.style.color = '#6c757d'
    }
    backBtn.addEventListener('click', () => {
      panel.remove()
      showSiteList()
    })

    const title = document.createElement('h3')
    title.style.cssText = 'margin:0;font-size:16px;flex:1;color:#2c3e50;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
    title.textContent = site

    const closeBtn = document.createElement('button')
    closeBtn.textContent = '✕'
    closeBtn.style.cssText = `
      background: none;
      border: none;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      font-size: 18px;
      cursor: pointer;
      color: #6c757d;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s, color 0.2s;
    `
    closeBtn.onmouseenter = () => {
      closeBtn.style.background = '#e9ecef'
      closeBtn.style.color = '#2c3e50'
    }
    closeBtn.onmouseleave = () => {
      closeBtn.style.background = 'none'
      closeBtn.style.color = '#6c757d'
    }
    closeBtn.addEventListener('click', () => {
      panel.remove()
      if (needRefresh && site === location.hostname) location.reload()
    })

    header.appendChild(backBtn)
    header.appendChild(title)
    header.appendChild(closeBtn)

    const content = document.createElement('div')
    content.style.cssText = `
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    `

    sortedItems.forEach((dataItem) => {
      const selector = typeof dataItem === 'string' ? dataItem : dataItem.selector
      const label = typeof dataItem === 'string' ? getSelectorLabel(dataItem) : (dataItem.label || getSelectorLabel(dataItem.selector))
      const time = (typeof dataItem === 'string' ? null : dataItem.time) || null

      const item = document.createElement('div')
      item.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 14px 16px;
        margin-bottom: 10px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.06);
        transition: all 0.2s;
        position: relative;
      `
      item.onmouseenter = () => {
        item.style.transform = 'translateX(4px)'
        item.style.boxShadow = '0 3px 10px rgba(0,0,0,0.1)'
      }
      item.onmouseleave = () => {
        item.style.transform = 'translateX(0)'
        item.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)'
      }

      const selectorText = document.createElement('div')
      selectorText.style.cssText = 'flex: 1; padding-right: 35px; min-width: 0; max-width: calc(100% - 35px);'
      selectorText.innerHTML = `
        <div style="font-weight:600;font-size:14px;color:#2c3e50;margin-bottom:4px;overflow-wrap:break-word;word-break:break-word;">${label}</div>
        <div style="font-size:12px;color:#95a5a6;word-break:break-all;line-height:1.4;">${selector}</div>
      `

      const timeLabel = document.createElement('div')
      timeLabel.style.cssText = `
        position: absolute;
        top: 10px;
        right: 13px;
        font-size: 11px;
        color: #aaa;
        white-space: nowrap;
      `
      if (time) {
        const timeStr = new Date(time).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
        timeLabel.textContent = timeStr
      }

      const deleteBtn = document.createElement('button')
      deleteBtn.textContent = '删除'
      deleteBtn.style.cssText = `
        position: absolute;
        bottom: 14px;
        right: 16px;
        padding: 6px 14px;
        background: linear-gradient(135deg, #ff6b6b, #ff5252);
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: transform 0.2s;
      `
      deleteBtn.onmouseenter = () => deleteBtn.style.transform = 'scale(1.05)'
      deleteBtn.onmouseleave = () => deleteBtn.style.transform = 'scale(1)'
      deleteBtn.addEventListener('click', async () => {
        // 在原始数组中找到对应项并删除
        const realIndex = items.indexOf(dataItem)
        if (realIndex !== -1) items.splice(realIndex, 1)
        const allData = await GM.getValue('_all_sites', {})
        if (items.length === 0) {
          delete allData[site]
        } else {
          allData[site] = items
        }
        await GM.setValue('_all_sites', allData)

        if (site === location.hostname) {
          await GM.setValue(location.hostname, items)
          needRefresh = true
        }

        item.remove()

        if (site === location.hostname && items.length === 0) {
          panel.remove()
          location.reload()
        }
      })

      item.appendChild(selectorText)
      if (time) item.appendChild(timeLabel)
      item.appendChild(deleteBtn)
      content.appendChild(item)
    })

    panel.appendChild(header)
    panel.appendChild(content)
    document.body.appendChild(panel)
  }

  // 注册菜单命令
  GM.registerMenuCommand('🚫 选择要屏蔽的元素', startSelecting)
  GM.registerMenuCommand('📋 查看屏蔽列表', showSiteList)
  GM.registerMenuCommand('🔄 清除当前站点的屏蔽', async () => {
    const allData = await GM.getValue('_all_sites', {})
    delete allData[location.hostname]
    await GM.setValue('_all_sites', allData)
    await GM.setValue(location.hostname, [])
    location.reload()
  })
})()
