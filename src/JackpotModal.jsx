import React, { useState, useEffect } from 'react';
import './JackpotModal.css';

const JackpotModal = ({ 
  isOpen, 
  onClose, 
  isLoading, 
  result, 
  quantity, 
  ticketNumbers,
  winChance = 20  // Add default of 20 in case not provided
}) => {
  const [wheelRotation, setWheelRotation] = useState(0);
  const [showResult, setShowResult] = useState(false);
  
  // Calculate win percentage for display
  const winPercentage = winChance ? (100 / winChance).toFixed(2) : 5;
  
  // Reset animation state when modal opens
  useEffect(() => {
    if (isOpen) {
      setWheelRotation(0);
      setShowResult(false);
      
      // Start wheel animation when modal opens
      let startTime;
      let animationId;
      
      const animateWheel = (timestamp) => {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        
        // Spin for 2-3 seconds max
        if (elapsed < 3000 && isLoading) {
          // Accelerate then decelerate spinning
          const speed = elapsed < 1500 ? Math.min(720, elapsed / 2) : Math.max(180, 720 - (elapsed - 1500) / 5);
          setWheelRotation(prev => prev + speed/60);
          animationId = requestAnimationFrame(animateWheel);
        } else if (isLoading) {
          // Keep spinning at constant speed while still loading
          setWheelRotation(prev => prev + 180/60);
          animationId = requestAnimationFrame(animateWheel);
        } else {
          // Transaction complete, show result
          setShowResult(true);
        }
      };
      
      animationId = requestAnimationFrame(animateWheel);
      
      return () => {
        cancelAnimationFrame(animationId);
      };
    }
  }, [isOpen, isLoading]);
  
  if (!isOpen) return null;

  return (
    <div className="jackpot-modal-overlay">
      <div className="jackpot-modal">
        <button className="close-button" onClick={onClose}>×</button>
        
        <div className="modal-content">
          {!showResult ? (
            <>
              <h2>Spinning the Wheel!</h2>
              <p>Testing your luck with {quantity} ticket{quantity > 1 ? 's' : ''}...</p>
              
              <div className="wheel-container">
                <div 
                  className="jackpot-wheel" 
                  style={{ transform: `rotate(${wheelRotation}deg)` }}
                >
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className={`wheel-segment ${i % 2 === 0 ? 'even' : 'odd'}`}>
                      <span>{i * 5}</span>
                    </div>
                  ))}
                </div>
                <div className="wheel-pointer">▼</div>
              </div>
              
              <p className="spinning-text">Transaction in progress...</p>
            </>
          ) : (
            <div className="result-container">
              {result && result.won ? (
                <>
                  <h2 className="win-title">🎉 JACKPOT! 🎉</h2>
                  <div className="confetti-container">
                    {Array.from({ length: 50 }).map((_, i) => (
                      <div 
                        key={i} 
                        className="confetti" 
                        style={{
                          left: `${Math.random() * 100}%`,
                          animationDelay: `${Math.random() * 2}s`,
                          backgroundColor: `hsl(${Math.random() * 360}, 100%, 50%)`
                        }}
                      />
                    ))}
                  </div>
                  <p className="win-text">Congratulations! You won {result.amount} ETH!</p>
                </>
              ) : (
                <>
                  <h2 className="lose-title">Not a winner this time</h2>
                  <p className="lose-text">Better luck next time!</p>
                  
                  <div className="ticket-numbers">
                    <p>Your ticket numbers:</p>
                    <div className="number-grid">
                      {ticketNumbers.map((num, i) => (
                        <div key={i} className="ticket-number">{num}</div>
                      ))}
                    </div>
                    <div className="raffle-explanation">
                      <p>How this raffle works:</p>
                      <ul>
                        <li>Each ticket has a 1-in-{winChance} chance ({winPercentage}%) of winning</li>
                        <li>The blockchain uses secure randomization to determine winners</li>
                        {quantity > 1 && (
                          <li>With {quantity} tickets, your chance was {Math.min(quantity * winPercentage, 100).toFixed(2)}%</li>
                        )}
                      </ul>
                    </div>
                  </div>
                </>
              )}
              
              <button className="play-again-button" onClick={onClose}>
                OK
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default JackpotModal;