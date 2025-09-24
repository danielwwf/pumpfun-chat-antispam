// Pumpfun Auto Mod — content script (3 actions only: highlight, delete via UI, ban via UI)
(() => {
  const K_ENABLED = "pfam_enabled";
  const K_ACTION = "pfam_action";          // "highlight" | "delete_ui" | "ban_ui"
  const K_CUSTOM_TRIGGERS = "pfam_custom_triggers"; // Custom trigger words
  const K_CLOUDFLARE_BLOCKED = "pfam_cloudflare_blocked"; // Persistent Cloudflare detection

  const DEFAULTS = {
    [K_ENABLED]: true,
    [K_ACTION]: "viewer_mode"
  };

  let ENABLED  = DEFAULTS[K_ENABLED];
  let ACTION   = DEFAULTS[K_ACTION];
  const DELAY_MS = 200; // Hardcoded to 0.2s - LIGHTNING FAST, no user fuckups!
  const REASON = "Spam"; // Always use Spam - no user choice needed
  let CUSTOM_TRIGGERS = []; // Array of custom trigger words

  let isProcessing = false;
  let processingTimeout = null;
  
  // Simplified processing queue
  let processingQueue = [];
  let processTimeout = null;
  
  // Cache system removed - direct DOM queries are simpler and more reliable
  
  // Unified monitoring system (scanning + health)
  let monitoringInterval = null;
  const MONITORING_DELAY = 5000; // Monitor every 5 seconds
  let lastKnownMessage = null;
  let healthCheckCounter = 0;
  
  // Simplified tab management - assume single tab for 90% of users
  let isActiveTab = true; // Default to active - most users have one tab
  
  // Self-healing system removed - redundant with periodic scanning

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function log(...args) {
    console.log("%cPF Auto-Mod", "color:#4af;font-weight:bold;", ...args);
  }

  // ============ API-FIRST HYBRID SYSTEM ============
  
  // API statistics and rate limiting
  let apiStats = {
    attempts: 0,
    successes: 0,
    rateLimits: 0,
    lastRateLimit: 0,
    consecutiveFailures: 0,
    cloudflareDetected: false
  };

  let lastAPICall = 0;
  const API_RATE_LIMIT_BUFFER = 3000; // Wait 3 seconds between API calls (CONSERVATIVE!)
  const MAX_API_CALLS_PER_MINUTE = 10; // Max 10 API calls per minute to avoid Cloudflare
  let apiCallsThisMinute = 0;
  let minuteStartTime = Date.now();

  // Extract user wallet address from message bubble
  function getUserAddress(bubble) {
    // Strategy 1: Direct profile link
    const profileLink = bubble.querySelector('a[href*="/profile/"]');
    if (profileLink) {
      const address = profileLink.href.split('/profile/')[1];
      if (address && address.length > 30) { // Valid wallet address length
        return address;
      }
    }
    
    // Strategy 2: Username link that we can click to get profile
    const usernameLink = bubble.querySelector('a[href*="/profile/"], a:first-child');
    if (usernameLink && usernameLink.href.includes('/profile/')) {
      return usernameLink.href.split('/profile/')[1];
    }
    
    // Strategy 3: Look for any wallet-like string in the bubble
    const text = bubble.innerText || "";
    const walletMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/); // Base58 wallet pattern
    if (walletMatch) {
      return walletMatch[0];
    }
    
    return null; // No address found
  }

  // Get current coin/room ID from URL
  function getCoinId() {
    const path = window.location.pathname;
    const coinId = path.split('/')[2]; // /coin/COINID or similar
    return coinId;
  }

  // Build ban endpoint for current room
  function getBanEndpoint() {
    const coinId = getCoinId();
    return `https://livechat.pump.fun/chat/moderation/rooms/${coinId}/bans`;
  }

  // Check if we should use API based on recent performance
  function shouldUseAPI() {
    // Don't use if Cloudflare detected
    if (apiStats.cloudflareDetected) {
      return false;
    }
    
    // CONSERVATIVE: Check per-minute rate limiting
    const now = Date.now();
    if (now - minuteStartTime > 60000) {
      // Reset minute counter
      minuteStartTime = now;
      apiCallsThisMinute = 0;
    }
    
    // Don't exceed per-minute limit
    if (apiCallsThisMinute >= MAX_API_CALLS_PER_MINUTE) {
      return false;
    }
    
    // Don't use if recently rate limited (wait 5 minutes - LONGER!)
    const timeSinceRateLimit = Date.now() - apiStats.lastRateLimit;
    if (timeSinceRateLimit < 300000) { // 5 minutes instead of 2
      return false;
    }
    
    // Don't use if too many consecutive failures (MORE CONSERVATIVE)
    if (apiStats.consecutiveFailures >= 3) { // 3 instead of 5
      return false;
    }
    
    // Don't use if success rate is too low (MORE CONSERVATIVE)
    if (apiStats.attempts > 10) { // Check earlier
      const successRate = apiStats.successes / apiStats.attempts;
      if (successRate < 0.5) { // Higher threshold
        return false;
      }
    }
    
    return true;
  }

  // Main API ban function
  async function banViaAPI(userAddress) {
    try {
      const endpoint = getBanEndpoint();
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          userAddress: userAddress,
          reason: "SPAM"
        }),
        credentials: "include"
      });
      
      if (response.status === 204) {
        return { success: true };
      } else if (response.status === 429) {
        return { success: false, rateLimited: true };
      } else if (response.status === 403) {
        return { success: false, noPermissions: true };
      } else if (response.status === 403 && response.headers.get('server')?.includes('cloudflare')) {
        apiStats.cloudflareDetected = true;
        // Save Cloudflare detection permanently
        chrome.storage?.sync.set({ [K_CLOUDFLARE_BLOCKED]: true });
        log("🚨 Cloudflare protection detected - saved to storage");
        return { success: false, cloudflareBlocked: true };
      } else {
        return { success: false, unknownError: true, status: response.status };
      }
      
    } catch (error) {
      return { success: false, networkError: true, error: error.message };
    }
  }

  // Rate-limited API call wrapper with per-minute tracking
  async function rateLimitedAPICall(userAddress) {
    // Enforce minimum delay between API calls
    const timeSinceLastCall = Date.now() - lastAPICall;
    if (timeSinceLastCall < API_RATE_LIMIT_BUFFER) {
      await sleep(API_RATE_LIMIT_BUFFER - timeSinceLastCall);
    }
    
    // Track per-minute usage
    apiCallsThisMinute++;
    lastAPICall = Date.now();
    
    log(`🔍 API Call ${apiCallsThisMinute}/${MAX_API_CALLS_PER_MINUTE} this minute`);
    
    return await banViaAPI(userAddress);
  }

  // Main hybrid ban function
  async function banViaHybrid(bubble) {
    const userAddress = getUserAddress(bubble);
    
    // If no address found, fall back to UI immediately
    if (!userAddress) {
      log("No user address - using UI method");
      return await banViaUI(bubble);
    }
    
    // Try API first if conditions are favorable
    if (shouldUseAPI()) {
      log(`⚡ Attempting API ban: ${userAddress.substring(0, 8)}...`);
      
      const apiResult = await rateLimitedAPICall(userAddress);
      apiStats.attempts++;
      
      if (apiResult.success) {
        apiStats.successes++;
        apiStats.consecutiveFailures = 0;
        log(`✅ API ban successful! (${apiStats.successes}/${apiStats.attempts} success rate)`);
        return true;
      } else {
        // Update stats based on failure type
        if (apiResult.rateLimited) {
          apiStats.rateLimits++;
          apiStats.lastRateLimit = Date.now();
          apiStats.consecutiveFailures++;
          log(`🚨 Rate limited! Switching to UI mode temporarily`);
        } else if (apiResult.cloudflareBlocked) {
          log(`🚨 Cloudflare protection detected! Disabling API permanently`);
        } else {
          apiStats.consecutiveFailures++;
          log(`❌ API ban failed: ${JSON.stringify(apiResult)}`);
        }
      }
    } else {
      log(`⏸️ API conditions not favorable - using UI method`);
    }
    
    // Fallback to UI method
    log(`🔄 Falling back to UI ban method`);
    return await banViaUI(bubble);
  }

  // ============ END API SYSTEM ============

  // VIEWER MODE SPECIALIZATION - Ultra lightweight path
  function startViewerMode() {
    // Skip existing messages - only process new ones
    const observer = new MutationObserver(mutations => {
      if (!ENABLED) return;
      
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) {
              const bubble = node.closest?.('div[data-message-id]') || 
                           (node.matches?.('div[data-message-id]') ? node : null);
              if (bubble) {
                handleViewerMode(bubble);
              }
            }
          }
        }
      }
    });
    
    observer.observe(document, { subtree: true, childList: true });
  }

  // Dedicated viewer mode - ultra lightweight
  function handleViewerMode(bubble) {
    if (!bubble || !ENABLED || bubble.dataset.pfamProcessed) return;
    
    const text = bubble.innerText || "";
    if (isMatch(text)) {
      bubble.dataset.pfamProcessed = "1";
      bubble.style.display = "none";
    }
  }

  function addToQueue(bubble) {
    if (!bubble || !ENABLED) return;
    
    if (ACTION === "viewer_mode") {
      handleViewerMode(bubble);
      return;
    }
    
    processingQueue.push(bubble);
    
    if (!processTimeout) {
      processTimeout = setTimeout(() => {
        processQueue();
      }, 100);
    }
  }

  async function processQueue() {
    processTimeout = null;
    
    if (processingQueue.length === 0 || isProcessing) return;
    
    const messages = [...processingQueue];
    processingQueue = [];
    
    if (ACTION === "highlight") {
      messages.forEach(bubble => {
        if (isMatch(bubble.innerText || "")) {
          markHighlighted(bubble);
        }
      });
      return;
    }
    
    // For delete/ban operations, process sequentially
    await processMessagesSequentially(messages);
  }

  async function processMessagesSequentially(messages) {
    for (const bubble of messages) {
      if (!ENABLED) break; // Stop if disabled mid-batch
      
      const tx = bubble.innerText || "";
      if (!isMatch(tx) || bubble.dataset.pfamProcessed) continue;
      
      isProcessing = true;
      
      // Set timeout safety
      if (processingTimeout) clearTimeout(processingTimeout);
      processingTimeout = setTimeout(() => {
        log("processing timeout - forcibly releasing lock");
        isProcessing = false;
        processingTimeout = null;
      }, 10000);
      
      try {
        markHighlighted(bubble);
        
        if (ACTION === "delete_ui") {
          const ok = await deleteViaUI(bubble);
          log(`delete operation ${ok ? 'succeeded' : 'failed'}`);
        } else if (ACTION === "ban_ui") {
          const ok = await banViaUI(bubble);
          log(`ban operation ${ok ? 'succeeded' : 'failed'}`);
          
          // If ban fails, fallback to delete to at least remove the message
          if (!ok) {
            log("ban failed - attempting fallback delete");
            const deleteOk = await deleteViaUI(bubble);
            log(`fallback delete operation ${deleteOk ? 'succeeded' : 'failed'}`);
          }
        } else if (ACTION === "ban_hybrid") {
          const ok = await banViaHybrid(bubble);
          log(`hybrid ban operation ${ok ? 'succeeded' : 'failed'}`);
          
          // If hybrid ban fails, try delete as last resort
          if (!ok) {
            log("hybrid ban failed - attempting fallback delete");
            const deleteOk = await deleteViaUI(bubble);
            log(`fallback delete operation ${deleteOk ? 'succeeded' : 'failed'}`);
          }
        }
        
        await sleep(200);
        
      } catch (error) {
        log("batch operation error:", error);
      } finally {
        if (processingTimeout) {
          clearTimeout(processingTimeout);
          processingTimeout = null;
        }
        isProcessing = false;
      }
    }
    
    // Update last known message after processing
    updateLastKnownMessage();
    
    // After processing batch, check if there are still unprocessed messages
    setTimeout(() => {
      if (!isProcessing && ENABLED) {
        const allMessages = document.querySelectorAll('div[data-message-id]');
        const spamMessages = [];
        
        for (const bubble of allMessages) {
          if (bubble.dataset.pfamProcessed) continue;
          
          const tx = bubble.innerText || "";
          if (isMatch(tx)) {
            spamMessages.push(bubble);
          }
        }
        
        if (spamMessages.length > 0) {
          for (const bubble of spamMessages) {
            addToQueue(bubble);
          }
        } else {
          if (ACTION !== "viewer_mode") {
            const summaryCount = Math.min(5, allMessages.length);
            log(`visible messages summary (${allMessages.length} total, showing last ${summaryCount}):`);
          
            // PERFORMANCE: Only process last 5 messages for summary
            for (let i = Math.max(0, allMessages.length - summaryCount); i < allMessages.length; i++) {
              const bubble = allMessages[i];
            const tx = bubble.innerText || "";
            const processed = bubble.dataset.pfamProcessed ? "✓" : "✗";
            const spam = isMatch(tx) ? "SPAM" : "OK";
              log(`  ${processed} ${spam}: "${tx.substring(0, 30)}..."`);
            }
          }
        }
      }
    }, 1500); // Increased delay to let UI settle
  }

  function startMonitoring() {
    if (monitoringInterval) clearInterval(monitoringInterval);
    
    // Update last known message immediately
    updateLastKnownMessage();
    
    monitoringInterval = setInterval(() => {
      if (!ENABLED) return;
      
      // Scan for missed messages (every cycle)
      if (!isProcessing && processingQueue.length === 0) {
        const unprocessedMessages = document.querySelectorAll('div[data-message-id]:not([data-pfam-processed])');
        if (unprocessedMessages.length > 0) {
          const spamMessages = [];
          for (const bubble of unprocessedMessages) {
            const tx = bubble.innerText || "";
            if (isMatch(tx)) {
              spamMessages.push(bubble);
            }
          }
          
          if (spamMessages.length > 0) {
        for (const bubble of spamMessages) {
          addToQueue(bubble);
        }
          }
        }
      }
      
      // Chat health check (every 6th cycle = 30 seconds)
      healthCheckCounter++;
      if (healthCheckCounter >= 6) {
        healthCheckCounter = 0;
        checkChatHealth();
      }
    }, MONITORING_DELAY);
  }

  function stopMonitoring() {
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
      lastKnownMessage = null;
    }
  }

  // Removed systems: chat health, tab coordination, self-healing (now simplified)

  function forceRescanAllMessages() {
    log("🔄 FORCE RESCAN: Clearing all processed flags and rescanning everything");
    
    // OPTIMIZED: Clear processed flags in single pass
    const processedMessages = document.querySelectorAll('div[data-message-id][data-pfam-processed]');
    
    // PERFORMANCE: Batch DOM operations
    for (const bubble of processedMessages) {
      delete bubble.dataset.pfamProcessed;
      // Clear highlight styling in one go
      bubble.style.cssText = bubble.style.cssText
        .replace(/outline[^;]*;?/g, '')
        .replace(/box-shadow[^;]*;?/g, '');
    }
    
    log(`cleared ${processedMessages.length} processed flags - rescanning all messages`);
    
    setTimeout(() => {
      if (ENABLED) {
        scanRoot(document);
      }
    }, 500);
  }

  function updateLastKnownMessage() {
    const allMessages = document.querySelectorAll('div[data-message-id]');
    if (allMessages.length > 0) {
      const lastMessage = allMessages[allMessages.length - 1];
        lastKnownMessage = {
        id: lastMessage.getAttribute('data-message-id'),
          timestamp: Date.now()
        };
    }
  }

  function checkChatHealth() {
    if (!lastKnownMessage) {
      updateLastKnownMessage();
      return;
    }
    
    // Simple check: if last known message disappeared, chat might be dead
    const exists = document.querySelector(`div[data-message-id="${lastKnownMessage.id}"]`);
    if (exists) {
      updateLastKnownMessage(); // Update to newest message
    } else {
      // Chat appears dead - refresh page
      window.location.reload();
    }
  }

  // Optimized text normalization with fast path for ASCII
  const homoMap = {
    "о":"o","Ο":"o","ο":"o","०":"o","ᴏ":"o","Ｏ":"o","ｏ":"o",
    "р":"p","Р":"p","ᴘ":"p","Ｐ":"p","ｐ":"p",
    "ѕ":"s","ʂ":"s","Ｓ":"s","ｓ":"s",
    "υ":"u","ᴜ":"u","Ｕ":"u","ｕ":"u",
    "ɡ":"g","ɢ":"g","Ｇ":"g","ｇ":"g",
    "ʀ":"r","Ｒ":"r","ｒ":"r",
    "а":"a","Ａ":"a","ａ":"a",
    "е":"e","Ｅ":"e","ｅ":"e",
    "і":"i","Ｉ":"i","ｉ":"i",
    "х":"x","Χ":"x","ｘ":"x","Ｘ":"x",
    "ј":"j","ȷ":"j"
  };

  function normalize(text) {
    if (!text) return "";
    
    // Fast path for ASCII-only text (common case)
    if (!/[^\x00-\x7F]/.test(text)) {
      return text.toLowerCase();
    }
    
    // Full normalization for Unicode text
    return text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/[\u00A0-\uFFFF]/g, ch => homoMap[ch] || ch);
  }

  // Matcher: checks custom triggers + legacy hardcoded patterns
  function isMatch(text) {
    const t = normalize(text);
    if (!t) return false;
    
    // Skip logging in viewer mode to minimize any activity
    if (ACTION !== "viewer_mode") {
      log(`🔍 checking message: "${text.substring(0, 50)}" (normalized: "${t.substring(0, 50)}")`);
      log(`🔍 against ${CUSTOM_TRIGGERS.length} triggers:`, CUSTOM_TRIGGERS);
    }
    
    // Check custom triggers first
    for (const trigger of CUSTOM_TRIGGERS) {
      if (!trigger) continue;
      
      // Handle exact phrase matching with "exact:" prefix
      if (trigger.startsWith("exact:")) {
        const exactPhrase = trigger.substring(6).trim(); // Remove "exact:" prefix
        
        // Extract only letters and numbers for comparison (ignore all spaces/punctuation)
        const extractLettersOnly = (str) => {
          return normalize(str).replace(/[^a-z0-9]/g, '');
        };
        
        const messageLettersOnly = extractLettersOnly(t);
        const triggerLettersOnly = extractLettersOnly(exactPhrase);
        
        // Skip logging in viewer mode for performance
        
        if (messageLettersOnly === triggerLettersOnly) {
          // Match found - skip logging in viewer mode
          return true;
        }
        
        continue;
      }
      
      const normalizedTrigger = normalize(trigger);
      
      // Handle wildcard patterns (e.g., "full*bundled*dont*buy")
      if (trigger.includes("*")) {
        // Convert wildcard pattern to regex that matches any chars (including spaces)
        // Replace * with .* to match any characters including spaces
        const wildcardPattern = normalizedTrigger
          .split('*')
          .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) // Escape regex special chars
          .join('.*'); // .* matches any chars including spaces
        
        const regex = new RegExp(wildcardPattern, 'i');
        
        // Skip pattern logging in viewer mode
        
        if (regex.test(t)) {
          // Pattern matched - skip logging in viewer mode
          return true;
        }
      } else {
        // Regular partial string matching (no wildcards)
        if (t.includes(normalizedTrigger)) return true;
      }
    }
    
    // Fallback to hardcoded patterns if no custom triggers
    if (CUSTOM_TRIGGERS.length === 0) {
      if (t.includes("stoprugs")) return true;
      if (t.includes("solspoint")) return true;
      // @ followed by any non-space chars with "rug" somewhere in the token
      return /@\S*rug\S*/i.test(t);
    }
    
    return false;
  }

  function closestBubble(node) {
    if (!node || node.nodeType !== 1) return null;
    return node.closest('div[data-message-id]');
  }

  function markHighlighted(bubble) {
    if (bubble.dataset.pfamProcessed) return;
    bubble.dataset.pfamProcessed = "1";

    // Visual highlight (safe)
    bubble.style.position = bubble.style.position || "relative";
    bubble.style.outline = "2px dashed #00d0ff";
    bubble.style.outlineOffset = "4px";
    bubble.style.boxShadow = "0 0 0 9999px rgba(0,0,0,0.12) inset";
  }

  function hideBubble(bubble) {
    if (bubble.dataset.pfamProcessed) return;
    bubble.dataset.pfamProcessed = "1";

    // Hide the bubble completely (viewer mode) - PURE CSS, NO NETWORK ACTIVITY
    bubble.style.display = "none";
    
    // Pure CSS hiding - no logging needed
  }

  function getKebabButton(bubble) {
    // Comprehensive kebab button detection
    const selectors = [
      'button[aria-label="Moderation actions"]',
      'button[aria-haspopup="menu"]',
      'button[aria-label*="Moderation"]',
      'button[title*="Moderation"]',
      'button[aria-label*="More"]',
      'button[aria-label*="Options"]',
      'button[data-testid*="menu"]',
      'button[data-testid*="kebab"]',
      'button[data-testid*="more"]',
      'button:has(svg)',
      'button:has([data-icon])',
      'button:has(.icon)',
      '[role="button"][aria-haspopup]',
      'button[class*="menu"]',
      'button[class*="dropdown"]'
    ];
    
    for (const selector of selectors) {
      try {
      const btn = bubble.querySelector(selector);
      if (btn && isVisible(btn)) {
        log(`found kebab button with selector: ${selector}`);
          return btn;
        }
      } catch (e) {
        // Skip invalid selectors
        continue;
      }
    }
    
    // Fallback: look for any button that might be a menu trigger
    const allButtons = bubble.querySelectorAll('button');
    for (const btn of allButtons) {
      if (isVisible(btn) && (
        btn.getAttribute('aria-haspopup') ||
        btn.innerHTML.includes('svg') ||
        btn.innerHTML.includes('⋮') ||
        btn.innerHTML.includes('•••') ||
        btn.classList.toString().includes('menu') ||
        btn.classList.toString().includes('dropdown')
      )) {
        log(`found kebab button via fallback detection`);
        return btn;
      }
    }
    
    log("kebab button not found with any selector");
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return !!(r.width || r.height) && getComputedStyle(el).visibility !== "hidden";
  }

  async function clickEl(el) {
    log(`clicking element: ${el.tagName} with text: "${el.innerText || el.textContent || 'no text'}"`);
    el.dispatchEvent(new MouseEvent("pointerdown", {bubbles:true}));
    el.dispatchEvent(new MouseEvent("mousedown", {bubbles:true}));
    el.dispatchEvent(new MouseEvent("mouseup",   {bubbles:true}));
    el.dispatchEvent(new MouseEvent("click",     {bubbles:true}));
    await sleep(100); // small delay after click
  }

  function findMenuItemByText(needle) {
    const normalizedNeedle = normalize(needle);
    
    // Essential selectors only
    const selectors = '[role="menuitem"], [role="option"], div[data-radix-collection-item]';
    const candidates = document.querySelectorAll(selectors);
    
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        
      const text = el.innerText || el.textContent || el.getAttribute("aria-label") || "";
      const normalizedText = normalize(text);
      
      if (normalizedText.includes(normalizedNeedle) || needle.toLowerCase() === text.toLowerCase()) {
            return el;
      }
    }
    
    return null;
  }

  async function deleteViaUI(bubble) {
    const kebab = getKebabButton(bubble);
    if (!kebab) return false;
    
    await clickEl(kebab);
    await sleep(DELAY_MS);

    const del = findMenuItemByText("delete message");
    if (!del) return false;

    await clickEl(del);
    return true;
  }

  async function banViaUI(bubble) {
    const kebab = getKebabButton(bubble);
    if (!kebab) return false;
    
    await clickEl(kebab);
    await sleep(DELAY_MS);

    const ban = findMenuItemByText("ban user");
    if (!ban) { 
      document.body.click(); // Close menu
      return false; 
    }
    
    await clickEl(ban);
    await sleep(DELAY_MS + 300);

    const reason = findMenuItemByText("spam");
      if (!reason) {
      document.body.click(); // Close menu
      return false; 
    }
    
    await clickEl(reason);
    return true;
  }

  async function handleBubble(bubble) {
    if (!bubble || bubble.dataset.pfamProcessed || !ENABLED) return;
    
    // Simplified - always process (single tab assumption)
    
    // Extract message text (try message element, fallback to full text)
    const messageElement = bubble.querySelector('p.break-words, p[class*="break"]');
    const textToCheck = messageElement ? 
      (messageElement.textContent || "").replace(/\s+/g, ' ').trim() : 
      (bubble.innerText || "");
    
    if (!isMatch(textToCheck)) return;

    // Skip match logging in viewer mode for performance

    addToQueue(bubble);
  }

  function scanRoot(root) {
    if (!root || !ENABLED || ACTION === "viewer_mode") return;
    
    const messages = root.querySelectorAll('div[data-message-id]');
    
    // Direct processing - modern browsers handle this fine
    for (const message of messages) {
      handleBubble(message);
    }
  }

  function installObserver(root) {
    const mo = new MutationObserver(mutations => {
      if (!ENABLED) return;
      
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) {
              const bubble = closestBubble(node);
            if (bubble) handleBubble(bubble);
              
              // Check for nested message bubbles
              const innerBubbles = node.querySelectorAll?.('div[data-message-id]');
              if (innerBubbles) {
                for (const el of innerBubbles) {
                  handleBubble(el);
                }
              }
            }
          }
        } else if (mutation.type === "characterData") {
          const bubble = closestBubble(mutation.target?.parentElement);
          if (bubble) handleBubble(bubble);
        }
      }
    });
    
    mo.observe(root, { subtree: true, childList: true, characterData: true });
  }

  function loadFromStorage(cb) {
    const keysToLoad = {...DEFAULTS, [K_CUSTOM_TRIGGERS]: "", [K_CLOUDFLARE_BLOCKED]: false};
    
    chrome.storage?.sync.get(keysToLoad, (res) => {
      ENABLED  = !!res[K_ENABLED];
      ACTION   = res[K_ACTION] || DEFAULTS[K_ACTION];
      // DELAY_MS is now hardcoded to 200ms - no storage needed
      // REASON is now hardcoded to "Spam" - no storage needed
      
      // Load custom triggers
      loadCustomTriggers(res[K_CUSTOM_TRIGGERS]);
      
      // Load persistent Cloudflare detection
      apiStats.cloudflareDetected = !!res[K_CLOUDFLARE_BLOCKED];
      if (apiStats.cloudflareDetected) {
        log("🚨 Cloudflare protection was previously detected - API disabled");
      }
      
      cb && cb();
    });
  }

  function loadCustomTriggers(triggersText) {
    log(`loadCustomTriggers called with: "${triggersText}"`);
    
    if (triggersText && triggersText.trim()) {
      CUSTOM_TRIGGERS = triggersText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#')); // Remove empty lines and comments
      
      log(`loaded ${CUSTOM_TRIGGERS.length} custom triggers:`, CUSTOM_TRIGGERS);
    } else {
      // Use default triggers if nothing provided
      CUSTOM_TRIGGERS = [
        "stoprugs",
        "solspoint",
        "@*rug*",
        "full*bundled*dont*buy"
      ];
      log(`no custom triggers - using ${CUSTOM_TRIGGERS.length} default patterns:`, CUSTOM_TRIGGERS);
    }
  }

  chrome.storage?.onChanged.addListener((changes) => {
    // In viewer mode, only listen for enable/disable changes, ignore everything else
    if (ACTION === "viewer_mode" && !(K_ENABLED in changes)) {
      return;
    }
    
    let actionChanged = false;
    
    if (K_ENABLED in changes) {
      ENABLED = !!changes[K_ENABLED].newValue;
      // If being disabled, clear processing queue
      if (!ENABLED) {
        processingQueue = [];
        if (processTimeout) {
          clearTimeout(processTimeout);
          processTimeout = null;
        }
        if (processingTimeout) {
          clearTimeout(processingTimeout);
          processingTimeout = null;
        }
        isProcessing = false;
        stopMonitoring();
        // Extension disabled - stopping all operations
      }
    }
    
    if (K_ACTION in changes) {
      const oldAction = ACTION;
      ACTION = changes[K_ACTION].newValue || "highlight";
      actionChanged = (oldAction !== ACTION);
      
      if (actionChanged) {
        log(`action mode changed from ${oldAction} to ${ACTION} - clearing processed flags`);
        // Clear all processed flags so messages can be re-evaluated with new action
        const processedBubbles = document.querySelectorAll('div[data-message-id][data-pfam-processed]');
        processedBubbles.forEach(bubble => {
          delete bubble.dataset.pfamProcessed;
          // Also clear any existing highlights if switching away from highlight mode
          if (oldAction === "highlight" && ACTION !== "highlight") {
            bubble.style.outline = "";
            bubble.style.outlineOffset = "";
            bubble.style.boxShadow = "";
          }
        });
        // Clear processing queue since action changed
        processingQueue = [];
        if (processTimeout) {
          clearTimeout(processTimeout);
          processTimeout = null;
        }
      }
    }
    
    if (K_CUSTOM_TRIGGERS in changes) {
      loadCustomTriggers(changes[K_CUSTOM_TRIGGERS].newValue);
      log("custom triggers updated - rescanning messages");
      // Clear processed flags so messages can be re-evaluated with new triggers
      const processedBubbles = document.querySelectorAll('div[data-message-id][data-pfam-processed]');
      processedBubbles.forEach(bubble => {
        delete bubble.dataset.pfamProcessed;
        // Clear highlights if switching triggers
        bubble.style.outline = "";
        bubble.style.outlineOffset = "";
        bubble.style.boxShadow = "";
      });
    }
    
    log(`settings updated: enabled=${ENABLED}, action=${ACTION}, delay=200ms (hardcoded), reason=Spam (hardcoded)`);
    
    // re-scan immediately when toggled, enabled, or action changed
    if (ENABLED && (K_ENABLED in changes || actionChanged)) {
      scanRoot(document);
    }
  });

  function start() {
    if (!ENABLED) { 
      log("disabled (toggle in popup to enable)"); 
      stopMonitoring();
      return; 
    }
    log(`active (action=${ACTION}, delay=200ms, reason=Spam)`);
    
    // Start systems based on mode
    if (ACTION === "viewer_mode") {
      startViewerMode();
      return;
    }
    
    // For other modes, start full systems
    log("🛡️ MODERATOR MODE: Starting full systems");
    scanRoot(document);
    installObserver(document);
    startMonitoring();
  }

  // Message listener for popup communication
  chrome.runtime?.onMessage?.addListener((request, sender, sendResponse) => {
    console.log("🔍 DEBUG_MESSAGE: *** MESSAGE RECEIVED ***");
    console.log("🔍 DEBUG_MESSAGE: Action:", request.action);
    console.log("🔍 DEBUG_MESSAGE: Current ACTION mode:", ACTION);
    console.log("🔍 DEBUG_MESSAGE: ENABLED:", ENABLED);
    
    // In viewer mode, only ignore non-essential messages
    if (ACTION === "viewer_mode" && request.action !== "getTabStatus" && request.action !== "getAPIStats") {
      console.log("🔍 DEBUG_MESSAGE: Ignoring message in viewer mode");
      return;
    }
    if (request.action === "getTabStatus") {
      sendResponse({
        isActive: isActiveTab,
        tabId: "simplified"
      });
    } else if (request.action === "forceActivate") {
      isActiveTab = true; // Simple activation
      sendResponse({ success: true });
    } else if (request.action === "triggersUpdated") {
      // Reload triggers from storage
      chrome.storage?.sync?.get([K_CUSTOM_TRIGGERS], (res) => {
        loadCustomTriggers(res[K_CUSTOM_TRIGGERS]);
        log("triggers reloaded from storage");
        // Force rescan after triggers update to catch existing messages
        setTimeout(() => forceRescanAllMessages(), 1000);
        sendResponse({ success: true });
      });
      return true; // Will respond asynchronously
    } else if (request.action === "forceRescan") {
      forceRescanAllMessages();
      sendResponse({ success: true });
    } else if (request.action === "getAPIStats") {
      console.log("🔍 DEBUG_MESSAGE: Processing getAPIStats request");
      console.log("🔍 DEBUG_MESSAGE: apiStats:", apiStats);
      console.log("🔍 DEBUG_MESSAGE: shouldUseAPI:", shouldUseAPI());
      console.log("🔍 DEBUG_MESSAGE: coinId:", getCoinId());
      
      const response = { 
        stats: apiStats,
        shouldUseAPI: shouldUseAPI(),
        coinId: getCoinId(),
        banEndpoint: getBanEndpoint()
      };
      
      console.log("🔍 DEBUG_MESSAGE: Sending response:", response);
      sendResponse(response);
    } else if (request.action === "resetCloudflare") {
      // Manual reset for Cloudflare detection
      apiStats.cloudflareDetected = false;
      chrome.storage?.sync.set({ [K_CLOUDFLARE_BLOCKED]: false });
      log("🔄 Cloudflare detection manually reset - API re-enabled");
      sendResponse({ success: true });
    }
  });

  // boot
  loadFromStorage(start);
})();
