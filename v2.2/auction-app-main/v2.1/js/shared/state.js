// js/shared/state.js

export const CONSTANTS = {
    CRORE: 10000000,
    LAKH: 100000,
    ARC_CIRCUMFERENCE: 283, 
};

// Real IPL Bid Brackets Logic
export function getNextBidAmount(currentBidAmount) {
    const bidInLakhs = currentBidAmount / CONSTANTS.LAKH;
    
    if (bidInLakhs < 100) {
        return currentBidAmount + (5 * CONSTANTS.LAKH); // +₹5L up to ₹1Cr
    } else if (bidInLakhs < 200) {
        return currentBidAmount + (10 * CONSTANTS.LAKH); // +₹10L up to ₹2Cr
    } else {
        return currentBidAmount + (20 * CONSTANTS.LAKH); // +₹20L above ₹2Cr
    }
}