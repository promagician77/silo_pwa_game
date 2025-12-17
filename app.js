// ====== SUPABASE CONFIGURATION ======
// Supabase project URL and anonymous key for authentication and database access
// These credentials allow the app to connect to Supabase backend services
const SUPABASE_URL ='https://uaulpmynwouftajunuso.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhdWxwbXlud291ZnRhanVudXNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyNzkzNTIsImV4cCI6MjA3Njg1NTM1Mn0.P5Mq6v01VAYqZD0NZ-_NYepoHzhGEwgt9GWbgef0KI0';

// ====== SUPABASE CLIENT INITIALIZATION ======
// Create Supabase client instance for database and authentication operations
// This client is used throughout the app for user auth, wallet management, and leaderboard
// Configured for PWA compatibility with proper storage handling
let supabaseClient = null;
try {
  // ====== DETECT PWA CONTEXT ======
  const isPWA = window.matchMedia('(display-mode: standalone)').matches || 
                window.navigator.standalone === true;
  
  // ====== CONFIGURE SUPABASE FOR PWA ======
  // Use localStorage for session persistence (works in both browser and PWA)
  // autoRefreshToken ensures sessions stay valid
  // persistSession ensures authentication state persists across page reloads
  // Supabase automatically detects sessions in URL hash, and we handle query params manually
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: window.localStorage, // Use localStorage for session persistence
      autoRefreshToken: true, // Automatically refresh expired tokens
      persistSession: true, // Persist session across page reloads
      flowType: 'pkce' // Use PKCE flow for better security
    }
  });
  
  console.log('[Supabase] Client initialized');
  if (isPWA) {
    console.log('[Supabase] PWA mode detected - using isolated storage');
  }
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

// ====== PWA DETECTION UTILITIES ======
// Helper functions to detect if app is running in PWA/standalone mode
// iOS PWAs have isolated storage, so we need special handling
function isPWAStandalone() {
  // Check if running in standalone mode (installed as PWA)
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return true;
  }
  // iOS Safari standalone detection
  if (window.navigator.standalone === true) {
    return true;
  }
  // Check if launched from home screen (iOS)
  if (window.matchMedia('(display-mode: standalone)').matches || 
      (window.navigator.standalone === true)) {
    return true;
  }
  return false;
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// ====== EMAIL CONFIRMATION HANDLER ======
// Handles the callback when user clicks the magic link in their email
// Supports both hash fragments (browser) and query parameters (PWA)
// This function extracts the tokens and sets up the user session
async function handleEmailConfirmation() {
  if (!supabaseClient) return;

  try {
    let accessToken = null;
    let refreshToken = null;
    let type = null;
    let tokenSource = null;

    // ====== CHECK URL HASH (BROWSER MODE) ======
    // Supabase redirects back to the app with authentication tokens in the URL hash
    // Format: #access_token=xxx&refresh_token=yyy&type=magiclink
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    accessToken = hashParams.get('access_token');
    refreshToken = hashParams.get('refresh_token');
    type = hashParams.get('type');
    if (accessToken && refreshToken) {
      tokenSource = 'hash';
    }

    // ====== CHECK URL QUERY PARAMETERS (PWA MODE) ======
    // PWAs on iOS handle query parameters better than hash fragments
    // Format: ?access_token=xxx&refresh_token=yyy&type=magiclink
    if (!accessToken || !refreshToken) {
      const urlParams = new URLSearchParams(window.location.search);
      accessToken = urlParams.get('access_token') || accessToken;
      refreshToken = urlParams.get('refresh_token') || refreshToken;
      type = urlParams.get('type') || type;
      if (accessToken && refreshToken && !tokenSource) {
        tokenSource = 'query';
      }
    }

    // ====== DETECT PWA CONTEXT ======
    const isPWA = isPWAStandalone();

    // ====== HANDLE MAGIC LINK CONFIRMATION ======
    // Process magic link, signup, or password recovery confirmations
    if (type === 'recovery' || type === 'signup' || type === 'magiclink') {
      if (accessToken && refreshToken) {
        console.log('[Auth] Processing authentication tokens from', tokenSource);
        
        // ====== DETECT CROSS-CONTEXT AUTH ======
        // If tokens are in browser but we're not in PWA, user clicked link in browser
        if (!isPWA && tokenSource === 'hash') {
          // User is in browser - set hint for PWA context
          sessionStorage.setItem('browser_session_hint', 'true');
          console.log('[Auth] Browser authentication - hint set for PWA');
        }
        
        // ====== SET USER SESSION ======
        // Use the tokens to establish an authenticated session
        const { data, error } = await supabaseClient.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });

        if (error) {
          console.error('[Auth] Error setting session:', error);
          
          // ====== SHOW HELPFUL ERROR MESSAGE ======
          if (window.notyf) {
            window.notyf.error('Authentication failed. Please try again or use the code from your email.');
          }
          return;
        }

        if (data.user) {
          console.log('[Auth] Email confirmed, user signed in:', data.user.email);
          
          // ====== CLEAN UP URL ======
          // Remove tokens from URL for security and cleaner appearance
          // Handle both hash and query parameters
          const cleanUrl = window.location.pathname;
          window.history.replaceState(null, '', cleanUrl);
          
          // ====== SET AUTH MODE ======
          window.GAME_AUTH_MODE = 'email';
          if (!localStorage.getItem('email_signin_notification_shown')) {
            console.log('[Auth] First email sign-in detected');
          }
          
          // ====== STORE AUTH TIMESTAMP FOR SESSION RECOVERY ======
          // Store timestamp when auth happens in browser (helps PWA detect recent auth)
          if (!isPWA) {
            localStorage.setItem('browser_auth_timestamp', Date.now().toString());
            console.log('[Auth] Browser auth timestamp stored for PWA recovery');
          }
          
          // ====== CONTEXT-AWARE MESSAGING ======
          if (!isPWA) {
            // User authenticated in browser - guide them to return to PWA if they have it
            if (window.notyf) {
              setTimeout(() => {
                window.notyf.open({
                  type: "info",
                  message: "✅ Signed in! If you have the PWA installed, open it from your home screen to continue.",
                  border: "10px solid #4caf50",
                  duration: 10000,
                });
              }, 500);
            }
          } else if (isPWA) {
            // Successfully authenticated in PWA
            console.log('[Auth] PWA authentication successful');
            // Clear browser auth timestamp since we're now authenticated in PWA
            localStorage.removeItem('browser_auth_timestamp');
          }
          
          // ====== AUTO-START GAME ======
          // Flag to automatically start the game after email confirmation
          window.AUTO_START_EMAIL = true;
        }
      } else {
        // ====== MISSING TOKENS ======
        // Tokens might be in a different context (browser vs PWA)
        if (isPWA) {
          console.log('[Auth] Magic link opened in PWA but tokens missing - likely opened in browser first');
          // Don't show error - user might have opened link in browser and needs to return to PWA
        }
      }
    }
  } catch (error) {
    console.error('[Auth] Error handling email confirmation:', error);
    if (window.notyf) {
      window.notyf.error('Authentication error. Please try again or use the code from your email.');
    }
  }
}

// ====== SESSION RECOVERY HELPER ======
// Attempts to recover session from browser context for PWA users
// This helps users who authenticated in browser and then opened the PWA
async function attemptSessionRecovery() {
  const isPWA = isPWAStandalone();
  
  if (!isPWA) return false;
  
  // Check if there's a recent authentication hint from browser
  const browserAuthTime = localStorage.getItem('browser_auth_timestamp');
  if (browserAuthTime) {
    const authAge = Date.now() - parseInt(browserAuthTime);
    // If auth was within last 5 minutes, show helpful message
    if (authAge < 5 * 60 * 1000) {
      console.log('[Auth] Recent browser authentication detected, but PWA has no session');
      if (window.notyf) {
        setTimeout(() => {
          window.notyf.open({
            type: "info",
            message: "ℹ️ Tip: Use the 6-digit code from your email to sign in to the PWA directly.",
            border: "10px solid #ff6b35",
            duration: 7000,
          });
        }, 1000);
      }
      return true;
    }
  }
  return false;
}

// ====== CHECK EXISTING SESSION ======
// Checks if user has an active session when the page loads
// Used to automatically sign in returning users
// Validates session with server to detect if user was removed from Supabase
// Handles PWA context where storage is isolated from browser
async function checkAuthSession() {
  // ====== SUPABASE AVAILABILITY CHECK ======
  if (!supabaseClient) {
    console.log('[Auth] Supabase not available, using guest mode');
    return false;
  }

  // ====== PWA CONTEXT DETECTION ======
  const isPWA = isPWAStandalone();
  if (isPWA) {
    console.log('[Auth] Running in PWA standalone mode');
    console.log('[Auth] PWA storage is isolated from browser');
  }

  try {
    // ====== VALIDATE SESSION WITH SERVER ======
    // Use getUser() instead of getSession() to verify session is valid on server
    // This detects cases where user was removed from Supabase but session is cached
    // Also works across PWA and browser contexts since it validates with server
    const { data: { user }, error } = await supabaseClient.auth.getUser();
    
    if (error) {
      console.error('[Auth] Error validating session:', error);
      // ====== CLEAR INVALID SESSION ======
      // If session is invalid (e.g., user removed from Supabase), clear it
      await supabaseClient.auth.signOut();
      window.GAME_AUTH_MODE = 'guest';
      return false;
    }

    // ====== VALID USER FOUND ======
    if (user) {
      console.log('[Auth] Valid session found:', user.email);
      if (isPWA) {
        console.log('[Auth] Session persisted in PWA context');
      }

      const {data, error} = await supabaseClient
        .from('wallets')
        .select('tokens')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.error('[Auth] Error fetching tokens:', error);
        return false;
      }

      if (data.tokens < 1) {
        console.log('[Auth] Insufficient tokens to start game');
        window.GAME_AUTH_MODE = "guest";
        return false;
      } else {
        window.GAME_AUTH_MODE = 'email';
        return true;
      }
    } else {
      // ====== NO VALID USER ======
      console.log('[Auth] No valid user found');
      if (isPWA) {
        console.log('[Auth] Note: PWA has isolated storage. If you signed in via browser, you need to sign in again in the PWA.');
        
        // ====== HELPFUL MESSAGE FOR PWA USERS ======
        // Check if user might have just installed PWA from browser
        const browserSessionHint = sessionStorage.getItem('browser_session_hint');
        if (browserSessionHint) {
          // User likely just installed PWA - show helpful message
          setTimeout(() => {
            notyf.open({
              type: "info",
              message: "ℹ️ PWA Note: Please sign in again using the code from your email. Your session is separate from the browser.",
              border: "10px solid #ff6b35",
              duration: 8000,
            });
          }, 1500);
          sessionStorage.removeItem('browser_session_hint');
        } else {
          // ====== ATTEMPT SESSION RECOVERY ======
          // Check for recent browser authentication
          await attemptSessionRecovery();
        }
      }
      window.GAME_AUTH_MODE = "guest";
      return false;
    }
  } catch (error) {
    console.error('[Auth] Exception checking session:', error);
    // ====== CLEAR SESSION ON ERROR ======
    // On error, clear any potentially invalid session
    try {
      await supabaseClient.auth.signOut();
    } catch (signOutError) {
      // Ignore sign out errors
    }
    window.GAME_AUTH_MODE = 'guest';
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
  const otpRow = document.getElementById('otp-row');
  const otpCodeInput = document.getElementById('otp-code');
  const verifyOtpBtn = document.getElementById('verify-otp');
  const pwaHelpText = document.getElementById('pwa-help-text');

  // ====== GAME STATE VARIABLES ======
  // Track game state for guest mode and turn limits
  let isGuest = false;
  let guestTurnsRemaining = 30; // Guest players get 30 turns
  let userEmailForOTP = null; // Store email when sending OTP for later verification

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
        // Hide OTP UI when signed in
        if (otpRow) otpRow.style.display = 'none';
        if (pwaHelpText) pwaHelpText.style.display = 'none';
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
        // Show/hide OTP UI based on PWA mode
        updatePWAUI();
      }
    }
  }

  // ====== UPDATE PWA-SPECIFIC UI ======
  // Shows OTP input and helper text for ALL PWA users (any device)
  // This provides an alternative authentication method for standalone PWA apps
  function updatePWAUI() {
    const isPWA = isPWAStandalone();
    
    if (isPWA) {
      // Show OTP row and help text for ALL PWA users (iOS, Android, Windows, etc.)
      if (otpRow) otpRow.style.display = 'flex';
      if (pwaHelpText) pwaHelpText.style.display = 'block';
      console.log('[PWA] PWA mode detected - showing OTP input');
    } else {
      // Hide OTP row for browser users (they can click magic links normally)
      if (otpRow) otpRow.style.display = 'none';
      if (pwaHelpText) pwaHelpText.style.display = 'none';
    }
  }

  // ====== INITIALIZE PWA UI ======
  // Show/hide OTP input based on PWA mode
  updatePWAUI();

  // ====== LISTEN FOR DISPLAY MODE CHANGES ======
  // Dynamically update UI when switching between browser and PWA
  // This handles cases where user installs PWA or opens in browser after using PWA
  const displayModeQuery = window.matchMedia('(display-mode: standalone)');
  
  // Listen for changes in display mode
  displayModeQuery.addEventListener('change', (e) => {
    console.log('[PWA] Display mode changed:', e.matches ? 'PWA' : 'Browser');
    updatePWAUI(); // Update UI when display mode changes
    
    // Show appropriate message
    if (e.matches) {
      // Switched to PWA mode
      console.log('[PWA] Now running as PWA - OTP input available');
      notyf.open({
        type: "info",
        message: "📱 PWA Mode: You can now use the 6-digit code from emails to sign in!",
        border: "10px solid #ff6b35",
        duration: 5000,
      });
    } else {
      // Switched to browser mode
      console.log('[PWA] Now running as browser - magic links available');
    }
  });

  // Also listen for visibility changes (when user switches between apps)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // Page became visible again - recheck PWA status
      setTimeout(() => {
        updatePWAUI();
      }, 100);
    }
  });

  // ====== PERIODIC PWA STATUS CHECK ======
  // Backup check every 2 seconds to ensure UI stays in sync
  // This handles edge cases where display mode events don't fire
  let lastPWAState = isPWAStandalone();
  setInterval(() => {
    const currentPWAState = isPWAStandalone();
    if (currentPWAState !== lastPWAState) {
      console.log('[PWA] Display mode changed (detected via polling):', currentPWAState ? 'PWA' : 'Browser');
      lastPWAState = currentPWAState;
      updatePWAUI();
      
      if (currentPWAState) {
        notyf.open({
          type: "info",
          message: "📱 PWA Mode: You can now use the 6-digit code from emails!",
          border: "10px solid #ff6b35",
          duration: 5000,
        });
      }
    }
  }, 2000); // Check every 2 seconds

  // ====== PWA WELCOME MESSAGE ======
  // Show helpful welcome message for ALL PWA users on first launch
  const isPWA = isPWAStandalone();
  if (isPWA) {
    const pwaWelcomeShown = localStorage.getItem('pwa_welcome_shown');
    if (!pwaWelcomeShown) {
      setTimeout(() => {
        notyf.open({
          type: "info",
          message: "📱 Welcome to SILO PWA! For the best experience, use the 6-digit code from emails to sign in.",
          border: "10px solid #ff6b35",
          duration: 6000,
        });
        localStorage.setItem('pwa_welcome_shown', 'true');
      }, 1000);
    }
  }

  // ====== AUTO-START FOR EXISTING SESSIONS ======
  // Check for existing session and auto-start game if user is already signed in
  // This provides seamless experience for returning users
  // If no valid session, ensure auth overlay is visible
  checkAuthSession().then(hasSession => {
    if (hasSession && supabaseClient) {
      supabaseClient.auth.getUser().then(({ data: { user }, error }) => {
        if (user && !error) {
          console.log('[Auth] User already signed in, auto-starting game...');
          // Auto-start game in email mode
          startGame('email');
        } else {
          // ====== INVALID SESSION - SHOW AUTH OVERLAY ======
          // User was removed from Supabase or session is invalid
          console.log('[Auth] Session invalid, showing auth overlay');
          window.GAME_AUTH_MODE = 'guest';
          // Ensure auth overlay is visible
          if (authOverlay) {
            authOverlay.style.display = '';
            authOverlay.classList.remove('fade-out');
          }
          if (landingBackground) {
            landingBackground.style.display = '';
            landingBackground.classList.remove('fade-out');
          }
          if (appContainer) {
            appContainer.classList.remove('game-active');
          }
          updateAuthUI(false);
        }
      });
    } else {
      // ====== NO SESSION - ENSURE AUTH OVERLAY IS VISIBLE ======
      // Make sure auth overlay is shown when there's no valid session
      console.log('[Auth] No valid session, ensuring auth overlay is visible');
      if (authOverlay) {
        authOverlay.style.display = '';
        authOverlay.classList.remove('fade-out');
      }
      if (landingBackground) {
        landingBackground.style.display = '';
        landingBackground.classList.remove('fade-out');
      }
      if (appContainer) {
        appContainer.classList.remove('game-active');
      }
      updateAuthUI(false);
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
  // Shows auth overlay when user is signed out (including when removed from Supabase)
  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
      console.log('[Auth] Auth state changed:', event, session?.user?.email || 'no user');
      
      if (event === 'SIGNED_IN' && session) {
        window.GAME_AUTH_MODE = 'email';
        
        // ====== SHOW SUCCESS MESSAGE ======
        const isPWA = isPWAStandalone();
        if (isPWA) {
          notyf.success('✅ Signed in successfully! Starting game...');
        }
        
        // Auto-start game when signed in
        console.log('[Auth] User signed in, auto-starting game...');
        startGame('email');
      } else if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        // ====== USER SIGNED OUT OR SESSION INVALID ======
        // Show auth overlay when user signs out or session becomes invalid
        window.GAME_AUTH_MODE = 'guest';
        updateAuthUI(false);
        
        // ====== SHOW AUTH OVERLAY ======
        // Ensure auth overlay is visible when user is signed out
        if (authOverlay) {
          authOverlay.style.display = '';
          authOverlay.classList.remove('fade-out');
        }
        if (landingBackground) {
          landingBackground.style.display = '';
          landingBackground.classList.remove('fade-out');
        }
        if (appContainer) {
          appContainer.classList.remove('game-active');
        }
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
      
      // ====== FORCE CANVAS RESIZE (MOBILE FIX) ======
      // Recalculate canvas size now that container is visible
      // This fixes the scaling issue on mobile devices
      if (window.forceCanvasSizeRecalculation) {
        setTimeout(() => {
          window.forceCanvasSizeRecalculation();
        }, 50);
      }
      
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
      // For PWAs, use query parameters instead of hash fragments for better iOS support
      const isPWA = isPWAStandalone();
      const isIOSDevice = isIOS();
      
      // Build redirect URL - use query parameters for PWAs on iOS
      let redirectUrl = window.location.origin + window.location.pathname;
      
      // For iOS PWAs, we need to ensure the redirect uses query parameters
      // Supabase will append tokens as query params if we configure it properly
      // Note: Supabase by default uses hash fragments, but we can work with both
      if (isPWA || isIOSDevice) {
        console.log('[Auth] PWA/iOS detected, using redirect URL optimized for PWA');
        // The redirect URL will work, but we'll handle both hash and query params in handleEmailConfirmation
      }
      
      // ====== SEND OTP EMAIL ======
      // NOTE: OTP code expiration time is controlled in Supabase Dashboard:
      // Go to: Authentication > Email Templates > "Magic Link"
      // The default is 60 seconds, but can be increased for slower email delivery
      // Recommended: 300 seconds (5 minutes) or 600 seconds (10 minutes)
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { 
          emailRedirectTo: redirectUrl,
          // For iOS PWAs, we can try to force query parameters
          // However, Supabase defaults to hash fragments, so we handle both
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
        const isPWA = isPWAStandalone();
        
        // Store email for OTP verification
        userEmailForOTP = email;
        
        if (isPWA) {
          // ====== PWA SPECIFIC MESSAGE ======
          // For PWAs, show instructions for using OTP code instead of magic link
          // This provides a seamless authentication experience within the PWA
          notyf.open({
            type: "info",
            message: "📩 Email sent! Enter the 6-digit code from your email below (or click the link if it opens in the app).",
            border: "10px solid #ff6b35",
            duration: 8000,
          });
          
          // Focus OTP input for convenience
          if (otpCodeInput) {
            setTimeout(() => {
              otpCodeInput.focus();
            }, 500);
          }
        } else {
          notyf.success("📩 Check your email for the sign-in link.");
        }
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

  // ====== OTP VERIFICATION BUTTON HANDLER ======
  // Handles OTP code verification for PWA users
  // Provides alternative authentication when magic links open in Safari
  if (verifyOtpBtn && otpCodeInput) {
    verifyOtpBtn.addEventListener('click', async function() {
      // ====== GET OTP CODE ======
      const otpCode = (otpCodeInput?.value || "").trim();
      if (!otpCode) {
        notyf.error("Please enter the 6-digit code");
        return;
      }

      // ====== VALIDATE OTP FORMAT ======
      if (otpCode.length !== 6 || !/^\d+$/.test(otpCode)) {
        notyf.error("Code must be 6 digits");
        return;
      }

      // ====== CHECK EMAIL ======
      const email = userEmailForOTP || (emailInput?.value || "").trim();
      if (!email) {
        notyf.error("Please enter your email first");
        return;
      }

      console.log('[Auth] Verifying OTP code for:', email);
      
      // ====== SHOW LOADING STATE ======
      if (verifyOtpBtn) {
        verifyOtpBtn.disabled = true;
        verifyOtpBtn.innerHTML = 'Verifying...<span class="loading-spinner"></span>';
      }

      // ====== CHECK SUPABASE AVAILABILITY ======
      if (!supabaseClient) {
        notyf.error('Authentication service not available. Please refresh the page.');
        if (verifyOtpBtn) {
          verifyOtpBtn.disabled = false;
          verifyOtpBtn.innerHTML = 'Verify Code';
        }
        return;
      }

      try {
        // ====== VERIFY OTP WITH SUPABASE ======
        // Use verifyOtp to authenticate with the email and token
        const { data, error } = await supabaseClient.auth.verifyOtp({
          email: email,
          token: otpCode,
          type: 'email'
        });

        // ====== RE-ENABLE BUTTON ======
        if (verifyOtpBtn) {
          verifyOtpBtn.disabled = false;
          verifyOtpBtn.innerHTML = 'Verify Code';
        }

        // ====== HANDLE RESULT ======
        if (error) {
          console.error('[Auth] OTP verification error:', error);
          notyf.error(`Verification failed: ${error.message}`);
        } else if (data.user) {
          console.log('[Auth] OTP verified successfully:', data.user.email);
          notyf.success('✅ Signed in successfully!');
          
          // Clear OTP input
          if (otpCodeInput) otpCodeInput.value = '';
          userEmailForOTP = null;
          
          // Set auth mode and auto-start game
          window.GAME_AUTH_MODE = 'email';
          startGame('email');
        } else {
          notyf.error('Verification failed. Please try again.');
        }
      } catch (error) {
        console.error('[Auth] Exception verifying OTP:', error);
        notyf.error('Verification failed. Please try again.');
        if (verifyOtpBtn) {
          verifyOtpBtn.disabled = false;
          verifyOtpBtn.innerHTML = 'Verify Code';
        }
      }
    });

    // ====== ENTER KEY SUBMISSION FOR OTP ======
    // Allow users to press Enter key in OTP input to submit
    otpCodeInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        verifyOtpBtn.click();
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
  if (isPWAStandalone()) {
    console.log('[PWA] Running in standalone mode');
    console.log('[PWA] PWA detected - authentication state is isolated from browser');
    console.log('[PWA] Users can authenticate within the PWA using OTP codes');
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

