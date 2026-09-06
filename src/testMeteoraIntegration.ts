import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { testMeteoraIntegration } from './meteoraIntegration';

const CONFIG = {
  // Pool addresses (real mainnet addresses)
  poolA: new PublicKey('BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y'), // Meteora DLMM SOL/USDC
  
  // RPC endpoint (Surfpool with mainnet fork)
  rpcUrl: 'http://localhost:8899',
};

async function main() {
  console.log('=== Meteora DLMM SDK Integration Test ===\n');
  
  // Connect to Surfpool
  const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
  console.log('Connected to Surfpool at', CONFIG.rpcUrl);
  
  // Create wallet
  const wallet = Keypair.generate();
  console.log('Strategy wallet:', wallet.publicKey.toString());
  
  // Test Meteora integration
  await testMeteoraIntegration(connection, wallet, CONFIG.poolA);
}

main().catch(console.error);
