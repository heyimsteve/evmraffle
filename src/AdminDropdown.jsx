import React, { useState, useRef, useEffect } from 'react';
import { ethers } from 'ethers';
import './AdminDropdown.css';
import AdminModal from './AdminModal';
import RaffleFactoryArtifact from './contracts/RaffleFactory.json';
import FeeSplitterArtifact from './contracts/FeeSplitter.json';

const AdminDropdown = ({ 
  contractABI,
  contractAddress,
  address, 
  potSize, 
  ticketPrice,
  ticketFeePercentage,
  jackpotFeePercentage,
  feeCollector,
  userFeeCollector, // Make sure these are passed from App.jsx
  defaultFeeCollector,
  winChance, // Make sure this is passed from App.jsx
  onActionComplete,
  wallets
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState(null);
  const [modalTitle, setModalTitle] = useState('');
  const [modalContent, setModalContent] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Provide defaults for props that might be undefined
  const safeUserFeeCollector = userFeeCollector || feeCollector;
  const safeDefaultFeeCollector = defaultFeeCollector || "0xfB582E62c299BAaFC4CBdc3099767010A73d77c8";
  const safeWinChance = winChance || 20;
  
  const dropdownRef = useRef(null);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  
  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };
  
  const handleOptionClick = (option) => {
    setIsOpen(false);
    
    switch(option) {
      case 'drain':
        setModalType('drain');
        setModalTitle('Drain Jackpot');
        setModalContent({
          potSize,
          message: `Are you sure you want to withdraw ${potSize} ETH to your wallet?`
        });
        break;
      case 'ticketPrice':
        setModalType('ticketPrice');
        setModalTitle('Update Ticket Price');
        setModalContent({
          currentValue: ethers.utils.formatEther(ticketPrice),
          label: 'New Ticket Price (ETH)',
          placeholder: '0.0025',
          inputType: 'number',
          min: '0.0001',
          step: '0.0001'
        });
        break;
      case 'ticketFee':
        setModalType('ticketFee');
        setModalTitle('Update Ticket Fee Percentage');
        setModalContent({
          currentValue: ticketFeePercentage,
          label: 'New Ticket Fee (%)',
          placeholder: '10',
          inputType: 'number',
          min: '0',
          max: '30',
          step: '1'
        });
        break;
      case 'jackpotFee':
        setModalType('jackpotFee');
        setModalTitle('Update Jackpot Fee Percentage');
        setModalContent({
          currentValue: jackpotFeePercentage,
          label: 'New Jackpot Fee (%)',
          placeholder: '5',
          inputType: 'number',
          min: '0',
          max: '30',
          step: '1'
        });
        break;
      case 'feeCollector':
        setModalType('feeCollector');
        setModalTitle('Update Fee Collector Address');
        setModalContent({
          currentValue: safeUserFeeCollector,
          defaultFeeCollector: safeDefaultFeeCollector,
          isSplitter: safeUserFeeCollector !== feeCollector,
          splitterAddress: feeCollector,
          label: 'New Fee Collector Address',
          placeholder: '0x...',
          inputType: 'text'
        });
        break;
      case 'winRate':
        setModalType('winRate');
        setModalTitle('Update Win Rate');
        setModalContent({
          currentValue: safeWinChance,
          label: 'New Win Rate (1 in X)',
          placeholder: '20',
          inputType: 'number',
          min: '1',
          step: '1'
        });
        break;
      default:
        return;
    }
    
    setModalOpen(true);
  };
  
  // Helper function to deploy a FeeSplitter and update the fee collector
  const deployFeeSplitterAndUpdate = async (signer, userFeeCollector, defaultFeeCollector) => {
    console.log(`Deploying new FeeSplitter with userFeeCollector: ${userFeeCollector}, defaultFeeCollector: ${defaultFeeCollector}`);
    
    try {
      // Get the FeeSplitter ABI from your artifacts
      const feeSplitterABI = FeeSplitterArtifact.abi;
      const feeSplitterBytecode = FeeSplitterArtifact.bytecode;
      
      // Create a contract factory for FeeSplitter
      const FeeSplitterFactory = new ethers.ContractFactory(
        feeSplitterABI,
        feeSplitterBytecode,
        signer
      );
      
      // Deploy the FeeSplitter contract
      const feeSplitter = await FeeSplitterFactory.deploy(
        userFeeCollector,  // User's fee collector address
        defaultFeeCollector // Default fee collector address
      );
      
      // Wait for the deployment to be confirmed
      await feeSplitter.deployed();
      console.log(`FeeSplitter deployed at: ${feeSplitter.address}`);
      
      return feeSplitter.address;
    } catch (error) {
      console.error("Error deploying FeeSplitter:", error);
      throw error;
    }
  };
  
  const handleAction = async (type, value) => {
    // Get the wallet directly from props
    if (!wallets || wallets.length === 0) {
      console.error('No wallets available');
      setError('Wallet not connected properly. Please refresh and try again.');
      return false;
    }
    
    const wallet = wallets[0];
    setIsLoading(true);
    setError(null);
    
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
      const signer = provider.getSigner();
      const signerAddress = await signer.getAddress();
      console.log(`Using signer with address: ${signerAddress}`);
      
      if (signerAddress.toLowerCase() !== address.toLowerCase()) {
        console.warn(`Signer address (${signerAddress}) doesn't match active wallet (${address})`);
      }
      
      // Create contract with signer
      const contractWithSigner = new ethers.Contract(
        contractAddress,
        contractABI,
        signer
      );
      
      console.log(`Executing ${type} action for contract at ${contractAddress}`);
      
      let tx;
      
      switch(type) {
        case 'drain':
          tx = await contractWithSigner.rescueETH();
          console.log(`Drain jackpot transaction submitted: ${tx.hash}`);
          
          // Wait for transaction to be mined
          const receipt = await tx.wait();
          console.log(`Drain jackpot transaction confirmed: ${tx.hash}`);
          
          // After successfully draining, manually update the pot size to 0
          // We'll still do a full refresh, but this gives immediate feedback
          if (typeof onActionComplete === 'function') {
            // Call refresh function with a flag to indicate this was a drain operation
            onActionComplete('drain');
          }
          break;
        case 'ticketPrice':
          const priceInWei = ethers.utils.parseEther(value);
          tx = await contractWithSigner.updateTicketPrice(priceInWei);
          break;
        case 'ticketFee':
          tx = await contractWithSigner.updateTicketFeePercentage(parseInt(value));
          break;
        case 'jackpotFee':
          tx = await contractWithSigner.updateJackpotFeePercentage(parseInt(value));
          break;
        case 'feeCollector':
          if (!ethers.utils.isAddress(value)) {
            throw new Error('Invalid Ethereum address');
          }
          
          // Deploy a new FeeSplitter that splits between user address and default 
          const newFeeSplitterAddress = await deployFeeSplitterAndUpdate(
            signer, 
            value, // User provided collector address
            safeDefaultFeeCollector // Default platform fee collector
          );
          
          // Update the fee collector to the new FeeSplitter address
          tx = await contractWithSigner.updateFeeCollector(newFeeSplitterAddress);
          break;
        case 'winRate':
          const winRateValue = parseInt(value);
          if (isNaN(winRateValue) || winRateValue < 1) {
            throw new Error('Win rate must be a positive number');
          }
          tx = await contractWithSigner.updateWinChance(winRateValue);
          break;
        default:
          setIsLoading(false);
          setError('Unknown action type');
          return false;
      }
      
      console.log(`Transaction submitted: ${tx.hash}`);
      
      // Wait for transaction to be mined
      await tx.wait();
      console.log(`Transaction confirmed: ${tx.hash}`);
      
      setIsLoading(false);
      setModalOpen(false);
      
      // Notify parent component to refresh data
      if (onActionComplete) {
        onActionComplete();
      }
      
      return true;
    } catch (error) {
      console.error(`Error executing ${type} action:`, error);
      setIsLoading(false);
      
      // Try to provide a more user-friendly error message
      if (error.message.includes("insufficient funds")) {
        setError("Insufficient funds to complete this transaction.");
      } else if (error.message.includes("user rejected")) {
        setError("Transaction was rejected by user.");
      } else if (error.message.includes("execution reverted")) {
        // Extract the revert reason if possible
        const revertReason = error.data?.message || error.message;
        setError(`Transaction reverted: ${revertReason}`);
      } else {
        setError(error.message || 'Transaction failed. Please try again.');
      }
      
      return false;
    }
  };
  
  const handleModalClose = () => {
    setModalOpen(false);
    setError(null);
  };

  return (
    <div className="admin-dropdown" ref={dropdownRef}>
      <button className="admin-button" onClick={toggleDropdown}>
        Admin <span className="dropdown-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>
      
      {isOpen && (
        <div className="admin-dropdown-content">
          <div className="dropdown-option" onClick={() => handleOptionClick('drain')}>
            Drain Jackpot
          </div>
          <div className="dropdown-option" onClick={() => handleOptionClick('ticketPrice')}>
            Update Ticket Price
          </div>
          <div className="dropdown-option" onClick={() => handleOptionClick('ticketFee')}>
            Update Ticket Fee
          </div>
          <div className="dropdown-option" onClick={() => handleOptionClick('jackpotFee')}>
            Update Jackpot Fee
          </div>
          <div className="dropdown-option" onClick={() => handleOptionClick('feeCollector')}>
            Update Fee Collector Address
          </div>
          <div className="dropdown-option" onClick={() => handleOptionClick('winRate')}>
            Update Win Rate
          </div>
        </div>
      )}
      
      <AdminModal
        isOpen={modalOpen}
        onClose={handleModalClose}
        title={modalTitle}
        type={modalType}
        content={modalContent}
        onAction={handleAction}
        isLoading={isLoading}
        error={error}
      />
    </div>
  );
};

export default AdminDropdown;