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
  TickUtil,
  PoolUtils,
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
  private poolKeys: any = null;

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

      // Fetch pool info from RPC
      const { poolInfo, poolKeys } = await this.raydium.clmm.getPoolInfoFromRpc(this.poolAddress.toString());
      this.poolInfo = poolInfo;
      this.poolKeys = poolKeys;

      console.log(`✓ Raydium CLMM initialized — pool: ${this.poolAddress.toString()}`);
      console.log(`  tickSpacing: ${poolInfo.config.tickSpacing}`);
      console.log(`  currentPrice: $${poolInfo.price || 'n/a'}`);
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
      tickSpacing: this.poolInfo.config.tickSpacing,
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
        poolKeys: this.poolKeys,
        inputMint: swapForY ? this.poolInfo.mintA : this.poolInfo.mintB,
        amountIn: inputAmountBN,
        amountOut: new BN(0), // Will be calculated
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

    try {
      // Convert prices to ticks using the SDK's utility
      const { tick: tickLower } = TickUtil.getPriceAndTick({
        price: new Decimal(lowerBoundPrice),
        mintADecimals: this.poolInfo.mintA.decimals,
        mintBDecimals: this.poolInfo.mintB.decimals,
        zeroForOne: true,
        tickSpacing: this.poolInfo.config.tickSpacing,
      });

      const { tick: tickUpper } = TickUtil.getPriceAndTick({
        price: new Decimal(upperBoundPrice),
        mintADecimals: this.poolInfo.mintA.decimals,
        mintBDecimals: this.poolInfo.mintB.decimals,
        zeroForOne: true,
        tickSpacing: this.poolInfo.config.tickSpacing,
      });

      console.log(`Opening Raydium position ticks [${tickLower}, ${tickUpper}] (prices $${lowerBoundPrice}–$${upperBoundPrice})`);

      // Open position with minimal liquidity
      const { execute } = await this.raydium.clmm.openPositionFromBase({
        poolInfo: this.poolInfo,
        poolKeys: this.poolKeys,
        tickLower,
        tickUpper,
        base: 'MintA',
        baseAmount: new BN(1), // Minimal amount
        otherAmountMax: new BN(1),
        ownerInfo: { useSOLBalance: true },
        txVersion: TxVersion.V0,
      });

      const txData = await execute.build({ wallet: this.wallet });
      const sig = await this.connection.sendTransaction(txData.transaction, [this.wallet]);
      await this.connection.confirmTransaction(sig);

      console.log(`✓ Raydium position opened: ${positionKeypair.publicKey.toString()} — tx: ${sig}`);

      return {
        positionPubkey: positionKeypair.publicKey,
        positionKeypair,
        lowerTick: tickLower,
        upperTick: tickUpper,
        depositedUSDC: new BN(0), // Empty position initially
      };
    } catch (err) {
      console.error('openPosition failed:', err);
      throw err;
    }
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
      const { tick: tickLower } = TickUtil.getPriceAndTick({
        price: new Decimal(lowerBoundPrice),
        mintADecimals: this.poolInfo.mintA.decimals,
        mintBDecimals: this.poolInfo.mintB.decimals,
        zeroForOne: true,
        tickSpacing: this.poolInfo.config.tickSpacing,
      });

      const { tick: tickUpper } = TickUtil.getPriceAndTick({
        price: new Decimal(upperBoundPrice),
        mintADecimals: this.poolInfo.mintA.decimals,
        mintBDecimals: this.poolInfo.mintB.decimals,
        zeroForOne: true,
        tickSpacing: this.poolInfo.config.tickSpacing,
      });

      const { execute } = await this.raydium.clmm.openPositionFromBase({
        poolInfo: this.poolInfo,
        poolKeys: this.poolKeys,
        tickLower,
        tickUpper,
        base: 'MintA',
        baseAmount: new BN(1),
        otherAmountMax: new BN(1),
        ownerInfo: { useSOLBalance: true },
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

      // Get position info
      const allPositions = await this.raydium.clmm.getOwnerPositionInfo({
        programId: this.poolInfo.programId,
      });
      const positionAccount = allPositions.find((p: any) => p.nftMint.equals(positionPubkey));
      
      if (!positionAccount) {
        throw new Error('Position not found');
      }

      const { execute } = await this.raydium.clmm.increasePositionFromBase({
        poolInfo: this.poolInfo,
        ownerPosition: positionAccount,
        ownerInfo: { useSOLBalance: true },
        base: 'MintB', // USDC
        baseAmount: usdcAmountBN,
        otherAmountMax: new BN(0),
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

      // Get position info
      const allPositions = await this.raydium.clmm.getOwnerPositionInfo({
        programId: this.poolInfo.programId,
      });
      const positionAccount = allPositions.find((p: any) => p.nftMint.equals(positionPubkey));
      
      if (!positionAccount) {
        throw new Error('Position not found');
      }

      const { execute } = await this.raydium.clmm.decreaseLiquidity({
        poolInfo: this.poolInfo,
        poolKeys: this.poolKeys,
        ownerPosition: positionAccount,
        ownerInfo: { useSOLBalance: true, closePosition: false },
        liquidity: liquidityAmount,
        amountMinA: new BN(0),
        amountMinB: new BN(0),
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
      const allPositions = await this.raydium.clmm.getOwnerPositionInfo({
        programId: this.poolInfo.programId,
      });
      const positionAccount = allPositions.find((p: any) => p.nftMint.equals(positionPubkey));
      
      if (!positionAccount) {
        throw new Error('Position not found');
      }

      return positionAccount.liquidity || new BN(0);
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
