
export interface Project {
  id: string
  title: string
  description?: string
  orderIndex: number
  createdAt: Date
  updatedAt: Date
  chapters: Chapter[]
}

export interface Chapter {
  id: string
  projectId: string
  title: string
  orderIndex: number
  defaultEngine: string
  defaultModelName: string
  segments: Segment[]
  createdAt: Date
  updatedAt: Date
}

export interface Segment {
  id: string
  chapterId: string
  text: string
  audioPath?: string | null
  orderIndex: number
  startTime: number
  endTime: number
  engine: string
  modelName: string
  speakerName: string | null
  language: string
  segmentType: 'standard' | 'divider'
  pauseDuration: number
  createdAt: Date
  updatedAt: Date
  status: 'pending' | 'processing' | 'completed' | 'failed'
}

export interface Speaker {
  id: string;
  name: string;
  description?: string;
  gender?: 'male' | 'female' | 'neutral';
  languages: string[];
  tags: string[];
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  samples: SpeakerSample[];
}

export interface SpeakerSample {
  id: string;
  fileName: string;
  filePath: string;
  fileSize?: number;
  duration?: number;
  sampleRate?: number;
  transcript?: string;
  createdAt: string;
}

export interface EngineParameterSchema {
  type: 'float' | 'int' | 'string' | 'boolean' | 'select';
  default: any;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  label: string;
  description: string;
  category: 'generation' | 'advanced' | 'limits';
  readonly?: boolean;
}

export interface AudioPlayerState {
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  currentSegmentId?: string
}

export interface TTSEngine {
  name: string

  displayName: string

  supportedLanguages: string[]

  constraints: {
    minTextLength: number

    maxTextLength: number

    maxTextLengthByLang?: Record<string, number>

    sampleRate: number

    audioFormat: string

    supportsStreaming: boolean

    requiresPunctuation: boolean
  }

  defaultParameters: Record<string, any>

  modelLoaded: boolean
}

export interface TTSModel {
  modelName: string

  displayName: string

  path: string

  version: string

  sizeMb?: number
}


export interface CommandItem {
  id: string
  type: 'text-segment' | 'divider'
  label: string
  icon: string
  description: string
}
