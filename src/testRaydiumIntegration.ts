import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { testRaydiumIntegration } from './raydiumIntegration';

async function main() {
  console.log('=== Raydium CLMM Integration Test ===\n');

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

  // Raydium CLMM pool address (SOL/USDC, 0.04% fee tier)
  const raydiumPoolAddress = new PublicKey('3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv');

  await testRaydiumIntegration(connection, wallet, raydiumPoolAddress);
}

main().catch(console.error);
