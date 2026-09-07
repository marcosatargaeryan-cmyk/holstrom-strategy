import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import DLMM, { StrategyType } from '@meteora-ag/dlmm';
import BN from 'bn.js';
import Decimal from 'decimal.js';

// Token decimals
const SOL_DECIMALS = 9;
const USDC_DECIMALS = 6;

// Allowed slippage in BPS (100 = 1%)
const DEFAULT_SLIPPAGE_BPS = 100;

export interface DLMMPoolState {
  address: PublicKey;
  activeBinId: number;
  currentPrice: number;   // in USDC per SOL
  binStep: number;
  tokenXMint: PublicKey;  // SOL
  tokenYMint: PublicKey;  // USDC
}

export interface SwapResult {
  inAmount: BN;
  outAmount: BN;
  fee: BN;
  priceImpact: number;
  binArraysPubkey: PublicKey[];
}

export interface PositionResult {
  positionPubkey: PublicKey;
  positionKeypair: Keypair;
  lowerBinId: number;
  upperBinId: number;
  depositedUSDC: BN;
}

export class MeteoraDLMMIntegration {
  private connection: Connection;
  private wallet: Keypair;
  private poolAddress: PublicKey;
  private dlmm: any = null;

  constructor(connection: Connection, wallet: Keypair, poolAddress: PublicKey) {
    this.connection = connection;
    this.wallet = wallet;
    this.poolAddress = poolAddress;
  }

  // ─── Initialization ────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    console.log('Initializing Meteora DLMM SDK...');
    this.dlmm = await DLMM.create(this.connection, this.poolAddress);
    console.log(`✓ Meteora DLMM initialized — pool: ${this.poolAddress.toString()}`);
    console.log(`  binStep: ${(this.dlmm.lbPair as any).binStep ?? 'n/a'}`);
  }

  private async getDLMM(): Promise<any> {
    if (!this.dlmm) await this.initialize();
    return this.dlmm!;
  }

  // ─── Pool State ─────────────────────────────────────────────────────────────

  async getPoolState(): Promise<DLMMPoolState> {
    const dlmm = await this.getDLMM();
    const activeBin = await dlmm.getActiveBin();

    // pricePerToken is a human-readable price string (USDC per SOL)
    const currentPrice = parseFloat(activeBin.pricePerToken);

    return {
      address: this.poolAddress,
      activeBinId: activeBin.binId,
      currentPrice,
      binStep: (dlmm.lbPair as any).binStep ?? (dlmm.lbPair as any).parameters?.baseFactor,
      tokenXMint: dlmm.tokenX.publicKey,
      tokenYMint: dlmm.tokenY.publicKey,
    };
  }

  async getPoolPrice(): Promise<number> {
    const state = await this.getPoolState();
    console.log(`Meteora Pool A price: $${state.currentPrice.toFixed(6)}`);
    return state.currentPrice;
  }

  // ─── Dynamic Calculation ────────────────────────────────────────────────────

  /**
   * Calculate how much SOL (in whole units) is needed to move the active bin
   * from fromPrice down to toPrice.
   *
   * Uses actual per-bin liquidity data fetched from the SDK via
   * `getBinsBetweenLowerAndUpperBound()`.  For each bin in the range we sum
   * the X-reserve (SOL side).  This is far more accurate than the earlier
   * divide-by-1000 heuristic because liquidity is not uniformly distributed.
   *
   * Falls back to the heuristic if the SDK call fails (e.g. pool offline).
   */
  async calculateRequiredSOLForPriceMovement(
    fromPrice: number,
    toPrice: number
  ): Promise<number> {
    const dlmm = await this.getDLMM();

    // Determine bin IDs — round so we include the boundary bins
    const fromBinId = dlmm.getBinIdFromPrice(Math.max(fromPrice, toPrice), false);
    const toBinId   = dlmm.getBinIdFromPrice(Math.min(fromPrice, toPrice), true);
    const numBins   = Math.abs(fromBinId - toBinId);

    try {
      // Fetch actual per-bin data for the price range
      const { bins } = await dlmm.getBinsBetweenLowerAndUpperBound(
        toBinId,
        fromBinId,
        undefined // use default limit
      );

      // Sum the X (SOL) reserves across all bins in range
      let totalLamports = new BN(0);
      for (const bin of bins) {
        // bin.xAmount is the SOL reserve in that bin (lamports as string/BN)
        const xAmt = new BN((bin as any).xAmount?.toString() ?? '0');
        totalLamports = totalLamports.add(xAmt);
      }

      const result = totalLamports.toNumber() / 10 ** SOL_DECIMALS;
      console.log(
        `SOL needed to traverse ${bins.length} bins ($${fromPrice.toFixed(4)} → $${toPrice.toFixed(4)}): ${result.toFixed(4)} SOL (actual per-bin data)`
      );
      return result;

    } catch (err) {
      // Fallback: distribute total X reserve uniformly across ±500 bins
      console.warn('getBinsBetweenLowerAndUpperBound failed, using reserve heuristic:', String(err).split('\n')[0]);
      const xReserve   = new BN(dlmm.tokenX.amount.toString());
      const activeBins = 1000;
      const solPerBin  = xReserve.divn(activeBins);
      const totalSOL   = solPerBin.muln(numBins).toNumber() / 10 ** SOL_DECIMALS;
      console.log(
        `SOL needed to move ${numBins} bins ($${fromPrice.toFixed(4)} → $${toPrice.toFixed(4)}): ${totalSOL.toFixed(4)} SOL (heuristic fallback)`
      );
      return totalSOL;
    }
  }

  // ─── Swap ────────────────────────────────────────────────────────────────────

  // ─── Swap ────────────────────────────────────────────────────────────────────

  /**
   * Build and send a real swap on Meteora DLMM.
   * Returns the transaction signature.
   */
  async executeSwap(
    inputAmountSol: number,
    swapForY: boolean  // true = SOL→USDC, false = USDC→SOL
  ): Promise<string> {
    const dlmm = await this.getDLMM();

    const inAmountBN = new BN(Math.floor(inputAmountSol * 10 ** SOL_DECIMALS));
    const slippageBN = new BN(DEFAULT_SLIPPAGE_BPS);

    // Fetch bin arrays needed for the swap
    const binArrays = await dlmm.getBinArrayForSwap(swapForY);

    // Get quote
    const quote = dlmm.swapQuote(inAmountBN, swapForY, slippageBN, binArrays);
    console.log(
      `Swap quote: ${inAmountBN.toString()} → ${quote.outAmount.toString()} (fee: ${quote.fee.toString()})`
    );

    // Build swap transaction
    const swapTx = await dlmm.swap({
      inToken:       swapForY ? dlmm.tokenX.publicKey : dlmm.tokenY.publicKey,
      outToken:      swapForY ? dlmm.tokenY.publicKey : dlmm.tokenX.publicKey,
      inAmount:      inAmountBN,
      minOutAmount:  quote.minOutAmount,
      lbPair:        this.poolAddress,
      user:          this.wallet.publicKey,
      binArraysPubkey: quote.binArraysPubkey,
    });

    const sig = await sendAndConfirmTransaction(this.connection, swapTx, [this.wallet]);
    console.log(`✓ Meteora swap confirmed: ${sig}`);
    return sig;
  }

  /**
   * Build all swap instructions without sending — returns the full instruction
   * list for inclusion in an atomic transaction.
   * Meteora swap transactions typically include compute-budget + bin-array
   * setup + the swap itself; we return ALL of them to avoid missing required
   * prerequisite instructions.
   * Returns an empty array if the quote fails.
   */
  async buildSwapInstructions(
    inputAmountSol: number,
    swapForY: boolean
  ): Promise<TransactionInstruction[]> {
    try {
      const dlmm = await this.getDLMM();
      const inAmountBN = new BN(Math.floor(inputAmountSol * 10 ** SOL_DECIMALS));
      const slippageBN = new BN(DEFAULT_SLIPPAGE_BPS);

      const binArrays = await dlmm.getBinArrayForSwap(swapForY);
      const quote = dlmm.swapQuote(inAmountBN, swapForY, slippageBN, binArrays);

      const swapTx = await dlmm.swap({
        inToken:         swapForY ? dlmm.tokenX.publicKey : dlmm.tokenY.publicKey,
        outToken:        swapForY ? dlmm.tokenY.publicKey : dlmm.tokenX.publicKey,
        inAmount:        inAmountBN,
        minOutAmount:    quote.minOutAmount,
        lbPair:          this.poolAddress,
        user:            this.wallet.publicKey,
        binArraysPubkey: quote.binArraysPubkey,
      });

      const ixs = swapTx.instructions;
      console.log(`✓ Meteora swap instructions built (${ixs.length} ixs, swapForY=${swapForY}, amount=${inputAmountSol})`);
      return ixs;
    } catch (err) {
      console.error('buildSwapInstructions failed:', err);
      return [];
    }
  }

  /** @deprecated Use buildSwapInstructions (plural) to get all required instructions. */
  async buildSwapInstruction(
    inputAmountSol: number,
    swapForY: boolean
  ): Promise<TransactionInstruction | null> {
    const ixs = await this.buildSwapInstructions(inputAmountSol, swapForY);
    return ixs[0] ?? null;
  }

  // ─── DLMM Position ──────────────────────────────────────────────────────────

  /**
   * Open a DLMM position depositing USDC-only in the range [lowerBoundPrice, upperBoundPrice].
   * The caller supplies `positionKeypair` so that the same keypair can be
   * retained and used later in the withdraw step.
   */
  async openDLMMPosition(
    lowerBoundPrice: number,
    upperBoundPrice: number,
    usdcAmount: number,
    positionKeypair: Keypair
  ): Promise<PositionResult> {
    const dlmm = await this.getDLMM();

    // Derive bin IDs from prices
    const lowerBinId = dlmm.getBinIdFromPrice(lowerBoundPrice, true);
    const upperBinId = dlmm.getBinIdFromPrice(upperBoundPrice, false);
    console.log(`Opening DLMM position bins [${lowerBinId}, ${upperBinId}] (prices $${lowerBoundPrice}–$${upperBoundPrice})`);

    const usdcAmountBN = new BN(Math.floor(usdcAmount * 10 ** USDC_DECIMALS));

    const tx = await dlmm.initializePositionAndAddLiquidityByStrategy({
      positionPubKey:  positionKeypair.publicKey,
      totalXAmount:    new BN(0),          // SOL side: 0 (USDC-only position)
      totalYAmount:    usdcAmountBN,
      strategy: {
        minBinId:     lowerBinId,
        maxBinId:     upperBinId,
        strategyType: 0, // Spot
      },
      user:    this.wallet.publicKey,
      slippage: DEFAULT_SLIPPAGE_BPS / 10000,
    });

    const sig = await sendAndConfirmTransaction(
      this.connection,
      tx,
      [this.wallet, positionKeypair]
    );
    console.log(`✓ DLMM position opened: ${positionKeypair.publicKey.toString()} — tx: ${sig}`);

    return {
      positionPubkey: positionKeypair.publicKey,
      positionKeypair,
      lowerBinId,
      upperBinId,
      depositedUSDC: usdcAmountBN,
    };
  }

  /**
   * Build all position-open instructions for atomic use.
   * The caller must supply the `positionKeypair` that will also be used as a
   * signer on the transaction and reused for the withdraw step.
   *
   * Returns all instructions from the SDK-built transaction (not just [0]).
   * Returns an empty array if the call fails.
   */
  async buildPositionInstructions(
    lowerBoundPrice: number,
    upperBoundPrice: number,
    usdcAmount: number,
    positionKeypair: Keypair
  ): Promise<TransactionInstruction[]> {
    try {
      const dlmm = await this.getDLMM();
      const lowerBinId = dlmm.getBinIdFromPrice(lowerBoundPrice, true);
      const upperBinId = dlmm.getBinIdFromPrice(upperBoundPrice, false);

      const usdcAmountBN = new BN(Math.floor(usdcAmount * 10 ** USDC_DECIMALS));

      const tx = await dlmm.initializePositionAndAddLiquidityByStrategy({
        positionPubKey:  positionKeypair.publicKey,
        totalXAmount:    new BN(0),
        totalYAmount:    usdcAmountBN,
        strategy: {
          minBinId:     lowerBinId,
          maxBinId:     upperBinId,
          strategyType: 0, // Spot
        },
        user:    this.wallet.publicKey,
        slippage: DEFAULT_SLIPPAGE_BPS / 10000,
      });

      const ixs = tx.instructions;
      console.log(`✓ DLMM position instructions built (${ixs.length} ixs) for range [$${lowerBoundPrice}–$${upperBoundPrice}]`);
      return ixs;
    } catch (err) {
      console.error('buildPositionInstructions failed:', err);
      return [];
    }
  }

  /** @deprecated Use buildPositionInstructions (plural) to get all required instructions. */
  async buildPositionInstruction(
    lowerBoundPrice: number,
    upperBoundPrice: number,
    usdcAmount: number
  ): Promise<TransactionInstruction | null> {
    const positionKeypair = Keypair.generate();
    const ixs = await this.buildPositionInstructions(lowerBoundPrice, upperBoundPrice, usdcAmount, positionKeypair);
    return ixs[0] ?? null;
  }

  // ─── Withdraw Position ───────────────────────────────────────────────────────

  /**
   * Withdraw an entire DLMM position (100% bps) and optionally close it.
   */
  async withdrawDLMMPosition(
    positionPubkey: PublicKey,
    positionResult: PositionResult
  ): Promise<string> {
    const dlmm = await this.getDLMM();

    const txs = await dlmm.removeLiquidity({
      user:               this.wallet.publicKey,
      position:           positionPubkey,
      fromBinId:          positionResult.lowerBinId,
      toBinId:            positionResult.upperBinId,
      bps:                new BN(10000), // 100%
      shouldClaimAndClose: true,
    });

    let lastSig = '';
    for (const tx of txs) {
      lastSig = await sendAndConfirmTransaction(this.connection, tx, [this.wallet]);
      console.log(`✓ DLMM withdraw tx confirmed: ${lastSig}`);
    }
    return lastSig;
  }

  /**
   * Build all withdraw instructions for atomic use.
   * Returns all instructions from each transaction produced by `removeLiquidity`.
   * Returns an empty array if the call fails.
   */
  async buildWithdrawInstructions(
    positionPubkey: PublicKey,
    positionResult: PositionResult
  ): Promise<TransactionInstruction[]> {
    try {
      const dlmm = await this.getDLMM();

      const txs = await dlmm.removeLiquidity({
        user:               this.wallet.publicKey,
        position:           positionPubkey,
        fromBinId:          positionResult.lowerBinId,
        toBinId:            positionResult.upperBinId,
        bps:                new BN(10000), // 100%
        shouldClaimAndClose: true,
      });

      // Collect all instructions from all transactions in the batch
      const allIxs: TransactionInstruction[] = [];
      for (const tx of txs) {
        allIxs.push(...tx.instructions);
      }

      if (allIxs.length === 0) return [];
      console.log(`✓ DLMM withdraw instructions built (${allIxs.length} ixs across ${txs.length} txs)`);
      return allIxs;
    } catch (err) {
      console.error('buildWithdrawInstructions failed:', err);
      return [];
    }
  }

  /** @deprecated Use buildWithdrawInstructions (plural) to get all required instructions. */
  async buildWithdrawInstruction(
    positionPubkey: PublicKey,
    positionResult: PositionResult
  ): Promise<TransactionInstruction | null> {
    const ixs = await this.buildWithdrawInstructions(positionPubkey, positionResult);
    return ixs[0] ?? null;
  }
}

// ─── Quick Integration Test ──────────────────────────────────────────────────

export async function testMeteoraIntegration(
  connection: Connection,
  wallet: Keypair,
  poolAddress: PublicKey
): Promise<void> {
  console.log('=== Testing Meteora DLMM Integration ===\n');
  const meteora = new MeteoraDLMMIntegration(connection, wallet, poolAddress);

  try {
    await meteora.initialize();

    const state = await meteora.getPoolState();
    console.log('Pool state:', {
      activeBinId: state.activeBinId,
      currentPrice: `$${state.currentPrice.toFixed(6)}`,
      binStep:      state.binStep,
    });

    const requiredSOL = await meteora.calculateRequiredSOLForPriceMovement(
      state.currentPrice,
      state.currentPrice * 0.70  // 30% drawdown
    );
    console.log(`SOL for 30% drawdown: ${requiredSOL.toFixed(4)} SOL`);

    console.log('\n✅ Meteora DLMM integration test completed');
  } catch (error) {
    console.error('❌ Meteora DLMM integration test failed:', error);
  }
}
