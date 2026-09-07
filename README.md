# Holstrom Strategy Testing with Surfpool

A comprehensive testing framework for the Holstrom cross-venue, atomic, flash-loan-driven CLMM strategy on Solana using Surfpool.

## Overview

The Holstrom strategy is a sophisticated DeFi trading strategy that involves:
- Two Orca CLMM pools (execution pool and deep pool)
- Initial price displacement and manipulation
- Concentrated liquidity position management
- Recursive swapping across venues
- CLMM withdrawal, buyback, and final sale
- All operations within atomic transactions

## Project Structure

```
holstrom-strategy/
├── src/
│   ├── holstromStrategy.ts    # TypeScript strategy implementation
│   ├── strategy.rs            # Rust strategy implementation
│   ├── main.rs                # Rust binary entry point
│   └── lib.rs                 # Rust library exports
├── tests/
│   ├── holstromTest.ts        # TypeScript test harness
│   └── holstrom_test.rs       # Rust test harness
├── types/
│   └── strategy.ts            # TypeScript type definitions
├── Cargo.toml                 # Rust dependencies
├── package.json               # Node.js dependencies
├── tsconfig.json              # TypeScript configuration
└── surfpool.config.json       # Surfpool configuration
```

## Prerequisites

- Node.js 18+
- Rust 1.98+ (with cargo)
- Solana CLI (optional, for mainnet account cloning)
- **Important**: Surfpool TypeScript SDK does not support Windows. Use Rust SDK or WSL/Docker for Windows.

## Installation

### TypeScript/JavaScript Environment

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build
```

### Rust Environment

```bash
# Build Rust project
cargo build

# Run tests
cargo test
```

## Configuration

Before running tests, update `surfpool.config.json` with actual on-chain account addresses:

1. **Pool Addresses**: Replace `REPLACE_WITH_POOL_A_ADDRESS` and `REPLACE_WITH_POOL_B_ADDRESS` with actual Orca CLMM pool addresses from mainnet
2. **Vault Accounts**: Update vault addresses for both pools
3. **Tick Arrays**: Add the tick array account addresses for each pool
4. **Fee Authority**: Set the appropriate fee authority accounts

### Getting Account Addresses

You can obtain these addresses using the Solana CLI:

```bash
# Get pool information
solana account <POOL_ADDRESS>

# Or use Orca SDK to query pool data
```

## Running Tests

### TypeScript Tests

```bash
# Using ts-node (direct execution)
npm run test:ts

# Or build and run
npm run build
npm test
```

### Rust Tests

```bash
# Run Rust tests
cargo test

# Run the binary
cargo run
```

## Strategy Parameters

The strategy uses the following key parameters (configurable in `surfpool.config.json`):

- **Initial Price**: $95.831125 (starting SOL/USDC price)
- **Target Drawdown Price**: $67.0818 (price after initial manipulation)
- **CLMM Lower Bound**: $66.0818 (CLMM position lower tick boundary)
- **Flash Loan Amount**: 6,211.1 SOL (initial flash loan)
- **Recursive Loan Amount**: 1,000 SOL (recursive swapping loan)
- **Buyback Loan Amount**: $497,833.5 USDC (buyback loan)

## Expected Results

When properly configured with real pool data, the strategy should produce:

- **Transaction Logs**: Detailed step-by-step execution log
- **Price Changes**: Track price movement from $95.83 → $67.08 → $66.08 → $95.83
- **CLMM Position**: Liquidity calculations and position details
- **Profit/Loss**: Expected profit of approximately +$213,717 USDC
- **State Changes**: Token balance deltas for each step
- **Fee Tracking**: All flash loan and transaction fees

## Surfpool Integration

The project uses Surfpool as a drop-in replacement for `solana-test-validator`:

- **Local Fork**: Clones mainnet state for realistic testing
- **Atomic Operations**: All strategy steps executed atomically
- **Fast Execution**: Optimized for rapid testing iterations
- **Port**: Default RPC endpoint on `http://127.0.0.1:8899`

## Architecture

### TypeScript Implementation

- Uses `@solana/web3.js` for Solana interactions
- Uses `@orca-so/whirlpools-sdk` for CLMM operations
- Uses `decimal.js` for precise financial calculations
- Modular design with type-safe interfaces

### Rust Implementation

- Uses `surfpool-sdk` for direct Surfpool integration
- Native performance for computationally intensive operations
- Tokio async runtime for concurrent operations
- Comprehensive error handling

## Safety and Security

- **No Real Funds**: Tests use local fork with cloned accounts
- **Flash Loan Simulation**: Loans are simulated, not real
- **Atomic Testing**: All operations are reverted after test completion
- **No Mainnet Interaction**: Cannot accidentally execute on mainnet

## Troubleshooting

### Windows Path Issues

If you encounter path issues on Windows:
- Use absolute paths for all file operations
- Ensure cargo is in your PATH: `D:\cargo\bin`
- Use PowerShell for command execution

### Surfpool Binary Issues

If Surfpool fails to start:
- Ensure `@solana/surfpool` is properly installed
- Check that your platform is supported (Windows x64)
- Verify Node.js version is 18+

### Account Cloning Issues

If account cloning fails:
- Verify account addresses are correct
- Ensure accounts exist on mainnet
- Check your internet connection for mainnet access

## Next Steps

1. Configure real pool addresses in `surfpool.config.json`
2. Test with simulated data first
3. Gradually increase complexity
4. Validate results against theoretical calculations
5. Consider implementing custom Solana program for true atomicity

## License

ISC

## Contributing

This is a testing framework for educational and research purposes. Use responsibly and never deploy to mainnet without thorough testing and security audits.