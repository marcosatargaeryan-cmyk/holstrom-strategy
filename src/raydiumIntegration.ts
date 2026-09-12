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
  TickUtil,
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
  signature: string;
}

export interface PositionResult {
  positionPubkey: PublicKey;
  positionKeypair: Keypair;
  lowerTick: number;
  upperTick: number;
  depositedUSDC: BN;
  signature: string;
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

  // ─── Swap (Sequential Execution) ─────────────────────────────────────────────

  /**
   * Execute swap using Raydium SDK (sequential execution)
   */
  async executeSwap(
    inputAmountSol: number,
    swapForY: boolean  // true = SOL→USDC, false = USDC→SOL
  ): Promise<SwapResult> {
    if (!this.raydium || !this.poolInfo) {
      await this.initialize();
    }

    try {
      const inputAmountBN = new BN(Math.floor(inputAmountSol * 10 ** SOL_DECIMALS));
      const slippage = new Percent(DEFAULT_SLIPPAGE_BPS, 10000);

      console.log(`Executing Raydium swap: ${inputAmountSol.toFixed(4)} ${swapForY ? 'SOL→USDC' : 'USDC→SOL'}`);

      const { execute, extInfo } = await this.raydium.clmm.swap({
        poolInfo: this.poolInfo,
        poolKeys: this.poolKeys,
        inputMint: swapForY ? this.poolInfo.mintA : this.poolInfo.mintB,
        amountIn: inputAmountBN,
        amountOutMin: new BN(0),
        slippage,
        computeBudgetConfig: { microLamports: 600000 },
        txVersion: TxVersion.V0,
      });

      const { txId } = await execute({ sendAndConfirm: true });
      console.log(`✓ Swap executed: ${txId}`);
      console.log(`  Estimated out: ${extInfo?.estimatedOut?.toString() || 'n/a'}`);

      return {
        inAmount: inputAmountBN,
        outAmount: extInfo?.estimatedOut || new BN(0),
        fee: new BN(0), // Not provided by SDK
        priceImpact: 0, // Not provided by SDK
        signature: txId,
      };
    } catch (err) {
      console.error('executeSwap failed:', err);
      throw err;
    }
  }

  // ─── Position Management (Sequential Execution) ─────────────────────────────

  /**
   * Open Raydium CLMM position (sequential execution)
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

      const { txId } = await execute({ sendAndConfirm: true });
      console.log(`✓ Raydium position opened: tx: ${txId}`);

      return {
        positionPubkey: positionKeypair.publicKey,
        positionKeypair,
        lowerTick: tickLower,
        upperTick: tickUpper,
        depositedUSDC: new BN(0), // Empty position initially
        signature: txId,
      };
    } catch (err) {
      console.error('openPosition failed:', err);
      throw err;
    }
  }

  /**
   * Increase liquidity on position (sequential execution)
   */
  async increaseLiquidity(
    positionPubkey: PublicKey,
    usdcAmount: number
  ): Promise<string> {
    if (!this.raydium || !this.poolInfo) {
      await this.initialize();
    }

    try {
      const usdcAmountBN = new BN(Math.floor(usdcAmount * 10 ** USDC_DECIMALS));

      // Get position info
      const allPositions = await this.raydium.clmm.getOwnerPositionInfo({
        programId: this.poolInfo.programId,
      });
      const positionAccount = allPositions.find((p: any) => p.nftMint.equals(positionPubkey));
      
      if (!positionAccount) {
        throw new Error('Position not found');
      }

      console.log(`Increasing liquidity by ${usdcAmount.toFixed(2)} USDC`);

      const { execute } = await this.raydium.clmm.increasePositionFromBase({
        poolInfo: this.poolInfo,
        ownerPosition: positionAccount,
        ownerInfo: { useSOLBalance: true },
        base: 'MintB', // USDC
        baseAmount: usdcAmountBN,
        otherAmountMax: new BN(0),
        txVersion: TxVersion.V0,
      });

      const { txId } = await execute({ sendAndConfirm: true });
      console.log(`✓ Liquidity increased: tx: ${txId}`);
      return txId;
    } catch (err) {
      console.error('increaseLiquidity failed:', err);
      throw err;
    }
  }

  /**
   * Decrease liquidity from position (sequential execution)
   */
  async decreaseLiquidity(
    positionPubkey: PublicKey,
    liquidityAmount: BN
  ): Promise<string> {
    if (!this.raydium || !this.poolInfo) {
      await this.initialize();
    }

    try {
      // Get position info
      const allPositions = await this.raydium.clmm.getOwnerPositionInfo({
        programId: this.poolInfo.programId,
      });
      const positionAccount = allPositions.find((p: any) => p.nftMint.equals(positionPubkey));
      
      if (!positionAccount) {
        throw new Error('Position not found');
      }

      console.log(`Decreasing liquidity: ${liquidityAmount.toString()}`);

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

      const { txId } = await execute({ sendAndConfirm: true });
      console.log(`✓ Liquidity decreased: tx: ${txId}`);
      return txId;
    } catch (err) {
      console.error('decreaseLiquidity failed:', err);
      throw err;
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
