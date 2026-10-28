#!/usr/bin/env bash
# ============================================================================
# 服务器更新助手：检查/升级 magpie（容器镜像）与 cf-probe（探针二进制）
#
# 用法：
#   sg-update check           只检查，输出一行 JSON（供手机 / systemd 使用）
#   sg-update magpie [版本]   升级 magpie 到最新（或指定版本），成功后自动健康检查
#   sg-update probe  [版本]   升级 cf-probe 到最新（或指定版本）
#   sg-update rollback        回滚 magpie 到最近一次备份的版本
#   sg-update timeout N       空窗期小时数（0=关闭；timer 会从状态文件读取）
#   sg-update set KEY VALUE   改设置（auto_enabled / auto_every / defer_hours / tg_bot / tg_chat / tg_token）
#   sg-update show            输出配置 JSON（不回显密钥，供手机端回填表单）
#   sg-update notify 文本      发一条通知（有 Telegram 配置时）
#   sg-update log [行数]       查看日志
#   sg-update state           输出状态 JSON
#
# 可选环境变量：
#   SG_AUTO=1                 检查到新版本时直接自动升级（timer 里会设置）
#   SG_QUIET=1                精简输出（timer 使用）
#   SG_FORCE=1                即使处于空窗期也执行升级
#
# 退出码：0 正常 / 10 有可用更新（仅 check）/ 20 升级失败 / 30 运行中（锁）
# ============================================================================
set -uo pipefail

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

MAGPIE_REPO=ghcr.io/yetone/magpie
# GHCR 上有两套互不相干的镜像：桌面版（0.1.1364 这种四位版本）和很早的 Go 版（0.1.701）。
# 只认 >= 这个下限的版本，避免误把 Go 版当新版。
MAGPIE_MIN_MINOR=1000
MAGPIE_DIR="${SG_MAGPIE_DIR:-/opt/magpie}"
# 仅用于状态展示；更新连接按 Pong 节点配置选择，不按别名匹配
SELF_ALIASES="${SG_ALIASES:-}"
COMPOSE_FILE=$MAGPIE_DIR/compose.yaml
ACCESS_FILE=$MAGPIE_DIR/access.md
CONF="${SG_PROBE_CONFIG:-/etc/config/cf-probe/config.conf}"
STATE_DIR=/var/lib/sg-update
STATE_FILE=$STATE_DIR/state.json
LOG_FILE=/var/log/sg-update.log
LOCK_FILE=/var/lib/sg-update/.lock
DEFAULT_GATEWAY="${SG_GATEWAY:-}"
MIN_FREE_MB=512
HOST_NAME=$(hostname -s 2>/dev/null || hostname)
# 密钥不写进普通 JSON 状态；单独存在 600 权限文件里
tg_token() { sed -n '1p' "$STATE_DIR/tg_token" 2>/dev/null || true; }

mkdir -p "$STATE_DIR" /root/backups

# ---------- 通用工具 ---------------------------------------------------------

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >>"$LOG_FILE"; }
say() { [ "${SG_QUIET:-0}" = "1" ] || printf '%s\n' "$*"; }
warn() { printf '[%s] WARN %s\n' "$(date '+%F %T')" "$*" >>"$LOG_FILE"; say "⚠️ $*"; }
die() {
	printf '[%s] ERROR %s\n' "$(date '+%F %T')" "$*" >>"$LOG_FILE"
	say "❌ $*"
	exit 20
}

# 版本号比较：输出版本较大者
vmax() { printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1; }
# 版本号比较：$1 > $2 返回 0
vgt() { [ "$(vmax "$1" "$2")" = "$1" ] && [ "$1" != "$2" ]; }

# 读取 JSON 字符串字段（不依赖 jq）
jget() {
	if [ -f "$1" ]; then
		python3 - "$1" "$2" <<'PY' 2>/dev/null
import json, sys
try:
    v = json.load(open(sys.argv[1])).get(sys.argv[2], '')
    print('' if v is None else v)
except Exception:
    print('')
PY
	fi
}

# 写状态文件，参数为 key=value 若干
state_set() {
	python3 - "$STATE_FILE" "$@" <<'PY'
import json, sys, datetime, os
path, pairs = sys.argv[1], sys.argv[2:]
d = {}
if os.path.exists(path):
    try:
        d = json.load(open(path))
    except Exception:
        d = {}
# 只有这些 key 是真正的数字；其余一律字符串。
# 不能按「值全为数字就转 int」判——tg_chat 是标识符，纯数字也很常见
#（如 6150484032），被转成数字后手机端 .trim() 会抛错。
NUMERIC = {"auto_enabled", "auto_every", "defer_hours"}
for kv in pairs:
    k, v = kv.split('=', 1)
    v = v.strip().replace('\n', ' ')
    if k in NUMERIC and v.lstrip('-').isdigit():
        d[k] = int(v)
    else:
        d[k] = v
d.setdefault('gateway', '')
d['updated_at'] = datetime.datetime.now().astimezone().strftime('%Y-%m-%d %H:%M:%S')
tmp = path + '.tmp'
json.dump(d, open(tmp, 'w'), ensure_ascii=False, indent=1)
os.replace(tmp, path)
PY
}

state_get() { jget "$STATE_FILE" "$1"; }

# 获取互斥锁，避免 timer 与手动操作并发
acquire_lock() {
	exec 9>"$LOCK_FILE"
	if ! flock -n 9; then
		echo "⏳ 已有更新任务在运行，请稍后再试"
		exit 30
	fi
}

# 检查空窗期（默认 0 点后 6 小时内不自动升级，白天随时升）
defer_active() {
	local hours now
	hours=$(state_get defer_hours)
	[ -z "$hours" ] && hours=6
	[ "$hours" = "0" ] && return 1
	[ "${SG_FORCE:-0}" = "1" ] && return 1
	now=$(date +%H)
	[ $((10#$now)) -lt $((10#$hours)) ]
}

defer_until_str() {
	local hours
	hours=$(state_get defer_hours)
	printf '%s:00' "${hours:-6}"
}

# 自动更新是否开启（默认开，保持原有行为）
auto_enabled() { [ "$(state_get auto_enabled)" != "0" ]; }

# 自动更新频率：1 / 3 / 6 / 12 / 24 小时，默认 24
auto_every() {
	local h
	h=$(state_get auto_every)
	case "$h" in 1 | 3 | 6 | 12 | 24) echo "$h" ;; *) echo 24 ;; esac
}

# 距上次自动检查是否已满一个周期（到点才检查，避免 timer 每几分钟风控 GHCR）
# 用 auto_check_at 而不是 last_check：后者任何一次手动 check 都会刷新，
# 会把手动查看误当成「刚查过」而延后自动升级。
due_now() {
	local every last now last_s
	every=$(auto_every)
	last=$(state_get auto_check_at)
	[ -z "$last" ] && return 0
	last_s=$(date -d "$last" +%s 2>/dev/null) || return 0
	now=$(date +%s)
	[ $((now - last_s)) -ge $((every * 3600)) ]
}

# 推送通知：配了 Telegram 就发消息（根据返回体判成败），否则只写日志
# 返回值：0 已送达 / 1 发送失败 / 2 未配置 Telegram
notify() {
	local msg=$1 tok chat resp
	log "NOTIFY $msg"
	tok=$(tg_token)
	chat=$(state_get tg_chat)
	if [ -z "$tok" ] || [ -z "$chat" ]; then
		log "NOTIFY skip: 未配置 tg_token/tg_chat"
		return 2
	fi
	resp=$(curl -s --max-time 15 \
		--data-urlencode "text=【$HOST_NAME】$msg" \
		"https://api.telegram.org/bot$tok/sendMessage?chat_id=$chat" 2>&1)
	if printf '%s' "$resp" | grep -q '"ok":true'; then
		return 0
	fi
	log "NOTIFY fail: ${resp:-无响应}"
	return 1
}

# ---------- magpie ------------------------------------------------------------

magpie_image() { grep -m1 -oE 'image: *\S+' "$COMPOSE_FILE" | awk '{print $2}'; }
magpie_repo() { printf '%s' "$1" | sed 's/@.*//; s/:[0-9][0-9.]*$//'; }
magpie_digest_ref() { printf '%s' "$1" | sed -n 's/.*@\(sha256:[0-9a-f]*\).*/\1/p'; }
magpie_tag_ref() { printf '%s' "$1" | sed -n 's/.*:\([0-9][0-9.]*\)$/\1/p'; }

containers() { docker ps -a --filter "label=com.docker.compose.project=$1" -q 2>/dev/null; }

# 由镜像引用取摘要（支持 tag 形式，向 registry 查清单摘要）
magpie_ref_digest() {
	local ref=$1 tag d
	d=$(magpie_digest_ref "$ref")
	if [ -z "$d" ]; then
		tag=$(magpie_tag_ref "$ref")
		[ -n "$tag" ] && d=$(ghcr_manifest_digest yetone/magpie "$tag")
	fi
	[ -n "$d" ] || return 1
	printf 'ghcr.io/yetone/magpie@%s' "$d"
}
# 镜像实际版本号（跑一次 version 子命令）
magpie_image_version() {
	local ref=$1 v
	v=$(timeout 60 docker run --rm --entrypoint /magpie "$ref" version 2>/dev/null | grep -oE 'v?[0-9]+\.[0-9]+\.[0-9]+' | head -1)
	printf '%s' "${v#v}"
}

# 容器健康：healthy / running 都算通过
magpie_healthy() {
	local id st n=0
	ids=$(containers magpie)
	[ -z "$ids" ] && return 1
	for id in $ids; do
		while [ $n -lt 18 ]; do
			st=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null)
			case "$st" in
			"running healthy" | "running " ) return 0 ;;
			esac
			sleep 2
			n=$((n + 1))
		done
	done
	return 1
}

# 用 web 密钥打本地管理端，确认服务真的能响应
magpie_http_ok() {
	local key code
	[ -f "$MAGPIE_DIR/.env" ] || return 0
	key=$(sed -n 's/^MAGPIE_WEB_KEY=//p' "$MAGPIE_DIR/.env" | tr -d '"'"'"'')
	[ -z "$key" ] && return 0
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -b "$STATE_DIR/.cookie" "http://127.0.0.1:3430/?k=$key" 2>/dev/null)
	if [ "$code" = "000" ]; then warn "本地 3430 无响应"; return 1; fi
	return 0
}

gateway_url() {
	local u=$DEFAULT_GATEWAY
	[ -f "$ACCESS_FILE" ] && u=$(grep -oE 'https://[^ ]+:8443' "$ACCESS_FILE" | head -1)
	[ -z "$u" ] && u=$DEFAULT_GATEWAY
	printf '%s' "$u"
}

magpie_public_ok() {
	local url code
	url=$(gateway_url)
	[ -z "$url" ] && return 0
	code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 12 "${url%/}/" 2>/dev/null)
	case "$code" in
	2* | 3* | 401) return 0 ;;
	esac
	warn "公网入口 ${url} 返回 ${code:-无响应}"
	return 1
}

ghcr_token() {
	curl -s --max-time 15 "https://ghcr.io/token?scope=repository:$1:pull&service=ghcr.io" |
		sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

# 当前平台对应的镜像清单摘要（amd64/arm64 通用）
ghcr_manifest_digest() {
	local repo=$1 tag=$2 tok
	tok=$(ghcr_token "$repo")
	[ -z "$tok" ] && return 1
	curl -s --max-time 20 -H "Authorization: Bearer $tok" \
		-H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json' \
		-D /tmp/.sg-ghcr-h -o /dev/null "https://ghcr.io/v2/$repo/manifests/$tag" 2>/dev/null
	tr -d '\r' </tmp/.sg-ghcr-h | sed -n 's/^docker-content-digest: *//Ip' | head -1
}

# 某次升级的健康回滚点：记录旧镜像与旧 compose
magpie_backup() {
	local stamp old_ref id
	stamp=$(date +%Y%m%d_%H%M%S)
	old_ref=$1
	cp -a "$COMPOSE_FILE" "/root/backups/magpie-compose-$stamp.yaml" || return 1
	state_set rollback_compose="/root/backups/magpie-compose-$stamp.yaml" \
		rollback_image="$old_ref" rollback_version="$(magpie_image_version "$old_ref")" \
		rollback_at="$(date '+%F %T')"
	# 只保留最近 10 份 compose 备份
	ls -1t /root/backups/magpie-compose-*.yaml 2>/dev/null | tail -n +11 | xargs -r rm -f
	# 清理所有未被引用的旧 magpie 镜像（当前镜像上次成功后在检查时会记录）
	for id in $(docker images -q --filter "reference=$(magpie_repo "$old_ref")" 2>/dev/null); do
		if [ "$(docker inspect --format '{{index .RepoDigests 0}}' "$id" 2>/dev/null | sed 's/.*@//')" != "$(magpie_digest_ref "$old_ref")" ]; then
			docker rmi "$id" >/dev/null 2>&1
		fi
	done
}

# 用指定镜像引用重建容器
magpie_apply() {
	local ref=$1 d
	d=$(magpie_ref_digest "$ref") || die "无效的镜像引用: $ref"
	d=${d#ghcr.io/yetone/magpie@}
	sed -i -E "s|image: *ghcr.io/yetone/magpie@sha256:[0-9a-f]+|image: ghcr.io/yetone/magpie@$d|" "$COMPOSE_FILE"
	grep -q "magpie@$d" "$COMPOSE_FILE" || die "compose 文件写入失败"
	(cd "$MAGPIE_DIR" && docker compose up -d --remove-orphans) >>"$LOG_FILE" 2>&1 || return 1
	magpie_healthy && magpie_http_ok && magpie_public_ok
}

# 账号/模型概况：读 magpie 管理端的 /api/state（需要 web 密钥换 cookie）
magpie_usage() {
	local key jar code
	[ -f "$MAGPIE_DIR/.env" ] || return 0
	key=$(sed -n 's/^MAGPIE_WEB_KEY=//p' "$MAGPIE_DIR/.env" | tr -d '"')
	[ -z "$key" ] && return 0
	jar=/tmp/.sg-ck
	curl -s --max-time 8 -c "$jar" -o /dev/null "http://127.0.0.1:3430/?k=$key" 2>/dev/null
	curl -s --max-time 10 -b "$jar" http://127.0.0.1:3430/api/state -o /tmp/.sg-state.json 2>/dev/null
	python3 - /tmp/.sg-state.json <<'PY' 2>/dev/null
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
sg = d.get('settings') or {}
def n(x):
    return len(x) if isinstance(x, (list, dict)) else 0
print('\t'.join([
    'accounts=%d' % n(d.get('agents') or d.get('accounts')),
    'profiles=%d' % n(d.get('profiles')),
    'served=%s' % (d.get('served', '')),
    'updateEvery=%s' % (sg.get('updateEvery', '')),
    'chinaMirror=%s' % (sg.get('chinaMirror', '')),
]))
PY
}

cmd_magpie() {
	local want=${1:-} cur_ref cur_ver target_tag= target_ref check_only=${SG_CHECK_ONLY:-0}
	[ -f "$COMPOSE_FILE" ] || die "找不到 $COMPOSE_FILE，magpie 未安装"
	cur_ref=$(magpie_image)
	[ -z "$cur_ref" ] && die "compose 中没有 image 行"
	cur_ver=$(magpie_image_version "$cur_ref")
	[ -z "$cur_ver" ] && cur_ver=$(state_get magpie_version)

	if [ -z "$want" ]; then
		target_tag=$(check_magpie_tag)
		[ -z "$target_tag" ] && die "无法获取 magpie 最新版本（GHCR 或 GitHub 均不可达）"
		if [ -n "$cur_ver" ] && ! vgt "$target_tag" "$cur_ver"; then
			say "✅ magpie 已是最新（v$cur_ver）"
			state_set magpie_version="$cur_ver"
			return 0
		fi
		say "⬆️ magpie v${cur_ver:-?} → v$target_tag"
	else
		target_tag=$want
	fi
	# 只检查不动手：拿到目标 tag 后直接返回，让 cmd_check 去升级
	[ "$check_only" = "1" ] && return 0

	acquire_lock
	target_ref="ghcr.io/yetone/magpie:$target_tag"
	say "📦 拉取 magpie $target_tag ..."
	docker pull "$target_ref" >>"$LOG_FILE" 2>&1 || die "镜像 ghcr.io/yetone/magpie:$target_tag 不存在或拉取失败"
	# 记录真实版本号，避免后续把输入当版本比较
	local pv
	pv=$(magpie_image_version "$target_ref")
	[ -n "$pv" ] && [ "$pv" != "$target_tag" ] && say "ℹ️ 镜像实际版本为 v$pv"
	state_set magpie_repo="$target_ref"

	# 磁盘余量保护（镜像 + 解包约需 300MB）
	if [ "$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2{print $4}')" -lt "$MIN_FREE_MB" ] 2>/dev/null; then
		docker image prune -af --filter 'until=168h' >>"$LOG_FILE" 2>&1
	fi

	magpie_backup "$cur_ref" || warn "备份 compose 失败，仍继续"
	log "magpie 升级: $cur_ref → $target_ref"
	if magpie_apply "$target_ref"; then
		local new_ver
		new_ver=$(magpie_image_version "$target_ref")
		state_set magpie_version="$new_ver" last_magpie_upgrade="$(date '+%F %T')"
		state_set last_magpie_from="v${cur_ver:-?}"
		log "magpie 升级成功: v${cur_ver:-?} → v$new_ver"
		say "🎉 magpie 升级成功：v${cur_ver:-?} → v${new_ver}"
		return 0
	fi

	# 失败：自动回滚到升级前的镜像
	log "magpie 升级失败，自动回滚到 $cur_ref"
	say "❌ 新版本启动异常，正在回滚..."
	if magpie_apply "$cur_ref"; then
		state_set last_error="magpie 升级到 v$target_tag 失败，已回滚到 v$cur_ver"
		die "magpie v$target_tag 启动异常，已回滚到 v${cur_ver}（详见 /var/log/sg-update.log）"
	fi
	state_set last_error="magpie 升级失败且回滚失败，需人工处理"
	die "magpie 升级失败且回滚失败，请人工检查 docker compose ps"
}

# 查 magpie 最新发布版本（优先 GHCR 标签，失败退 GitHub Releases）
check_magpie_tag() {
	local tok
	tok=$(ghcr_token yetone/magpie)
	if [ -n "$tok" ]; then
		curl -s --max-time 30 -H "Authorization: Bearer $tok" \
			"https://ghcr.io/v2/yetone/magpie/tags/list?n=10000" -o /tmp/.sg-tags.json 2>/dev/null
		local t
		t=$(MIN=$MAGPIE_MIN_MINOR python3 - /tmp/.sg-tags.json <<'PY' 2>/dev/null
import json, re, sys, os
try:
    tags = json.load(open(sys.argv[1]))["tags"]
except Exception:
    sys.exit(0)
v = [t for t in tags if re.fullmatch(r"0\.1\.\d+", t) and int(t.split(".")[-1]) >= int(os.environ['MIN'])]
print(max(v, key=lambda x: int(x.split(".")[-1])) if v else "")
PY
)
		[ -n "$t" ] && {
			printf '%s' "$t"
			return 0
		}
	fi
	curl -s --max-time 20 -H 'User-Agent: sg-update' \
		"https://api.github.com/repos/yetone/magpie-releases/releases/latest" |
		sed -n 's/.*"tag_name": *"v\([0-9.]*\)".*/\1/p'
}

cmd_rollback() {
	local img ver
	acquire_lock
	img=$(state_get rollback_image)
	ver=$(state_get rollback_version)
	[ -z "$img" ] && die "没有可用的回滚记录"
	say "↩️ 回滚 magpie 到 v${ver:-$img}"
	magpie_apply "$img" || die "回滚失败，请人工检查"
	state_set magpie_version="$ver" last_rollback="$(date '+%F %T')"
	state_set rollback_image="" rollback_version=""
	log "手动回滚到 $img"
	say "✅ 已回滚到 magpie v${ver}"
}

# ---------- cf-probe ----------------------------------------------------------

probe_version() {
	local v
	v=$(cf-probe version 2>/dev/null | grep -oE 'v?[0-9]+\.[0-9]+\.[0-9]+' | head -1)
	printf '%s' "${v#v}"
}

probe_latest() {
	curl -s --max-time 20 -H 'User-Agent: sg-update' \
		"https://api.github.com/repos/huilang-me/cfsm-agent/releases/latest" |
		sed -n 's/.*"tag_name": *"v\([0-9.]*\)".*/\1/p'
}

cmd_probe() {
	local want=${1:-} cur latest target arch tmp
	cur=$(probe_version)
	[ -z "$cur" ] && die "读取 cf-probe 版本失败（探针未安装？）"
	if [ -n "$want" ]; then
		target=${want#v}
	else
		latest=$(probe_latest)
		[ -z "$latest" ] && die "查询 cfsm-agent 最新版本失败（GitHub API 不可达或限流）"
		target=${latest#v}
		if ! vgt "$target" "$cur"; then
			say "✅ cf-probe 已是最新（v$cur）"
			state_set probe_version="$cur"
			return 0
		fi
		say "⬆️ cf-probe v$cur → v$target"
	fi

	acquire_lock
	case "$(uname -m)" in
	x86_64) arch=amd64 ;;
	aarch64 | arm64) arch=arm64 ;;
	*) die "不支持的架构 $(uname -m)" ;;
	esac
	cp -a "$CONF" "/root/backups/cf-probe-config-$(date +%Y%m%d_%H%M%S).conf" 2>/dev/null
	[ -x /usr/local/bin/cf-probe ] && cp -a /usr/local/bin/cf-probe "/root/backups/cf-probe-bin-$(date +%Y%m%d_%H%M%S)" 2>/dev/null
	ls -1t /root/backups/cf-probe-* 2>/dev/null | tail -n +7 | xargs -r rm -f
	tmp=$(mktemp -d)
	# 官方安装脚本带 -id/-secret 会重写配置，所以升级时只传版本，保留现有配置
	log "cf-probe 升级: v$cur → v$target"
	if curl -fsSL --max-time 60 https://raw.githubusercontent.com/huilang-me/cfsm-agent/main/install.sh -o "$tmp/install.sh" 2>>"$LOG_FILE"; then
		if ! sh "$tmp/install.sh" install --install-version="v$target" >>"$LOG_FILE" 2>&1; then
			warn "官方安装脚本执行失败，改用手动替换二进制"
			manual_probe_install "$target" "$arch" "$tmp" || die "cf-probe 升级失败（详见 /var/log/sg-update.log）"
		fi
	else
		manual_probe_install "$target" "$arch" "$tmp" || die "cf-probe 升级失败（详见 /var/log/sg-update.log）"
	fi
	rm -rf "$tmp"

	sleep 3
	systemctl is-active --quiet cf-probe || die "cf-probe 升级后未运行"
	local new
	new=$(probe_version)
	vgt "$target" "$new" && warn "升级后探针仍报 v$new"
	state_set probe_version="$new" last_probe_upgrade="$(date '+%F %T')" last_probe_from="v$cur"
	log "cf-probe 升级成功: v$cur → v$new"
	say "🎉 cf-probe 升级成功：v$cur → v$new"
}

# 升级前备份探针二进制与配置，升级后确认服务仍在跑
manual_probe_install() {
	local target=$1 arch=$2 tmp=$3 base sha
	base="https://github.com/huilang-me/cfsm-agent/releases/download/v$target"
	curl -fsSL --max-time 120 "$base/cf-probe-linux-$arch" -o "$tmp/cf-probe" >>"$LOG_FILE" 2>&1 || return 1
	curl -fsSL --max-time 30 "$base/checksums.txt" -o "$tmp/checksums.txt" >>"$LOG_FILE" 2>&1 || return 1
	sha=$(sha256sum "$tmp/cf-probe" | awk '{print $1}')
	grep -q "$sha" "$tmp/checksums.txt" || {
		warn "cf-probe 校验和不匹配，放弃升级"
		return 1
	}
	systemctl stop cf-probe >>"$LOG_FILE" 2>&1
	install -m 0755 "$tmp/cf-probe" /usr/local/bin/cf-probe && systemctl start cf-probe >>"$LOG_FILE" 2>&1
}

# ---------- 检查 --------------------------------------------------------------

cmd_check() {
	# 定时器（SG_AUTO=1 且非手动 upgrade）先过闸门，避免每几分钟就去碰 GHCR / GitHub API
	if [ "${SG_AUTO:-0}" = "1" ] && [ "${1:-}" != "upgrade" ]; then
		if ! auto_enabled; then
			say "自动更新已关闭，本次什么都不做"
			state_set auto_skip="disabled"
			return 0
		fi
		if ! due_now; then
			say "未到检查周期（每 $(auto_every) 小时一次），跳过"
			state_set auto_skip="not_due"
			return 0
		fi
		# 本次真的会查，先把时间记下来（失败也不会因此连环重试）
		state_set auto_check_at="$(date '+%F %T')" auto_skip=""
	fi
	local m_cur m_tag p_cur p_tag mg_target="" pr_target=""
	m_cur=$(magpie_image_version "$(magpie_image 2>/dev/null)" 2>/dev/null)
	[ -z "$m_cur" ] && m_cur=$(state_get magpie_version)
	p_cur=$(probe_version)
	m_tag=$(check_magpie_tag)
	p_tag=$(probe_latest)
	if [ -z "$p_tag" ]; then
		p_tag=$(state_get probe_latest)
		warn "查询 GitHub API 失败，沿用上次结果"
	fi
	# 检查阶段被显式请求升级时，用参数作为目标版本（不允许拿旧状态当作已是最新）
	local req_mag="" req_probe=""
	if [ "${1:-}" = "upgrade" ]; then
		req_mag=${2:-}
		req_probe=${3:-}
		[ -n "$req_mag" ] && [ "$req_mag" != "-" ] && m_tag=${req_mag#v}
		[ -n "$req_probe" ] && [ "$req_probe" != "-" ] && p_tag=${req_probe#v}
	fi

	mg_target=""
	# 目标版本为空或占位符 "-" 表示跳过该组件
	[ -n "$m_tag" ] && [ "$m_tag" != "-" ] && [ -n "$m_cur" ] && vgt "$m_tag" "$m_cur" && mg_target=$m_tag
	pr_target=""
	# 目标版本为空或占位符 "-" 表示跳过该组件
	[ -n "$p_tag" ] && [ "$p_tag" != "-" ] && vgt "${p_tag#v}" "$p_cur" && pr_target=${p_tag#v}
	# 指定目标但已经是最新时直接告知，避免重复重建容器
	[ -n "$req_mag" ] && [ "$req_mag" != "-" ] && [ -z "$mg_target" ] && say "✅ magpie 已经是 v$m_cur"
	[ -n "$req_probe" ] && [ "$req_probe" != "-" ] && [ -z "$pr_target" ] && say "✅ cf-probe 已经是 v$p_cur"

	# 状态：探针 / 容器的存活情况也一并上报
	local svc cstate usage
	svc=$(systemctl is-active cf-probe 2>/dev/null)
	cstate=$(docker compose -f "$COMPOSE_FILE" ps --format '{{.State}}' 2>/dev/null | head -1)
	usage=$(magpie_usage)

	state_set magpie_version="${m_cur:-}" magpie_latest="${m_tag:-}" \
		probe_version="${p_cur:-}" probe_latest="${p_tag#v}" \
		magpie_update_available="${mg_target:-}" probe_update_available="${pr_target:-}" \
		probe_service="$svc" container_state="${cstate:-unknown}" usage="$usage" \
		tg_chat="$(state_get tg_chat)" defer_hours="$(state_get defer_hours)" \
		auto_enabled="$([ "$(state_get auto_enabled)" = "0" ] && echo 0 || echo 1)" \
		auto_every="$(auto_every)" \
		last_check="$(date '+%F %T')" gateway="$(gateway_url)" hostname="$HOST_NAME" aliases="$SELF_ALIASES"

	# JSON 输出（单行，供手机端解析）
	python3 - "$STATE_FILE" "$mg_target" "$pr_target" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
d['magpie_target'] = sys.argv[2]
d['probe_target'] = sys.argv[3]
print(json.dumps(d, ensure_ascii=False))
PY

	# 自动升级（timer 带 SG_AUTO=1）
	if [ "${SG_AUTO:-0}" = "1" ] || [ "${1:-}" = "upgrade" ]; then
		local did=0
		# 失败原因不清空；本次升级成功后由 cmd_magpie/cmd_probe 自行覆盖
		if [ -n "$pr_target" ] || [ -n "$mg_target" ]; then
			if defer_active; then
				say "🕒 处于空窗期（$(defer_until_str) 前不自动升级），仅记录"
				state_set deferred="1"
				return 0
			fi
			state_set deferred="0"
		fi
		if [ -n "$pr_target" ]; then
			cmd_probe "$pr_target" || did=1
		fi
		if [ -n "$mg_target" ]; then
			cmd_magpie "$mg_target" || did=1
		fi
		# 无论成功失败都推一条，手机侧不用碰服务器
		if [ -n "$pr_target" ]; then
			if [ $did -eq 0 ]; then
				notify "✅ cf-probe 自动升级完成（原 v$p_cur）"
			else
				notify "❌ cf-probe 自动升级异常，请查看 /var/log/sg-update.log"
			fi
		fi
		if [ -n "$mg_target" ]; then
			if grep -q "magpie 升级成功" <(tail -n 40 "$LOG_FILE"); then
				notify "✅ magpie 自动升级到 v$mg_target"
			else
				notify "❌ magpie 升级到 v$mg_target 失败，详见日志"
			fi
		fi
		[ $did -eq 1 ] && exit 20
		return 0
	fi

	[ -n "$mg_target$pr_target" ] && exit 10
	return 0
}

# ---------- 辅助命令 ----------------------------------------------------------

cmd_status() {
	local m_cur p_cur
	m_cur=$(magpie_image_version "$(magpie_image 2>/dev/null)" 2>/dev/null)
	[ -z "$m_cur" ] && m_cur=$(state_get magpie_version)
	p_cur=$(probe_version)
	state_set magpie_version="${m_cur:-}" probe_version="${p_cur:-}" \
		container_state="$(docker compose -f "$COMPOSE_FILE" ps --format '{{.State}}' 2>/dev/null | head -1)" \
		probe_service="$(systemctl is-active cf-probe 2>/dev/null)" \
		gateway="$(gateway_url)" status_at="$(date '+%F %T')"
	cmd_check >/dev/null 2>&1
	echo "magpie=${m_cur:-?} probe=${p_cur:-?}"
}

case "${1:-check}" in
check) cmd_check ;;
upgrade) shift && cmd_check upgrade "$@" ;;
magpie) shift && cmd_magpie "$@" ;;
probe) shift && cmd_probe "$@" ;;
rollback) cmd_rollback ;;
notify)
	shift
	notify "$*" || true
	;;
set)
	shift
	k=${1:-}
	v=${2:-}
	case "$k" in
	auto_enabled)
		case "$v" in
		1 | on | true) state_set auto_enabled=1 && echo "已开启自动更新" ;;
		0 | off | false) state_set auto_enabled=0 && echo "已关闭自动更新" ;;
		*) echo "auto_enabled 只接受 0/1" && exit 1 ;;
		esac
		;;
	auto_every)
		case "$v" in
		1 | 3 | 6 | 12 | 24) state_set auto_every="$v" && echo "已设置自动更新频率 ${v} 小时" ;;
		*) echo "auto_every 只接受 1 / 3 / 6 / 12 / 24" && exit 1 ;;
		esac
		;;
	defer_hours | tg_chat | tg_bot) state_set "$k=$v" && echo "已保存 $k" ;;
	tg_token)
		# 空值 = 清除 token
		if [ -z "$v" ]; then rm -f "$STATE_DIR/tg_token" && echo "已清除 bot token" && exit 0; fi
		umask 077
		printf '%s' "$v" >"$STATE_DIR/tg_token"
		chmod 600 "$STATE_DIR/tg_token"
		echo "已保存 bot token"
		;;
	*) echo "可设置项: auto_enabled / auto_every / defer_hours / tg_chat / tg_bot / tg_token" && exit 1 ;;
	esac
	;;
show)
	# 给手机端回填用：配置项 + 通知是否已配齐（不回显密钥）
	python3 - "$STATE_FILE" "$(tg_token)" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    d = {}
print(json.dumps({
    "auto_enabled": int(d.get("auto_enabled", 1)),
    "auto_every": int(d.get("auto_every", 24) or 24),
    "auto_check_at": d.get("auto_check_at", "") or "",
    "defer_hours": int(d.get("defer_hours", 6) or 0),
    # tg_* 一律强转字符串：旧状态文件里可能是数字
    "tg_chat": str(d.get("tg_chat", "") or ""),
    "tg_bot": str(d.get("tg_bot", "") or ""),
    "tg_token_set": bool(sys.argv[2].strip()),
    "tg_ready": bool(sys.argv[2].strip()) and bool(d.get("tg_chat")),
}, ensure_ascii=False))
PY
	;;
notify-test)
	# notify 返回码：0 已送达 / 1 发送失败 / 2 未配置
	if notify "测试通知：$HOST_NAME 更新助手已就绪"; then
		echo "已发送到 Telegram"
	else
		rc=$?
		if [ "$rc" = "2" ]; then
			echo "未配置：需要同时填 Bot Token 和 Chat ID"
		else
			echo "发送失败：请检查 token 与 chat id（详见 /var/log/sg-update.log）"
		fi
		exit 1
	fi
	;;
timeout)
	shift
	if [ -z "${1:-}" ]; then
		printf '当前空窗期: %s 小时\n' "$(state_get defer_hours || echo 6)"
		exit 0
	fi
	state_set defer_hours="$1"
	echo "已设置空窗期 ${1} 小时（0 表示关闭）"
	;;
log)
	shift
	tail -n "${1:-50}" "$LOG_FILE" 2>/dev/null || echo "(暂无日志)"
	;;
state) cat "$STATE_FILE" 2>/dev/null || echo '{}' ;;
*)
	echo "用法: sg-update {check|upgrade [magpie版本|-] [probe版本|-]|magpie [版本]|probe [版本]|rollback|notify 文本|notify-test|set KEY VALUE|show|timeout N|log [行数]|state}"
	exit 1
	;;
esac
