import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { testOrcaIntegration } from './orcaIntegration';

const CONFIG = {
  // Pool addresses (real mainnet addresses)
  poolB: new PublicKey('7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm'), // Orca Whirlpool SOL/USDC
  
  // RPC endpoint (Surfpool with mainnet fork)
  rpcUrl: 'http://localhost:8899',
};

async function main() {
  console.log('=== Orca Whirlpool SDK Integration Test ===\n');
  
  // Connect to Surfpool
  const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
  console.log('Connected to Surfpool at', CONFIG.rpcUrl);
  
  // Create wallet
  const wallet = Keypair.generate();
  console.log('Strategy wallet:', wallet.publicKey.toString());
  
  // Test Orca integration
  await testOrcaIntegration(connection, wallet, CONFIG.poolB);
}

main().catch(console.error);
