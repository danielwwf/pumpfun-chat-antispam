// Pumpfun Auto Mod — content script (3 actions only: highlight, delete via UI, ban via UI)
(() => {
  const K_ENABLED = "pfam_enabled";
  const K_ACTION = "pfam_action";          // "highlight" | "delete_ui" | "ban_ui"
  const K_CUSTOM_TRIGGERS = "pfam_custom_triggers"; // Custom trigger words

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
  
  // Batch processing
  let pendingMessages = new Set();
  let batchTimeout = null;
  const BATCH_DELAY = 1000; // Wait 1 second to collect messages before processing
  const MAX_BATCH_SIZE = 10; // Process max 10 messages at once
  
  let cachedMessages = null;
  let cacheTimestamp = 0;
  const CACHE_DURATION = 1000;
  
  // Unified monitoring system (scanning + health)
  let monitoringInterval = null;
  const MONITORING_DELAY = 5000; // Monitor every 5 seconds
  let lastKnownMessage = null;
  let healthCheckCounter = 0;
  
  // Tab registration
  let tabId = 'tab_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  let isActiveTab = false;
  let tabHeartbeatInterval = null;
  const TAB_HEARTBEAT_DELAY = 10000; // Send heartbeat every 10 seconds
  const TAB_HEARTBEAT_TIMEOUT = 15000; // Consider tab dead after 15 seconds
  
  // Self-healing system removed - redundant with periodic scanning

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function log(...args) {
    console.log("%cPF Auto-Mod", "color:#4af;font-weight:bold;", ...args);
  }

  function getAllMessages(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedMessages && (now - cacheTimestamp) < CACHE_DURATION) {
      return cachedMessages; // Return cached result
    }
    
    // Refresh cache
    cachedMessages = document.querySelectorAll('div[data-message-id]');
    cacheTimestamp = now;
    return cachedMessages;
  }
  
  function invalidateMessageCache() {
    cachedMessages = null;
    cacheTimestamp = 0;
  }

  function addToBatch(bubble) {
    if (!bubble || !ENABLED) return;
    
    if (ACTION === "viewer_mode") {
      if (isMatch(bubble.innerText || "")) {
        hideBubble(bubble);
      }
      return;
    }
    
    pendingMessages.add(bubble);
    
    // If batch is full, process immediately
    if (pendingMessages.size >= MAX_BATCH_SIZE) {
      processBatch();
      return;
    }
    
    if (batchTimeout) clearTimeout(batchTimeout);
    batchTimeout = setTimeout(() => {
      processBatch();
    }, BATCH_DELAY);
  }

  async function processBatch() {
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }
    
    if (pendingMessages.size === 0 || isProcessing) return;
    
    const messages = Array.from(pendingMessages);
    pendingMessages.clear();
    
    if (ACTION === "highlight") {
      messages.forEach(bubble => {
        if (isMatch(bubble.innerText || "")) {
          markHighlighted(bubble);
        }
      });
      return;
    }
    
    // For delete/ban operations, process one by one with lock
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
        const allMessages = getAllMessages();
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
            addToBatch(bubble);
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
      if (!isProcessing && pendingMessages.size === 0) {
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
              addToBatch(bubble);
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

  // Chat health functions removed - now part of unified monitoring

  // Tab registration functions
  function checkTabStatus() {
    if (!chrome.storage?.local) {
      // Fallback if chrome.storage.local not available
      isActiveTab = true;
      log(`✅ this tab is active (fallback mode): ${tabId}`);
      return;
    }
    
    chrome.storage.local.get(['activeTabId', 'lastHeartbeat'], (result) => {
      const now = Date.now();
      const timeSinceHeartbeat = now - (result.lastHeartbeat || 0);
      
      // If no active tab OR heartbeat is old, try to become active
      if (!result.activeTabId || timeSinceHeartbeat > TAB_HEARTBEAT_TIMEOUT) {
        becomeActiveTab();
      } else if (result.activeTabId === tabId) {
        // This is the active tab
        isActiveTab = true;
        log(`✅ this tab is active (${tabId})`);
        startTabHeartbeat();
      } else {
        // This tab is dormant
        isActiveTab = false;
        log(`⚪ this tab is dormant - active tab: ${result.activeTabId}`);
        stopTabHeartbeat();
      }
    });
  }

  function becomeActiveTab() {
    isActiveTab = true;
    if (chrome.storage?.local) {
      chrome.storage.local.set({
        activeTabId: tabId,
        lastHeartbeat: Date.now()
      }, () => {
        log(`🟢 became active tab (${tabId})`);
        startTabHeartbeat();
      });
    } else {
      log(`🟢 became active tab (fallback mode): ${tabId}`);
    }
  }

  function startTabHeartbeat() {
    if (ACTION === "viewer_mode" || !chrome.storage?.local) return;
    if (tabHeartbeatInterval) clearInterval(tabHeartbeatInterval);
    
    tabHeartbeatInterval = setInterval(() => {
      if (isActiveTab && chrome.storage?.local) {
        try {
          chrome.storage.local.set({ lastHeartbeat: Date.now() });
        } catch (error) {
          log("heartbeat storage error (non-critical)");
        }
      }
    }, TAB_HEARTBEAT_DELAY);
  }

  function stopTabHeartbeat() {
    if (tabHeartbeatInterval) {
      clearInterval(tabHeartbeatInterval);
      tabHeartbeatInterval = null;
    }
  }

  function forceActivateThisTab() {
    log("🔄 force activating this tab");
    becomeActiveTab();
  }

  // Self-healing functions removed - redundant with periodic scanning

  // checkForStuckMessages and triggerSelfHealing functions removed
  // Redundant with existing periodic scanning and processing timeout systems

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
    
    // OPTIMIZED: Invalidate cache
    invalidateMessageCache();
    
    setTimeout(() => {
      if (ENABLED && isActiveTab) {
        scanRoot(document);
      }
    }, 500);
  }

  function updateLastKnownMessage() {
    // OPTIMIZED: Use cached messages
    const allMessages = getAllMessages();
    if (allMessages.length === 0) return;
    
    // PERFORMANCE: Reverse iteration to find last non-spam message quickly
    let lastNonSpamMessage = null;
    
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const message = allMessages[i];
      const text = message.innerText || "";
      
      // OPTIMIZED: Skip spam check for better performance
      if (!isMatch(text)) {
        lastNonSpamMessage = message;
        break; // Early exit - found what we need
      }
      
      // OPTIMIZED: Only log in debug mode
      if (ACTION !== "viewer_mode") {
        log(`skipping spam message as reference: "${text.substring(0, 30)}..."`);
      }
    }
      
    if (lastNonSpamMessage) {
      const text = lastNonSpamMessage.innerText || "";
      lastKnownMessage = {
        id: lastNonSpamMessage.getAttribute('data-message-id'),
        text: text.substring(0, 50),
        timestamp: Date.now()
      };
      
      log(`updated last known message (non-spam): "${lastKnownMessage.text}..." (${lastKnownMessage.id})`);
    } else {
      log("no non-spam messages found - keeping previous reference");
    }
  }

  function checkChatHealth() {
    if (!lastKnownMessage) {
      log("no last known message - updating reference");
      updateLastKnownMessage();
      return;
    }
    
    // Check if the last known message still exists
    const lastMessageStillExists = document.querySelector(`div[data-message-id="${lastKnownMessage.id}"]`);
    
    if (lastMessageStillExists) {
      log(`chat health OK - last message still exists: "${lastKnownMessage.text}..."`);
      // Update to the newest message for next check
      updateLastKnownMessage();
    } else {
      const timeSinceUpdate = Date.now() - lastKnownMessage.timestamp;
      const minutesAgo = Math.round(timeSinceUpdate / 60000);
      
      log(`🚨 CHAT DIED! Last known message from ${minutesAgo}min ago disappeared: "${lastKnownMessage.text}..."`);
      log("attempting to refresh page to restore chat connection...");
      
      // Refresh the entire page
      window.location.reload();
    }
  }

  // Homoglyph mapping (subset; enough for common tricks)
  const HOMO = {
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
  function unifyHomoglyphs(s) {
    return s.replace(/[\u00A0-\uFFFF]/g, ch => HOMO[ch] || ch);
  }
  function normalizeKeepAt(s) {
    // keep '@' so the wildcard @*rug* works; strip zero-width & diacritics
    return unifyHomoglyphs((s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
    );
  }

  // Matcher: checks custom triggers + legacy hardcoded patterns
  function isMatch(text) {
    const t = normalizeKeepAt(text);
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
          return normalizeKeepAt(str).replace(/[^a-z0-9]/g, '');
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
      
      const normalizedTrigger = normalizeKeepAt(trigger);
      
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
    
    // No logging in production to minimize any potential activity
    // log(`hidden spam bubble from view`);
  }

  function getKebabButton(bubble) {
    // Look for the kebab menu button - should have aria-label="Moderation actions"
    const selectors = [
      'button[aria-label="Moderation actions"]',
      'button[aria-haspopup="menu"]',
      'button[aria-label*="Moderation"]',
      'button[title*="Moderation"]'
    ];
    
    for (const selector of selectors) {
      const btn = bubble.querySelector(selector);
      if (btn && isVisible(btn)) {
        log(`found kebab button with selector: ${selector}`);
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

  function normLabel(el) {
    return normalizeKeepAt(
      el?.innerText || el?.textContent || el?.getAttribute("aria-label") || el?.title || ""
    );
  }

  function findMenuItemByText(needle) {
    const originalNeedle = needle;
    needle = normalizeKeepAt(needle);
    log(`searching for menu item: "${originalNeedle}" (normalized: "${needle}")`);
    
    // Try multiple selectors - start specific, then get more generic
    const menuSelectors = [
      '[role="menuitem"]',
      '[role="option"]', 
      'div[data-radix-collection-item]',
      '[data-radix-dropdown-menu-item]',
      'button[role="menuitem"]',
      'div[role="menuitem"]',
      // More generic fallbacks for stubborn menus
      'button:not([aria-hidden="true"])',
      'div:not([aria-hidden="true"])',
      'span:not([aria-hidden="true"])'
    ];
    
    for (const selector of menuSelectors) {
      const candidates = document.querySelectorAll(selector);
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        
        // Try multiple text extraction methods
        const texts = [
          el.innerText,
          el.textContent,
          el.getAttribute("aria-label"),
          el.title,
          el.getAttribute("data-label")
        ].filter(Boolean);
        
        for (const text of texts) {
          const normalized = normalizeKeepAt(text);
          
          // Try exact match and partial matches
          if (normalized === needle || 
              normalized.includes(needle) || 
              needle.includes(normalized) ||
              text.toLowerCase() === originalNeedle.toLowerCase()) {
            log(`found menu item: "${text}" matches "${originalNeedle}"`);
            return el;
          }
        }
      }
    }
    
    log(`menu item not found for: "${originalNeedle}"`);
    return null;
  }

  async function deleteViaUI(bubble) {
    const kebab = getKebabButton(bubble);
    if (!kebab) { log("delete: kebab not found"); return false; }
    await clickEl(kebab);
    await sleep(DELAY_MS);

    // "Delete message"
    let del = null;
    for (let i = 0; i < 10 && !del; i++) {
      del = findMenuItemByText("delete message");
      if (!del) await sleep(150);
    }
    if (!del) { log("delete: menu item not found"); return false; }

    await clickEl(del);
    await sleep(300); // safety
    return true;
  }

  async function banViaUI(bubble) {
    const kebab = getKebabButton(bubble);
    if (!kebab) { log("ban: kebab not found"); return false; }
    await clickEl(kebab);
    await sleep(DELAY_MS);

    // "Ban user" - try multiple variations and case sensitivity
    let ban = null;
    const banVariations = ["ban user", "Ban user", "BAN USER", "ban", "Ban"];
    
    for (let i = 0; i < 15 && !ban; i++) {
      for (const variation of banVariations) {
        ban = findMenuItemByText(variation);
        if (ban) {
          log(`found ban menu item with text: "${variation}"`);
          break;
        }
      }
      if (!ban) await sleep(200);
    }
    
    if (!ban) { 
      log("ban: 'Ban user' not found - trying to close menu");
      // Click somewhere else to close the menu
      document.body.click();
      return false; 
    }
    
    log("clicking ban user menu item to open submenu");
    await clickEl(ban);
    await sleep(DELAY_MS + 500); // Extra time for submenu to appear

    // Wait for submenu and find reason ("Spam" or "Toxic") - try multiple variations
    let reason = null;
    const reasonVariations = [
      REASON.toLowerCase(),
      REASON,
      REASON.toUpperCase(),
      normalizeKeepAt(REASON)
    ];
    
    log(`looking for ban reason variations: ${reasonVariations.join(', ')}`);
    
    for (let i = 0; i < 15 && !reason; i++) {
      for (const variation of reasonVariations) {
        reason = findMenuItemByText(variation);
        if (reason) {
          log(`found ban reason with variation: "${variation}"`);
          break;
        }
      }
      if (!reason) {
        log(`ban reason not found, attempt ${i + 1}/15`);
        await sleep(300);
      }
    }
    
    if (!reason) { 
      log(`ban: reason "${REASON}" not found after submenu opened`);
      
      // Debug: show what menu items are actually available
      const allMenuItems = document.querySelectorAll('[role="menuitem"], [role="option"], div[data-radix-collection-item]');
      log(`available menu items: ${Array.from(allMenuItems).map(el => `"${el.innerText || el.textContent}"`).join(', ')}`);
      
      document.body.click(); // Close menu
      return false; 
    }
    
    log(`clicking ban reason: "${REASON}"`);
    await clickEl(reason);
    await sleep(500); // Extra time for ban to process
    return true;
  }

  async function handleBubble(bubble) {
    if (!bubble || bubble.dataset.pfamProcessed || !ENABLED) return;
    
    // Only process if this is the active tab
    if (!isActiveTab) {
      return; // Dormant tab - do nothing
    }
    
    // Try to extract just the message text, not the username
    let messageText = "";
    const fullText = bubble.innerText || "";
    
    // Look for p.break-words element which typically contains the message
    const messageElement = bubble.querySelector('p.break-words, p[class*="break"]');
    if (messageElement) {
      messageText = messageElement.textContent || messageElement.innerText || "";
      messageText = messageText.replace(/\s+/g, ' ').trim();
      // Skip extraction logging in viewer mode
    } else {
      // Skip fallback logging in viewer mode
    }
    
    // Fallback to full text if we can't extract the message
    const textToCheck = messageText || fullText;
    
    if (!isMatch(textToCheck)) return;

    // Skip match logging in viewer mode for performance

    // Add to batch instead of processing immediately
    addToBatch(bubble);
  }

  function scanRoot(root) {
    if (!root || !ENABLED) return;
    
    // In viewer mode, don't process existing messages - only new ones from mutation observer
    if (ACTION === "viewer_mode") {
      return;
    }
    
    // OPTIMIZED: Use cached query and batch processing
    const messages = (root === document) ? getAllMessages() : root.querySelectorAll('div[data-message-id]');
    
    // PERFORMANCE: Process in batches to avoid blocking UI
    const SCAN_BATCH_SIZE = 20;
    let processed = 0;
    
    function processBatch() {
      const end = Math.min(processed + SCAN_BATCH_SIZE, messages.length);
      
      for (let i = processed; i < end; i++) {
        handleBubble(messages[i]);
      }
      
      processed = end;
      
      // Continue processing if more messages remain
      if (processed < messages.length) {
        setTimeout(processBatch, 0); // Yield to browser
      }
    }
    
    processBatch();
  }

  function installObserver(root) {
    const mo = new MutationObserver(muts => {
      if (!ENABLED) return; // Don't process if extension is disabled
      
      // OPTIMIZED: Batch mutations and avoid duplicate processing
      const processedBubbles = new Set();
      
      for (const m of muts) {
        if (m.type === "childList") {
          // PERFORMANCE: Process added nodes efficiently
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            
            const bubble = closestBubble(n);
            if (bubble && !processedBubbles.has(bubble)) {
              processedBubbles.add(bubble);
              handleBubble(bubble);
            }
            
            // OPTIMIZED: Only scan if node has children
            if (n.children && n.children.length > 0) {
              const innerBubbles = n.querySelectorAll('div[data-message-id]');
              for (const el of innerBubbles) {
                if (!processedBubbles.has(el)) {
                  processedBubbles.add(el);
                  handleBubble(el);
                }
              }
            }
          }
        } else if (m.type === "characterData") {
          const el = m.target && m.target.parentElement;
          const bubble = closestBubble(el);
          if (bubble && !processedBubbles.has(bubble)) {
            processedBubbles.add(bubble);
            handleBubble(bubble);
          }
        }
      }
      
      // OPTIMIZED: Invalidate cache when DOM changes
      if (processedBubbles.size > 0) {
        invalidateMessageCache();
      }
    });
    mo.observe(root, { subtree: true, childList: true, characterData: true });
  }

  function loadFromStorage(cb) {
    const keysToLoad = {...DEFAULTS, [K_CUSTOM_TRIGGERS]: ""};
    
    chrome.storage?.sync.get(keysToLoad, (res) => {
      ENABLED  = !!res[K_ENABLED];
      ACTION   = res[K_ACTION] || DEFAULTS[K_ACTION];
      // DELAY_MS is now hardcoded to 200ms - no storage needed
      // REASON is now hardcoded to "Spam" - no storage needed
      
      // Load custom triggers
      loadCustomTriggers(res[K_CUSTOM_TRIGGERS]);
      
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
      // If being disabled, clear pending batches and stop processing
      if (!ENABLED) {
        pendingMessages.clear();
        if (batchTimeout) {
          clearTimeout(batchTimeout);
          batchTimeout = null;
        }
        if (processingTimeout) {
          clearTimeout(processingTimeout);
          processingTimeout = null;
        }
        isProcessing = false;
        stopMonitoring();
        stopTabHeartbeat();
        isActiveTab = false;
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
        // Clear pending batch since action changed
        pendingMessages.clear();
        if (batchTimeout) {
          clearTimeout(batchTimeout);
          batchTimeout = null;
        }
      }
    }
    
    // DELAY_MS is now hardcoded - no need to listen for changes
    // REASON is now hardcoded - no need to listen for changes
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
      stopTabHeartbeat();
      isActiveTab = false;
      return; 
    }
    log(`active (action=${ACTION}, delay=200ms, reason=Spam)`);
    
    // For viewer mode, only start minimal systems (no storage writes, no background tasks)
    if (ACTION === "viewer_mode") {
      isActiveTab = true; // Always active in viewer mode (no coordination needed)
      scanRoot(document); // Skip existing messages
      installObserver(document); // Only listen for new messages
      return;
    }
    
    // For other modes, start full systems
    log("🛡️ MODERATOR MODE: Starting full systems");
    checkTabStatus();
    scanRoot(document);
    installObserver(document);
    startMonitoring();
  }

  // Message listener for popup communication
  chrome.runtime?.onMessage?.addListener((request, sender, sendResponse) => {
    // In viewer mode, ignore all messages except getTabStatus
    if (ACTION === "viewer_mode" && request.action !== "getTabStatus") {
      return;
    }
    if (request.action === "getTabStatus") {
      sendResponse({
        isActive: isActiveTab,
        tabId: tabId
      });
    } else if (request.action === "forceActivate") {
      forceActivateThisTab();
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
    }
  });

  // boot
  loadFromStorage(start);
})();
