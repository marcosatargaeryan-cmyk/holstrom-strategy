import { Surfnet } from '@solana/surfpool';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { HolstromStrategy } from '../src/holstromStrategy';
import { HolstromConfig } from '../types/strategy';

async function holstromTest() {
  console.log('=== Starting Holstrom Strategy Test with Surfpool ===\n');

  // Initialize Surfnet
  const surfnet = Surfnet.start();

  console.log('Surfnet started successfully');
  console.log('RPC Endpoint:', surfnet.rpcUrl);

  // Use the pre-funded payer from Surfnet
  const wallet = Keypair.fromSecretKey(Uint8Array.from(surfnet.payer));
  console.log('Test wallet address:', wallet.publicKey.toString());

  // Create connection to Surfnet
  const connection = new Connection(surfnet.rpcUrl, 'confirmed');

  console.log('Using pre-funded payer with 10 SOL');

  // Configure Holstrom strategy with test parameters
  const config: HolstromConfig = {
    poolA: {
      poolAddress: '7qbRF6YsyMcLx3CJVHBZvZqFJC5pUMZ5BhZqSgcRnST3', // Example Orca pool
      tokenMintA: 'So11111111111111111111111111111111111111112', // WSOL
      tokenMintB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      vaultA: 'vaultA_example',
      vaultB: 'vaultB_example',
      tickArrays: [],
      feeAuthority: 'feeAuthority_example',
    },
    poolB: {
      poolAddress: '7qbRF6YsyMcLx3CJVHBZvZqFJC5pUMZ5BhZqSgcRnST3', // Example Orca pool
      tokenMintA: 'So11111111111111111111111111111111111111112', // WSOL
      tokenMintB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      vaultA: 'vaultA_example',
      vaultB: 'vaultB_example',
      tickArrays: [],
      feeAuthority: 'feeAuthority_example',
    },
    initialPrice: 95.831125,
    targetDrawdownPrice: 67.0818,
    clmmLowerBound: 66.0818,
    flashLoanAmount: 6211.1,
    recursiveLoanAmount: 1000,
    buybackLoanAmount: 497833.5,
  };

  console.log('\n=== Strategy Configuration ===');
  console.log('Initial Price:', config.initialPrice);
  console.log('Target Drawdown Price:', config.targetDrawdownPrice);
  console.log('CLMM Lower Bound:', config.clmmLowerBound);
  console.log('Flash Loan Amount:', config.flashLoanAmount, 'SOL');
  console.log('Recursive Loan Amount:', config.recursiveLoanAmount, 'SOL');
  console.log('Buyback Loan Amount:', config.buybackLoanAmount, 'USDC');

  // Create and execute strategy
  const strategy = new HolstromStrategy(connection, config, wallet);
  const result = await strategy.execute();

  console.log('\n=== Test Results ===');
  console.log('Success:', result.success);
  console.log('Initial Price:', result.initialPrice);
  console.log('Final Price:', result.finalPrice);
  console.log('Profit/Loss:', result.profitLoss);
  console.log('Fees Paid:', result.feesPaid);
  console.log('Slippage:', result.slippage);

  console.log('\n=== Transaction Logs ===');
  result.transactionLogs.forEach(log => console.log(log));

  console.log('\n=== State Changes ===');
  result.stateChanges.forEach((change, index) => {
    console.log(`Step ${index + 1}: ${change.step}`);
    console.log(`  Price Before: $${change.priceBefore}`);
    console.log(`  Price After: $${change.priceAfter}`);
    console.log(`  SOL Delta: ${change.tokenDelta.sol}`);
    console.log(`  USDC Delta: ${change.tokenDelta.usdc}`);
  });

  console.log('\n=== Token Balances ===');
  console.log('Strategy Wallet:');
  console.log(`  SOL: ${result.tokenBalances.strategyWallet.sol}`);
  console.log(`  USDC: ${result.tokenBalances.strategyWallet.usdc}`);
  console.log('Pool A:');
  console.log(`  SOL: ${result.tokenBalances.poolA.sol}`);
  console.log(`  USDC: ${result.tokenBalances.poolA.usdc}`);
  console.log('Pool B:');
  console.log(`  SOL: ${result.tokenBalances.poolB.sol}`);
  console.log(`  USDC: ${result.tokenBalances.poolB.usdc}`);

  // Stop Surfnet
  surfnet.stop();
  console.log('\nSurfnet stopped');

  return result;
}

// Run the test
holstromTest()
  .then(result => {
    console.log('\n=== Test Completed Successfully ===');
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });