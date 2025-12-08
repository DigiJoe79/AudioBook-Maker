import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography,
  Box,
  IconButton,
  Chip,
  Tooltip,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import {
  Edit as EditIcon,
  Close as CloseIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Refresh as RefreshIcon,
  AudioFile as AudioIcon,
  NavigateBefore as NavigateBeforeIcon,
  NavigateNext as NavigateNextIcon,
  Save as SaveIcon,
  Delete as DeleteIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { useQueryClient } from '@tanstack/react-query';
import { useError } from '@hooks/useError';
import { useSnackbar } from '@hooks/useSnackbar';
import { useAppStore } from '@store/appStore';
import { useSegmentLimits } from '@hooks/useSettings';
import {
  usePronunciationRulesForContext,
  useCreatePronunciationRule,
  useUpdatePronunciationRule,
  useDeletePronunciationRule,
} from '@hooks/usePronunciationQuery';
import { useGenerateSegment } from '@hooks/useTTSQuery';
import { useProject } from '@hooks/useProjectsQuery';
import { useChapter } from '@hooks/useChaptersQuery';
import { useSSEConnection } from '@contexts/SSEContext';
import { queryKeys } from '@services/queryKeys';
import type { PronunciationRule, PronunciationRuleCreate, PronunciationRuleUpdate, Chapter } from '@types';
import { logger } from '@utils/logger';
import { getAudioUrl } from '@utils/audioUrl';
import { escapeHtml, sanitizeAttribute } from '@utils/htmlSanitizer';

// Utility: Escape regex special characters
const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Check if a rule matches in the given text
const ruleMatchesInText = (text: string, rule: PronunciationRule): boolean => {
  // Safe: Using escapeRegex() to escape all regex special characters, treating pattern as literal string
  const regex = new RegExp(escapeRegex(rule.pattern), 'g'); // nosemgrep
  return regex.test(text);
};

// Apply pronunciation rule underlines to text
const applyRuleUnderlines = (text: string, rules: PronunciationRule[]): string => {
  // SECURITY: Escape HTML to prevent XSS before adding formatting
  let html = escapeHtml(text);

  // Sort rules by pattern length (longest first) to handle overlapping patterns correctly
  const sortedRules = [...rules].sort((a, b) => b.pattern.length - a.pattern.length);

  sortedRules.forEach((rule) => {
    // SECURITY: Escape regex pattern and sanitize attributes
    // Safe: Using escapeRegex() to escape all regex special characters, treating pattern as literal string
    const regex = new RegExp(escapeRegex(escapeHtml(rule.pattern)), 'g'); // nosemgrep
    html = html.replace(regex, (match) => {
      // Add title attribute for native tooltip showing transformation
      const scopeLabel = rule.scope === 'project_engine' ? 'Projekt+Engine' : 'Engine';
      const tooltip = sanitizeAttribute(`"${rule.pattern}" → "${rule.replacement}" (${scopeLabel})`);
      const ruleId = sanitizeAttribute(rule.id);
      return `<span class="rule-underline" data-rule-id="${ruleId}" title="${tooltip}" style="text-decoration: underline; text-decoration-style: dotted; text-decoration-color: #90caf9; text-decoration-thickness: 2px; text-underline-offset: 3px; cursor: pointer; transition: all 200ms ease;">${match}</span>`;
    });
  });

  return html;
};

interface Segment {
  id: string;
  text: string;
  ttsEngine?: string;
  language?: string;
  chapterId?: string;
  audioPath?: string | null;
  updatedAt?: string | Date;
}

interface EditSegmentDialogProps {
  open: boolean;
  segment: Segment | null;
  onClose: () => void;
  onSave: (segmentId: string, newText: string) => Promise<void>;
  onSegmentChange?: (segmentId: string) => void; // For prev/next navigation
  projectId?: string;
}

const DEFAULT_MAX_LENGTH = 250;

export const EditSegmentDialog: React.FC<EditSegmentDialogProps> = ({
  open,
  segment,
  onClose,
  onSave,
  onSegmentChange,
  projectId,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { showError, ErrorDialog } = useError();
  const { showSnackbar, SnackbarComponent } = useSnackbar();

  // Local State
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PronunciationRule | null>(null);
  const [isNewRule, setIsNewRule] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Form state for rule editing
  const [rulePattern, setRulePattern] = useState('');
  const [ruleReplacement, setRuleReplacement] = useState('');
  const [isProjectRule, setIsProjectRule] = useState(false); // Default: Engine rule

  // Refs for ContentEditable
  const editorRef = useRef<HTMLDivElement>(null);
  const cursorPositionRef = useRef<number>(0);
  const updateTimeoutRef = useRef<number | null>(null);
  const originalTextRef = useRef<string>(''); // Track original text for comparison
  const audioRef = useRef<HTMLAudioElement | null>(null); // Audio element for playback control

  // Ref for tracking original rule values (to detect changes)
  const originalRuleRef = useRef<{
    pattern: string;
    replacement: string;
    scope: 'engine' | 'project_engine';
  } | null>(null);

  // Get default engine and backend URL
  const defaultEngine = useAppStore((state) => state.getDefaultTtsEngine());
  const backendUrl = useAppStore((state) => state.connection.url);
  const segmentEngine = segment?.ttsEngine || defaultEngine;

  // Fetch data
  const { data: limits } = useSegmentLimits(segmentEngine);
  const { data: rulesData } = usePronunciationRulesForContext(
    segmentEngine,
    segment?.language || 'en',
    projectId
  );
  const { data: project } = useProject(projectId || '');
  const { data: chapter } = useChapter(segment?.chapterId);

  const rules = rulesData?.rules || [];
  const maxSegmentLength = limits?.effectiveLimit || DEFAULT_MAX_LENGTH;

  // Segment navigation
  const segments = chapter?.segments || [];
  const currentIndex = segments.findIndex(s => s.id === segment?.id);
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < segments.length - 1;

  // Filter rules: Only show rules that actually match in current text
  const relevantRules = useMemo(() => {
    return rules.filter(rule => ruleMatchesInText(text, rule));
  }, [rules, text]);

  // Check if text has been modified (compare with original, not segment.text to avoid race conditions)
  const isTextModified = useMemo(() => {
    return text.trim() !== originalTextRef.current.trim();
  }, [text]);

  // Check if rule has been modified (for smart panel buttons)
  const isRuleModified = useMemo(() => {
    if (!originalRuleRef.current) return false; // New rule or no edit in progress

    const currentScope = isProjectRule ? 'project_engine' : 'engine';

    return (
      rulePattern !== originalRuleRef.current.pattern ||
      ruleReplacement !== originalRuleRef.current.replacement ||
      currentScope !== originalRuleRef.current.scope
    );
  }, [rulePattern, ruleReplacement, isProjectRule]);

  // Mutations
  const createRuleMutation = useCreatePronunciationRule();
  const updateRuleMutation = useUpdatePronunciationRule();
  const deleteRuleMutation = useDeletePronunciationRule();
  const generateSegmentMutation = useGenerateSegment();

  // SSE and Query Client for audio preview
  const { subscribe } = useSSEConnection();
  const queryClient = useQueryClient();
  const regeneratingSegmentIdRef = useRef<string | null>(null);

  // Update text when segment changes (reset all editing state)
  useEffect(() => {
    if (segment?.text) {
      setText(segment.text);
      originalTextRef.current = segment.text; // Store original for comparison
      // Reset panel state when switching segments
      setPanelOpen(false);
      setEditingRule(null);
      setIsNewRule(false);
      // Stop audio playback when switching segments
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
        setIsPlaying(false);
      }
    }
  }, [segment]);

  // Initialize editor with text ONLY when dialog opens or segment changes (prevents cursor jumping)
  useLayoutEffect(() => {
    // Guard: Only initialize if dialog is open AND we have data
    if (!open || !segment?.text) {
      return;
    }

    if (editorRef.current) {
      const html = applyRuleUnderlines(segment.text, rules);
      // Safe: HTML-escaped via applyRuleUnderlines() which calls escapeHtml()
      editorRef.current.innerHTML = html || escapeHtml(segment.text); // nosemgrep
    } else {
      // Retry after a tick (React may not have rendered the ref yet)
      setTimeout(() => {
        if (editorRef.current && segment?.text) {
          const html = applyRuleUnderlines(segment.text, rules);
          // Safe: HTML-escaped via applyRuleUnderlines() which calls escapeHtml()
          editorRef.current.innerHTML = html || escapeHtml(segment.text); // nosemgrep
        }
      }, 0);
    }
  }, [open, segment, rules]); // Re-run when dialog opens, segment changes, or rules change

  // Character validation
  const charCount = text.length;
  const isOverLimit = charCount > maxSegmentLength;
  const isNearLimit = charCount > maxSegmentLength * 0.8;
  const isTextValid = text.trim().length > 0 && !isOverLimit;

  // Handle main dialog save
  const handleSave = async () => {
    if (!segment || !isTextValid) return;

    setSaving(true);
    try {
      await onSave(segment.id, text.trim());
      onClose();
    } catch (err) {
      logger.error('[EditSegmentDialog] Failed to save segment:', err);
      await showError(t('segments.edit'), t('segments.messages.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    // Text will be reset when dialog opens again (see useEffect Line 202-210)
    setPanelOpen(false);

    // Stop audio playback when dialog closes
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
    }

    // Reset regenerating state if dialog closed during regeneration
    if (regeneratingSegmentIdRef.current) {
      logger.info('[EditSegmentDialog] Dialog closed during regeneration, resetting state');
      setIsRegenerating(false);
      regeneratingSegmentIdRef.current = null;
    }

    onClose();
  };

  // Segment Navigation
  const handlePreviousSegment = () => {
    if (!hasPrevious || !onSegmentChange) return;
    const previousSegment = segments[currentIndex - 1];
    if (previousSegment) {
      onSegmentChange(previousSegment.id);
    }
  };

  const handleNextSegment = () => {
    if (!hasNext || !onSegmentChange) return;
    const nextSegment = segments[currentIndex + 1];
    if (nextSegment) {
      onSegmentChange(nextSegment.id);
    }
  };

  // ContentEditable handlers
  const saveCursorPosition = () => {
    if (!editorRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(editorRef.current);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    cursorPositionRef.current = preCaretRange.toString().length;
  };

  const restoreCursorPosition = () => {
    if (!editorRef.current) return;

    const selection = window.getSelection();
    if (!selection) return;

    const textNodes: Node[] = [];
    const walker = document.createTreeWalker(
      editorRef.current,
      NodeFilter.SHOW_TEXT,
      null
    );

    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    let charCount = 0;
    for (const textNode of textNodes) {
      const nodeLength = textNode.textContent?.length || 0;
      if (charCount + nodeLength >= cursorPositionRef.current) {
        const offset = cursorPositionRef.current - charCount;
        const range = document.createRange();
        range.setStart(textNode, Math.min(offset, nodeLength));
        range.setEnd(textNode, Math.min(offset, nodeLength));
        selection.removeAllRanges();
        selection.addRange(range);
        break;
      }
      charCount += nodeLength;
    }
  };

  const handleEditorInput = () => {
    if (!editorRef.current) return;

    saveCursorPosition();
    const newText = editorRef.current.textContent || '';
    setText(newText);

    // Debounced underline update (500ms like mockup)
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    updateTimeoutRef.current = window.setTimeout(() => {
      if (editorRef.current) {
        const html = applyRuleUnderlines(newText, rules);
        if (editorRef.current.innerHTML !== html) {
          // Safe: HTML-escaped via applyRuleUnderlines() which calls escapeHtml()
          editorRef.current.innerHTML = html; // nosemgrep
          restoreCursorPosition();
        }
      }
    }, 500);
  };

  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Check if clicked on underlined word
    if (target.classList.contains('rule-underline')) {
      const ruleId = target.dataset.ruleId;
      if (ruleId) {
        const rule = rules.find((r) => r.id === ruleId);
        if (rule) {
          handleOpenPanel(rule);
        }
      }
    }
  };

  const handleEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    // Prevent default paste behavior (which might paste HTML markup)
    e.preventDefault();

    // Extract plain text from clipboard
    const plainText = e.clipboardData.getData('text/plain');

    if (!plainText) return;

    // Insert plain text at cursor position
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(plainText));

    // Move cursor to end of inserted text
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    // Trigger input handler to update state and apply formatting
    handleEditorInput();
  };

  // Apply underlines when rules change
  useEffect(() => {
    if (editorRef.current && text) {
      const html = applyRuleUnderlines(text, rules);
      // Safe: HTML-escaped via applyRuleUnderlines() which calls escapeHtml()
      editorRef.current.innerHTML = html; // nosemgrep
    }
  }, [rules]);

  // Panel handlers
  const handleOpenPanel = useCallback((rule?: PronunciationRule) => {
    if (rule) {
      // Edit existing rule
      setEditingRule(rule);
      setIsNewRule(false);
      setRulePattern(rule.pattern);
      setRuleReplacement(rule.replacement);
      setIsProjectRule(rule.scope === 'project_engine');

      // Store original values for change detection
      originalRuleRef.current = {
        pattern: rule.pattern,
        replacement: rule.replacement,
        scope: rule.scope,
      };
    } else {
      // New rule from selection
      const selection = window.getSelection()?.toString().trim();
      if (!selection) return;

      setEditingRule(null);
      setIsNewRule(true);
      setRulePattern(selection);
      setRuleReplacement('');
      setIsProjectRule(false); // Default: Engine rule

      // No original values for new rule
      originalRuleRef.current = null;
    }
    setPanelOpen(true);
  }, []);

  const handleClosePanel = useCallback(() => {
    setPanelOpen(false);

    // Reset panel state after animation completes (300ms grid transition)
    setTimeout(() => {
      setEditingRule(null);
      setIsNewRule(false);
      setRulePattern('');
      setRuleReplacement('');
      setIsProjectRule(false);
      originalRuleRef.current = null;
    }, 300);
  }, []);

  const handleSaveRule = async () => {
    if (!ruleReplacement.trim()) {
      await showError(t('pronunciation.edit'), 'Replacement text is required');
      return;
    }

    try {
      if (isNewRule) {
        // Create new rule
        const scope = isProjectRule ? 'project_engine' : 'engine';
        const newRule: PronunciationRuleCreate = {
          pattern: rulePattern,
          replacement: ruleReplacement,
          scope,
          engineName: segmentEngine,
          language: segment?.language || 'en',
          projectId: isProjectRule ? projectId : undefined,
          isActive: true,
        };
        await createRuleMutation.mutateAsync(newRule);
        showSnackbar(t('pronunciation.dialog.messages.created'), { severity: 'success' });
      } else if (editingRule) {
        // Update existing rule
        const scope = isProjectRule ? 'project_engine' : 'engine';
        const update: PronunciationRuleUpdate = {
          replacement: ruleReplacement,
          scope,
          projectId: isProjectRule ? projectId : undefined,
        };
        await updateRuleMutation.mutateAsync({ ruleId: editingRule.id, update });
        showSnackbar(t('pronunciation.dialog.messages.updated'), { severity: 'success' });
      }

      handleClosePanel();
    } catch (err) {
      logger.error('[EditSegmentDialog] Failed to save rule:', err);
      showSnackbar(
        isNewRule ? t('pronunciation.dialog.messages.createFailed') : t('pronunciation.dialog.messages.updateFailed'),
        { severity: 'error' }
      );
    }
  };

  const handleDeleteRule = async () => {
    if (!editingRule) return;

    try {
      await deleteRuleMutation.mutateAsync(editingRule.id);
      showSnackbar(t('pronunciation.dialog.messages.deleted'), { severity: 'success' });
      handleClosePanel();
    } catch (err) {
      logger.error('[EditSegmentDialog] Failed to delete rule:', err);
      showSnackbar(t('pronunciation.dialog.messages.deleteFailed'), { severity: 'error' });
    }
  };

  // Helper: Play audio (shared by Play button and Regenerate SSE event)
  const playAudio = useCallback((audioUrl: string) => {
    // Stop previous audio if exists
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.onended = () => {
      setIsPlaying(false);
      audioRef.current = null;
    };

    audio.onerror = (err) => {
      logger.error('[EditSegmentDialog] Audio playback error:', err);
      setIsPlaying(false);
      audioRef.current = null;
    };

    audio.play()
      .then(() => {
        setIsPlaying(true);
        logger.info('[EditSegmentDialog] Audio playback started');
      })
      .catch((err) => {
        logger.error('[EditSegmentDialog] Audio playback failed:', err);
        setIsPlaying(false);
        audioRef.current = null;
      });
  }, []);

  // Play/Pause current audio
  const handlePlayPause = () => {
    if (!segment?.audioPath) return;

    if (isPlaying && audioRef.current) {
      // Pause
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      // Play
      const audioUrl = getAudioUrl(segment.audioPath, backendUrl, segment.updatedAt);
      if (audioUrl) {
        playAudio(audioUrl);
      }
    }
  };

  // Regenerate segment audio
  const handleRegenerate = async () => {
    if (!segment) return;

    // Stop any playing audio
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      audioRef.current = null;
    }

    setIsRegenerating(true);
    try {
      // Create job for async segment regeneration
      await generateSegmentMutation.mutateAsync({
        segmentId: segment.id,
        chapterId: segment.chapterId || '',
      });

      // Store segment ID to wait for SSE event
      regeneratingSegmentIdRef.current = segment.id;

      logger.info('[EditSegmentDialog] Regeneration job created, waiting for SSE event...', {
        segmentId: segment.id
      });
    } catch (err) {
      logger.error('[EditSegmentDialog] Failed to create regeneration job:', err);
      await showError(t('segments.editDialog.regenerateError'), t('segments.editDialog.regenerateErrorMessage'));
      setIsRegenerating(false);
      regeneratingSegmentIdRef.current = null;
    }
  };

  // SSE Event Listener - Wait for segment.completed to play audio
  useEffect(() => {
    if (!open) {
      return; // Only subscribe when dialog is open
    }

    const unsubscribe = subscribe((event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const eventType = data.event || event.type;

        // Wait for segment.completed event for our regenerating segment
        if (eventType === 'segment.completed' && regeneratingSegmentIdRef.current === data.segmentId) {
          logger.info('[EditSegmentDialog] Segment completed - MATCH! Attempting playback', {
            segmentId: data.segmentId
          });

          // Get updated segment from React Query cache (already updated by useSSEEventHandlers)
          const chapterId = segment?.chapterId;

          if (chapterId) {
            const chapter = queryClient.getQueryData<Chapter>(queryKeys.chapters.detail(chapterId));
            const updatedSegment = chapter?.segments.find(s => s.id === data.segmentId);

            if (updatedSegment?.audioPath) {
              // Construct full audio URL from filename
              const audioUrl = getAudioUrl(
                updatedSegment.audioPath,
                backendUrl,
                updatedSegment.updatedAt
              );

              logger.info('[EditSegmentDialog] Auto-playing regenerated audio...', {
                audioPath: updatedSegment.audioPath,
                audioUrl,
                backendUrl
              });

              if (audioUrl) {
                // Use shared playAudio function (prevents parallel audio instances)
                playAudio(audioUrl);
              } else {
                logger.error('[EditSegmentDialog] Failed to construct audio URL', {
                  audioPath: updatedSegment.audioPath,
                  backendUrl
                });
              }
            } else {
              logger.warn('[EditSegmentDialog] Segment completed but no audioPath found', {
                segment: updatedSegment
              });
            }
          } else {
            logger.warn('[EditSegmentDialog] No chapterId available');
          }

          // Reset regenerating state
          setIsRegenerating(false);
          regeneratingSegmentIdRef.current = null;
        }

        // Handle segment.failed event
        if (eventType === 'segment.failed' && regeneratingSegmentIdRef.current === data.segmentId) {
          logger.error('[EditSegmentDialog] Segment generation failed', {
            segmentId: data.segmentId
          });
          showError(t('segments.editDialog.audioPreview'), t('segments.editDialog.regenerateErrorMessage'));
          setIsRegenerating(false);
          regeneratingSegmentIdRef.current = null;
        }
      } catch (err) {
        logger.error('[EditSegmentDialog] Failed to parse SSE event:', err);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [open, subscribe, segment, queryClient, showError, backendUrl, playAudio]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+R: Create new rule from selection
      if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        handleOpenPanel(); // Opens panel with selected text
      }

      // Escape: Close panel or dialog
      if (e.key === 'Escape') {
        if (panelOpen) {
          e.preventDefault();
          e.stopPropagation();
          handleClosePanel();
        }
        // Let MUI Dialog handle Escape for closing dialog when panel is closed
      }

      // Ctrl+Enter: Save dialog
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        if (!saving && isTextValid) {
          handleSave();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panelOpen, saving, isTextValid, handleSave, handleOpenPanel, handleClosePanel]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      disableAutoFocus
      disableRestoreFocus
      data-testid="edit-segment-dialog"
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
          maxWidth: '1000px',
        },
      }}
    >
      {/* DialogTitle */}
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <EditIcon />
          <Typography variant="h6">{t('segments.editText')}</Typography>
        </Box>
      </DialogTitle>

      {/* DialogContent with Grid Layout */}
      <DialogContent
        sx={{
          p: 0,
          bgcolor: 'background.paper',
          overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: panelOpen ? '1fr 400px' : '1fr 0fr',
          transition: `grid-template-columns ${theme.custom.transitions.slow} ${theme.custom.transitions.easing}`,
        }}
      >
        {/* Main Content (Left) */}
        <Box
          sx={{
            p: theme.custom.spacing.lg,
            overflowY: 'auto',
            borderRight: 1,
            borderColor: 'divider',
            bgcolor: 'background.default',
          }}
        >
          {/* Text Editor with Pronunciation Rule Underlines */}
          <Box sx={{ mb: theme.custom.spacing.lg }}>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mb: theme.custom.spacing.sm }}
            >
              {t('segments.segmentText')}
            </Typography>
            <Box
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={handleEditorInput}
              onClick={handleEditorClick}
              onPaste={handleEditorPaste}
              spellCheck={false}
              data-testid="edit-segment-text-editor"
              sx={{
                minHeight: 180,
                p: theme.custom.spacing.md,
                border: 1,
                borderColor: !isTextValid ? 'error.main' : 'divider',
                borderRadius: theme.custom.borderRadius.md,
                fontSize: '16px',
                lineHeight: 1.6,
                color: 'text.primary',
                bgcolor: 'background.default',
                outline: 'none',
                transition: `border-color ${theme.custom.transitions.duration} ${theme.custom.transitions.easing}`,
                '&:focus': {
                  borderColor: !isTextValid ? 'error.main' : 'primary.main',
                },
                '&[contenteditable]:empty:before': {
                  content: 'attr(data-placeholder)',
                  color: 'text.disabled',
                },
                // Hover effect on underlined words
                '& .rule-underline:hover': {
                  textDecorationStyle: 'solid !important',
                  textDecorationColor: '#1976d2 !important',
                  color: '#90caf9',
                },
              }}
              data-placeholder={t('segments.placeholder')}
            />
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mt: theme.custom.spacing.xs,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {t('segments.editDialog.createRuleHint')}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 500,
                  color: isOverLimit
                    ? 'error.main'
                    : isNearLimit
                    ? 'warning.main'
                    : 'text.secondary',
                }}
              >
                {charCount} / {maxSegmentLength}
              </Typography>
            </Box>
          </Box>

          {/* Audio Preview Placeholder - Phase 4 */}
          <Box
            sx={{
              mt: theme.custom.spacing.md,
              p: theme.custom.spacing.md,
              bgcolor: (theme) => theme.palette.mode === 'dark' ? '#2a2a2a' : '#f5f5f5',
              border: 1,
              borderColor: 'divider',
              borderRadius: theme.custom.borderRadius.md,
              display: 'flex',
              alignItems: 'center',
              gap: theme.custom.spacing.md,
            }}
          >
            <AudioIcon sx={{ fontSize: 24, color: 'primary.main' }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={500}>
                {t('segments.editDialog.audioPreview')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('segments.editDialog.audioPreviewHint')}
              </Typography>
            </Box>

            {/* Play/Pause Button */}
            <Button
              startIcon={isPlaying ? <PauseIcon /> : <PlayIcon />}
              onClick={handlePlayPause}
              disabled={!segment?.audioPath || isRegenerating}
            >
              {isPlaying ? t('segments.editDialog.pause') : t('segments.editDialog.play')}
            </Button>

            {/* Regenerate Button */}
            <Button
              variant="contained"
              color="warning"
              startIcon={<RefreshIcon />}
              onClick={handleRegenerate}
              disabled={isRegenerating || !text.trim() || generateSegmentMutation.isPending}
            >
              {isRegenerating || generateSegmentMutation.isPending
                ? t('segments.editDialog.regenerating')
                : t('segments.editDialog.regenerate')}
            </Button>
          </Box>

          {/* Active Rules Chips Placeholder - Phase 6 */}
          <Box
            sx={{
              mt: theme.custom.spacing.lg,
              pt: theme.custom.spacing.lg,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Typography
              variant="subtitle2"
              color="primary.light"
              sx={{ mb: theme.custom.spacing.sm }}
            >
              {t('segments.editDialog.activeRules')} ({relevantRules.length})
            </Typography>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: theme.custom.spacing.sm,
                minHeight: '48px', // Consistent height even with no rules
              }}
            >
              {relevantRules.map((rule) => (
                <Chip
                  key={rule.id}
                  label={`${rule.pattern} → ${rule.replacement}`}
                  onClick={() => handleOpenPanel(rule)}
                  sx={{
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? '#2a2a2a' : '#f5f5f5',
                    border: 1,
                    borderColor: 'divider',
                    '&:hover': {
                      borderColor: 'primary.main',
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? '#282828' : '#fafafa',
                    },
                  }}
                />
              ))}
              {relevantRules.length === 0 && (
                <Typography variant="caption" color="text.secondary">
                  {t('segments.editDialog.noActiveRules')}
                </Typography>
              )}
            </Box>
          </Box>
        </Box>

        {/* Slide-out Panel (Right) */}
        <Box
          sx={{
            bgcolor: (theme) => theme.palette.mode === 'dark' ? '#2a2a2a' : '#f5f5f5',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box
            sx={{
              p: theme.custom.spacing.lg,
              overflowY: 'auto',
              flex: 1,
              opacity: panelOpen ? 1 : 0,
              transform: panelOpen ? 'translateX(0)' : 'translateX(20px)',
              transition: `opacity ${theme.custom.transitions.slow} ${theme.custom.transitions.easing}, transform ${theme.custom.transitions.slow} ${theme.custom.transitions.easing}`,
            }}
          >
            {/* Panel Header */}
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: theme.custom.spacing.lg,
                pb: theme.custom.spacing.md,
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Typography variant="h6" color="text.primary">
                {isNewRule ? t('segments.editDialog.newRule') : t('segments.editDialog.editRule')}: "{rulePattern}"
              </Typography>
              <IconButton onClick={handleClosePanel} size="small">
                <CloseIcon />
              </IconButton>
            </Box>

            {/* Form Fields - Phase 3 */}
            <Box sx={{ mb: theme.custom.spacing.md }}>
              <TextField
                label={t('segments.editDialog.pattern')}
                value={rulePattern}
                fullWidth
                InputProps={{
                  readOnly: true,
                }}
                sx={{ mb: theme.custom.spacing.md }}
              />

              <TextField
                label={t('segments.editDialog.replacement')}
                value={ruleReplacement}
                onChange={(e) => setRuleReplacement(e.target.value)}
                fullWidth
                placeholder={t('segments.editDialog.replacementPlaceholder')}
                sx={{ mb: theme.custom.spacing.md }}
              />

              {/* Scope Checkbox */}
              <FormControlLabel
                control={
                  <Checkbox
                    checked={isProjectRule}
                    onChange={(e) => setIsProjectRule(e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2">
                    {t('segments.editDialog.projectScope')} <strong>{project?.title || t('segments.editDialog.unknownProject')}</strong>
                  </Typography>
                }
                sx={{ mb: theme.custom.spacing.md }}
              />
            </Box>

            {/* Panel Actions - Simplified: Save (+ Delete for existing rules) */}
            <Box
              sx={{
                display: 'flex',
                gap: theme.custom.spacing.xs,
                mt: theme.custom.spacing.lg,
                pt: theme.custom.spacing.md,
                borderTop: 1,
                borderColor: 'divider',
                justifyContent: 'flex-end',
              }}
            >
              {isNewRule ? (
                // New Rule: Only Save (disabled until replacement entered)
                <Tooltip title={createRuleMutation.isPending ? t('segments.editDialog.saving') : t('segments.editDialog.saveRule')}>
                  <span>
                    <IconButton
                      color="primary"
                      onClick={handleSaveRule}
                      disabled={
                        !ruleReplacement.trim() ||
                        createRuleMutation.isPending
                      }
                      size="small"
                    >
                      <SaveIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              ) : (
                // Edit Rule: Delete + Save (disabled until changed)
                <>
                  <Tooltip title={deleteRuleMutation.isPending ? t('segments.editDialog.deleting') : t('segments.editDialog.deleteRule')}>
                    <span>
                      <IconButton
                        color="error"
                        onClick={handleDeleteRule}
                        disabled={deleteRuleMutation.isPending}
                        size="small"
                      >
                        <DeleteIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={updateRuleMutation.isPending ? t('segments.editDialog.saving') : t('segments.editDialog.saveChanges')}>
                    <span>
                      <IconButton
                        color="primary"
                        onClick={handleSaveRule}
                        disabled={
                          !isRuleModified ||
                          !ruleReplacement.trim() ||
                          updateRuleMutation.isPending
                        }
                        size="small"
                      >
                        <SaveIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                </>
              )}
            </Box>
          </Box>
        </Box>
      </DialogContent>

      {/* DialogActions - Smart: Only show Save if text modified */}
      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2, justifyContent: 'space-between' }}>
        {/* Navigation Buttons (Left) */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          {onSegmentChange && (
            <>
              <Button
                startIcon={<NavigateBeforeIcon />}
                onClick={handlePreviousSegment}
                disabled={!hasPrevious || saving}
              >
                {t('segments.editDialog.previous')}
              </Button>
              <Button
                endIcon={<NavigateNextIcon />}
                onClick={handleNextSegment}
                disabled={!hasNext || saving}
              >
                {t('segments.editDialog.next')}
              </Button>
            </>
          )}
        </Box>

        {/* Action Buttons (Right) - with icons */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          {isTextModified ? (
            <>
              <Button startIcon={<CancelIcon />} onClick={handleClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={!isTextValid || saving} data-testid="edit-segment-save-button">
                {saving ? t('common.saving') : t('segments.messages.saveChanges')}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose} variant="contained" startIcon={<CloseIcon />}>
              {t('common.close')}
            </Button>
          )}
        </Box>
      </DialogActions>

      <ErrorDialog />

      {/* Snackbar Notifications */}
      <SnackbarComponent />
    </Dialog>
  );
};
