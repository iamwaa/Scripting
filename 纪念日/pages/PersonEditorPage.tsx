import { Navigation, NavigationStack, List, Section, Picker, Button, Text, VStack, HStack, Spacer, Toolbar, ToolbarItem, Image } from 'scripting'
import { useState } from 'scripting'
import { Person } from '../types'
import { Avatar, FormRow } from '../components'
import { saveAvatar, deleteAvatar } from '../storage'
import { saveWidgetAvatar } from '../widgetAvatar'

const RELATIONSHIP_OPTIONS = ['自己', '伴侣', '子女', '家人', '朋友', '同学', '同事', '其他']

// 判断关系值是否为内置选项
const isBuiltInRelationship = (value?: string) => value ? RELATIONSHIP_OPTIONS.includes(value) : false

interface PersonEditorPageProps {
  person?: Person
  onSave: (person: Person) => void
}

export function PersonEditorPage({ person, onSave }: PersonEditorPageProps) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(person?.name ?? '')
  const initialRelationship = person?.relationship ?? ''
  const [relationship, setRelationship] = useState(
    isBuiltInRelationship(initialRelationship) ? initialRelationship : '其他'
  )
  const [relationshipCustom, setRelationshipCustom] = useState(
    isBuiltInRelationship(initialRelationship) ? '' : initialRelationship
  )
  const [notes, setNotes] = useState(person?.notes ?? '')
  const [avatarPath, setAvatarPath] = useState(person?.avatarPath ?? null)
  const [isSaving, setIsSaving] = useState(false)

  // 记录编辑前的原始头像路径，用于保存后清理旧文件
  const originalAvatarPath = person?.avatarPath ?? null

  const isCustomRelationship = relationship === '其他'

  const pickAvatar = async () => {
    try {
      const images = await Photos.pickPhotos(1)
      if (images.length === 0) return
      const image = images[0]
      const data = image.toJPEGData(0.9)
      if (!data) return
      const path = await saveAvatar(data)
      await saveWidgetAvatar(path)
      // 若旧头像存在则删除
      if (avatarPath && avatarPath !== person?.avatarPath) {
        await deleteAvatar(avatarPath)
      }
      setAvatarPath(path)
    } catch (err) {
      console.log('选择头像失败:', err)
    }
  }

  const removeAvatar = async () => {
    if (avatarPath && avatarPath !== person?.avatarPath) {
      await deleteAvatar(avatarPath)
    }
    setAvatarPath(null)
  }

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setIsSaving(true)
    const trimmedCustom = relationshipCustom.trim()
    let finalRelationship = relationship
    if (isCustomRelationship && trimmedCustom) {
      finalRelationship = trimmedCustom
    }
    const updated: Person = {
      id: person?.id ?? '',
      name: trimmed,
      avatarPath,
      relationship: finalRelationship,
      notes: notes.trim(),
      createdAt: person?.createdAt ?? Date.now()
    }
    await onSave(updated)
    // 若头像已被更换或删除，则删除原头像文件
    if (originalAvatarPath && originalAvatarPath !== updated.avatarPath) {
      await deleteAvatar(originalAvatarPath)
    }
    setIsSaving(false)
    dismiss(updated)
  }

  const displayPerson: Person = {
    id: person?.id ?? '',
    name: name || '新人物',
    avatarPath,
    relationship,
    notes: '',
    createdAt: 0
  }

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle={person ? '编辑人物' : '新人物'}
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button key="返回" action={dismiss}>
                <Image systemName="chevron.left" fontWeight="semibold" />
              </Button>
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              <Button title="保存" systemImage="square.and.arrow.down" fontWeight="semibold" action={handleSave} disabled={isSaving || !name.trim()} />
            </ToolbarItem>
          </Toolbar>
        }
      >
        <Section>
          <VStack padding={20} alignment="center" spacing={8} frame={{ maxWidth: Infinity }}>
            <Button action={pickAvatar}>
              <Avatar person={displayPerson} size={130} />
            </Button>
            {!avatarPath ? (
              <Text foregroundStyle="secondaryLabel" font={14}>点击头像添加照片</Text>
            ) : (
              <Button
                title="删除"
                role="destructive"
                buttonStyle="bordered"
                font={13}
                action={removeAvatar}
              />
            )}
          </VStack>
        </Section>

        <Section title="基本信息">
          <FormRow label="姓名" value={name} prompt="输入姓名" onChanged={setName} />
          <HStack spacing={12} frame={{ maxWidth: Infinity }}>
            <Picker
              label={<Text>关系</Text>}
              value={relationship}
              onChanged={(v: string) => setRelationship(v)}
              pickerStyle="menu"
            >
              {RELATIONSHIP_OPTIONS.map(option => (
                <Text key={option} tag={option}>{option}</Text>
              ))}
            </Picker>
            <Spacer />
          </HStack>
          {isCustomRelationship && (
            <FormRow label="自定义" value={relationshipCustom} prompt="例如：导师、邻居" onChanged={setRelationshipCustom} />
          )}
          <FormRow label="备注" value={notes} prompt="写下关于 TA 的点滴" onChanged={setNotes} />
        </Section>
      </List>
    </NavigationStack>
  )
}
