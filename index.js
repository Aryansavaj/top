// IPL playing Telegram Bot (Points-based) in Node.js

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const matchplaying = require('./match_playing'); // Import match playing module
const referralSystem = require('./referral_system'); // Import referral system module
const auth = require('./auth'); // Import the authentication module

const TOKEN = '7683733389:AAGQDejl0SWQwOWgYYQnGpcAy4xs6JDVZjk';
const bot = new TelegramBot(TOKEN, { 
  polling: {
    interval: 300, // Check for updates every 300ms
    params: {
      timeout: 10 // Long polling timeout in seconds
    },
    autoStart: true
  }
});

// Set bot username for referral links
process.env.BOT_USERNAME = 'ipl_trader_bot'; // Replace with your actual bot username

// Add error handling for polling errors
bot.on('polling_error', (error) => {
  // Log the error but avoid flooding the console with the same errors repeatedly
  const errorMsg = error.code || error.message || error;
  
  // Safely handle name-related errors
  if (errorMsg.includes("Cannot read properties of undefined (reading 'name')")) {
    console.error('Polling error: User data missing or incomplete');
  } else {
    console.error('Polling error:', errorMsg);
  }
  
  // Try to restart polling after a short delay
  setTimeout(() => {
    try {
      if (!bot.isPolling()) {
        console.log('Attempting to restart polling...');
        bot.startPolling();
      }
    } catch (e) {
      console.error('Failed to restart polling:', e);
    }
  }, 5000);
});

let users = {}; // userId => { name, username, points, etc. }
let activeOvers = {}; // overNumber => true/false (playing status)
let overplays = {}; // overNumber => { userId: [playInfo1, playInfo2, ...] } (allows multiple plays per user)
let overRunResult = {}; // overNumber => actualRuns

// Add a variable to track the last time we logged a save
let lastSaveLog = 0;

// Update the playing model to over/under format
let playTypes = {
  OVER: 'over',
  UNDER: 'under'
};

// Add odds tracking
const INITIAL_ODDS = 1.9; // Starting odds for both over and under (90% payout)
const HOUSE_EDGE = 0.9; // 10% profit margin
let overUnderStats = {}; // overNumber => { overOdds, underOdds, overAmount, underAmount }

// Helper function to update user points
const updateUserPoints = (userId, amount) => {
  if (!users[userId]) {
    users[userId] = { points: INITIAL_POINTS, plays: [] };
  }
  users[userId].points += amount;
  saveData();
};

const placeplay = (userId, overNumber, playType, amount) => {
  try {
    // Initialize user if they don't exist
    if (!users[userId]) {
      users[userId] = { 
        userId: userId, 
        points: INITIAL_POINTS, 
        plays: [],
        name: "New User",
        joined: new Date().toISOString()
      };
    }
    
    // Ensure plays array exists
    if (!users[userId].plays) {
      users[userId].plays = [];
    }
    
    // Check if user has enough points
    if (users[userId].points < amount) {
      bot.sendMessage(userId, '❌ You don\'t have enough points for this play.');
      return false;
    }
    
    // Initialize overUnderStats for this over if it doesn't exist
    if (!overUnderStats[overNumber]) {
      overUnderStats[overNumber] = {
        overOdds: INITIAL_ODDS,
        underOdds: INITIAL_ODDS,
        overAmount: 0,
        underAmount: 0
      };
    }
    
    // Get current odds for the play type
    const odds = playType === playTypes.OVER 
      ? overUnderStats[overNumber].overOdds 
      : overUnderStats[overNumber].underOdds;
    
    // Deduct points from user
    users[userId].points -= amount;
    
    // Record the play
    const play = {
      overNumber,
      playType,
      amount,
      odds,
      timestamp: Date.now(),
      potentialWin: Math.floor(amount * odds)
    };
    
    // Add play to user's history
    users[userId].plays.push(play);
    
    // Update the over/under stats
    if (playType === playTypes.OVER) {
      overUnderStats[overNumber].overAmount += amount;
    } else {
      overUnderStats[overNumber].underAmount += amount;
    }
    
    // Recalculate odds based on new amounts
    updateOddsForOver(overNumber);
    
    // Save data
    saveData();
    
    return true;
  } catch (error) {
    console.error('Error in placeplay:', error);
    // Try to send an error message to the user
    try {
      bot.sendMessage(userId, '❌ An error occurred while placing your play. Please try again.');
    } catch (err) {
      console.error('Failed to send error message:', err);
    }
    return false;
  }
};

const updateOddsForOver = (overNumber) => {
  if (!overUnderStats[overNumber]) {
    overUnderStats[overNumber] = {
      overOdds: INITIAL_ODDS,
      underOdds: INITIAL_ODDS,
      overAmount: 0,
      underAmount: 0
    };
    return;
  }
  
  const stats = overUnderStats[overNumber];
  const totalAmount = stats.overAmount + stats.underAmount;
  
  // If no bets placed yet, keep initial odds
  if (totalAmount === 0) {
    stats.overOdds = INITIAL_ODDS;
    stats.underOdds = INITIAL_ODDS;
    return;
  }
  
  // Calculate proportions of bets on each side
  const overProportion = stats.overAmount / totalAmount;
  const underProportion = stats.underAmount / totalAmount;
  
  // Constants for odds calculation
  const MIN_ODDS = 1.05;  // Minimum odds possible
  const MAX_ODDS = 3.0;   // Maximum odds for balanced betting
  const BASE_ODDS = 1.90; // Base odds for balanced betting
  const HOUSE_EDGE = 0.05; // 5% house edge
  
  // Default odds when betting is balanced (close to 50/50)
  let overOdds = BASE_ODDS;
  let underOdds = BASE_ODDS;
  
  // Calculate odds based on betting imbalance
  if (stats.overAmount > 0 && stats.underAmount > 0) {
    // Both sides have bets - calculate based on proportions
    overOdds = (1 / overProportion) * (1 - HOUSE_EDGE);
    underOdds = (1 / underProportion) * (1 - HOUSE_EDGE);
  } else if (stats.overAmount > 0 && stats.underAmount === 0) {
    // Only over bets - set fixed odds per requirements
    overOdds = 1.85;
    underOdds = 1.95;
  } else if (stats.underAmount > 0 && stats.overAmount === 0) {
    // Only under bets - set fixed odds per requirements
    overOdds = 1.95;
    underOdds = 1.85;
  }
  
  // Apply min/max constraints and round to 2 decimal places
  stats.overOdds = Math.min(MAX_ODDS, Math.max(MIN_ODDS, Math.round(overOdds * 100) / 100));
  stats.underOdds = Math.min(MAX_ODDS, Math.max(MIN_ODDS, Math.round(underOdds * 100) / 100));
  
  // Save the updated odds
  saveData();
};

const saveData = () => {
  try {
    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
    
    // Get match playing data
    const matchplayingData = matchplaying.getSaveData();
    
    // Get referral data
    const referralData = referralSystem.getSaveData();
    
    fs.writeFileSync('game_state.json', JSON.stringify({ 
      activeOvers, 
      overplays, 
      overRunResult,
      overUnderStats,
      matchplaying: matchplayingData, // Save match playing data
      referrals: referralData // Save referral data
    }, null, 2));
    
    // Only log save messages every 30 seconds to reduce spam
    const now = Date.now();
    if (now - lastSaveLog > 30000) {
      console.log('Data saved successfully');
      lastSaveLog = now;
    }
  } catch (error) {
    console.error('Error saving data:', error);
  }
};

const loadData = () => {
  try {
    if (fs.existsSync('users.json')) {
      const usersData = fs.readFileSync('users.json', 'utf8');
      if (usersData && usersData.trim()) {
        users = JSON.parse(usersData);
      }
    }
    
    if (fs.existsSync('game_state.json')) {
      const gameStateData = fs.readFileSync('game_state.json', 'utf8');
      if (gameStateData && gameStateData.trim()) {
        const gameState = JSON.parse(gameStateData);
        activeOvers = gameState.activeOvers || {};
        overplays = gameState.overplays || {};
        overRunResult = gameState.overRunResult || {};
        overUnderStats = gameState.overUnderStats || {};
        
        // Load match playing data if available
        if (gameState.matchplaying) {
          matchplaying.loadSavedData(gameState.matchplaying);
        }
        
        // Load referral data if available
        if (gameState.referrals) {
          referralSystem.loadReferralData(gameState.referrals);
        }
      }
    }

    // Initialize the auth module with loaded user data
    auth.initialize(users);
    
  } catch (error) {
    console.error('Error loading data:', error);
    // Initialize with empty objects if files can't be loaded
    users = {};
    activeOvers = {};
    overplays = {};
    overRunResult = {};
    overUnderStats = {};
    // Create backup of corrupted files if they exist
    if (fs.existsSync('users.json')) {
      fs.copyFileSync('users.json', `users.json.backup-${Date.now()}`);
    }
    if (fs.existsSync('game_state.json')) {
      fs.copyFileSync('game_state.json', `game_state.json.backup-${Date.now()}`);
    }
  }
};

// Add an initialization function to create default files if needed
const initializeFiles = () => {
  // Create default users.json if it doesn't exist
  if (!fs.existsSync('users.json')) {
    fs.writeFileSync('users.json', JSON.stringify({}, null, 2));
    console.log('Created new users.json file');
  }
  
  // Create default game_state.json if it doesn't exist
  if (!fs.existsSync('game_state.json')) {
    const defaultGameState = {
      activeOvers: {},
      overplays: {},
      overRunResult: {},
      overUnderStats: {}
    };
    fs.writeFileSync('game_state.json', JSON.stringify(defaultGameState, null, 2));
    console.log('Created new game_state.json file');
  }
};

// Call initialization at startup
initializeFiles();

// Then call loadData after initialization
loadData();

const adminId = '5363228907'; // Your Telegram ID to control playing

// --- Helper Functions ---
const isAdmin = (userId) => userId.toString() === adminId;

const createMainMenu = (chatId) => {
  const isRegistered = users[chatId];
  const keyboard = {
    inline_keyboard: [
      [{ text: '🎲 Place plays (Over/Under)', callback_data: 'list_overs' }],
      [{ text: '⚽ Match Winner plays', callback_data: 'list_matches' }],
      [{ text: '💰 My Points', callback_data: 'my_points' }],
      [{ text: '💵 Add/Withdraw Points', callback_data: 'add_withdraw_points' }],
      [{ text: '📊 Leaderboard', callback_data: 'leaderboard' }],
      [{ text: '🔗 Invite Friends & Earn', callback_data: 'referral_link' }]
    ]
  };
  
  if (isAdmin(chatId)) {
    keyboard.inline_keyboard.push(
      [{ text: '🟢 Open playing', callback_data: 'admin_open' }],
      [{ text: '🔴 Close playing', callback_data: 'admin_close' }],
      [{ text: '📢 Announce Result', callback_data: 'admin_result' }],
      [{ text: '🏏 Manage Match plays', callback_data: 'admin_match' }]
    );
  }
  
  return keyboard;
};

const getActiveOversKeyboard = () => {
  const keyboard = [];
  
  // Group active overs in rows of 4 for playter display
  const activeOversArray = Object.keys(activeOvers)
    .filter(over => activeOvers[over])
    .sort((a, b) => parseInt(a) - parseInt(b));
  
  for (let i = 0; i < activeOversArray.length; i += 4) {
    const row = [];
    for (let j = 0; j < 4 && i + j < activeOversArray.length; j++) {
      const over = activeOversArray[i + j];
      row.push({ text: `Over ${over}`, callback_data: `play_over_${over}` });
    }
    keyboard.push(row);
  }
  
  keyboard.push([{ text: '⬅️ Back to Menu', callback_data: 'main_menu' }]);
  
  return { inline_keyboard: keyboard };
};

const getActiveOversWithOddsKeyboard = () => {
  const keyboard = [];
  
  // Group active overs in rows of 2 (since each item is wider with odds)
  const activeOversArray = Object.keys(activeOvers)
    .filter(over => activeOvers[over])
    .sort((a, b) => parseInt(a) - parseInt(b));
  
  for (let i = 0; i < activeOversArray.length; i += 2) {
    const row = [];
    for (let j = 0; j < 2 && i + j < activeOversArray.length; j++) {
      const over = activeOversArray[i + j];
      
      // Initialize odds if not set yet
      if (!overUnderStats[over]) {
        overUnderStats[over] = {
          overOdds: INITIAL_ODDS,
          underOdds: INITIAL_ODDS,
          overAmount: 0,
          underAmount: 0
        };
      }
      
      const stats = overUnderStats[over];
      const volume = stats.overAmount + stats.underAmount;
      
      // Display over number with odds and volume indicator
      row.push({ 
        text: `Over ${over} (${stats.overOdds.toFixed(2)}x | ${stats.underOdds.toFixed(2)}x)`, 
        callback_data: `select_over_${over}` 
      });
    }
    keyboard.push(row);
  }
  
  keyboard.push([{ text: '⬅️ Back to Menu', callback_data: 'main_menu' }]);
  
  return { inline_keyboard: keyboard };
};

const getplayAmountKeyboard = (overNumber) => ({
  inline_keyboard: [
    [
      { text: '10 pts', callback_data: `amount_10_${overNumber}` },
      { text: '20 pts', callback_data: `amount_20_${overNumber}` },
      { text: '50 pts', callback_data: `amount_50_${overNumber}` }
    ],
    [{ text: '⬅️ Back', callback_data: 'list_overs' }]
  ]
});

// Reset the getQuickplayKeyboard to use over/under playing instead of run predictions
const getQuickplayKeyboard = (overNumber) => {
  // Get current odds for this over
  if (!overUnderStats[overNumber]) {
    overUnderStats[overNumber] = {
      overOdds: INITIAL_ODDS,
      underOdds: INITIAL_ODDS,
      overAmount: 0,
      underAmount: 0
    };
  }
  
  const stats = overUnderStats[overNumber];
  
  const keyboard = {
    inline_keyboard: [
      [
        { 
          text: `OVER 8.5 (${stats.overOdds.toFixed(2)}x)`, 
          callback_data: `play_over_${overNumber}` 
        },
        { 
          text: `UNDER 8.5 (${stats.underOdds.toFixed(2)}x)`, 
          callback_data: `play_under_${overNumber}` 
        }
      ],
      [
        { text: '10 pts', callback_data: `amount_10_${overNumber}` },
        { text: '20 pts', callback_data: `amount_20_${overNumber}` },
        { text: '50 pts', callback_data: `amount_50_${overNumber}` }
      ],
      [
        { text: 'Custom Amount', callback_data: `custom_amount_${overNumber}` }
      ],
      [
        { text: '🔄 Refresh Odds', callback_data: `refresh_odds_${overNumber}` }
      ],
      [
        { text: '⬅️ Back to Overs', callback_data: 'list_overs' }
      ]
    ]
  };
  
  return keyboard;
};

const getTop3Users = () => {
  return Object.entries(users)
    .filter(([, user]) => user.userId != adminId)
    .sort(([, a], [, b]) => b.points - a.points)
    .slice(0, 3)
    .map(([userId, user], index) => {
      const medals = ['🥇', '🥈', '🥉'];
      return `${medals[index]} ${user.name} (${user.username || 'N/A'}): ${user.points} pts`;
    })
    .join('\n');
};

const sendNotificationToAllUsers = (message) => {
  Object.keys(users).forEach(userId => {
    bot.sendMessage(userId, message).catch(err => console.error(`Failed to send message to ${userId}:`, err));
  });
};

// --- Registration ---
const states = {}; // userId => registration step

bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const startPayload = match && match[1] ? match[1].trim() : null;
  console.log(startPayload, chatId);
  // Process referral if present
  let referrerId = null;
  if (startPayload) {
    referrerId = referralSystem.checkReferralCode(startPayload);
  }
  
  if (users[chatId]) {
    // Welcome back message
    bot.sendMessage(
      chatId, 
      `Welcome back ${users[chatId].name}! Your points: ${users[chatId].points}`,
      { reply_markup: createMainMenu(chatId) }
    );
    
    // If authentication not complete, prompt to complete it
    if (!auth.isAuthenticated(chatId)) {
      setTimeout(() => {
        auth.startAuthentication(chatId, bot, users);
      }, 1000); // Small delay for better user experience
    }
    
    return;
  }
  
  states[chatId] = 'askName';
  users[chatId] = {
    userId: chatId,
    username: msg.from.username || 'Unknown',
    joined: new Date().toISOString(),
    referredBy: referrerId, // Store who referred this user
    plays: [], // Initialize empty plays array
    points: 20 // Initial points
  };
  
  bot.sendMessage(chatId, '👋 Welcome to IPL play Bot!\nEnter your name to register:');
});

// Add after the /start command handler
bot.onText(/\/menu/, (msg) => {
  const chatId = msg.chat.id;
  if (!users[chatId]) return bot.sendMessage(chatId, '⚠️ Please /start to register first.');
  
  // Check if user is authenticated before allowing access
  if (!auth.checkAndRequireAuth(chatId, bot, users)) return;
  
  bot.sendMessage(
    chatId, 
    `🏏 *IPL playing Menu*\nHello ${users[chatId].name}! What would you like to do?`,
    {
      parse_mode: 'Markdown',
      reply_markup: createMainMenu(chatId)
    }
  );
});

// Handle all messages
bot.on('message', (msg) => {
  try {
    const chatId = msg.chat.id;
    const step = states[chatId];
    
    // First, try to process as authentication input
    if (auth.processAuthInput(msg, bot, users, saveData)) {
      return; // If processed as auth input, don't continue
    }
    
    // If there's no state, ignore the message
    if (!step) return;
    
    const text = msg.text.trim();
    
    // Process other states as before
    if (step === 'askName') {
      users[chatId].name = text;
      // Start the auth process using our auth module
      auth.startAuthentication(chatId, bot, users);
    } else if (step === 'admin_close_over') {
      const overNumber = parseInt(text);
      if (isNaN(overNumber) || overNumber < 1 || overNumber > 20) {
        return bot.sendMessage(chatId, '❌ Please enter a valid over number (1-20).');
      }
      
      if (!activeOvers[overNumber]) {
        return bot.sendMessage(chatId, `❌ Over ${overNumber} is not active or already closed.`);
      }
      
      activeOvers[overNumber] = false;
      saveData();
      
      const message = `🔴 playing closed for Over ${overNumber}! Awaiting result.`;
      bot.sendMessage(chatId, message);
      sendNotificationToAllUsers(message);
      delete states[chatId];
    } else if (step === 'waiting_over_number') {
      const overNumber = parseInt(text);
      if (isNaN(overNumber)) {
        return bot.sendMessage(chatId, '❌ Please enter a valid over number.');
      }
      
      states[chatId] = 'waiting_result';
      states[`${chatId}_over`] = overNumber;
      
      bot.sendMessage(chatId, `Enter the result runs for over ${overNumber}:`);
    } else if (step === 'waiting_result') {
      const runs = parseInt(text);
      if (isNaN(runs)) {
        return bot.sendMessage(chatId, '❌ Please enter a valid run count.');
      }
      
      const overNumber = states[`${chatId}_over`];
      delete states[chatId];
      delete states[`${chatId}_over`];
      
      processResult(chatId, overNumber, runs);
    } else if (step === 'waiting_amount') {
      const amount = parseInt(text);
      const overNumber = states[`${chatId}_over`];
      const playType = states[`${chatId}_playType`];
      
      if (isNaN(amount) || amount <= 0) {
        return bot.sendMessage(chatId, '❌ Please enter a valid play amount (positive number).');
      }
      
      // Place the play with the custom amount
      placeplay(chatId, overNumber, playType, amount);
      
      // Clean up states
      delete states[chatId];
      delete states[`${chatId}_over`];
      delete states[`${chatId}_playType`];
      
      bot.sendMessage(
        chatId,
        `✅ play placed successfully!`,
        { reply_markup: createMainMenu(chatId) }
      );
    } else if (step === 'waiting_broadcast') {
      // Verify the user is still an admin
      if (!isAdmin(chatId)) {
        delete states[chatId];
        return bot.sendMessage(chatId, '❌ This command is only available to admins.');
      }
      
      // Send the broadcast message to all users
      const broadcastMessage = `📣 *ADMIN ANNOUNCEMENT*\n\n${text}`;
      
      // First confirm to the admin
      bot.sendMessage(
        chatId,
        `✅ Broadcast message sent to all users:\n\n${broadcastMessage}`,
        { 
          parse_mode: 'Markdown',
          reply_markup: createMainMenu(chatId) 
        }
      );
      
      // Then send to all users
      sendNotificationToAllUsers(broadcastMessage);
      
      // Clean up state
      delete states[chatId];
    } else if (step.startsWith('playing_')) {
      const parts = step.split('_');
      const overNumber = parts[1];
      const playAmount = parseInt(parts[2]);
      const runs = parseInt(text);
      
      if (isNaN(runs) || runs < 0) {
        return bot.sendMessage(chatId, '❌ Please enter a valid run prediction (0 or higher).');
      }
      
      placeplay(chatId, overNumber, runs, playAmount);
      delete states[chatId];
    } else if (step === 'waiting_match_amount') {
      const amount = parseInt(text);
      const matchId = states[`${chatId}_match`];
      const teamplay = states[`${chatId}_teamplay`];
      
      if (isNaN(amount) || amount <= 0) {
        return bot.sendMessage(chatId, '❌ Please enter a valid play amount (positive number).');
      }
      
      // Place the play with the custom amount
      const result = matchplaying.placeTeamplay(
        chatId, 
        matchId, 
        teamplay, 
        amount, 
        users[chatId].points, 
        updateUserPoints
      );
      
      // Clean up temporary states
      delete states[chatId];
      delete states[`${chatId}_match`];
      delete states[`${chatId}_teamplay`];
      
      if (!result.success) {
        return bot.sendMessage(chatId, `❌ ${result.message}`, {
          reply_markup: createMainMenu(chatId)
        });
      }
      
      // Save data
      saveData();
      
      bot.sendMessage(
        chatId,
        `✅ *play Placed Successfully*\n\n` +
        `Match: ${result.playInfo.teamplay}\n` +
        `Amount: ${result.playInfo.amount} points\n` +
        `Odds: ${result.playInfo.odds.toFixed(2)}x\n` +
        `Potential Win: ${result.playInfo.potential} points`,
        {
          parse_mode: 'Markdown',
          reply_markup: createMainMenu(chatId)
        }
      );
    } else if (data.startsWith('play_over_')) {
      // When user selects a play type, clear the viewing_odds state
      if (states[chatId] === 'viewing_odds') {
        delete states[chatId];
      }
      
      const overNumber = data.split('_')[2];
      
      // Store the play type and wait for amount
      states[`${chatId}_playType`] = playTypes.OVER;
      states[`${chatId}_over`] = overNumber;
      
      bot.editMessageText(
        `🎯 *OVER 8.5 for Over ${overNumber}*\n\n` +
        `Current Odds: ${overUnderStats[overNumber]?.overOdds.toFixed(2)}x\n\n` +
        `Select play amount:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getplayAmountKeyboard(overNumber)
        }
      );
    } else if (data.startsWith('play_under_')) {
      // When user selects a play type, clear the viewing_odds state
      if (states[chatId] === 'viewing_odds') {
        delete states[chatId];
      }
      
      const overNumber = data.split('_')[2];
      
      // Store the play type and wait for amount
      states[`${chatId}_playType`] = playTypes.UNDER;
      states[`${chatId}_over`] = overNumber;
      
      bot.editMessageText(
        `🎯 *UNDER 8.5 for Over ${overNumber}*\n\n` +
        `Current Odds: ${overUnderStats[overNumber]?.underOdds.toFixed(2)}x\n\n` +
        `Select play amount:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getplayAmountKeyboard(overNumber)
        }
      );
    } else if (data.startsWith('amount_')) {
      const parts = data.split('_');
      const amount = parseInt(parts[1]);
      const overNumber = parts[2];
      const playType = states[`${chatId}_playType`];
      
      if (!playType) {
        return bot.editMessageText(
          '❌ Please select a play type first (OVER or UNDER).',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `select_over_${overNumber}` }]] }
          }
        );
      }
      
      // Place the play with the selected amount
      placeplay(chatId, overNumber, playType, amount);
      
      // Clean up temporary states
      delete states[`${chatId}_playType`];
      delete states[`${chatId}_over`];
      delete states[`${chatId}_amount`];
      
      // Make sure overUnderStats exists for this over
      if (!overUnderStats[overNumber]) {
        overUnderStats[overNumber] = {
          overOdds: INITIAL_ODDS,
          underOdds: INITIAL_ODDS,
          overAmount: 0,
          underAmount: 0
        };
      }
      
      const currentOdds = (playType === playTypes.OVER 
        ? overUnderStats[overNumber]?.overOdds 
        : overUnderStats[overNumber]?.underOdds) || INITIAL_ODDS;
      
      bot.editMessageText(
        `✅ *play Placed Successfully*\n\n` +
        `Over: ${overNumber}\n` +
        `Type: ${playType === playTypes.OVER ? 'OVER 8.5' : 'UNDER 8.5'}\n` +
        `Amount: ${amount} points\n` +
        `Odds: ${currentOdds.toFixed(2)}x`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎯 Place Another play', callback_data: 'list_overs' }],
              [{ text: '📊 My Points', callback_data: 'my_points' }],
              [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
            ]
          }
        }
      );
    } else if (data.startsWith('custom_amount_')) {
      const overNumber = data.split('_')[2];
      const playType = states[`${chatId}_playType`];
      
      if (!playType) {
        return bot.editMessageText(
          '❌ Please select a play type first (OVER or UNDER).',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `select_over_${overNumber}` }]] }
          }
        );
      }
      
      bot.editMessageText(
        `💰 *Custom play Amount*\n\n` +
        `Over: ${overNumber}\n` +
        `Type: ${playType === playTypes.OVER ? 'OVER 8.5' : 'UNDER 8.5'}\n` +
        `Odds: ${(playType === playTypes.OVER ? overUnderStats[overNumber]?.overOdds : overUnderStats[overNumber]?.underOdds).toFixed(2)}x\n\n` +
        `Please type the amount you want to play:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '⬅️ Back', callback_data: `select_over_${overNumber}` }]]
          }
        }
      );
      
      // Set the state to wait for custom amount
      states[chatId] = `waiting_amount`;
    } else if (data === 'my_points') {
      const user = users[chatId];
      bot.editMessageText(
        `💰 *Your Profile*\n\n` +
        `Name: ${user.name}\n` +
        `Username: @${user.username || 'N/A'}\n` +
        `Email: ${user.email || 'Not provided'}\n` +
        `Phone: ${user.phone || 'Not provided'}\n` +
        `Points: ${user.points}\n\n` +
        `Place plays to win more points!`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
        }
      );
    } else if (data === 'leaderboard') {
      const top10 = Object.entries(users)
        .sort(([, a], [, b]) => b.points - a.points)
        .filter(([, user]) => user.userId != adminId)
        .slice(0, 10)
        .map(([, user], index) => `${index + 1}. ${user.name}: ${user.points} pts`)
        .join('\n');
      
      bot.editMessageText(
        `📊 *Leaderboard - Top 10*\n\n${top10}`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data === 'add_withdraw_points') {
      bot.editMessageText(
        `💵 *Add or Withdraw Points*\n\n` +
        `To add or withdraw points, please share your points amount to:\n\n` +
        `@letsgoo234\n\n` +
        `Current balance: ${users[chatId].points} points`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data === 'referral_link') {
      const username = users[chatId].username || query.from.username || null;
      const referralLink = referralSystem.generateReferralLink(chatId, username);
      const stats = referralSystem.getUserReferralStats(chatId);
      
      bot.editMessageText(
        `🔗 Your Referral Link\n\n` +
        `Share this link with friends to earn ${referralSystem.REFERRAL_REWARD} points for each new user who joins!\n\n` +
        `${referralLink}\n\n` +
        `👥 Your referrals: ${stats.totalReferrals}\n` +
        `💰 Points earned: ${stats.pointsEarned}`,
        { 
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: '📤 Share Link', url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join IPL play Bot and get 20 points to start playing!')}` }],
              [{ text: '⬅️ Back', callback_data: 'main_menu' }]
            ]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    } else if (data === 'admin_open' && isAdmin(chatId)) {
      // Open playing for all 20 overs
      for (let i = 1; i <= 20; i++) {
        activeOvers[i] = true;
        if (!overplays[i]) {
          overplays[i] = {};
        }
      }
      saveData();
      
      const message = `🟢 playing is now OPEN for all 20 overs!`;
      bot.editMessageText(
        message,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: createMainMenu(chatId)
        }
      );
      sendNotificationToAllUsers(message);
    } else if (data === 'admin_close' && isAdmin(chatId)) {
      const activeOversArray = Object.entries(activeOvers)
        .filter(([, isActive]) => isActive)
        .map(([over]) => over);
      
      if (activeOversArray.length === 0) {
        return bot.editMessageText(
          '❌ No active overs to close.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const keyboard = activeOversArray.map(over => 
        [{ text: `Close Over ${over}`, callback_data: `close_over_${over}` }]
      );
      keyboard.push([{ text: '⬅️ Back', callback_data: 'main_menu' }]);
      
      bot.editMessageText(
        'Select over to close:',
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: keyboard }
        }
      ).catch(err => console.error("Error editing message:", err));
    } else if (data.startsWith('close_over_') && isAdmin(chatId)) {
      const overNumber = data.split('_')[2];
      activeOvers[overNumber] = false;
      saveData();
      
      const message = `🔴 playing closed for Over ${overNumber}! Awaiting result.`;
      bot.editMessageText(
        message,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: createMainMenu(chatId)
        }
      ).catch(err => console.error("Error editing message:", err));
      sendNotificationToAllUsers(message);
    } else if (data === 'admin_result' && isAdmin(chatId)) {
      const completedOvers = Object.keys(overplays).filter(over => !activeOvers[over] || !activeOvers[over]);
      
      if (completedOvers.length === 0) {
        return bot.editMessageText(
          '❌ No completed overs to announce result.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const keyboard = completedOvers.map(over => 
        [{ text: `Result for Over ${over}`, callback_data: `result_over_${over}` }]
      );
      keyboard.push([{ text: '⬅️ Back', callback_data: 'main_menu' }]);
      
      bot.editMessageText(
        'Select over to announce result:',
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: keyboard }
        }
      ).catch(err => console.error("Error editing message:", err));
    } else if (data.startsWith('result_over_') && isAdmin(chatId)) {
      const overNumber = data.split('_')[2];
      
      bot.editMessageText(
        `Enter the result runs for Over ${overNumber}:`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Cancel', callback_data: 'admin_result' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
      
      states[chatId] = 'waiting_result';
      states[`${chatId}_over`] = overNumber;
    } else if (data === 'refresh_live_odds') {
      const activeOversArray = Object.keys(activeOvers)
        .filter(over => activeOvers[over])
        .sort((a, b) => parseInt(a) - parseInt(b));
      
      if (activeOversArray.length === 0) {
        return bot.editMessageText('❌ No active overs currently available.', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { 
            inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]]
          }
        });
      }
      
      let oddsMessage = `📊 *Live Odds*\n\n`;
      
      activeOversArray.forEach(over => {
        if (!overUnderStats[over]) {
          overUnderStats[over] = {
            overOdds: INITIAL_ODDS,
            underOdds: INITIAL_ODDS,
            overAmount: 0,
            underAmount: 0
          };
        }
        
        const stats = overUnderStats[over];
        const volume = stats.overAmount + stats.underAmount;
        
        oddsMessage += `*Over ${over}*\n`;
        oddsMessage += `OVER 8.5: ${stats.overOdds.toFixed(2)}x\n`;
        oddsMessage += `UNDER 8.5: ${stats.underOdds.toFixed(2)}x\n`;
        oddsMessage += `Volume: ${volume} points\n\n`;
      });
      
      oddsMessage += `Updated: ${new Date().toLocaleTimeString()}`;
      
      bot.editMessageText(oddsMessage, { 
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎲 Place plays', callback_data: 'list_overs' }],
            [{ text: '🔄 Refresh Odds', callback_data: 'refresh_live_odds' }]
          ]
        }
      });
      
      // Tell the user odds were refreshed
      bot.answerCallbackQuery(query.id, { text: "Live odds updated!" });
    } else if (data === 'list_matches') {
      const matches = matchplaying.getActiveMatchesWithOdds();
      
      if (matches.length === 0) {
        return bot.editMessageText(
          '❌ No matches are currently open for playing.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
          }
        );
      }
      
      bot.editMessageText(
        '🏏 *Match Winner playing*\n\nSelect a match to place your play:',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getActiveMatchesKeyboard()
        }
      );
    } else if (data.startsWith('select_match_')) {
      const matchId = data.split('_')[2];
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found or no longer available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      bot.editMessageText(
        `🏏 *${matchData.team1} vs ${matchData.team2}*\n\n` +
        `Current Odds:\n` +
        `${matchData.team1}: ${matchData.team1Odds.toFixed(2)}x\n` +
        `${matchData.team2}: ${matchData.team2Odds.toFixed(2)}x\n\n` +
        `Select a team to bet on:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getMatchOddsKeyboard(matchId)
        }
      ).catch(err => console.error("Error editing message:", err));
    } else if (data.startsWith('refresh_match_')) {
      const matchId = data.split('_')[2];
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found or no longer available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      bot.editMessageText(
        `🏏 *${matchData.team1} vs ${matchData.team2}*\n\n` +
        `Current Odds (Updated: ${new Date().toLocaleTimeString()}):\n` +
        `${matchData.team1}: ${matchData.team1Odds.toFixed(2)}x\n` +
        `${matchData.team2}: ${matchData.team2Odds.toFixed(2)}x\n\n` +
        `Select a team to bet on:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getMatchOddsKeyboard(matchId)
        }
      ).catch(err => console.error("Error editing message:", err));
      
      bot.answerCallbackQuery(query.id, { text: "Odds updated to latest values!" }).catch(err => console.error("Error answering callback query:", err));
    } else if (data.startsWith('play_team1_')) {
      const matchId = data.split('_')[2];
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found or no longer available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Store match data for later
      states[`${chatId}_match`] = matchId;
      states[`${chatId}_teamplay`] = matchplaying.teamplayTypes.TEAM1;
      
      bot.editMessageText(
        `🎯 *Bet on ${matchData.team1}*\n\n` +
        `Match: ${matchData.team1} vs ${matchData.team2}\n` +
        `Current Odds: ${matchData.team1Odds.toFixed(2)}x\n\n` +
        `Select bet amount:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '10', callback_data: `match_amount_10_${matchId}` },
                { text: '20', callback_data: `match_amount_20_${matchId}` },
                { text: '50', callback_data: `match_amount_50_${matchId}` }
              ],
              [
                { text: '100', callback_data: `match_amount_100_${matchId}` },
                { text: '200', callback_data: `match_amount_200_${matchId}` },
                { text: '500', callback_data: `match_amount_500_${matchId}` }
              ],
              [{ text: 'Custom Amount', callback_data: `match_custom_${matchId}` }],
              [{ text: '⬅️ Back', callback_data: `select_match_${matchId}` }]
            ]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    } else if (data.startsWith('play_team2_')) {
      const matchId = data.split('_')[2];
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found or no longer available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Store match data for later
      states[`${chatId}_match`] = matchId;
      states[`${chatId}_teamplay`] = matchplaying.teamplayTypes.TEAM2;
      
      bot.editMessageText(
        `🎯 *Bet on ${matchData.team2}*\n\n` +
        `Match: ${matchData.team1} vs ${matchData.team2}\n` +
        `Current Odds: ${matchData.team2Odds.toFixed(2)}x\n\n` +
        `Select bet amount:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '10', callback_data: `match_amount_10_${matchId}` },
                { text: '20', callback_data: `match_amount_20_${matchId}` },
                { text: '50', callback_data: `match_amount_50_${matchId}` }
              ],
              [
                { text: '100', callback_data: `match_amount_100_${matchId}` },
                { text: '200', callback_data: `match_amount_200_${matchId}` },
                { text: '500', callback_data: `match_amount_500_${matchId}` }
              ],
              [{ text: 'Custom Amount', callback_data: `match_custom_${matchId}` }],
              [{ text: '⬅️ Back', callback_data: `select_match_${matchId}` }]
            ]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    } else if (data.startsWith('match_amount_')) {
      const parts = data.split('_');
      const amount = parseInt(parts[2]);
      const matchId = parts[3];
      const teamplay = states[`${chatId}_teamplay`];
      
      if (!matchId || !teamplay) {
        return bot.editMessageText(
          '❌ Invalid selection. Please try again.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const matchData = matchplaying.getMatchDetails(matchId);
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found or no longer available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Place the bet
      const result = matchplaying.placeTeamplay(
        chatId, 
        matchId, 
        teamplay, 
        amount, 
        users[chatId].points, 
        updateUserPoints
      );
      
      // Clean up temporary states
      delete states[`${chatId}_match`];
      delete states[`${chatId}_teamplay`];
      
      if (!result.success) {
        return bot.editMessageText(
          `❌ ${result.message}`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `select_match_${matchId}` }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Save data
      saveData();
      
      const teamName = teamplay === matchplaying.teamplayTypes.TEAM1 ? matchData.team1 : matchData.team2;
      const odds = teamplay === matchplaying.teamplayTypes.TEAM1 ? matchData.team1Odds : matchData.team2Odds;
      
      bot.editMessageText(
        `✅ *Bet Placed Successfully*\n\n` +
        `Match: ${matchData.team1} vs ${matchData.team2}\n` +
        `Team: ${teamName}\n` +
        `Amount: ${amount} points\n` +
        `Odds: ${odds.toFixed(2)}x\n` +
        `Potential Win: ${Math.floor(amount * odds)} points`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎯 Place Another Bet', callback_data: 'list_matches' }],
              [{ text: '📊 My Points', callback_data: 'my_points' }],
              [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
            ]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    } else if (data.startsWith('match_custom_')) {
      const matchId = data.split('_')[2];
      const teamplay = states[`${chatId}_teamplay`];
      
      if (!matchId || !teamplay) {
        return bot.editMessageText(
          '❌ Invalid selection. Please try again.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const matchData = matchplaying.getMatchDetails(matchId);
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found or no longer available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const teamName = teamplay === matchplaying.teamplayTypes.TEAM1 ? matchData.team1 : matchData.team2;
      const odds = teamplay === matchplaying.teamplayTypes.TEAM1 ? matchData.team1Odds : matchData.team2Odds;
      
      bot.editMessageText(
        `💰 *Custom Bet Amount*\n\n` +
        `Match: ${matchData.team1} vs ${matchData.team2}\n` +
        `Team: ${teamName}\n` +
        `Odds: ${odds.toFixed(2)}x\n\n` +
        `Please type the amount you want to bet:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '⬅️ Back', callback_data: `select_match_${matchId}` }]]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
      
      // Set the state to wait for custom amount
      states[chatId] = `waiting_match_amount`;
    } else if (data === 'admin_match' && isAdmin(chatId)) {
      bot.editMessageText(
        '🏏 *Match Betting Admin Panel*\n\n' +
        'Select an action:',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getMatchAdminKeyboard()
        }
      ).catch(err => console.error("Error editing message:", err));
    } else if (data === 'create_match' && isAdmin(chatId)) {
      bot.editMessageText(
        '➕ *Create New Match*\n\n' +
        'To create a new match, send the following command:\n\n' +
        '`/creatematch [match_id] [team1] [team2]`\n\n' +
        'Example: `/creatematch 1 MI CSK`',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { 
            inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] 
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    } else if (data === 'close_match' && isAdmin(chatId)) {
      const matches = matchplaying.getActiveMatchesWithOdds();
      
      if (matches.length === 0) {
        return bot.editMessageText(
          '❌ No active matches to close.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const keyboard = matches.map(match => 
        [{ text: `${match.team1} vs ${match.team2}`, callback_data: `admin_close_match_${match.matchId}` }]
      );
      keyboard.push([{ text: '⬅️ Back', callback_data: 'admin_match' }]);
      
      bot.editMessageText(
        '🔴 *Close Match Betting*\n\n' +
        'Select a match to close betting:',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('admin_close_match_') && isAdmin(chatId)) {
      const matchId = data.split('_')[3];
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Close the match for betting
      matchplaying.closeMatch(matchId);
      saveData();
      
      const message = `🔴 Playing closed for match: ${matchData.team1} vs ${matchData.team2}`;
      bot.editMessageText(
        message,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
      sendNotificationToAllUsers(message);
    }
    else if (data === 'result_match' && isAdmin(chatId)) {
      // Get all matches (active and inactive)
      const allMatches = Object.entries(matchplaying.getSaveData().activeMatches)
        .filter(([, match]) => !match.active) // Get only closed matches
        .map(([matchId, match]) => ({ matchId, ...match }));
      
      if (allMatches.length === 0) {
        return bot.editMessageText(
          '❌ No closed matches to announce results for.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const keyboard = allMatches.map(match => 
        [{ text: `${match.team1} vs ${match.team2}`, callback_data: `admin_result_match_${match.matchId}` }]
      );
      keyboard.push([{ text: '⬅️ Back', callback_data: 'admin_match' }]);
      
      bot.editMessageText(
        '📢 *Announce Match Result*\n\n' +
        'Select a match to announce the result:',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('admin_result_match_') && isAdmin(chatId)) {
      const matchId = data.split('_')[3];
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Show result options
      bot.editMessageText(
        `📢 *Match Result: ${matchData.team1} vs ${matchData.team2}*\n\n` +
        'Select the winning team:',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: matchData.team1, callback_data: `admin_set_result_${matchId}_${matchData.team1}` }],
              [{ text: matchData.team2, callback_data: `admin_set_result_${matchId}_${matchData.team2}` }],
              [{ text: '⬅️ Back', callback_data: 'result_match' }]
            ]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('admin_set_result_') && isAdmin(chatId)) {
      const parts = data.split('_');
      const matchId = parts[3];
      const winningTeam = parts.slice(4).join('_');
      
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      try {
        // Set the result and process payouts
        matchplaying.setMatchResult(matchId, winningTeam);
        const result = matchplaying.processMatchResult(matchId, winningTeam, users, updateUserPoints);
        saveData();
        
        // Add debug logging to examine the result structure
        console.log('Match result:', JSON.stringify({
          success: result.success,
          message: result.message,
          hasStats: !!result.stats,
          stats: result.stats ? {
            totalplayCount: result.stats.totalplayCount,
            uniqueUsers: result.stats.uniqueUsers,
            winnersCount: result.stats.winners ? result.stats.winners.length : 'undefined',
            losersCount: result.stats.losers ? result.stats.losers.length : 'undefined'
          } : 'undefined'
        }, null, 2));
        
        if (!result.success) {
          return bot.editMessageText(
            `❌ ${result.message}`,
            {
              chat_id: chatId,
              message_id: messageId,
              reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
            }
          ).catch(err => console.error("Error editing message:", err));
        }
        
        // Build result message safely - handle any missing properties
        let resultMsg = `📢 *Match Result: ${matchData.team1} vs ${matchData.team2}*\n\n`;
        resultMsg += `Winner: ${winningTeam}\n`;
        
        // Add defensive checks for stats properties
        const stats = result.stats || {};
        const totalplays = stats.totalplayCount || 0;
        const uniqueUsers = stats.uniqueUsers || 0;
        resultMsg += `Total bets: ${totalplays} from ${uniqueUsers} users\n\n`;
        
        // Add winners section safely
        if (stats.winners && stats.winners.length > 0) {
          resultMsg += `🏆 *Winners:*\n`;
          stats.winners.forEach(winner => {
            const playCount = winner.playCount || 0;
            const totalplay = winner.totalplay || 0;
            const totalWin = winner.totalWin || 0;
            const name = winner.name || 'Unknown';
            resultMsg += `- ${name}: +${totalWin} pts (${playCount} bet${playCount > 1 ? 's' : ''}, ${totalplay} pts)\n`;
          });
        } else {
          resultMsg += `😬 No winners this match!\n`;
        }
        
        // Add losers section safely
        if (stats.losers && stats.losers.length > 0) {
          resultMsg += `\n💔 *Losers:*\n`;
          stats.losers.forEach(loser => {
            const playCount = loser.playCount || 0;
            const totalLoss = loser.totalLoss || 0;
            const name = loser.name || 'Unknown';
            resultMsg += `- ${name}: -${totalLoss} pts (${playCount} bet${playCount > 1 ? 's' : ''})\n`;
          });
        }
        
        resultMsg += `\n📊 *Top 3 Players:*\n${getTop3Users()}`;
        
        bot.editMessageText(
          resultMsg,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
        
        // Announce the result to all users
        sendNotificationToAllUsers(`📢 Match Result: ${matchData.team1} vs ${matchData.team2}\nWinner: ${winningTeam}\nCheck /menu for details!`);
      } catch (error) {
        console.error('Error processing match result:', error);
        bot.editMessageText(
          '❌ An error occurred while processing the match result. Please try again.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
    }
  } catch (error) {
    console.error('Error processing message:', error);
    try {
      // Try to notify the user
      const chatId = msg?.chat?.id;
      if (chatId) {
        bot.sendMessage(chatId, '❌ An error occurred. Please try again or use /start to restart the bot.');
      }
    } catch (notifyError) {
      console.error('Failed to notify user about error:', notifyError);
    }
  }
});

// --- Callback Queries ---
bot.on('callback_query', (query) => {
  try {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    
    // Acknowledge the callback query
    bot.answerCallbackQuery(query.id).catch(err => console.error("Error answering callback query:", err));
    
    // Check if user exists, if not prompt them to start the bot
    if (!users[chatId] && data !== 'main_menu') {
      return bot.editMessageText(
        '⚠️ Your session has expired or you are not registered. Please use /start to register.',
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: 'Start Bot', callback_data: 'main_menu' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    
    // Only allow main_menu and registration-related callbacks without authentication
    const publicActions = ['main_menu'];
    if (!publicActions.includes(data) && !auth.isAuthenticated(chatId)) {
      return bot.editMessageText(
        '⚠️ You need to complete registration with a valid email and phone number before using this feature.\n\nPlease use /start to complete your registration.',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: 'Start Registration', callback_data: 'main_menu' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    
    // Continue with the rest of the callback handling
    if (data === 'main_menu') {
      // If user doesn't exist and they click main menu, send a registration prompt
      if (!users[chatId]) {
        return bot.editMessageText(
          '👋 Welcome to IPL play Bot! Please use /start to register and start playing.',
          {
            chat_id: chatId,
            message_id: messageId
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      bot.editMessageText(
        `🏏 *IPL playing Menu*\nHello ${users[chatId].name}! What would you like to do?`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: createMainMenu(chatId)
        }
      ).catch(err => console.error("Error editing message:", err));
    } else if (data === 'my_points') {
      const user = users[chatId];
      
      if (!user) {
        return bot.editMessageText(
          '⚠️ Your session has expired or you are not registered. Please use /start to register.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: 'Start Bot', callback_data: 'main_menu' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      bot.editMessageText(
        `💰 *Your Profile*\n\n` +
        `Name: ${user.name || 'Not provided'}\n` +
        `Username: @${user.username || 'N/A'}\n` +
        `Email: ${user.email || 'Not provided'}\n` +
        `Phone: ${user.phone || 'Not provided'}\n` +
        `Points: ${user.points || 0}\n\n` +
        `Place plays to win more points!`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
    } else if (data === 'add_withdraw_points') {
      bot.editMessageText(
        `💵 *Add or Withdraw Points*\n\n` +
        `To add or withdraw points, please share your points amount to:\n\n` +
        `@letsgoo234\n\n` +
        `Current balance: ${users[chatId].points} points`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
    } else if (data.startsWith('amount_')) {
      const parts = data.split('_');
      const amount = parseInt(parts[1]);
      const overNumber = parts[2];
      const playType = states[`${chatId}_playType`];
      
      if (!playType) {
        return bot.editMessageText(
          '❌ Please select a play type first (OVER or UNDER).',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `select_over_${overNumber}` }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Place the play with the selected amount
      const result = placeplay(chatId, overNumber, playType, amount);
      
      if (!result) {
        return; // placeplay function already sends an error message
      }
      
      // Clean up temporary states
      delete states[`${chatId}_playType`];
      delete states[`${chatId}_over`];
      delete states[`${chatId}_amount`];
      
      // Make sure overUnderStats exists for this over
      if (!overUnderStats[overNumber]) {
        overUnderStats[overNumber] = {
          overOdds: INITIAL_ODDS,
          underOdds: INITIAL_ODDS,
          overAmount: 0,
          underAmount: 0
        };
      }
      
      const currentOdds = (playType === playTypes.OVER 
        ? overUnderStats[overNumber]?.overOdds 
        : overUnderStats[overNumber]?.underOdds) || INITIAL_ODDS;
      
      bot.editMessageText(
        `✅ *play Placed Successfully*\n\n` +
        `Over: ${overNumber}\n` +
        `Type: ${playType === playTypes.OVER ? 'OVER 8.5' : 'UNDER 8.5'}\n` +
        `Amount: ${amount} points\n` +
        `Odds: ${currentOdds.toFixed(2)}x`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎯 Place Another play', callback_data: 'list_overs' }],
              [{ text: '📊 My Points', callback_data: 'my_points' }],
              [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
            ]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    // Other handlers remain the same...
    else if (data === 'list_overs') {
      const activeOversCount = Object.values(activeOvers).filter(status => status).length;
      
      if (activeOversCount === 0) {
        return bot.editMessageText(
          '❌ No overs are currently open for betting.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      bot.editMessageText(
        '🏏 *Available Overs for betting*\n\nSelect an over to place your bet:',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getActiveOversWithOddsKeyboard()
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('select_over_')) {
      const overNumber = data.split('_')[2];
      
      if (!overUnderStats[overNumber]) {
        overUnderStats[overNumber] = {
          overOdds: INITIAL_ODDS,
          underOdds: INITIAL_ODDS,
          overAmount: 0,
          underAmount: 0
        };
      }
      
      const stats = overUnderStats[overNumber];
      
      // Set the user's state to viewing odds
      states[chatId] = 'viewing_odds';
      states[`${chatId}_over`] = overNumber;
      
      bot.editMessageText(
        `🎲 *Bet on Over ${overNumber}*\n\n` +
        `OVER 8.5: ${stats.overOdds.toFixed(2)}x\n` +
        `UNDER 8.5: ${stats.underOdds.toFixed(2)}x\n\n` +
        `Over means you win if over runs > 8.5\nUnder means you win if over runs < 8.5\n\nSelect your bet type and amount:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getQuickplayKeyboard(overNumber)
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('refresh_odds_')) {
      const overNumber = data.split('_')[2];
      
      if (!overUnderStats[overNumber]) {
        overUnderStats[overNumber] = {
          overOdds: INITIAL_ODDS,
          underOdds: INITIAL_ODDS,
          overAmount: 0,
          underAmount: 0
        };
      }
      
      const stats = overUnderStats[overNumber];
      
      // Keep tracking that the user is viewing odds
      states[chatId] = 'viewing_odds';
      states[`${chatId}_over`] = overNumber;
      
      bot.editMessageText(
        `🎲 *Live Odds for Over ${overNumber}*\n\n` +
        `OVER 8.5: ${stats.overOdds.toFixed(2)}x\n` +
        `UNDER 8.5: ${stats.underOdds.toFixed(2)}x\n\n` +
        `Odds last updated: ${new Date().toLocaleTimeString()}\n` +
        `Select your bet type and amount:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getQuickplayKeyboard(overNumber)
        }
      ).catch(err => console.error("Error editing message:", err));
      
      // Tell the user odds were refreshed
      bot.answerCallbackQuery(query.id, { text: "Odds updated to latest values!" });
    }
    else if (data.startsWith('play_over_')) {
      // When user selects a bet type, clear the viewing_odds state
      if (states[chatId] === 'viewing_odds') {
        delete states[chatId];
      }
      
      const overNumber = data.split('_')[2];
      
      // Store the bet type and wait for amount
      states[`${chatId}_playType`] = playTypes.OVER;
      states[`${chatId}_over`] = overNumber;
      
      // Make sure overUnderStats exists for this over
      if (!overUnderStats[overNumber]) {
        overUnderStats[overNumber] = {
          overOdds: INITIAL_ODDS,
          underOdds: INITIAL_ODDS,
          overAmount: 0,
          underAmount: 0
        };
      }
      
      bot.editMessageText(
        `🎯 *OVER 8.5 for Over ${overNumber}*\n\n` +
        `Current Odds: ${overUnderStats[overNumber].overOdds.toFixed(2)}x\n\n` +
        `Select bet amount:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getplayAmountKeyboard(overNumber)
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('play_under_')) {
      // When user selects a bet type, clear the viewing_odds state
      if (states[chatId] === 'viewing_odds') {
        delete states[chatId];
      }
      
      const overNumber = data.split('_')[2];
      
      // Store the bet type and wait for amount
      states[`${chatId}_playType`] = playTypes.UNDER;
      states[`${chatId}_over`] = overNumber;
      
      // Make sure overUnderStats exists for this over
      if (!overUnderStats[overNumber]) {
        overUnderStats[overNumber] = {
          overOdds: INITIAL_ODDS,
          underOdds: INITIAL_ODDS,
          overAmount: 0,
          underAmount: 0
        };
      }
      
      bot.editMessageText(
        `🎯 *UNDER 8.5 for Over ${overNumber}*\n\n` +
        `Current Odds: ${overUnderStats[overNumber].underOdds.toFixed(2)}x\n\n` +
        `Select bet amount:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getplayAmountKeyboard(overNumber)
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('custom_amount_')) {
      const overNumber = data.split('_')[2];
      const playType = states[`${chatId}_playType`];
      
      if (!playType) {
        return bot.editMessageText(
          '❌ Please select a bet type first (OVER or UNDER).',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `select_over_${overNumber}` }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Make sure overUnderStats exists
      if (!overUnderStats[overNumber]) {
        overUnderStats[overNumber] = {
          overOdds: INITIAL_ODDS,
          underOdds: INITIAL_ODDS,
          overAmount: 0,
          underAmount: 0
        };
      }
      
      const odds = playType === playTypes.OVER 
        ? overUnderStats[overNumber].overOdds 
        : overUnderStats[overNumber].underOdds;
      
      bot.editMessageText(
        `💰 *Custom Bet Amount*\n\n` +
        `Over: ${overNumber}\n` +
        `Type: ${playType === playTypes.OVER ? 'OVER 8.5' : 'UNDER 8.5'}\n` +
        `Odds: ${odds.toFixed(2)}x\n\n` +
        `Please type the amount you want to bet:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '⬅️ Back', callback_data: `select_over_${overNumber}` }]]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
      
      // Set the state to wait for custom amount
      states[chatId] = `waiting_amount`;
    }
    else if (data === 'leaderboard') {
      const top10 = Object.entries(users)
        .sort(([, a], [, b]) => b.points - a.points)
        .filter(([, user]) => user.userId != adminId)
        .slice(0, 10)
        .map(([, user], index) => `${index + 1}. ${user.name}: ${user.points} pts`)
        .join('\n');
      
      bot.editMessageText(
        `📊 *Leaderboard - Top 10*\n\n${top10}`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data === 'add_withdraw_points') {
      bot.editMessageText(
        `💵 *Add or Withdraw Points*\n\n` +
        `To add or withdraw points, please share your points amount to:\n\n` +
        `@letsgoo234\n\n` +
        `Current balance: ${users[chatId].points} points`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data === 'referral_link') {
      const username = users[chatId].username || query.from.username || null;
      const referralLink = referralSystem.generateReferralLink(chatId, username);
      const stats = referralSystem.getUserReferralStats(chatId);
      
      bot.editMessageText(
        `🔗 Your Referral Link\n\n` +
        `Share this link with friends to earn ${referralSystem.REFERRAL_REWARD} points for each new user who joins!\n\n` +
        `${referralLink}\n\n` +
        `👥 Your referrals: ${stats.totalReferrals}\n` +
        `💰 Points earned: ${stats.pointsEarned}`,
        { 
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: '📤 Share Link', url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join IPL play Bot and get 20 points to start playing!')}` }],
              [{ text: '⬅️ Back', callback_data: 'main_menu' }]
            ]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    // Admin handlers
    else if (data === 'admin_open' && isAdmin(chatId)) {
      // Open betting for all 20 overs
      for (let i = 1; i <= 20; i++) {
        activeOvers[i] = true;
        if (!overplays[i]) {
          overplays[i] = {};
        }
      }
      saveData();
      
      const message = `🟢 Betting is now OPEN for all 20 overs!`;
      bot.editMessageText(
        message,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: createMainMenu(chatId)
        }
      ).catch(err => console.error("Error editing message:", err));
      
      sendNotificationToAllUsers(message);
    }
    else if (data === 'admin_close' && isAdmin(chatId)) {
      const activeOversArray = Object.entries(activeOvers)
        .filter(([, isActive]) => isActive)
        .map(([over]) => over);
      
      if (activeOversArray.length === 0) {
        return bot.editMessageText(
          '❌ No active overs to close.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const keyboard = activeOversArray.map(over => 
        [{ text: `Close Over ${over}`, callback_data: `close_over_${over}` }]
      );
      keyboard.push([{ text: '⬅️ Back', callback_data: 'main_menu' }]);
      
      bot.editMessageText(
        'Select over to close:',
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: keyboard }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('close_over_') && isAdmin(chatId)) {
      const overNumber = data.split('_')[2];
      activeOvers[overNumber] = false;
      saveData();
      
      const message = `🔴 Betting closed for Over ${overNumber}! Awaiting result.`;
      bot.editMessageText(
        message,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: createMainMenu(chatId)
        }
      ).catch(err => console.error("Error editing message:", err));
      sendNotificationToAllUsers(message);
    }
    else if (data === 'admin_result' && isAdmin(chatId)) {
      const completedOvers = Object.keys(overplays).filter(over => !activeOvers[over] || !activeOvers[over]);
      
      if (completedOvers.length === 0) {
        return bot.editMessageText(
          '❌ No completed overs to announce results for.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const keyboard = completedOvers.map(over => 
        [{ text: `Over ${over}`, callback_data: `result_over_${over}` }]
      );
      keyboard.push([{ text: '⬅️ Back', callback_data: 'main_menu' }]);
      
      bot.editMessageText(
        'Select over to announce result:',
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: keyboard }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('result_over_') && isAdmin(chatId)) {
      const overNumber = data.split('_')[2];
      
      // Set state to wait for result
      states[chatId] = 'waiting_result';
      states[`${chatId}_over`] = overNumber;
      
      bot.editMessageText(
        `Enter the result runs for Over ${overNumber}:`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Cancel', callback_data: 'admin_result' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data === 'refresh_live_odds') {
      const activeOversArray = Object.keys(activeOvers)
        .filter(over => activeOvers[over])
        .sort((a, b) => parseInt(a) - parseInt(b));
      
      if (activeOversArray.length === 0) {
        return bot.editMessageText(
          '❌ No active overs currently available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      let oddsMessage = `📊 *Live Odds*\n\n`;
      
      activeOversArray.forEach(over => {
        if (!overUnderStats[over]) {
          overUnderStats[over] = {
            overOdds: INITIAL_ODDS,
            underOdds: INITIAL_ODDS,
            overAmount: 0,
            underAmount: 0
          };
        }
        
        const stats = overUnderStats[over];
        const volume = stats.overAmount + stats.underAmount;
        
        oddsMessage += `*Over ${over}*\n`;
        oddsMessage += `OVER 8.5: ${stats.overOdds.toFixed(2)}x\n`;
        oddsMessage += `UNDER 8.5: ${stats.underOdds.toFixed(2)}x\n`;
        oddsMessage += `Volume: ${volume} points\n\n`;
      });
      
      oddsMessage += `Updated: ${new Date().toLocaleTimeString()}`;
      
      bot.editMessageText(
        oddsMessage,
        { 
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎲 Place Bets', callback_data: 'list_overs' }],
              [{ text: '🔄 Refresh Odds', callback_data: 'refresh_live_odds' }],
              [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
            ]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
      
      // Inform user that odds were refreshed
      bot.answerCallbackQuery(query.id, { text: "Odds updated to latest values!" }).catch(err => console.error("Error answering callback query:", err));
    }
    else if (data === 'list_matches') {
      const matches = matchplaying.getActiveMatchesWithOdds();
      
      if (matches.length === 0) {
        return bot.editMessageText(
          '❌ No active matches available for betting.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'main_menu' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      bot.editMessageText(
        '🏏 *IPL Match Betting*\n\nSelect a match to view betting options:',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getActiveMatchesKeyboard()
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('select_match_')) {
      const matchId = data.split('_')[2];
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found or no longer available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      bot.editMessageText(
        `🏏 *${matchData.team1} vs ${matchData.team2}*\n\n` +
        `Current Odds:\n` +
        `${matchData.team1}: ${matchData.team1Odds.toFixed(2)}x\n` +
        `${matchData.team2}: ${matchData.team2Odds.toFixed(2)}x\n\n` +
        `Select a team to bet on:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getMatchOddsKeyboard(matchId)
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('refresh_match_')) {
      const matchId = data.split('_')[2];
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found or no longer available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      bot.editMessageText(
        `🏏 *${matchData.team1} vs ${matchData.team2}*\n\n` +
        `Current Odds (Updated: ${new Date().toLocaleTimeString()}):\n` +
        `${matchData.team1}: ${matchData.team1Odds.toFixed(2)}x\n` +
        `${matchData.team2}: ${matchData.team2Odds.toFixed(2)}x\n\n` +
        `Select a team to bet on:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getMatchOddsKeyboard(matchId)
        }
      ).catch(err => console.error("Error editing message:", err));
      
      bot.answerCallbackQuery(query.id, { text: "Odds updated to latest values!" }).catch(err => console.error("Error answering callback query:", err));
    }
    else if (data.startsWith('play_team1_')) {
      const matchId = data.split('_')[2];
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found or no longer available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Store match data for later
      states[`${chatId}_match`] = matchId;
      states[`${chatId}_teamplay`] = matchplaying.teamplayTypes.TEAM1;
      
      bot.editMessageText(
        `🎯 *Bet on ${matchData.team1}*\n\n` +
        `Match: ${matchData.team1} vs ${matchData.team2}\n` +
        `Current Odds: ${matchData.team1Odds.toFixed(2)}x\n\n` +
        `Select bet amount:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '10', callback_data: `match_amount_10_${matchId}` },
                { text: '20', callback_data: `match_amount_20_${matchId}` },
                { text: '50', callback_data: `match_amount_50_${matchId}` }
              ],
              [
                { text: '100', callback_data: `match_amount_100_${matchId}` },
                { text: '200', callback_data: `match_amount_200_${matchId}` },
                { text: '500', callback_data: `match_amount_500_${matchId}` }
              ],
              [{ text: 'Custom Amount', callback_data: `match_custom_${matchId}` }],
              [{ text: '⬅️ Back', callback_data: `select_match_${matchId}` }]
            ]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('play_team2_')) {
      const matchId = data.split('_')[2];
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found or no longer available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Store match data for later
      states[`${chatId}_match`] = matchId;
      states[`${chatId}_teamplay`] = matchplaying.teamplayTypes.TEAM2;
      
      bot.editMessageText(
        `🎯 *Bet on ${matchData.team2}*\n\n` +
        `Match: ${matchData.team1} vs ${matchData.team2}\n` +
        `Current Odds: ${matchData.team2Odds.toFixed(2)}x\n\n` +
        `Select bet amount:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '10', callback_data: `match_amount_10_${matchId}` },
                { text: '20', callback_data: `match_amount_20_${matchId}` },
                { text: '50', callback_data: `match_amount_50_${matchId}` }
              ],
              [
                { text: '100', callback_data: `match_amount_100_${matchId}` },
                { text: '200', callback_data: `match_amount_200_${matchId}` },
                { text: '500', callback_data: `match_amount_500_${matchId}` }
              ],
              [{ text: 'Custom Amount', callback_data: `match_custom_${matchId}` }],
              [{ text: '⬅️ Back', callback_data: `select_match_${matchId}` }]
            ]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('match_amount_')) {
      const parts = data.split('_');
      const amount = parseInt(parts[2]);
      const matchId = parts[3];
      const teamplay = states[`${chatId}_teamplay`];
      
      if (!matchId || !teamplay) {
        return bot.editMessageText(
          '❌ Invalid selection. Please try again.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const matchData = matchplaying.getMatchDetails(matchId);
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found or no longer available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Place the bet
      const result = matchplaying.placeTeamplay(
        chatId, 
        matchId, 
        teamplay, 
        amount, 
        users[chatId].points, 
        updateUserPoints
      );
      
      // Clean up temporary states
      delete states[`${chatId}_match`];
      delete states[`${chatId}_teamplay`];
      
      if (!result.success) {
        return bot.editMessageText(
          `❌ ${result.message}`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `select_match_${matchId}` }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Save data
      saveData();
      
      const teamName = teamplay === matchplaying.teamplayTypes.TEAM1 ? matchData.team1 : matchData.team2;
      const odds = teamplay === matchplaying.teamplayTypes.TEAM1 ? matchData.team1Odds : matchData.team2Odds;
      
      bot.editMessageText(
        `✅ *Bet Placed Successfully*\n\n` +
        `Match: ${matchData.team1} vs ${matchData.team2}\n` +
        `Team: ${teamName}\n` +
        `Amount: ${amount} points\n` +
        `Odds: ${odds.toFixed(2)}x\n` +
        `Potential Win: ${Math.floor(amount * odds)} points`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎯 Place Another Bet', callback_data: 'list_matches' }],
              [{ text: '📊 My Points', callback_data: 'my_points' }],
              [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
            ]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('match_custom_')) {
      const matchId = data.split('_')[2];
      const teamplay = states[`${chatId}_teamplay`];
      
      if (!matchId || !teamplay) {
        return bot.editMessageText(
          '❌ Invalid selection. Please try again.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const matchData = matchplaying.getMatchDetails(matchId);
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found or no longer available.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const teamName = teamplay === matchplaying.teamplayTypes.TEAM1 ? matchData.team1 : matchData.team2;
      const odds = teamplay === matchplaying.teamplayTypes.TEAM1 ? matchData.team1Odds : matchData.team2Odds;
      
      bot.editMessageText(
        `💰 *Custom Bet Amount*\n\n` +
        `Match: ${matchData.team1} vs ${matchData.team2}\n` +
        `Team: ${teamName}\n` +
        `Odds: ${odds.toFixed(2)}x\n\n` +
        `Please type the amount you want to bet:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '⬅️ Back', callback_data: `select_match_${matchId}` }]]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
      
      // Set the state to wait for custom amount
      states[chatId] = `waiting_match_amount`;
    }
    else if (data === 'admin_match' && isAdmin(chatId)) {
      bot.editMessageText(
        '🏏 *Match Betting Admin Panel*\n\n' +
        'Select an action:',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getMatchAdminKeyboard()
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data === 'create_match' && isAdmin(chatId)) {
      bot.editMessageText(
        '➕ *Create New Match*\n\n' +
        'To create a new match, send the following command:\n\n' +
        '`/creatematch [match_id] [team1] [team2]`\n\n' +
        'Example: `/creatematch 1 MI CSK`',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { 
            inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] 
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data === 'close_match' && isAdmin(chatId)) {
      const matches = matchplaying.getActiveMatchesWithOdds();
      
      if (matches.length === 0) {
        return bot.editMessageText(
          '❌ No active matches to close.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const keyboard = matches.map(match => 
        [{ text: `${match.team1} vs ${match.team2}`, callback_data: `admin_close_match_${match.matchId}` }]
      );
      keyboard.push([{ text: '⬅️ Back', callback_data: 'admin_match' }]);
      
      bot.editMessageText(
        '🔴 *Close Match Betting*\n\n' +
        'Select a match to close betting:',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('admin_close_match_') && isAdmin(chatId)) {
      const matchId = data.split('_')[3];
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Close the match for betting
      matchplaying.closeMatch(matchId);
      saveData();
      
      const message = `🔴 Playing closed for match: ${matchData.team1} vs ${matchData.team2}`;
      bot.editMessageText(
        message,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
      sendNotificationToAllUsers(message);
    }
    else if (data === 'result_match' && isAdmin(chatId)) {
      // Get all matches (active and inactive)
      const allMatches = Object.entries(matchplaying.getSaveData().activeMatches)
        .filter(([, match]) => !match.active) // Get only closed matches
        .map(([matchId, match]) => ({ matchId, ...match }));
      
      if (allMatches.length === 0) {
        return bot.editMessageText(
          '❌ No closed matches to announce results for.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      const keyboard = allMatches.map(match => 
        [{ text: `${match.team1} vs ${match.team2}`, callback_data: `admin_result_match_${match.matchId}` }]
      );
      keyboard.push([{ text: '⬅️ Back', callback_data: 'admin_match' }]);
      
      bot.editMessageText(
        '📢 *Announce Match Result*\n\n' +
        'Select a match to announce the result:',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('admin_result_match_') && isAdmin(chatId)) {
      const matchId = data.split('_')[3];
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Show result options
      bot.editMessageText(
        `📢 *Match Result: ${matchData.team1} vs ${matchData.team2}*\n\n` +
        'Select the winning team:',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: matchData.team1, callback_data: `admin_set_result_${matchId}_${matchData.team1}` }],
              [{ text: matchData.team2, callback_data: `admin_set_result_${matchId}_${matchData.team2}` }],
              [{ text: '⬅️ Back', callback_data: 'result_match' }]
            ]
          }
        }
      ).catch(err => console.error("Error editing message:", err));
    }
    else if (data.startsWith('admin_set_result_') && isAdmin(chatId)) {
      const parts = data.split('_');
      const matchId = parts[3];
      const winningTeam = parts.slice(4).join('_');
      
      const matchData = matchplaying.getMatchDetails(matchId);
      
      if (!matchData) {
        return bot.editMessageText(
          '❌ Match not found.',
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Set the result and process payouts
      matchplaying.setMatchResult(matchId, winningTeam);
      const result = matchplaying.processMatchResult(matchId, winningTeam, users, updateUserPoints);
      saveData();
      
      // Add debug logging to examine the result structure
      console.log('Match result:', JSON.stringify({
        success: result.success,
        message: result.message,
        hasStats: !!result.stats,
        stats: result.stats ? {
          totalplayCount: result.stats.totalplayCount,
          uniqueUsers: result.stats.uniqueUsers,
          winnersCount: result.stats.winners ? result.stats.winners.length : 'undefined',
          losersCount: result.stats.losers ? result.stats.losers.length : 'undefined'
        } : 'undefined'
      }, null, 2));
      
      if (!result.success) {
        return bot.editMessageText(
          `❌ ${result.message}`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
          }
        ).catch(err => console.error("Error editing message:", err));
      }
      
      // Build result message
      let resultMsg = `📢 *Match Result: ${matchData.team1} vs ${matchData.team2}*\n\n`;
      resultMsg += `Winner: ${winningTeam}\n`;
      
      // Add defensive checks for stats properties
      const stats = result.stats || {};
      const totalplays = stats.totalplayCount || 0;
      const uniqueUsers = stats.uniqueUsers || 0;
      resultMsg += `Total bets: ${totalplays} from ${uniqueUsers} users\n\n`;
      
      // Add winners section
      if (stats.winners && stats.winners.length > 0) {
        resultMsg += `🏆 *Winners:*\n`;
        stats.winners.forEach(winner => {
          const playCount = winner.playCount || 0;
          const totalplay = winner.totalplay || 0;
          const totalWin = winner.totalWin || 0;
          resultMsg += `- ${winner.name}: +${totalWin} pts (${playCount} bet${playCount > 1 ? 's' : ''}, ${totalplay} pts)\n`;
        });
      } else {
        resultMsg += `😬 No winners this match!\n`;
      }
      
      // Add losers section
      if (stats.losers && stats.losers.length > 0) {
        resultMsg += `\n💔 *Losers:*\n`;
        stats.losers.forEach(loser => {
          const playCount = loser.playCount || 0;
          const totalLoss = loser.totalLoss || 0;
          resultMsg += `- ${loser.name}: -${totalLoss} pts (${playCount} bet${playCount > 1 ? 's' : ''})\n`;
        });
      }
      
      resultMsg += `\n📊 *Top 3 Players:*\n${getTop3Users()}`;
      
      bot.editMessageText(
        resultMsg,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_match' }]] }
        }
      ).catch(err => console.error("Error editing message:", err));
      
      // Announce the result to all users
      sendNotificationToAllUsers(`📢 Match Result: ${matchData.team1} vs ${matchData.team2}\nWinner: ${winningTeam}\nCheck /menu for details!`);
    }
  } catch (error) {
    console.error('Error processing callback query:', error);
    try {
      // Try to notify the user
      const chatId = query?.message?.chat?.id;
      if (chatId) {
        bot.sendMessage(chatId, '❌ An error occurred. Please try again or use /start to restart the bot.');
      }
    } catch (notifyError) {
      console.error('Failed to notify user about error:', notifyError);
    }
  }
});

// --- Help Command ---
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  let helpText = `📋 *IPL playing Bot Help*\n\n` +
    `• /start - Register and start playing\n` +
    `• /menu - Show main menu with buttons\n` +
    `• /overunder - Quick access to over/under playing\n` +
    `• /matches - View active match playing options\n` +
    `• /liveodds - View current live odds for all overs\n` +
    `• /play <over> <over|under> [amount] - Place a play (e.g., /play 5 over 20)\n` +
    `• /matchplay <matchId> <team1|team2> [amount] - play on match winner\n` +
    `• /points - Check your points\n` +
    `• /deposit - Add or withdraw points\n` +
    `• /link - Get your referral link to invite friends\n` +
    `• /help - Show this help message\n\n` +
    `*playing Options:*\n` +
    `1️⃣ *Over/Under playing:*\n` +
    `- play on runs being OVER or UNDER 8.5 in an over\n` +
    `- Starting odds are 1.9x (90% payout, 10% house edge)\n` +
    `- Odds change based on playing volumes\n` +
    `- Your potential winnings = play amount × Odds\n\n` +
    `2️⃣ *Match Winner playing:*\n` +
    `- play on which team will win the match\n` +
    `- Same dynamic odds system that adjusts with playing\n` +
    `- Place multiple plays on the same match\n` +
    `- Check /matches to see available matches\n\n` +
    `3️⃣ *Referral System:*\n` +
    `- Invite friends using your personal link (/link)\n` +
    `- Earn ${referralSystem.REFERRAL_REWARD} points for each new user who joins\n` +
    `- Share your link on social media or with friends\n\n` +
    `Use the refresh buttons to see real-time odds updates!`;
    
  if (isAdmin(chatId)) {
    helpText += `\n\n*Admin Commands:*\n` +
      `• /green - Open playing for all 20 overs\n` +
      `• /red - Close playing for a specific over\n` +
      `• /result <over> <runs> - Announce result for an over\n` +
      `• /creatematch <matchId> <team1> <team2> - Create a new match`;
  }
  
  bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// --- Points Command ---
bot.onText(/\/points/, (msg) => {
  const chatId = msg.chat.id;
  if (!users[chatId]) return bot.sendMessage(chatId, '❌ You are not registered. Use /start');
  
  // Require authentication
  if (!auth.checkAndRequireAuth(chatId, bot, users)) return;
  
  const user = users[chatId];
  bot.sendMessage(
    chatId,
    `💰 *Your Profile*\n\n` +
    `Name: ${user.name}\n` +
    `Username: @${user.username || 'N/A'}\n` +
    `Email: ${user.email || 'Not provided'}\n` +
    `Phone: ${user.phone || 'Not provided'}\n` +
    `Points: ${user.points}\n\n` +
    `Place plays to win more points!`,
    { 
      parse_mode: 'Markdown',
      reply_markup: createMainMenu(chatId)
    }
  );
});

// Add a new command for quick playing
bot.onText(/\/quickplay/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!users[chatId]) {
    return bot.sendMessage(chatId, '⚠️ Please /start to register first.');
  }
  
  const activeOversCount = Object.values(activeOvers).filter(status => status).length;
  
  if (activeOversCount === 0) {
    return bot.sendMessage(
      chatId,
      '❌ No overs are currently open for playing.',
      { reply_markup: createMainMenu(chatId) }
    );
  }
  
  bot.sendMessage(
    chatId,
    '🏏 *Quick play*\n\nSelect an over to place your play:',
    {
      parse_mode: 'Markdown',
      reply_markup: getActiveOversKeyboard()
    }
  );
});

// Add a new command for over/under playing
bot.onText(/\/overunder/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!users[chatId]) {
    return bot.sendMessage(chatId, '⚠️ Please /start to register first.');
  }
  
  // Check if user is authenticated
  if (!auth.checkAndRequireAuth(chatId, bot, users)) return;
  
  const activeOversCount = Object.values(activeOvers).filter(status => status).length;
  
  if (activeOversCount === 0) {
    return bot.sendMessage(
      chatId,
      '❌ No overs are currently open for playing.',
      { reply_markup: createMainMenu(chatId) }
    );
  }
  
  bot.sendMessage(
    chatId,
    '🏏 *Over/Under playing*\n\nSelect an over to place your play:',
    {
      parse_mode: 'Markdown',
      reply_markup: getActiveOversWithOddsKeyboard()
    }
  );
});

// Add a live odds monitoring command
bot.onText(/\/liveodds/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!users[chatId]) {
    return bot.sendMessage(chatId, '⚠️ Please /start to register first.');
  }
  
  // Check if user is authenticated
  if (!auth.checkAndRequireAuth(chatId, bot, users)) return;
  
  const activeOversArray = Object.keys(activeOvers)
    .filter(over => activeOvers[over])
    .sort((a, b) => parseInt(a) - parseInt(b));
  
  if (activeOversArray.length === 0) {
    return bot.sendMessage(chatId, '❌ No active overs currently available.');
  }
  
  let oddsMessage = `📊 *Live Odds*\n\n`;
  
  activeOversArray.forEach(over => {
    if (!overUnderStats[over]) {
      overUnderStats[over] = {
        overOdds: INITIAL_ODDS,
        underOdds: INITIAL_ODDS,
        overAmount: 0,
        underAmount: 0
      };
    }
    
    const stats = overUnderStats[over];
    const volume = stats.overAmount + stats.underAmount;
    
    oddsMessage += `*Over ${over}*\n`;
    oddsMessage += `OVER 8.5: ${stats.overOdds.toFixed(2)}x\n`;
    oddsMessage += `UNDER 8.5: ${stats.underOdds.toFixed(2)}x\n`;
    oddsMessage += `Volume: ${volume} points\n\n`;
  });
  
  oddsMessage += `Updated: ${new Date().toLocaleTimeString()}`;
  
  bot.sendMessage(chatId, oddsMessage, { 
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎲 Place plays', callback_data: 'list_overs' }],
        [{ text: '🔄 Refresh Odds', callback_data: 'refresh_live_odds' }]
      ]
    }
  });
});

// Get list of active matches with odds
const getActiveMatchesKeyboard = () => {
  const keyboard = [];
  
  // Get matches with odds
  const matches = matchplaying.getActiveMatchesWithOdds();
  
  // Sort matches by ID
  matches.sort((a, b) => parseInt(a.matchId) - parseInt(b.matchId));
  
  // Group matches in rows of 1 for playter display
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const volume = match.volume;
    
    // Show team names and odds for each team
    keyboard.push([{ 
      text: `${match.team1} vs ${match.team2} ${volume > 0 ? '🔥' : ''}`, 
      callback_data: `select_match_${match.matchId}` 
    }]);
  }
  
  keyboard.push([{ text: '⬅️ Back to Menu', callback_data: 'main_menu' }]);
  
  return { inline_keyboard: keyboard };
};

// Get keyboard for a specific match showing odds
const getMatchOddsKeyboard = (matchId) => {
  const matchData = matchplaying.getMatchDetails(matchId);
  
  if (!matchData) {
    return { 
      inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'list_matches' }]] 
    };
  }
  
  return {
    inline_keyboard: [
      [
        { 
          text: `${matchData.team1} (${matchData.team1Odds.toFixed(2)}x)`, 
          callback_data: `play_team1_${matchId}` 
        }
      ],
      [
        { 
          text: `${matchData.team2} (${matchData.team2Odds.toFixed(2)}x)`, 
          callback_data: `play_team2_${matchId}` 
        }
      ],
      [
        { text: '10 pts', callback_data: `match_amount_10_${matchId}` },
        { text: '20 pts', callback_data: `match_amount_20_${matchId}` },
        { text: '50 pts', callback_data: `match_amount_50_${matchId}` }
      ],
      [
        { text: 'Custom Amount', callback_data: `match_custom_${matchId}` }
      ],
      [
        { text: '🔄 Refresh Odds', callback_data: `refresh_match_${matchId}` }
      ],
      [
        { text: '⬅️ Back to Matches', callback_data: 'list_matches' }
      ]
    ]
  };
};

// Admin keyboard for match playing management
const getMatchAdminKeyboard = () => {
  return {
    inline_keyboard: [
      [{ text: '➕ Create New Match', callback_data: 'create_match' }],
      [{ text: '🔴 Close Match playing', callback_data: 'close_match' }],
      [{ text: '📢 Announce Match Result', callback_data: 'result_match' }],
      [{ text: '⬅️ Back to Menu', callback_data: 'main_menu' }]
    ]
  };
};

// Add this near the other command handlers
bot.onText(/\/creatematch (\d+) (\S+) (\S+)/, (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isAdmin(chatId)) {
      return bot.sendMessage(chatId, '❌ Only admins can create matches.');
    }
    
    const matchId = match[1];
    const team1 = match[2];
    const team2 = match[3];
    
    // Create the match
    const result = matchplaying.createMatch(matchId, team1, team2);
    saveData();
    
    if (!result) {
      return bot.sendMessage(chatId, '❌ Failed to create match.');
    }
    
    const message = `🏏 New match created: ${team1} vs ${team2} (ID: ${matchId})`;
    bot.sendMessage(chatId, message, { reply_markup: createMainMenu(chatId) });
    
    // Announce the new match to all users
    sendNotificationToAllUsers(`🏏 *New Match Available*\n\n${team1} vs ${team2}\nPlace your plays now!`);
  });
  
  // Add /matchplay command for placing plays
  bot.onText(/\/matchplay (\d+) (team1|team2) (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!users[chatId]) {
      return bot.sendMessage(chatId, '⚠️ Please /start to register first.');
    }
    
    const matchId = match[1];
    const teamPosition = match[2];
    const amount = parseInt(match[3]);
    
    const matchData = matchplaying.getMatchDetails(matchId);
    if (!matchData || !matchData.active) {
      return bot.sendMessage(chatId, '❌ This match is not available for playing.');
    }
    
    // Convert team1/team2 to the internal team play types
    const teamplay = teamPosition === 'team1' ? 
      matchplaying.teamplayTypes.TEAM1 : 
      matchplaying.teamplayTypes.TEAM2;
    
    // Place the play
    const result = matchplaying.placeTeamplay(
      chatId, 
      matchId, 
      teamplay, 
      amount, 
      users[chatId].points, 
      updateUserPoints
    );
    
    if (!result.success) {
      return bot.sendMessage(chatId, `❌ ${result.message}`);
    }
    
    // Save data
    saveData();
    
    // Send confirmation to user
    bot.sendMessage(
      chatId,
      `✅ *play Placed Successfully*\n\n` +
      `Match: ${result.playInfo.teamplay}\n` +
      `Amount: ${result.playInfo.amount} points\n` +
      `Odds: ${result.playInfo.odds.toFixed(2)}x\n` +
      `Potential Win: ${result.playInfo.potential} points`,
      { 
        parse_mode: 'Markdown', 
        reply_markup: createMainMenu(chatId) 
      }
    );
  });
  
  // Add /matches command to view active matches
  bot.onText(/\/matches/, (msg) => {
    const chatId = msg.chat.id;
    
    if (!users[chatId]) {
      return bot.sendMessage(chatId, '⚠️ Please /start to register first.');
    }
    
    const matches = matchplaying.getActiveMatchesWithOdds();
    
    if (matches.length === 0) {
      return bot.sendMessage(
        chatId,
        '❌ No matches are currently open for playing.',
        { reply_markup: createMainMenu(chatId) }
      );
    }
    
    let message = '🏏 *Active Matches*\n\n';
    
    matches.forEach(match => {
      message += `*ID ${match.matchId}: ${match.team1} vs ${match.team2}*\n`;
      message += `${match.team1}: ${match.team1Odds.toFixed(2)}x\n`;
      message += `${match.team2}: ${match.team2Odds.toFixed(2)}x\n\n`;
    });
    
    message += 'To place a play use:\n/matchplay [matchId] [team1|team2] [amount]';
    
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown', 
      reply_markup: { 
        inline_keyboard: [
          [{ text: '🎲 Place play', callback_data: 'list_matches' }],
          [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
        ] 
      }
    });
  })
  
  // Function to escape Markdown characters in a URL
  const escapeMarkdown = (text) => {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  };
  
  // Add /link command to generate and share referral links
  bot.onText(/\/link/, (msg) => {
    const chatId = msg.chat.id;
    
    if (!users[chatId]) {
      return bot.sendMessage(chatId, '⚠️ Please /start to register first.');
    }
    
    const username = users[chatId].username || msg.from.username || null;
    const referralLink = referralSystem.generateReferralLink(chatId, username);
    const stats = referralSystem.getUserReferralStats(chatId);
    
    // Use a plain text approach to avoid markdown parsing issues
    safeSendMessage(
      chatId,
      `🔗 Your Referral Link\n\n` +
      `Share this link with friends to earn ${referralSystem.REFERRAL_REWARD} points for each new user who joins!\n\n` +
      `${referralLink}\n\n` +
      `👥 Your referrals: ${stats.totalReferrals}\n` +
      `💰 Points earned: ${stats.pointsEarned}`,
      { 
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Share Link', url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join IPL play Bot and get 20 points to start playing!')}` }],
            [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
          ]
        }
      }
    );
  });

  // Add a helper function to safely send messages with error handling
  const safeSendMessage = async (chatId, text, options = {}) => {
    try {
      return await bot.sendMessage(chatId, text, options);
    } catch (error) {
      console.error(`Error sending message to ${chatId}:`, error.message || error);
      
      // If it's a markdown parsing error, try to send without markdown
      if (error.message && error.message.includes("parse entities")) {
        try {
          // Remove parse_mode and attempt to send plaintext
          const plainOptions = { ...options };
          delete plainOptions.parse_mode;
          
          return await bot.sendMessage(
            chatId, 
            "⚠️ Error displaying formatted message. Here's a plain version:\n\n" + 
            text.replace(/\*|_|\[|\]|\(|\)|~|`|>|#|\+|-|=|\||\{|\}|\.|!/g, ''), 
            plainOptions
          );
        } catch (fallbackError) {
          console.error(`Failed to send fallback message to ${chatId}:`, fallbackError);
        }
      }
      return null;
    }
  };

  // Add a helper function for safely editing messages
  const safeEditMessageText = async (text, options = {}) => {
    try {
      return await bot.editMessageText(text, options);
    } catch (error) {
      // Ignore "message is not modified" errors as they are not actual errors
      if (error.message && error.message.includes("message is not modified")) {
        // This is normal behavior when content hasn't changed
        return null;
      }
      
      console.error(`Error editing message:`, error.message || error);
      
      // If it's a markdown parsing error, try to edit without markdown
      if (error.message && error.message.includes("parse entities")) {
        try {
          // Remove parse_mode and attempt to send plaintext
          const plainOptions = { ...options };
          delete plainOptions.parse_mode;
          
          return await bot.editMessageText(
            "⚠️ Error displaying formatted message. Here's a plain version:\n\n" + 
            text.replace(/\*|_|\[|\]|\(|\)|~|`|>|#|\+|-|=|\||\{|\}|\.|!/g, ''), 
            plainOptions
          );
        } catch (fallbackError) {
          // Ignore "message is not modified" errors in the fallback too
          if (fallbackError.message && fallbackError.message.includes("message is not modified")) {
            return null;
          }
          console.error(`Failed to edit with fallback message:`, fallbackError);
        }
      }
      return null;
    }
  };

// Function to handle potential callback errors from missing callbacks
const handleCallbackErrors = async () => {
  process.on('unhandledRejection', (error) => {
    if (error.message && error.message.includes("messageId is not defined")) {
      console.error("Caught messageId undefined error - this is a non-critical error");
    } else if (error.message && error.message.includes("message is not modified")) {
      // Ignore "message is not modified" errors as they are not actual errors
      return;
    } else {
      console.error('Unhandled Rejection:', error.message || error);
    }
  });
};

// Activate the error handler
handleCallbackErrors();

const processResult = (adminId, overNumber, runs) => {
  try {
    // Store the result
    overRunResult[overNumber] = runs;
    
    // Determine result type (OVER or UNDER)
    const resultType = runs > 8.5 ? playTypes.OVER : playTypes.UNDER;
    
    // Process all plays for this over
    let totalWins = 0;
    let totalLosses = 0;
    let winningUsers = [];
    
    // Check if there are any plays for this over
    if (!overplays[overNumber]) {
      overplays[overNumber] = {};
    }
    
    // Get all users who had plays on this over
    const userIds = Object.keys(overplays[overNumber] || {});
    
    for (const userId of userIds) {
      // Skip if user doesn't exist (should never happen but just in case)
      if (!users[userId]) continue;
      
      const userPlays = overplays[overNumber][userId] || [];
      
      for (const play of userPlays) {
        // Skip if play is already processed
        if (play.processed) continue;
        
        const amount = play.amount;
        const odds = play.odds || INITIAL_ODDS; // Use default odds if not set
        const playType = play.playType;
        
        // Check if the play wins
        const isWin = playType === resultType;
        
        // Calculate win amount
        const winAmount = isWin ? Math.floor(amount * odds) : 0;
        
        // Update play with result
        play.result = resultType;
        play.isWin = isWin;
        play.processed = true;
        play.processedAt = Date.now();
        
        if (isWin) {
          // Update user points for winners
          updateUserPoints(userId, winAmount);
          totalWins += winAmount;
          
          // Track winning users for notification
          winningUsers.push({
            userId,
            name: users[userId].name,
            amount: winAmount
          });
        } else {
          // No need to deduct points again as they were already deducted when placing the play
          totalLosses += amount;
        }
      }
    }
    
    // Save updated data
    saveData();
    
    // Send result notification to admin
    let resultMessage = `✅ Result processed for Over ${overNumber}\n` +
                        `Runs: ${runs}\n` +
                        `Result: ${resultType === playTypes.OVER ? 'OVER' : 'UNDER'} 8.5\n\n` +
                        `Total Wins: ${totalWins}\n` +
                        `Total Losses: ${totalLosses}\n\n`;
    
    if (winningUsers.length > 0) {
      resultMessage += `🏆 Winners:\n` + 
                       winningUsers.map(u => `${u.name}: +${u.amount}`).join('\n');
    } else {
      resultMessage += `No winners for this over.`;
    }
    
    bot.sendMessage(adminId, resultMessage);
    
    // Send notifications to users about their results
    for (const userId of userIds) {
      if (!users[userId]) continue;
      
      const userPlays = overplays[overNumber][userId] || [];
      const userWins = userPlays.filter(p => p.isWin);
      const userLosses = userPlays.filter(p => !p.isWin);
      
      if (userPlays.length > 0) {
        let userMessage = `📢 *Result for Over ${overNumber}*\n` +
                          `Runs: ${runs}\n` +
                          `Result: ${resultType === playTypes.OVER ? 'OVER' : 'UNDER'} 8.5\n\n`;
        
        if (userWins.length > 0) {
          const totalWinAmount = userWins.reduce((sum, p) => sum + Math.floor(p.amount * (p.odds || INITIAL_ODDS)), 0);
          userMessage += `🎉 *You Won!*\n` +
                         `Amount: +${totalWinAmount} points\n\n`;
        }
        
        if (userLosses.length > 0) {
          const totalLostAmount = userLosses.reduce((sum, p) => sum + p.amount, 0);
          userMessage += `You lost ${totalLostAmount} points.\n\n`;
        }
        
        userMessage += `Your current balance: ${users[userId].points} points`;
        
        // Send result notification to the user
        bot.sendMessage(userId, userMessage, { parse_mode: 'Markdown' })
          .catch(err => console.error(`Failed to send result to user ${userId}:`, err));
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error processing result:', error);
    bot.sendMessage(adminId, `❌ Error processing result: ${error.message}`);
    return false;
  }
};

// Add a command for deposit/withdraw points
bot.onText(/\/deposit/, (msg) => {
  const chatId = msg.chat.id;
  if (!users[chatId]) return bot.sendMessage(chatId, '❌ You are not registered. Use /start');
  
  // Require authentication
  if (!auth.checkAndRequireAuth(chatId, bot, users)) return;
  
  bot.sendMessage(
    chatId,
    `💵 *Add or Withdraw Points*\n\n` +
    `To add or withdraw points, please share your points amount to:\n\n` +
    `@letsgoo234\n\n` +
    `Current balance: ${users[chatId].points} points`,
    { 
      parse_mode: 'Markdown',
      reply_markup: { 
        inline_keyboard: [[{ text: '⬅️ Back to Menu', callback_data: 'main_menu' }]]
      }
    }
  );
});

// Add a command for admins to send broadcasts to all users
bot.onText(/\/send/, (msg) => {
  const chatId = msg.chat.id;
  
  // Check if the user is registered
  if (!users[chatId]) return bot.sendMessage(chatId, '❌ You are not registered. Use /start');
  
  // Check if the user is an admin
  if (!isAdmin(chatId)) {
    return bot.sendMessage(chatId, '❌ This command is only available to admins.');
  }
  
  // Set the state to waiting for broadcast message
  states[chatId] = 'waiting_broadcast';
  
  bot.sendMessage(
    chatId,
    `📣 *Admin Broadcast*\n\n` +
    `Please enter the message you want to send to all users:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: { 
        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'main_menu' }]]
      }
    }
  );
});