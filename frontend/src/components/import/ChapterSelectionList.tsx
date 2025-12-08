/**
 * ChapterSelectionList - Chapter Selection and Renaming for Merge Mode
 *
 * Displays chapters from markdown preview with selection and rename capabilities.
 * Only shown when import mode is 'merge'.
 */

import React, { memo, useCallback, useMemo } from 'react'
import {
  Box,
  Typography,
  List,
  ListItem,
  Checkbox,
  TextField,
  Button,
  Stack,
} from '@mui/material'
import {
  CheckBoxOutlineBlank as UncheckedIcon,
  CheckBox as CheckedIcon,
  Description as ChapterIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { ChapterPreview } from '../../types/import'

// Separate memoized component for individual chapter items
interface ChapterListItemProps {
  chapter: ChapterPreview
  index: number
  isSelected: boolean
  isLastItem: boolean
  renamedTitle: string | undefined
  onToggle: (chapterId: string) => void
  onRenameChange: (chapterId: string, newValue: string) => void
}

const ChapterListItem = memo<ChapterListItemProps>(({
  chapter,
  index,
  isSelected,
  isLastItem,
  renamedTitle,
  onToggle,
  onRenameChange,
}) => {
  const { t } = useTranslation()
  const displayTitle = renamedTitle !== undefined ? renamedTitle : chapter.title

  const handleToggle = useCallback(() => {
    onToggle(chapter.id)
  }, [chapter.id, onToggle])

  const handleRename = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onRenameChange(chapter.id, e.target.value)
  }, [chapter.id, onRenameChange])

  return (
    <ListItem
      data-testid={`chapter-item-${chapter.id}`}
      sx={{
        py: 2,
        px: 2,
        borderBottom: !isLastItem ? 1 : 0,
        borderColor: 'divider',
        bgcolor: isSelected ? 'action.hover' : 'transparent',
        transition: 'background-color 0.2s',
        '&:hover': {
          bgcolor: isSelected ? 'action.selected' : 'action.hover',
        },
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2,
      }}
    >
      {/* Checkbox */}
      <Box sx={{ pt: 1 }}>
        <Checkbox
          checked={isSelected}
          onChange={handleToggle}
          icon={<UncheckedIcon />}
          checkedIcon={<CheckedIcon />}
          data-testid={`chapter-checkbox-${chapter.id}`}
        />
      </Box>

      {/* Chapter info */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Chapter number and icon */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <ChapterIcon fontSize="small" color="action" />
          <Typography
            variant="caption"
            sx={{
              bgcolor: 'action.selected',
              px: 1,
              py: 0.25,
              borderRadius: 1,
              fontWeight: 'medium',
            }}
          >
            #{index + 1}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {chapter.originalTitle}
          </Typography>
        </Box>

        {/* Rename text field */}
        <TextField
          fullWidth
          size="small"
          variant="outlined"
          value={displayTitle}
          onChange={handleRename}
          placeholder={t('import.chapters.rename')}
          disabled={!isSelected}
          data-testid={`chapter-rename-${chapter.id}`}
          sx={{
            '& .MuiInputBase-input': {
              fontWeight: 500,
            },
          }}
        />
      </Box>
    </ListItem>
  )
}, (prevProps, nextProps) => {
  return prevProps.chapter.id === nextProps.chapter.id &&
         prevProps.isSelected === nextProps.isSelected &&
         prevProps.renamedTitle === nextProps.renamedTitle &&
         prevProps.isLastItem === nextProps.isLastItem
})

ChapterListItem.displayName = 'ChapterListItem'

interface ChapterSelectionListProps {
  /** Chapters from preview data */
  chapters: ChapterPreview[]

  /** Set of selected chapter IDs */
  selectedChapters: Set<string>

  /** Callback when selection changes */
  onSelectionChange: (selected: Set<string>) => void

  /** Map of chapter IDs to renamed titles */
  renamedChapters: Map<string, string>

  /** Callback when chapter is renamed */
  onRenameChange: (chapterId: string, newTitle: string) => void
}

const ChapterSelectionList = memo<ChapterSelectionListProps>(({
  chapters,
  selectedChapters,
  onSelectionChange,
  renamedChapters,
  onRenameChange,
}) => {
  const { t } = useTranslation()

  const handleSelectAll = useCallback(() => {
    const allIds = new Set(chapters.map((ch) => ch.id))
    onSelectionChange(allIds)
  }, [chapters, onSelectionChange])

  const handleDeselectAll = useCallback(() => {
    onSelectionChange(new Set())
  }, [onSelectionChange])

  const handleToggleChapter = useCallback(
    (chapterId: string) => {
      const newSelected = new Set(selectedChapters)
      if (newSelected.has(chapterId)) {
        newSelected.delete(chapterId)
      } else {
        newSelected.add(chapterId)
      }
      onSelectionChange(newSelected)
    },
    [selectedChapters, onSelectionChange]
  )

  const handleRenameChange = useCallback(
    (chapterId: string, newValue: string) => {
      onRenameChange(chapterId, newValue)
    },
    [onRenameChange]
  )

  // Calculate selection stats
  const selectedCount = selectedChapters.size
  const totalCount = chapters.length
  const allSelected = selectedCount === totalCount
  const noneSelected = selectedCount === 0

  return (
    <Box data-testid="chapter-selection-list">
      {/* Header with Select All/Deselect All buttons */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
        }}
      >
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontWeight: 500 }}
        >
          {t('import.chapters.selected', {
            count: selectedCount,
            total: totalCount,
          })}
        </Typography>

        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            onClick={handleSelectAll}
            disabled={allSelected}
          >
            {t('import.chapters.selectAll')}
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={handleDeselectAll}
            disabled={noneSelected}
          >
            {t('import.chapters.deselectAll')}
          </Button>
        </Stack>
      </Box>

      {/* Helper text */}
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: 2, fontStyle: 'italic' }}
      >
        {t('import.chapters.help')}
      </Typography>

      {/* Chapter list */}
      <List
        disablePadding
        sx={{
          width: '100%',
          bgcolor: 'background.paper',
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
        }}
      >
        {chapters.map((chapter, index) => (
          <ChapterListItem
            key={chapter.id}
            chapter={chapter}
            index={index}
            isSelected={selectedChapters.has(chapter.id)}
            isLastItem={index >= chapters.length - 1}
            renamedTitle={renamedChapters.get(chapter.id)}
            onToggle={handleToggleChapter}
            onRenameChange={handleRenameChange}
          />
        ))}
      </List>

      {/* Empty state */}
      {chapters.length === 0 && (
        <Box
          sx={{
            textAlign: 'center',
            py: 4,
            color: 'text.secondary',
          }}
        >
          <ChapterIcon sx={{ fontSize: 48, mb: 1, opacity: 0.5 }} />
          <Typography variant="body2">
            {t('import.chapters.noChapters')}
          </Typography>
        </Box>
      )}
    </Box>
  )
})

ChapterSelectionList.displayName = 'ChapterSelectionList'

export default ChapterSelectionList
