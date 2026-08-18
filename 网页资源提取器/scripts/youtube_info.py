#!/usr/bin/env python3
"""YouTube 格式信息脚本：用 Android Innertube 获取 H.264/M4A 候选。

用法:
    python youtube_info.py <component_path> <url>

输出 JSON 格式的视频信息和格式列表。实际媒体下载仍可能受 YouTube
PO Token/SABR 策略限制，下载器会在高画质 403 时使用兼容格式。
"""
import json
import os
import re
import sys
import urllib.request

component_path = sys.argv[1] if len(sys.argv) >= 2 else ""

# SABR 组件的 _shim_v2 提供 SSL 适配（googlevideo 缺 WR2 中间证书）
if component_path and os.path.isdir(os.path.join(component_path, "yt_sabr2")):
    sys.path.insert(0, component_path)
    try:
        from yt_sabr2._shim_v2 import open_request as _open_request
    except ImportError:
        _open_request = None
else:
    _open_request = None

# 回退：用标准 urllib + 不验证证书
if _open_request is None:
    import ssl
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

# 同时也用 yt-dlp 获取格式信息（兼容现有解析逻辑）
if component_path and os.path.isdir(os.path.join(component_path, "yt_dlp")):
    sys.path.insert(0, component_path)
    from yt_dlp import YoutubeDL

ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip"
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
    for pattern in VIDEO_ID_PATTERNS:
        match = pattern.search(url)
        if match:
            return match.group(1)
    if re.match(r"^[a-zA-Z0-9_-]{11}$", url):
        return url
    raise RuntimeError(f"无法从 URL 提取 videoId: {url}")


def fetch_player(video_id):
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


def compact_format(item):
    mime = item.get("mimeType", "")
    is_audio = "audio/" in mime
    # 音频 mp4 容器用 m4a 扩展名（与解析器期望一致）
    if is_audio and "mp4" in mime:
        ext = "m4a"
    elif "/" in mime:
        ext = mime.split("/")[1].split(";")[0]
    else:
        ext = "mp4"
    # 从 mimeType 中提取编解码器
    import re
    codec_match = re.search(r'codecs="([^"]+)"', mime)
    codec = codec_match.group(1) if codec_match else "none"
    return {
        "formatId": str(item.get("itag", "")),
        "url": item.get("url"),
        "ext": ext,
        "protocol": "http",
        "width": item.get("width"),
        "height": item.get("height"),
        "fps": item.get("fps"),
        "vcodec": "none" if is_audio else codec,
        "acodec": codec if is_audio else "none",
        "tbr": item.get("averageBitrate"),
        "abr": item.get("averageBitrate"),
        "itag": item.get("itag"),
        "mimeType": mime,
        "contentLength": item.get("contentLength"),
    }


def main():
    if len(sys.argv) < 3:
        raise ValueError("缺少 YouTube 组件路径或链接")
    url = sys.argv[2]

    # 步骤 1: 用 yt-dlp 获取基本信息（标题、缩略图等）
    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "nocheckcertificate": True,
    }
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)

    video_id = info.get("id") or extract_video_id(url)

    # 步骤 2: 用 Android 客户端获取支持标准 Range 的格式 URL
    player = fetch_player(video_id)
    playability = (player.get("playabilityStatus") or {}).get("status", "")
    if playability != "OK":
        raise RuntimeError(f"YouTube 播放不可用: {playability}")

    sd = player.get("streamingData") or {}
    all_formats = (sd.get("formats") or []) + (sd.get("adaptiveFormats") or [])

    # 过滤出可用的 H.264 视频和 M4A 音频格式
    formats = []
    for item in all_formats:
        url = item.get("url")
        if not url:
            continue
        mime = item.get("mimeType", "")
        is_m4a = "audio/mp4" in mime
        is_h264 = "video/mp4" in mime and "avc1" in mime
        if is_m4a or is_h264:
            formats.append(compact_format(item))

    result = {
        "id": video_id,
        "title": info.get("title"),
        "thumbnail": info.get("thumbnail"),
        "formats": formats,
    }
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False, separators=(",", ":")))
        sys.exit(1)
