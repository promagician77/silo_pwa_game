// ====== SUPABASE CONFIGURATION ======
// Supabase project URL and anonymous key for authentication and database access
// These credentials allow the app to connect to Supabase backend services
const SUPABASE_URL ='https://uaulpmynwouftajunuso.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhdWxwbXlud291ZnRhanVudXNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyNzkzNTIsImV4cCI6MjA3Njg1NTM1Mn0.P5Mq6v01VAYqZD0NZ-_NYepoHzhGEwgt9GWbgef0KI0';

// ====== SUPABASE CLIENT INITIALIZATION ======
// Create Supabase client instance for database and authentication operations
// This client is used throughout the app for user auth, wallet management, and leaderboard
let supabaseClient = null;
try {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('[Supabase] Client initialized');
} catch (error) {
  console.error('[Supabase] Failed to initialize client:', error);
}

// ====== GAME AUTHENTICATION API ======
// This object provides the interface between the game engine (Defold) and the authentication system
// The game engine calls these methods to check auth status, get tokens, start sessions, and record scores
window.GameAuth = {
  // ====== GET AUTHENTICATION MODE ======
  // Returns the current authentication mode: 'guest' or 'email'
  // Called by the game engine to determine if user is signed in
  getMode: function() {
    return Promise.resolve(window.GAME_AUTH_MODE || 'guest');
  },
  
  // ====== GET TOKEN BALANCE ======
  // Retrieves the user's token balance from the wallets table
  // Only works for signed-in users (email mode)
  // Guests always return null (no tokens)
  // If wallet doesn't exist, creates one with 10 default tokens
  // Database query: SELECT tokens FROM wallets WHERE user_id = current_user
  getTokens: async function() {
    // ====== GUEST MODE CHECK ======
    // Guests don't have tokens - return null immediately
    if (window.GAME_AUTH_MODE !== 'email' || !supabaseClient) {
      return Promise.resolve(null); // Guests have no tokens
    }

    try {
      // ====== GET AUTHENTICATED USER ======
      // Verify user is signed in before querying wallet
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) {
        console.log('[GameAuth] No authenticated user');
        return null;
      }

      // ====== QUERY WALLET TABLE ======
      // Use maybeSingle() to handle case where wallet doesn't exist yet
      // This prevents errors for new users who haven't played yet
      const { data, error } = await supabaseClient
        .from('wallets')
        .select('tokens')
        .eq('user_id', user.id)
        .maybeSingle();

      // ====== CREATE WALLET IF MISSING ======
      // If wallet doesn't exist, create one with default 10 tokens
      // PGRST116 error code means "no rows returned" (expected for new users)
      if (error || !data) {
        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
          console.error('[GameAuth] Error fetching tokens:', error);
          return null;
        }
        
        // Wallet doesn't exist - create it with default 10 tokens
        console.log('[GameAuth] Wallet not found, creating new wallet for user');
        const { data: newWallet, error: createError } = await supabaseClient
          .from('wallets')
          .insert({ user_id: user.id, tokens: 10 })
          .select('tokens')
          .single();
        
        if (createError || !newWallet) {
          console.error('[GameAuth] Error creating wallet:', createError);
          return null;
        }
        
        console.log('[GameAuth] New wallet created with 10 tokens');
        return newWallet.tokens;
      }

      // ====== RETURN TOKEN BALANCE ======
      // Return the user's current token balance
      const tokens = data?.tokens || 0;
      console.log('[GameAuth] User tokens:', tokens);
      return tokens;
    } catch (error) {
      console.error('[GameAuth] Exception in getTokens:', error);
      return null;
    }
  },
  
  // ====== START GAME SESSION ======
  // Called when a new game session begins
  // For signed-in users: creates a game_sessions entry and deducts 1 token from wallet
  // For guests: always allows (no token deduction, no database entry)
  // Returns true if session started successfully, false otherwise
  startSession: async function() {
    console.log('[GameAuth] Starting session in mode:', window.GAME_AUTH_MODE);
    
    // ====== GUEST MODE ======
    // Guests can always play - no token check, no database entry
    if (window.GAME_AUTH_MODE !== 'email' || !supabaseClient) {
      // Guest mode: always allow, no token deduction
      return Promise.resolve(true);
    }

    try {
      // ====== VERIFY USER AUTHENTICATION ======
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) {
        console.log('[GameAuth] No authenticated user for session start');
        return false;
      }

      // ====== CHECK WALLET AND TOKEN BALANCE ======
      // Check if user has tokens (use maybeSingle to handle case where wallet doesn't exist)
      const { data: walletData, error: walletError } = await supabaseClient
        .from('wallets')
        .select('tokens')
        .eq('user_id', user.id)
        .maybeSingle();

      // ====== CREATE WALLET IF MISSING ======
      // If wallet doesn't exist, create one with default tokens
      let wallet = walletData;
      if (walletError || !walletData) {
        if (walletError && walletError.code !== 'PGRST116') { // PGRST116 = no rows returned
          console.error('[GameAuth] Error checking wallet:', walletError);
          console.log(walletError.code)
          return false;
        }
        
        // Wallet doesn't exist - create it with default 10 tokens
        console.log('[GameAuth] Wallet not found, creating new wallet for user');
        const { data: newWallet, error: createError } = await supabaseClient
          .from('wallets')
          .insert({ user_id: user.id, tokens: 10 })
          .select('tokens')
          .single();
        
        if (createError || !newWallet) {
          console.error('[GameAuth] Error creating wallet:', createError);
          return false;
        }
        
        wallet = newWallet;
        console.log('[GameAuth] New wallet created with 10 tokens');
      }

      // ====== CHECK TOKEN BALANCE ======
      // User needs at least 1 token to start a session
      if (wallet.tokens < 1) {
        console.log('[GameAuth] Insufficient tokens to start session');
        window.GAME_AUTH_MODE = 'guest';
        console.log('[GameAuth] Switching to guest mode due to insufficient tokens');
        if (window.notyf) {
          window.notyf.error('Due to insufficient tokens, you have been switched to guest mode');
        }
        return false;
      }

      // ====== CREATE GAME SESSION ENTRY ======
      // Create a record in game_sessions table to track this play session
      // Note: Status must match database CHECK constraint game_sessions_status_check
      // Common values: 'in_progress', 'in-progress', 'started', 'pending'
      const sessionData = {
        user_id: user.id,
        status: 'in_progress',  // Changed to match database constraint (RLS policy mentions "in-progress")
        started_at: new Date().toISOString(),
        client_hash: window.location.hash || 'web'
      };

      const { data: session, error: sessionError } = await supabaseClient
        .from('game_sessions')
        .insert(sessionData)
        .select()
        .single();

      if (sessionError) {
        console.error('[GameAuth] Error creating game session:', sessionError);
        return false;
      }

      // ====== DEDUCT TOKEN FROM WALLET ======
      // Deduct 1 token as payment for starting the game session
      const { error: updateError } = await supabaseClient
        .from('wallets')
        .update({ 
          tokens: wallet.tokens - 1,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id);

      if (updateError) {
        console.error('[GameAuth] Error deducting token:', updateError);
        // ====== ROLLBACK SESSION CREATION ======
        // If token deduction fails, delete the session we just created (transaction rollback)
        await supabaseClient
          .from('game_sessions')
          .delete()
          .eq('id', session.id);
        return false;
      }

      // ====== STORE SESSION ID ======
      // Store session ID for later use (to update when game ends with final score)
      window.CURRENT_SESSION_ID = session.id;
      console.log('[GameAuth] Session started successfully, session ID:', session.id);
      return true;
    } catch (error) {
      console.error('[GameAuth] Exception in startSession:', error);
      return false;
    }
  },
  
  // ====== RECORD SCORE TO LEADERBOARD ======
  // Called when a game ends to save the player's score
  // For signed-in users: inserts score into leaderboard table and updates game_sessions
  // For guests: score is not recorded (returns false)
  // Database operations:
  //   - INSERT into leaderboard: user_id, email, score, created_at
  //   - UPDATE game_sessions: status='completed', ended_at, duration_seconds, score
  recordScore: async function(score) {
    // ====== GUEST MODE CHECK ======
    // Guests don't have scores recorded - return false immediately
    if (window.GAME_AUTH_MODE !== 'email' || !supabaseClient) {
      console.log('[GameAuth] Guest mode - score not recorded:', score);
      return Promise.resolve(false);
    }

    try {
      // ====== VERIFY USER AUTHENTICATION ======
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) {
        console.log('[GameAuth] No authenticated user for score submission');
        return false;
      }

      // ====== GET USER EMAIL ======
      // Use email for leaderboard display
      const userEmail = user.email || 'unknown@example.com';

      // ====== INSERT SCORE INTO LEADERBOARD ======
      // Add the score to the leaderboard table for ranking
      const { data, error } = await supabaseClient
        .from('leaderboard')
        .insert({
          user_id: user.id,
          email: userEmail,
          score: parseInt(score) || 0,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('[GameAuth] Error recording score:', error);
        return false;
      }

      // ====== UPDATE GAME SESSION ======
      // If a session was started (has CURRENT_SESSION_ID), update it with final score and duration
      if (window.CURRENT_SESSION_ID) {
        // Get the session to find start time for duration calculation
        const { data: sessionData } = await supabaseClient
          .from('game_sessions')
          .select('started_at')
          .eq('id', window.CURRENT_SESSION_ID)
          .single();

        // ====== CALCULATE SESSION DURATION ======
        const endTime = new Date();
        const startTime = sessionData?.started_at ? new Date(sessionData.started_at) : endTime;
        const durationSeconds = Math.floor((endTime - startTime) / 1000);

        // ====== UPDATE SESSION STATUS ======
        // Mark session as completed and record final score and duration
        await supabaseClient
          .from('game_sessions')
          .update({
            status: 'completed',
            ended_at: endTime.toISOString(),
            duration_seconds: durationSeconds,
            score: parseInt(score) || 0
          })
          .eq('id', window.CURRENT_SESSION_ID);

        // Clear session ID after updating
        window.CURRENT_SESSION_ID = null;
      }

      console.log('[GameAuth] Score recorded successfully:', score);
      return true;
    } catch (error) {
      console.error('[GameAuth] Exception in recordScore:', error);
      return false;
    }
  },
  
  // ====== GET TOP SCORES ======
  // Retrieves the top N scores from the leaderboard
  // Returns an array of score objects with rank, email, score, and created_at
  // Limit is capped at 100 for performance
  getTopScores: async function(limit) {
    console.log('[GameAuth] Getting top scores:', limit);
    
    // ====== SUPABASE CHECK ======
    // Return empty array if Supabase is not available
    if (!supabaseClient) {
      console.log('[GameAuth] Supabase not configured, returning empty leaderboard');
      return Promise.resolve([]);
    }

    try {
      // ====== SET QUERY LIMIT ======
      // Cap limit at 100 for performance, default to 10 if not specified
      const queryLimit = Math.min(parseInt(limit) || 10, 100);

      // ====== QUERY LEADERBOARD ======
      // Fetch top scores ordered by score (descending)
      const { data, error } = await supabaseClient
        .from('leaderboard')
        .select('email, score, created_at')
        .order('score', { ascending: false })
        .limit(queryLimit);

      if (error) {
        console.error('[GameAuth] Error fetching top scores:', error);
        return [];
      }

      // ====== FORMAT RESULTS ======
      // Add rank numbers and ensure all fields are present
      const results = (data || []).map((row, index) => ({
        rank: index + 1,
        email: row.email || 'unknown',
        score: row.score || 0,
        created_at: row.created_at || new Date().toISOString()
      }));

      console.log('[GameAuth] Fetched top', results.length, 'scores');
      return results;
    } catch (error) {
      console.error('[GameAuth] Exception in getTopScores:', error);
      return [];
    }
  },
  
  // ====== CHECK IF FIRST SIGN-IN ======
  // Determines if this is the user's first email sign-in
  // Uses localStorage to track if notification has been shown
  // Returns true only on the very first email sign-in
  isFirstSignIn: function() {
    try {
      // ====== CHECK LOCALSTORAGE FLAG ======
      // Check if we've already shown the first sign-in notification
      const hasSeenNotification = localStorage.getItem('email_signin_notification_shown');
      if (hasSeenNotification === 'true') {
        return false; // User has seen notification before
      }
      
      // ====== DETECT FIRST SIGN-IN ======
      // Check if we're in email mode and flag is not set (first sign-in)
      if (window.GAME_AUTH_MODE === 'email' && !hasSeenNotification) {
        // Mark as shown in localStorage so we don't show it again
        localStorage.setItem('email_signin_notification_shown', 'true');
        console.log('[GameAuth] First sign-in detected, notification will be shown');
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('[GameAuth] Exception in isFirstSignIn:', error);
      return false;
    }
  }
};

// ====== INITIALIZATION LOG ======
console.log('[App] GameAuth API initialized (immediate)');

// ====== DEFOLD BRIDGE INITIALIZATION ======
// Initialize bridge helper object for communication between JavaScript and Defold game engine
// This object allows the game engine to call JavaScript functions
if (!window.__defold_bridge) {
  window.__defold_bridge = {};
  console.log('[App] Defold bridge initialized (immediate)');
}

// ====== DEFAULT AUTH MODE ======
// Set default authentication mode to 'guest' if not already set
// This ensures the game always has a valid auth mode
if (!window.GAME_AUTH_MODE) {
  window.GAME_AUTH_MODE = 'guest';
  console.log('[App] Default GAME_AUTH_MODE set to "guest"');
}

// ====== EMAIL CONFIRMATION HANDLER ======
// Handles the callback when user clicks the magic link in their email
// Supabase redirects back to the app with tokens in the URL hash
// This function extracts the tokens and sets up the user session
async function handleEmailConfirmation() {
  if (!supabaseClient) return;

  try {
    // ====== EXTRACT TOKENS FROM URL HASH ======
    // Supabase redirects back to the app with authentication tokens in the URL hash
    // Format: #access_token=xxx&refresh_token=yyy&type=magiclink
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    const type = hashParams.get('type');

    // ====== HANDLE MAGIC LINK CONFIRMATION ======
    // Process magic link, signup, or password recovery confirmations
    if (type === 'recovery' || type === 'signup' || type === 'magiclink') {
      if (accessToken && refreshToken) {
        // ====== SET USER SESSION ======
        // Use the tokens to establish an authenticated session
        const { data, error } = await supabaseClient.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });

        if (error) {
          console.error('[Auth] Error setting session:', error);
          return;
        }

        if (data.user) {
          console.log('[Auth] Email confirmed, user signed in:', data.user.email);
          // ====== CLEAN UP URL ======
          // Remove tokens from URL for security and cleaner appearance
          window.history.replaceState(null, '', window.location.pathname);
          // ====== SET AUTH MODE ======
          window.GAME_AUTH_MODE = 'email';
          if (!localStorage.getItem('email_signin_notification_shown')) {
            console.log('[Auth] First email sign-in detected');
          }
          // ====== AUTO-START GAME ======
          // Flag to automatically start the game after email confirmation
          window.AUTO_START_EMAIL = true;
        }
      }
    }
  } catch (error) {
    console.error('[Auth] Error handling email confirmation:', error);
  }
}

// ====== CHECK EXISTING SESSION ======
// Checks if user has an active session when the page loads
// Used to automatically sign in returning users
async function checkAuthSession() {
  // ====== SUPABASE AVAILABILITY CHECK ======
  if (!supabaseClient) {
    console.log('[Auth] Supabase not available, using guest mode');
    return false;
  }

  try {
    // ====== GET CURRENT SESSION ======
    // Check if user has a valid authentication session
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    
    if (error) {
      console.error('[Auth] Error getting session:', error);
      return false;
    }

    // ====== SESSION FOUND ======
    if (session && session.user) {
      console.log('[Auth] Existing session found:', session.user.email);
      window.GAME_AUTH_MODE = 'email';
      return true;
    } else {
      // ====== NO SESSION ======
      console.log('[Auth] No existing session');
      window.GAME_AUTH_MODE = 'guest';
      return false;
    }
  } catch (error) {
    console.error('[Auth] Exception checking session:', error);
    return false;
  }
}

// ====== DOM CONTENT LOADED EVENT ======
// Main initialization function - runs when the HTML document is fully loaded
// Sets up all UI event handlers, authentication, and game logic
document.addEventListener('DOMContentLoaded', function() {
  console.log('[App] Initializing SILO DERPLES...');
  
  // ====== HANDLE EMAIL CONFIRMATION FIRST ======
  // Process email confirmation callback before other initialization
  // This ensures user is signed in before UI updates
  handleEmailConfirmation();

  // ====== NOTIFICATION SYSTEM INITIALIZATION ======
  // Initialize Notyf for toast notifications (success, error, info messages)
  const notyf = new Notyf({
    duration: 3000, // Notifications disappear after 3 seconds
    position: {
      x: 'right',
      y: 'top',
    },
    types: [
      {
        type: 'info',
        background: 'rgba(20, 20, 20, 0.95)',
        icon: false
      }
    ]
  });
  
  // ====== GLOBAL NOTYF ACCESS ======
  // Make notyf globally accessible so other parts of the app can show notifications
  window.notyf = notyf;

  // ====== DOM ELEMENT REFERENCES ======
  // Get references to all UI elements we need to interact with
  const guestBtn = document.getElementById('guest');
  const sendLinkBtn = document.getElementById('send-link');
  const signoutBtn = document.getElementById('signout');
  const emailInput = document.getElementById('email');
  const authOverlay = document.getElementById('auth-overlay');
  const landingBackground = document.getElementById('landing-background');
  const appContainer = document.getElementById('app-container');

  // ====== GAME STATE VARIABLES ======
  // Track game state for guest mode and turn limits
  let isGuest = false;
  let guestTurnsRemaining = 30; // Guest players get 30 turns

  // ====== UPDATE AUTHENTICATION UI ======
  // Updates the UI to reflect the current authentication state
  // Shows/hides sign out button, enables/disables email input, etc.
  function updateAuthUI(isSignedIn, userEmail = null) {
    if (signoutBtn) {
      if (isSignedIn) {
        signoutBtn.classList.remove('hide');
        if (emailInput) {
          emailInput.value = userEmail || '';
          emailInput.disabled = true;
        }
        if (sendLinkBtn) {
          sendLinkBtn.innerHTML = 'Signed in';
          sendLinkBtn.disabled = true;
        }
      } else {
        signoutBtn.classList.add('hide');
        if (emailInput) {
          emailInput.value = '';
          emailInput.disabled = false;
        }
        if (sendLinkBtn) {
          sendLinkBtn.innerHTML = 'Send magic link';
          sendLinkBtn.disabled = false;
        }
      }
    }
  }

  // ====== AUTO-START FOR EXISTING SESSIONS ======
  // Check for existing session and auto-start game if user is already signed in
  // This provides seamless experience for returning users
  checkAuthSession().then(hasSession => {
    if (hasSession && supabaseClient) {
      supabaseClient.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          console.log('[Auth] User already signed in, auto-starting game...');
          // Auto-start game in email mode
          startGame('email');
        }
      });
    }
  });

  // ====== AUTO-START AFTER EMAIL CONFIRMATION ======
  // If user just confirmed their email via magic link, auto-start the game
  if (window.AUTO_START_EMAIL) {
    console.log('[Auth] Auto-starting game after email confirmation...');
    window.AUTO_START_EMAIL = false;
    startGame('email');
  }

  // ====== AUTH STATE CHANGE LISTENER ======
  // Listen for authentication state changes (sign in, sign out, token refresh)
  // Automatically starts game when user signs in
  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
      console.log('[Auth] Auth state changed:', event, session?.user?.email || 'no user');
      
      if (event === 'SIGNED_IN' && session) {
        window.GAME_AUTH_MODE = 'email';
        // Auto-start game when signed in
        console.log('[Auth] User signed in, auto-starting game...');
        startGame('email');
      } else if (event === 'SIGNED_OUT') {
        window.GAME_AUTH_MODE = 'guest';
        updateAuthUI(false);
      }
    });
  }

  // ====== VERIFY ENGINE CONNECTION ======
  // Verifies that the game engine can access the GameAuth API and bridge objects
  // Used for debugging connection issues between JavaScript and Defold engine
  function verifyEngineConnection() {
    if (!window.GAME_ENGINE_LOADED) {
      console.log('[Connection] Engine not loaded yet, waiting...');
      return false;
    }

    // Test if engine can access our variables
    try {
      const testMode = window.GAME_AUTH_MODE || 'not-set';
      console.log('[Connection] ✓ Auth mode available:', testMode);
      console.log('[Connection] ✓ GameAuth API available:', typeof window.GameAuth);
      console.log('[Connection] ✓ Bridge object available:', typeof window.__defold_bridge);
      
      // Try to simulate what the engine would do
      if (window.GameAuthSync) {
        const mode = window.GameAuthSync.getMode();
        console.log('[Connection] ✓ GameAuthSync.getMode() returns:', mode);
      } else {
        console.log('[Connection] ⚠ GameAuthSync not created yet (will be created by engine)');
      }
      
      return true;
    } catch (error) {
      console.error('[Connection] ✗ Error verifying connection:', error);
      return false;
    }
  }

  // ====== START GAME FUNCTION ======
  // Main function to start the game in either 'guest' or 'email' mode
  // Handles UI transitions, engine loading, and mode setup
  function startGame(mode) {
    console.log(`[Game] Starting game in ${mode} mode...`);
    
    // ====== SET AUTH MODE ======
    window.GAME_AUTH_MODE = mode;
    console.log(`[Game] Set GAME_AUTH_MODE to: ${window.GAME_AUTH_MODE}`);
    
    // ====== SETUP MODE-SPECIFIC STATE ======
    if (mode === 'guest') {
      isGuest = true;
      guestTurnsRemaining = 30; // Guest players get 30 turns
      notyf.success('🎮 Starting guest play - 30 turns available!');
    } else if (mode === 'email') {
      isGuest = false;
      notyf.success('🎮 Starting signed-in play!');
    }

    // ====== FADE OUT AUTH UI ======
    // Animate the authentication overlay and landing background out
    authOverlay.classList.add('fade-out');
    landingBackground.classList.add('fade-out');
    
    // ====== DELAYED GAME START ======
    // Wait for fade-out animation to complete before showing game
    setTimeout(() => {
      // ====== HIDE AUTH UI ======
      authOverlay.style.display = 'none';
      landingBackground.style.display = 'none';
      
      // ====== SHOW GAME CONTAINER ======
      appContainer.classList.add('game-active');
      
      // ====== LOAD GAME ENGINE ======
      // Load the Defold game engine if not already loaded
      if (!window.GAME_ENGINE_LOADED && !window.GAME_ENGINE_LOADING) {
        window.GAME_ENGINE_LOADING = true;
        console.log('[Game] Loading Defold engine...');
        
        // ====== CHECK FOR FILE PROTOCOL ======
        // Show warning if running from file:// (needs web server)
        const runningFromFileWarning = document.getElementById("running-from-file-warning");
        if (window.location.href.startsWith("file://")) {
          if (runningFromFileWarning) {
            runningFromFileWarning.style.display = "block";
          }
        } else {
          // ====== LOAD ENGINE ======
          // Load the Defold game engine into the canvas element
          if (typeof EngineLoader !== "undefined" && EngineLoader.load) {
            EngineLoader.load("canvas", "SILOMobile");
            if (runningFromFileWarning && runningFromFileWarning.parentNode) {
              runningFromFileWarning.parentNode.removeChild(runningFromFileWarning);
            }
          } else {
            console.error("[Game] EngineLoader not available");
            window.GAME_ENGINE_LOADING = false;
          }
        }
      } else if (window.GAME_ENGINE_LOADED) {
        // ====== ENGINE ALREADY LOADED ======
        console.log('[Game] Engine already loaded');
        setTimeout(() => {
          verifyEngineConnection();
        }, 100);
      } else {
        // ====== ENGINE LOADING ======
        console.log('[Game] Engine is currently loading...');
      }
      
      // ====== FOCUS CANVAS ======
      // Give focus to the game canvas so keyboard input works
      const canvas = document.getElementById('canvas');
      if (canvas) {
        setTimeout(() => {
          canvas.focus();
        }, 100);
      }
      
      console.log('[Game] Game started successfully');
    }, 500); // 500ms delay for fade-out animation
  }

  // ====== GUEST BUTTON EVENT HANDLER ======
  // Handles click on "Guest quick play" button
  if (guestBtn) {
    guestBtn.addEventListener('click', function() {
      console.log('[Auth] Guest play clicked');
      
      window.GAME_AUTH_MODE = 'guest';
      console.log('[Auth] Set GAME_AUTH_MODE to "guest"');
      
      // ====== SHOW LOADING STATE ======
      guestBtn.disabled = true;
      guestBtn.innerHTML = 'Loading...<span class="loading-spinner"></span>';
      
      // ====== START GAME AFTER SHORT DELAY ======
      setTimeout(() => {
        startGame('guest');
      }, 300);
    });
  }

  // ====== SEND MAGIC LINK BUTTON HANDLER ======
  // Handles click on "Send magic link" button
  // Sends a passwordless authentication email to the user
  if (sendLinkBtn) {
    sendLinkBtn?.addEventListener("click", async () => {
      // ====== GET EMAIL INPUT ======
      const email = (emailInput?.value || "").trim();
      if (!email) {
        notyf.error("Please enter your email address");
        return;
      }

      // ====== VALIDATE EMAIL FORMAT ======
      if (!isValidEmail(email)) {
        notyf.error("Please enter a valid email address");
        return;
      }

      console.log('[Auth] Sending magic link to:', email);
      
      // ====== SHOW LOADING STATE ======
      // Disable button and show loading spinner
      if (sendLinkBtn) {
        sendLinkBtn.disabled = true;
        sendLinkBtn.innerHTML = 'Sending...<span class="loading-spinner"></span>';
      }

      // ====== SHOW INFO NOTIFICATION ======
      notyf.open({
        type: "info",
        message: "Sending magic link…",
        border: "10px solid #ff6b35",
        duration: 2000,
      });

      // ====== CHECK SUPABASE AVAILABILITY ======
      if (!supabaseClient) {
        notyf.error('Authentication service not available. Please refresh the page.');
        return;
      }

      // ====== SEND MAGIC LINK ======
      // Request Supabase to send a passwordless authentication email
      // User clicks link in email to sign in
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { 
          emailRedirectTo: window.location.origin + window.location.pathname
        },
      });
      
      // ====== RE-ENABLE BUTTON ======
      if (sendLinkBtn) {
        sendLinkBtn.disabled = false;
        sendLinkBtn.innerHTML = 'Send magic link';
      }

      // ====== HANDLE RESULT ======
      if (error) {
        notyf.error(`Error: ${error.message}`);
      } else {
        notyf.success("📩 Check your email for the sign-in link.");
      }
    });
  }

  // ====== SIGN OUT BUTTON HANDLER ======
  // Handles click on "Sign out" button
  // Signs the user out of Supabase and switches to guest mode
  if (signoutBtn) {
    signoutBtn.addEventListener('click', async function() {
      console.log('[Auth] Sign out clicked');
      
      // ====== CHECK SUPABASE AVAILABILITY ======
      if (!supabaseClient) {
        notyf.error('Authentication service not available');
        return;
      }

      // ====== SIGN OUT ======
      // Sign out from Supabase authentication
      const { error } = await supabaseClient.auth.signOut();
      
      if (error) {
        console.error('[Auth] Error signing out:', error);
        notyf.error('Error signing out: ' + error.message);
      } else {
        console.log('[Auth] Signed out successfully');
        // ====== SWITCH TO GUEST MODE ======
        window.GAME_AUTH_MODE = 'guest';
        updateAuthUI(false);
        notyf.success('Signed out successfully');
      }
    });
  }

  // ====== EMAIL VALIDATION HELPER ======
  // Validates email format using regex pattern
  function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  // ====== ENTER KEY SUBMISSION ======
  // Allow users to press Enter key in email input to submit magic link request
  if (emailInput) {
    emailInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        sendLinkBtn.click();
      }
    });
  }

  // ====== ENGINE LOAD MONITORING ======
  // Polls for game engine load completion and verifies connection when ready
  const checkEngineInterval = setInterval(() => {
    if (window.GAME_ENGINE_LOADED) {
      console.log('[Engine] Engine is ready!');
      clearInterval(checkEngineInterval);
      
      // ====== VERIFY CONNECTION ======
      // Verify connection after a short delay to let bridge initialize
      setTimeout(() => {
        console.log('[Connection] Verifying connection with game engine...');
        verifyEngineConnection();
        
        // ====== PERIODIC CONNECTION CHECKS ======
        // Set up periodic connection checks (every 2 seconds for first 10 seconds)
        // This helps debug connection issues during initial setup
        let checkCount = 0;
        const connectionCheckInterval = setInterval(() => {
          checkCount++;
          if (checkCount > 5) { // Stop after 5 checks (10 seconds)
            clearInterval(connectionCheckInterval);
          } else {
            verifyEngineConnection();
          }
        }, 2000);
      }, 500);
    }
  }, 500);

  // ====== INITIALIZATION COMPLETE ======
  console.log('[App] SILO DERPLES initialized successfully');
  console.log('[App] Debug helpers available:');
  console.log('  - testEngineConnection() - Test the connection');
  console.log('  - setAuthMode("guest"|"email") - Set auth mode manually');

  // ====== PWA INSTALL PROMPT HANDLING ======
  // Handles the "Add to Home Screen" / "Install App" functionality
  // Shows a custom install button when the browser supports PWA installation
  let deferredPrompt; // Stores the browser's install prompt event
  let installButton = null; // Reference to the install button element

  // ====== CREATE INSTALL BUTTON ======
  // Creates a custom install button for PWA installation
  // Only shown when browser supports installation and user hasn't installed yet
  function createInstallButton() {
    if (installButton) return installButton;
    
    installButton = document.createElement('button');
    installButton.id = 'pwa-install-btn';
    installButton.innerHTML = '📱 Install App';
    installButton.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 24px;
      background: #ff6b35;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: none;
      font-family: 'Kalam', sans-serif;
    `;
    
    installButton.addEventListener('click', async () => {
      if (!deferredPrompt) {
        console.log('[PWA] Install prompt not available');
        return;
      }
      
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('[PWA] User choice:', outcome);
      
      if (outcome === 'accepted') {
        notyf.success('App installed successfully!');
      }
      
      deferredPrompt = null;
      installButton.style.display = 'none';
    });
    
    document.body.appendChild(installButton);
    return installButton;
  }

  // ====== BEFORE INSTALL PROMPT EVENT ======
  // Fired when browser determines the app can be installed
  // We prevent the default prompt and show our custom button instead
  window.addEventListener('beforeinstallprompt', (e) => {
    console.log('[PWA] Install prompt available');
    e.preventDefault(); // Prevent default browser install prompt
    deferredPrompt = e; // Store the event for later use
    
    // ====== SHOW INSTALL BUTTON ======
    const btn = createInstallButton();
    btn.style.display = 'block';
  });

  // ====== APP INSTALLED EVENT ======
  // Fired when user successfully installs the app
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App was installed');
    deferredPrompt = null; // Clear the deferred prompt
    if (installButton) {
      installButton.style.display = 'none'; // Hide install button
    }
    notyf.success('App installed successfully!');
  });

  // ====== CHECK IF APP IS ALREADY INSTALLED ======
  // Detect if app is running in standalone mode (installed as PWA)
  if (window.matchMedia('(display-mode: standalone)').matches) {
    console.log('[PWA] Running in standalone mode');
  }

  // ====== SERVICE WORKER UPDATE HANDLING ======
  // Listens for service worker updates (new version of the app available)
  // Can optionally reload the page to use the new service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[PWA] New service worker activated');
      // Optionally reload the page to use new service worker
      // window.location.reload();
    });
  }
});

