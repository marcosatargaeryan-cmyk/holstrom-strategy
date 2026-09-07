# Quick Start Guide

## Immediate Setup

1. **Navigate to project directory:**
   ```bash
   cd holstrom-strategy
   ```

2. **Install dependencies (already done):**
   ```bash
   npm install
   ```

3. **Build TypeScript:**
   ```bash
   npm run build
   ```

4. **Run TypeScript test:**
   ```bash
   npm run test:ts
   ```

## Rust Testing

1. **Build Rust project:**
   ```bash
   cargo build
   ```

2. **Run Rust tests:**
   ```bash
   cargo test
   ```

3. **Run Rust binary:**
   ```bash
   cargo run
   ```

## Configuration Required

Before running with real data, update `surfpool.config.json`:

1. Get real Orca CLMM pool addresses from mainnet
2. Replace placeholder addresses in the config file
3. Update vault and tick array addresses
4. Set appropriate fee authority accounts

## Testing with Simulated Data

The current implementation uses simulated data and will execute the strategy logic without real on-chain interactions. This is useful for:

- Validating the strategy logic
- Testing profit/loss calculations
- Verifying state change tracking
- Debugging the execution flow

## Expected Output

When you run the tests, you should see:

```
=== Starting Holstrom Strategy Test with Surfpool ===

Surfnet started successfully
RPC Endpoint: http://127.0.0.1:8899
Test wallet address: [wallet_pubkey]

=== Strategy Configuration ===
Initial Price: 95.831125
Target Drawdown Price: 67.0818
CLMM Lower Bound: 66.0818
Flash Loan Amount: 6211.1 SOL
Recursive Loan Amount: 1000 SOL
Buyback Loan Amount: 497833.5 USDC

=== Holstrom Strategy Execution Started ===
Initial Price: $95.831125
Step 1: Flash Loan SOL borrowed: 6211.1 SOL
Step 2: Sold SOL into Pool A. Price now: $67.0818
...
Final Profit: $213717
```

## Troubleshooting

If you encounter issues:

1. **Surfpool fails to start**: Ensure `@solana/surfpool` is installed and Node.js 18+
2. **TypeScript build fails**: Check `tsconfig.json` and dependencies
3. **Rust build fails**: Ensure Rust is installed and in PATH (`D:\cargo\bin`)
4. **Path issues**: Use absolute paths on Windows

## Next Steps

1. Run the simulated tests to verify the setup
2. Configure real pool addresses for on-chain testing
3. Implement actual Orca SDK integration for real CLMM operations
4. Add custom Solana program for true atomic execution