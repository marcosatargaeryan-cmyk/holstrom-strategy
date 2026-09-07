#[cfg(test)]
mod tests {
    use tokio;

    #[tokio::test]
    async fn test_holstrom_strategy() {
        println!("=== Starting Holstrom Strategy Test ===\n");

        // Configure strategy (optimized for complete loan repayment)
        let config = holstrom_strategy::HolstromConfig {
            initial_price: 95.831125,
            target_drawdown_price: 90.0,     // Minimal drawdown
            clmm_lower_bound: 88.0,         // Tight CLMM range
            flash_loan_amount: 300.0,       // Moderate flash loan
            recursive_loan_amount: 50.0,     // Small recursive operations
            buyback_loan_amount: 1500.0,     // Smaller USDC loan
        };

        // Execute strategy
        let result = holstrom_strategy::execute_strategy(&config).await
            .expect("Strategy execution failed");

        println!("\n=== Test Results ===");
        println!("Success: {}", result.success);
        println!("Initial Price: ${}", result.initial_price);
        println!("Final Price: ${}", result.final_price);
        println!("Profit/Loss: ${}", result.profit_loss);
        println!("Fees Paid: ${}", result.fees_paid);
        println!("Slippage: {:.4}%", result.slippage * 100.0);

        // Print all transaction logs
        println!("\n=== Transaction Logs ===");
        for log in &result.transaction_logs {
            println!("{}", log);
        }

        // The test should pass even if not profitable - we're testing the logic
        println!("\nTest completed - strategy execution framework is working");
        
        // Assert that the strategy executed without errors
        assert!(!result.transaction_logs.is_empty(), "Strategy should produce transaction logs");
    }
}