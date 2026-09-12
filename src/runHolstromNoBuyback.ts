import { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import { RaydiumCLMMIntegration } from './raydiumIntegration';
import { OrcaWhirlpoolIntegration } from './orcaIntegration';
import { FlashLoanIntegration } from './flashLoanIntegration';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load strategy configuration
const STRATEGY_CONFIG = JSON.parse(
  readFileSync(join(__dirname, '../strategy.json'), 'utf-8')
);

interface StrategyResult {
  success: boolean;
  profit: number;
  cuConsumed: number;
  logs: string[];
  executionTime: number;
  transactionCount: number;
  atomicTransaction: boolean;
  poolAPrice: number;
  poolBPrice: number;
  drawdownSOL: number;
  clmmSOLOut: number;
  finalSOLSold: number;
  usdcReceived: number;
  solLoanRepaid: number;
}

class HolstromNoBuybackStrategy {
  private connection: Connection;
  private wallet: Keypair;
  private logs: string[] = [];
  private raydium: RaydiumCLMMIntegration;
  private orca: OrcaWhirlpoolIntegration;
  private flashLoan: FlashLoanIntegration;
  private transactionCount: number = 0;
  private atomicTransaction: boolean = false;

  constructor(connection: Connection, wallet: Keypair) {
    this.connection = connection;
    this.wallet = wallet;
    
    const poolA = new PublicKey(STRATEGY_CONFIG.poolA.address);
    const poolB = new PublicKey(STRATEGY_CONFIG.poolB.address);
    
    this.raydium = new RaydiumCLMMIntegration(connection, wallet, poolA);
    this.orca = new OrcaWhirlpoolIntegration(connection, wallet, poolB);
    this.flashLoan = new FlashLoanIntegration(connection, wallet);
  }

  private log(message: string): void {
    console.log(message);
    this.logs.push(message);
  }

  async execute(): Promise<StrategyResult> {
    const startTime = Date.now();
    const result: StrategyResult = {
      success: false,
      profit: 0,
      cuConsumed: 0,
      logs: this.logs,
      executionTime: 0,
      transactionCount: 0,
      atomicTransaction: false,
      poolAPrice: 0,
      poolBPrice: 0,
      drawdownSOL: 0,
      clmmSOLOut: 0,
      finalSOLSold: 0,
      usdcReceived: 0,
      solLoanRepaid: 0,
    };

    try {
      this.log('=== HOLSTROM NO-BUYBACK STRATEGY ===');
      this.log(`Pool A (Raydium CLMM): ${STRATEGY_CONFIG.poolA.address}`);
      this.log(`Pool B (Orca Whirlpool): ${STRATEGY_CONFIG.poolB.address}`);
      this.log(`Scenario: ${STRATEGY_CONFIG.scenario}`);
      this.log(`Drawdown percent: ${(STRATEGY_CONFIG.drawdownPercent * 100).toFixed(1)}%`);

      // === Phase 1: Initialize SDKs ===
      this.log('\n=== Phase 1: SDK Initialization ===');
      
      await this.raydium.initialize();
      await this.orca.initialize();
      await this.flashLoan.initialize();

      result.poolAPrice = await this.raydium.getPoolPrice();
      result.poolBPrice = await this.orca.getPoolPrice();

      this.log('✅ All SDK frameworks initialized');

      // === Phase 2: Calculate dynamic amounts ===
      this.log('\n=== Phase 2: Dynamic Amount Calculation ===');
      
      const currentPrice = result.poolAPrice;
      const drawdownPrice = currentPrice * (1 - STRATEGY_CONFIG.drawdownPercent);
      const positionRangePercent = STRATEGY_CONFIG.positionRangePercent;
      const lowerBoundPrice = drawdownPrice * (1 - positionRangePercent);
      const upperBoundPrice = drawdownPrice * (1 + positionRangePercent);

      this.log(`Current price: $${currentPrice.toFixed(6)}`);
      this.log(`Drawdown target price: $${drawdownPrice.toFixed(6)}`);
      this.log(`Position range: [$${lowerBoundPrice.toFixed(6)}, $${upperBoundPrice.toFixed(6)}]`);

      // Calculate drawdown SOL needed (simplified - should use SDK quotes)
      const drawdownSOL = 100; // Placeholder - will calculate dynamically
      result.drawdownSOL = drawdownSOL;

      // Calculate expected USDC from drawdown
      const drawdownUSDC = drawdownSOL * drawdownPrice * 0.9996; // Account for 0.04% fee
      this.log(`Drawdown SOL: ${drawdownSOL.toFixed(4)}`);
      this.log(`Expected USDC: $${drawdownUSDC.toFixed(2)}`);

      // Calculate flash loan SOL needed
      const flashLoanSOL = drawdownSOL;
      const flashLoanFee = flashLoanSOL * STRATEGY_CONFIG.flashLoanFee;
      const solLoanRepaid = flashLoanSOL + flashLoanFee;
      result.solLoanRepaid = solLoanRepaid;

      this.log(`Flash loan SOL: ${flashLoanSOL.toFixed(4)}`);
      this.log(`Flash loan fee: ${flashLoanFee.toFixed(4)} SOL`);
      this.log(`SOL to repay: ${solLoanRepaid.toFixed(4)}`);

      // === Phase 3: Pre-transaction - Open empty Raydium position ===
      this.log('\n=== Phase 3: Pre-transaction - Open Empty Position ===');
      
      const positionKeypair = Keypair.generate();
      this.log(`Position keypair: ${positionKeypair.publicKey.toString()}`);

      try {
        const positionResult = await this.raydium.openPosition(
          lowerBoundPrice,
          upperBoundPrice,
          positionKeypair
        );
        this.log(`✓ Position opened successfully`);
        this.transactionCount++;
      } catch (error) {
        this.log(`✗ Position open failed: ${error}`);
        this.log('⚠ Continuing with pre-opened position (if exists)');
      }

      // === Phase 4: Build atomic transaction ===
      this.log('\n=== Phase 4: Build Atomic Transaction ===');
      
      const instructions: TransactionInstruction[] = [];

      // 1. Kamino flash borrow SOL
      this.log('Building flash borrow SOL instruction...');
      try {
        const borrowIxs = await this.flashLoan.buildFlashBorrowInstructions(
          'SOL',
          flashLoanSOL
        );
        instructions.push(...borrowIxs);
        this.log(`✓ Flash borrow instructions added (${borrowIxs.length} ixs)`);
      } catch (error) {
        this.log(`✗ Flash borrow instructions failed: ${error}`);
        throw error;
      }

      // 2. Raydium swap: drawdown (SOL → USDC)
      this.log('Building Raydium drawdown swap instruction...');
      try {
        const drawdownIxs = await this.raydium.buildSwapInstructions(
          drawdownSOL,
          true // SOL → USDC
        );
        instructions.push(...drawdownIxs);
        this.log(`✓ Drawdown swap instructions added (${drawdownIxs.length} ixs)`);
      } catch (error) {
        this.log(`✗ Drawdown swap instructions failed: ${error}`);
        throw error;
      }

      // 3. Raydium increase_liquidity_v2 (fill position)
      this.log('Building increase_liquidity_v2 instruction...');
      try {
        const liquidityIxs = await this.raydium.buildIncreaseLiquidityInstructions(
          positionKeypair.publicKey,
          drawdownUSDC
        );
        instructions.push(...liquidityIxs);
        this.log(`✓ Increase liquidity instructions added (${liquidityIxs.length} ixs)`);
      } catch (error) {
        this.log(`✗ Increase liquidity instructions failed: ${error}`);
        throw error;
      }

      // 4. Raydium swap: recursion sell (SOL → USDC)
      const recursionSOL = 10; // Placeholder - should calculate dynamically
      this.log('Building Raydium recursion sell instruction...');
      try {
        const recursionSellIxs = await this.raydium.buildSwapInstructions(
          recursionSOL,
          true // SOL → USDC
        );
        instructions.push(...recursionSellIxs);
        this.log(`✓ Recursion sell instructions added (${recursionSellIxs.length} ixs)`);
      } catch (error) {
        this.log(`✗ Recursion sell instructions failed: ${error}`);
        throw error;
      }

      // 5. Orca swap: recursion buy (USDC → SOL)
      this.log('Building Orca recursion buy instruction...');
      try {
        const recursionBuyIxs = await this.orca.buildSwapInstructions(
          drawdownUSDC * 0.5, // Use half of drawdown USDC
          false // USDC → SOL
        );
        instructions.push(...recursionBuyIxs);
        this.log(`✓ Recursion buy instructions added (${recursionBuyIxs.length} ixs)`);
      } catch (error) {
        this.log(`✗ Recursion buy instructions failed: ${error}`);
        throw error;
      }

      // 6. Raydium decrease_liquidity_v2 (withdraw position)
      this.log('Building decrease_liquidity_v2 instruction...');
      try {
        const liquidityAmount = await this.raydium.getPositionLiquidity(positionKeypair.publicKey);
        const withdrawIxs = await this.raydium.buildDecreaseLiquidityInstructions(
          positionKeypair.publicKey,
          liquidityAmount
        );
        instructions.push(...withdrawIxs);
        this.log(`✓ Decrease liquidity instructions added (${withdrawIxs.length} ixs)`);
      } catch (error) {
        this.log(`✗ Decrease liquidity instructions failed: ${error}`);
        throw error;
      }

      // 7. Kamino flash repay SOL
      this.log('Building flash repay SOL instruction...');
      try {
        const repayIxs = await this.flashLoan.buildFlashRepayInstructions(
          'SOL',
          solLoanRepaid
        );
        instructions.push(...repayIxs);
        this.log(`✓ Flash repay instructions added (${repayIxs.length} ixs)`);
      } catch (error) {
        this.log(`✗ Flash repay instructions failed: ${error}`);
        throw error;
      }

      // 8. Orca swap: final sale (SOL → USDC)
      this.log('Building Orca final sale instruction...');
      try {
        const finalSaleIxs = await this.orca.buildSwapInstructions(
          100, // Placeholder - should calculate dynamically
          true // SOL → USDC
        );
        instructions.push(...finalSaleIxs);
        this.log(`✓ Final sale instructions added (${finalSaleIxs.length} ixs)`);
      } catch (error) {
        this.log(`✗ Final sale instructions failed: ${error}`);
        throw error;
      }

      this.log(`\nTotal instructions: ${instructions.length}`);

      // === Phase 5: Build and simulate transaction ===
      this.log('\n=== Phase 5: Build and Simulate Transaction ===');
      
      const transaction = new Transaction();
      instructions.forEach(ix => transaction.add(ix));

      // Add recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.wallet.publicKey;

      // Sign transaction
      transaction.sign(this.wallet, positionKeypair);

      // Simulate transaction
      this.log('Simulating transaction...');
      const simulationResult = await this.connection.simulateTransaction(transaction);
      const simulationValue = simulationResult.value;

      if (simulationValue.err) {
        this.log(`✗ Simulation failed: ${JSON.stringify(simulationValue.err)}`);
        throw new Error(`Transaction simulation failed: ${JSON.stringify(simulationValue.err)}`);
      }

      result.cuConsumed = simulationValue.unitsConsumed || 0;
      this.log(`✓ Simulation successful`);
      this.log(`  Compute units consumed: ${result.cuConsumed.toLocaleString()}`);
      this.log(`  Budget: 1,400,000 CU`);
      this.log(`  Headroom: ${(1400000 - result.cuConsumed).toLocaleString()} CU`);

      result.atomicTransaction = true;
      result.transactionCount++;

      // Calculate estimated profit (simplified)
      result.clmmSOLOut = drawdownUSDC / currentPrice;
      result.finalSOLSold = result.clmmSOLOut + recursionSOL - solLoanRepaid;
      result.usdcReceived = result.finalSOLSold * result.poolBPrice;
      result.profit = result.usdcReceived - (drawdownSOL * currentPrice);

      this.log('\n=== ESTIMATED RESULTS ===');
      this.log(`Drawdown SOL: ${result.drawdownSOL.toFixed(4)}`);
      this.log(`CLMM SOL out: ${result.clmmSOLOut.toFixed(4)}`);
      this.log(`Final SOL sold: ${result.finalSOLSold.toFixed(4)}`);
      this.log(`USDC received: $${result.usdcReceived.toFixed(2)}`);
      this.log(`SOL loan repaid: ${result.solLoanRepaid.toFixed(4)}`);
      this.log(`Net P&L: $${result.profit.toFixed(2)}`);
      this.log(`CU consumed: ${result.cuConsumed.toLocaleString()} (budget 1,400,000)`);

      result.success = true;

    } catch (error) {
      this.log(`\n✗ Strategy execution failed: ${error}`);
      result.success = false;
    }

    result.executionTime = Date.now() - startTime;
    return result;
  }
}

// === Main execution ===
async function main() {
  const connection = new Connection('http://localhost:8899');
  const wallet = Keypair.generate();

  console.log('Strategy wallet:', wallet.publicKey.toString());

  // Request airdrop
  console.log('Requesting airdrop...');
  try {
    const airdropSig = await connection.requestAirdrop(
      wallet.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);
    console.log('✓ Airdrop successful');
  } catch (error) {
    console.log('⚠ Airdrop failed (may already have funds):', error);
  }

  const strategy = new HolstromNoBuybackStrategy(connection, wallet);
  const result = await strategy.execute();

  console.log('\n=== FINAL SUMMARY ===');
  console.log(`Success: ${result.success}`);
  console.log(`Atomic Transaction: ${result.atomicTransaction}`);
  console.log(`Transaction Count: ${result.transactionCount}`);
  console.log(`CU Consumed: ${result.cuConsumed.toLocaleString()} / 1,400,000`);
  console.log(`Execution Time: ${result.executionTime}ms`);
  console.log(`Net P&L: $${result.profit.toFixed(2)}`);

  if (!result.success) {
    process.exit(1);
  }
}

main().catch(console.error);
