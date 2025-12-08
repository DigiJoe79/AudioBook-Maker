/**
 * ProjectMenu - Dropdown menu for project actions
 * Accessed via the ⋮ (more) icon in project items
 */

import EntityMenuDropdown from './EntityMenuDropdown'

interface ProjectMenuProps {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}

export default function ProjectMenu(props: ProjectMenuProps) {
  return <EntityMenuDropdown {...props} i18nPrefix="projects" />
}
