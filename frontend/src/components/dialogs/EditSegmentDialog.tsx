import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography,
  Box,
  Alert,
} from '@mui/material';
import { Edit } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';
import { useSegmentLimits } from '../../hooks/useSettings';
import { logger } from '../../utils/logger';

interface Segment {
  id: string;
  text: string;
  ttsEngine?: string;
  language?: string;
}

interface EditSegmentDialogProps {
  open: boolean;
  segment: Segment | null;
  onClose: () => void;
  onSave: (segmentId: string, newText: string) => Promise<void>;
}

// Fallback limit if API call fails or while loading
const DEFAULT_MAX_LENGTH = 250;

export const EditSegmentDialog: React.FC<EditSegmentDialogProps> = ({
  open,
  segment,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  // Get current engine from app store as fallback
  const currentEngine = useAppStore((state) => state.getCurrentTtsEngine());

  // Fetch segment limits based on segment's engine (use currentEngine as fallback)
  const segmentEngine = segment?.ttsEngine || currentEngine;
  const { data: limits } = useSegmentLimits(segmentEngine);

  // Also fetch limits for current engine (for comparison)
  const { data: currentEngineLimits } = useSegmentLimits(currentEngine);

  // Use effective limit from API or fallback to default
  const maxSegmentLength = limits?.effectiveLimit || DEFAULT_MAX_LENGTH;

  // Determine if limit comes from user preference or engine maximum
  const limitSource = limits
    ? limits.effectiveLimit === limits.userPreference
      ? 'userPreference'
      : 'engineMaximum'
    : null;

  // Show warning if segment uses different engine with different limits
  const showEngineWarning =
    segmentEngine !== currentEngine && // Different engines
    limits && currentEngineLimits && // Both limits loaded
    limits.engineMaximum !== currentEngineLimits.engineMaximum && // Different engine limits
    limits.userPreference >= Math.max(limits.engineMaximum, currentEngineLimits.engineMaximum); // User pref not limiting

  // Update text when segment changes
  useEffect(() => {
    if (segment) {
      setText(segment.text);
    }
  }, [segment]);

  // Log limit information for debugging
  useEffect(() => {
    if (limits && import.meta.env.DEV) {
      logger.group(
        '📏 Segment Limits',
        'Effective segment length limits',
        {
          'Segment Engine': segmentEngine,
          'User Preference': limits.userPreference,
          'Engine Maximum': limits.engineMaximum,
          'Effective Limit': limits.effectiveLimit,
          'Limit Source': limitSource || 'unknown'
        },
        '#9C27B0'
      );
    }
  }, [limits, segmentEngine, limitSource]);

  const handleSave = async () => {
    if (!segment || !text.trim()) return;

    setSaving(true);
    try {
      await onSave(segment.id, text.trim());
      onClose();
    } catch (err) {
      logger.error('[EditSegmentDialog] Failed to update segment:', err);
      alert(t('segments.messages.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (segment) {
      setText(segment.text); // Reset to original text
    }
    onClose();
  };

  const isTextValid = text.trim().length > 0 && text.trim().length <= maxSegmentLength;
  const remainingChars = maxSegmentLength - text.length;
  const isOverLimit = text.length > maxSegmentLength;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Edit />
          {t('segments.editText')}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('segments.description', { maxLength: maxSegmentLength })}
          </Typography>

          {/* Warning when segment uses different engine with different limits */}
          {showEngineWarning && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="body2">
                {t('segments.engineLimitWarning', {
                  segmentEngine,
                  segmentLimit: limits?.engineMaximum,
                  currentEngine,
                  currentLimit: currentEngineLimits?.engineMaximum
                })}
              </Typography>
            </Alert>
          )}

          <TextField
            label={t('segments.segmentText')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            fullWidth
            multiline
            rows={6}
            placeholder={t('segments.placeholder')}
            error={!isTextValid}
            helperText={
              isOverLimit
                ? t('segments.textTooLong', { count: -remainingChars })
                : text.trim().length === 0
                ? t('segments.textEmpty')
                : (() => {
                    // Build helper text with limit source
                    const baseText = `${text.length}/${maxSegmentLength} ${t('segments.characters')}`;
                    const sourceText = limitSource === 'userPreference'
                      ? ` (${t('segments.limitSource.userPreference')})`
                      : limitSource === 'engineMaximum'
                      ? ` (${t('segments.limitSource.engineMaximum')})`
                      : '';
                    return baseText + sourceText;
                  })()
            }
            sx={{ mt: 2 }}
            inputProps={{
              maxLength: maxSegmentLength + 50, // Allow typing over limit to show error
            }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!isTextValid || saving}
        >
          {saving ? t('common.saving') : t('segments.messages.saveChanges')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
