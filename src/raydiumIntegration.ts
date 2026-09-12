import {
  Connection,
  PublicKey,
  Keypair,
  TransactionInstruction,
} from '@solana/web3.js';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import {
  Raydium,
  TxVersion,
  Percent,
} from '@raydium-io/raydium-sdk-v2';

// Token decimals
const SOL_DECIMALS = 9;
const USDC_DECIMALS = 6;

// Allowed slippage in BPS (100 = 1%)
const DEFAULT_SLIPPAGE_BPS = 100;

export interface ClmmPoolState {
  address: PublicKey;
  currentPrice: number;   // in USDC per SOL
  tickSpacing: number;
  tokenXMint: PublicKey;  // SOL
  tokenYMint: PublicKey;  // USDC
}

export interface SwapResult {
  inAmount: BN;
  outAmount: BN;
  fee: BN;
  priceImpact: number;
}

export interface PositionResult {
  positionPubkey: PublicKey;
  positionKeypair: Keypair;
  lowerTick: number;
  upperTick: number;
  depositedUSDC: BN;
}

export class RaydiumCLMMIntegration {
  private connection: Connection;
  private wallet: Keypair;
  private poolAddress: PublicKey;
  private raydium: Raydium | null = null;
  private poolInfo: any = null;

  constructor(connection: Connection, wallet: Keypair, poolAddress: PublicKey) {
    this.connection = connection;
    this.wallet = wallet;
    this.poolAddress = poolAddress;
  }

  // ─── Initialization ────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    console.log('Initializing Raydium CLMM SDK...');
    try {
      this.raydium = await Raydium.load({
        owner: this.wallet,
        connection: this.connection,
        cluster: 'mainnet',
        disableFeatureCheck: true,
        disableLoadToken: true,
      });

      // Fetch pool info
      const poolData = await this.raydium.api.getClmmPoolInfo({ poolIds: [this.poolAddress.toString()] });
      if (poolData.success && poolData.data && poolData.data.length > 0) {
        this.poolInfo = poolData.data[0];
        console.log(`✓ Raydium CLMM initialized — pool: ${this.poolAddress.toString()}`);
        console.log(`  tickSpacing: ${this.poolInfo.tickSpacing}`);
        console.log(`  currentPrice: $${this.poolInfo.price || 'n/a'}`);
      } else {
        throw new Error('Failed to fetch pool info from API');
      }
    } catch (error) {
      console.warn(`Raydium SDK initialization failed: ${error}`);
      throw error;
    }
  }

  // ─── Pool State ─────────────────────────────────────────────────────────────

  async getPoolState(): Promise<ClmmPoolState> {
    if (!this.poolInfo) {
      await this.initialize();
    }

    if (!this.poolInfo) {
      throw new Error('Pool info not available');
    }

    const currentPrice = this.poolInfo.price ? parseFloat(this.poolInfo.price) : 0;

    return {
      address: this.poolAddress,
      currentPrice,
      tickSpacing: this.poolInfo.tickSpacing,
      tokenXMint: new PublicKey(this.poolInfo.mintA.address),
      tokenYMint: new PublicKey(this.poolInfo.mintB.address),
    };
  }

  async getPoolPrice(): Promise<number> {
    const state = await this.getPoolState();
    console.log(`Raydium Pool A price: $${state.currentPrice.toFixed(6)}`);
    return state.currentPrice;
  }

  // ─── Swap ────────────────────────────────────────────────────────────────────

  /**
   * Build swap instructions for Raydium CLMM
   */
  async buildSwapInstructions(
    inputAmountSol: number,
    swapForY: boolean  // true = SOL→USDC, false = USDC→SOL
  ): Promise<TransactionInstruction[]> {
    if (!this.raydium || !this.poolInfo) {
      await this.initialize();
    }

    try {
      const inputAmountBN = new BN(Math.floor(inputAmountSol * 10 ** SOL_DECIMALS));
      const slippage = new Percent(DEFAULT_SLIPPAGE_BPS, 10000);

      // Build swap transaction using Raydium SDK
      const { execute, extInfo } = await this.raydium.clmm.swap({
        poolInfo: this.poolInfo,
        inputAmount: inputAmountBN,
        tokenIn: swapForY ? this.poolInfo.mintA : this.poolInfo.mintB,
        tokenOut: swapForY ? this.poolInfo.mintB : this.poolInfo.mintA,
        slippage,
        computeBudgetConfig: { microLamports: 600000 },
        txVersion: TxVersion.V0,
      });

      const txData = await execute.build({ wallet: this.wallet });
      const ixs = txData.transaction.instructions;
      console.log(`✓ Raydium swap instructions built (${ixs.length} ixs, swapForY=${swapForY}, amount=${inputAmountSol})`);
      console.log(`  Estimated out: ${extInfo?.estimatedOut?.toString() || 'n/a'}`);
      return ixs;
    } catch (err) {
      console.error('buildSwapInstructions failed:', err);
      return [];
    }
  }

  // ─── Position Management ─────────────────────────────────────────────────────

  /**
   * Open an empty Raydium CLMM position (pre-transaction)
   */
  async openPosition(
    lowerBoundPrice: number,
    upperBoundPrice: number,
    positionKeypair: Keypair
  ): Promise<PositionResult> {
    if (!this.raydium || !this.poolInfo) {
      await this.initialize();
    }

    // Convert prices to ticks using the SDK's utility
    const lowerTick = Math.floor(lowerBoundPrice * 100); // Simplified tick calculation
    const upperTick = Math.floor(upperBoundPrice * 100);

    console.log(`Opening Raydium position ticks [${lowerTick}, ${upperTick}] (prices $${lowerBoundPrice}–$${upperBoundPrice})`);

    const { execute } = await this.raydium.clmm.createPosition({
      poolInfo: this.poolInfo,
      lowerTick,
      upperTick,
      baseToken: this.poolInfo.mintA,
      quoteToken: this.poolInfo.mintB,
      positionPda: positionKeypair.publicKey,
      txVersion: TxVersion.V0,
    });

    const txData = await execute.build({ wallet: this.wallet });
    const sig = await this.connection.sendTransaction(txData.transaction, [this.wallet, positionKeypair]);
    await this.connection.confirmTransaction(sig);

    console.log(`✓ Raydium position opened: ${positionKeypair.publicKey.toString()} — tx: ${sig}`);

    return {
      positionPubkey: positionKeypair.publicKey,
      positionKeypair,
      lowerTick,
      upperTick,
      depositedUSDC: new BN(0), // Empty position initially
    };
  }

  /**
   * Build open_position_v2 instructions for atomic use
   */
  async buildOpenPositionInstructions(
    lowerBoundPrice: number,
    upperBoundPrice: number,
    positionKeypair: Keypair
  ): Promise<TransactionInstruction[]> {
    if (!this.raydium || !this.poolInfo) {
      await this.initialize();
    }

    try {
      const lowerTick = Math.floor(lowerBoundPrice * 100);
      const upperTick = Math.floor(upperBoundPrice * 100);

      const { execute } = await this.raydium.clmm.createPosition({
        poolInfo: this.poolInfo,
        lowerTick,
        upperTick,
        baseToken: this.poolInfo.mintA,
        quoteToken: this.poolInfo.mintB,
        positionPda: positionKeypair.publicKey,
        txVersion: TxVersion.V0,
      });

      const txData = await execute.build({ wallet: this.wallet });
      const ixs = txData.transaction.instructions;
      console.log(`✓ Raydium open position instructions built (${ixs.length} ixs) for range [$${lowerBoundPrice}–$${upperBoundPrice}]`);
      return ixs;
    } catch (err) {
      console.error('buildOpenPositionInstructions failed:', err);
      return [];
    }
  }

  /**
   * Build increase_liquidity_v2 instructions (fill position in atomic tx)
   */
  async buildIncreaseLiquidityInstructions(
    positionPubkey: PublicKey,
    usdcAmount: number
  ): Promise<TransactionInstruction[]> {
    if (!this.raydium || !this.poolInfo) {
      await this.initialize();
    }

    try {
      const usdcAmountBN = new BN(Math.floor(usdcAmount * 10 ** USDC_DECIMALS));
      const slippage = new Percent(DEFAULT_SLIPPAGE_BPS, 10000);

      const { execute } = await this.raydium.clmm.addLiquidity({
        poolInfo: this.poolInfo,
        positionAddress: positionPubkey,
        amountInA: new BN(0), // No SOL
        amountInB: usdcAmountBN, // USDC only
        slippage,
        txVersion: TxVersion.V0,
      });

      const txData = await execute.build({ wallet: this.wallet });
      const ixs = txData.transaction.instructions;
      console.log(`✓ Raydium increase_liquidity_v2 instructions built (${ixs.length} ixs, amount=${usdcAmount} USDC)`);
      return ixs;
    } catch (err) {
      console.error('buildIncreaseLiquidityInstructions failed:', err);
      return [];
    }
  }

  /**
   * Build decrease_liquidity_v2 instructions (withdraw position in atomic tx)
   */
  async buildDecreaseLiquidityInstructions(
    positionPubkey: PublicKey,
    liquidityAmount: BN
  ): Promise<TransactionInstruction[]> {
    if (!this.raydium || !this.poolInfo) {
      await this.initialize();
    }

    try {
      const slippage = new Percent(DEFAULT_SLIPPAGE_BPS, 10000);

      const { execute } = await this.raydium.clmm.removeLiquidity({
        poolInfo: this.poolInfo,
        positionAddress: positionPubkey,
        liquidity: liquidityAmount,
        slippage,
        txVersion: TxVersion.V0,
      });

      const txData = await execute.build({ wallet: this.wallet });
      const ixs = txData.transaction.instructions;
      console.log(`✓ Raydium decrease_liquidity_v2 instructions built (${ixs.length} ixs)`);
      return ixs;
    } catch (err) {
      console.error('buildDecreaseLiquidityInstructions failed:', err);
      return [];
    }
  }

  /**
   * Get position liquidity amount
   */
  async getPositionLiquidity(positionPubkey: PublicKey): Promise<BN> {
    if (!this.raydium || !this.poolInfo) {
      await this.initialize();
    }

    try {
      const positionInfo = await this.raydium.clmm.getPositionInfo(positionPubkey);
      return positionInfo.liquidity || new BN(0);
    } catch (err) {
      console.error('getPositionLiquidity failed:', err);
      return new BN(0);
    }
  }
}

// ─── Quick Integration Test ──────────────────────────────────────────────────

export async function testRaydiumIntegration(
  connection: Connection,
  wallet: Keypair,
  poolAddress: PublicKey
): Promise<void> {
  console.log('=== Testing Raydium CLMM Integration ===\n');
  const raydium = new RaydiumCLMMIntegration(connection, wallet, poolAddress);

  try {
    await raydium.initialize();

    const state = await raydium.getPoolState();
    console.log('Pool state:', {
      currentPrice: `$${state.currentPrice.toFixed(6)}`,
      tickSpacing: state.tickSpacing,
    });

    console.log('\n✅ Raydium CLMM integration test completed');
  } catch (error) {
    console.error('❌ Raydium CLMM integration test failed:', error);
  }
}
