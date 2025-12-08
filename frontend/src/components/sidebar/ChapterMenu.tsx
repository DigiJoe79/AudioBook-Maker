/**
 * ChapterMenu - Dropdown menu for chapter actions
 * Accessed via the ⋮ (more) icon in chapter items
 */

import EntityMenuDropdown from './EntityMenuDropdown'

interface ChapterMenuProps {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}

export default function ChapterMenu(props: ChapterMenuProps) {
  return <EntityMenuDropdown {...props} i18nPrefix="chapters" />
}
