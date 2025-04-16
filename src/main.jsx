import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { BrowserRouter, Routes, Route, Navigate, HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import {abstract, abstractTestnet, sepolia} from 'viem/chains';

// Privy configuration
const privyAppId = "cm99ldj3z004pl20myevh3m13";

// Determine if we should use HashRouter based on environment
// HashRouter works better on static hosts like Vercel but has the # in URLs
// Use environment variable to switch between router types
const useHashRouter = import.meta.env.VITE_USE_HASH_ROUTER === 'true';
const Router = useHashRouter ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <PrivyProvider
        appId={privyAppId}
        config={{
          walletList: ['metamask', 'wallet_connect'],
          loginMethods: ['email', 'wallet'],
          appearance: {
            walletChainType: 'ethereum-only',
            theme: 'light',
            accentColor: '#6b46c1',
            logo: 'https://your-logo-url.com/logo.png', // Replace with your logo URL
          },
          embeddedWallets: {
            createOnLogin: 'users-without-wallets',
            noPromptOnSignature: true,
          },
          defaultChain: sepolia,
          supportedChains: [abstract, abstractTestnet, sepolia]
        }}
      >
        <ToastContainer position="top-right" autoClose={5000} hideProgressBar={false} />
        <Routes>
          {/* Default route redirects to the default raffle */}
          <Route exact path="/" element={<App />} />
          
          {/* Network-only route pattern */}
          <Route path="/network/:chainId" element={<App />} />
          
          {/* Route for specific raffle contracts with chain ID */}
          <Route path="/raffle/:chainId/:contractAddress" element={<App />} />
          
          {/* Backward compatibility for the old format */}
          <Route path="/raffle/:contractAddress" element={<App />} />
          
          {/* Catch-all for any other routes */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </PrivyProvider>
    </Router>
  </React.StrictMode>
);