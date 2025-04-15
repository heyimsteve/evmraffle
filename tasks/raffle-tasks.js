/* How to use:

# View contract info
npx hardhat raffle:info --network sepolia

# Rescue ETH
npx hardhat raffle:rescue-eth --network sepolia

# Update ticket price to 0.0035 ETH
npx hardhat raffle:update-ticket-price 0.0035 --network sepolia

# Update ticket fee percentage to 8%
npx hardhat raffle:update-ticket-fee 8 --network sepolia

# Update jackpot fee percentage to 12%
npx hardhat raffle:update-jackpot-fee 12 --network sepolia

# Update win chance to 1 in 25
npx hardhat raffle:update-win-chance 25 --network sepolia

# Update fee collector address
npx hardhat raffle:update-fee-collector 0xYourNewAddressHere --network sepolia

# Transfer contract ownership
npx hardhat raffle:transfer-ownership 0xNewOwnerAddressHere --network sepolia
*/

const { task } = require("hardhat/config");

// Contract addresses for different networks
const CONTRACTS = {
  sepolia: "0xBf889381DEEA45F83DFc3183F0869368eEA7d1B4",
  abstractTestnet: "0xA5785b8987f6E61a635315E6C77E2C852EEBAB0F"
};

// Helper to get contract instance
async function getContract(hre) {
  const { ethers, network } = hre;
  
  // Get contract address for current network
  const contractAddress = CONTRACTS[network.name];
  if (!contractAddress) {
    throw new Error(`No contract address configured for network ${network.name}`);
  }
  
  console.log(`Using contract address: ${contractAddress} on ${network.name}`);
  
  // Connect to the contract
  const RollingRaffle = await ethers.getContractFactory("RollingRaffle");
  return await RollingRaffle.attach(contractAddress);
}

// Display contract info
task("raffle:info", "Display RollingRaffle contract information")
  .setAction(async (_, hre) => {
    const { ethers } = hre;
    const contract = await getContract(hre);
    
    const [
      ticketPrice,
      ticketFeePercentage,
      jackpotFeePercentage,
      winChance,
      pot,
      feeCollector,
      lastWinner,
      lastWinAmount,
      owner
    ] = await Promise.all([
      contract.ticketPrice(),
      contract.ticketFeePercentage(),
      contract.jackpotFeePercentage(),
      contract.winChance(),
      contract.pot(),
      contract.feeCollector(),
      contract.lastWinner(),
      contract.lastWinAmount(),
      contract.owner()
    ]);

    console.log("=== RollingRaffle Contract Information ===");
    console.log(`Ticket Price: ${ethers.utils.formatEther(ticketPrice)} ETH`);
    console.log(`Ticket Fee Percentage: ${ticketFeePercentage}%`);
    console.log(`Jackpot Fee Percentage: ${jackpotFeePercentage}%`);
    console.log(`Win Chance: 1 in ${winChance} (${100/winChance.toNumber()}%)`);
    console.log(`Current Pot: ${ethers.utils.formatEther(pot)} ETH`);
    console.log(`Fee Collector: ${feeCollector}`);
    console.log(`Contract Owner: ${owner}`);
    console.log(`Last Winner: ${lastWinner === ethers.constants.AddressZero ? "None" : lastWinner}`);
    console.log(`Last Win Amount: ${ethers.utils.formatEther(lastWinAmount)} ETH`);
    console.log("=========================================");
  });

// Rescue ETH from contract
task("raffle:rescue-eth", "Rescue ETH from the RollingRaffle contract")
  .setAction(async (_, hre) => {
    const { ethers } = hre;
    const contract = await getContract(hre);
    
    const contractBalance = await ethers.provider.getBalance(contract.address);
    if (contractBalance.eq(0)) {
      console.log("Contract balance is 0, nothing to rescue");
      return;
    }
    
    console.log(`Rescuing ${ethers.utils.formatEther(contractBalance)} ETH from contract...`);
    const tx = await contract.rescueETH();
    await tx.wait();
    console.log(`ETH rescued successfully! (tx: ${tx.hash})`);
    
    // Verify the rescue
    const newContractBalance = await ethers.provider.getBalance(contract.address);
    console.log(`New contract balance: ${ethers.utils.formatEther(newContractBalance)} ETH`);
  });

// Update ticket price
task("raffle:update-ticket-price", "Update the ticket price")
  .addPositionalParam("price", "New ticket price in ETH")
  .setAction(async (args, hre) => {
    const { ethers } = hre;
    const contract = await getContract(hre);
    
    const newPrice = parseFloat(args.price);
    if (isNaN(newPrice) || newPrice <= 0) {
      console.error("Invalid ticket price. Must be a positive number.");
      return;
    }
    
    console.log(`Updating ticket price to ${newPrice} ETH...`);
    const newPriceWei = ethers.utils.parseEther(newPrice.toString());
    const tx = await contract.updateTicketPrice(newPriceWei);
    await tx.wait();
    console.log(`Ticket price updated successfully! (tx: ${tx.hash})`);
    
    // Verify the update
    const updatedPrice = await contract.ticketPrice();
    console.log(`New ticket price: ${ethers.utils.formatEther(updatedPrice)} ETH`);
  });

// Update ticket fee percentage
task("raffle:update-ticket-fee", "Update the ticket fee percentage")
  .addPositionalParam("percentage", "New ticket fee percentage (0-30)")
  .setAction(async (args, hre) => {
    const contract = await getContract(hre);
    
    const newPercentage = parseInt(args.percentage);
    if (isNaN(newPercentage) || newPercentage < 0 || newPercentage > 30) {
      console.error("Invalid ticket fee percentage. Must be between 0 and 30.");
      return;
    }
    
    console.log(`Updating ticket fee percentage to ${newPercentage}%...`);
    const tx = await contract.updateTicketFeePercentage(newPercentage);
    await tx.wait();
    console.log(`Ticket fee percentage updated successfully! (tx: ${tx.hash})`);
    
    // Verify the update
    const updatedPercentage = await contract.ticketFeePercentage();
    console.log(`New ticket fee percentage: ${updatedPercentage}%`);
  });

// Update jackpot fee percentage
task("raffle:update-jackpot-fee", "Update the jackpot fee percentage")
  .addPositionalParam("percentage", "New jackpot fee percentage (0-30)")
  .setAction(async (args, hre) => {
    const contract = await getContract(hre);
    
    const newPercentage = parseInt(args.percentage);
    if (isNaN(newPercentage) || newPercentage < 0 || newPercentage > 30) {
      console.error("Invalid jackpot fee percentage. Must be between 0 and 30.");
      return;
    }
    
    console.log(`Updating jackpot fee percentage to ${newPercentage}%...`);
    const tx = await contract.updateJackpotFeePercentage(newPercentage);
    await tx.wait();
    console.log(`Jackpot fee percentage updated successfully! (tx: ${tx.hash})`);
    
    // Verify the update
    const updatedPercentage = await contract.jackpotFeePercentage();
    console.log(`New jackpot fee percentage: ${updatedPercentage}%`);
  });

// Update win chance
task("raffle:update-win-chance", "Update the win chance")
  .addPositionalParam("chance", "New win chance (1 in X)")
  .setAction(async (args, hre) => {
    const contract = await getContract(hre);
    
    const newWinChance = parseInt(args.chance);
    if (isNaN(newWinChance) || newWinChance <= 0) {
      console.error("Invalid win chance. Must be a positive integer.");
      return;
    }
    
    console.log(`Updating win chance to 1 in ${newWinChance}...`);
    const tx = await contract.updateWinChance(newWinChance);
    await tx.wait();
    console.log(`Win chance updated successfully! (tx: ${tx.hash})`);
    
    // Verify the update
    const updatedWinChance = await contract.winChance();
    console.log(`New win chance: 1 in ${updatedWinChance} (${100/updatedWinChance.toNumber()}%)`);
  });

// Update fee collector
task("raffle:update-fee-collector", "Update the fee collector address")
  .addPositionalParam("address", "New fee collector address")
  .setAction(async (args, hre) => {
    const { ethers } = hre;
    const contract = await getContract(hre);
    
    if (!ethers.utils.isAddress(args.address)) {
      console.error("Invalid address for fee collector.");
      return;
    }
    
    console.log(`Updating fee collector to ${args.address}...`);
    const tx = await contract.updateFeeCollector(args.address);
    await tx.wait();
    console.log(`Fee collector updated successfully! (tx: ${tx.hash})`);
    
    // Verify the update
    const updatedFeeCollector = await contract.feeCollector();
    console.log(`New fee collector: ${updatedFeeCollector}`);
  });

// Transfer ownership
task("raffle:transfer-ownership", "Transfer contract ownership")
  .addPositionalParam("address", "New owner address")
  .setAction(async (args, hre) => {
    const { ethers } = hre;
    const contract = await getContract(hre);
    
    if (!ethers.utils.isAddress(args.address)) {
      console.error("Invalid address for new owner.");
      return;
    }
    
    console.log(`Transferring ownership to ${args.address}...`);
    const tx = await contract.transferOwnership(args.address);
    await tx.wait();
    console.log(`Ownership transferred successfully! (tx: ${tx.hash})`);
    
    // Verify the transfer
    const updatedOwner = await contract.owner();
    console.log(`New owner: ${updatedOwner}`);
  });