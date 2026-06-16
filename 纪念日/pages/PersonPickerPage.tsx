import { Navigation, NavigationStack, List, Section, Button, Text, HStack, VStack, Spacer, Toolbar, ToolbarItem, Image } from 'scripting'
import { Person } from '../types'
import { Avatar, RelationshipTag, EmptyState } from '../components'

interface PersonPickerPageProps {
  persons: Person[]
  onSelectPerson: (person: Person) => void
  onCreatePerson: () => void
}

export function PersonPickerPage({ persons, onSelectPerson, onCreatePerson }: PersonPickerPageProps) {
  const dismiss = Navigation.useDismiss()

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle="选择人物"
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button key="关闭" action={dismiss}>
                <Image systemName="xmark" fontWeight="semibold" />
              </Button>
            </ToolbarItem>
          </Toolbar>
        }
      >
        <Section>
          <Button action={() => { dismiss(); onCreatePerson() }}>
            <HStack spacing={12} frame={{ maxWidth: Infinity }} alignment="center">
              <Image systemName="person.badge.plus" font={24} foregroundStyle="accentColor" />
              <Text fontWeight="semibold">新建人物</Text>
              <Spacer />
              <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />
            </HStack>
          </Button>
        </Section>

        {persons.length > 0 ? (
          <Section title="现有人物">
            {persons.map(person => (
              <Button key={person.id} action={() => { dismiss(); onSelectPerson(person) }}>
                <HStack spacing={12} frame={{ maxWidth: Infinity }} alignment="center">
                  <Avatar person={person} size={40} />
                  <VStack alignment="leading" spacing={2}>
                    <Text fontWeight="semibold">{person.name}</Text>
                    <RelationshipTag relationship={person.relationship} />
                  </VStack>
                  <Spacer />
                  <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />
                </HStack>
              </Button>
            ))}
          </Section>
        ) : (
          <EmptyState title="还没有人物" subtitle="点击上方新建人物" systemImage="person.2" />
        )}
      </List>
    </NavigationStack>
  )
}
