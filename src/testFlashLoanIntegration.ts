import { Connection, Keypair } from '@solana/web3.js';
import { testFlashLoanIntegration } from './flashLoanIntegration';

const CONFIG = {
  // RPC endpoint (Surfpool with mainnet fork)
  rpcUrl: 'http://localhost:8899',
};

async function main() {
  console.log('=== Flash Loan SDK Integration Test ===\n');
  
  // Connect to Surfpool
  const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
  console.log('Connected to Surfpool at', CONFIG.rpcUrl);
  
  // Create wallet
  const wallet = Keypair.generate();
  console.log('Strategy wallet:', wallet.publicKey.toString());
  
  // Test Flash Loan integration
  await testFlashLoanIntegration(connection, wallet);
}

main().catch(console.error);
