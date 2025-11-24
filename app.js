const SUPABASE_URL ='https://uaulpmynwouftajunuso.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhdWxwbXlud291ZnRhanVudXNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyNzkzNTIsImV4cCI6MjA3Njg1NTM1Mn0.P5Mq6v01VAYqZD0NZ-_NYepoHzhGEwgt9GWbgef0KI0';

// Initialize Supabase client
let supabaseClient = null;
try {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('[Supabase] Client initialized');
} catch (error) {
  console.error('[Supabase] Failed to initialize client:', error);
}

window.GameAuth = {
  // Get current authentication mode
  getMode: function() {
    return Promise.resolve(window.GAME_AUTH_MODE || 'guest');
  },
  
  // Get token balance (for signed-in users only)
  // Queries wallets table: SELECT tokens FROM wallets WHERE user_id = current_user
  getTokens: async function() {
    if (window.GAME_AUTH_MODE !== 'email' || !supabaseClient) {
      return Promise.resolve(null); // Guests have no tokens
    }

    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) {
        console.log('[GameAuth] No authenticated user');
        return null;
      }

      // Query wallets table (use maybeSingle to handle case where wallet doesn't exist)
      const { data, error } = await supabaseClient
        .from('wallets')
        .select('tokens')
        .eq('user_id', user.id)
        .maybeSingle();

      // If wallet doesn't exist, create one with default tokens
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

      const tokens = data?.tokens || 0;
      console.log('[GameAuth] User tokens:', tokens);
      return tokens;
    } catch (error) {
      console.error('[GameAuth] Exception in getTokens:', error);
      return null;
    }
  },
  
  // Start a game session (deducts token for signed-in users)
  // Creates entry in game_sessions table and deducts 1 token from wallets
  startSession: async function() {
    console.log('[GameAuth] Starting session in mode:', window.GAME_AUTH_MODE);
    if (window.GAME_AUTH_MODE !== 'email' || !supabaseClient) {
      // Guest mode: always allow, no token deduction
      return Promise.resolve(true);
    }

    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) {
        console.log('[GameAuth] No authenticated user for session start');
        return false;
      }

      // Check if user has tokens (use maybeSingle to handle case where wallet doesn't exist)
      const { data: walletData, error: walletError } = await supabaseClient
        .from('wallets')
        .select('tokens')
        .eq('user_id', user.id)
        .maybeSingle();

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

      if (wallet.tokens < 1) {
        console.log('[GameAuth] Insufficient tokens to start session');
        if (window.notyf) {
          window.notyf.error('Insufficient tokens to start session');
        }
        return false;
      }

      // Create game session entry
      // Note: Status must match database CHECK constraint game_sessions_status_check
      // Common values: 'in_progress', 'in-progress', 'started', 'pending'
      const sessionData = {
        user_id: user.id, //user.id,
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

      // Deduct 1 token from wallet
      const { error: updateError } = await supabaseClient
        .from('wallets')
        .update({ 
          tokens: wallet.tokens - 1,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id);

      if (updateError) {
        console.error('[GameAuth] Error deducting token:', updateError);
        // Try to delete the session we just created
        await supabaseClient
          .from('game_sessions')
          .delete()
          .eq('id', session.id);
        return false;
      }

      // Store session ID for later use (to update when game ends)
      window.CURRENT_SESSION_ID = session.id;
      console.log('[GameAuth] Session started successfully, session ID:', session.id);
      return true;
    } catch (error) {
      console.error('[GameAuth] Exception in startSession:', error);
      return false;
    }
  },
  
  // Record score to leaderboard (for signed-in users only)
  // Inserts into leaderboard table: user_id, email, score, created_at
  recordScore: async function(score) {
    if (window.GAME_AUTH_MODE !== 'email' || !supabaseClient) {
      console.log('[GameAuth] Guest mode - score not recorded:', score);
      return Promise.resolve(false);
    }

    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) {
        console.log('[GameAuth] No authenticated user for score submission');
        return false;
      }

      // Get user email
      const userEmail = user.email || 'unknown@example.com';

      // Insert into leaderboard table
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

      // Update game session with final score if session exists
      if (window.CURRENT_SESSION_ID) {
        // Get the session to find start time
        const { data: sessionData } = await supabaseClient
          .from('game_sessions')
          .select('started_at')
          .eq('id', window.CURRENT_SESSION_ID)
          .single();

        const endTime = new Date();
        const startTime = sessionData?.started_at ? new Date(sessionData.started_at) : endTime;
        const durationSeconds = Math.floor((endTime - startTime) / 1000);

        await supabaseClient
          .from('game_sessions')
          .update({
            status: 'completed',
            ended_at: endTime.toISOString(),
            duration_seconds: durationSeconds,
            score: parseInt(score) || 0
          })
          .eq('id', window.CURRENT_SESSION_ID);

        window.CURRENT_SESSION_ID = null;
      }

      console.log('[GameAuth] Score recorded successfully:', score);
      return true;
    } catch (error) {
      console.error('[GameAuth] Exception in recordScore:', error);
      return false;
    }
  },
  
  getTopScores: async function(limit) {
    console.log('[GameAuth] Getting top scores:', limit);
    if (!supabaseClient) {
      console.log('[GameAuth] Supabase not configured, returning empty leaderboard');
      return Promise.resolve([]);
    }

    try {
      const queryLimit = Math.min(parseInt(limit) || 10, 100);

      const { data, error } = await supabaseClient
        .from('leaderboard')
        .select('email, score, created_at')
        .order('score', { ascending: false })
        .limit(queryLimit);

      if (error) {
        console.error('[GameAuth] Error fetching top scores:', error);
        return [];
      }

      // Format results to match expected structure
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
  }
};

console.log('[App] GameAuth API initialized (immediate)');

// Initialize bridge helper object immediately
if (!window.__defold_bridge) {
  window.__defold_bridge = {};
  console.log('[App] Defold bridge initialized (immediate)');
}

// Set default auth mode to guest
if (!window.GAME_AUTH_MODE) {
  window.GAME_AUTH_MODE = 'guest';
  console.log('[App] Default GAME_AUTH_MODE set to "guest"');
}

// Handle email confirmation callback from Supabase
async function handleEmailConfirmation() {
  if (!supabaseClient) return;

  try {
    // Check for tokens in URL hash (Supabase redirects here)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    const type = hashParams.get('type');

    if (type === 'recovery' || type === 'signup' || type === 'magiclink') {
      if (accessToken && refreshToken) {
        // Set the session
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
          // Clear URL hash
          window.history.replaceState(null, '', window.location.pathname);
          // Update auth state
          window.GAME_AUTH_MODE = 'email';
          // Set flag to auto-start game when DOM is ready
          window.AUTO_START_EMAIL = true;
        }
      }
    }
  } catch (error) {
    console.error('[Auth] Error handling email confirmation:', error);
  }
}

// Check for existing session on page load
async function checkAuthSession() {
  if (!supabaseClient) {
    console.log('[Auth] Supabase not available, using guest mode');
    return false;
  }

  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    
    if (error) {
      console.error('[Auth] Error getting session:', error);
      return false;
    }

    if (session && session.user) {
      console.log('[Auth] Existing session found:', session.user.email);
      window.GAME_AUTH_MODE = 'email';
      return true;
    } else {
      console.log('[Auth] No existing session');
      window.GAME_AUTH_MODE = 'guest';
      return false;
    }
  } catch (error) {
    console.error('[Auth] Exception checking session:', error);
    return false;
  }
}

document.addEventListener('DOMContentLoaded', function() {
  console.log('[App] Initializing SILO DERPLES...');
  
  // Handle email confirmation first (before other initialization)
  handleEmailConfirmation();

  const notyf = new Notyf({
    duration: 3000,
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
  
  // Make notyf globally accessible
  window.notyf = notyf;

  // Get DOM elements
  const guestBtn = document.getElementById('guest');
  const sendLinkBtn = document.getElementById('send-link');
  const signoutBtn = document.getElementById('signout');
  const emailInput = document.getElementById('email');
  const authOverlay = document.getElementById('auth-overlay');
  const landingBackground = document.getElementById('landing-background');
  const appContainer = document.getElementById('app-container');

  // Game state
  let isGuest = false;
  let guestTurnsRemaining = 30;

  // Update UI based on auth state
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

  // Check for existing session and auto-start game if signed in
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

  // Check if we need to auto-start after email confirmation
  if (window.AUTO_START_EMAIL) {
    console.log('[Auth] Auto-starting game after email confirmation...');
    window.AUTO_START_EMAIL = false;
    startGame('email');
  }

  // Listen for auth state changes
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

  // Function to verify connection with game engine
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

  // Function to start the game
  function startGame(mode) {
    console.log(`[Game] Starting game in ${mode} mode...`);
    
    window.GAME_AUTH_MODE = mode;
    console.log(`[Game] Set GAME_AUTH_MODE to: ${window.GAME_AUTH_MODE}`);
    
    if (mode === 'guest') {
      isGuest = true;
      guestTurnsRemaining = 30;
      notyf.success('🎮 Starting guest play - 30 turns available!');
    } else if (mode === 'email') {
      isGuest = false;
      notyf.success('🎮 Starting signed-in play!');
    }

    authOverlay.classList.add('fade-out');
    landingBackground.classList.add('fade-out');
    
    setTimeout(() => {
      authOverlay.style.display = 'none';
      landingBackground.style.display = 'none';
      
      appContainer.classList.add('game-active');
      
      if (!window.GAME_ENGINE_LOADED && !window.GAME_ENGINE_LOADING) {
        window.GAME_ENGINE_LOADING = true;
        console.log('[Game] Loading Defold engine...');
        
        const runningFromFileWarning = document.getElementById("running-from-file-warning");
        if (window.location.href.startsWith("file://")) {
          if (runningFromFileWarning) {
            runningFromFileWarning.style.display = "block";
          }
        } else {
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
        console.log('[Game] Engine already loaded');
        setTimeout(() => {
          verifyEngineConnection();
        }, 100);
      } else {
        console.log('[Game] Engine is currently loading...');
      }
      
      const canvas = document.getElementById('canvas');
      if (canvas) {
        setTimeout(() => {
          canvas.focus();
        }, 100);
      }
      
      console.log('[Game] Game started successfully');
    }, 500);
  }

  if (guestBtn) {
    guestBtn.addEventListener('click', function() {
      console.log('[Auth] Guest play clicke');
      
      window.GAME_AUTH_MODE = 'guest';
      console.log('[Auth] Set GAME_AUTH_MODE to "guest"');
      
      guestBtn.disabled = true;
      guestBtn.innerHTML = 'Loading...<span class="loading-spinner"></span>';
      
      setTimeout(() => {
        startGame('guest');
      }, 300);
    });
  }

  // Send magic link button handler (placeholder)
  if (sendLinkBtn) {
    sendLinkBtn?.addEventListener("click", async () => {
      const email = (emailInput?.value || "").trim();
      if (!email) {
        notyf.error("Please enter your email address");
        return;
      }

      if (!isValidEmail(email)) {
        notyf.error("Please enter a valid email address");
        return;
      }

      console.log('[Auth] Sending magic link to:', email);
      
      // Disable button and show loading state
      if (sendLinkBtn) {
        sendLinkBtn.disabled = true;
        sendLinkBtn.innerHTML = 'Sending...<span class="loading-spinner"></span>';
      }

      notyf.open({
        type: "info",
        message: "Sending magic link…",
        border: "10px solid #ff6b35",
        duration: 2000,
      });

      // Check if supabaseClient is available
      if (!supabaseClient) {
        notyf.error('Authentication service not available. Please refresh the page.');
        return;
      }

      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { 
          emailRedirectTo: window.location.origin + window.location.pathname
        },
      });
      
      // Re-enable button
      if (sendLinkBtn) {
        sendLinkBtn.disabled = false;
        sendLinkBtn.innerHTML = 'Send magic link';
      }

      if (error) {
        notyf.error(`Error: ${error.message}`);
      } else {
        notyf.success("📩 Check your email for the sign-in link.");
      }
    });
  }

  // Sign out button handler
  if (signoutBtn) {
    signoutBtn.addEventListener('click', async function() {
      console.log('[Auth] Sign out clicked');
      
      if (!supabaseClient) {
        notyf.error('Authentication service not available');
        return;
      }

      const { error } = await supabaseClient.auth.signOut();
      
      if (error) {
        console.error('[Auth] Error signing out:', error);
        notyf.error('Error signing out: ' + error.message);
      } else {
        console.log('[Auth] Signed out successfully');
        window.GAME_AUTH_MODE = 'guest';
        updateAuthUI(false);
        notyf.success('Signed out successfully');
      }
    });
  }

  // Email validation helper
  function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  // Allow Enter key to submit email
  if (emailInput) {
    emailInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        sendLinkBtn.click();
      }
    });
  }

  // Listen for engine load completion and verify connection
  const checkEngineInterval = setInterval(() => {
    if (window.GAME_ENGINE_LOADED) {
      console.log('[Engine] Engine is ready!');
      clearInterval(checkEngineInterval);
      
      // Verify connection after a short delay to let bridge initialize
      setTimeout(() => {
        console.log('[Connection] Verifying connection with game engine...');
        verifyEngineConnection();
        
        // Also set up periodic connection checks (every 2 seconds for first 10 seconds)
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

  console.log('[App] SILO DERPLES initialized successfully');
  console.log('[App] Debug helpers available:');
  console.log('  - testEngineConnection() - Test the connection');
  console.log('  - setAuthMode("guest"|"email") - Set auth mode manually');

  // PWA Install Prompt Handling
  let deferredPrompt;
  let installButton = null;

  // Create install button if needed
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

  // Listen for beforeinstallprompt event
  window.addEventListener('beforeinstallprompt', (e) => {
    console.log('[PWA] Install prompt available');
    e.preventDefault();
    deferredPrompt = e;
    
    const btn = createInstallButton();
    btn.style.display = 'block';
  });

  // Listen for app installed event
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App was installed');
    deferredPrompt = null;
    if (installButton) {
      installButton.style.display = 'none';
    }
    notyf.success('App installed successfully!');
  });

  // Check if app is already installed
  if (window.matchMedia('(display-mode: standalone)').matches) {
    console.log('[PWA] Running in standalone mode');
  }

  // Service Worker update handling
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[PWA] New service worker activated');
      // Optionally reload the page to use new service worker
      // window.location.reload();
    });
  }
});

