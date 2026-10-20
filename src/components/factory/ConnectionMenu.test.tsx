import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConnectionChip, ExportChip } from './ConnectionMenu'
import { useUiStore } from '../../store/uiStore'
import type { BlockConnection, ConnectionFlow, Item } from '../../data/types'

const item = (): Item => ({ id: 'iron-ore', name: 'Iron Ore', type: 'item', iconPath: 'x/y', hidden: false }) as Item
const connection = (): BlockConnection => ({ id: 'c1', itemId: 'iron-ore', fromBlockId: 'miner' }) as BlockConnection
const flow = (): ConnectionFlow => ({
  connectionId: 'c1', fromBlockId: 'miner', toBlockId: 'consumer', itemId: 'iron-ore',
  available: 30, rate: 30, status: 'ok',
})

beforeEach(() => useUiStore.setState({ rateUnit: 'min' }))

describe('chip icons', () => {
  const connectionChip = (showIcon?: boolean) => (
    <ConnectionChip
      connection={connection()} flow={flow()} item={item()} sourceName="Miner" neededPerMin={30}
      showIcon={showIcon} onSelectSource={() => {}} onContextMenu={() => {}}
    />
  )
  const exportChip = (showIcon?: boolean) => (
    <ExportChip flow={flow()} item={item()} consumerName="Consumer" showIcon={showIcon} onSelectConsumer={() => {}} />
  )

  it('ConnectionChip renders an icon by default and none with showIcon={false}', () => {
    const { container, unmount } = render(connectionChip())
    expect(container.querySelector('img')).not.toBeNull()
    const title = screen.getByTestId('connection-chip').getAttribute('title')
    unmount()
    const second = render(connectionChip(false))
    expect(second.container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('connection-chip').getAttribute('title')).toBe(title)
  })

  it('ExportChip renders an icon by default and none with showIcon={false}', () => {
    const { container, unmount } = render(exportChip())
    expect(container.querySelector('img')).not.toBeNull()
    const title = screen.getByTestId('export-chip').getAttribute('title')
    unmount()
    const second = render(exportChip(false))
    expect(second.container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('export-chip').getAttribute('title')).toBe(title)
  })
})
