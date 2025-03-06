import { UnixTime } from '@l2beat/shared-pure'
import type { Layer2 } from '../../internalTypes'
import { BADGES } from '../badges'
import { underReviewL2 } from './templates/underReview'

export const pandasea: Layer2 = underReviewL2({
  id: 'pandasea',
  capability: 'universal',
  addedAt: UnixTime(1729797861), // 2024-10-24T21:24:21Z
  badges: [BADGES.Stack.OPStack, BADGES.VM.EVM, BADGES.RaaS.Zeeve],
  display: {
    name: 'PandaSea',
    slug: 'pandasea',
    description:
      'PandaSea.io is a Layer 2 Web3 platform focused on integrating social finance and sports engagement.',
    purposes: ['Universal'],
    category: 'Optimistic Rollup',
    stack: 'OP Stack',
    links: {
      websites: ['https://pandasea.io/'],
      explorers: ['https://pandaseascan.com/'],
      apps: ['https://bridge.pandasea.io/'],
    },
  },
  chainConfig: {
    name: 'pandasea',
    chainId: 7776,
    apis: [
      { type: 'rpc', url: 'https://rpc1.pandasea.io', callsPerMinute: 1500 },
    ],
  },
  activityConfig: {
    type: 'block',
    adjustCount: { type: 'SubtractOne' },
    startBlock: 1,
  },
}) //no escrow (0xfd84a81e4419af02DFBE0A19cB8B2802C44E0368) since gas token is not on CG
