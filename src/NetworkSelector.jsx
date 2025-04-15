import React, { useState, useEffect, useRef } from 'react';
import './NetworkSelector.css';

const NetworkSelector = ({ 
  currentChainId,
  networks,
  onNetworkChange,
  authenticated,
  wallet
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  
  // Set up click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Get current network info
  const currentNetwork = networks[currentChainId] || { name: "Unknown Network" };

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  const handleNetworkSelect = async (chainId) => {
    setIsOpen(false);
    
    // Convert to number to ensure proper comparison
    chainId = parseInt(chainId);
    
    if (chainId === currentChainId) return;
    
    // Call the parent component's handler
    onNetworkChange(chainId);
  };

  return (
    <div className="network-selector" ref={dropdownRef}>
      <div 
        className="network-selector__selected"
        onClick={toggleDropdown}
      >
        <span className="network-badge">{currentNetwork.name}</span>
        <span className="dropdown-arrow">{isOpen ? '▲' : '▼'}</span>
      </div>

      {isOpen && (
        <div className="network-selector__dropdown">
          {Object.entries(networks).map(([chainId, network]) => (
            <div
              key={chainId}
              className={`network-option ${parseInt(chainId) === currentChainId ? 'active' : ''}`}
              onClick={() => handleNetworkSelect(chainId)}
            >
              {network.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NetworkSelector;