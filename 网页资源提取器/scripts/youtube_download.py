#!/usr/bin/env python3
"""YouTube 下载桥接脚本：Innertube 格式下载。

用法:
    python youtube_download.py <component_path> <url> <video_itag> <audio_itag|-> <video_out> <audio_out>

通过 Android Innertube 获取格式 URL。小文件单次下载，大文件使用 YouTube
播放器的 range/rn/rbuf 查询参数分段；调用方负责在高画质受 PO Token 限制时降级。
"""
import json
import os
import random
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

component_path = sys.argv[1] if len(sys.argv) >= 2 else ""

# SABR 组件的 _shim_v2 提供 SSL 适配（googlevideo 缺 WR2 中间证书）
_open_request = None
if component_path and os.path.isdir(os.path.join(component_path, "yt_sabr2")):
    sys.path.insert(0, component_path)
    try:
        from yt_sabr2._shim_v2 import open_request as _open_request
    except ImportError:
        pass

# 回退：不验证证书
if _open_request is None:
    _ssl_ctx = ssl.create_default_context()
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = ssl.CERT_NONE

    class _Response:
        def __init__(self, resp):
            self._resp = resp
            self.status = resp.status
            self.headers = resp.headers

        def read(self):
            return self._resp.read()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self._resp.close()

    def _open_request(req, timeout=30):
        return _Response(urllib.request.urlopen(req, timeout=timeout, context=_ssl_ctx))

ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip"
DOWNLOAD_UA = ANDROID_UA
ANDROID_CLIENT = {
    "clientName": "ANDROID",
    "clientVersion": "20.10.38",
    "androidSdkVersion": 34,
    "osName": "Android",
    "osVersion": "14",
    "hl": "en",
    "timeZone": "UTC",
    "utcOffsetMinutes": 0,
}

VIDEO_ID_PATTERNS = [
    re.compile(r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/|youtube\.com/embed/)([a-zA-Z0-9_-]{5,})"),
]


def extract_video_id(url):
    """从 YouTube URL 中提取 videoId。"""
    for pattern in VIDEO_ID_PATTERNS:
        match = pattern.search(url)
        if match:
            return match.group(1)
    if re.match(r"^[a-zA-Z0-9_-]{11}$", url):
        return url
    raise RuntimeError(f"无法从 URL 提取 videoId: {url}")


def fetch_player(video_id):
    """用 Android 客户端调用 Innertube player API。"""
    body = json.dumps({
        "context": {"client": ANDROID_CLIENT},
        "videoId": video_id,
        "playbackContext": {"contentPlaybackContext": {
            "html5Preference": "HTML5_PREF_WANTS",
            "signatureTimestamp": 20476,
        }},
        "contentCheckOk": True,
        "racyCheckOk": True,
    }).encode()
    req = urllib.request.Request(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": ANDROID_UA,
            "X-Youtube-Client-Name": "3",
            "X-Youtube-Client-Version": ANDROID_CLIENT["clientVersion"],
        },
    )
    with _open_request(req, timeout=15) as resp:
        return json.loads(resp.read())


def find_format(player, itag):
    """从 player 响应中查找指定 itag 的格式信息。"""
    sd = player.get("streamingData") or {}
    all_formats = (sd.get("formats") or []) + (sd.get("adaptiveFormats") or [])
    for fmt in all_formats:
        if str(fmt.get("itag")) == str(itag):
            return fmt
    raise RuntimeError(f"未找到 itag {itag} 的格式")


def request_headers():
    return {
        "User-Agent": DOWNLOAD_UA,
        "Accept": "*/*",
        "Accept-Encoding": "identity",
        "Origin": "https://www.youtube.com",
        "Referer": "https://www.youtube.com/",
    }


def range_url(url, start, end, request_number):
    parsed = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query = [(key, value) for key, value in query if key not in {"range", "rn", "rbuf"}]
    query.extend([
        ("range", f"{start}-{end}"),
        ("rn", str(request_number)),
        ("rbuf", "0"),
    ])
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(query), parsed.fragment))


def format_http_error(error, label):
    try:
        detail = error.read().decode("utf-8", errors="replace").strip()
    except Exception:
        detail = ""
    suffix = f": {detail[:240]}" if detail else ""
    return RuntimeError(f"{label} HTTP {error.code}{suffix}")


def read_range(video_id, itag, start, end, timeout, label, request_number, initial_url=None):
    last_error = None
    url = initial_url
    for attempt in range(6):
        if not url or attempt > 0:
            url = find_format(fetch_player(video_id), itag).get("url")
            if not url:
                raise RuntimeError(f"刷新 {itag} 下载 URL 失败")
        effective_request_number = request_number if attempt == 0 else 1
        req = urllib.request.Request(
            range_url(url, start, end, effective_request_number),
            headers=request_headers(),
        )
        try:
            with _open_request(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code != 403:
                raise format_http_error(error, label)
            if attempt < 5:
                time.sleep(0.5 + attempt * 0.4 + random.random() * 0.3)
    raise format_http_error(last_error, label)


def download_track(video_id, itag, output_path, label=""):
    """下载单个轨道：获取 URL 后用有限 Range 请求下载完整文件。

    YouTube googlevideo 要求有限 Range（bytes=0-N），bytes=0- 和无 Range 会 403。
    对大文件分块下载，每块前刷新 URL 避免限速。
    """
    print(f"INFO downloading {label}...", flush=True)

    # 获取格式 URL
    player = fetch_player(video_id)
    fmt = find_format(player, itag)
    url = fmt.get("url")
    if not url:
        raise RuntimeError(f"{label} 未找到 URL")
    content_length = int(fmt.get("contentLength", 0))
    if content_length <= 0:
        raise RuntimeError(f"{label} 无法获取文件大小")

    print(f"INFO {label} size: {content_length} bytes", flush=True)

    # 单次请求下载完整文件（有限 Range）
    # 如果文件 <= 10MB，用单次请求
    if content_length <= 10 * 1024 * 1024:
        data = read_range(video_id, itag, 0, content_length - 1, 300, label, 1, url)
        with open(output_path, "wb") as fh:
            fh.write(data)
        print(f"INFO {label} downloaded: {len(data)} bytes", flush=True)
        return len(data)

    # 大文件：分块下载，每块前刷新 URL
    chunk_size = 2 * 1024 * 1024  # 2MB per chunk
    written = 0
    with open(output_path, "wb") as fh:
        offset = 0
        while offset < content_length:
            # YouTube 客户端通过 URL range/rn 参数复用同一授权会话。
            end = min(offset + chunk_size - 1, content_length - 1)
            request_number = offset // chunk_size + 1
            data = read_range(video_id, itag, offset, end, 60, label, request_number, url)
            fh.write(data)
            written += len(data)
            offset = end + 1
            pct = written * 100 // content_length
            print(f"INFO {label} progress: {pct}% ({written}/{content_length})", flush=True)

    print(f"INFO {label} downloaded: {written} bytes", flush=True)
    return written


def main():
    if len(sys.argv) < 7:
        raise ValueError("YouTube 下载参数不完整")
    # argv[1] 组件路径 | argv[2] URL | argv[3] 视频 itag | argv[4] 音频 itag 或 "-"
    # argv[5] 视频输出路径 | argv[6] 音频输出路径
    url, video_itag, audio_itag = sys.argv[2], sys.argv[3], sys.argv[4]
    video_path, audio_path = sys.argv[5], sys.argv[6]

    # 提取 videoId
    video_id = extract_video_id(url)
    print(f"INFO videoId={video_id}", flush=True)

    # 下载视频轨
    download_track(video_id, video_itag, video_path, f"video itag={video_itag}")

    # 下载音轨（如果有）
    if audio_itag != "-":
        download_track(video_id, audio_itag, audio_path, f"audio itag={audio_itag}")

    print("OK", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERR: {error}", flush=True)
        sys.exit(1)
