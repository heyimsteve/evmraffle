import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ethers } from 'ethers';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import RollingRaffleArtifact from './contracts/RollingRaffle.json';
import FeeSplitterArtifact from './contracts/FeeSplitter.json';
import './App.css';
import JackpotModal from './JackpotModal';
import NetworkSelector from './NetworkSelector';
import CreateRaffleModal from './CreateRaffleModal';
import AdminDropdown from './AdminDropdown';

// Use the ABI from your artifact
const contractABI = RollingRaffleArtifact.abi;

// Contract addresses for different chains
const CHAIN_CONFIG = {
  // Sepolia
  11155111: {
    name: "Sepolia Testnet",
    contractAddress: "0xBf889381DEEA45F83DFc3183F0869368eEA7d1B4",
    explorerUrl: "https://sepolia.etherscan.io"
  },
  // Abstract Testnet
  11124: {
    name: "Abstract Testnet",
    contractAddress: "0xA5785b8987f6E61a635315E6C77E2C852EEBAB0F",
    explorerUrl: "https://sepolia.abscan.org"
  }
};

const DEFAULT_CHAIN_ID = 11155111; // Default to Sepolia

// For tracking API call limits - only apply throttling after initial load
let lastApiCallTime = 0;
const API_CALL_COOLDOWN = 2000; // 2 seconds between API calls
const BALANCE_CHECK_COOLDOWN = 10000; // 10 seconds between balance checks
let initialLoadComplete = false;
let eventsLoaded = false; // Track if events have been loaded to prevent duplicate logging

// Global caches to reduce API calls
const blockCache = {};
const balanceCache = {};
let lastBalanceCheckTime = 0;

// Chainlist public RPCs for different networks
const RPC_URLS = {
  11155111: [ // Sepolia
    `https://sepolia.infura.io/v3/${import.meta.env.VITE_INFURA_ID || '45675333e6274b2c8e39363313cc9f84'}`,
    'https://eth-sepolia.public.blastapi.io',
    'https://rpc.sepolia.org',
    'https://ethereum-sepolia.publicnode.com',
    'https://sepolia.gateway.tenderly.co'
  ],
  11124: [ // Abstract Testnet
    'https://api.testnet.abs.xyz'
  ]
};

// Current RPC index for each chain
const currentRpcIndices = {
  11155111: 0,
  11124: 0
};

// Track failed providers to avoid reusing them immediately
const failedProviders = {
  11155111: new Set(),
  11124: new Set()
};

// Provider and contract objects for each chain
const readOnlyProviders = {};
const readOnlyContracts = {};

// Initialize providers and contracts for each chain
Object.keys(CHAIN_CONFIG).forEach(chainId => {
  const rpcUrl = RPC_URLS[chainId][currentRpcIndices[chainId]];
  readOnlyProviders[chainId] = new ethers.providers.JsonRpcProvider(rpcUrl);
  readOnlyContracts[chainId] = new ethers.Contract(
    CHAIN_CONFIG[chainId].contractAddress, 
    contractABI, 
    readOnlyProviders[chainId]
  );
});

// Create a provider that tries multiple RPCs if one fails
const createFallbackProvider = (chainId) => {
  const rpcUrl = RPC_URLS[chainId][currentRpcIndices[chainId]];
  console.log(`Using RPC provider for chain ${chainId}: ${rpcUrl}`);
  return new ethers.providers.JsonRpcProvider(rpcUrl);
};

// Function to rotate to the next RPC provider when rate limited
const rotateRpcProvider = (chainId) => {
  // Always ensure we're using the correct chainId
  if (!chainId || !CHAIN_CONFIG[chainId] || !RPC_URLS[chainId]) {
    console.error(`Invalid chainId for rotate provider: ${chainId}`);
    return null;
  }

  // Mark current provider as failed
  const currentUrl = RPC_URLS[chainId][currentRpcIndices[chainId]];
  failedProviders[chainId].add(currentUrl);
  
  // Try to find a working provider that hasn't failed recently
  let nextProviderIndex = currentRpcIndices[chainId];
  let attempts = 0;
  const maxAttempts = RPC_URLS[chainId].length;
  
  do {
    nextProviderIndex = (nextProviderIndex + 1) % RPC_URLS[chainId].length;
    attempts++;
    
    // If we've tried all providers, clear the failed set and try again
    if (attempts >= maxAttempts) {
      console.log(`All providers for chain ${chainId} have failed, resetting failed providers`);
      failedProviders[chainId].clear();
      break;
    }
  } while (failedProviders[chainId].has(RPC_URLS[chainId][nextProviderIndex]));
  
  currentRpcIndices[chainId] = nextProviderIndex;
  console.log(`Rotating to next RPC provider for chain ${chainId}: ${RPC_URLS[chainId][currentRpcIndices[chainId]]}`);
  
  const newProvider = new ethers.providers.JsonRpcProvider(RPC_URLS[chainId][currentRpcIndices[chainId]]);
  
  // Update the read-only contract with the new provider, but ONLY for the specified chainId
  // Create a new contract instance for this RPC - don't reuse the contract address from a different chain
  const contractAddress = CHAIN_CONFIG[chainId].contractAddress;
  readOnlyContracts[chainId] = new ethers.Contract(
    contractAddress, 
    contractABI, 
    newProvider
  );
  
  // Store the provider
  readOnlyProviders[chainId] = newProvider;
  return newProvider;
};

// Enhanced throttled call function with better rate limit detection and retry logic
const throttledCall = async (apiCallFn, chainId) => {
  // Always ensure we're using a valid chainId that was passed in
  if (!chainId || !CHAIN_CONFIG[chainId]) {
    console.error(`Invalid chainId for API call: ${chainId}`);
    return apiCallFn(); // Just try the call directly without any retries
  }

  // Keep track of retry attempts
  let retryCount = 0;
  const maxRetries = RPC_URLS[chainId]?.length || 0;
  
  const executeCall = async () => {
    try {
      return await apiCallFn();
    } catch (error) {
      console.warn(`API call error (attempt ${retryCount + 1}/${maxRetries + 1}) for chain ${chainId}: ${error.message}`);
      
      // Check for any type of error that might be rate limiting related
      if (error.message && (
        error.message.includes('429') || 
        error.message.includes('rate') ||
        error.message.includes('too many') ||
        error.message.includes('limit') ||
        error.message.includes('exceed') ||
        error.message.includes('throttle') ||
        error.message.includes('timeout') ||
        error.message.includes('call revert exception') ||
        error.message.includes('CORS') ||
        error.message.includes('ERR_FAILED')
      )) {
        console.warn(`Potential rate limit or error detected for chain ${chainId}, rotating provider...`);
        
        // Only rotate providers for the specified chainId
        const newProvider = rotateRpcProvider(chainId);
        if (!newProvider) {
          console.error(`Failed to rotate provider for chain ${chainId}`);
          throw error; // Re-throw if we couldn't rotate
        }
        
        retryCount++;
        
        // If we still have providers to try, retry the call
        if (retryCount <= maxRetries) {
          console.log(`Retrying with provider ${currentRpcIndices[chainId]} (${retryCount}/${maxRetries}) for chain ${chainId}`);
          // Add a small delay before retrying
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Increasing backoff
          return executeCall();
        }
      }
      throw error;
    }
  };

  // Apply throttling based on last API call time
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCallTime;
  
  if (timeSinceLastCall < API_CALL_COOLDOWN) {
    // Add extra delay if we're getting rate limited errors
    const cooldownTime = API_CALL_COOLDOWN - timeSinceLastCall;
    await new Promise(resolve => setTimeout(resolve, cooldownTime));
  }
  
  lastApiCallTime = Date.now();
  return executeCall();
};

function App() {
  // Privy hooks
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { chainId: chainIdParam, contractAddress: contractAddressParam } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  
  // State variables
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [address, setAddress] = useState(null);
  const [walletBalance, setWalletBalance] = useState(null);
  const [potSize, setPotSize] = useState("0");
  const [lastWinner, setLastWinner] = useState(null);
  const [lastWinAmount, setLastWinAmount] = useState("0");
  const [activityLog, setActivityLog] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [ticketQuantity, setTicketQuantity] = useState(1);
  const [showJackpotModal, setShowJackpotModal] = useState(false);
  const [jackpotResult, setJackpotResult] = useState(null);
  const [ticketNumbers, setTicketNumbers] = useState([]);
  const [chainConnected, setChainConnected] = useState(false);
  const [shouldLoadEvents, setShouldLoadEvents] = useState(true);
  const [currentChainId, setCurrentChainId] = useState(DEFAULT_CHAIN_ID);
  const [contractAddress, setContractAddress] = useState(CHAIN_CONFIG[DEFAULT_CHAIN_ID].contractAddress);
  const [networkName, setNetworkName] = useState(CHAIN_CONFIG[DEFAULT_CHAIN_ID].name);
  const [shouldUseFallbackMode, setShouldUseFallbackMode] = useState(false);
  const [lastBalanceCheckTime, setLastBalanceCheckTime] = useState(0);
  const [ticketPrice, setTicketPrice] = useState("0.0025"); // Default value until fetched from contract
  const [ticketFeePercentage, setTicketFeePercentage] = useState(10); // Default value
  const [jackpotFeePercentage, setJackpotFeePercentage] = useState(10); // Default value
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [usingCustomContractAddress, setUsingCustomContractAddress] = useState(false);
  const [customContractAddress, setCustomContractAddress] = useState(null);
  const [urlChainId, setUrlChainId] = useState(null);
  const [contractTicketPrice, setContractTicketPrice] = useState("0.0025");
  const [formattedTicketPrice, setFormattedTicketPrice] = useState("0.0025");
  const [isContractOwner, setIsContractOwner] = useState(false);
  const [contractOwnerAddress, setContractOwnerAddress] = useState(null);
  const [winChance, setWinChance] = useState(20); // Default value
  const [feeCollector, setFeeCollector] = useState(null);
  const [userFeeCollector, setUserFeeCollector] = useState(null);
  const [defaultFeeCollector, setDefaultFeeCollector] = useState("0xfB582E62c299BAaFC4CBdc3099767010A73d77c8");
  const [loadingFromNetworkUrl, setLoadingFromNetworkUrl] = useState(false);
  

  // Clear loading state if it gets stuck
  useEffect(() => {
    const loadingTimeout = setTimeout(() => {
      setActivityLog(prev => {
        if (prev.length === 1 && prev[0].type === 'loading') {
          return [{ type: 'empty', message: 'No activity found' }];
        }
        return prev;
      });
    }, 10000);
    
    return () => clearTimeout(loadingTimeout);
  }, []);

  // Load past events on first render
  useEffect(() => {
    // Initial data load with proper handling
    const initialLoad = async () => {
      try {
        // First, just load contract data, which is most important
        await fetchContractData(readOnlyContracts[currentChainId], currentChainId);
        
        // Only try to load events if we should
        if (shouldLoadEvents) {
          try {
            // Use a delay to avoid concurrent API calls
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Try simplified mode first if fallback mode is enabled
            if (shouldUseFallbackMode) {
              await loadPastEventsSimplified(currentChainId);
            } else {
              await loadPastEvents(currentChainId);
            }
          } catch (error) {
            console.error("Error loading past events, will show simple message:", error);
            setActivityLog([{ type: 'error', message: 'Recent activity temporarily unavailable' }]);
            
            // Enable fallback mode and try simplified version
            setShouldUseFallbackMode(true);
            try {
              await loadPastEventsSimplified(currentChainId);
            } catch (fallbackError) {
              console.error("Even simplified events failed:", fallbackError);
              // Disable event loading for this session to prevent further rate limiting
              setShouldLoadEvents(false);
            }
          }
        }
        
        // Mark initial load as complete to enable throttling
        initialLoadComplete = true;
      } catch (error) {
        console.error("Error during initial data load:", error);
        initialLoadComplete = true;
      }
    };
    
    initialLoad();
    
    // Setup polling for continuous updates, but at a slower rate
    // and only poll contract data, not events (to avoid rate limits)
    const interval = setInterval(() => {
      fetchContractData(readOnlyContracts[currentChainId], currentChainId);
      
      // Much more conservative event refreshing (5% chance)
      if (shouldLoadEvents && Math.random() < 0.05) {
        // Use simplified mode if fallback is enabled
        const loadFunction = shouldUseFallbackMode ? loadPastEventsSimplified : loadPastEvents;
        
        loadFunction(currentChainId).catch(error => {
          console.error("Error refreshing events, switching to fallback mode:", error);
          setShouldUseFallbackMode(true);
          
          if (error.message && (
            error.message.includes('429') || 
            error.message.includes('rate limit') ||
            error.message.includes('too many requests')
          )) {
            // Try to rotate provider on rate limit
            rotateRpcProvider(currentChainId);
          }
        });
      }
    }, 90000); // Every 90 seconds instead of 60 to further reduce API calls
    
    return () => clearInterval(interval);
  }, [currentChainId, shouldUseFallbackMode]);

  // Set up wallet connection when authenticated with Privy
  useEffect(() => {
    if (!ready) return;
    
    const setupWallet = async () => {
      if (authenticated && wallets && wallets.length > 0) {
        try {
          // Get the first connected wallet
          const wallet = wallets[0];
          const walletAddress = wallet.address;
          setAddress(walletAddress);
          
          // Always fetch balance directly from the read-only provider first
          // This ensures we have a balance even if wallet setup has issues
          try {
            // Use throttled call to handle rate limits
            const balance = await throttledCall(
              () => readOnlyProviders[currentChainId].getBalance(walletAddress),
              currentChainId
            );
            setWalletBalance(ethers.utils.formatEther(balance));
            
            // Cache the balance
            balanceCache[`${currentChainId}-${walletAddress}`] = {
              balance: ethers.utils.formatEther(balance),
              timestamp: Date.now()
            };
          } catch (error) {
            console.error("Error fetching initial balance:", error);
          }
          
          // Check if we're on a supported network
          try {
            // For embedded wallets
            if (wallet.walletClientType === 'privy') {
              let providerInstance;
              
              // Try to get provider, with fallbacks
              if (wallet.getEthersProvider && typeof wallet.getEthersProvider === 'function') {
                providerInstance = await wallet.getEthersProvider();
              } else if (window.ethereum) {
                console.log("Using window.ethereum as provider for Privy wallet");
                providerInstance = new ethers.providers.Web3Provider(window.ethereum);
              } else {
                throw new Error("No provider available for this wallet");
              }
              
              setProvider(providerInstance);
              
              // Check which network the user is connected to
              const network = await providerInstance.getNetwork();
              const chainId = network.chainId;
              console.log(`Connected to chain ID: ${chainId}`);
              
              // Check if this is a supported chain
              if (CHAIN_CONFIG[chainId]) {
                // User is on a supported chain
                setCurrentChainId(chainId);
                setContractAddress(CHAIN_CONFIG[chainId].contractAddress);
                setNetworkName(CHAIN_CONFIG[chainId].name);
                setChainConnected(true);
                
                // Refresh data for the new chain
                await fetchContractData(readOnlyContracts[chainId], chainId);
                if (shouldLoadEvents) {
                  // Add a delay to avoid rate limits
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  
                  // Use appropriate event loading function
                  if (shouldUseFallbackMode) {
                    await loadPastEventsSimplified(chainId);
                  } else {
                    await loadPastEvents(chainId);
                  }
                }
              } else {
                // If not on a supported chain, try to switch to the default (Sepolia)
                try {
                  await wallet.switchChain(DEFAULT_CHAIN_ID);
                  toast.success(`Switched to ${CHAIN_CONFIG[DEFAULT_CHAIN_ID].name}`);
                  setCurrentChainId(DEFAULT_CHAIN_ID);
                  setContractAddress(CHAIN_CONFIG[DEFAULT_CHAIN_ID].contractAddress);
                  setNetworkName(CHAIN_CONFIG[DEFAULT_CHAIN_ID].name);
                  setChainConnected(true);
                } catch (error) {
                  console.error("Failed to switch chain:", error);
                  toast.error("Please switch to a supported network");
                  setChainConnected(false);
                  return;
                }
              }
              
              // Get signer and contract
              const signer = providerInstance.getSigner();
              setSigner(signer);
              
              // Create contract instance
              const contractInstance = new ethers.Contract(
                CHAIN_CONFIG[currentChainId].contractAddress,
                contractABI,
                signer
              );
              setContract(contractInstance);
              
              // Fetch wallet balance
              fetchWalletBalance(providerInstance, walletAddress);
              
              // Setup event listeners
              setupEventListeners(contractInstance);
            } 
            // For injected wallets (e.g., MetaMask)
            else if (wallet.walletClientType === 'injected') {
              let providerInstance;
              
              if (wallet.getEthersProvider && typeof wallet.getEthersProvider === 'function') {
                providerInstance = await wallet.getEthersProvider();
              } else if (window.ethereum) {
                console.log("Using window.ethereum as provider for injected wallet");
                providerInstance = new ethers.providers.Web3Provider(window.ethereum);
              } else {
                throw new Error("No provider available for this injected wallet");
              }
              
              setProvider(providerInstance);
              
              // Check which network the user is connected to
              const network = await providerInstance.getNetwork();
              const chainId = network.chainId;
              console.log(`Connected to chain ID: ${chainId}`);
              
              // Check if this is a supported chain
              if (CHAIN_CONFIG[chainId]) {
                // User is on a supported chain
                setCurrentChainId(chainId);
                setContractAddress(CHAIN_CONFIG[chainId].contractAddress);
                setNetworkName(CHAIN_CONFIG[chainId].name);
                setChainConnected(true);
                
                // Refresh data for the new chain
                await fetchContractData(readOnlyContracts[chainId], chainId);
                if (shouldLoadEvents) {
                  // Add a delay to avoid rate limits
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  
                  // Use appropriate event loading function
                  if (shouldUseFallbackMode) {
                    await loadPastEventsSimplified(chainId);
                  } else {
                    await loadPastEvents(chainId);
                  }
                }
              } else {
                toast.error("Please switch to a supported network");
                setChainConnected(false);
                return;
              }
              
              // Get signer and contract
              const signer = providerInstance.getSigner();
              setSigner(signer);
              
              // Create contract instance
              const contractInstance = new ethers.Contract(
                CHAIN_CONFIG[currentChainId].contractAddress,
                contractABI,
                signer
              );
              setContract(contractInstance);
              
              // Fetch wallet balance
              fetchWalletBalance(providerInstance, walletAddress);
              
              // Setup event listeners
              setupEventListeners(contractInstance);
            }
    
            // Make sure chainConnected is set to true by default if we got this far
            if (!chainConnected) {
              setChainConnected(true);
            }
    
          } catch (error) {
            console.error("Error setting up wallet:", error);
            toast.error("Error connecting to wallet");
            // Even if there's an error, we should enable interaction if possible
            setChainConnected(true);
          }
        } catch (error) {
          console.error("Error setting up wallet:", error);
        }
      } else {
        // Clear wallet-related state when not authenticated
        setAddress(null);
        setSigner(null);
        setContract(null);
        setWalletBalance(null);
        setChainConnected(false);
      }
    };
    
    setupWallet();
  }, [ready, authenticated, wallets]);

  useEffect(() => {
    const handleUrlParams = async () => {
      let chainIdFromUrl = null;
      let contractAddressFromUrl = null;
      
      // Check for network URL pattern
      const networkMatch = location.pathname.match(/\/network\/(\d+)/);
      if (networkMatch) {
        // We have a network selection URL
        chainIdFromUrl = parseInt(networkMatch[1], 10);
        setLoadingFromNetworkUrl(true);
        
        // Verify it's a valid chain ID
        if (CHAIN_CONFIG[chainIdFromUrl]) {
          console.log(`Setting current chain ID from network URL to: ${chainIdFromUrl}`);
          setCurrentChainId(chainIdFromUrl);
          setContractAddress(CHAIN_CONFIG[chainIdFromUrl].contractAddress);
          setNetworkName(CHAIN_CONFIG[chainIdFromUrl].name);
          
          // Immediately set URL chain ID to avoid race conditions
          setUrlChainId(chainIdFromUrl);
          
          // If we have a wallet connected, try to switch to this chain
          if (authenticated && wallets && wallets.length > 0 && wallets[0].switchChain) {
            try {
              console.log(`Switching to chain ${chainIdFromUrl} specified in URL...`);
              await wallets[0].switchChain(chainIdFromUrl);
            } catch (error) {
              console.error("Failed to switch chain:", error);
              toast.warning(`Could not switch wallet to ${CHAIN_CONFIG[chainIdFromUrl].name}. Viewing in read-only mode.`);
            }
          }
          
          // Reset activity log for the new chain
          setActivityLog([{ type: 'loading', message: 'Loading recent activity...' }]);
          
          // Load data for this network's default contract, specifically for this chainId
          fetchContractData(readOnlyContracts[chainIdFromUrl], chainIdFromUrl);
          
          return; // Exit early since we've handled the network URL
        }
      }
      
      // Handle custom contract URL pattern - raffle/chainId/contractAddress
      if (chainIdParam && contractAddressParam) {
        // We have both chainId and contractAddress from URL parameters
        chainIdFromUrl = parseInt(chainIdParam, 10);
        contractAddressFromUrl = contractAddressParam;
        
        // Verify it's a valid chain ID
        if (CHAIN_CONFIG[chainIdFromUrl]) {
          console.log(`Loading custom contract: ${contractAddressFromUrl} on chain ${chainIdFromUrl}`);
          
          // Bypass all other contract loading, first set state
          setUsingCustomContractAddress(true);
          setCustomContractAddress(contractAddressFromUrl);
          setCurrentChainId(chainIdFromUrl);
          setContractAddress(contractAddressFromUrl);
          setNetworkName(CHAIN_CONFIG[chainIdFromUrl].name);
          setUrlChainId(chainIdFromUrl);
          
          // Reset activity log for the new contract
          setActivityLog([{ type: 'loading', message: 'Loading contract data...' }]);
          
          // Skip any default contract loading - directly load the custom contract
          // This ensures we only use the chain's specific RPC providers
          loadCustomContract(contractAddressFromUrl, chainIdFromUrl);
          
          // Try to switch the wallet chain asynchronously
          if (authenticated && wallets && wallets.length > 0 && wallets[0].switchChain) {
            try {
              console.log(`Switching to chain ${chainIdFromUrl} specified in URL...`);
              wallets[0].switchChain(chainIdFromUrl).catch(error => {
                console.error("Failed to switch chain:", error);
                toast.warning(`Could not switch wallet to ${CHAIN_CONFIG[chainIdFromUrl].name}. Viewing in read-only mode.`);
              });
            } catch (error) {
              console.error("Failed to switch chain:", error);
            }
          }
          
          // IMPORTANT: Don't try to load data for other chains
          return; // Exit early - we've handled loading the custom contract
        } else {
          // Invalid chain ID - show error
          toast.error(`Unsupported network ID: ${chainIdFromUrl}`);
          navigate("/", { replace: true });
          return;
        }
      } else if (chainIdParam && !contractAddressParam) {
        // Legacy format - handle the old URL format
        contractAddressFromUrl = chainIdParam;
        
        // Validate contract address if we have one
        if (contractAddressFromUrl && /^0x[a-fA-F0-9]{40}$/i.test(contractAddressFromUrl)) {
          console.log(`Loading contract from old URL format: ${contractAddressFromUrl}`);
          
          // Store the custom contract info and update UI
          setUsingCustomContractAddress(true);
          setCustomContractAddress(contractAddressFromUrl);
          setContractAddress(contractAddressFromUrl);
          
          // Reset activity log
          setActivityLog([{ type: 'loading', message: 'Loading contract data...' }]);
          
          // Load on current chain - explicitly specify the current chain ID
          loadCustomContract(contractAddressFromUrl, currentChainId);
          
          // Update the URL to the new format if needed
          navigate(`/raffle/${currentChainId}/${contractAddressFromUrl}`, { replace: true });
          return; // Exit early - custom contract loaded
        }
      }
    };
    
    handleUrlParams();
  }, [location.pathname, chainIdParam, contractAddressParam, currentChainId, wallets, authenticated, navigate]);
  
  const safeCheckFeeSplitter = async (feeSplitterAddress, chainId) => {
    try {
      // Create a contract instance
      const feeSplitterContract = new ethers.Contract(
        feeSplitterAddress,
        FeeSplitterArtifact.abi,
        readOnlyProviders[chainId]
      );
      
      // Try to get the contract code at the address
      const code = await throttledCall(
        () => readOnlyProviders[chainId].getCode(feeSplitterAddress),
        chainId
      );
      
      // If there's no code, it's not a contract
      if (code === '0x' || code === '') {
        console.log(`Address ${feeSplitterAddress} is not a contract on chain ${chainId}`);
        return { isFeeSplitter: false, userCollector: feeSplitterAddress, defaultCollector: null };
      }
      
      // Try to call the functions
      try {
        const userCollector = await throttledCall(
          () => feeSplitterContract.userFeeCollector(),
          chainId
        );
        
        const defaultCollector = await throttledCall(
          () => feeSplitterContract.defaultFeeCollector(),
          chainId
        );
        
        return { 
          isFeeSplitter: true, 
          userCollector, 
          defaultCollector 
        };
      } catch (error) {
        console.log(`Not a FeeSplitter contract at ${feeSplitterAddress} on chain ${chainId}`);
        return { isFeeSplitter: false, userCollector: feeSplitterAddress, defaultCollector: null };
      }
    } catch (error) {
      console.error(`Error checking if contract is FeeSplitter:`, error);
      return { isFeeSplitter: false, userCollector: feeSplitterAddress, defaultCollector: null };
    }
  };

  const fetchMinimalContractData = async (contractInstance, chainId) => {
    if (!contractInstance) {
      console.error('No contract instance provided to fetchMinimalContractData');
      return;
    }
    
    if (!chainId || !CHAIN_CONFIG[chainId]) {
      console.error(`Invalid chainId for fetchMinimalContractData: ${chainId}`);
      return;
    }
    
    try {
      console.log(`Fetching minimal contract data for chainId ${chainId}`);
      
      // Add a small delay to avoid concurrent calls
      await new Promise(resolve => setTimeout(resolve, Math.random() * 500));
      
      // Get pot size with throttling
      try {
        const pot = await throttledCall(
          () => contractInstance.getPot(),
          chainId // Explicitly pass chainId
        );
        
        const formattedPot = ethers.utils.formatEther(pot);
        console.log(`Setting pot size to: ${formattedPot} ETH for chain ${chainId}`);
        setPotSize(formattedPot);
      } catch (error) {
        console.warn(`Error fetching pot size for chain ${chainId}:`, error);
      }
      
      // Add a small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Basic fee collector address check - with safer FeeSplitter checking
      try {
        const collector = await throttledCall(
          () => contractInstance.feeCollector(),
          chainId // Explicitly pass chainId
        );
        
        console.log(`Fee collector address: ${collector} for chain ${chainId}`);
        setFeeCollector(collector);
        
        // Try to get code at this address to see if it's a contract
        const code = await throttledCall(
          () => readOnlyProviders[chainId].getCode(collector),
          chainId
        );
        
        // Only try to check if it's a FeeSplitter if there's actual code (it's a contract)
        if (code && code !== '0x' && FeeSplitterArtifact && FeeSplitterArtifact.abi) {
          try {
            // Create a FeeSplitter contract instance
            const feeSplitterABI = FeeSplitterArtifact.abi;
            const feeSplitterContract = new ethers.Contract(
              collector,
              feeSplitterABI,
              readOnlyProviders[chainId]
            );
            
            // Try to call userFeeCollector() function
            const userCollector = await throttledCall(
              () => feeSplitterContract.userFeeCollector(),
              chainId
            );
            setUserFeeCollector(userCollector);
            
            // Also get the default fee collector to display
            const defaultCollector = await throttledCall(
              () => feeSplitterContract.defaultFeeCollector(),
              chainId
            );
            setDefaultFeeCollector(defaultCollector);
            
            console.log(`User fee collector: ${userCollector}`);
            console.log(`Default fee collector: ${defaultCollector}`);
          } catch (error) {
            console.log("Not a FeeSplitter contract or error getting collectors:", error);
            // If not a FeeSplitter, then the fee collector is just a direct address
            setUserFeeCollector(collector);
          }
        } else {
          // Not a contract, just a regular address
          setUserFeeCollector(collector);
          console.log(`Not a contract, using collector address directly: ${collector}`);
        }
      } catch (error) {
        console.warn(`Error fetching fee collector address for chain ${chainId}:`, error);
      }
  
      // Add a small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));
  
      // Add owner check if the user is connected
      if (address) {
        try {
          const ownerAddress = await throttledCall(
            () => contractInstance.owner(),
            chainId
          );
          
          setContractOwnerAddress(ownerAddress);
          
          // Check if current user is the owner
          const isOwner = ownerAddress.toLowerCase() === address.toLowerCase();
          setIsContractOwner(isOwner);
          
          console.log(`Contract owner check for chain ${chainId}: ${isOwner ? 'User is owner' : 'User is not owner'}`);
        } catch (error) {
          console.error(`Error checking contract ownership for chain ${chainId}:`, error);
          setIsContractOwner(false);
        }
      }
  
      // Add a small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get ticket price with throttling
      try {
        const price = await throttledCall(
          () => contractInstance.ticketPrice(),
          chainId
        );
        
        // Store the raw ticket price for calculations
        const rawPriceWei = price.toString();
        const formattedPrice = ethers.utils.formatEther(price);
        
        // Store both the raw price (for calculations) and formatted price (for display)
        setContractTicketPrice(rawPriceWei);
        setFormattedTicketPrice(formattedPrice);
        
        console.log(`Fetched ticket price from contract for chain ${chainId}: ${formattedPrice} ETH (${rawPriceWei} wei)`);
      } catch (error) {
        console.warn(`Error fetching ticket price for chain ${chainId}, using default:`, error);
      }
      
      // Add a small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get win chance with throttling
      try {
        const chance = await throttledCall(
          () => contractInstance.winChance(),
          chainId
        );
        setWinChance(chance.toNumber());
        console.log(`Win chance for chain ${chainId}: 1 in ${chance.toNumber()} (${(100/chance.toNumber()).toFixed(2)}%)`);
      } catch (error) {
        console.warn(`Error fetching win chance for chain ${chainId}:`, error);
      }
      
      // We'll skip other checks to avoid rate limits for custom contracts
    } catch (error) {
      console.error(`Error fetching minimal contract data for chain ${chainId}:`, error);
    }
  };

  // Add this function to load a contract by address
  const loadCustomContract = (contractAddress, chainId) => {
    console.log(`Loading custom contract ${contractAddress} on chain ${chainId}`);
    
    // Make sure chainId is valid
    if (!CHAIN_CONFIG[chainId]) {
      console.error(`Invalid chainId: ${chainId}`);
      toast.error("Invalid network selected");
      return;
    }
    
    // Update the UI state immediately
    setUsingCustomContractAddress(true);
    setCustomContractAddress(contractAddress);
    setContractAddress(contractAddress);
    setCurrentChainId(chainId);
    setNetworkName(CHAIN_CONFIG[chainId].name);
    
    // Set the loading state for better UX
    setActivityLog([{ type: 'loading', message: 'Loading contract data...' }]);
    
    // Create a new contract instance with this address if we have a signer
    if (provider && signer) {
      try {
        const contractInstance = new ethers.Contract(
          contractAddress,
          contractABI,
          signer
        );
        setContract(contractInstance);
        
        // Set up event listeners
        setupEventListeners(contractInstance);
        
        console.log("Contract instance created and event listeners set up");
      } catch (error) {
        console.error("Error creating contract instance with signer:", error);
      }
    }
    
    // Create read-only contract for this address on the specified chain
    try {
      // Create provider for this chain if it doesn't exist
      if (!readOnlyProviders[chainId]) {
        readOnlyProviders[chainId] = new ethers.providers.JsonRpcProvider(RPC_URLS[chainId][0]);
        console.log(`Created new provider for chain ${chainId}`);
      }
      
      // Create or update the read-only contract instance
      readOnlyContracts[chainId] = new ethers.Contract(
        contractAddress,
        contractABI,
        readOnlyProviders[chainId]
      );
      console.log(`Read-only contract instance created for chain ${chainId}`);
      
      // Only fetch data for THIS chain, not any others
      fetchMinimalContractData(readOnlyContracts[chainId], chainId);
      
      // Load events with a longer delay and only if needed
      setTimeout(() => {
        if (shouldLoadEvents) {
          console.log(`Loading events for custom contract on chain ${chainId}`);
          // Always use simplified mode for custom contracts to reduce API calls
          loadPastEventsSimplified(chainId).catch(err => {
            console.error(`Error loading events for chain ${chainId}:`, err);
          });
        }
      }, 2000); // Increased delay to avoid rate limits
    } catch (error) {
      console.error(`Error setting up read-only contract for chain ${chainId}:`, error);
      toast.error("Error loading contract data");
    }
  };

  const updatePageUrl = (chainId, contractAddress) => {
    navigate(`/raffle/${chainId}/${contractAddress}`);
  };

  const handleRaffleCreated = (contractAddress) => {
    // Update the contract address and chain info
    setContractAddress(contractAddress);
    setUsingCustomContractAddress(true);
    setCustomContractAddress(contractAddress);
    
    // Load data from the new contract
    fetchContractData(readOnlyContracts[currentChainId], currentChainId);
    
    // Load events if needed
    if (shouldLoadEvents) {
      // Add a delay to avoid rate limits
      setTimeout(() => {
        if (shouldUseFallbackMode) {
          loadPastEventsSimplified(currentChainId);
        } else {
          loadPastEvents(currentChainId);
        }
      }, 2000);
    }
    
    // Update URL with chain ID and the new contract address
    updatePageUrl(currentChainId, contractAddress);
  };

  const handleChainChanged = async (chainIdHex) => {
    console.log("Chain changed to:", chainIdHex);
    // Parse the chain ID - it can come in different formats
    let chainId;
    if (typeof chainIdHex === 'string' && chainIdHex.startsWith('0x')) {
      chainId = parseInt(chainIdHex, 16);
    } else if (typeof chainIdHex === 'string') {
      // Handle "eip155:11155111" format
      if (chainIdHex.includes(':')) {
        chainId = parseInt(chainIdHex.split(':')[1], 10);
      } else {
        chainId = parseInt(chainIdHex, 10);
      }
    } else {
      chainId = chainIdHex;
    }
    
    console.log("Parsed chain ID:", chainId);
    
    // Check if this is a supported chain
    if (CHAIN_CONFIG[chainId]) {
      setCurrentChainId(chainId);
      
      // If using a custom contract from URL, use that instead of the default
      if (usingCustomContractAddress && customContractAddress) {
        setContractAddress(customContractAddress);
      } else {
        setContractAddress(CHAIN_CONFIG[chainId].contractAddress);
      }
      
      setNetworkName(CHAIN_CONFIG[chainId].name);
      setChainConnected(true);
      
      // Reset activity log for the new chain
      setActivityLog([{ type: 'loading', message: 'Loading recent activity...' }]);
      
      // If using custom contract, load that instead of the default
      if (usingCustomContractAddress && customContractAddress) {
        // Load the custom contract on the new chain
        loadCustomContract(customContractAddress, chainId);
      } else {
        // Refresh data for the default contract on the new chain
        await fetchContractData(readOnlyContracts[chainId], chainId);
        
        // Add a delay before loading events
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (shouldLoadEvents) {
          // Use appropriate event loading function
          if (shouldUseFallbackMode) {
            await loadPastEventsSimplified(chainId);
          } else {
            await loadPastEvents(chainId);
          }
        }
      }
      
      // If we have a signer, update the contract
      if (provider && signer) {
        try {
          // Re-create the signer to ensure it's using the updated chain
          const updatedProvider = new ethers.providers.Web3Provider(window.ethereum);
          const updatedSigner = updatedProvider.getSigner();
          setSigner(updatedSigner);
          
          const contractInstance = new ethers.Contract(
            usingCustomContractAddress ? customContractAddress : CHAIN_CONFIG[chainId].contractAddress,
            contractABI,
            updatedSigner
          );
          setContract(contractInstance);
          
          // Setup event listeners for the new contract
          setupEventListeners(contractInstance);
          
          // Fetch the updated wallet balance - with throttling
          await updateBalanceForCurrentChain();
        } catch (error) {
          console.error("Error updating contract after chain change:", error);
        }
      }
      
      toast.info(`Connected to ${CHAIN_CONFIG[chainId].name}`);
    } else {
      toast.error("Please switch to a supported network");
      setChainConnected(false);
    }
  };

  // Monitor for chain changes
  useEffect(() => {
    if (!provider) return;
    
    // Different providers might use different events
    if (provider.provider?.on) {
      provider.provider.on("chainChanged", handleChainChanged);
      
      return () => {
        if (provider.provider?.removeListener) {
          provider.provider.removeListener("chainChanged", handleChainChanged);
        }
      };
    } else if (provider.on) {
      provider.on("chainChanged", handleChainChanged);
      
      return () => {
        if (provider.removeListener) {
          provider.removeListener("chainChanged", handleChainChanged);
        }
      };
    }
    
    // Also check the chain ID at regular intervals as a fallback
    const checkNetworkInterval = setInterval(async () => {
      if (provider) {
        try {
          const network = await provider.getNetwork();
          const chainId = network.chainId;
          
          if (chainId !== currentChainId) {
            // Manually trigger chain change handler
            handleChainChanged(chainId);
          }
        } catch (error) {
          console.error("Error checking current network:", error);
        }
      }
    }, 30000); // Check every 30 seconds
    
    return () => {
      clearInterval(checkNetworkInterval);
    };
  }, [provider, currentChainId]);

  // Add an effect that prioritizes URL chainId on initial load and when it changes
  useEffect(() => {
    // If we have a URL-provided chain ID, it should take precedence
    if (urlChainId && CHAIN_CONFIG[urlChainId] && urlChainId !== currentChainId) {
      console.log(`Applying chain ID from URL: ${urlChainId}`);
      
      // Update the chain info
      setCurrentChainId(urlChainId);
      setNetworkName(CHAIN_CONFIG[urlChainId].name);
      
      // If using a custom contract, load that for this chain
      if (usingCustomContractAddress && customContractAddress) {
        // Don't load the default contract - prioritize the custom one
        setContractAddress(customContractAddress);
        
        // Load the custom contract for this chain ID
        // We use setTimeout to ensure this happens after other state updates
        setTimeout(() => {
          loadCustomContract(customContractAddress, urlChainId);
        }, 0);
      } else {
        // Just using the default contract for this chain
        setContractAddress(CHAIN_CONFIG[urlChainId].contractAddress);
        
        // Reset activity log
        setActivityLog([{ type: 'loading', message: 'Loading recent activity...' }]);
        
        // Ensure we have a provider for this chain
        if (!readOnlyProviders[urlChainId]) {
          readOnlyProviders[urlChainId] = new ethers.providers.JsonRpcProvider(RPC_URLS[urlChainId][0]);
        }
        
        // Create or update the contract instance for this chain
        readOnlyContracts[urlChainId] = new ethers.Contract(
          CHAIN_CONFIG[urlChainId].contractAddress,
          contractABI,
          readOnlyProviders[urlChainId]
        );
        
        // Load contract data
        fetchContractData(readOnlyContracts[urlChainId], urlChainId);
        
        // Add delay to avoid rate limit then load events
        setTimeout(() => {
          if (shouldLoadEvents) {
            const loadFunction = shouldUseFallbackMode ? loadPastEventsSimplified : loadPastEvents;
            loadFunction(urlChainId).catch(err => {
              console.error("Error loading events:", err);
            });
          }
        }, 1000);
      }
      
      // Update the URL if using a custom contract address
      if (usingCustomContractAddress && customContractAddress) {
        navigate(`/raffle/${urlChainId}/${customContractAddress}`, { replace: true });
      }
    }
  }, [urlChainId, currentChainId, usingCustomContractAddress, customContractAddress, navigate]);

  const handleNetworkChange = async (chainId) => {
    console.log(`Network selector changed to chain ID: ${chainId}`);
    
    // Skip if this is already the current chain
    if (chainId === currentChainId) {
      console.log("Already on this network, skipping update");
      return;
    }
    
    // First update UI immediately to provide feedback
    setCurrentChainId(chainId);
    
    // If using a custom contract, navigate to the raffle URL with the new chain
    if (usingCustomContractAddress && customContractAddress) {
      navigate(`/raffle/${chainId}/${customContractAddress}`, { replace: true });
    } else {
      // Using default contract - navigate to the network URL
      navigate(`/network/${chainId}/`, { replace: true });
    }
    
    // Set the contract address and network name
    if (usingCustomContractAddress && customContractAddress) {
      setContractAddress(customContractAddress);
    } else {
      setContractAddress(CHAIN_CONFIG[chainId].contractAddress);
    }
    
    setNetworkName(CHAIN_CONFIG[chainId].name);
    
    // Reset activity log to loading state
    setActivityLog([{ type: 'loading', message: 'Loading recent activity...' }]);
    
    // Check if wallet is connected
    if (authenticated && wallets && wallets.length > 0) {
      const wallet = wallets[0];
      
      // Try to update balance using read-only provider first - with throttling
      if (wallet.address) {
        try {
          // Check if we have a cached balance that's recent enough
          const cacheKey = `${chainId}-${wallet.address}`;
          const cachedData = balanceCache[cacheKey];
          
          if (cachedData && (Date.now() - cachedData.timestamp < 60000)) { // 1 minute cache
            // Use cached balance
            console.log(`Using cached balance for ${chainId}: ${cachedData.balance} ETH`);
            setWalletBalance(cachedData.balance);
          } else {
            // Fetch fresh balance with throttling
            const balance = await throttledCall(
              () => readOnlyProviders[chainId].getBalance(wallet.address),
              chainId
            );
            const formattedBalance = ethers.utils.formatEther(balance);
            setWalletBalance(formattedBalance);
            console.log(`Updated wallet balance from read-only provider: ${formattedBalance} ETH`);
            
            // Update cache
            balanceCache[cacheKey] = {
              balance: formattedBalance,
              timestamp: Date.now()
            };
          }
        } catch (error) {
          console.error("Error fetching initial balance from read-only provider:", error);
        }
      }
      
      try {
        // Try to switch the wallet's chain
        console.log(`Attempting to switch wallet to chain ${chainId}`);
        await wallet.switchChain(chainId);
        console.log(`Successfully switched wallet to chain ${chainId}`);
        toast.success(`Switched to ${CHAIN_CONFIG[chainId].name}`);
        
        // Wait a moment for wallet to update
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Get new provider and signer for the updated chain
        let newProvider;
        try {
          if (wallet.getEthersProvider && typeof wallet.getEthersProvider === 'function') {
            newProvider = await wallet.getEthersProvider();
          } else if (window.ethereum) {
            newProvider = new ethers.providers.Web3Provider(window.ethereum);
            // Force a refresh of accounts and chain
            await newProvider.send("eth_requestAccounts", []);
          }
          
          if (newProvider) {
            setProvider(newProvider);
            
            // Verify the provider is on the right chain
            const network = await newProvider.getNetwork();
            console.log(`Provider network after switch: ${network.chainId}`);
            
            // Update signer
            const newSigner = newProvider.getSigner();
            setSigner(newSigner);
            
            // Create new contract instance - respect custom contract from URL
            const contractInstance = new ethers.Contract(
              usingCustomContractAddress ? customContractAddress : CHAIN_CONFIG[chainId].contractAddress,
              contractABI,
              newSigner
            );
            setContract(contractInstance);
            
            // Setup event listeners
            setupEventListeners(contractInstance);
            
            // Update wallet balance with the new provider - throttled
            if (wallet.address) {
              try {
                // Throttled balance update with caching
                await updateBalanceForCurrentChain();
              } catch (error) {
                console.error("Error updating balance after chain switch:", error);
              }
            }
          }
        } catch (error) {
          console.error("Error updating provider after chain switch:", error);
        }
      } catch (error) {
        console.error("Failed to switch wallet chain:", error);
        toast.warning(`Couldn't switch wallet to ${CHAIN_CONFIG[chainId].name}. Viewing in read-only mode.`);
      }
    }
    
    // Regardless of wallet switch success, update data for the selected chain
    try {
      // If using a custom contract address, load that contract
      if (usingCustomContractAddress && customContractAddress) {
        loadCustomContract(customContractAddress, chainId);
      } else {
        // Otherwise load the default contract for this chain
        await fetchContractData(readOnlyContracts[chainId], chainId);
        
        // Add delay before loading events
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Load events for the selected chain
        if (shouldLoadEvents) {
          // Use appropriate event loading function
          if (shouldUseFallbackMode) {
            await loadPastEventsSimplified(chainId);
          } else {
            await loadPastEvents(chainId);
          }
          console.log(`Loaded past events for chain ${chainId}`);
        }
      }
    } catch (error) {
      console.error(`Error loading data for chain ${chainId}:`, error);
      toast.error(`Error loading data for ${CHAIN_CONFIG[chainId].name}`);
      
      // If rate limited, try to rotate provider
      if (error.message && (
        error.message.includes('429') || 
        error.message.includes('rate limit') ||
        error.message.includes('too many requests')
      )) {
        console.log("Rate limit detected, rotating provider...");
        rotateRpcProvider(chainId);
      }
    }
  };

  // Enhanced balance update function with throttling and caching
  const updateBalanceForCurrentChain = async () => {
    // Only update if we have a connected wallet
    if (authenticated && wallets && wallets.length > 0 && wallets[0].address) {
      // Check if enough time has passed since last balance check
      const now = Date.now();
      if (now - lastBalanceCheckTime < BALANCE_CHECK_COOLDOWN) {
        console.log("Skipping balance update due to cooldown");
        return;
      }
      
      setLastBalanceCheckTime(now);
      
      try {
        console.log(`Updating balance for chain ${currentChainId}`);
        
        // Check if we have a cached balance that's recent enough
        const cacheKey = `${currentChainId}-${wallets[0].address}`;
        const cachedData = balanceCache[cacheKey];
        
        if (cachedData && (now - cachedData.timestamp < 60000)) { // 1 minute cache
          // Use cached balance
          console.log(`Using cached balance for ${currentChainId}: ${cachedData.balance} ETH`);
          setWalletBalance(cachedData.balance);
          return;
        }
        
        // Always update from read-only provider first (this is fast and reliable)
        try {
          const balance = await throttledCall(
            () => readOnlyProviders[currentChainId].getBalance(wallets[0].address),
            currentChainId
          );
          const formattedBalance = ethers.utils.formatEther(balance);
          setWalletBalance(formattedBalance);
          console.log(`Set balance from read-only provider: ${formattedBalance} ETH`);
          
          // Update cache
          balanceCache[cacheKey] = {
            balance: formattedBalance,
            timestamp: now
          };
        } catch (error) {
          console.error("Error fetching balance from read-only provider:", error);
          
          // If rate limited, try to rotate provider
          if (error.message && (
            error.message.includes('429') || 
            error.message.includes('rate limit') ||
            error.message.includes('too many requests')
          )) {
            console.log("Rate limit detected, rotating provider...");
            rotateRpcProvider(currentChainId);
          }
        }
        
        // If we have a connected provider, try to update from there as well
        if (provider) {
          try {
            // Check if provider's network matches current chain
            const network = await provider.getNetwork();
            if (network.chainId === currentChainId) {
              const balance = await provider.getBalance(wallets[0].address);
              const formattedBalance = ethers.utils.formatEther(balance);
              setWalletBalance(formattedBalance);
              console.log(`Updated balance from connected provider: ${formattedBalance} ETH`);
              
              // Update cache
              balanceCache[cacheKey] = {
                balance: formattedBalance,
                timestamp: now
              };
            } else {
              console.log(`Provider on different chain (${network.chainId}), not updating balance from provider`);
            }
          } catch (error) {
            console.error("Error fetching balance from connected provider:", error);
          }
        }
      } catch (error) {
        console.error("Error updating balance for current chain:", error);
      }
    }
  };

  // Add effect to update balance when chain changes
  useEffect(() => {
    // Only run if authenticated to avoid unnecessary calls
    if (authenticated && wallets && wallets.length > 0) {
      updateBalanceForCurrentChain();
    }
  }, [currentChainId, authenticated, wallets]);

  // Function to fetch wallet balance
  const fetchWalletBalance = async (walletProvider, walletAddress) => {
    try {
      if (!walletProvider || !walletAddress) {
        walletProvider = provider;
        walletAddress = address;
      }
      
      if (!walletProvider || !walletAddress) {
        console.log("No provider or address available for balance check");
        return;
      }
      
      // Check if enough time has passed since last balance check
      const now = Date.now();
      if (now - lastBalanceCheckTime < BALANCE_CHECK_COOLDOWN) {
        console.log("Skipping balance update due to cooldown");
        return;
      }
      
      setLastBalanceCheckTime(now);
      
      // Check if we have a cached balance that's recent enough
      const cacheKey = `${currentChainId}-${walletAddress}`;
      const cachedData = balanceCache[cacheKey];
      
      if (cachedData && (now - cachedData.timestamp < 60000)) { // 1 minute cache
        // Use cached balance
        console.log(`Using cached balance: ${cachedData.balance} ETH`);
        setWalletBalance(cachedData.balance);
        return;
      }
      
      // Get the provider's network
      let providerChainId;
      try {
        const network = await walletProvider.getNetwork();
        providerChainId = network.chainId;
      } catch (error) {
        console.error("Could not get provider network:", error);
        // Default to current chain ID
        providerChainId = currentChainId;
      }
      
      console.log(`Fetching balance with provider on chain ${providerChainId} for address ${walletAddress}`);
      
      // Check if provider's chain matches current UI chain
      if (providerChainId === currentChainId) {
        try {
          const balance = await walletProvider.getBalance(walletAddress);
          const formattedBalance = ethers.utils.formatEther(balance);
          setWalletBalance(formattedBalance);
          console.log(`Updated wallet balance: ${formattedBalance} ETH`);
          
          // Update cache
          balanceCache[cacheKey] = {
            balance: formattedBalance,
            timestamp: now
          };
        } catch (error) {
          console.error("Error fetching balance from provider:", error);
          
          // Fallback to read-only provider
          try {
            const balance = await throttledCall(
              () => readOnlyProviders[currentChainId].getBalance(walletAddress),
              currentChainId
            );
            const formattedBalance = ethers.utils.formatEther(balance);
            setWalletBalance(formattedBalance);
            console.log(`Updated wallet balance from fallback: ${formattedBalance} ETH`);
            
            // Update cache
            balanceCache[cacheKey] = {
              balance: formattedBalance,
              timestamp: now
            };
          } catch (fallbackError) {
            console.error("Error fetching balance from fallback provider:", fallbackError);
          }
        }
      } else {
        console.log(`Provider chain (${providerChainId}) doesn't match UI chain (${currentChainId}), using read-only provider`);
        
        // Use read-only provider for the current UI chain
        try {
          const balance = await throttledCall(
            () => readOnlyProviders[currentChainId].getBalance(walletAddress),
            currentChainId
          );
          const formattedBalance = ethers.utils.formatEther(balance);
          setWalletBalance(formattedBalance);
          console.log(`Updated wallet balance from read-only: ${formattedBalance} ETH`);
          
          // Update cache
          balanceCache[cacheKey] = {
            balance: formattedBalance,
            timestamp: now
          };
        } catch (error) {
          console.error("Error fetching balance from read-only provider:", error);
        }
      }
    } catch (error) {
      console.error("Error in fetchWalletBalance:", error);
    }
  };

  // Update wallet balance periodically when connected
  useEffect(() => {
    if (provider && address) {
      // Set up an interval to refresh the balance periodically
      const balanceInterval = setInterval(() => {
        fetchWalletBalance(provider, address);
      }, BALANCE_CHECK_COOLDOWN * 2); // Double the cooldown period
      
      return () => clearInterval(balanceInterval);
    }
  }, [provider, address]);

  // Load past events with improved caching and rate limit handling
  const loadPastEvents = async (chainId) => {
    if (!chainId || !CHAIN_CONFIG[chainId]) {
      chainId = currentChainId;
    }
    
    // If in fallback mode, use simplified loading
    if (shouldUseFallbackMode) {
      return loadPastEventsSimplified(chainId);
    }
    
    try {
      // Show loading indicator
      setActivityLog(prevLog => {
        if (prevLog.length === 0) {
          return [{ type: 'loading', message: 'Loading recent activity...' }];
        }
        return prevLog;
      });
      
      const targetContract = readOnlyContracts[chainId];
      const targetProvider = readOnlyProviders[chainId];
      
      // Get current block number with throttling
      const blockNumber = await throttledCall(
        () => targetProvider.getBlockNumber(),
        chainId
      );
      
      // Reduce the block range to minimize API calls
      const startBlock = Math.max(0, blockNumber - 1000); 
      
      // Fetch events in single calls with throttling
      const [ticketEvents, multiTicketEvents, winnerEvents] = await Promise.all([
        throttledCall(() => targetContract.queryFilter(targetContract.filters.TicketBought(), startBlock), chainId),
        throttledCall(() => targetContract.queryFilter(targetContract.filters.MultipleTicketsBought(), startBlock), chainId),
        throttledCall(() => targetContract.queryFilter(targetContract.filters.Winner(), startBlock), chainId)
      ]);
      
      // Check if we have any events at all
      if (ticketEvents.length === 0 && multiTicketEvents.length === 0 && winnerEvents.length === 0) {
        // No events found, stop making more API calls
        setActivityLog([{ type: 'empty', message: 'No recent activity found' }]);
        return;
      }
      
      // Combine events and add type info
      const combinedEvents = [
        ...ticketEvents.map(event => ({ ...event, type: 'ticket', eventName: 'TicketBought' })),
        ...multiTicketEvents.map(event => ({ ...event, type: 'multi-ticket', eventName: 'MultipleTicketsBought' })),
        ...winnerEvents.map(event => ({ ...event, type: 'win', eventName: 'Winner' }))
      ];
      
      // Sort by block number and transaction index
      combinedEvents.sort((a, b) => {
        if (b.blockNumber !== a.blockNumber) {
          return b.blockNumber - a.blockNumber;
        }
        return b.transactionIndex - a.transactionIndex;
      });
      
      // Get only the most recent events
      const recentEvents = combinedEvents.slice(0, 10); // Reduced from 20 to 10 to minimize API calls
      
      if (recentEvents.length === 0) {
        setActivityLog([{ type: 'empty', message: 'No recent activity found' }]);
        return;
      }

      // Extract all unique block numbers we need
      const uniqueBlockNumbers = [...new Set(recentEvents.map(event => event.blockNumber))];
      
      // Filter out blocks we already have in cache
      const uncachedBlockNumbers = uniqueBlockNumbers.filter(
        blockNum => !blockCache[`${chainId}-${blockNum}`]
      );
      
      // Get blocks from cache or fetch them
      const blocks = {};
      
      // Add cached blocks
      uniqueBlockNumbers.forEach(blockNum => {
        const cacheKey = `${chainId}-${blockNum}`;
        if (blockCache[cacheKey]) {
          blocks[blockNum] = blockCache[cacheKey];
        }
      });
      
      // If we need to fetch blocks
      if (uncachedBlockNumbers.length > 0) {
        // Get all block data in batches to avoid rate limiting
        const batchSize = 3; // Smaller batch size
        const blockBatches = [];
        
        for (let i = 0; i < uncachedBlockNumbers.length; i += batchSize) {
          blockBatches.push(uncachedBlockNumbers.slice(i, i + batchSize));
        }
        
        // Process batches sequentially with delays between batches
        for (let i = 0; i < blockBatches.length; i++) {
          const batch = blockBatches[i];
          
          // Add delay between batches
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          try {
            const batchData = await Promise.all(
              batch.map(blockNum => throttledCall(() => targetProvider.getBlock(blockNum), chainId))
            );
            
            // Add batch results to our blocks object and cache
            batchData.forEach(block => {
              if (block) {
                blocks[block.number] = block;
                // Cache the block
                blockCache[`${chainId}-${block.number}`] = block;
              }
            });
          } catch (error) {
            console.error(`Error fetching batch ${i}:`, error);
            // If rate limited, switch to simplified mode
            if (error.message && (
              error.message.includes('429') || 
              error.message.includes('rate limit') ||
              error.message.includes('too many requests')
            )) {
              console.log("Rate limit hit, switching to simplified mode");
              setShouldUseFallbackMode(true);
              return loadPastEventsSimplified(chainId);
            }
          }
        }
      }
      
      // Process events using the block data we've already fetched
      const processedEvents = recentEvents.map(event => {
        const block = blocks[event.blockNumber];
        const timestamp = block ? new Date(block.timestamp * 1000).toLocaleString() : `Block #${event.blockNumber}`;
        
        // Add transaction hash to all events for deduplication
        const txHash = event.transactionHash;
        
        if (event.eventName === 'TicketBought') {
          const { player, amount, pot, won } = event.args;
          
          return {
            type: 'ticket',
            player,
            quantity: 1,
            amount: ethers.utils.formatEther(amount),
            pot: ethers.utils.formatEther(pot),
            won,
            time: timestamp,
            blockNumber: event.blockNumber,
            txHash: txHash
          };
        } else if (event.eventName === 'MultipleTicketsBought') {
          const { player, quantity, totalAmount, pot } = event.args;
          return {
            type: 'multi-ticket',
            player,
            quantity: quantity.toNumber(),
            amount: ethers.utils.formatEther(totalAmount),
            pot: ethers.utils.formatEther(pot),
            time: timestamp,
            blockNumber: event.blockNumber,
            txHash: txHash
          };
        } else if (event.eventName === 'Winner') {
          const { player, prizeAmount } = event.args;
          return {
            type: 'win',
            player,
            amount: ethers.utils.formatEther(prizeAmount),
            time: timestamp,
            blockNumber: event.blockNumber,
            txHash: txHash
          };
        }
        return null;
      }).filter(Boolean);
      
      // Remove duplicate multi-ticket events - prioritize MultipleTicketsBought over TicketBought
      const deduplicatedEvents = [];
      const seenTransactions = new Set();
      const seenMultiTickets = new Set();
      
      // First add all multi-ticket events (avoiding duplicates)
      processedEvents.filter(event => event.type === 'multi-ticket').forEach(event => {
        const key = `${event.player.toLowerCase()}-${event.txHash}`;
        if (!seenMultiTickets.has(key)) {
          seenMultiTickets.add(key);
          seenTransactions.add(key);
          deduplicatedEvents.push(event);
        }
      });
      
      // Then add single ticket events that don't overlap with multi-tickets
      processedEvents.filter(event => event.type === 'ticket').forEach(event => {
        const key = `${event.player.toLowerCase()}-${event.txHash}`;
        
        // Skip if we've already processed this transaction
        if (seenTransactions.has(key)) {
          return;
        }
        
        // Skip this event if there's a multi-ticket event from the same player in the same transaction
        // This handles the case where both events are emitted in the same transaction
        const hasMultiTicket = deduplicatedEvents.some(e => 
          e.type === 'multi-ticket' && 
          e.player.toLowerCase() === event.player.toLowerCase() &&
          e.txHash === event.txHash
        );
        
        if (!hasMultiTicket) {
          seenTransactions.add(key);
          deduplicatedEvents.push(event);
        }
      });
      
      // Add all winner events
      processedEvents.filter(event => event.type === 'win').forEach(event => {
        const key = `win-${event.player.toLowerCase()}-${event.txHash}`;
        if (!seenTransactions.has(key)) {
          seenTransactions.add(key);
          deduplicatedEvents.push(event);
        }
      });
      
      // Sort by time (most recent first)
      deduplicatedEvents.sort((a, b) => {
        // First by block number (descending)
        if (a.blockNumber !== b.blockNumber) {
          return b.blockNumber - a.blockNumber;
        }
        // If same block, winner events come first
        if (a.type === 'win' && b.type !== 'win') return -1;
        if (a.type !== 'win' && b.type === 'win') return 1;
        // Then multi-ticket events come before single tickets
        if (a.type === 'multi-ticket' && b.type === 'ticket') return -1;
        if (a.type === 'ticket' && b.type === 'multi-ticket') return 1;
        // Otherwise, same priority
        return 0;
      });
      
      // Take only the top 10 events after deduplication
      const finalEvents = deduplicatedEvents.slice(0, 10);
      
      // Update the activity log
      setActivityLog(finalEvents);
      
      // Only log once to avoid duplicate console messages
      if (!eventsLoaded) {
        console.log('Loaded past events:', finalEvents);
        eventsLoaded = true;
      }
      
    } catch (error) {
      console.error('Error loading past events:', error);
      
      if (error.message && (
        error.message.includes('429') || 
        error.message.includes('rate limit') ||
        error.message.includes('too many requests')
      )) {
        console.log("Rate limit hit during past events load, switching to simplified mode");
        setShouldUseFallbackMode(true);
        
        // Try with simplified loading
        try {
          await loadPastEventsSimplified(chainId);
        } catch (fallbackError) {
          console.error("Even simplified events failed:", fallbackError);
          setActivityLog([{ type: 'error', message: 'Failed to load recent activity' }]);
        }
      } else {
        // Show error message
        setActivityLog(prevLog => {
          if (prevLog.length === 1 && prevLog[0].type === 'loading') {
            return [{ type: 'error', message: 'Failed to load recent activity' }];
          }
          return prevLog;
        });
      }
    }
  };

  // Simplified event loading for rate-limited situations
  const loadPastEventsSimplified = async (chainId) => {
    if (!chainId || !CHAIN_CONFIG[chainId]) {
      chainId = currentChainId;
    }
    
    try {
      // Show loading indicator
      setActivityLog(prevLog => {
        if (prevLog.length === 0) {
          return [{ type: 'loading', message: 'Loading recent activity...' }];
        }
        return prevLog;
      });
      
      const targetContract = readOnlyContracts[chainId];
      const targetProvider = readOnlyProviders[chainId];
      
      // Get current block number with throttling
      const blockNumber = await throttledCall(
        () => targetProvider.getBlockNumber(),
        chainId
      );
      
      // Only look back 250 blocks to minimize API calls (reduced from 500)
      const startBlock = Math.max(0, blockNumber - 250); 
      
      // Use a single batch of events to minimize API calls
      const [ticketEvents, multiTicketEvents, winnerEvents] = await Promise.all([
        throttledCall(() => targetContract.queryFilter(targetContract.filters.TicketBought(), startBlock), chainId),
        throttledCall(() => targetContract.queryFilter(targetContract.filters.MultipleTicketsBought(), startBlock), chainId),
        throttledCall(() => targetContract.queryFilter(targetContract.filters.Winner(), startBlock), chainId)
      ]);
      
      if (ticketEvents.length === 0 && multiTicketEvents.length === 0 && winnerEvents.length === 0) {
        setActivityLog([{ type: 'empty', message: 'No recent activity found' }]);
        return;
      }
      
      // Process events without getting block timestamps to reduce API calls
      const processedEvents = [
        ...multiTicketEvents.map(event => {
          const { player, quantity, totalAmount, pot } = event.args;
          return {
            type: 'multi-ticket',
            player,
            quantity: quantity.toNumber(),
            amount: ethers.utils.formatEther(totalAmount),
            pot: ethers.utils.formatEther(pot),
            time: `Block #${event.blockNumber}`,
            blockNumber: event.blockNumber,
            txHash: event.transactionHash
          };
        }),
        ...ticketEvents.map(event => {
          const { player, amount, pot, won } = event.args;
          return {
            type: 'ticket',
            player,
            amount: ethers.utils.formatEther(amount),
            pot: ethers.utils.formatEther(pot),
            won,
            time: `Block #${event.blockNumber}`,
            blockNumber: event.blockNumber,
            txHash: event.transactionHash
          };
        }),
        ...winnerEvents.map(event => {
          const { player, prizeAmount } = event.args;
          return {
            type: 'win',
            player,
            amount: ethers.utils.formatEther(prizeAmount),
            time: `Block #${event.blockNumber}`,
            blockNumber: event.blockNumber,
            txHash: event.transactionHash
          };
        })
      ];
      
      // Deduplicate and sort events
      const uniqueEvents = [];
      const seenTxs = new Set();
      
      // First add multi-ticket events
      processedEvents
        .filter(e => e.type === 'multi-ticket')
        .forEach(e => {
          const key = `${e.txHash}-${e.player.toLowerCase()}`;
          if (!seenTxs.has(key)) {
            seenTxs.add(key);
            uniqueEvents.push(e);
          }
        });
      
      // Then add single ticket events that aren't part of multi-ticket purchases
      processedEvents
        .filter(e => e.type === 'ticket')
        .forEach(e => {
          const key = `${e.txHash}-${e.player.toLowerCase()}`;
          if (!seenTxs.has(key)) {
            seenTxs.add(key);
            uniqueEvents.push(e);
          }
        });
      
      // Always add winner events
      processedEvents
        .filter(e => e.type === 'win')
        .forEach(e => {
          uniqueEvents.push(e);
        });
      
      // Sort by block number (descending)
      uniqueEvents.sort((a, b) => b.blockNumber - a.blockNumber);
      
      // Take at most 10 events
      const finalEvents = uniqueEvents.slice(0, 10);
      
      // Update the activity log
      setActivityLog(finalEvents);
      
      if (!eventsLoaded) {
        console.log('Loaded past events (simplified):', finalEvents);
        eventsLoaded = true;
      }
      
    } catch (error) {
      console.error('Error loading past events (simplified):', error);
      
      // Check for rate limit to rotate provider
      if (error.message && (
        error.message.includes('429') || 
        error.message.includes('rate limit') ||
        error.message.includes('too many requests')
      )) {
        console.log("Rate limit hit during simplified events load, rotating provider");
        rotateRpcProvider(chainId);
      }
      
      setActivityLog([{ type: 'error', message: 'Could not load activity' }]);
    }
  };

  // Fetch contract data with improved throttling
  const fetchContractData = async (contractInstance, chainId) => {
    if (!contractInstance) {
      console.error('No contract instance provided to fetchContractData');
      return;
    }
    
    if (!chainId || !CHAIN_CONFIG[chainId]) {
      chainId = currentChainId;
    }
    
    try {
      // Add a small delay to avoid concurrent calls
      await new Promise(resolve => setTimeout(resolve, Math.random() * 500));
      
      // Get pot size with throttling - try up to 3 times if it fails
      let pot;
      let potFetchAttempts = 0;
      
      while (potFetchAttempts < 3) {
        try {
          pot = await throttledCall(
            () => contractInstance.getPot(),
            chainId
          );
          break; // If successful, exit the loop
        } catch (error) {
          potFetchAttempts++;
          console.warn(`Error fetching pot size, attempt ${potFetchAttempts}/3:`, error);
          if (potFetchAttempts < 3) {
            // Wait before trying again
            await new Promise(resolve => setTimeout(resolve, 500));
          } else {
            console.error("Failed to fetch pot size after 3 attempts");
          }
        }
      }
      
      if (pot !== undefined) {
        const formattedPot = ethers.utils.formatEther(pot);
        console.log(`Setting pot size to: ${formattedPot} ETH`);
        setPotSize(formattedPot);
      }
      
      // Add a small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get fee collector address
      try {
        const collector = await throttledCall(
          () => contractInstance.feeCollector(),
          chainId
        );
        setFeeCollector(collector);
        console.log(`Fee collector address: ${collector}`);
        
        if (FeeSplitterArtifact && FeeSplitterArtifact.abi) {
          try {
            // Create a FeeSplitter contract instance
            const feeSplitterABI = FeeSplitterArtifact.abi;
            const feeSplitterContract = new ethers.Contract(
              collector,
              feeSplitterABI,
              readOnlyProviders[chainId]
            );
            
            // Try to call userFeeCollector() function
            const userCollector = await throttledCall(
              () => feeSplitterContract.userFeeCollector(),
              chainId
            );
            setUserFeeCollector(userCollector);
            
            // Also get the default fee collector to display
            const defaultCollector = await throttledCall(
              () => feeSplitterContract.defaultFeeCollector(),
              chainId
            );
            setDefaultFeeCollector(defaultCollector);
            
            console.log(`User fee collector: ${userCollector}`);
            console.log(`Default fee collector: ${defaultCollector}`);
          } catch (error) {
            console.log("Not a FeeSplitter contract or error getting collectors:", error);
            // If not a FeeSplitter, then the fee collector is just a direct address
            setUserFeeCollector(collector);
          }
        } else {
          console.log("FeeSplitterArtifact not available, using collector address directly");
          setUserFeeCollector(collector);
        }
      } catch (error) {
        console.warn('Error fetching fee collector address:', error);
      }

      // Add a small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));

      // Add owner check if the user is connected
      if (address) {
        await checkContractOwnership(contractInstance, address);
      }

      // Add a small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get ticket price with throttling
      try {
        const price = await throttledCall(
          () => contractInstance.ticketPrice(),
          chainId
        );
        
        // Store the raw ticket price for calculations
        const rawPriceWei = price.toString();
        const formattedPrice = ethers.utils.formatEther(price);
        
        // Store both the raw price (for calculations) and formatted price (for display)
        setContractTicketPrice(rawPriceWei);
        setFormattedTicketPrice(formattedPrice);
        
        console.log(`Fetched ticket price from contract: ${formattedPrice} ETH (${rawPriceWei} wei)`);
      } catch (error) {
        console.warn('Error fetching ticket price, using default:', error);
        // Keep using the default price as fallback
      }
      
      // Add a small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get ticket fee percentage with throttling
      try {
        const ticketFee = await throttledCall(
          () => contractInstance.ticketFeePercentage(),
          chainId
        );
        setTicketFeePercentage(ticketFee.toNumber());
      } catch (error) {
        console.warn('Error fetching ticket fee percentage, using default:', error);
        // Keep using default
      }
      
      // Add a small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get jackpot fee percentage with throttling
      try {
        const jackpotFee = await throttledCall(
          () => contractInstance.jackpotFeePercentage(),
          chainId
        );
        setJackpotFeePercentage(jackpotFee.toNumber());
      } catch (error) {
        console.warn('Error fetching jackpot fee percentage, using default:', error);
        // Keep using default
      }
      
      // Add a small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        const chance = await throttledCall(
          () => contractInstance.winChance(),
          chainId
        );
        setWinChance(chance.toNumber());
        console.log(`Win chance: 1 in ${chance.toNumber()} (${(100/chance.toNumber()).toFixed(2)}%)`);
      } catch (error) {
        console.warn('Error fetching win chance:', error);
      }

      // Add a small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get last winner with throttling
      const winner = await throttledCall(
        () => contractInstance.lastWinner(),
        chainId
      );
      if (winner !== ethers.constants.AddressZero) {
        setLastWinner(winner);
      }
      
      // Add a small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get last win amount with throttling
      const winAmount = await throttledCall(
        () => contractInstance.lastWinAmount(),
        chainId
      );
      setLastWinAmount(ethers.utils.formatEther(winAmount));
    } catch (error) {
      console.error('Error fetching contract data:', error);
      
      // Check for rate limit to rotate provider
      if (error.message && (
        error.message.includes('429') || 
        error.message.includes('rate limit') ||
        error.message.includes('too many requests')
      )) {
        console.log("Rate limit hit during contract data fetch, rotating provider");
        rotateRpcProvider(chainId);
      }
    }
  };

  // Setup event listeners
  const setupEventListeners = (contractInstance) => {
    // Remove existing listeners first
    contractInstance.removeAllListeners('TicketBought');
    contractInstance.removeAllListeners('MultipleTicketsBought');
    contractInstance.removeAllListeners('Winner');
    
    // Listen for MultipleTicketsBought events - HANDLE THESE FIRST
    contractInstance.on('MultipleTicketsBought', (player, quantity, totalAmount, pot) => {
      // Create a unique transaction identifier to avoid duplicates
      const txId = `${player.toLowerCase()}-${ethers.utils.formatEther(totalAmount)}-${Date.now()}`;
      
      const newActivity = {
        type: 'multi-ticket',
        player,
        quantity: quantity.toNumber(),
        amount: ethers.utils.formatEther(totalAmount),
        pot: ethers.utils.formatEther(pot),
        time: new Date().toLocaleString(),
        txId, // Add this unique identifier
      };
      
      // Add to activity log, avoiding duplicates by checking txId
      setActivityLog(prev => {
        // Check if we already have this transaction in the log
        const isDuplicate = prev.some(item => 
          item.txId === txId || 
          (item.type === 'multi-ticket' && 
          item.player.toLowerCase() === player.toLowerCase() && 
          item.quantity === quantity.toNumber())
        );
        
        if (isDuplicate) return prev;
        return [newActivity, ...prev.slice(0, 9)];
      });
      
      // Update pot size
      setPotSize(ethers.utils.formatEther(pot));
      
      // Show toast if it's the current user
      if (player.toLowerCase() === address?.toLowerCase()) {
        toast.info(`${quantity.toNumber()} tickets purchased! Good luck!`);
      }
    });

    // Listen for TicketBought events - handle AFTER MultipleTicketsBought
    contractInstance.on('TicketBought', (player, amount, pot, won) => {
      // Skip events that are likely part of a multi-ticket purchase
      // We'll identify these by the amount matching exactly TICKET_PRICE
      if (ethers.utils.formatEther(amount) === ticketPrice) {
        // Create a unique ID for deduplication
        const txId = `${player.toLowerCase()}-${ethers.utils.formatEther(amount)}-${Date.now()}`;
        
        // Check recent MultipleTicketsBought events - skip if we already have a multi-ticket event for this player
        setActivityLog(prev => {
          // If there's already a multi-ticket event from this player in the last few seconds, skip this event
          const recentMultiTicket = prev.find(item => 
            item.type === 'multi-ticket' && 
            item.player.toLowerCase() === player.toLowerCase() &&
            new Date().getTime() - new Date(item.time).getTime() < 10000 // Within 10 seconds
          );
          
          if (recentMultiTicket) return prev;
          
          const newActivity = {
            type: 'ticket',
            player,
            amount: ethers.utils.formatEther(amount),
            quantity: 1,
            pot: ethers.utils.formatEther(pot),
            won,
            time: new Date().toLocaleString(),
            txId,
          };
          
          // Don't add duplicates
          const isDuplicate = prev.some(item => 
            item.txId === txId || 
            (item.type === 'ticket' && 
            item.player.toLowerCase() === player.toLowerCase() &&
            Math.abs(new Date(item.time) - new Date()) < 3000) // Within 3 seconds
          );
          
          if (isDuplicate) return prev;
          return [newActivity, ...prev.slice(0, 9)];
        });
        
        // Update pot size
        setPotSize(ethers.utils.formatEther(pot));
        
        // Show toast if it's the current user
        if (player.toLowerCase() === address?.toLowerCase()) {
          if (won) {
            toast.success("🎉 You won the jackpot! 🎉");
          } else {
            toast.info("Ticket purchased! Better luck next time!");
          }
        }
      }
    });
    
    // Listen for Winner events
    contractInstance.on('Winner', (player, prizeAmount) => {
      const newActivity = {
        type: 'win',
        player,
        amount: ethers.utils.formatEther(prizeAmount),
        time: new Date().toLocaleString(),
      };
      
      setActivityLog(prev => [newActivity, ...prev.slice(0, 9)]);
      
      // Update last winner
      setLastWinner(player);
      setLastWinAmount(ethers.utils.formatEther(prizeAmount));
      
      // Show toast
      toast.success(`🏆 ${player.slice(0, 6)}...${player.slice(-4)} won ${ethers.utils.formatEther(prizeAmount)} ETH!`);
    });
  };

  // Parse chain ID from various formats
  const parseChainId = (chainIdStr) => {
    if (!chainIdStr) return null;
    
    // Handle "eip155:11155111" format
    if (typeof chainIdStr === 'string' && chainIdStr.startsWith('eip155:')) {
      return parseInt(chainIdStr.split(':')[1], 10);
    }
    
    // Handle "0xaa36a7" hex format
    if (typeof chainIdStr === 'string' && chainIdStr.startsWith('0x')) {
      return parseInt(chainIdStr, 16);
    }
    
    // Handle numeric string
    if (typeof chainIdStr === 'string') {
      return parseInt(chainIdStr, 10);
    }
    
    // Already a number
    return chainIdStr;
  };

  // Buy ticket function
  const handleBuyTicket = async () => {
    if (!authenticated) {
      toast.error("Please connect your wallet first");
      login();
      return;
    }
    
    if (isLoading) {
      toast.info("Transaction in progress. Please wait...");
      return;
    }
    
    // Check if we need to refresh the page due to wallet connection issues
    if (wallets && wallets.length > 0) {
      const wallet = wallets[0];
      
      if (!wallet.address) {
        toast.error("Wallet connection issue. Please refresh the page.");
        return;
      }
      
      // Verify we're on a supported network with proper type handling
      console.log("eth_chainId for wallet:", wallet.chainId);
      const walletChainId = parseChainId(wallet.chainId);
      console.log("Parsed wallet chain ID:", walletChainId, "Selected chain ID:", currentChainId);
      
      // Only check if we can actually determine the chain ID
      if (walletChainId && walletChainId !== currentChainId) {
        // Chain mismatch handling code here
        toast.error(`Your wallet is on a different network. Please switch to ${CHAIN_CONFIG[currentChainId].name}`);
        return;
      }
    } else {
      toast.error("No wallet detected. Please reconnect.");
      login();
      return;
    }
    
    try {
      setIsLoading(true);
      
      // Generate random numbers for the tickets
      const numbers = Array.from({ length: ticketQuantity }, () => 
        Math.floor(Math.random() * 50)
      );
      setTicketNumbers(numbers);
      
      // Show jackpot modal
      setJackpotResult(null);
      setShowJackpotModal(true);
      
      // Use BigNumber for precise calculations
      let totalPriceWei;
      
      // If contractTicketPrice is stored as wei string
      if (contractTicketPrice.includes('e') || !isNaN(contractTicketPrice)) {
        // This is likely a decimal or scientific notation - convert properly
        const priceInWei = ethers.BigNumber.from(contractTicketPrice);
        totalPriceWei = priceInWei.mul(ticketQuantity);
        console.log(`Using contract ticket price in wei: ${contractTicketPrice}`);
      } else {
        // Fallback - parse from ether
        totalPriceWei = ethers.utils.parseEther(
          (parseFloat(formattedTicketPrice) * ticketQuantity).toString()
        );
      }
      
      const totalPriceEth = ethers.utils.formatEther(totalPriceWei);
      console.log(`Total price for ${ticketQuantity} tickets: ${totalPriceEth} ETH (${totalPriceWei.toString()} wei)`);
      
      const wallet = wallets[0];
      let txHash;
      let receipt;
      
      // Get the specific connected wallet provider from Privy
      try {
        // Try different methods to get a provider based on what's available
        let privyProvider;
        let signer;
        
        if (wallet.getEthersProvider && typeof wallet.getEthersProvider === 'function') {
          // The standard Privy way
          privyProvider = await wallet.getEthersProvider();
          signer = privyProvider.getSigner();
        } else if (window.ethereum) {
          // Fallback to window.ethereum if available (MetaMask and most injected wallets)
          console.log("Using window.ethereum as provider");
          privyProvider = new ethers.providers.Web3Provider(window.ethereum);
          signer = privyProvider.getSigner();
          
          // Verify this signer is connected to the same account
          const signerAddress = await signer.getAddress();
          if (signerAddress.toLowerCase() !== wallet.address.toLowerCase()) {
            console.error(`Signer address ${signerAddress} doesn't match wallet address ${wallet.address}`);
            throw new Error("Wallet address mismatch. Please refresh and try again.");
          }
        } else if (provider) {
          // Last resort - use the currently set provider
          console.log("Using existing provider as fallback");
          privyProvider = provider;
          signer = provider.getSigner();
        } else {
          throw new Error("Could not get a valid provider from wallet");
        }
        
        // Double-check that we're on the right chain
        try {
          const network = await privyProvider.getNetwork();
          console.log(`Provider network chainId: ${network.chainId}, Current UI chainId: ${currentChainId}`);
          
          if (network.chainId !== currentChainId) {
            throw new Error(`Wallet is on chain ${network.chainId} but trying to send transaction to chain ${currentChainId}`);
          }
        } catch (error) {
          console.warn("Could not verify network from provider:", error);
          // Continue anyway since we're already checking the wallet chainId
        }
        
        // Create a contract instance with the correct signer and ADDRESS FOR CURRENT CHAIN
        const contractAddress = usingCustomContractAddress ? 
          customContractAddress : 
          CHAIN_CONFIG[currentChainId].contractAddress;
        
        const contractInstance = new ethers.Contract(
          contractAddress,
          contractABI,
          signer
        );
        
        // Log which contract we're interacting with
        console.log(`Sending transaction to contract on ${CHAIN_CONFIG[currentChainId].name}: ${contractAddress}`);
        
        // Send the transaction with the EXACT total price
        const tx = ticketQuantity === 1
          ? await contractInstance.buyTicket({
              value: totalPriceWei
            })
          : await contractInstance.buyMultipleTickets(ticketQuantity, {
              value: totalPriceWei
            });
        
        txHash = tx.hash;
        toast.info(`Transaction submitted! Hash: ${txHash.slice(0, 6)}...${txHash.slice(-4)}`);
        
        // Wait for transaction confirmation
        receipt = await tx.wait();
        
        // Process receipt for winning
        let winningResult = null;
        const winnerEvent = receipt.events?.find(e => e.event === 'Winner');
        
        if (winnerEvent) {
          const { player, prizeAmount } = winnerEvent.args;
          if (player.toLowerCase() === wallet.address.toLowerCase()) {
            winningResult = {
              won: true,
              amount: ethers.utils.formatEther(prizeAmount),
              winningNumber: numbers[0]
            };
          }
        }
        
        // Update jackpot result
        setJackpotResult(winningResult || { won: false });
      } catch (error) {
        console.error("Error with wallet transaction:", error);
        
        if (error.message && error.message.includes("chain")) {
          toast.error("Network mismatch. Please ensure your wallet is on the same network as selected in the app.");
          setShowJackpotModal(false);
          setIsLoading(false);
          return;
        }
        
        throw error;
      }
      
      // Refresh contract data
      fetchContractData(readOnlyContracts[currentChainId], currentChainId);
      
      // Reset events loaded flag to see new events
      eventsLoaded = false;
      setTimeout(() => {
        loadPastEvents(currentChainId);
      }, 2000);
    } catch (error) {
      console.error("Error buying tickets:", error);
      
      // Close modal on error
      setShowJackpotModal(false);
      
      // Try to extract a more user-friendly error message
      let errorMessage = "Failed to buy tickets. Please try again.";
      if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        if (error.message.includes("insufficient funds")) {
          errorMessage = "Insufficient funds to buy tickets.";
        } else if (error.message.includes("user rejected")) {
          errorMessage = "Transaction rejected.";
        } else if (error.message.includes("cannot estimate gas")) {
          errorMessage = "Cannot estimate gas. The transaction might fail.";
        } else if (error.message.includes("transaction failed")) {
          errorMessage = "Transaction failed. Please try again.";
        } else if (error.message.includes("network") || error.message.includes("chain")) {
          errorMessage = "Network mismatch. Please ensure your wallet is on the same network as selected in the app.";
        }
      }
      
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle quantity change
  const handleQuantityChange = (e) => {
    const value = parseInt(e.target.value);
    if (value >= 1 && value <= 10) {
      setTicketQuantity(value);
    }
  };

  // Format address for display
  const formatAddress = (address) => {
    if (!address) return "None yet";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Refresh data manually with better rate limit handling
  const refreshData = async (action) => {
    console.log(`Refreshing data after admin action: ${action || 'general update'}`);
    
    // If this was a drain operation, immediately set pot to 0 for better UX
    if (action === 'drain') {
      console.log("Drain operation detected - immediately setting pot to 0");
      setPotSize("0");
      toast.success("Jackpot has been drained successfully!");
    } else {
      toast.info("Refreshing contract data...");
    }
    
    try {
      // First update the contract data
      if (usingCustomContractAddress && customContractAddress) {
        console.log(`Refreshing data for custom contract: ${customContractAddress}`);
        await fetchContractData(readOnlyContracts[currentChainId], currentChainId);
      } else {
        console.log(`Refreshing data for default contract: ${CHAIN_CONFIG[currentChainId].contractAddress}`);
        await fetchContractData(readOnlyContracts[currentChainId], currentChainId);
      }
      
      // Then try to update events after a small delay
      setTimeout(async () => {
        try {
          console.log("Refreshing events...");
          const loadFunction = shouldUseFallbackMode ? loadPastEventsSimplified : loadPastEvents;
          await loadFunction(currentChainId);
          console.log("Events refreshed successfully");
        } catch (error) {
          console.error("Error refreshing events:", error);
        }
      }, 2000);
      
      if (!action) { // Only show this toast for general refreshes, not specific actions
        toast.success("Contract data refreshed successfully");
      }
    } catch (error) {
      console.error("Error refreshing data:", error);
      toast.error("Error refreshing data. Please try again.");
    }
  };

  useEffect(() => {
    if (address) {
      if (contract) {
        checkContractOwnership(contract, address);
      } else if (readOnlyContracts[currentChainId]) {
        checkContractOwnership(readOnlyContracts[currentChainId], address);
      }
    } else {
      setIsContractOwner(false);
    }
  }, [contract, address, currentChainId]);

  const checkContractOwnership = async (contractInstance, userAddress) => {
    if (!contractInstance || !userAddress) return false;
    
    try {
      // Get contract owner 
      const ownerAddress = await throttledCall(
        () => contractInstance.owner(),
        currentChainId
      );
      
      // Store the owner address
      setContractOwnerAddress(ownerAddress);
      
      // Check if current user is the owner
      const isOwner = ownerAddress.toLowerCase() === userAddress.toLowerCase();
      setIsContractOwner(isOwner);
      
      return isOwner;
    } catch (error) {
      console.error("Error checking contract ownership:", error);
      setIsContractOwner(false);
      return false;
    }
  };

  const getConnectedSigner = async () => {
    // If we already have a signer, return it
    if (signer) {
      try {
        // Verify signer is connected by getting address
        const signerAddress = await signer.getAddress();
        if (signerAddress.toLowerCase() === address.toLowerCase()) {
          console.log("Using existing signer:", signerAddress);
          return signer;
        }
      } catch (error) {
        console.warn("Existing signer not properly connected:", error);
      }
    }
    
    // Try to get a new signer from connected wallet
    if (authenticated && wallets && wallets.length > 0) {
      const wallet = wallets[0];
      
      try {
        // Try different methods to get a provider based on what's available
        let privyProvider;
        let newSigner;
        
        if (wallet.getEthersProvider && typeof wallet.getEthersProvider === 'function') {
          // Standard Privy method
          privyProvider = await wallet.getEthersProvider();
          newSigner = privyProvider.getSigner();
          console.log("Got signer from wallet.getEthersProvider()");
        } else if (window.ethereum) {
          // Fallback to window.ethereum
          console.log("Getting signer from window.ethereum");
          privyProvider = new ethers.providers.Web3Provider(window.ethereum);
          await privyProvider.send("eth_requestAccounts", []); // Request connection
          newSigner = privyProvider.getSigner();
        } else {
          throw new Error("No provider available to create signer");
        }
        
        // Verify the signer is connected to current user
        const signerAddress = await newSigner.getAddress();
        
        if (signerAddress.toLowerCase() === address.toLowerCase()) {
          console.log("Created new signer successfully:", signerAddress);
          return newSigner;
        } else {
          console.warn(`Signer address mismatch: ${signerAddress} vs wallet ${address}`);
        }
      } catch (error) {
        console.error("Error creating signer:", error);
      }
    }
    
    console.error("Failed to get a valid signer");
    return null;
  };

  useEffect(() => {
    if (authenticated) {
      console.log("Authentication status:", authenticated);
      console.log("Connected wallets:", wallets);
      console.log("Current address:", address);
      
      if (wallets && wallets.length > 0) {
        const wallet = wallets[0];
        console.log("Primary wallet:", wallet);
        console.log("Wallet address:", wallet.address);
        console.log("Wallet chain ID:", wallet.chainId);
        console.log("Wallet client type:", wallet.walletClientType);
        
        if (wallet.getEthersProvider) {
          console.log("Wallet has getEthersProvider method");
          wallet.getEthersProvider().then(provider => {
            console.log("Provider from wallet:", provider);
            provider.getNetwork().then(network => {
              console.log("Network from provider:", network);
            });
          }).catch(error => {
            console.error("Error getting provider from wallet:", error);
          });
        } else {
          console.log("Wallet does not have getEthersProvider method");
        }
      }
    }
  }, [authenticated, wallets, address]);

  return (
    <div className="app-container">
      <ToastContainer position="top-right" autoClose={5000} hideProgressBar={false} />
      
      <header>
        <div className="header-content">
          <h1>EVM Raffle</h1>
          <div className="network-info">
            <NetworkSelector 
              currentChainId={currentChainId}
              networks={CHAIN_CONFIG}
              onNetworkChange={handleNetworkChange}
              authenticated={authenticated}
              wallet={wallets && wallets.length > 0 ? wallets[0] : null}
            />
          </div>
          <div className="connect-button">
            {!authenticated ? (
              <button className="connect-wallet" onClick={login}>
                Connect Wallet
              </button>
            ) : (
              <div className="wallet-info">
                <span className="wallet-address">{formatAddress(address)}</span>
                {walletBalance && (
                  <span className="wallet-balance">{parseFloat(walletBalance).toFixed(4)} ETH</span>
                )}
                <button className="disconnect-wallet" onClick={logout}>
                  Disconnect
                </button>
              </div>
            )}
          </div>
          <div className="admin-actions">
            {isContractOwner && authenticated && (
              <AdminDropdown 
                contractABI={contractABI}
                contractAddress={contractAddress}
                address={address}
                potSize={potSize}
                ticketPrice={contractTicketPrice}
                ticketFeePercentage={ticketFeePercentage}
                jackpotFeePercentage={jackpotFeePercentage}
                feeCollector={feeCollector}
                userFeeCollector={userFeeCollector}
                defaultFeeCollector={defaultFeeCollector}
                winChance={winChance}
                onActionComplete={refreshData}
                wallets={wallets}
              />
            )}
            {authenticated && (
              <button 
                className="create-button" 
                onClick={() => setShowCreateModal(true)}
              >
                Create Raffle
              </button>
            )}
          </div>
        </div>
      </header>
      
      <main>
        <div className="raffle-info">
          <div className="pot-display">
            <h2>Current Jackpot</h2>
            <div className="pot-amount">{potSize} ETH</div>
            
            <div className="ticket-purchase">
              <div className="quantity-selector">
                <label htmlFor="ticketQuantity">Quantity:</label>
                <div className="quantity-control">
                  <button 
                    className="quantity-btn" 
                    onClick={() => ticketQuantity > 1 && setTicketQuantity(ticketQuantity - 1)}
                    disabled={ticketQuantity <= 1}
                  >
                    -
                  </button>
                  <input 
                    id="ticketQuantity" 
                    type="number" 
                    min="1" 
                    max="10" 
                    value={ticketQuantity} 
                    onChange={handleQuantityChange}
                  />
                  <button 
                    className="quantity-btn" 
                    onClick={() => ticketQuantity < 10 && setTicketQuantity(ticketQuantity + 1)}
                    disabled={ticketQuantity >= 10}
                  >
                    +
                  </button>
                </div>
              </div>
              
              <div className="ticket-cost">
                Total: {(parseFloat(formattedTicketPrice) * ticketQuantity).toFixed(6)} ETH
              </div>
            </div>
            
            <button 
              className="buy-ticket" 
              onClick={handleBuyTicket}
              disabled={isLoading}
            >
              {isLoading ? 'Processing...' : `Buy ${ticketQuantity > 1 ? `${ticketQuantity} Tickets` : 'Ticket'}`}
            </button>
            
            <p className="ticket-info">
              Each ticket costs {formattedTicketPrice} ETH with a {ticketFeePercentage}% fee and has a chance to win the entire pot!
              Jackpot winnings have a {jackpotFeePercentage}% fee.
            </p>
            <button className="refresh-button" onClick={refreshData}>
              Refresh Data
            </button>
          </div>
          
          <div className="winner-info">
            <h2>Latest Winner</h2>
            <p><strong>Address:</strong> {lastWinner ? formatAddress(lastWinner) : "No winners yet"}</p>
            <p><strong>Amount Won:</strong> {lastWinAmount} ETH</p>
          </div>
        </div>
        
        <div className="activity-section">
          <h2>Recent Activity</h2>
          <div className="activity-log">
            {activityLog.length === 0 ? (
              <p className="no-activity">No recent activity</p>
            ) : activityLog[0].type === 'loading' ? (
              <p className="loading-activity">Loading recent activity...</p>
            ) : activityLog[0].type === 'empty' ? (
              <p className="no-activity">No recent activity found</p>
            ) : activityLog[0].type === 'error' ? (
              <p className="error-activity">{activityLog[0].message}</p>
            ) : (
              activityLog.map((activity, index) => (
                <div key={index} className={`activity-item ${activity.type}`}>
                  <div className="activity-time">{activity.time}</div>
                  {activity.type === 'ticket' ? (
                    <div className="activity-details">
                      <span className="address">{formatAddress(activity.player)}</span> bought a ticket for {activity.amount} ETH
                      {activity.won && <span className="won-tag">WON!</span>}
                    </div>
                  ) : activity.type === 'multi-ticket' ? (
                    <div className="activity-details">
                      <span className="address">{formatAddress(activity.player)}</span> bought <span className="quantity-tag">{activity.quantity}</span> tickets for {activity.amount} ETH
                    </div>
                  ) : (
                    <div className="activity-details winner">
                      <span className="address">{formatAddress(activity.player)}</span> won {activity.amount} ETH!
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <p className="activity-info">Showing transactions from approximately the last 9 hours.</p>
        </div>
      </main>
      
      <footer>
        <p>Raffle Contract: <a href={`${CHAIN_CONFIG[currentChainId].explorerUrl}/address/${contractAddress}`} target="_blank" rel="noopener noreferrer">{contractAddress}</a></p>
        <p>Network: {networkName}</p>
        <p>Developed by:  <a href="https://heyimsteve.com" target="_blank" rel="noopener noreferrer">Hey! I'm Steve</a>.</p>
      </footer>

      {/* Jackpot Modal */}
      <JackpotModal 
        isOpen={showJackpotModal}
        onClose={() => setShowJackpotModal(false)}
        isLoading={isLoading}
        result={jackpotResult}
        quantity={ticketQuantity}
        ticketNumbers={ticketNumbers}
        winChance={winChance}
      />

      <CreateRaffleModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        authenticated={authenticated}  // Add this prop
        wallets={wallets}              // Add this prop
        provider={provider}
        signer={signer}
        currentChainId={currentChainId}
        onRaffleCreated={handleRaffleCreated}
      />
    </div>
  );
}

export default App;