// Authentication module for IPL play Bot
const fs = require('fs');
const path = require('path');

// Auth status constants
const AUTH_STATUS = {
  NOT_STARTED: 'not_started',
  EMAIL_PENDING: 'email_pending',
  PHONE_PENDING: 'phone_pending',
  COMPLETED: 'completed'
};

// Store user auth state in memory
let authState = {};

/**
 * Initialize the auth module
 * @param {Object} usersData - The loaded users data
 */
const initialize = (usersData) => {
  // Set auth status for existing users
  Object.keys(usersData).forEach(userId => {
    const user = usersData[userId];
    // If user has both email and phone, mark as completed
    if (user.email && user.phone) {
      authState[userId] = AUTH_STATUS.COMPLETED;
    }
    // If missing any required field, set to not started
    else {
      authState[userId] = AUTH_STATUS.NOT_STARTED;
    }
  });
};

/**
 * Validates an email address
 * @param {string} email - The email to validate
 * @returns {boolean} - True if valid, false otherwise
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validates a phone number (10 digits)
 * @param {string} phone - The phone number to validate
 * @returns {boolean} - True if valid, false otherwise
 */
const isValidPhone = (phone) => {
  const phoneRegex = /^\d{10}$/;
  return phoneRegex.test(phone);
};

/**
 * Check if a user is authenticated
 * @param {string} userId - The user ID to check
 * @returns {boolean} - True if authenticated, false otherwise
 */
const isAuthenticated = (userId) => {
  return authState[userId] === AUTH_STATUS.COMPLETED;
};

/**
 * Start the authentication process for a user
 * @param {string} userId - The user ID
 * @param {Object} bot - The Telegram bot instance
 * @param {Object} users - The users object
 */
const startAuthentication = (userId, bot, users) => {
  // Set initial state
  authState[userId] = AUTH_STATUS.EMAIL_PENDING;
  
  // Request email
  bot.sendMessage(
    userId,
    '📧 Please enter your email address:',
    { parse_mode: 'Markdown' }
  );
};

/**
 * Process authentication inputs from users
 * @param {Object} msg - The message object from Telegram
 * @param {Object} bot - The Telegram bot instance
 * @param {Object} users - The users object
 * @param {Function} saveUsers - Function to save user data
 * @returns {boolean} - True if message was processed as auth input, false otherwise
 */
const processAuthInput = (msg, bot, users, saveUsers) => {
  const userId = msg.chat.id;
  const text = msg.text;
  
  // If user is fully authenticated or not in auth process, skip
  if (!authState[userId] || authState[userId] === AUTH_STATUS.COMPLETED) {
    return false;
  }
  
  // Process based on current auth state
  if (authState[userId] === AUTH_STATUS.EMAIL_PENDING) {
    // Validate email
    if (!isValidEmail(text)) {
      bot.sendMessage(
        userId,
        '❌ Invalid email format. Please enter a valid email address:',
        { parse_mode: 'Markdown' }
      );
      return true;
    }
    
    // Save email and ask for phone
    users[userId].email = text;
    authState[userId] = AUTH_STATUS.PHONE_PENDING;
    
    bot.sendMessage(
      userId,
      '✅ Email saved!\n\n📱 Please enter your 10-digit phone number:',
      { parse_mode: 'Markdown' }
    );
    return true;
  }
  
  if (authState[userId] === AUTH_STATUS.PHONE_PENDING) {
    // Validate phone
    if (!isValidPhone(text)) {
      bot.sendMessage(
        userId,
        '❌ Invalid phone number. Please enter a 10-digit phone number:',
        { parse_mode: 'Markdown' }
      );
      return true;
    }
    
    // Save phone and complete auth
    users[userId].phone = text;
    authState[userId] = AUTH_STATUS.COMPLETED;
    saveUsers();
    
    bot.sendMessage(
      userId,
      '✅ Registration complete! You can now use all bot features.',
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'main_menu' }]]
        }
      }
    );
    return true;
  }
  
  return false;
};

/**
 * Checks if user is authenticated and prompts for auth if not
 * @param {number} userId - The user ID to check
 * @param {Object} bot - The Telegram bot instance
 * @param {Object} users - The users object
 * @returns {boolean} - True if authenticated, false otherwise
 */
const checkAndRequireAuth = (userId, bot, users) => {
  // If user is not in auth state array, initialize them
  if (!authState[userId]) {
    if (users[userId] && users[userId].email && users[userId].phone) {
      authState[userId] = AUTH_STATUS.COMPLETED;
    } else {
      authState[userId] = AUTH_STATUS.NOT_STARTED;
    }
  }
  
  // If not completed, start auth process
  if (authState[userId] !== AUTH_STATUS.COMPLETED) {
    bot.sendMessage(
      userId,
      '⚠️ You need to complete registration before using this feature.',
      { parse_mode: 'Markdown' }
    );
    
    // If not started, start it
    if (authState[userId] === AUTH_STATUS.NOT_STARTED) {
      startAuthentication(userId, bot, users);
    }
    
    return false;
  }
  
  return true;
};

module.exports = {
  AUTH_STATUS,
  initialize,
  isAuthenticated,
  startAuthentication,
  processAuthInput,
  checkAndRequireAuth
}; 