'use client'
import { CountBadge } from '~/components/badge/count-badge'
import {
  DirectoryTabs,
  DirectoryTabsContent,
  DirectoryTabsList,
  DirectoryTabsTrigger,
} from '~/components/core/directory-tabs'
import { type ScalingTvlEntry } from '~/server/features/scaling/tvl/get-scaling-tvl-entries'
import { type CategorisedScalingEntries } from '~/utils/group-by-main-categories'
import { useScalingFilter } from '../../_components/scaling-filter-context'
import { ScalingTvlFilters } from '../../_components/scaling-tvl-filters'
import { ScalingTvlTable } from './table/scaling-tvl-table'

type Props = CategorisedScalingEntries<ScalingTvlEntry>

export function ScalingTvlTables(props: Props) {
  const includeFilters = useScalingFilter()

  const filteredEntries = {
    rollups: props.rollups.filter(includeFilters),
    validiumsAndOptimiums: props.validiumsAndOptimiums.filter(includeFilters),
    others: props.others?.filter(includeFilters) ?? [],
  }
  return (
    <>
      <ScalingTvlFilters
        items={[
          ...filteredEntries.rollups,
          ...filteredEntries.validiumsAndOptimiums,
          ...filteredEntries.others,
        ]}
        className="mt-4"
      />
      <DirectoryTabs defaultValue="rollups">
        <DirectoryTabsList>
          <DirectoryTabsTrigger value="rollups">
            Rollups <CountBadge>{filteredEntries.rollups.length}</CountBadge>
          </DirectoryTabsTrigger>
          <DirectoryTabsTrigger value="validiums-and-optimiums">
            Validiums & Optimiums{' '}
            <CountBadge>
              {filteredEntries.validiumsAndOptimiums.length}
            </CountBadge>
          </DirectoryTabsTrigger>
          {filteredEntries.others.length > 0 && (
            <DirectoryTabsTrigger value="others">
              Others <CountBadge>{filteredEntries.others.length}</CountBadge>
            </DirectoryTabsTrigger>
          )}
        </DirectoryTabsList>
        <DirectoryTabsContent value="rollups">
          <ScalingTvlTable entries={filteredEntries.rollups} rollups />
        </DirectoryTabsContent>
        <DirectoryTabsContent value="validiums-and-optimiums">
          <ScalingTvlTable entries={filteredEntries.validiumsAndOptimiums} />
        </DirectoryTabsContent>
        {filteredEntries.others.length > 0 && (
          <DirectoryTabsContent value="others">
            <ScalingTvlTable entries={filteredEntries.others} />
          </DirectoryTabsContent>
        )}
      </DirectoryTabs>
    </>
  )
}
