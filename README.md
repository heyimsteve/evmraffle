# EVM Raffle dApp

A decentralized raffle application built on Ethereum and Abstract networks where users can buy tickets for a chance to win the entire jackpot. The application features a continuously rolling pot, where each ticket has a configurable chance to win the growing jackpot. If a player wins, they receive the pot (minus a small fee) and the pot resets.

## 🎮 Features

- **Multi-Network Support**: Works on Sepolia Testnet and Abstract Testnet
- **Connect with Any Wallet**: MetaMask, WalletConnect, or Privy embedded wallets
- **Buy Single or Multiple Tickets**: Purchase up to 10 tickets at once
- **Real-Time Updates**: Activity feed shows recent tickets purchased and winners
- **Customizable Parameters**: Admin can customize ticket price, fees, and win probability
- **Create Your Own Raffle**: Users can deploy their own raffle contracts with custom settings
- **Mobile Friendly**: Responsive design works on all devices

## 📋 Technical Overview

The project consists of:

1. **Smart Contracts**:
   - `RollingRaffle.sol`: Main contract handling ticket purchases, prize calculations, and pseudo-random winning mechanics
   - `RaffleFactory.sol`: Contract factory to create new Rolling Raffle instances with fee splitting
   - `FeeSplitter.sol`: Handles fee distribution between raffle creator and platform

2. **Frontend**:
   - React application with ethers.js for blockchain interaction
   - Privy for user authentication and wallet connection
   - React Router for navigation between different raffles

3. **Deployment Scripts**:
   - Scripts for deploying to Sepolia and Abstract networks
   - Hardhat tasks for contract administration

## 🔧 Smart Contract Architecture

### RollingRaffle Contract

The main raffle contract that:
- Processes ticket purchases
- Contains a pseudo-random win determination mechanism
- Maintains the pot balance
- Distributes fees to the fee collector
- Pays out jackpots to winners
- Allows admin configuration of parameters

Key parameters:
- `ticketPrice`: Cost per ticket in ETH (default: 0.0025 ETH)
- `ticketFeePercentage`: Fee taken from each ticket (default: 10%)
- `jackpotFeePercentage`: Fee taken from jackpot winnings (default: 5%)
- `winChance`: The chance to win (default: 1 in 20, or 5%)

### RaffleFactory Contract

Factory contract that:
- Creates new RollingRaffle contracts
- Sets up fee splitting between the creator and platform
- Tracks all created raffles
- Allows pagination through created raffles

### FeeSplitter Contract

Handles fee distribution:
- Splits fees 50/50 between the raffle creator and the platform
- Automatically distributes ETH when received

## 🚀 Getting Started

### Prerequisites

- Node.js (v16+)
- Yarn or npm
- Git

### Installation

1. Clone the repository:
```bash
git clone https://github.com/heyimsteve/evmraffle.git
cd evmraffle
```

2. Install dependencies:
```bash
npm install --legacy-peer-deps
# or
yarn
```

3. Create a `.env` file in the root directory with the following variables:
```
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
PRIVATE_KEY=your_wallet_private_key
ETHERSCAN_API_KEY=your_etherscan_api_key
VITE_INFURA_ID=your_infura_id
```

### Local Development

1. Start the development server:
```bash
npm run dev
# or
yarn dev
```

2. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Smart Contract Development

1. Compile contracts:
```bash
npx hardhat compile
```

2. Run tests:
```bash
npx hardhat test
```

3. Deploy to Sepolia testnet:
```bash
npx hardhat run scripts/deploy.js --network sepolia
# or 
npm run deploy:sepolia
```

4. Deploy to Abstract testnet:
```bash
npx hardhat run scripts/deploy-abstract.js --network abstractTestnet
# or
npm run deploy:abstract
```

5. Deploy a Factory contract:
```bash
npx hardhat run scripts/deploy-factory.js --network sepolia
```

## 🧰 Contract Management

The project includes Hardhat tasks for managing deployed contracts:

```bash
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
```

## 📱 Using the dApp

### Connecting Your Wallet

1. Click "Connect Wallet" to connect using MetaMask, WalletConnect, or a Privy embedded wallet.
2. Select the network you wish to use (Sepolia or Abstract Testnet).

### Buying Tickets

1. Select the quantity of tickets you want to purchase (1-10).
2. Click "Buy Ticket" or "Buy X Tickets".
3. Confirm the transaction in your wallet.
4. A jackpot wheel animation will show while the transaction is processing.
5. You'll be notified if you won the jackpot!

### Creating Your Own Raffle

1. Connect your wallet.
2. Click "Create Raffle" button.
3. Configure your raffle parameters:
   - Ticket Price
   - Ticket Fee Percentage
   - Jackpot Fee Percentage
   - Win Chance (1 in X)
   - Fee Collector Address (optional)
4. Deploy the contract by clicking "Deploy Raffle Contract".
5. Once deployed, you'll be redirected to your new raffle.

### Admin Functions

If you're the owner of a raffle contract, you'll see an Admin dropdown with options to:

- Drain Jackpot (withdraw funds to owner)
- Update Ticket Price
- Update Ticket Fee
- Update Jackpot Fee
- Update Fee Collector Address
- Update Win Rate

## 📋 Project Structure

```
rolling-raffle-dapp/
├── contracts/               # Smart contract source files
│   ├── RollingRaffle.sol    # Main raffle contract
│   └── RaffleFactory.sol    # Factory contract for creating raffles
├── scripts/                 # Deployment scripts
│   ├── deploy.js            # Deploy RollingRaffle to Sepolia
│   ├── deploy-abstract.js   # Deploy to Abstract network
│   └── deploy-factory.js    # Deploy factory contract
├── tasks/                   # Hardhat tasks
│   └── raffle-tasks.js      # Tasks for managing raffles
├── src/                     # Frontend React application
│   ├── App.jsx              # Main application component
│   ├── components/          # UI components
│   └── contracts/           # Compiled contract ABIs
├── hardhat.config.cjs       # Hardhat configuration
└── vite.config.js           # Vite configuration
```

## ⚙️ Configuration

### Contract Addresses

Default contract addresses are configured in `src/App.jsx`:

```javascript
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
```

Factory contract addresses are in `src/CreateRaffleModal.jsx`:

```javascript
const FACTORY_CONFIG = {
  // Sepolia
  11155111: {
    address: "0x77A2624a746A97fA900c1C1C744e458d1Cd6bdBF",
    name: "Sepolia Testnet",
    explorerUrl: "https://sepolia.etherscan.io"
  },
  // Abstract Testnet
  11124: {
    address: "0xe986d9beb28019f70f80390665D952a450597Ec0",
    name: "Abstract Testnet",
    explorerUrl: "https://sepolia.abscan.org"
  }
};
```

### Privy Authentication

Privy authentication is configured in `src/main.jsx`:

```javascript
const privyAppId = "cm99ldj3z004pl20myevh3m13";
```

## ⚠️ Known Issues and Limitations

- **Pseudo-random Number Generation**: The contract uses block data for randomness, which is not cryptographically secure. In a production environment, it would be better to use Chainlink VRF.
- **Rate Limiting**: The frontend includes extensive handling for RPC rate limiting, but you may still encounter issues if interacting too frequently.
- **Gas Optimization**: The contracts could be further optimized for gas usage, especially for multi-ticket purchases.

## 🛣️ Roadmap

- [ ] Add Chainlink VRF integration for truly random number generation
- [ ] Add time-based jackpot bonuses
- [ ] Implement additional networks (Ethereum Mainnet, Arbitrum, etc.)
- [ ] Create raffle templates with predefined settings
- [ ] Add social features (leaderboards, sharing, etc.)

## 👥 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgements

- [OpenZeppelin](https://openzeppelin.com/) for secure contract libraries
- [Hardhat](https://hardhat.org/) for Ethereum development environment
- [Ethers.js](https://docs.ethers.io/) for blockchain interaction
- [Privy](https://privy.io/) for authentication system
- [React](https://reactjs.org/) for the frontend framework
- [Abstract](https://abstract.money/) for the L2 network support