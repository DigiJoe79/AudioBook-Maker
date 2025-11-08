/**
 * Command Toolbar - Draggable items for quick segment creation
 * Users can drag these items into the segment list
 */

import { Box, Paper, Typography, Chip, Tooltip } from '@mui/material'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import TextFieldsIcon from '@mui/icons-material/TextFields'
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule'
import type { CommandItem } from '../types'
import { useTranslation } from 'react-i18next'

// Available command items - labels will be translated dynamically
const getCommandItems = (t: any): CommandItem[] => [
  {
    id: 'cmd-text-segment',
    type: 'text-segment',
    label: t('commandToolbar.textSegment'),
    icon: 'TextFields',
    description: t('commandToolbar.textSegmentDesc'),
  },
  {
    id: 'cmd-divider',
    type: 'divider',
    label: t('commandToolbar.pause'),
    icon: 'HorizontalRule',
    description: t('commandToolbar.pauseDesc'),
  },
]

interface DraggableCommandItemProps {
  item: CommandItem
}

/**
 * Draggable Command Chip (Compact Style)
 */
function DraggableCommandItem({ item }: DraggableCommandItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { type: 'command', commandType: item.type },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
  }

  const Icon = item.type === 'text-segment' ? TextFieldsIcon : HorizontalRuleIcon

  return (
    <Tooltip title={item.description} arrow>
      <Chip
        ref={setNodeRef}
        icon={<Icon />}
        label={item.label}
        variant="outlined"
        color="default"
        {...listeners}
        {...attributes}
        sx={{
          ...style,
          minWidth: 140,
          '&:active': {
            cursor: 'grabbing',
          },
        }}
      />
    </Tooltip>
  )
}

interface CommandToolbarProps {
  className?: string
}

/**
 * Command Toolbar Component
 * Displays draggable items for quick segment creation
 */
export default function CommandToolbar({ className }: CommandToolbarProps) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({
    id: 'command-toolbar-cancel-zone',
  })

  const commandItems = getCommandItems(t)

  return (
    <Paper
      ref={setNodeRef}
      elevation={0}
      className={className}
      sx={{
        mb: 1,
        borderLeft: 3,
        borderColor: isOver ? 'primary.main' : 'action.selected',
        transition: 'all 0.2s ease',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          py: 1.5,
          px: 2,
          gap: 2,
          bgcolor: isOver ? 'action.hover' : 'background.paper',
          transition: 'background-color 0.2s ease',
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 200, color: 'text.secondary', minWidth: 120 }}>
          {t('commandToolbar.title')}:
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {commandItems.map((item) => (
            <DraggableCommandItem key={item.id} item={item} />
          ))}
        </Box>
      </Box>
    </Paper>
  )
}
