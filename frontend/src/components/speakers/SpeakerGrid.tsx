/**
 * SpeakerGrid - Responsive Grid Layout for Speaker Cards
 *
 * Displays speakers in a responsive grid:
 * - Desktop: 3 columns
 * - Tablet: 2 columns
 * - Mobile: 1 column
 */

import React, { memo } from 'react'
import { Grid } from '@mui/material'
import SpeakerCard from './SpeakerCard'
import type { Speaker } from '@types'

interface SpeakerGridProps {
  speakers: Speaker[]
  defaultSpeakerId?: string | null
  onEdit: (speaker: Speaker) => void
  onPreview?: (speaker: Speaker) => void
  onMenuClick?: (event: React.MouseEvent<HTMLElement>, speaker: Speaker) => void
}

const SpeakerGrid = memo(({
  speakers,
  defaultSpeakerId,
  onEdit,
  onPreview,
  onMenuClick
}: SpeakerGridProps) => {
  return (
    <Grid container spacing={3}>
      {speakers.map((speaker) => (
        <Grid
          key={speaker.id}
          size={{
            xs: 12,   // 1 column on mobile
            sm: 12,   // 1 column on tablet
            md: 6,    // 2 columns on desktop
            lg: 4,    // 3 columns on large desktop
            xl: 3     // 4 columns on extra large screens
          }}
        >
          <SpeakerCard
            speaker={speaker}
            isDefault={speaker.id === defaultSpeakerId}
            onEdit={onEdit}
            onPreview={onPreview}
            onMenuClick={onMenuClick}
          />
        </Grid>
      ))}
    </Grid>
  )
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return (
    prevProps.speakers === nextProps.speakers &&
    prevProps.defaultSpeakerId === nextProps.defaultSpeakerId &&
    prevProps.onEdit === nextProps.onEdit &&
    prevProps.onPreview === nextProps.onPreview &&
    prevProps.onMenuClick === nextProps.onMenuClick
  )
})

SpeakerGrid.displayName = 'SpeakerGrid'

export default SpeakerGrid
