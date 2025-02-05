import { UnixTime } from '@l2beat/shared-pure'
import type { BlobScanClient } from '../../clients'
import type { DaBlob, DaProvider } from './DaProvider'

export type EthereumBlob = DaBlob & {
  inbox: string
  sequencer: string
}

// each blob is 128 KiB so 131,072 B
const BLOB_SIZE_BYTES = 131072n

export class EthereumDaProvider implements DaProvider {
  constructor(private readonly client: BlobScanClient) {}

  async getBlobs(from: number, to: number): Promise<DaBlob[]> {
    const blobs = await this.client.getBlobs(from, to)

    return blobs.map((blob) => ({
      blockTimestamp: UnixTime.fromDate(new Date(blob.blockTimestamp)),
      size: BLOB_SIZE_BYTES,
      inbox: blob.transaction.to,
      sequencer: blob.transaction.from,
    }))
  }
}
