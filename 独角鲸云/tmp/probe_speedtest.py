import json
import urllib.request

url = "https://api.fuckip.me/api/v1/machines/f582a548-6a29-455b-8771-cdf5b3cef7ad/test-speed"
body = json.dumps({"nodes": ["cn-telecom", "cn-unicom", "cn-mobile"]}).encode()
req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(req, timeout=90) as resp:
    data = resp.read()
print(data.decode()[:6000])
