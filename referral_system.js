// Referral System for IPL playting Bot
// Handles generation and tracking of user referral links

const REFERRAL_REWARD = 5; // Points awarded per successful referral

// Store referrals in memory, will be saved to users.json
let referrals = {}; // userId => [referredUserIds]

// Function to generate a unique referral link for a user
const generateReferralLink = (userId, username) => {
  // Create a promo code based on userId and username
  const promoCode = `${username || 'user'}_${userId}`.replace(/[^\w]/g, '').toLowerCase();
  const botUsername = process.env.BOT_USERNAME || 'ipl_trader_bot';
  
  // Generate Telegram's start parameter link
  console.log(botUsername)
  // https://t.me/your_bot?start=PROMO_CODE
  return `https://t.me/${botUsername}?start=ref_${promoCode}`;
};

// Function to check if a start command contains a referral code
const checkReferralCode = (startPayload) => {
  if (!startPayload || !startPayload.startsWith('ref_')) {
    return null;
  }
  
  // Extract the referrer's info from the promo code
  // Format is ref_username_userId
  try {
    const parts = startPayload.split('_');
    if (parts.length < 3) return null;
    
    // The last part should be the userId
    const referrerId = parts[parts.length - 1];
    return referrerId;
  } catch (error) {
    console.error('Error parsing referral code:', error);
    return null;
  }
};

// Function to add a successful referral and update rewards
const addReferral = (referrerId, newUserId, updateUserPoints) => {
  // Initialize referrals array for this user if needed
  if (!referrals[referrerId]) {
    referrals[referrerId] = [];
  }
  
  // Check if this user was already referred (prevent duplicate rewards)
  if (referrals[referrerId].includes(newUserId)) {
    return false;
  }
  
  // Add the new user to the referrer's list
  referrals[referrerId].push(newUserId);
  
  // Award points to the referrer
  if (typeof updateUserPoints === 'function') {
    updateUserPoints(referrerId, REFERRAL_REWARD);
    return true;
  }
  
  return false;
};

// Function to get referral stats for a user
const getUserReferralStats = (userId) => {
  return {
    totalReferrals: referrals[userId]?.length || 0,
    pointsEarned: (referrals[userId]?.length || 0) * REFERRAL_REWARD,
    referredUsers: referrals[userId] || []
  };
};

// Function to load saved referral data
const loadReferralData = (savedData) => {
  if (savedData && typeof savedData === 'object') {
    referrals = savedData;
  }
};

// Function to get referral data for saving
const getSaveData = () => {
  return referrals;
};

// Export the module functions
module.exports = {
  generateReferralLink,
  checkReferralCode,
  addReferral,
  getUserReferralStats,
  loadReferralData,
  getSaveData,
  REFERRAL_REWARD
};