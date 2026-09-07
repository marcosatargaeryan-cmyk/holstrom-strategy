import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil,
  swapQuoteByInputToken,
  TickArrayUtil,
  PriceMath,
} from '@orca-so/whirlpools-sdk';
import { AnchorProvider } from '@coral-xyz/anchor';
import NodeWallet from '@coral-xyz/anchor/dist/cjs/nodewallet';
import { Percentage } from '@orca-so/common-sdk';
import BN from 'bn.js';
import Decimal from 'decimal.js';

// SOL = tokenA (9 dec), USDC = tokenB (6 dec) in the SOL/USDC Whirlpool
const SOL_DECIMALS  = 9;
const USDC_DECIMALS = 6;

// Default 1% slippage tolerance
const DEFAULT_SLIPPAGE = Percentage.fromFraction(1, 100);

export interface WhirlpoolState {
  address:       PublicKey;
  currentPrice:  number;   // USDC per SOL
  tickSpacing:   number;
  sqrtPriceX64:  BN;
  tokenMintA:    PublicKey;
  tokenMintB:    PublicKey;
  tokenVaultA:   PublicKey;
  tokenVaultB:   PublicKey;
}

export interface OrcaSwapQuote {
  estimatedAmountIn:  BN;
  estimatedAmountOut: BN;
  estimatedFeeAmount: BN;
  otherAmountThreshold: BN;
  aToB: boolean;
}

export class OrcaWhirlpoolIntegration {
  private connection: Connection;
  private wallet:     Keypair;
  private poolAddress: PublicKey;
  private ctx: WhirlpoolContext | null = null;

  constructor(connection: Connection, wallet: Keypair, poolAddress: PublicKey) {
    this.connection  = connection;
    this.wallet      = wallet;
    this.poolAddress = poolAddress;
  }

  // ─── Initialization ────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    console.log('Initializing Orca Whirlpool SDK...');

    // AnchorProvider wraps Connection + NodeWallet (Keypair-based signer)
    const nodeWallet = new NodeWallet(this.wallet);
    // WhirlpoolContext.withProvider requires an AnchorProvider, not raw Connection
    const provider   = new AnchorProvider(
      this.connection,
      nodeWallet,
      { commitment: 'confirmed' }
    );

    this.ctx = WhirlpoolContext.withProvider(
      provider,
      undefined,    // use default fetcher
      undefined,    // no lookup table fetcher
      {},           // default opts
      ORCA_WHIRLPOOL_PROGRAM_ID
    );

    console.log(`✓ Orca Whirlpool context created`);
    console.log(`  Pool: ${this.poolAddress.toString()}`);
  }

  private async getCtx(): Promise<WhirlpoolContext> {
    if (!this.ctx) await this.initialize();
    return this.ctx!;
  }

  // ─── Pool State ─────────────────────────────────────────────────────────────

  async getPoolState(): Promise<WhirlpoolState> {
    const ctx    = await this.getCtx();
    const client = buildWhirlpoolClient(ctx);
    const pool   = await client.getPool(this.poolAddress);
    const data   = pool.getData();

    // Parse price: SOL is tokenA (9 dec), USDC is tokenB (6 dec)
    const price = PriceMath.sqrtPriceX64ToPrice(
      data.sqrtPrice,
      SOL_DECIMALS,
      USDC_DECIMALS
    );

    return {
      address:      this.poolAddress,
      currentPrice: price.toNumber(),
      tickSpacing:  data.tickSpacing,
      sqrtPriceX64: data.sqrtPrice,
      tokenMintA:   data.tokenMintA,
      tokenMintB:   data.tokenMintB,
      tokenVaultA:  data.tokenVaultA,
      tokenVaultB:  data.tokenVaultB,
    };
  }

  async getPoolPrice(): Promise<number> {
    const state = await this.getPoolState();
    console.log(`Orca Pool B price: $${state.currentPrice.toFixed(6)}`);
    return state.currentPrice;
  }

  // ─── Swap Quote ─────────────────────────────────────────────────────────────

  /**
   * Get a swap quote.
   * @param inputAmountSol  Amount of SOL to sell (aToB = true) or SOL to buy (aToB = false)
   * @param aToB            true  = SOL → USDC
   *                        false = USDC → SOL
   */
  async getSwapQuote(
    inputAmountSol: number,
    aToB: boolean
  ): Promise<OrcaSwapQuote> {
    const ctx    = await this.getCtx();
    const client = buildWhirlpoolClient(ctx);
    const pool   = await client.getPool(this.poolAddress);
    const data   = pool.getData();

    // Input amount in lamports (SOL→USDC) or micro-USDC (USDC→SOL)
    const inputDec  = aToB ? SOL_DECIMALS : USDC_DECIMALS;
    const inputBN   = new BN(Math.floor(inputAmountSol * 10 ** inputDec));
    const inputMint = aToB ? data.tokenMintA : data.tokenMintB;

    const quote = await swapQuoteByInputToken(
      pool,
      inputMint,
      inputBN,
      DEFAULT_SLIPPAGE,
      ORCA_WHIRLPOOL_PROGRAM_ID,
      ctx.fetcher
    );

    return {
      estimatedAmountIn:    quote.estimatedAmountIn,
      estimatedAmountOut:   quote.estimatedAmountOut,
      estimatedFeeAmount:   quote.estimatedFeeAmount,
      otherAmountThreshold: quote.otherAmountThreshold,
      aToB:                 quote.aToB,
    };
  }

  // ─── Execute Swap ────────────────────────────────────────────────────────────

  /**
   * Execute a real swap on the Orca Whirlpool.  Returns the tx signature.
   */
  async executeSwap(
    inputAmountSol: number,
    aToB: boolean
  ): Promise<string> {
    const ctx    = await this.getCtx();
    const client = buildWhirlpoolClient(ctx);
    const pool   = await client.getPool(this.poolAddress);
    const data   = pool.getData();

    const inputDec  = aToB ? SOL_DECIMALS : USDC_DECIMALS;
    const inputBN   = new BN(Math.floor(inputAmountSol * 10 ** inputDec));
    const inputMint = aToB ? data.tokenMintA : data.tokenMintB;

    const quote = await swapQuoteByInputToken(
      pool,
      inputMint,
      inputBN,
      DEFAULT_SLIPPAGE,
      ORCA_WHIRLPOOL_PROGRAM_ID,
      ctx.fetcher
    );

    console.log(
      `Orca swap: ${inputBN.toString()} → ${quote.estimatedAmountOut.toString()} ` +
      `(fee: ${quote.estimatedFeeAmount.toString()})`
    );

    const txBuilder = await pool.swap(quote, this.wallet.publicKey);
    const { transaction, signers } = await txBuilder.build();

    if (!(transaction instanceof Transaction)) {
      throw new Error('Expected legacy Transaction from Orca swap builder');
    }

    const sig = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.wallet, ...signers]
    );
    console.log(`✓ Orca swap confirmed: ${sig}`);
    return sig;
  }

  // ─── Build Instructions ───────────────────────────────────────────────────────

  /**
   * Build ALL swap instructions for inclusion in an atomic transaction.
   * Orca swap transactions often include compute-budget, token-account setup,
   * and the swap itself — returning only instructions[0] would miss required
   * prerequisites.  This method returns the full instruction list.
   * Returns an empty array if the quote/build fails.
   */
  async buildSwapInstructions(
    inputAmountSol: number,
    aToB: boolean
  ): Promise<TransactionInstruction[]> {
    try {
      const ctx    = await this.getCtx();
      const client = buildWhirlpoolClient(ctx);
      const pool   = await client.getPool(this.poolAddress);
      const data   = pool.getData();

      const inputDec  = aToB ? SOL_DECIMALS : USDC_DECIMALS;
      const inputBN   = new BN(Math.floor(inputAmountSol * 10 ** inputDec));
      const inputMint = aToB ? data.tokenMintA : data.tokenMintB;

      const quote = await swapQuoteByInputToken(
        pool,
        inputMint,
        inputBN,
        DEFAULT_SLIPPAGE,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        ctx.fetcher
      );

      const txBuilder = await pool.swap(quote, this.wallet.publicKey);
      const { transaction, signers } = await txBuilder.build();

      // Handle both legacy and versioned transactions
      let ixs: TransactionInstruction[];
      if (transaction instanceof Transaction) {
        ixs = transaction.instructions;
      } else if (transaction instanceof VersionedTransaction) {
        // Convert versioned transaction to legacy instructions
        const message = TransactionMessage.decompile(transaction.message);
        ixs = message.instructions;
        console.log('✓ Converted Orca versioned transaction to legacy instructions');
      } else {
        console.warn('buildSwapInstructions: unexpected transaction type from Orca, returning empty');
        return [];
      }

      console.log(`✓ Orca swap instructions built (${ixs.length} ixs, aToB=${aToB}, amount=${inputAmountSol})`);
      return ixs;
    } catch (err) {
      console.error('buildSwapInstructions failed:', err);
      return [];
    }
  }

  /** @deprecated Use buildSwapInstructions (plural) to get all required instructions. */
  async buildSwapInstruction(
    inputAmountSol: number,
    aToB: boolean
  ): Promise<TransactionInstruction | null> {
    const ixs = await this.buildSwapInstructions(inputAmountSol, aToB);
    return ixs[0] ?? null;
  }

  // ─── Tick Array Derivation ───────────────────────────────────────────────────

  /**
   * Derive the three tick array accounts needed for a swap at the current tick.
   * These are required to be passed in the swap instruction accounts list.
   */
  async getTickArrayAccountsForSwap(aToB: boolean): Promise<PublicKey[]> {
    const ctx  = await this.getCtx();
    const data = await ctx.fetcher.getPool(this.poolAddress);
    if (!data) throw new Error('Pool data not found');

    const tickSpacing   = data.tickSpacing;
    const currentTick   = data.tickCurrentIndex;
    const programId     = ORCA_WHIRLPOOL_PROGRAM_ID;
    const whirlpool     = this.poolAddress;

    // Get 3 sequential tick array PDAs in the swap direction
    const pdas = TickArrayUtil.getTickArrayPDAs(
      currentTick,
      tickSpacing,
      3,
      programId,
      whirlpool,
      aToB
    );

    const pubkeys = pdas.map(p => p.publicKey);
    console.log(`Tick arrays for swap (aToB=${aToB}):`, pubkeys.map(p => p.toString()));
    return pubkeys;
  }
}

// ─── Quick Integration Test ──────────────────────────────────────────────────

export async function testOrcaIntegration(
  connection: Connection,
  wallet: Keypair,
  poolAddress: PublicKey
): Promise<void> {
  console.log('=== Testing Orca Whirlpool Integration ===\n');
  const orca = new OrcaWhirlpoolIntegration(connection, wallet, poolAddress);

  try {
    await orca.initialize();

    const state = await orca.getPoolState();
    console.log('Pool state:', {
      currentPrice: `$${state.currentPrice.toFixed(6)}`,
      tickSpacing:  state.tickSpacing,
    });

    const quote = await orca.getSwapQuote(1.0, true);
    const outUsdc = quote.estimatedAmountOut.toNumber() / 10 ** USDC_DECIMALS;
    console.log(`Quote: 1 SOL → $${outUsdc.toFixed(4)} USDC`);

    const tickArrays = await orca.getTickArrayAccountsForSwap(true);
    console.log(`Tick arrays derived: ${tickArrays.length}`);

    console.log('\n✅ Orca Whirlpool integration test completed');
  } catch (error) {
    console.error('❌ Orca Whirlpool integration test failed:', error);
  }
}
