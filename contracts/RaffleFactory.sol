// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./RollingRaffle.sol";

/**
 * @title RaffleFactory
 * @dev Factory contract to create new RollingRaffle contracts with fee splitting
 */
contract RaffleFactory is Ownable {
    // Events
    event RaffleCreated(address indexed creator, address raffleAddress, uint256 ticketPrice);
    
    // Array to keep track of all created raffles
    address[] public createdRaffles;
    
    // Platform fee collector address (default)
    address public platformFeeCollector;
    
    /**
     * @dev Constructor sets the platform fee collector address
     */
    constructor(address _platformFeeCollector) {
        platformFeeCollector = _platformFeeCollector;
    }
    
    /**
     * @dev Create a new RollingRaffle contract
     * @param ticketPrice Initial ticket price
     * @param ticketFeePercentage Initial ticket fee percentage
     * @param jackpotFeePercentage Initial jackpot fee percentage
     * @param winChance Initial win chance
     * @param userFeeCollector Address provided by the user to collect fees
     * @param defaultFeeCollector Default platform fee collector address
     * @return The address of the new raffle contract
     */
    function createRaffle(
        uint256 ticketPrice,
        uint256 ticketFeePercentage,
        uint256 jackpotFeePercentage,
        uint256 winChance,
        address userFeeCollector,
        address defaultFeeCollector
    ) external returns (address) {
        // Create a new FeeSplitter contract
        FeeSplitter feeSplitter = new FeeSplitter(userFeeCollector, defaultFeeCollector);
        
        // Create a new RollingRaffle contract
        RollingRaffle newRaffle = new RollingRaffle();
        
        // Initialize the raffle with the provided parameters
        newRaffle.updateTicketPrice(ticketPrice);
        newRaffle.updateTicketFeePercentage(ticketFeePercentage);
        newRaffle.updateJackpotFeePercentage(jackpotFeePercentage);
        newRaffle.updateWinChance(winChance);
        
        // Set the fee collector to the FeeSplitter address
        newRaffle.updateFeeCollector(address(feeSplitter));
        
        // Add the new raffle to our tracking array
        createdRaffles.push(address(newRaffle));
        
        // Transfer ownership to the message sender
        newRaffle.transferOwnership(msg.sender);
        
        // Emit event
        emit RaffleCreated(msg.sender, address(newRaffle), ticketPrice);
        
        return address(newRaffle);
    }
    
    /**
     * @dev Update the platform fee collector address
     * @param _platformFeeCollector The new platform fee collector address
     */
    function updatePlatformFeeCollector(address _platformFeeCollector) external onlyOwner {
        require(_platformFeeCollector != address(0), "Invalid address");
        platformFeeCollector = _platformFeeCollector;
    }
    
    /**
     * @dev Get the number of raffles created
     * @return The count of created raffles
     */
    function getRaffleCount() external view returns (uint256) {
        return createdRaffles.length;
    }
    
    /**
     * @dev Get a paginated list of created raffles
     * @param start The starting index
     * @param limit The maximum number of entries to return
     * @return Array of raffle addresses
     */
    function getRaffles(uint256 start, uint256 limit) external view returns (address[] memory) {
        uint256 end = start + limit;
        
        // Ensure end doesn't exceed the array length
        if (end > createdRaffles.length) {
            end = createdRaffles.length;
        }
        
        // Calculate actual count
        uint256 count = end - start;
        
        // Create result array
        address[] memory result = new address[](count);
        
        // Fill result array
        for (uint256 i = 0; i < count; i++) {
            result[i] = createdRaffles[start + i];
        }
        
        return result;
    }
}

/**
 * @title FeeSplitter
 * @dev Contract to split fees between two addresses
 */
contract FeeSplitter {
    // Fee recipients
    address public userFeeCollector;
    address public defaultFeeCollector;
    
    /**
     * @dev Constructor sets the fee collectors
     */
    constructor(address _userFeeCollector, address _defaultFeeCollector) {
        userFeeCollector = _userFeeCollector;
        defaultFeeCollector = _defaultFeeCollector;
    }
    
    /**
     * @dev Fallback function to split received ETH 50/50 between fee collectors
     */
    receive() external payable {
        if (msg.value > 0) {
            // Split fees 50/50
            uint256 halfFee = msg.value / 2;
            
            // Send to user's fee collector
            (bool successUser, ) = payable(userFeeCollector).call{value: halfFee}("");
            require(successUser, "User fee transfer failed");
            
            // Send to default fee collector
            (bool successDefault, ) = payable(defaultFeeCollector).call{value: msg.value - halfFee}("");
            require(successDefault, "Default fee transfer failed");
        }
    }
}