import React, { useState, useEffect } from 'react';
import './AdminModal.css';

const AdminModal = ({ isOpen, onClose, title, type, content, onAction, isLoading, error: externalError }) => {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');
  
  // Reset form when modal opens or content changes
  useEffect(() => {
    if (isOpen && content) {
      if (content.currentValue) {
        setInputValue(content.currentValue.toString());
      } else {
        setInputValue('');
      }
      setError('');
    }
  }, [isOpen, content]);
  
  // Handle external errors
  useEffect(() => {
    if (externalError) {
      setError(externalError);
    }
  }, [externalError]);
  
  const handleInputChange = (e) => {
    const value = e.target.value;
    setInputValue(value);
    
    // Validate input based on type
    if (type === 'ticketPrice') {
      if (parseFloat(value) <= 0) {
        setError('Ticket price must be greater than 0');
      } else {
        setError('');
      }
    } else if (type === 'ticketFee' || type === 'jackpotFee') {
      const intValue = parseInt(value);
      if (isNaN(intValue) || intValue < 0 || intValue > 30) {
        setError('Fee percentage must be between 0 and 30');
      } else {
        setError('');
      }
    } else if (type === 'feeCollector') {
      if (!value.startsWith('0x') || value.length !== 42) {
        setError('Please enter a valid Ethereum address');
      } else {
        setError('');
      }
    } else if (type === 'winRate') {
      const intValue = parseInt(value);
      if (isNaN(intValue) || intValue < 1) {
        setError('Win rate must be a positive number');
      } else {
        setError('');
      }
    }
  };
  
  const handleSubmit = async () => {
    if (error) return;
    
    // For drain option, no input validation needed
    if (type === 'drain') {
      const success = await onAction(type);
      if (!success && !error) {
        setError('Failed to drain jackpot. Please try again.');
      }
      return;
    }
    
    // Validate input one more time before submitting
    if (!inputValue) {
      setError('This field cannot be empty');
      return;
    }
    
    const success = await onAction(type, inputValue);
    if (!success && !error) {
      setError('Transaction failed. Please try again.');
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="admin-modal-overlay">
      <div className="admin-modal">
        <div className="admin-modal-header">
          <h2>{title}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="admin-modal-content">
          {type === 'drain' ? (
            <div className="confirmation-message">
              <p>{content?.message}</p>
            </div>
          ) : (
            <div className="input-form">
              {content?.currentValue !== undefined && (
                <div className="current-value">
                  <span>Current value: </span>
                  <strong>{content.currentValue}</strong>
                  {(type === 'ticketFee' || type === 'jackpotFee') && '%'}
                  {type === 'ticketPrice' && ' ETH'}
                  {type === 'winRate' && ' (1 in X)'}
                </div>
              )}
              
              {/* Add the fee collector info section here */}
              {type === 'feeCollector' && content?.isSplitter && (
                <div className="fee-collector-info">
                  <p><strong>Current Fee Splitter:</strong> {content.splitterAddress}</p>
                  <p><strong>Your Fee Collector:</strong> {content.currentValue}</p>
                  <p><strong>Platform Fee Collector:</strong> {content.defaultFeeCollector}</p>
                  <p className="info-message">
                    Fees are split 50/50 between your collector and the platform collector
                  </p>
                </div>
              )}
              
              <div className="form-group">
                <label htmlFor="input-value">{content?.label}</label>
                <input
                  id="input-value"
                  type={content?.inputType || 'text'}
                  value={inputValue}
                  onChange={handleInputChange}
                  placeholder={content?.placeholder}
                  min={content?.min}
                  max={content?.max}
                  step={content?.step}
                  disabled={isLoading}
                />
              </div>
              
              {(error || externalError) && (
                <div className="error-message">{error || externalError}</div>
              )}
            </div>
          )}
        </div>
        
        <div className="admin-modal-footer">
          <button 
            className="cancel-button" 
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </button>
          <button 
            className="action-button" 
            onClick={handleSubmit}
            disabled={isLoading || (type !== 'drain' && !!error)}
          >
            {isLoading ? 'Processing...' : (type === 'drain' ? 'Confirm' : 'Update')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminModal;