import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import './CreateRaffleModal.css';
import RollingRaffleArtifact from './contracts/RollingRaffle.json';
import FactoryArtifact from './contracts/RaffleFactory.json';

// Factory contract addresses - update with your deployed factory contracts
const FACTORY_CONFIG = {
  // Sepolia
  11155111: {
    address: "0x77A2624a746A97fA900c1C1C744e458d1Cd6bdBF", // Replace with your actual factory address
    name: "Sepolia Testnet",
    explorerUrl: "https://sepolia.etherscan.io"
  },
  // Abstract Testnet
  11124: {
    address: "0xe986d9beb28019f70f80390665D952a450597Ec0", // Replace with your actual factory address
    name: "Abstract Testnet",
    explorerUrl: "https://sepolia.abscan.org"
  }
};

// Default fee collector that will get a share of fees
const DEFAULT_FEE_COLLECTOR = "0xfB582E62c299BAaFC4CBdc3099767010A73d77c8";

const CreateRaffleModal = ({ isOpen, onClose, provider, signer, currentChainId, onRaffleCreated, authenticated, wallets }) => {
  const [ticketPrice, setTicketPrice] = useState("0.0025");
  const [ticketFeePercentage, setTicketFeePercentage] = useState(10);
  const [jackpotFeePercentage, setJackpotFeePercentage] = useState(10);
  const [winChance, setWinChance] = useState(20);
  const [feeCollector, setFeeCollector] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [creationComplete, setCreationComplete] = useState(false);
  const [newContractAddress, setNewContractAddress] = useState("");
  const [deploymentFee, setDeploymentFee] = useState("0.0");
  const [errorMessage, setErrorMessage] = useState("");

  // Reset form when modal is opened
  useEffect(() => {
    if (isOpen) {
      setTicketPrice("0.0025");
      setTicketFeePercentage(10);
      setJackpotFeePercentage(10);
      setWinChance(20);
      setFeeCollector("");
      setIsCreating(false);
      setCreationComplete(false);
      setNewContractAddress("");
      setErrorMessage("");
      estimateDeploymentFee();
    }
  }, [isOpen]);

  // Estimate deployment fee when chain changes
  useEffect(() => {
    if (isOpen) {
      estimateDeploymentFee();
    }
  }, [currentChainId]);

  const estimateDeploymentFee = async () => {
    if (!provider) return;
    
    try {
      // Get gas price
      const gasPrice = await provider.getGasPrice();
      
      // Estimate gas for deployment (approximate)
      const estimatedGas = 3000000; // This is an approximation, actual gas will vary
      
      // Calculate deployment fee
      const fee = gasPrice.mul(estimatedGas);
      setDeploymentFee(ethers.utils.formatEther(fee));
    } catch (error) {
      console.error("Error estimating deployment fee:", error);
      setDeploymentFee("0.01"); // Fallback to a reasonable estimate
    }
  };

  const handleCreateRaffle = async () => {
    if (!authenticated) {
      setErrorMessage("Please connect your wallet first");
      return;
    }
    
    // Get the connected wallet signer
    let actionSigner = null;
    if (wallets && wallets.length > 0) {
      const wallet = wallets[0];
      try {
        // Get provider from wallet
        let provider;
        if (wallet.getEthersProvider && typeof wallet.getEthersProvider === 'function') {
          provider = await wallet.getEthersProvider();
        } else if (window.ethereum) {
          console.log("Using window.ethereum provider");
          provider = new ethers.providers.Web3Provider(window.ethereum);
          // Request accounts to ensure connection
          await provider.send("eth_requestAccounts", []);
        } else {
          throw new Error("No provider available");
        }
        
        // Get signer
        actionSigner = provider.getSigner();
        const signerAddress = await actionSigner.getAddress();
        console.log(`Using signer with address: ${signerAddress}`);
      } catch (error) {
        console.error("Error getting signer:", error);
        setErrorMessage("Error connecting to wallet. Please refresh and try again.");
        return;
      }
    } else {
      setErrorMessage("No wallets available. Please connect your wallet first.");
      return;
    }
    
    // Continue with the existing validation...
    
    // Validate inputs
    if (parseFloat(ticketPrice) <= 0) {
      setErrorMessage("Ticket price must be greater than 0");
      return;
    }
    
    if (ticketFeePercentage < 0 || ticketFeePercentage > 30) {
      setErrorMessage("Ticket fee percentage must be between 0 and 30");
      return;
    }
    
    if (jackpotFeePercentage < 0 || jackpotFeePercentage > 30) {
      setErrorMessage("Jackpot fee percentage must be between 0 and 30");
      return;
    }
    
    if (winChance <= 0) {
      setErrorMessage("Win chance must be greater than 0");
      return;
    }
    
    if (feeCollector && !ethers.utils.isAddress(feeCollector)) {
      setErrorMessage("Invalid fee collector address");
      return;
    }
    
    // Clear any previous errors
    setErrorMessage("");
    setIsCreating(true);
    
    try {
      // Get factory contract using the signer we just confirmed
      const factoryAddress = FACTORY_CONFIG[currentChainId]?.address;
      if (!factoryAddress) {
        throw new Error(`No factory contract available for chain ${currentChainId}`);
      }
      
      // Create factory contract instance with the confirmed signer
      const factory = new ethers.Contract(
        factoryAddress,
        FactoryArtifact.abi,
        actionSigner  // Use the confirmed signer
      );
      
      // Calculate addresses for fee splitting
      let userFeeCollector = feeCollector;
      if (!userFeeCollector || userFeeCollector.trim() === "") {
        userFeeCollector = await signer.getAddress(); // Default to user's address
      }
      
      // Convert ticketPrice to wei
      const ticketPriceWei = ethers.utils.parseEther(ticketPrice.toString());
      
      console.log("Creating raffle with params:", {
        ticketPrice: ticketPriceWei.toString(),
        ticketFeePercentage,
        jackpotFeePercentage,
        winChance,
        userFeeCollector,
        defaultFeeCollector: DEFAULT_FEE_COLLECTOR
      });
      
      // Create raffle with fee splitting (calls the factory contract)
      const tx = await factory.createRaffle(
        ticketPriceWei,
        ticketFeePercentage,
        jackpotFeePercentage,
        winChance,
        userFeeCollector,
        DEFAULT_FEE_COLLECTOR
      );
      
      console.log("Transaction submitted:", tx.hash);
      
      // Wait for transaction to be mined
      const receipt = await tx.wait();
      console.log("Transaction confirmed:", receipt);
      
      // Extract the contract address from the logs
      // This assumes that the factory emits an event with the new raffle address
      const raffleCreatedEvent = receipt.events?.find(e => e.event === 'RaffleCreated');
      const newAddress = raffleCreatedEvent?.args?.raffleAddress;
      
      if (newAddress) {
        setNewContractAddress(newAddress);
        
        // Notify parent component
        if (onRaffleCreated) {
          onRaffleCreated(newAddress);
        }
      } else {
        throw new Error("Could not find new raffle address in transaction logs");
      }
      
      setCreationComplete(true);
    } catch (error) {
      console.error("Error creating raffle:", error);
      setErrorMessage(error.message || "Failed to create raffle. Please try again.");
      setIsCreating(false);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    handleCreateRaffle();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content create-raffle-modal">
        <button className="close-button" onClick={onClose}>×</button>
        
        {isCreating ? (
          <div className="loading-container">
            {!creationComplete ? (
              <>
                <div className="spinner"></div>
                <h2>Creating Raffle Contract</h2>
                <p>Please wait while your raffle contract is being deployed...</p>
                <p className="fee-note">Do not close this window or refresh the page</p>
              </>
            ) : (
              <div className="success-container">
                <div className="success-icon">✓</div>
                <h2>Raffle Created Successfully!</h2>
                <p>Your raffle contract has been deployed to:</p>
                <div className="contract-address">{newContractAddress}</div>
                
                <div className="button-group">
                  <button className="primary-button" onClick={() => {
                    // Include the chainId in the URL
                    window.location.href = `/raffle/${currentChainId}/${newContractAddress}`;
                  }}>
                    Go to Your Raffle
                  </button>
                  <button className="secondary-button" onClick={onClose}>
                    Close
                  </button>
                </div>
                
                <p className="explorer-link">
                  <a 
                    href={`${FACTORY_CONFIG[currentChainId]?.explorerUrl}/address/${newContractAddress}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    View on Block Explorer
                  </a>
                </p>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleFormSubmit}>
            <h2>Create New Raffle</h2>
            
            <div className="form-group">
              <label htmlFor="ticketPrice">Ticket Price (ETH)</label>
              <input
                id="ticketPrice"
                type="number"
                min="0.0001"
                step="0.0001"
                value={ticketPrice}
                onChange={(e) => setTicketPrice(e.target.value)}
                required
              />
              <p className="field-description">The cost of a single raffle ticket</p>
            </div>
            
            <div className="form-group">
              <label htmlFor="ticketFeePercentage">Ticket Fee (%)</label>
              <input
                id="ticketFeePercentage"
                type="number"
                min="0"
                max="30"
                value={ticketFeePercentage}
                onChange={(e) => setTicketFeePercentage(parseInt(e.target.value))}
                required
              />
              <p className="field-description">Percentage of ticket price taken as fee</p>
            </div>
            
            <div className="form-group">
              <label htmlFor="jackpotFeePercentage">Jackpot Fee (%)</label>
              <input
                id="jackpotFeePercentage"
                type="number"
                min="0"
                max="30"
                value={jackpotFeePercentage}
                onChange={(e) => setJackpotFeePercentage(parseInt(e.target.value))}
                required
              />
              <p className="field-description">Percentage of the pot taken as fee when someone wins</p>
            </div>
            
            <div className="form-group">
              <label htmlFor="winChance">Win Chance (1 in X)</label>
              <input
                id="winChance"
                type="number"
                min="1"
                value={winChance}
                onChange={(e) => setWinChance(parseInt(e.target.value))}
                required
              />
              <p className="field-description">Higher number = lower chance of winning</p>
            </div>
            
            <div className="form-group">
              <label htmlFor="feeCollector">Fee Collector Address (Optional)</label>
              <input
                id="feeCollector"
                type="text"
                placeholder="0x..."
                value={feeCollector}
                onChange={(e) => setFeeCollector(e.target.value)}
              />
              <p className="field-description">Address that will receive fees (your address if empty)</p>
            </div>
            
            {errorMessage && <div className="error-message">{errorMessage}</div>}
            
            <div className="fee-estimate">
              <p>Estimated deployment cost: <strong>{deploymentFee} ETH</strong></p>
              <p className="small-note">Note: Fees will be split 50/50 with platform</p>
            </div>
            
            <button type="submit" className="create-button">
              Deploy Raffle Contract
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default CreateRaffleModal;