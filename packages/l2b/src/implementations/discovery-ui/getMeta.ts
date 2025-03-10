import type { DiscoveryOutput } from '@l2beat/discovery'
import { EthereumAddress } from '@l2beat/shared-pure'
import { getContractType } from './getContractType'
import type { ApiAddressType } from './types'

export type ContractsMeta = Record<
  string,
  { name?: string; type: ApiAddressType }
>

export function getMeta(discoveries: DiscoveryOutput[]): ContractsMeta {
  const meta: Record<string, { name?: string; type: ApiAddressType }> = {}
  for (const discovery of discoveries) {
    for (const entry of discovery.entries) {
      const address = entry.address.toString()
      if (entry.type === 'EOA') {
        meta[address] = { name: entry.name || undefined, type: 'EOA' }
      } else {
        meta[address] = {
          name: entry.name || undefined,
          type: getContractType(entry),
        }
      }
    }
  }
  meta[EthereumAddress.ZERO] = { name: 'ZERO', type: 'Unknown' }
  return meta
}
