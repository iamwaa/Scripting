import { useState, useEffect, useObservable, TabView, Tab, Navigation, Script } from "scripting"

import { AccountItem, BookmarkItem, WebDAVConfig, loadAccounts, loadBookmarks, loadWebDAVConfig, saveAccounts, saveBookmarks, syncAccountsToICloud, getICloudFilePassword, ICLOUD_SYNC_ENABLED_KEY, getCurrentICloudConfig } from "./utils"

import { ApiListPage, BookmarkListPage, SearchPage, SettingsPage } from "./pages"

const App = () => {
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([])
  const [webdavConfig, setWebdavConfig] = useState<WebDAVConfig | null>(null)
  
  const selection = useObservable<string>("api")
  const [selectionModeTab, setSelectionModeTab] = useState<"api" | "bookmark" | null>(null)

  useEffect(() => { 
    setAccounts(loadAccounts()); 
    setBookmarks(loadBookmarks()); 
    setWebdavConfig(loadWebDAVConfig()) 
  }, [])

  useEffect(() => {
    saveAccounts(accounts)
    if (Storage.get(ICLOUD_SYNC_ENABLED_KEY) === true) {
      const currentConfig = getCurrentICloudConfig()
      const savedPwd = getICloudFilePassword(currentConfig.id)
      if (savedPwd) syncAccountsToICloud({ accounts, bookmarks }, savedPwd, currentConfig).catch(e => console.error("iCloud 同步失败", e))
    }
  }, [accounts])

  useEffect(() => { saveBookmarks(bookmarks) }, [bookmarks])

  if (selectionModeTab === "api") return <ApiListPage accounts={accounts} setAccounts={setAccounts} isSelecting={true} setIsSelecting={(value: boolean) => setSelectionModeTab(value ? "api" : null)} />
  if (selectionModeTab === "bookmark") return <BookmarkListPage bookmarks={bookmarks} setBookmarks={setBookmarks} isSelecting={true} setIsSelecting={(value: boolean) => setSelectionModeTab(value ? "bookmark" : null)} />

  return (
    <TabView selection={selection} tabViewSearchActivation="searchTabSelection">
      <Tab title="账号管理" systemImage="person.fill" value="api">
        <ApiListPage accounts={accounts} setAccounts={setAccounts} isSelecting={false} setIsSelecting={(value: boolean) => setSelectionModeTab(value ? "api" : null)} />
      </Tab>
      <Tab title="书签管理" systemImage="bookmark.fill" value="bookmark">
        <BookmarkListPage bookmarks={bookmarks} setBookmarks={setBookmarks} isSelecting={false} setIsSelecting={(value: boolean) => setSelectionModeTab(value ? "bookmark" : null)} />
      </Tab>
      <Tab title="搜索" systemImage="magnifyingglass" value="search" role="search">
        <SearchPage accounts={accounts} setAccounts={setAccounts} bookmarks={bookmarks} setBookmarks={setBookmarks} />
      </Tab>
      <Tab title="设置" systemImage="gearshape.fill" value="settings">
        <SettingsPage accounts={accounts} setAccounts={setAccounts} bookmarks={bookmarks} setBookmarks={setBookmarks} webdavConfig={webdavConfig} setWebdavConfig={setWebdavConfig} />
      </Tab>
    </TabView>
  )
}

const run = async () => {
  await Navigation.present({ element: <App />, modalPresentationStyle: "fullScreen" }) 
  Script.exit()
}

run()
