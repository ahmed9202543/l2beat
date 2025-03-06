import type { Project } from '@l2beat/config'
import { UnixTime, formatSeconds, notUndefined } from '@l2beat/shared-pure'
import { ps } from '~/server/projects'
import { type CommonDaEntry, getCommonDaEntry } from '../get-common-da-entry'
import {
  type ThroughputTableData,
  getDaThroughputTable,
} from './get-da-throughput-table'
import { getThroughputSyncWarning } from './is-throughput-synced'

export async function getDaThroughputEntries(): Promise<DaThroughputEntry[]> {
  const projectsWithDaTracking = await ps.getProjects({
    select: ['daTrackingConfig'],
  })

  const uniqueDaLayersInProjects = new Set(
    projectsWithDaTracking.flatMap((l) =>
      l.daTrackingConfig.map((d) => d.daLayer),
    ),
  )

  const [daLayers, daBridges] = await Promise.all([
    ps.getProjects({ select: ['daLayer', 'statuses'] }),
    ps.getProjects({ select: ['daBridge'] }),
  ])

  const daLayersWithDaTracking = daLayers.filter((p) =>
    uniqueDaLayersInProjects.has(p.id),
  )

  if (daLayersWithDaTracking.length === 0) {
    return []
  }
  const daLayerIds = daLayersWithDaTracking.map((p) => p.id)

  const latestData = await getDaThroughputTable(daLayerIds)

  const entries = daLayersWithDaTracking
    .map((project) =>
      getDaThroughputEntry(
        project,
        daBridges,
        latestData.data[project.id],
        latestData.scalingOnlyData[project.id],
      ),
    )
    .filter(notUndefined)
    .sort(
      (a, b) =>
        (b.data?.pastDayAvgThroughputPerSecond ?? 0) -
        (a.data?.pastDayAvgThroughputPerSecond ?? 0),
    )
  return entries
}

interface DaThroughputEntryData {
  /**
   * @unit B/s - bytes per second
   */
  pastDayAvgThroughputPerSecond: number
  /**
   * @unit B/s - bytes per second
   */
  maxThroughputPerSecond: number
  pastDayAvgCapacityUtilization: number
  largestPoster:
    | {
        name: string
        percentage: number
        totalPosted: number
      }
    | undefined

  totalPosted: number
}

export interface DaThroughputEntry extends CommonDaEntry {
  data: DaThroughputEntryData
  scalingOnlyData: DaThroughputEntryData
  finality: string | undefined
  isSynced: boolean
}

function getDaThroughputEntry(
  project: Project<'daLayer' | 'statuses'>,
  bridges: Project<'daBridge'>[],
  data: ThroughputTableData['data'][string] | undefined,
  scalingOnlyData: ThroughputTableData['scalingOnlyData'][string] | undefined,
): DaThroughputEntry | undefined {
  if (!data || !scalingOnlyData) return undefined

  const bridge = bridges.find((x) => x.daBridge.daLayer === project.id)
  const notSyncedStatus = data
    ? getThroughputSyncWarning(UnixTime(data.syncedUntil))
    : undefined
  const href = `/data-availability/projects/${project.slug}/${bridge ? bridge.slug : 'no-bridge'}`
  return {
    ...getCommonDaEntry({ project, href, syncWarning: notSyncedStatus }),
    finality: project.daLayer.finality
      ? formatSeconds(project.daLayer.finality, {
          fullUnit: true,
        })
      : undefined,
    data,
    scalingOnlyData,
    isSynced: !notSyncedStatus,
  }
}
