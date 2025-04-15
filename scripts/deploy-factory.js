const hre = require("hardhat");

async function main() {
  console.log("Deploying RaffleFactory contract...");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying from account: ${deployer.address}`);

  // Default fee collector address - update this as needed
  const defaultFeeCollector = "0xfB582E62c299BAaFC4CBdc3099767010A73d77c8";
  
  // Deploy the factory
  const RaffleFactory = await hre.ethers.getContractFactory("RaffleFactory");
  const factory = await RaffleFactory.deploy(defaultFeeCollector);

  await factory.deployed();
  
  console.log(`RaffleFactory deployed to: ${factory.address}`);
  console.log(`Default fee collector set to: ${defaultFeeCollector}`);

  // Wait for several block confirmations to ensure the transaction is confirmed
  console.log("Waiting for block confirmations...");
  await factory.deployTransaction.wait(5);
  
  // Verify the contract on Etherscan
  console.log("Verifying contract on block explorer...");
  try {
    await hre.run("verify:verify", {
      address: factory.address,
      constructorArguments: [defaultFeeCollector],
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

// npx hardhat run scripts/deploy-factory.js --network sepolia
// npx hardhat run scripts/deploy-factory.js --network abstractTestnet