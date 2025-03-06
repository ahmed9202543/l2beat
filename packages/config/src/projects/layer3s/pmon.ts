import { EthereumAddress, ProjectId, UnixTime } from '@l2beat/shared-pure'
import type { Layer3 } from '../../internalTypes'
import { BADGES } from '../badges'
import { underReviewL3 } from '../layer2s/templates/underReview'

export const pmon: Layer3 = underReviewL3({
  hostChain: ProjectId('arbitrum'),
  id: ProjectId('pmon'),
  capability: 'universal',
  addedAt: UnixTime(1722587021), // 2024-08-02T08:23:41Z
  badges: [
    BADGES.L3ParentChain.Arbitrum,
    BADGES.DA.Celestia,
    BADGES.Stack.Orbit,
    BADGES.VM.EVM,
    BADGES.RaaS.AltLayer,
  ],
  display: {
    category: 'Optimium',
    stack: 'Arbitrum',
    name: 'PMON Chain',
    slug: 'pmon',
    description:
      'Polychain Monsters built an Orbit stack Optimium, housing the Onchain Monsters game.',
    purposes: ['Gaming', 'NFT'],
    links: {
      websites: ['https://protocolmonsterlabs.com/'],
      apps: [
        'https://battle.polychainmonsters.com/',
        'https://bridge.arbitrum.io/?destinationChain=pmon-chain&sourceChain=arbitrum-one',
      ],
      documentation: ['https://battle-docs.polychainmonsters.com/'],
      socialMedia: [
        'https://x.com/protocolmon',
        'https://discord.gg/protocolmon',
      ],
    },
  },
  associatedTokens: ['PMON'],
  escrows: [
    {
      chain: 'arbitrum',
      address: EthereumAddress('0x10B25719f4c0fA1BFF22431438E6b6315059548A'), // ERC20Bridge
      sinceTimestamp: UnixTime(1707462976),
      tokens: '*',
    },
  ],
})
