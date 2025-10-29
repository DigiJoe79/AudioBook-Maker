
export interface BackendProfile {
  id: string

  name: string

  url: string

  isDefault: boolean

  lastConnected: Date | null

  createdAt: Date
}

export interface SessionState {
  selectedProjectId: string | null

  selectedChapterId: string | null

  selectedSegmentId: string | null

  expandedProjects: string[]

  timestamp: Date
}

export interface BackendHealthResponse {
  status: 'ok' | 'error'
  version: string
  timestamp: string
  database: boolean
  ttsEngines: string[]
  busy: boolean
  activeJobs: number
}
