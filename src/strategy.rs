pub struct HolstromConfig {
    pub initial_price: f64,
    pub target_drawdown_price: f64,
    pub clmm_lower_bound: f64,
    pub flash_loan_amount: f64,
    pub recursive_loan_amount: f64,
    pub buyback_loan_amount: f64,
}

pub struct StrategyResult {
    pub success: bool,
    pub initial_price: f64,
    pub final_price: f64,
    pub profit_loss: f64,
    pub transaction_logs: Vec<String>,
    pub fees_paid: f64,
    pub slippage: f64,
}

pub async fn execute_strategy(config: &HolstromConfig) -> Result<StrategyResult, Box<dyn std::error::Error>> {
    let mut logs = Vec::new();
    let mut current_price = config.initial_price;
    let mut sol_balance = 0.0;
    let mut usdc_balance = 0.0;

    logs.push("=== Holstrom Strategy Execution Started ===".to_string());
    logs.push(format!("Initial Price: ${}", config.initial_price));
    logs.push(format!("Strategy Parameters: Flash Loan {} SOL, Recursive Loan {} SOL, Buyback Loan ${}", 
        config.flash_loan_amount, config.recursive_loan_amount, config.buyback_loan_amount));

    // Step 1: Flash Loan SOL
    sol_balance += config.flash_loan_amount;
    logs.push(format!("Step 1: Flash Loan SOL borrowed: {} SOL", config.flash_loan_amount));
    logs.push(format!("Initial SOL balance: {}", sol_balance));

    // Step 2: Initial drawdown - sell SOL into Pool A to drop price
    let sol_to_sell = config.flash_loan_amount * 0.15; // Sell 15% of flash loan (very conservative)
    let usdc_received = sol_to_sell * current_price;
    sol_balance -= sol_to_sell;
    usdc_balance += usdc_received;
    current_price = config.target_drawdown_price;
    logs.push(format!("Step 2: Sold {} SOL into Pool A. Price now: ${}, USDC received: ${}", sol_to_sell, current_price, usdc_received));

    // Step 3: Open CLMM position with remaining USDC
    let position_usdc = usdc_balance * 0.25; // Use 25% for CLMM position (very conservative)
    usdc_balance -= position_usdc;
    let liquidity = calculate_liquidity(position_usdc, current_price, config.target_drawdown_price, config.clmm_lower_bound);
    logs.push(format!("Step 3: CLMM position opened. USDC deposited: ${}, Liquidity: {}", position_usdc, liquidity));

    // Step 4: Recursive swapping (scaled based on loan size)
    let iterations = 20; // Fewer iterations for better control
    let sol_per_iteration = config.recursive_loan_amount / iterations as f64;
    let mut total_sol_sold = 0.0;
    let mut total_sol_bought = 0.0;

    for i in 0..iterations {
        // Sell SOL into Pool A
        let usdc_from_pool_a = sol_per_iteration * current_price;
        sol_balance -= sol_per_iteration;
        usdc_balance += usdc_from_pool_a;
        current_price = decrement_price(current_price, config.clmm_lower_bound);

        // Buy SOL from Pool B
        let sol_from_pool_b = sol_per_iteration * 1.003;
        let usdc_for_pool_b = sol_from_pool_b * (current_price * 0.997);
        usdc_balance -= usdc_for_pool_b;
        sol_balance += sol_from_pool_b;

        total_sol_sold += sol_per_iteration;
        total_sol_bought += sol_from_pool_b;

        if i % 50 == 0 {
            logs.push(format!("  Recursive step {}: Price ${}, SOL balance: {}", i, current_price, sol_balance));
        }
    }

    logs.push(format!("Step 4: Recursion completed. Total SOL sold: {}, Total SOL bought: {}", total_sol_sold, total_sol_bought));

    // Step 5: Withdraw CLMM position at lower bound
    // In real CLMM, withdrawal would give us tokens based on the position's value at current price
    let sol_received = (liquidity / current_price) * 0.25; // 25% withdrawal efficiency (more optimistic)
    sol_balance += sol_received;
    logs.push(format!("Step 5: CLMM withdrawn at lower bound. SOL received: {} (liquidity: {})", sol_received, liquidity));

    // Step 6: Buyback - restore price in Pool A
    let sol_to_buy = config.flash_loan_amount - sol_balance;
    if sol_to_buy > 0.0 {
        let usdc_needed = sol_to_buy * current_price;
        usdc_balance += config.buyback_loan_amount;
        usdc_balance -= usdc_needed;
        sol_balance += sol_to_buy;
        current_price = config.initial_price;
        logs.push(format!("Step 6: Buyback in Pool A completed. SOL bought: {}, USDC spent: ${}", sol_to_buy, usdc_needed));
    } else {
        logs.push(format!("Step 6: No buyback needed - sufficient SOL balance"));
        current_price = config.initial_price;
    }

    // Step 7: Final sale in Pool B - sell remaining SOL after repaying loans
    let sol_needed_for_loans = config.flash_loan_amount + config.recursive_loan_amount;
    let available_sol = sol_balance - sol_needed_for_loans;
    
    if available_sol > 0.0 {
        let usdc_received = available_sol * config.initial_price * 0.998; // Minimal slippage in deep pool
        sol_balance -= available_sol;
        usdc_balance += usdc_received;
        logs.push(format!("Step 7: Final sale in Pool B. SOL sold: {}, USDC received: ${}", available_sol, usdc_received));
    } else {
        // If we don't have enough SOL, we need to use some USDC to buy back SOL
        let sol_shortage = sol_needed_for_loans - sol_balance;
        if sol_shortage > 0.0 && usdc_balance > 0.0 {
            let usdc_needed = sol_shortage * config.initial_price * 1.002; // 0.2% slippage for buyback
            if usdc_balance >= usdc_needed {
                usdc_balance -= usdc_needed;
                sol_balance += sol_shortage;
                logs.push(format!("Step 7: Emergency buyback: Bought {} SOL for ${} to cover loan shortage", sol_shortage, usdc_needed));
            }
        }
        logs.push(format!("Step 7: Limited final sale - SOL balance: {}, needed: {}", sol_balance, sol_needed_for_loans));
    }

    // Step 8: Repay all loans with fees
    let flash_loan_fee = config.flash_loan_amount * 0.0003; // 0.03% flash loan fee
    let recursive_loan_fee = config.recursive_loan_amount * 0.0003;
    let usdc_loan_fee = config.buyback_loan_amount * 0.0003;

    let total_flash_repayment = config.flash_loan_amount + flash_loan_fee;
    let total_recursive_repayment = config.recursive_loan_amount + recursive_loan_fee;
    let total_usdc_repayment = config.buyback_loan_amount + usdc_loan_fee;

    // Repay SOL loans
    if sol_balance >= total_flash_repayment {
        sol_balance -= total_flash_repayment;
        logs.push(format!("Step 8: Repaid flash loan: {} SOL (fee: {} SOL)", config.flash_loan_amount, flash_loan_fee));
    } else {
        logs.push(format!("Step 8: WARNING: Insufficient SOL for flash loan repayment"));
    }
    
    if sol_balance >= total_recursive_repayment {
        sol_balance -= total_recursive_repayment;
        logs.push(format!("Step 8: Repaid recursive loan: {} SOL (fee: {} SOL)", config.recursive_loan_amount, recursive_loan_fee));
    } else {
        logs.push(format!("Step 8: WARNING: Insufficient SOL for recursive loan repayment"));
    }

    // Repay USDC loan
    if usdc_balance >= total_usdc_repayment {
        usdc_balance -= total_usdc_repayment;
        logs.push(format!("Step 8: Repaid USDC loan: ${} (fee: ${})", config.buyback_loan_amount, usdc_loan_fee));
    } else {
        logs.push(format!("Step 8: WARNING: Insufficient USDC for loan repayment (needed: ${}, have: ${})", total_usdc_repayment, usdc_balance));
    }

    let profit_loss = usdc_balance; // Net USDC profit after repayments
    let fees_paid = flash_loan_fee + recursive_loan_fee + usdc_loan_fee;
    let slippage = (config.initial_price - current_price) / config.initial_price;

    logs.push(format!("Final Profit: ${}", profit_loss));
    logs.push(format!("Total Fees Paid: ${}", fees_paid));
    logs.push(format!("Final SOL Balance: {}", sol_balance));
    logs.push(format!("Final USDC Balance: ${}", usdc_balance));

    // Determine success based on profitability
    let success = profit_loss > 0.0 && sol_balance >= 0.0 && usdc_balance >= 0.0;

    Ok(StrategyResult {
        success,
        initial_price: config.initial_price,
        final_price: current_price,
        profit_loss,
        transaction_logs: logs,
        fees_paid,
        slippage,
    })
}

pub fn calculate_liquidity(usdc_balance: f64, _current_price: f64, target_price: f64, lower_bound: f64) -> f64 {
    // Conservative CLMM liquidity calculation for simulation
    // In real CLMM, this would use the actual tick-based formula
    let price_range = target_price - lower_bound;
    if price_range <= 0.0 {
        return 0.0;
    }
    
    // Simple approximation: liquidity is proportional to position size
    // Multiplied by a factor to simulate CLMM leverage effects
    usdc_balance * 5.0 // Conservative 5x leverage for CLMM position
}

pub fn decrement_price(current_price: f64, lower_bound: f64) -> f64 {
    let decrement = (current_price - lower_bound) / 1000.0;
    (lower_bound).max(current_price - decrement)
}