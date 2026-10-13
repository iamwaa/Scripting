---
name: theos-logos-orig-inline
description: theos Logos 的 %orig 不能直接写成外层函数实参 foo(%orig)，展开会吞掉闭合括号导致 expected ')'
metadata:
  type: reference
---

- **Logos（theos）里 `%orig` 直接作为外层函数调用的实参 `foo(%orig)` 会编译失败。** 现象：`return SomeFn(%orig);` 预处理后变成 `return SomeFn(_logos_orig$Group$Class$selector(self, _cmd);`——外层 `SomeFn(` 的闭合括号被 Logos 当 `%orig()` 空参数结束符吞掉，clang 报 `expected ')'`，错误定位到该行但展开后只有一个 `)`。`%orig` 单独成句（`Type *x = %orig;`）、`%orig(args)`、三元表达式 `cond ? x : %orig`、`%orig;` 都正常，只有「`%orig` 后紧跟 `)` 且前面有 `(`」这种内联形式会中招。规避：先赋值再包装：
  ```objc
  - (NSDictionary *)HTTPAdditionalHeaders {
      NSDictionary *headers = %orig;
      return DYYYLoginBypassHeadersByReplacingBundleIdentifiers(headers);
  }
  ```
  实测于 GitHub Actions + huami1314/theos-action（roothide/theos）构建 DYYY tweak，报错 `DYYY.xm:428:154: error: expected ')'`。