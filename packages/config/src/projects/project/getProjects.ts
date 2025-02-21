import {
  SHARP_SUBMISSION_ADDRESS,
  SHARP_SUBMISSION_SELECTOR,
  type TrackedTxConfigEntry,
} from '@l2beat/shared'
import { ProjectId, UnixTime } from '@l2beat/shared-pure'
import { PROJECT_COUNTDOWNS } from '../../common'
import type {
  BaseProject,
  Bridge,
  Layer2,
  Layer2TxConfig,
  Layer3,
  ProjectCostsInfo,
  ProjectLivenessInfo,
} from '../../types'
import { isVerified } from '../../verification/isVerified'
import { badges } from '../badges'
import { bridges } from '../bridges'
import { layer2s } from '../layer2s'
import { layer3s } from '../layer3s'
import { refactored } from '../refactored'
import { getHostChain } from './utils/getHostChain'
import { getRaas } from './utils/getRaas'
import { getStage } from './utils/getStage'
import { isUnderReview } from './utils/isUnderReview'

export function getProjects(): BaseProject[] {
  return refactored
    .concat(layer2s.map(layer2Or3ToProject))
    .concat(layer3s.map(layer2Or3ToProject))
    .concat(bridges.map(bridgeToProject))
}

function layer2Or3ToProject(p: Layer2 | Layer3): BaseProject {
  return {
    id: p.id,
    name: p.display.name,
    shortName: p.display.shortName,
    slug: p.display.slug,
    addedAt: p.addedAt,
    // data
    statuses: {
      yellowWarning: p.display.headerWarning,
      redWarning: p.display.redWarning,
      isUnderReview: isUnderReview(p),
      isUnverified: !isVerified(p),
      // countdowns
      otherMigration:
        p.reasonsForBeingOther && p.display.category !== 'Other'
          ? {
              expiresAt: PROJECT_COUNTDOWNS.otherMigration.toNumber(),
              pretendingToBe: p.display.category,
              reasons: p.reasonsForBeingOther,
            }
          : undefined,
    },
    display: {
      description: p.display.description,
      links: p.display.links,
    },
    contracts: p.contracts,
    permissions: p.permissions,
    scalingInfo: {
      layer: p.type,
      type: p.display.category,
      capability: p.capability,
      isOther:
        p.display.category === 'Other' ||
        (PROJECT_COUNTDOWNS.otherMigration.lt(UnixTime.now()) &&
          !!p.reasonsForBeingOther),
      hostChain: getHostChain(
        p.type === 'layer2' ? ProjectId.ETHEREUM : p.hostChain,
      ),
      reasonsForBeingOther: p.reasonsForBeingOther,
      stack: p.display.stack,
      raas: getRaas(p.badges),
      daLayer: p.dataAvailability?.layer.value ?? 'Unknown',
      stage: getStage(p.stage),
      purposes: p.display.purposes,
      badges: p.badges?.map((id) => ({ ...badges[id], id })),
    },
    scalingStage: p.stage,
    scalingRisks: {
      self: p.riskView,
      host: undefined,
      stacked: undefined,
    },
    scalingDa: p.dataAvailability,
    tvlInfo: {
      associatedTokens: p.config.associatedTokens ?? [],
      warnings: [p.display.tvlWarning].filter((x) => x !== undefined),
    },
    livenessInfo: getLivenessInfo(p),
    livenessConfig: p.type === 'layer2' ? p.config.liveness : undefined,
    costsInfo: getCostsInfo(p),
    ...getFinality(p),
    trackedTxsConfig: toBackendTrackedTxsConfig(
      p.id,
      p.type === 'layer2' ? p.config.trackedTxs : undefined,
    ),
    proofVerification: p.stateValidation?.proofVerification,
    chainConfig: p.chainConfig,
    milestones: p.milestones,
    daTrackingConfig: p.config.daTracking,
    // tags
    isScaling: true,
    isZkCatalog: p.stateValidation?.proofVerification ? true : undefined,
    isArchived: p.isArchived ? true : undefined,
    isUpcoming: p.isUpcoming ? true : undefined,
    hasActivity: p.config.transactionApi ? true : undefined,
  }
}

function getLivenessInfo(p: Layer2 | Layer3): ProjectLivenessInfo | undefined {
  if (p.type === 'layer2' && p.config.trackedTxs !== undefined) {
    return p.display.liveness ?? {}
  }
}

function getCostsInfo(p: Layer2 | Layer3): ProjectCostsInfo | undefined {
  if (
    p.type === 'layer2' &&
    (p.display.category === 'Optimistic Rollup' ||
      p.display.category === 'ZK Rollup') &&
    p.config.trackedTxs !== undefined
  ) {
    return {
      warning: p.display.costsWarning,
    }
  }
}

function getFinality(
  p: Layer2 | Layer3,
): Pick<BaseProject, 'finalityConfig' | 'finalityInfo'> {
  if (
    p.type === 'layer2' &&
    (p.display.category === 'Optimistic Rollup' ||
      p.display.category === 'ZK Rollup') &&
    p.config.trackedTxs !== undefined &&
    p.config.finality !== undefined
  ) {
    return {
      finalityInfo: p.display.finality ?? {},
      finalityConfig: p.config.finality,
    }
  }
  return {}
}

function bridgeToProject(p: Bridge): BaseProject {
  return {
    id: p.id,
    name: p.display.name,
    shortName: p.display.shortName,
    slug: p.display.slug,
    addedAt: p.addedAt,
    // data
    statuses: {
      yellowWarning: p.display.warning,
      redWarning: undefined,
      isUnderReview: isUnderReview(p),
      isUnverified: !isVerified(p),
    },
    display: {
      description: p.display.description,
      links: p.display.links,
    },
    bridgeInfo: {
      category: p.display.category,
      destination: p.technology.destination,
      validatedBy: p.riskView.validatedBy.value,
    },
    contracts: p.contracts,
    permissions: p.permissions,
    bridgeRisks: p.riskView,
    tvlInfo: {
      associatedTokens: p.config.associatedTokens ?? [],
      warnings: [],
    },
    chainConfig: p.chainConfig,
    milestones: p.milestones,
    // tags
    isBridge: true,
    isArchived: p.isArchived ? true : undefined,
    isUpcoming: p.isUpcoming ? true : undefined,
  }
}

function toBackendTrackedTxsConfig(
  projectId: ProjectId,
  configs: Layer2TxConfig[] | undefined,
): Omit<TrackedTxConfigEntry, 'id'>[] | undefined {
  if (configs === undefined) return

  return configs.flatMap((config) =>
    config.uses.map((use) => {
      const base = {
        projectId,
        sinceTimestamp: config.query.sinceTimestamp,
        untilTimestamp: config.query.untilTimestamp,
        type: use.type,
        subtype: use.subtype,
        costMultiplier:
          use.type === 'l2costs' ? config._hackCostMultiplier : undefined,
      }

      switch (config.query.formula) {
        case 'functionCall': {
          return {
            ...base,
            params: {
              formula: 'functionCall',
              address: config.query.address,
              selector: config.query.selector,
            },
          }
        }
        case 'transfer': {
          return {
            ...base,
            params: {
              formula: 'transfer',
              from: config.query.from,
              to: config.query.to,
            },
          }
        }
        case 'sharpSubmission': {
          return {
            ...base,
            params: {
              formula: 'sharpSubmission',
              address: SHARP_SUBMISSION_ADDRESS,
              selector: SHARP_SUBMISSION_SELECTOR,
              programHashes: config.query.programHashes,
            },
          }
        }
        case 'sharedBridge': {
          return {
            ...base,
            params: {
              formula: 'sharedBridge',
              address: config.query.address,
              signature: config.query.functionSignature,
              selector: config.query.selector,
              chainId: config.query.chainId,
            },
          }
        }
      }
    }),
  )
}
