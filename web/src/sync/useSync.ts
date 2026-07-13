import { useEffect, useState } from 'react'
import { engine, type SyncStatus } from './engine'

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>(() => engine.getStatus())
  useEffect(() => engine.subscribe(setS), [])
  return s
}
