import { Button, Form, HStack, Image, Navigation, NavigationStack, Section, Spacer, Text, useState } from "scripting"
import { AppConfig } from "../types"
import { FormRow } from "../components/FormRow"

const builtInImagePath = `${FileManager.appGroupDocumentsDirectory}/model-lab-test-image.jpg`

export function SettingsPage({ config, onChanged }: { config: AppConfig; onChanged: (config: AppConfig) => void }) {
  const dismiss = Navigation.useDismiss()
  const [previewImage, setPreviewImage] = useState<UIImage | null>(UIImage.fromFile(config.testImagePath || builtInImagePath))
  const [hasImage, setHasImage] = useState(Boolean(config.testImagePath))
  const update = (patch: Partial<AppConfig>) => onChanged({ ...config, ...patch })

  async function chooseImage() {
    try {
      const picked = await Photos.pickPhotos(1)
      const image = picked[0]
      const data = image?.toJPEGData(0.88)
      if (!image || !data) return
      await FileManager.writeAsData(builtInImagePath, data)
      setPreviewImage(image)
      setHasImage(true)
      update({ testImagePath: builtInImagePath })
    } catch (error) {
      console.log(`保存内置图片失败：${String(error)}`)
    }
  }

  async function clearImage() {
    if (await FileManager.exists(builtInImagePath)) await FileManager.remove(builtInImagePath)
    setPreviewImage(null)
    setHasImage(false)
    update({ testImagePath: "" })
  }

  return (
    <NavigationStack>
      <Form navigationTitle="设置" navigationBarTitleDisplayMode="inline" toolbar={{ cancellationAction: <Button title="关闭" tint="red" action={dismiss} /> }}>
        <Section header={<Text>内置提示语</Text>}>
          <FormRow label="文本" value={config.defaultPrompt} prompt="文本测试提示语" onChanged={value => update({ defaultPrompt: value })} labelWidth={58} />
          <FormRow label="看图" value={config.visionPrompt} prompt="多模态测试提示语" onChanged={value => update({ visionPrompt: value })} labelWidth={58} />
          <FormRow label="生图" value={config.imagePrompt} prompt="生图测试提示语" onChanged={value => update({ imagePrompt: value })} labelWidth={58} />
        </Section>
        <Section header={<Text>通用测试</Text>} footer={<Text>问答返回格式与 HTML 输出规则已内置，无需填写。题目和答案支持多道，每行一项并按顺序一一对应；答案也兼容 JSON 字符串数组，数值题只填数字。</Text>}>
          <FormRow label="题目" value={config.qaQuestions} prompt="多道题目每行一题" multiline onChanged={value => update({ qaQuestions: value })} labelWidth={88} />
          <FormRow label="答案" value={config.qaAnswers} prompt="多道答案每行一个" multiline onChanged={value => update({ qaAnswers: value })} labelWidth={88} />
          <FormRow label="HTML 提示语" value={config.htmlPrompt} prompt="描述要生成的页面" multiline onChanged={value => update({ htmlPrompt: value })} labelWidth={88} />
        </Section>
        <Section header={<Text>内置测试图片</Text>}>
          {hasImage ? (
            <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
              <Spacer />
              {previewImage ? <Image image={previewImage} resizable scaleToFit frame={{ height: 180 }} /> : <Text foregroundStyle="secondaryLabel">图片加载失败</Text>}
              <Spacer />
            </HStack>
          ) : (
            <Text foregroundStyle="secondaryLabel">尚未选择图片</Text>
          )}
          <Button title={hasImage ? "重新选择图片" : "选择图片"} systemImage="photo" action={() => void chooseImage()} />
          {hasImage ? <Button title="清除" systemImage="trash" role="destructive" action={() => void clearImage()} /> : null}
        </Section>
      </Form>
    </NavigationStack>
  )
}
