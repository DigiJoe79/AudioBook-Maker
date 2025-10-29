
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  Box,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Slider,
  Typography,
  Divider,
  CircularProgress,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useSettings, useUpdateSettings, useResetSettings, useEngineSchema } from '../../hooks/useSettings';
import { useTTSEngines, useTTSModels } from '../../hooks/useTTSQuery';
import { useAppStore, type GlobalSettings } from '../../store/appStore';
import { useUISettingsStore, type UISettings } from '../../store/uiSettingsStore';
import { useConfirm } from '../../hooks/useConfirm';
import SpeakerManagerContent from '../speakers/SpeakerManagerContent';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialTab?: number;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div hidden={value !== index} style={{ paddingTop: 16 }}>
      {value === index && children}
    </div>
  );
}

interface EngineSettingsAccordionProps {
  engine: {
    name: string;
    displayName: string;
    supportedLanguages: string[];
  };
  engineConfig: {
    defaultLanguage: string;
    parameters: Record<string, any>;
  };
  updateLocalSetting: (category: keyof GlobalSettings, path: string, value: any) => void;
}

function EngineSettingsAccordion({ engine, engineConfig, updateLocalSetting }: EngineSettingsAccordionProps) {
  const { t } = useTranslation();
  const engineType = engine.name;

  const { data: engineSchema } = useEngineSchema(engineType);

  return (
    <Accordion key={engineType}>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Typography>{engine.displayName}</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Box display="flex" flexDirection="column" gap={2}>
          <FormControl fullWidth>
            <InputLabel>{t('settings.tts.defaultLanguage')}</InputLabel>
            <Select
              value={engineConfig.defaultLanguage}
              onChange={(e) =>
                updateLocalSetting('tts', `engines.${engineType}.defaultLanguage`, e.target.value)
              }
              label={t('settings.tts.defaultLanguage')}
            >
              {engine.supportedLanguages.map((lang) => (
                <MenuItem key={lang} value={lang}>
                  {lang}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {engineSchema && Object.keys(engineSchema).length > 0 ? (
            <>
              <Divider sx={{ mt: 1, mb: 1 }} />
              <Typography variant="subtitle2">{t('settings.tts.engineParameters')}</Typography>

              {Object.entries(engineSchema)
                .filter(([_, schema]) => !(schema as any).readonly)
                .map(([key, schema]) => {
                  const schemaTyped = schema as any;
                  const currentValue = engineConfig.parameters[key] ?? schemaTyped.default;

                  if (schemaTyped.type === 'boolean') {
                    return (
                      <FormControlLabel
                        key={key}
                        control={
                          <Switch
                            checked={currentValue}
                            onChange={(e) =>
                              updateLocalSetting('tts', `engines.${engineType}.parameters.${key}`, e.target.checked)
                            }
                          />
                        }
                        label={
                          <Box>
                            <Typography variant="body2">{t(schemaTyped.label)}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {t(schemaTyped.description)}
                            </Typography>
                          </Box>
                        }
                      />
                    );
                  }

                  if (schemaTyped.type === 'float' || schemaTyped.type === 'int') {
                    return (
                      <Box key={key}>
                        <Typography variant="body2" gutterBottom>
                          {t(schemaTyped.label)}: {currentValue}
                        </Typography>
                        <Slider
                          value={currentValue}
                          onChange={(_, value) =>
                            updateLocalSetting('tts', `engines.${engineType}.parameters.${key}`, value)
                          }
                          min={schemaTyped.min}
                          max={schemaTyped.max}
                          step={schemaTyped.step}
                          marks
                          valueLabelDisplay="auto"
                        />
                        <Typography variant="caption" color="text.secondary">
                          {t(schemaTyped.description)}
                        </Typography>
                      </Box>
                    );
                  }

                  if (schemaTyped.type === 'select' && schemaTyped.options) {
                    return (
                      <FormControl key={key} fullWidth>
                        <InputLabel>{t(schemaTyped.label)}</InputLabel>
                        <Select
                          value={currentValue}
                          onChange={(e) =>
                            updateLocalSetting('tts', `engines.${engineType}.parameters.${key}`, e.target.value)
                          }
                          label={t(schemaTyped.label)}
                        >
                          {schemaTyped.options.map((option: string) => (
                            <MenuItem key={option} value={option}>
                              {option}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    );
                  }

                  return null;
                })}
            </>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {t('settings.tts.engineParametersComingSoon')}
            </Typography>
          )}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

export default function SettingsDialog({ open, onClose, initialTab = 0 }: SettingsDialogProps) {
  const { t } = useTranslation();
  const { confirm, ConfirmDialog } = useConfirm();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState(initialTab);
  const [localSettings, setLocalSettings] = useState<GlobalSettings | null>(null);
  const [localUISettings, setLocalUISettings] = useState<UISettings | null>(null);

  const settings = useAppStore((state) => state.settings);
  const uiSettings = useUISettingsStore((state) => state.settings);
  const updateUISettings = useUISettingsStore((state) => state.updateSettings);
  const clearSessionOverrides = useAppStore((state) => state.clearSessionOverrides);
  const { isLoading, error } = useSettings();
  const updateMutation = useUpdateSettings();
  const resetMutation = useResetSettings();

  const { data: availableEngines = [] } = useTTSEngines();
  const currentEngine = localSettings?.tts.defaultEngine || null;
  const { data: availableModels = [] } = useTTSModels(currentEngine);

  useEffect(() => {
    if (settings) {
      setLocalSettings(JSON.parse(JSON.stringify(settings)));
    }
    setLocalUISettings(JSON.parse(JSON.stringify(uiSettings)));
  }, [settings, uiSettings, open]);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [initialTab, open]);

  useEffect(() => {
    if (localSettings && availableModels.length > 0) {
      const currentModel = localSettings.tts.defaultModelName;
      const isValidModel = availableModels.some(m => m.modelName === currentModel);

      if (!isValidModel) {
        updateLocalSetting('tts', 'defaultModelName', availableModels[0].modelName);
      }
    }
  }, [availableModels, localSettings?.tts.defaultEngine]);


  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const handleSave = async () => {
    try {
      if (localUISettings) {
        updateUISettings(localUISettings);
      }

      if (localSettings) {
        await queryClient.invalidateQueries({ queryKey: ['settings'] });

        await new Promise(resolve => setTimeout(resolve, 100));

        const currentSettings = queryClient.getQueryData<GlobalSettings>(['settings']);

        if (currentSettings?.tts?.defaultSpeaker && !localSettings.tts.defaultSpeaker) {
          localSettings.tts.defaultSpeaker = currentSettings.tts.defaultSpeaker;
        }

        for (const category of Object.keys(localSettings) as Array<keyof GlobalSettings>) {
          await updateMutation.mutateAsync({
            category,
            value: localSettings[category]
          });
        }

        clearSessionOverrides();

        queryClient.invalidateQueries({ queryKey: ['segment-limits'] });
      }

      onClose();
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  const handleReset = async () => {
    const confirmed = await confirm(
      t('settings.actions.resetToDefaults'),
      t('settings.messages.resetConfirm')
    );

    if (confirmed) {
      try {
        await resetMutation.mutateAsync();
        onClose();
      } catch (err) {
        console.error('Failed to reset settings:', err);
      }
    }
  };

  const updateLocalSetting = <K extends keyof GlobalSettings>(
    category: K,
    path: string,
    value: any
  ) => {
    if (!localSettings) return;

    const keys = path.split('.');
    const newSettings = { ...localSettings };
    let current: any = newSettings[category];

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];

      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        console.warn('Attempted to modify protected property:', path);
        return;
      }

      if (!Object.prototype.hasOwnProperty.call(current, key) || typeof current[key] !== 'object') {
        current[key] = {};
      }

      current = current[key];
    }

    const lastKey = keys[keys.length - 1];

    if (lastKey === '__proto__' || lastKey === 'constructor' || lastKey === 'prototype') {
      console.warn('Attempted to modify protected property:', path);
      return;
    }

    current[lastKey] = value;
    setLocalSettings(newSettings);
  };

  if (isLoading) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogContent>
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        </DialogContent>
      </Dialog>
    );
  }

  if (error || !localSettings) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogContent>
          <Alert severity="error">{t('settings.messages.error')}</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('settings.title')}</DialogTitle>

      <Tabs value={activeTab} onChange={handleTabChange} sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tab label={t('settings.tabs.general')} />
        <Tab label={t('settings.tabs.tts')} />
        <Tab label={t('settings.tabs.audio')} />
        <Tab label={t('settings.tabs.text')} />
        <Tab label={t('settings.tabs.speakers')} />
      </Tabs>

      <DialogContent>
        <TabPanel value={activeTab} index={0}>
          {localUISettings && (
            <Box display="flex" flexDirection="column" gap={3}>
              <FormControl fullWidth>
                <InputLabel>{t('settings.general.theme')}</InputLabel>
                <Select
                  value={localUISettings.theme}
                  onChange={(e) => setLocalUISettings({ ...localUISettings, theme: e.target.value as UISettings['theme'] })}
                  label={t('settings.general.theme')}
                >
                  <MenuItem value="light">{t('settings.general.themeLight')}</MenuItem>
                  <MenuItem value="dark">{t('settings.general.themeDark')}</MenuItem>
                  <MenuItem value="system">{t('settings.general.themeSystem')}</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>{t('settings.general.uiLanguage')}</InputLabel>
                <Select
                  value={localUISettings.uiLanguage}
                  onChange={(e) => setLocalUISettings({ ...localUISettings, uiLanguage: e.target.value as UISettings['uiLanguage'] })}
                  label={t('settings.general.uiLanguage')}
                >
                  <MenuItem value="de">{t('settings.general.uiLanguageDe')}</MenuItem>
                  <MenuItem value="en">{t('settings.general.uiLanguageEn')}</MenuItem>
                </Select>
              </FormControl>
            </Box>
          )}
        </TabPanel>

        <TabPanel value={activeTab} index={1}>
          <Box display="flex" flexDirection="column" gap={3}>
            <Typography variant="h6">{t('settings.tts.globalSettings')}</Typography>

            <FormControl fullWidth>
              <InputLabel>{t('settings.tts.defaultEngine')}</InputLabel>
              <Select
                value={localSettings.tts.defaultEngine}
                onChange={(e) => updateLocalSetting('tts', 'defaultEngine', e.target.value)}
                label={t('settings.tts.defaultEngine')}
              >
                {availableEngines.map((engine) => (
                  <MenuItem key={engine.name} value={engine.name}>
                    {engine.displayName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>{t('settings.tts.defaultModel')}</InputLabel>
              <Select
                value={localSettings.tts.defaultModelName}
                onChange={(e) => updateLocalSetting('tts', 'defaultModelName', e.target.value)}
                label={t('settings.tts.defaultModel')}
                disabled={!currentEngine}
              >
                {availableModels.map((model) => (
                  <MenuItem key={model.modelName} value={model.modelName}>
                    {model.displayName || model.modelName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Divider />

            <Typography variant="h6">{t('settings.tts.perEngineSettings')}</Typography>

            {availableEngines.map((engine) => {
              const engineConfig = localSettings.tts.engines[engine.name];

              if (!engineConfig) return null;

              return (
                <EngineSettingsAccordion
                  key={engine.name}
                  engine={engine}
                  engineConfig={engineConfig}
                  updateLocalSetting={updateLocalSetting}
                />
              );
            })}
          </Box>
        </TabPanel>

        <TabPanel value={activeTab} index={2}>
          <Box display="flex" flexDirection="column" gap={3}>
            <FormControl fullWidth>
              <InputLabel>{t('settings.audio.defaultFormat')}</InputLabel>
              <Select
                value={localSettings.audio.defaultFormat}
                onChange={(e) => updateLocalSetting('audio', 'defaultFormat', e.target.value)}
                label={t('settings.audio.defaultFormat')}
              >
                <MenuItem value="mp3">MP3</MenuItem>
                <MenuItem value="m4a">M4A</MenuItem>
                <MenuItem value="wav">WAV</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>{t('settings.audio.defaultQuality')}</InputLabel>
              <Select
                value={localSettings.audio.defaultQuality}
                onChange={(e) => updateLocalSetting('audio', 'defaultQuality', e.target.value)}
                label={t('settings.audio.defaultQuality')}
              >
                <MenuItem value="low">{t('settings.audio.qualityLow')}</MenuItem>
                <MenuItem value="medium">{t('settings.audio.qualityMedium')}</MenuItem>
                <MenuItem value="high">{t('settings.audio.qualityHigh')}</MenuItem>
              </Select>
            </FormControl>

            <Box sx={{
              display: 'flex',
              gap: 3,
              p: 2,
              bgcolor: 'action.hover',
              borderRadius: 1,
              border: 1,
              borderColor: 'divider'
            }}>
              <Box sx={{ flex: 1, minWidth: 0, pr: 1.5 }}>
                <Typography variant="caption" gutterBottom sx={{ display: 'block', fontSize: '0.75rem' }}>
                  {t('settings.audio.pauseBetweenSegments')}
                </Typography>
                <Typography variant="body2" align="center" sx={{ mb: 0.5, fontWeight: 600 }}>
                  {(localSettings.audio.pauseBetweenSegments / 1000).toFixed(1)}s
                </Typography>
                <Slider
                  value={localSettings.audio.pauseBetweenSegments}
                  onChange={(_, val) => updateLocalSetting('audio', 'pauseBetweenSegments', val as number)}
                  min={0}
                  max={5000}
                  step={100}
                  marks={[
                    { value: 0, label: '0s' },
                    { value: 500, label: '0,5s' },
                    { value: 5000, label: '5s' },
                  ]}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(val) => `${(val / 1000).toFixed(1)}s`}
                  size="small"
                  sx={{
                    '& .MuiSlider-track': {
                      height: 6,
                    },
                    '& .MuiSlider-rail': {
                      height: 6,
                    },
                  }}
                />
              </Box>

              <Box sx={{ flex: 1, minWidth: 0, pl: 1.5 }}>
                <Typography variant="caption" gutterBottom sx={{ display: 'block', fontSize: '0.75rem' }}>
                  {t('settings.audio.defaultDividerDuration')}
                </Typography>
                <Typography variant="body2" align="center" sx={{ mb: 0.5, fontWeight: 600 }}>
                  {(localSettings.audio.defaultDividerDuration / 1000).toFixed(1)}s
                </Typography>
                <Slider
                  value={localSettings.audio.defaultDividerDuration}
                  onChange={(_, val) => updateLocalSetting('audio', 'defaultDividerDuration', val as number)}
                  min={0}
                  max={10000}
                  step={500}
                  marks={[
                    { value: 0, label: '0s' },
                    { value: 2000, label: '2s' },
                    { value: 5000, label: '5s' },
                    { value: 10000, label: '10s' },
                  ]}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(val) => `${(val / 1000).toFixed(1)}s`}
                  size="small"
                  sx={{
                    '& .MuiSlider-track': {
                      height: 6,
                    },
                    '& .MuiSlider-rail': {
                      height: 6,
                    },
                  }}
                />
              </Box>
            </Box>

            <Divider />

          </Box>
        </TabPanel>

        <TabPanel value={activeTab} index={3}>
          <Box display="flex" flexDirection="column" gap={3}>
            <FormControl fullWidth>
              <InputLabel>{t('settings.text.defaultSegmentationMethod')}</InputLabel>
              <Select
                value={localSettings.text.defaultSegmentationMethod}
                onChange={(e) =>
                  updateLocalSetting('text', 'defaultSegmentationMethod', e.target.value)
                }
                label={t('settings.text.defaultSegmentationMethod')}
              >
                <MenuItem value="sentences">{t('settings.text.segmentationSentences')}</MenuItem>
                <MenuItem value="paragraphs">{t('settings.text.segmentationParagraphs')}</MenuItem>
                <MenuItem value="smart">{t('settings.text.segmentationSmart')}</MenuItem>
                <MenuItem value="length">{t('settings.text.segmentationLength')}</MenuItem>
              </Select>
            </FormControl>

            <TextField
              fullWidth
              type="number"
              label={t('settings.text.preferredMaxSegmentLength')}
              value={localSettings.text.preferredMaxSegmentLength}
              onChange={(e) =>
                updateLocalSetting('text', 'preferredMaxSegmentLength', parseInt(e.target.value))
              }
              helperText={t('settings.text.preferredMaxSegmentLengthDesc')}
            />


          </Box>
        </TabPanel>

        <TabPanel value={activeTab} index={4}>
          <SpeakerManagerContent />
        </TabPanel>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleReset} color="warning">
          {t('settings.actions.reset')}
        </Button>
        <Box flex={1} />
        <Button onClick={onClose}>{t('settings.actions.cancel')}</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? <CircularProgress size={24} /> : t('settings.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
    <ConfirmDialog />
    </>
  );
}
