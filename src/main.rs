use holstrom_strategy::{HolstromConfig, execute_strategy};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Starting Holstrom Strategy Test (Rust Simulation) ===\n");

    // Configure strategy parameters (optimized for complete loan repayment)
    let config = HolstromConfig {
        initial_price: 95.831125,           // Starting SOL/USDC price
        target_drawdown_price: 90.0,        // Minimal drawdown (~6% drop)
        clmm_lower_bound: 88.0,             // Tight CLMM range
        flash_loan_amount: 300.0,           // Moderate flash loan
        recursive_loan_amount: 50.0,        // Small recursive operations
        buyback_loan_amount: 1500.0,        // Smaller USDC loan (easier to repay)
    };

    println!("\n=== Strategy Configuration ===");
    println!("Initial Price: {}", config.initial_price);
    println!("Target Drawdown Price: {}", config.target_drawdown_price);
    println!("CLMM Lower Bound: {}", config.clmm_lower_bound);
    println!("Flash Loan Amount: {} SOL", config.flash_loan_amount);
    println!("Recursive Loan Amount: {} SOL", config.recursive_loan_amount);
    println!("Buyback Loan Amount: {} USDC", config.buyback_loan_amount);

    // Execute strategy
    let result = execute_strategy(&config).await?;

    println!("\n=== Test Results ===");
    println!("Success: {}", result.success);
    println!("Initial Price: ${}", result.initial_price);
    println!("Final Price: ${}", result.final_price);
    println!("Profit/Loss: ${}", result.profit_loss);
    println!("Fees Paid: ${}", result.fees_paid);
    println!("Slippage: {:.4}%", result.slippage * 100.0);

    println!("\n=== Transaction Logs ===");
    for log in &result.transaction_logs {
        println!("{}", log);
    }

    println!("\n=== Test Completed ===");
    if result.success {
        println!("✅ Strategy executed successfully with ${:.2} profit", result.profit_loss);
    } else {
        println!("❌ Strategy execution encountered issues");
    }
    
    Ok(())
}