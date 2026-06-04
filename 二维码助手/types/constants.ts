import { AppSettings, RedirectRule } from "./types";

export const STORAGE_KEY = "QR_ASSISTANT_HISTORY_V2";
export const SETTINGS_KEY = "QR_ASSISTANT_SETTINGS_V1";

export const DEFAULT_REDIRECT_RULES: RedirectRule[] = [
  { 
    keyword: "wechat,weixin,wxp,wx,wechatpay,tenpay,micromsg,u.wechat.com,c.weixin.com,payapp.weixin,pay.qq.com,cloud.tencent,login.weixin,open.weixin,QSWchatMiniApp", 
    urlScheme: "weixin://scanqrcode", 
    appName: "微信", 
    iconUrl: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/8b/9f/53/8b9f534e-e826-d72a-f3ae-04231eef8ccf/AppIcon-0-0-1x_U007epad-0-1-0-sRGB-0-85-220.png/512x512bb.png" 
  },
  { 
    keyword: "qq,mqq,mqqapi,tencent", 
    urlScheme: "mqqapi://qrcode/scan_qrcode?version=1&src_type=app", 
    appName: "QQ", 
    iconUrl: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/1a/dc/06/1adc0645-6093-a10a-12f0-fb784f3e3734/AppIcon-1-0-1x_U007epad-0-1-0-sRGB-85-220-0.png/512x512bb.png" 
  },
  { 
    keyword: "alipay,alipays,zhifubao,koubei", 
    urlScheme: "alipays://platformapi/startapp?saId=10000007", 
    appName: "支付宝", 
    iconUrl: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/c9/6a/b4/c96ab483-5589-1806-e7f7-97802455e6b3/AppIcon-0-0-1x_U007epad-0-1-0-85-220.png/512x512bb.png" 
  },
  { 
    keyword: "taobao,tmall,tb,itaobao", 
    urlScheme: "taobao://tb.cn/n/scancode", 
    appName: "淘宝", 
    iconUrl: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/4d/c4/26/4dc42695-c9b2-d11f-7e20-ec9e1f8d3cb0/AppIcon-0-0-1x_U007emarketing-0-10-0-85-220.png/512x512bb.png" 
  },
  { 
    keyword: "douyin,dy,snssdk,amemv,tiktok", 
    urlScheme: "snssdk1128://scan", 
    appName: "抖音", 
    iconUrl: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/b6/12/37/b61237d2-7d27-d169-19b8-364daab2299f/AppIcon-0-0-1x_U007emarketing-0-0-0-7-0-0-85-220.png/512x512bb.png" 
  },
  { 
    keyword: "jd,jingdong,360buy,openapp.jdmobile", 
    urlScheme: 'openapp.jdmobile://virtual?params={"category":"jump","des":"saoasao"}', 
    appName: "京东", 
    iconUrl: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/00/12/27/0012274c-b0c0-7c23-b329-5225d93e7c3b/AppIcon-0-0-1x_U007epad-0-1-0-85-220.png/512x512bb.png" 
  },
  { 
    keyword: "meituan,mt,dianping", 
    urlScheme: "imeituan://www.meituan.com/scanQRCode?openAR=1", 
    appName: "美团", 
    iconUrl: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/dd/98/c5/dd98c52e-e76c-f93b-cc33-fa8f254cc38d/AppIcon-0-0-1x_U007emarketing-0-0-0-7-0-0-sRGB-85-220.png/512x512bb.png" 
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  autoScanOnOpen: false,
  autoRedirect: false,
  redirectRules: DEFAULT_REDIRECT_RULES,
  fallbackEnabled: false,
  fallbackUrlScheme: "",
  subscriptionUrl: "",
};
