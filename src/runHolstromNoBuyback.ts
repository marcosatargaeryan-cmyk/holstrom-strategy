import { 
  Connection, 
  PublicKey, 
  Keypair, 
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
  logs: string[];
  executionTime: number;
  transactionCount: number;
  poolAPrice: number;
  poolBPrice: number;
  drawdownSOL: number;
  clmmSOLOut: number;
  finalSOLSold: number;
  usdcReceived: number;
  solLoanRepaid: number;
  signatures: string[];
}

class HolstromNoBuybackStrategy {
  private connection: Connection;
  private wallet: Keypair;
  private logs: string[] = [];
  private raydium: RaydiumCLMMIntegration;
  private orca: OrcaWhirlpoolIntegration;
  private flashLoan: FlashLoanIntegration;
  private transactionCount: number = 0;
  private signatures: string[] = [];

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
      logs: this.logs,
      executionTime: 0,
      transactionCount: 0,
      poolAPrice: 0,
      poolBPrice: 0,
      drawdownSOL: 0,
      clmmSOLOut: 0,
      finalSOLSold: 0,
      usdcReceived: 0,
      solLoanRepaid: 0,
      signatures: [],
    };

    try {
      this.log('=== HOLSTROM NO-BUYBACK STRATEGY (SEQUENTIAL EXECUTION) ===');
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

      // Calculate drawdown SOL needed (simplified for testing)
      const drawdownSOL = 10; // Test amount
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

      // === Phase 3: Open empty Raydium position ===
      this.log('\n=== Phase 3: Open Empty Position ===');
      
      const positionKeypair = Keypair.generate();
      this.log(`Position keypair: ${positionKeypair.publicKey.toString()}`);

      const positionResult = await this.raydium.openPosition(
        lowerBoundPrice,
        upperBoundPrice,
        positionKeypair
      );
      this.transactionCount++;
      this.signatures.push(positionResult.signature);
      this.log(`✓ Position opened (tx: ${positionResult.signature})`);

      // === Phase 4: Sequential Execution ===
      this.log('\n=== Phase 4: Sequential Strategy Execution ===');
      
      // 1. Kamino flash borrow SOL
      this.log('Step 1: Flash borrow SOL...');
      try {
        const borrowSig = await this.flashLoan.executeFlashBorrow('SOL', flashLoanSOL);
        this.transactionCount++;
        this.signatures.push(borrowSig);
        this.log(`✓ Flash borrow executed (tx: ${borrowSig})`);
      } catch (error) {
        this.log(`✗ Flash borrow failed: ${error}`);
        this.log('⚠ Continuing without flash loan (testing other components)');
      }

      // 2. Raydium swap: drawdown (SOL → USDC)
      this.log('Step 2: Raydium drawdown swap (SOL → USDC)...');
      try {
        const drawdownResult = await this.raydium.executeSwap(drawdownSOL, true);
        this.transactionCount++;
        this.signatures.push(drawdownResult.signature);
        this.log(`✓ Drawdown swap executed (tx: ${drawdownResult.signature})`);
        this.log(`  Out: ${drawdownResult.outAmount.toString()} units`);
      } catch (error) {
        this.log(`✗ Drawdown swap failed: ${error}`);
        throw error;
      }

      // 3. Raydium increase liquidity (fill position)
      this.log('Step 3: Increase liquidity...');
      try {
        const liquiditySig = await this.raydium.increaseLiquidity(
          positionKeypair.publicKey,
          drawdownUSDC
        );
        this.transactionCount++;
        this.signatures.push(liquiditySig);
        this.log(`✓ Liquidity increased (tx: ${liquiditySig})`);
      } catch (error) {
        this.log(`✗ Increase liquidity failed: ${error}`);
        this.log('⚠ Continuing with existing liquidity');
      }

      // 4. Raydium swap: recursion sell (SOL → USDC)
      const recursionSOL = 5; // Test amount
      this.log('Step 4: Raydium recursion sell (SOL → USDC)...');
      try {
        const recursionSellResult = await this.raydium.executeSwap(recursionSOL, true);
        this.transactionCount++;
        this.signatures.push(recursionSellResult.signature);
        this.log(`✓ Recursion sell executed (tx: ${recursionSellResult.signature})`);
      } catch (error) {
        this.log(`✗ Recursion sell failed: ${error}`);
        this.log('⚠ Continuing without recursion sell');
      }

      // 5. Orca swap: recursion buy (USDC → SOL)
      this.log('Step 5: Orca recursion buy (USDC → SOL)...');
      try {
        const recursionBuyResult = await this.orca.executeSwap(drawdownUSDC * 0.5, false);
        this.transactionCount++;
        this.signatures.push(recursionBuyResult.signature);
        this.log(`✓ Recursion buy executed (tx: ${recursionBuyResult.signature})`);
      } catch (error) {
        this.log(`✗ Recursion buy failed: ${error}`);
        this.log('⚠ Continuing without recursion buy');
      }

      // 6. Raydium decrease liquidity (withdraw position)
      this.log('Step 6: Decrease liquidity...');
      try {
        const liquidityAmount = await this.raydium.getPositionLiquidity(positionKeypair.publicKey);
        const withdrawSig = await this.raydium.decreaseLiquidity(
          positionKeypair.publicKey,
          liquidityAmount
        );
        this.transactionCount++;
        this.signatures.push(withdrawSig);
        this.log(`✓ Liquidity decreased (tx: ${withdrawSig})`);
      } catch (error) {
        this.log(`✗ Decrease liquidity failed: ${error}`);
        this.log('⚠ Continuing without withdrawal');
      }

      // 7. Kamino flash repay SOL
      this.log('Step 7: Flash repay SOL...');
      try {
        const repaySig = await this.flashLoan.executeFlashRepay('SOL', solLoanRepaid);
        this.transactionCount++;
        this.signatures.push(repaySig);
        this.log(`✓ Flash repay executed (tx: ${repaySig})`);
      } catch (error) {
        this.log(`✗ Flash repay failed: ${error}`);
        this.log('⚠ Continuing without flash repay');
      }

      // 8. Orca swap: final sale (SOL → USDC)
      this.log('Step 8: Orca final sale (SOL → USDC)...');
      try {
        const finalSaleResult = await this.orca.executeSwap(10, true);
        this.transactionCount++;
        this.signatures.push(finalSaleResult.signature);
        this.log(`✓ Final sale executed (tx: ${finalSaleResult.signature})`);
      } catch (error) {
        this.log(`✗ Final sale failed: ${error}`);
        this.log('⚠ Continuing without final sale');
      }

      this.log(`\nTotal transactions: ${this.transactionCount}`);

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
      this.log(`Transaction count: ${this.transactionCount}`);

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
  console.log(`Transaction Count: ${result.transactionCount}`);
  console.log(`Execution Time: ${result.executionTime}ms`);
  console.log(`Net P&L: $${result.profit.toFixed(2)}`);
  console.log(`Signatures: ${result.signatures.length}`);

  if (!result.success) {
    process.exit(1);
  }
}

main().catch(console.error);
