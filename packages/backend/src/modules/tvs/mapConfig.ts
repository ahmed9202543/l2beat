import { createHash } from 'crypto'
import type { Logger } from '@l2beat/backend-tools'
import {
  type AggLayerEscrow,
  type ChainConfig,
  type ElasticChainEscrow,
  type Project,
  ProjectService,
  type ProjectTvlEscrow,
} from '@l2beat/config'
import type { RpcClient } from '@l2beat/shared'
import { assert } from '@l2beat/shared-pure'
import type { Token as LegacyToken } from '@l2beat/shared-pure'
import { getAggLayerTokens } from './providers/aggLayer'
import { getElasticChainTokens } from './providers/elasticChain'
import { getTimestampsRange } from './tools/timestamps'
import {
  type AmountConfig,
  type AmountFormula,
  type BalanceOfEscrowAmountFormula,
  type CalculationFormula,
  type CirculatingSupplyAmountFormula,
  type PriceConfig,
  type ProjectTvsConfig,
  type Token,
  TokenId,
  type TotalSupplyAmountFormula,
  type ValueFormula,
} from './types'

export async function mapConfig(
  project: Project<'tvlConfig', 'chainConfig'>,
  logger: Logger,
  rpcClient?: RpcClient,
): Promise<ProjectTvsConfig> {
  const CHAINS = await getChains()
  const getChain = (name: string) => {
    const chain = CHAINS.get(name)
    assert(chain)
    return chain
  }

  const tokens: Token[] = []
  const escrowTokens: Map<
    string,
    {
      token: Token
      chain: string
    }
  > = new Map()

  for (const escrow of project.tvlConfig.escrows) {
    if (escrow.sharedEscrow) {
      if (rpcClient === undefined) {
        logger.warn(`No Multicall passed, sharedEscrow support is not enabled`)
        continue
      }

      const chainOfL1Escrow = getChain(escrow.chain)

      if (escrow.sharedEscrow.type === 'AggLayer') {
        logger.info(`Querying for AggLayer L2 tokens addresses`)
        const aggLayerL2Tokens = await getAggLayerTokens(
          project,
          escrow as ProjectTvlEscrow & { sharedEscrow: AggLayerEscrow },
          chainOfL1Escrow,
          rpcClient,
        )
        aggLayerL2Tokens.forEach((token) =>
          escrowTokens.set(token.id, { token, chain: escrow.chain }),
        )
      }

      if (escrow.sharedEscrow.type === 'ElasticChain') {
        logger.info(`Querying for ElasticChain L2 tokens addresses`)

        const elasticChainTokens = await getElasticChainTokens(
          project,
          escrow as ProjectTvlEscrow & { sharedEscrow: ElasticChainEscrow },
          chainOfL1Escrow,
          rpcClient,
        )
        elasticChainTokens.forEach((token) =>
          escrowTokens.set(token.id, { token, chain: escrow.chain }),
        )
      }
    } else {
      for (const legacyToken of escrow.tokens) {
        if (!legacyToken.id.endsWith('native')) {
          assert(
            legacyToken.address,
            `Token address is required ${legacyToken.id}`,
          )
        }
        const chain = getChain(escrow.chain)
        const token = createEscrowToken(project, escrow, chain, legacyToken)
        const previousToken = escrowTokens.get(token.id)

        if (previousToken === undefined) {
          escrowTokens.set(token.id, { token, chain: escrow.chain })
          continue
        }

        if (previousToken?.token.amount.type === 'balanceOfEscrow') {
          assert(previousToken.token.source === token.source, `Source mismatch`)
          escrowTokens.set(token.id, {
            token: {
              ...previousToken.token,
              amount: {
                type: 'calculation',
                operator: 'sum',
                arguments: [previousToken.token.amount, token.amount],
              },
            },
            chain: escrow.chain,
          })
          continue
        }

        if (previousToken.token.amount.type === 'calculation') {
          escrowTokens.set(token.id, {
            token: {
              ...previousToken.token,
              amount: {
                ...(previousToken.token.amount as CalculationFormula),
                arguments: [
                  ...(previousToken.token.amount as CalculationFormula)
                    .arguments,
                  token.amount,
                ],
              },
            },
            chain: escrow.chain,
          })
          continue
        }
      }
    }
  }

  for (const legacyToken of project.tvlConfig.tokens) {
    tokens.push(createToken(project, legacyToken))
  }

  const uniqueTokens: Map<string, Token> = new Map()

  for (const token of tokens) {
    uniqueTokens.set(token.id, token)
  }

  for (const { token, chain } of Array.from(escrowTokens.values())) {
    if (!uniqueTokens.has(token.id)) {
      uniqueTokens.set(token.id, token)
    } else {
      const suffix = `.${chain}`
      uniqueTokens.set(TokenId(token.id + suffix), {
        ...token,
        id: TokenId(token.id + suffix),
        symbol: token.symbol + suffix,
        displaySymbol: token.symbol,
      })
    }
  }

  return {
    projectId: project.id,
    tokens: Array.from(uniqueTokens.values()),
  }
}

export function createEscrowToken(
  project: Project<'tvlConfig'>,
  escrow: ProjectTvlEscrow,
  chainOfEscrow: ChainConfig,
  legacyToken: LegacyToken & { isPreminted?: boolean },
): Token {
  assert(
    chainOfEscrow.name === legacyToken.chainName,
    `${legacyToken.symbol}: chain mismatch`,
  )
  assert(
    chainOfEscrow.name === escrow.chain,
    `${legacyToken.symbol}: chain mismatch`,
  )

  let amountFormula: CalculationFormula | AmountFormula

  const { sinceTimestamp, untilTimestamp } = getTimestampsRange(
    legacyToken,
    escrow,
    chainOfEscrow,
  )

  if (legacyToken.isPreminted) {
    amountFormula = {
      type: 'calculation',
      operator: 'min',
      arguments: [
        {
          type: 'circulatingSupply',
          apiId: legacyToken.coingeckoId,
          decimals: legacyToken.decimals ?? 0,
          sinceTimestamp,
          ...(untilTimestamp ? { untilTimestamp } : {}),
        },
        {
          type: 'balanceOfEscrow',
          address: legacyToken.address ?? 'native',
          escrowAddress: escrow.address,
          chain: escrow.chain,
          decimals: legacyToken.decimals,
          sinceTimestamp,
          ...(untilTimestamp ? { untilTimestamp } : {}),
        },
      ],
    }
  } else {
    amountFormula = {
      type: 'balanceOfEscrow',
      address: legacyToken.address ?? 'native',
      chain: escrow.chain,
      escrowAddress: escrow.address,
      decimals: legacyToken.decimals,
      sinceTimestamp,
      ...(untilTimestamp ? { untilTimestamp } : {}),
    }
  }

  const source = escrow.source ?? 'canonical'
  const symbol =
    source === 'external' ? legacyToken.symbol + '.ext' : legacyToken.symbol
  const displaySymbol = source === 'external' ? legacyToken.symbol : undefined

  const id = TokenId.create(project.id, symbol)

  let valueForTotal: CalculationFormula | ValueFormula | undefined = undefined
  if (escrow.chain !== 'ethereum') {
    valueForTotal = {
      type: 'value',
      amount: {
        type: 'const',
        value: '0',
        decimals: 0,
        sinceTimestamp,
        ...(untilTimestamp ? { untilTimestamp } : {}),
      },
      priceId: legacyToken.coingeckoId,
    }
  }

  return {
    mode: 'auto',
    id,
    priceId: legacyToken.coingeckoId,
    symbol,
    ...(displaySymbol ? { displaySymbol } : {}),
    name: legacyToken.name,
    amount: amountFormula,
    ...(valueForTotal ? { valueForTotal } : {}),

    category: legacyToken.category,
    source: source,
    isAssociated: !!project.tvlConfig.associatedTokens?.includes(
      legacyToken.symbol,
    ),
  }
}

export function createToken(
  project: Project<'tvlConfig', 'chainConfig'>,
  legacyToken: LegacyToken,
): Token {
  assert(
    project.chainConfig && project.chainConfig.name === legacyToken.chainName,
  )
  const id = TokenId.create(project.id, legacyToken.symbol)
  let amountFormula: AmountFormula

  const { sinceTimestamp, untilTimestamp } = getTimestampsRange(
    legacyToken,
    project.chainConfig,
  )

  switch (legacyToken.supply) {
    case 'totalSupply':
      assert(legacyToken.address, 'Only tokens have total supply')
      amountFormula = {
        type: 'totalSupply',
        address: legacyToken.address,
        chain: project.id,
        decimals: legacyToken.decimals,
        sinceTimestamp,
        ...(untilTimestamp ? { untilTimestamp } : {}),
      }

      break

    case 'circulatingSupply':
      amountFormula = {
        type: 'circulatingSupply',
        apiId: legacyToken.coingeckoId,
        decimals: legacyToken.decimals ?? 0,
        sinceTimestamp,
        ...(untilTimestamp ? { untilTimestamp } : {}),
      }
      break

    default:
      throw new Error(`Unsupported supply type ${legacyToken.supply}`)
  }

  return {
    mode: 'auto',
    id,
    priceId: legacyToken.coingeckoId,
    symbol: legacyToken.symbol,
    name: legacyToken.name,
    amount: amountFormula,

    category: legacyToken.category,
    source: legacyToken.source,
    isAssociated: !!project.tvlConfig.associatedTokens?.includes(
      legacyToken.symbol,
    ),
  }
}

export function extractPricesAndAmounts(config: ProjectTvsConfig): {
  amounts: AmountConfig[]
  prices: PriceConfig[]
} {
  const amounts = new Map<string, AmountConfig>()
  const prices = new Map<string, PriceConfig>()

  for (const token of config.tokens) {
    if (token.amount.type === 'calculation') {
      const { formulaAmounts, formulaPrices } = processFormulaRecursive(
        token.amount,
      )
      formulaAmounts.forEach((a) => setAmount(amounts, a))

      assert(
        formulaPrices.length === 0,
        'Amount formula should not have any prices',
      )

      const amountFormulaRange = getTimestampsRange(
        ...formulaAmounts.map((a) => ({
          sinceTimestamp: a.sinceTimestamp,
          untilTimestamp: a.untilTimestamp,
        })),
      )

      setPrice(prices, {
        priceId: token.priceId,
        sinceTimestamp: amountFormulaRange.sinceTimestamp,
        untilTimestamp: amountFormulaRange.untilTimestamp,
      })
    } else {
      if (token.amount.type !== 'const') {
        const amount = createAmountConfig(token.amount)
        setAmount(amounts, amount)

        setPrice(prices, {
          priceId: token.priceId,
          sinceTimestamp: amount.sinceTimestamp,
          untilTimestamp: amount.untilTimestamp,
        })
      }
    }

    if (token.valueForProject) {
      const { formulaAmounts, formulaPrices } = processFormulaRecursive(
        token.valueForProject,
      )
      formulaAmounts.forEach((a) => setAmount(amounts, a))
      formulaPrices.forEach((p) => setPrice(prices, p))
    }

    if (token.valueForTotal) {
      const { formulaAmounts, formulaPrices } = processFormulaRecursive(
        token.valueForTotal,
      )
      formulaAmounts.forEach((a) => setAmount(amounts, a))
      formulaPrices.forEach((p) => setPrice(prices, p))
    }
  }

  return {
    amounts: Array.from(amounts.values()),
    prices: Array.from(prices.values()),
  }
}

export function createAmountConfig(
  formula:
    | BalanceOfEscrowAmountFormula
    | TotalSupplyAmountFormula
    | CirculatingSupplyAmountFormula,
): AmountConfig {
  switch (formula.type) {
    case 'balanceOfEscrow':
      return {
        id: hash([
          formula.type,
          formula.address,
          formula.chain,
          formula.decimals.toString(),
          formula.escrowAddress,
        ]),
        ...formula,
      }
    case 'totalSupply':
      return {
        id: hash([
          formula.type,
          formula.address,
          formula.chain,
          formula.decimals.toString(),
        ]),
        ...formula,
      }
    case 'circulatingSupply':
      return {
        id: hash([formula.type, formula.apiId]),
        ...formula,
      }
  }
}

function processFormulaRecursive(
  formula: CalculationFormula | ValueFormula | AmountFormula,
): {
  formulaAmounts: AmountConfig[]
  formulaPrices: PriceConfig[]
} {
  const formulaAmounts: AmountConfig[] = []
  const formulaPrices: PriceConfig[] = []

  if (formula.type === 'calculation') {
    for (const arg of formula.arguments) {
      const {
        formulaAmounts: innerFormulaAmounts,
        formulaPrices: innerFormulaPrices,
      } = processFormulaRecursive(arg)
      formulaAmounts.push(...innerFormulaAmounts)
      formulaPrices.push(...innerFormulaPrices)
    }
  } else if (formula.type === 'value') {
    const {
      formulaAmounts: innerFormulaAmounts,
      formulaPrices: innerFormulaPrices,
    } = processFormulaRecursive(formula.amount)
    formulaAmounts.push(...innerFormulaAmounts)
    formulaPrices.push(...innerFormulaPrices)

    assert(
      formulaPrices.length === 0,
      'Amount formula should not have any prices',
    )

    const amountFormulaRange = getTimestampsRange(
      ...innerFormulaAmounts.map((a) => ({
        sinceTimestamp: a.sinceTimestamp,
        untilTimestamp: a.untilTimestamp,
      })),
    )

    formulaPrices.push({
      priceId: formula.priceId,
      sinceTimestamp: amountFormulaRange.sinceTimestamp,
      untilTimestamp: amountFormulaRange.untilTimestamp,
    })
  } else if (formula.type !== 'const') {
    const amount = createAmountConfig(formula)
    formulaAmounts.push(amount)
  }

  return { formulaAmounts, formulaPrices }
}

export function hash(input: string[]): string {
  const hash = createHash('sha1').update(input.join('')).digest('hex')
  return hash.slice(0, 12)
}

async function getChains() {
  const ps = new ProjectService()
  const chains = (await ps.getProjects({ select: ['chainConfig'] })).map(
    (p) => p.chainConfig,
  )
  return new Map(chains.map((c) => [c.name, c]))
}

function setPrice(prices: Map<string, PriceConfig>, priceToAdd: PriceConfig) {
  const existingPrice = prices.get(priceToAdd.priceId)
  if (!existingPrice) {
    prices.set(priceToAdd.priceId, priceToAdd)
    return
  }

  const mergedPrice: PriceConfig = {
    ...existingPrice,
    sinceTimestamp: Math.min(
      priceToAdd.sinceTimestamp,
      existingPrice.sinceTimestamp,
    ),
  }

  // set untilTimestamp only if both prices have it
  if (priceToAdd.untilTimestamp && existingPrice.untilTimestamp) {
    mergedPrice.untilTimestamp = Math.max(
      priceToAdd.untilTimestamp,
      existingPrice.untilTimestamp,
    )
  } else {
    mergedPrice.untilTimestamp = undefined
  }

  prices.set(mergedPrice.priceId, mergedPrice)
}

function setAmount(
  amounts: Map<string, AmountConfig>,
  amountToAdd: AmountConfig,
) {
  const existingAmount = amounts.get(amountToAdd.id)
  if (!existingAmount) {
    amounts.set(amountToAdd.id, amountToAdd)
    return
  }

  const mergedAmount: AmountConfig = {
    ...existingAmount,
    sinceTimestamp: Math.min(
      amountToAdd.sinceTimestamp,
      amountToAdd.sinceTimestamp,
    ),
  }

  // set untilTimestamp only if both prices have it
  if (amountToAdd.untilTimestamp && existingAmount.untilTimestamp) {
    mergedAmount.untilTimestamp = Math.max(
      amountToAdd.untilTimestamp,
      existingAmount.untilTimestamp,
    )
  } else {
    mergedAmount.untilTimestamp = undefined
  }

  amounts.set(mergedAmount.id, mergedAmount)
}
