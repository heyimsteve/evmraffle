// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title RollingRaffle
 * @dev A rolling raffle system where users can buy tickets with a chance to win the entire pot
 */
contract RollingRaffle is Ownable, ReentrancyGuard {
    // Configurable parameters
    uint256 public ticketPrice = 0.0025 ether;  // Default ticket price is 0.0025 ETH
    uint256 public ticketFeePercentage = 10;    // Default 10% fee on ticket purchases
    uint256 public jackpotFeePercentage = 5;   // Default 5% fee on jackpot winnings

    // State variables
    uint256 public pot;
    uint256 public winChance = 20; // 1 in 20 chance of winning (5%)
    address public feeCollector;
    address public lastWinner;
    uint256 public lastWinAmount;

    // Events
    event TicketBought(address indexed player, uint256 amount, uint256 pot, bool won);
    event MultipleTicketsBought(address indexed player, uint256 quantity, uint256 totalAmount, uint256 pot);
    event Winner(address indexed player, uint256 prizeAmount);
    event FeeSent(address indexed to, uint256 amount);
    event RefundSent(address indexed to, uint256 amount);

    /**
     * @dev Constructor sets the initial fee collector address
     */
    constructor() {
        feeCollector = msg.sender;
    }

    /**
     * @dev Allows a user to buy a ticket with a chance to win the pot
     */
    function buyTicket() external payable nonReentrant {
        require(msg.value == ticketPrice, "Must send exact ticket price");
        
        _processTicketPurchase();
    }
    
    /**
     * @dev Allows a user to buy multiple tickets at once
     * @param quantity The number of tickets to buy
     */
    function buyMultipleTickets(uint256 quantity) external payable nonReentrant {
        require(quantity > 0, "Must buy at least one ticket");
        require(msg.value == ticketPrice * quantity, "Incorrect ETH amount for tickets");
        
        bool hasWon = false;
        address winner = address(0);
        uint256 prizeAmount = 0;
        uint256 processedTickets = 0;
        
        // Process each ticket
        for (uint256 i = 0; i < quantity; i++) {
            // Calculate fee and amount to add to pot
            uint256 fee = (ticketPrice * ticketFeePercentage) / 100;
            uint256 potContribution = ticketPrice - fee;
            
            // Send fee to fee collector
            (bool feeSuccess, ) = payable(feeCollector).call{value: fee}("");
            require(feeSuccess, "Fee transfer failed");
            emit FeeSent(feeCollector, fee);
            
            // Add contribution to pot
            pot += potContribution;
            
            // Increment processed tickets counter
            processedTickets++;
            
            // Check if player won
            bool won = checkWin();
            
            if (won && pot > 0) {
                hasWon = true;
                winner = msg.sender;
                
                // Calculate winner amount and fee on pot
                uint256 potFee = (pot * jackpotFeePercentage) / 100;
                prizeAmount = pot - potFee;
                
                // Send fee to fee collector
                (bool potFeeSuccess, ) = payable(feeCollector).call{value: potFee}("");
                require(potFeeSuccess, "Pot fee transfer failed");
                emit FeeSent(feeCollector, potFee);
                
                // Save winner info
                lastWinner = msg.sender;
                lastWinAmount = prizeAmount;
                
                // Reset pot
                pot = 0;
                
                // Don't transfer to winner yet - do it after the loop
                emit Winner(msg.sender, prizeAmount);
                break; // Stop processing tickets if we won
            }
        }
        
        // If there are unprocessed tickets, refund their value to the player
        uint256 remainingTickets = quantity - processedTickets;
        if (remainingTickets > 0) {
            uint256 refundAmount = ticketPrice * remainingTickets;
            (bool refundSuccess, ) = payable(msg.sender).call{value: refundAmount}("");
            require(refundSuccess, "Refund transfer failed");
            emit RefundSent(msg.sender, refundAmount);
        }
        
        // Send prize to winner if they won
        if (hasWon) {
            (bool winnerSuccess, ) = payable(winner).call{value: prizeAmount}("");
            require(winnerSuccess, "Winner transfer failed");
        }
        
        // Emit multiple tickets bought event
        emit MultipleTicketsBought(msg.sender, processedTickets, ticketPrice * processedTickets, pot);
        
        // Emit ticket bought event for the last processed ticket (for backward compatibility)
        emit TicketBought(msg.sender, ticketPrice, pot, hasWon);
    }
    
    /**
     * @dev Internal function to process a single ticket purchase
     */
    function _processTicketPurchase() internal {
        // Calculate fee and amount to add to pot
        uint256 fee = (msg.value * ticketFeePercentage) / 100;
        uint256 potContribution = msg.value - fee;
        
        // Send fee to fee collector
        (bool feeSuccess, ) = payable(feeCollector).call{value: fee}("");
        require(feeSuccess, "Fee transfer failed");
        emit FeeSent(feeCollector, fee);
        
        // Add contribution to pot
        pot += potContribution;
        
        // Check if player won
        bool won = checkWin();
        
        if (won && pot > 0) {
            // Calculate winner amount and fee on pot
            uint256 potFee = (pot * jackpotFeePercentage) / 100;
            uint256 winnerAmount = pot - potFee;
            
            // Send fee to fee collector
            (bool potFeeSuccess, ) = payable(feeCollector).call{value: potFee}("");
            require(potFeeSuccess, "Pot fee transfer failed");
            emit FeeSent(feeCollector, potFee);
            
            // Save winner info
            lastWinner = msg.sender;
            lastWinAmount = winnerAmount;
            
            // Reset pot
            pot = 0;
            
            // Send prize to winner
            (bool winnerSuccess, ) = payable(msg.sender).call{value: winnerAmount}("");
            require(winnerSuccess, "Winner transfer failed");
            
            emit Winner(msg.sender, winnerAmount);
        }
        
        emit TicketBought(msg.sender, msg.value, pot, won);
    }

    /**
     * @dev Pseudo-random function to determine if player won
     * @return True if player won, false otherwise
     */
    function checkWin() internal view returns (bool) {
        // WARNING: This is not secure for production
        // Use this placeholder until Chainlink VRF is integrated
        uint256 randomNumber = uint256(keccak256(abi.encodePacked(
            block.prevrandao,
            block.timestamp,
            msg.sender,
            gasleft() // Add gasleft() for some extra randomness for multiple calls in the same transaction
        ))) % winChance;
        
        return randomNumber == 0;
    }

    /**
     * @dev Update the fee collector address
     * @param _feeCollector The new fee collector address
     */
    function updateFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "Invalid address");
        feeCollector = _feeCollector;
    }

    /**
     * @dev Update the win chance
     * @param _winChance The new win chance (1 in _winChance)
     */
    function updateWinChance(uint256 _winChance) external onlyOwner {
        require(_winChance > 0, "Win chance must be greater than 0");
        winChance = _winChance;
    }
    
    /**
     * @dev Update the ticket price
     * @param _ticketPrice The new ticket price in wei
     */
    function updateTicketPrice(uint256 _ticketPrice) external onlyOwner {
        require(_ticketPrice > 0, "Ticket price must be greater than 0");
        ticketPrice = _ticketPrice;
    }
    
    /**
     * @dev Update the ticket fee percentage
     * @param _ticketFeePercentage The new ticket fee percentage
     */
    function updateTicketFeePercentage(uint256 _ticketFeePercentage) external onlyOwner {
        require(_ticketFeePercentage <= 30, "Ticket fee cannot exceed 30%");
        ticketFeePercentage = _ticketFeePercentage;
    }
    
    /**
     * @dev Update the jackpot fee percentage
     * @param _jackpotFeePercentage The new jackpot fee percentage
     */
    function updateJackpotFeePercentage(uint256 _jackpotFeePercentage) external onlyOwner {
        require(_jackpotFeePercentage <= 30, "Jackpot fee cannot exceed 30%");
        jackpotFeePercentage = _jackpotFeePercentage;
    }

    /**
     * @dev Emergency function to rescue ETH from the contract
     */
    function rescueETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to rescue");
        
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Transfer failed");
    }

    /**
     * @dev Returns the current pot balance in wei
     */
    function getPot() external view returns (uint256) {
        return pot;
    }

    /**
     * @dev Prepare for Chainlink VRF integration
     * This function would replace the checkWin function when implemented
     */
    // function requestRandomness() internal returns (bytes32 requestId) {
    //     // Chainlink VRF implementation will go here
    // }
}