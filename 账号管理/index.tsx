import { useState, useEffect, useObservable, TabView, Tab, Navigation, Script } from "scripting"

import { AccountItem, BookmarkItem, WebDAVConfig, GroupItem, loadAccounts, loadBookmarks, loadAccountGroups, loadBookmarkGroups, loadWebDAVConfig, loadLaunchBiometricsEnabled, saveAccounts, saveBookmarks, saveAccountGroups, saveBookmarkGroups, migrateOldGroups } from "./utils"

import { ApiListPage, BookmarkListPage, SearchPage, SettingsPage } from "./pages"

const App = ({ initialLaunchBiometricsEnabled }: { initialLaunchBiometricsEnabled: boolean }) => {
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([])
  const [accountGroups, setAccountGroups] = useState<GroupItem[]>([])
  const [bookmarkGroups, setBookmarkGroups] = useState<GroupItem[]>([])
  const [webdavConfig, setWebdavConfig] = useState<WebDAVConfig | null>(null)
  const [launchBiometricsEnabled, setLaunchBiometricsEnabled] = useState(initialLaunchBiometricsEnabled)
  const [loaded, setLoaded] = useState<boolean>(false)

  const selection = useObservable<string>("api")
  const [selectionModeTab, setSelectionModeTab] = useState<"api" | "bookmark" | null>(null)

  useEffect(() => {
    migrateOldGroups().then(() =>
      Promise.all([loadAccounts(), loadBookmarks(), loadAccountGroups(), loadBookmarkGroups(), loadWebDAVConfig()])
    ).then(([acc, bk, ag, bg, wdc]) => {
      setAccounts(acc)
      setBookmarks(bk)
      setAccountGroups(ag)
      setBookmarkGroups(bg)
      setWebdavConfig(wdc)
      setLoaded(true)
    }).catch(console.error)
  }, [])

  useEffect(() => {
    if (loaded) saveAccounts(accounts).catch(console.error)
  }, [accounts, loaded])

  useEffect(() => {
    if (loaded) saveBookmarks(bookmarks).catch(console.error)
  }, [bookmarks, loaded])

  useEffect(() => {
    if (loaded) saveAccountGroups(accountGroups).catch(console.error)
  }, [accountGroups, loaded])

  useEffect(() => {
    if (loaded) saveBookmarkGroups(bookmarkGroups).catch(console.error)
  }, [bookmarkGroups, loaded])

  if (selectionModeTab === "api") return <ApiListPage accounts={accounts} setAccounts={setAccounts} groups={accountGroups} setGroups={setAccountGroups} isSelecting={true} setIsSelecting={(value: boolean) => setSelectionModeTab(value ? "api" : null)} />
  if (selectionModeTab === "bookmark") return <BookmarkListPage bookmarks={bookmarks} setBookmarks={setBookmarks} groups={bookmarkGroups} setGroups={setBookmarkGroups} isSelecting={true} setIsSelecting={(value: boolean) => setSelectionModeTab(value ? "bookmark" : null)} />

  return (
    <TabView selection={selection} tabViewSearchActivation="searchTabSelection">
      <Tab title="账号管理" systemImage="person.fill" value="api">
        <ApiListPage accounts={accounts} setAccounts={setAccounts} groups={accountGroups} setGroups={setAccountGroups} isSelecting={false} setIsSelecting={(value: boolean) => setSelectionModeTab(value ? "api" : null)} />
      </Tab>
      <Tab title="书签管理" systemImage="bookmark.fill" value="bookmark">
        <BookmarkListPage bookmarks={bookmarks} setBookmarks={setBookmarks} groups={bookmarkGroups} setGroups={setBookmarkGroups} isSelecting={false} setIsSelecting={(value: boolean) => setSelectionModeTab(value ? "bookmark" : null)} />
      </Tab>
      <Tab title="搜索" systemImage="magnifyingglass" value="search" role="search">
        <SearchPage accounts={accounts} setAccounts={setAccounts} bookmarks={bookmarks} setBookmarks={setBookmarks} accountGroups={accountGroups} bookmarkGroups={bookmarkGroups} />
      </Tab>
      <Tab title="设置" systemImage="gearshape.fill" value="settings">
        <SettingsPage accounts={accounts} setAccounts={setAccounts} bookmarks={bookmarks} setBookmarks={setBookmarks} webdavConfig={webdavConfig} setWebdavConfig={setWebdavConfig} launchBiometricsEnabled={launchBiometricsEnabled} setLaunchBiometricsEnabled={setLaunchBiometricsEnabled} />
      </Tab>
    </TabView>
  )
}

const run = async () => {
  const launchBiometricsEnabled = await loadLaunchBiometricsEnabled()
  if (launchBiometricsEnabled) {
    try {
      if (!LocalAuth.isBiometricsAvailable || LocalAuth.biometryType !== "faceID") {
        Script.exit()
        return
      }

      const authenticated = await LocalAuth.authenticate("验证身份以访问账号管理", true)
      if (!authenticated) {
        Script.exit()
        return
      }
    } catch {
      Script.exit()
      return
    }
  }

  await Navigation.present({ element: <App initialLaunchBiometricsEnabled={launchBiometricsEnabled} />, modalPresentationStyle: "fullScreen" })
  Script.exit()
}

run()
