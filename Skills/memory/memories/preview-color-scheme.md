---
name: preview-color-scheme
description: Scripting 静态预览中 preferredColorScheme 可能不改变截图外观，需核对实际颜色而非凭参数认定验证成功
metadata:
  type: reference
---

`preview_ui` 中给根容器设置 `preferredColorScheme="dark"`，截图仍可能采用浅色，动态背景和 `DynamicImageSource` 也继续选择 light。`scripting-ts run` 通过 `Navigation.present` 的截图路径也观察到相同现象。不能仅凭传入 dark 参数就认定已验证深色 UI。

规避：先看截图中的语义文字、动态背景和图片是否确实切换；要验证地图素材和渐变，可在临时探针中显式用暗色 UIImage + 暗底。完整系统主题切换未真正发生时，在交付或测试记录中如实说明，不改动生产组件的系统自适应行为来制造“通过”。

透明渐变直接用 `mask={<Rectangle fill={gradient("linear", { colors: ["clear", "black"], startPoint: "leading", endPoint: "trailing" })} />}`。其确切属性声明位于 `TransformAndEffectProps.mask`；符号检索裸 `mask` 可能先命中手势 `GestureMask`。不必以 blendMode 模拟遮罩。
