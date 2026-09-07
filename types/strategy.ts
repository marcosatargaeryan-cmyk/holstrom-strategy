export interface PoolConfig {
  poolAddress: string;
  tokenMintA: string;
  tokenMintB: string;
  vaultA: string;
  vaultB: string;
  tickArrays: string[];
  feeAuthority: string;
}

export interface HolstromConfig {
  poolA: PoolConfig;  // Smaller execution pool
  poolB: PoolConfig;  // Larger deep pool
  initialPrice: number;
  targetDrawdownPrice: number;
  clmmLowerBound: number;
  flashLoanAmount: number;
  recursiveLoanAmount: number;
  buybackLoanAmount: number;
}

export interface StrategyState {
  currentPrice: number;
  solBalance: number;
  usdcBalance: number;
  positionLiquidity: number;
  positionTokenA: number;
  positionTokenB: number;
  recursiveStep: number;
  totalSolSold: number;
  totalSolBought: number;
}

export interface StrategyResult {
  success: boolean;
  initialPrice: number;
  finalPrice: number;
  profitLoss: number;
  transactionLogs: string[];
  stateChanges: StateChange[];
  tokenBalances: TokenBalances;
  feesPaid: number;
  slippage: number;
}

export interface StateChange {
  step: string;
  timestamp: number;
  priceBefore: number;
  priceAfter: number;
  tokenDelta: { sol: number; usdc: number };
}

export interface TokenBalances {
  strategyWallet: { sol: number; usdc: number };
  poolA: { sol: number; usdc: number };
  poolB: { sol: number; usdc: number };
  flashLoanProvider: { sol: number; usdc: number };
}