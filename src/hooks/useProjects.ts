import { useCallback, useEffect, useState } from 'react'

export interface ProjectInfo {
  id: string
  name: string
  path: string
  manifestPath: string
  hasCode: boolean
  fileCount: number
  sizeBytes: number
  mtimeMs: number
  createdMs: number
  manifestTitle?: string
  error?: string
}

interface ListResponse {
  basePath?: string
  projects?: ProjectInfo[]
  error?: string
}

declare global {
  interface Window {
    projects?: {
      list?: () => Promise<ListResponse>
      read?: (id: string) => Promise<{ id?: string; projectPath?: string; manifest?: string; code?: string; workspaceJson?: string; error?: string }>
    }
  }
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [basePath, setBasePath] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!window.projects?.list) return
    setLoading(true)
    setError(null)
    try {
      const res = await window.projects.list() as ListResponse
      if (res.error) {
        setError(res.error)
      } else {
        setProjects(res.projects || [])
        setBasePath(res.basePath || '')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { projects, basePath, loading, error, refresh }
}
