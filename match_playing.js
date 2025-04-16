// Match Winner playting Component for IPL playting Bot
// This component handles playting on which team will win the match

// Initial odds are 1.9 for both teams (same as over/under system)
const INITIAL_ODDS = 1.9;

// Store active matches and playting data
let activeMatches = {}; // matchId => { team1, team2, active }
let matchplays = {}; // matchId => { userId: [playInfo1, playInfo2, ...] }
let matchResults = {}; // matchId => winningTeam
let matchStats = {}; // matchId => { team1Odds, team2Odds, team1Amount, team2Amount }

// Function to initialize a new match for playting
const createMatch = (matchId, team1, team2) => {
  activeMatches[matchId] = {
    team1,
    team2,
    active: true,
    createdAt: new Date().toISOString()
  };
  
  matchStats[matchId] = {
    team1Odds: INITIAL_ODDS,
    team2Odds: INITIAL_ODDS,
    team1Amount: 0,
    team2Amount: 0
  };
  
  matchplays[matchId] = {};
  
  return activeMatches[matchId];
};

// Function to close playting on a match
const closeMatch = (matchId) => {
  if (!activeMatches[matchId]) {
    return false;
  }
  
  activeMatches[matchId].active = false;
  return true;
};

// Function to set the result of a match
const setMatchResult = (matchId, winningTeam) => {
  if (!activeMatches[matchId]) {
    return false;
  }
  
  matchResults[matchId] = winningTeam;
  return true;
};

// Team play types
const teamplayTypes = {
  TEAM1: 'team1',
  TEAM2: 'team2'
};

// Place a play on a team
const placeTeamplay = (userId, matchId, teamplay, amount, userPoints, updateUserPoints) => {
  // Validate match exists and is active
  if (!activeMatches[matchId] || !activeMatches[matchId].active) {
    return { success: false, message: 'This match is not available for playting.' };
  }
  
  // Validate user has enough points
  if (userPoints < amount) {
    return { success: false, message: `Not enough points to play (Need ${amount}, you have ${userPoints}).` };
  }
  
  // Initialize match stats if needed
  if (!matchStats[matchId]) {
    matchStats[matchId] = {
      team1Odds: INITIAL_ODDS,
      team2Odds: INITIAL_ODDS,
      team1Amount: 0,
      team2Amount: 0
    };
  }
  
  // Get current odds before placing the play
  const currentOdds = teamplay === teamplayTypes.TEAM1 
    ? matchStats[matchId].team1Odds 
    : matchStats[matchId].team2Odds;
  
  // Deduct points from user
  updateUserPoints(userId, -amount);
  
  // Create the new play info
  const newplay = {
    teamplay,
    amount,
    odds: currentOdds,
    timestamp: new Date().toISOString()
  };
  
  // Initialize the plays structure if needed
  if (!matchplays[matchId]) {
    matchplays[matchId] = {};
  }
  
  // Add the play to the user's play array for this match
  if (!matchplays[matchId][userId]) {
    matchplays[matchId][userId] = [];
  }
  
  // Add the new play to the array
  matchplays[matchId][userId].push(newplay);
  
  // Update amounts play on each team
  if (teamplay === teamplayTypes.TEAM1) {
    matchStats[matchId].team1Amount += amount;
  } else {
    matchStats[matchId].team2Amount += amount;
  }
  
  // Save current amounts for odds calculation reference
  const oldTeam1Amount = matchStats[matchId].team1Amount;
  const oldTeam2Amount = matchStats[matchId].team2Amount;
  
  // Recalculate odds
  const newOdds = calculateTeamOdds(matchId);
  matchStats[matchId].team1Odds = newOdds.team1Odds;
  matchStats[matchId].team2Odds = newOdds.team2Odds;
  
  // Return success with play info
  const teamName = teamplay === teamplayTypes.TEAM1 ? activeMatches[matchId].team1 : activeMatches[matchId].team2;
  
  return {
    success: true,
    message: `play placed successfully on ${teamName}!`,
    playInfo: {
      matchId,
      teamplay: teamName,
      amount,
      odds: currentOdds,
      potential: Math.floor(amount * currentOdds)
    },
    stats: {
      team1Odds: matchStats[matchId].team1Odds,
      team2Odds: matchStats[matchId].team2Odds,
      team1Amount: matchStats[matchId].team1Amount,
      team2Amount: matchStats[matchId].team2Amount
    }
  };
};

// Calculate dynamic odds based on play amounts for teams
const calculateTeamOdds = (matchId) => {
  if (!matchStats[matchId]) {
    return { team1Odds: INITIAL_ODDS, team2Odds: INITIAL_ODDS };
  }
  
  const stats = matchStats[matchId];
  const team1Amount = stats.team1Amount || 0;
  const team2Amount = stats.team2Amount || 0;
  
  // If no plays on either side, use initial odds
  if (team1Amount === 0 && team2Amount === 0) {
    return { team1Odds: INITIAL_ODDS, team2Odds: INITIAL_ODDS };
  }
  
  // Start with the initial odds
  let team1Odds = INITIAL_ODDS;
  let team2Odds = INITIAL_ODDS;
  
  // Calculate the ratio playween sides and adjust odds accordingly
  if (team1Amount > 0 && team2Amount === 0) {
    // Only plays on TEAM1
    // If one user plays 10 pts on team1 and 0 on team2, diff is 100%
    // Increase team2 odds by 0.05, decrease team1 odds by 0.05
    const ratio = 1.0; // 100%
    team2Odds += 0.05;
    team1Odds -= 0.05;
    
    console.log(`Match ${matchId} - Only plays on ${activeMatches[matchId].team1} (${team1Amount} pts). Ratio: ${ratio * 100}%`);
  } else if (team2Amount > 0 && team1Amount === 0) {
    // Only plays on TEAM2
    // If one user plays 10 pts on team2 and 0 on team1, diff is 100%
    // Increase team1 odds by 0.05, decrease team2 odds by 0.05
    const ratio = 1.0; // 100%
    team1Odds += 0.05;
    team2Odds -= 0.05;
    
    console.log(`Match ${matchId} - Only plays on ${activeMatches[matchId].team2} (${team2Amount} pts). Ratio: ${ratio * 100}%`);
  } else if (team1Amount > 0 && team2Amount > 0) {
    // plays on both teams
    if (team1Amount > team2Amount) {
      // More plays on TEAM1
      const ratio = team1Amount / team2Amount;
      
      // Apply adjustments based on ratio
      const adjustment = Math.min(0.5, Math.floor(ratio * 100) / 100 * 0.05);
      team2Odds += adjustment;
      team1Odds -= adjustment;
      
      console.log(`Match ${matchId} - More on ${activeMatches[matchId].team1} (${team1Amount} vs ${team2Amount}). Ratio: ${ratio.toFixed(2)}. Adjustment: ${adjustment.toFixed(2)}`);
    } else if (team2Amount > team1Amount) {
      // More plays on TEAM2
      const ratio = team2Amount / team1Amount;
      
      // Apply adjustments based on ratio
      const adjustment = Math.min(0.5, Math.floor(ratio * 100) / 100 * 0.05);
      team1Odds += adjustment;
      team2Odds -= adjustment;
      
      console.log(`Match ${matchId} - More on ${activeMatches[matchId].team2} (${team2Amount} vs ${team1Amount}). Ratio: ${ratio.toFixed(2)}. Adjustment: ${adjustment.toFixed(2)}`);
    }
    // If equal amounts on both teams, no adjustment needed
  }
  
  // Ensure odds stay within reasonable bounds
  team1Odds = Math.max(1.1, Math.min(3.0, team1Odds));
  team2Odds = Math.max(1.1, Math.min(3.0, team2Odds));
  
  // Round to 2 decimal places
  team1Odds = Math.round(team1Odds * 100) / 100;
  team2Odds = Math.round(team2Odds * 100) / 100;
  
  // Calculate the margin for reporting
  const impliedProb = (1/team1Odds) + (1/team2Odds);
  const margin = 1 - (1 / impliedProb);
  
  console.log(`Match ${matchId} - Final Odds: ${activeMatches[matchId].team1}=${team1Odds.toFixed(2)} ${activeMatches[matchId].team2}=${team2Odds.toFixed(2)} - Margin: ${(margin*100).toFixed(1)}%`);
  
  return { team1Odds, team2Odds };
};

// Process match result and handle payouts
const processMatchResult = (matchId, winningTeam, users, updateUserPoints) => {
  if (!activeMatches[matchId]) {
    return { success: false, message: `Match ${matchId} not found` };
  }
  
  const match = activeMatches[matchId];
  const plays = matchplays[matchId];
  
  if (!plays || Object.keys(plays).length === 0) {
    return { success: false, message: `No plays found for Match ${matchId}` };
  }
  
  // If only one user play, return their points
  const uniqueUsers = Object.keys(plays).length;
  let totalplayCount = 0;
  Object.values(plays).forEach(userplays => {
    totalplayCount += userplays.length;
  });
  
  if (uniqueUsers === 1) {
    const userId = Object.keys(plays)[0];
    const userplays = plays[userId];
    let totalAmount = 0;
    
    userplays.forEach(play => {
      totalAmount += play.amount;
    });
    
    updateUserPoints(userId, totalAmount);
    
    return { 
      success: true, 
      message: `Only one user play on Match ${matchId}. Returning ${totalAmount} points to ${users[userId] ? users[userId].name : userId}.`,
      onlyUser: userId,
      amount: totalAmount
    };
  }
  
  // Determine winning team
  let winningType;
  if (winningTeam === match.team1) {
    winningType = teamplayTypes.TEAM1;
  } else if (winningTeam === match.team2) {
    winningType = teamplayTypes.TEAM2;
  } else {
    return { success: false, message: `Invalid winning team: ${winningTeam}` };
  }
  
  // Process all plays
  const winners = [];
  const losers = [];
  
  for (const userId in plays) {
    const userplays = plays[userId];
    let userWinAmount = 0;
    let userLossAmount = 0;
    
    // Process each play for this user
    userplays.forEach(playInfo => {
      if (playInfo.teamplay === winningType) {
        // Winner
        const winAmount = Math.floor(playInfo.amount * playInfo.odds);
        updateUserPoints(userId, winAmount);
        userWinAmount += winAmount;
        
        winners.push({
          userId,
          playInfo,
          winAmount
        });
      } else {
        // Loser
        userLossAmount += playInfo.amount;
        
        losers.push({
          userId,
          playInfo
        });
      }
    });
  }
  
  // Aggregate winners by user for display
  const userWinnings = {};
  winners.forEach(winner => {
    const userId = winner.userId;
    if (!userWinnings[userId]) {
      userWinnings[userId] = {
        name: users[userId] ? users[userId].name : userId,
        totalWin: 0,
        totalplay: 0,
        playCount: 0
      };
    }
    userWinnings[userId].totalWin += winner.winAmount;
    userWinnings[userId].totalplay += winner.playInfo.amount;
    userWinnings[userId].playCount += 1;
  });
  
  // Aggregate losers by user for display
  const userLosses = {};
  losers.forEach(loser => {
    const userId = loser.userId;
    if (!userLosses[userId]) {
      userLosses[userId] = {
        name: users[userId] ? users[userId].name : userId,
        totalLoss: 0,
        playCount: 0
      };
    }
    userLosses[userId].totalLoss += loser.playInfo.amount;
    userLosses[userId].playCount += 1;
  });
  
  return {
    success: true,
    message: `Results processed for Match ${matchId}`,
    match,
    winningTeam,
    stats: {
      totalplayCount,
      uniqueUsers,
      winners: Object.values(userWinnings),
      losers: Object.values(userLosses)
    }
  };
};

// Get active matches with odds for keyboard display
const getActiveMatchesWithOdds = () => {
  const result = [];
  
  Object.entries(activeMatches)
    .filter(([, match]) => match.active)
    .forEach(([matchId, match]) => {
      if (!matchStats[matchId]) {
        matchStats[matchId] = {
          team1Odds: INITIAL_ODDS,
          team2Odds: INITIAL_ODDS,
          team1Amount: 0,
          team2Amount: 0
        };
      }
      
      const stats = matchStats[matchId];
      const volume = stats.team1Amount + stats.team2Amount;
      
      result.push({
        matchId,
        team1: match.team1,
        team2: match.team2,
        team1Odds: stats.team1Odds,
        team2Odds: stats.team2Odds,
        volume
      });
    });
  
  return result;
};

// Get match details by ID
const getMatchDetails = (matchId) => {
  if (!activeMatches[matchId]) {
    return null;
  }
  
  if (!matchStats[matchId]) {
    matchStats[matchId] = {
      team1Odds: INITIAL_ODDS,
      team2Odds: INITIAL_ODDS,
      team1Amount: 0,
      team2Amount: 0
    };
  }
  
  return {
    matchId,
    ...activeMatches[matchId],
    ...matchStats[matchId]
  };
};

// Get save data for persistence
const getSaveData = () => {
  return {
    activeMatches,
    matchplays,
    matchResults,
    matchStats
  };
};

// Load saved data
const loadSavedData = (data) => {
  if (data.activeMatches) activeMatches = data.activeMatches;
  if (data.matchplays) matchplays = data.matchplays;
  if (data.matchResults) matchResults = data.matchResults;
  if (data.matchStats) matchStats = data.matchStats;
};

module.exports = {
  createMatch,
  closeMatch,
  setMatchResult,
  placeTeamplay,
  calculateTeamOdds,
  processMatchResult,
  getActiveMatchesWithOdds,
  getMatchDetails,
  getSaveData,
  loadSavedData,
  teamplayTypes
}; 