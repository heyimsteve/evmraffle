const hre = require("hardhat");

async function main() {
  console.log("Deploying RollingRaffle contract...");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying from account: ${deployer.address}`);

  const RollingRaffle = await hre.ethers.getContractFactory("RollingRaffle");
  const raffle = await RollingRaffle.deploy();

  await raffle.deployed();
  
  console.log(`RollingRaffle deployed to: ${raffle.address}`);

  // Set the fee collector address
  console.log("Setting fee collector address...");
  await raffle.updateFeeCollector("0xfB582E62c299BAaFC4CBdc3099767010A73d77c8");
  console.log("Fee collector address set successfully");

  console.log("Setting win chance to 1 in 20...");
  await raffle.updateWinChance(20);
  console.log("Win chance set successfully");

  // Wait for several block confirmations to ensure the transaction is confirmed
  console.log("Waiting for block confirmations...");
  await raffle.deployTransaction.wait(5);
  
  // Verify the contract on Etherscan
  console.log("Verifying contract on Etherscan...");
  try {
    await hre.run("verify:verify", {
      address: raffle.address,
      constructorArguments: [],
    });
    console.log("Contract verified successfully!");
  } catch (error) {
    console.error("Error verifying contract:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });