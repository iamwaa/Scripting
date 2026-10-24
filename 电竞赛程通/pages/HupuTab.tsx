import { NavigationStack, List, Section, Text, VStack, Image, Button, Picker, Toggle, ProgressView, Toolbar, ToolbarItem, useState, useEffect } from "scripting"
import type { VirtualNode } from "scripting"
import type { HupuMatch } from "../hupuTypes"
import { HUPU_GAMES, fetchHupuMatches } from "../api/hupu"
import { groupHupuMatchesByDay } from "../utils/hupuGroup"
import { HupuMatchRow } from "../components/HupuMatchRow"

const GAME_STORAGE_KEY = "hupu_selected_game"
const ONLY_RATED_STORAGE_KEY = "hupu_only_rated"

interface HupuTabProps {
  tabItem: VirtualNode
  tag: number
  onClose: () => void
}

// 虎扑评分 Tab:赛事切换 + 按日分组的比赛列表,点击进评分榜
// 与其他 Tab 一致,自带 NavigationStack 作为导航根,子页复用这个栈
export function HupuTab({ onClose }: HupuTabProps) {
  const [gameId, setGameId] = useState<string>(
    Storage.get<string>(GAME_STORAGE_KEY) ?? HUPU_GAMES[0].id,
  )
  const [onlyRated, setOnlyRated] = useState<boolean>(
    Storage.get<boolean>(ONLY_RATED_STORAGE_KEY) ?? true,
  )
  const [matches, setMatches] = useState<HupuMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (targetGameId: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchHupuMatches(targetGameId)
      setMatches(result.matches)
    } catch (e) {
      setError(`获取赛程失败: ${String(e)}`)
      setMatches([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(gameId)
  }, [gameId])

  const handleGameChange = (next: string) => {
    setGameId(next)
    Storage.set(GAME_STORAGE_KEY, next)
  }

  const handleOnlyRatedChange = (next: boolean) => {
    setOnlyRated(next)
    Storage.set(ONLY_RATED_STORAGE_KEY, next)
  }

  // 虎扑大部分场次并不开放评分,默认只看有评分的
  const visible = onlyRated ? matches.filter((match) => match.rating) : matches
  const groups = groupHupuMatchesByDay(visible)

  return (
    <NavigationStack>
      <List
        navigationTitle="虎扑评分"
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button action={onClose}>
                <Image systemName="xmark" fontWeight="semibold" foregroundStyle="red" />
              </Button>
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              {loading ? (
                <ProgressView />
              ) : (
                <Button action={() => load(gameId)}>
                  <Image systemName="arrow.clockwise" fontWeight="semibold" />
                </Button>
              )}
            </ToolbarItem>
          </Toolbar>
        }
      >
        <Section>
          <Picker title="赛事" value={gameId} onChanged={handleGameChange}>
            {HUPU_GAMES.map((game) => (
              <Text key={game.id} tag={game.id}>
                {game.label}
              </Text>
            ))}
          </Picker>
          <Toggle title="仅显示有评分的比赛" value={onlyRated} onChanged={handleOnlyRatedChange} />
        </Section>

        {error ? (
          <Section>
            <VStack alignment="leading" spacing={8}>
              <Text foregroundStyle="red" font={14}>
                {error}
              </Text>
              <Button title="重试" action={() => load(gameId)} />
            </VStack>
          </Section>
        ) : null}

        {groups.map((group) => (
          <Section key={group.key} title={`${group.label} (${group.items.length})`}>
            {group.items.map((match) => (
              <HupuMatchRow key={match.matchId} match={match} />
            ))}
          </Section>
        ))}

        {!loading && !error && visible.length === 0 ? (
          <Section>
            <VStack
              alignment="center"
              spacing={10}
              frame={{ minHeight: 140, maxWidth: "infinity", alignment: "center" }}
            >
              <Image
                systemName="chart.bar.doc.horizontal"
                resizable
                scaleToFit
                frame={{ width: 36, height: 36 }}
                foregroundStyle="secondaryLabel"
              />
              <Text font={14} foregroundStyle="secondaryLabel" multilineTextAlignment="center">
                {onlyRated ? "该项目近期没有开放评分，试试关闭「仅显示有评分的比赛」" : "暂无赛程数据"}
              </Text>
            </VStack>
          </Section>
        ) : null}
      </List>
    </NavigationStack>
  )
}
