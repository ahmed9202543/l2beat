import type { AnomalyRecord, Database } from '@l2beat/database'
import {
  assert,
  type ProjectId,
  type TrackedTxsConfigSubtype,
  UnixTime,
  clampRangeToDay,
  notUndefined,
} from '@l2beat/shared-pure'
import type { TrackedTxProject } from '../../../../../config/Config'
import {
  ManagedChildIndexer,
  type ManagedChildIndexerOptions,
} from '../../../../../tools/uif/ManagedChildIndexer'
import {
  type LivenessRecordWithConfig,
  LivenessWithConfigService,
} from '../services/LivenessWithConfigService'
import { RunningStatistics } from '../utils/RollingVariance'
import { type Interval, calculateIntervals } from '../utils/calculateIntervals'
import { getActiveConfigurations } from '../utils/getActiveConfigurations'
import { groupByType } from '../utils/groupByType'

export interface AnomaliesIndexerIndexerDeps
  extends Omit<ManagedChildIndexerOptions, 'name'> {
  db: Database
  projects: TrackedTxProject[]
}

export class AnomaliesIndexer extends ManagedChildIndexer {
  private readonly SYNC_RANGE = 30
  constructor(private readonly $: AnomaliesIndexerIndexerDeps) {
    super({ ...$, name: 'anomalies' })
  }

  override async update(from: number, to: number): Promise<number> {
    // we only need to go one day back
    const maxDepth = UnixTime.toStartOf(
      UnixTime.now() - 1 * UnixTime.DAY,
      'day',
    )
    if (to <= maxDepth) {
      this.logger.info('Skipping update', { from, to })
      return to
    }

    // only on first run when from equals minTimestamp
    if (from < maxDepth) {
      from = maxDepth
      this.logger.info('Adjusting update range', { from, to })
    }

    // limit time range to one day if greater
    const { to: unixTo } = clampRangeToDay(from, to)

    this.logger.info('Calculating anomalies', { unixTo })

    const anomalies = await this.getAnomalies(unixTo)

    await this.$.db.transaction(async () => {
      // anomalies are recalculated on each run so we can safely delete all records
      // to make sure we don't have any outdated records
      const deleted = await this.$.db.anomalies.deleteAll()
      await this.$.db.anomalies.upsertMany(anomalies)

      this.logger.info('Anomaly records saved to db', {
        deleted,
        upserted: anomalies.length,
      })
    })

    return unixTo
  }

  override async invalidate(targetHeight: number): Promise<number> {
    // no need to remove data
    // safeHeight will be updated to this value
    return await Promise.resolve(targetHeight)
  }

  async getAnomalies(to: UnixTime) {
    const anomalies: AnomalyRecord[] = []

    const configurations = await this.$.indexerService.getSavedConfigurations(
      'tracked_txs_indexer',
    )

    // we need data from 2 * SYNC_RANGE past days to calculate standard deviation
    const deviationRange = to - 1 * this.SYNC_RANGE * 2 * UnixTime.DAY

    for (const project of this.$.projects) {
      const activeConfigs = getActiveConfigurations(project, configurations)

      if (!activeConfigs) {
        continue
      }

      const livenessWithConfig = new LivenessWithConfigService(
        activeConfigs,
        this.$.db,
      )

      const livenessRecords = await livenessWithConfig.getWithinTimeRange(
        deviationRange,
        to,
      )

      if (livenessRecords.length === 0) {
        this.logger.debug('No records found for project', {
          projectId: project.id,
        })
        continue
      }

      this.logger.debug('Liveness records loaded', {
        projectId: project.id,
        count: livenessRecords.length,
      })

      const [batchSubmissions, stateUpdates, proofSubmissions] =
        groupByType(livenessRecords)

      anomalies.push(
        ...this.detectAnomalies(
          project.id,
          'batchSubmissions',
          batchSubmissions,
          to,
        ),
      )

      anomalies.push(
        ...this.detectAnomalies(project.id, 'stateUpdates', stateUpdates, to),
      )

      anomalies.push(
        ...this.detectAnomalies(
          project.id,
          'proofSubmissions',
          proofSubmissions,
          to,
        ),
      )
    }

    return anomalies
  }

  detectAnomalies(
    projectId: ProjectId,
    subtype: TrackedTxsConfigSubtype,
    livenessRecords: LivenessRecordWithConfig[],
    to: UnixTime,
  ): AnomalyRecord[] {
    if (livenessRecords.length === 0) {
      return []
    }

    // if the oldest record is newer than 2 * SYNC_RANGE -1 we can't calculate anomalies
    const lastRecord = livenessRecords.at(-1)
    if (
      lastRecord?.timestamp &&
      lastRecord.timestamp > to - 1 * (2 * this.SYNC_RANGE - 1) * UnixTime.DAY
    )
      return []

    const anomalies: AnomalyRecord[] = []

    // add virtual point to calculate ongoing anomalies
    livenessRecords.unshift({
      id: '',
      timestamp: to,
      blockNumber: 0,
      configurationId: '',
      txHash: '',
      subtype,
    })

    const intervals = calculateIntervals(livenessRecords)

    const lastIndex = intervals.findIndex(
      (interval) =>
        interval.record.timestamp <= to - 1 * this.SYNC_RANGE * UnixTime.DAY,
    )

    const { means, stdDeviations } = this.calculate30DayRollingStats(
      intervals,
      0,
      lastIndex,
      to,
    )

    const currentRange = intervals.slice(0, lastIndex)
    currentRange.forEach((interval) => {
      const point = UnixTime.toStartOf(interval.record.timestamp, 'minute')
      const mean = means.get(point)
      const stdDev = stdDeviations.get(
        UnixTime.toStartOf(interval.record.timestamp, 'minute'),
      )

      assert(mean !== undefined, 'Mean should not be undefined')
      assert(stdDev !== undefined, 'StdDev should not be undefined')

      const z = (interval.duration - mean) / stdDev
      if (z >= 15 && interval.duration > mean) {
        anomalies.push({
          projectId,
          timestamp: interval.record.timestamp,
          subtype: interval.record.subtype,
          duration: interval.duration,
        })
      }
    })

    return anomalies
  }

  calculate30DayRollingStats(
    entireScope: Interval[],
    windowStartIndex: number,
    windowEndIndex: number,
    upTo: UnixTime,
  ): {
    means: Map<number, number>
    stdDeviations: Map<number, number>
  } {
    const result = {
      means: new Map<number, number>(),
      stdDeviations: new Map<number, number>(),
    }

    let timeStart = upTo

    const initialWindow = entireScope.slice(windowStartIndex, windowEndIndex)
    let sum = initialWindow.reduce(
      (prev, curr) => prev + (curr.duration ?? 0),
      0,
    )

    // special handling for the first loop iteration
    const mean = sum / (windowEndIndex - windowStartIndex)
    const rollingStdDev = new RunningStatistics(
      initialWindow.map((r) => r.duration).filter(notUndefined),
    )

    result.means.set(timeStart, mean)
    result.stdDeviations.set(timeStart, rollingStdDev.getStandardDeviation())
    while (timeStart >= upTo - 1 * this.SYNC_RANGE * UnixTime.DAY) {
      timeStart = timeStart - 1 * UnixTime.MINUTE
      const leftFence = timeStart
      const rightFence = timeStart - 1 * this.SYNC_RANGE * UnixTime.DAY

      while (entireScope[windowStartIndex].record.timestamp >= leftFence) {
        sum -= entireScope[windowStartIndex].duration ?? 0
        rollingStdDev.removeValue(entireScope[windowStartIndex].duration ?? 0)
        windowStartIndex++
      }
      while (
        windowEndIndex < entireScope.length &&
        entireScope[windowEndIndex].record.timestamp >= rightFence
      ) {
        sum += entireScope[windowEndIndex].duration ?? 0
        rollingStdDev.addValue(entireScope[windowEndIndex].duration ?? 0)
        windowEndIndex++
      }

      const mean = sum / (windowEndIndex - windowStartIndex)
      result.means.set(timeStart, mean)
      result.stdDeviations.set(timeStart, rollingStdDev.getStandardDeviation())
    }

    return result
  }
}
