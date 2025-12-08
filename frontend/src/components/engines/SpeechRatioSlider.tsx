/**
 * SpeechRatioSlider - Visual slider for speech/silence ratio thresholds
 *
 * Displays a color-coded bar (error-warning-ideal-warning-error) with
 * dual sliders for configuring speech ratio thresholds:
 * - Ideal range (green): speech_ratio_ideal_min to speech_ratio_ideal_max
 * - Warning range (yellow): speech_ratio_warning_min to speech_ratio_warning_max
 * - Error range (red): below warning_min or above warning_max
 *
 * Non-linear scale: 0-60% takes only 1/5 (20%) of visual space,
 * 60-100% takes 4/5 (80%) - gives more precision in the important range.
 */

import React, { memo } from 'react'
import { Box, Slider, Typography, Paper } from '@mui/material'
import { useTranslation } from 'react-i18next'

export interface SpeechRatioValues {
  speech_ratio_ideal_min: number
  speech_ratio_ideal_max: number
  speech_ratio_warning_min: number
  speech_ratio_warning_max: number
}

interface SpeechRatioSliderProps {
  values: SpeechRatioValues
  onChange: (key: keyof SpeechRatioValues, value: number) => void
  disabled?: boolean
}

// Non-linear scale: 0-60% takes 1/5 (20%) of visual space, 60-100% takes 4/5 (80%)
const BREAKPOINT = 0.6 // 60%
const VISUAL_BREAKPOINT = 0.2 // 20% of visual space

// Transform actual value (0-1) to visual position (0-1)
const toVisual = (value: number): number => {
  if (value <= BREAKPOINT) {
    return value * (VISUAL_BREAKPOINT / BREAKPOINT) // 0-0.6 → 0-0.2
  }
  return VISUAL_BREAKPOINT + (value - BREAKPOINT) * ((1 - VISUAL_BREAKPOINT) / (1 - BREAKPOINT)) // 0.6-1.0 → 0.2-1.0
}

// Transform visual position (0-1) to actual value (0-1)
const fromVisual = (visual: number): number => {
  if (visual <= VISUAL_BREAKPOINT) {
    return visual * (BREAKPOINT / VISUAL_BREAKPOINT) // 0-0.2 → 0-0.6
  }
  return BREAKPOINT + (visual - VISUAL_BREAKPOINT) * ((1 - BREAKPOINT) / (1 - VISUAL_BREAKPOINT)) // 0.2-1.0 → 0.6-1.0
}

const SpeechRatioSlider = memo(({ values, onChange, disabled = false }: SpeechRatioSliderProps) => {
  const { t } = useTranslation()

  // Convert to 0-1 scale
  const warningMin = values.speech_ratio_warning_min / 100
  const idealMin = values.speech_ratio_ideal_min / 100
  const idealMax = values.speech_ratio_ideal_max / 100
  const warningMax = values.speech_ratio_warning_max / 100

  // Convert to visual positions (non-linear)
  const warningMinVisual = toVisual(warningMin)
  const idealMinVisual = toVisual(idealMin)
  const idealMaxVisual = toVisual(idealMax)
  const warningMaxVisual = toVisual(warningMax)

  // Handle warning range slider change (visual → actual)
  const handleWarningChange = (_: Event, newValue: number | number[]) => {
    const [minVisual, maxVisual] = newValue as number[]
    let min = fromVisual(minVisual)
    let max = fromVisual(maxVisual)

    // Ensure warning range doesn't overlap with ideal range
    if (min >= idealMin) min = Math.max(0, idealMin - 0.01)
    if (max <= idealMax) max = Math.min(1.0, idealMax + 0.01)

    onChange('speech_ratio_warning_min', Math.round(min * 100))
    onChange('speech_ratio_warning_max', Math.round(max * 100))
  }

  // Handle ideal range slider change (visual → actual)
  const handleIdealChange = (_: Event, newValue: number | number[]) => {
    const [minVisual, maxVisual] = newValue as number[]
    const min = fromVisual(minVisual)
    const max = fromVisual(maxVisual)

    onChange('speech_ratio_ideal_min', Math.round(min * 100))
    onChange('speech_ratio_ideal_max', Math.round(max * 100))

    // Auto-adjust warning range if needed
    if (min <= warningMin) {
      onChange('speech_ratio_warning_min', Math.round(Math.max(0, min - 0.01) * 100))
    }
    if (max >= warningMax) {
      onChange('speech_ratio_warning_max', Math.round(Math.min(1.0, max + 0.01) * 100))
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <Typography variant="caption" color="text.secondary" fontWeight="medium" sx={{ mb: 1, display: 'block' }}>
        {t('settings.audio.speechRatioSection')}
      </Typography>

      {/* Color Bar (uses visual positions for non-linear display) */}
      <Box display="flex" height={50} borderRadius={1} overflow="hidden" position="relative">
        {/* Error zone (left) */}
        <Box flex={warningMinVisual} bgcolor="error.light" display="flex" alignItems="center" justifyContent="center">
          <Typography variant="caption" fontWeight={600} color="error.dark">X</Typography>
        </Box>
        {/* Warning zone (left) */}
        <Box flex={idealMinVisual - warningMinVisual} bgcolor="warning.light" display="flex" alignItems="center" justifyContent="center">
          <Typography variant="caption" fontWeight={600} color="warning.dark">!</Typography>
        </Box>
        {/* Ideal zone (center) */}
        <Box flex={idealMaxVisual - idealMinVisual} bgcolor="success.light" display="flex" alignItems="center" justifyContent="center">
          <Typography variant="caption" fontWeight={600} color="success.dark">OK</Typography>
        </Box>
        {/* Warning zone (right) */}
        <Box flex={warningMaxVisual - idealMaxVisual} bgcolor="warning.light" display="flex" alignItems="center" justifyContent="center">
          <Typography variant="caption" fontWeight={600} color="warning.dark">!</Typography>
        </Box>
        {/* Error zone (right) */}
        <Box flex={1 - warningMaxVisual} bgcolor="error.light" display="flex" alignItems="center" justifyContent="center">
          <Typography variant="caption" fontWeight={600} color="error.dark">X</Typography>
        </Box>

        {/* Warning Range Slider (uses visual positions) */}
        <Box position="absolute" top="-6px" left={0} right={0}>
          <Slider
            value={[warningMinVisual, warningMaxVisual]}
            onChange={handleWarningChange}
            min={0}
            max={1.0}
            step={0.005}
            sx={{
              padding: '0 !important',
              '& .MuiSlider-rail': { display: 'none' },
              '& .MuiSlider-track': { display: 'none' },
              '& .MuiSlider-thumb': {
                width: 16,
                height: 16,
                bgcolor: 'warning.main',
                border: '2px solid white',
              },
            }}
            disableSwap
          />
        </Box>

        {/* Ideal Range Slider (uses visual positions) */}
        <Box position="absolute" bottom="1px" left={0} right={0}>
          <Slider
            value={[idealMinVisual, idealMaxVisual]}
            onChange={handleIdealChange}
            min={0}
            max={1.0}
            step={0.005}
            sx={{
              padding: '0 !important',
              '& .MuiSlider-rail': { display: 'none' },
              '& .MuiSlider-track': { display: 'none' },
              '& .MuiSlider-thumb': {
                width: 16,
                height: 16,
                bgcolor: 'success.main',
                border: '2px solid white',
              },
            }}
            disableSwap
          />
        </Box>
      </Box>

      {/* Percentage Labels (position is visual, displayed value is actual) */}
      <Box position="relative" height={16} mt={0.25}>
        <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', left: '0%' }}>
          0%
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', left: `${warningMinVisual * 100}%`, transform: 'translateX(-50%)' }}>
          {Math.round(warningMin * 100)}%
        </Typography>
        <Typography variant="caption" color="success.main" fontWeight={600} sx={{ position: 'absolute', left: `${idealMinVisual * 100}%`, transform: 'translateX(-50%)' }}>
          {Math.round(idealMin * 100)}%
        </Typography>
        <Typography variant="caption" color="success.main" fontWeight={600} sx={{ position: 'absolute', left: `${idealMaxVisual * 100}%`, transform: 'translateX(-50%)' }}>
          {Math.round(idealMax * 100)}%
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', left: `${warningMaxVisual * 100}%`, transform: 'translateX(-50%)' }}>
          {Math.round(warningMax * 100)}%
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', right: 0 }}>
          100%
        </Typography>
      </Box>
    </Paper>
  )
})

SpeechRatioSlider.displayName = 'SpeechRatioSlider'

export default SpeechRatioSlider

/**
 * Helper function to check if a parameter schema contains speechRatio parameters
 */
export function hasSpeechRatioParams(schema: Record<string, any>): boolean {
  const requiredKeys = [
    'speech_ratio_ideal_min',
    'speech_ratio_ideal_max',
    'speech_ratio_warning_min',
    'speech_ratio_warning_max'
  ]
  return requiredKeys.every(key => key in schema)
}

/**
 * Extract speechRatio values from parameters
 */
export function extractSpeechRatioValues(params: Record<string, any>, schema: Record<string, any>): SpeechRatioValues {
  return {
    speech_ratio_ideal_min: params.speech_ratio_ideal_min ?? schema.speech_ratio_ideal_min?.default ?? 75,
    speech_ratio_ideal_max: params.speech_ratio_ideal_max ?? schema.speech_ratio_ideal_max?.default ?? 90,
    speech_ratio_warning_min: params.speech_ratio_warning_min ?? schema.speech_ratio_warning_min?.default ?? 65,
    speech_ratio_warning_max: params.speech_ratio_warning_max ?? schema.speech_ratio_warning_max?.default ?? 93,
  }
}
