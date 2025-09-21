// Pumpfun Auto Mod — content script (3 actions only: highlight, delete via UI, ban via UI)
/**
 * lolnuked StreamGuard - Spam Protection for pump.fun
 * 
 * Created by: Daniel "CEO of the XRPL" Keller
 * Twitter/X: @daniel_wwf (https://x.com/daniel_wwf)
 * 
 * ATTRIBUTION REQUIRED: This attribution MUST NOT be removed or modified.
 * Free to use, modify, and distribute with attribution.
 * 
 * For the culture. For the degens. Against the spammers. 🫡
 */

(() => {
  // -------- storage keys & defaults --------
  const K_ENABLED = "pfam_enabled";
  const K_ACTION = "pfam_action";          // "highlight" | "delete_ui" | "ban_ui"
  const K_DELAY  = "pfam_delay_ms";        // number (ms)
  const K_REASON = "pfam_ban_reason";      // "Spam" | "Toxic"
  const K_CUSTOM_TRIGGERS = "pfam_custom_triggers"; // Custom trigger words

  const DEFAULTS = {
    [K_ENABLED]: true,
    [K_ACTION]: "viewer_mode",
    [K_DELAY]: 2000,
    [K_REASON]: "Spam"
  };

  let ENABLED  = DEFAULTS[K_ENABLED];
  let ACTION   = DEFAULTS[K_ACTION];
  let DELAY_MS = DEFAULTS[K_DELAY];
  let REASON   = DEFAULTS[K_REASON];
  let CUSTOM_TRIGGERS = []; // Array of custom trigger words

  // Global processing lock to prevent concurrent UI operations
  let isProcessing = false;
  let processingTimeout = null;
  
  // Batch processing to handle high volume spam
  let pendingMessages = new Set();
  let batchTimeout = null;
  const BATCH_DELAY = 1000; // Wait 1 second to collect messages before processing
  const MAX_BATCH_SIZE = 10; // Process max 10 messages at once
  
  // Periodic scanning to catch missed messages
  let periodicScanInterval = null;
  const PERIODIC_SCAN_DELAY = 5000; // Scan every 5 seconds for missed messages
  
  // Chat health monitoring
  let lastKnownMessage = null;
  let chatHealthInterval = null;
  const CHAT_HEALTH_CHECK_DELAY = 30000; // Check every 30 seconds if chat is alive
  
  // Tab registration system
  let tabId = 'tab_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  let isActiveTab = false;
  let tabHeartbeatInterval = null;
  const TAB_HEARTBEAT_DELAY = 10000; // Send heartbeat every 10 seconds
  const TAB_HEARTBEAT_TIMEOUT = 15000; // Consider tab dead after 15 seconds
  
  // Self-healing system for stuck messages
  let lastActivityTime = Date.now();
  let selfHealingInterval = null;
  const SELF_HEALING_CHECK_DELAY = 15000; // Check every 15 seconds for stuck messages
  const STUCK_MESSAGE_TIMEOUT = 60000; // Consider message stuck after 60 seconds
  const ACTIVITY_TIMEOUT = 30000; // No activity for 30 seconds = potential stuck state

  // -------- helpers --------
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function log(...args) {
    console.log("%cPF Auto-Mod", "color:#4af;font-weight:bold;", ...args);
  }

  // Batch processing functions
  function addToBatch(bubble) {
    if (!bubble || !ENABLED) return;
    
    // In viewer mode, process immediately without batching or timers
    if (ACTION === "viewer_mode") {
      if (isMatch(bubble.innerText || "")) {
        hideBubble(bubble);
      }
      return;
    }
    
    pendingMessages.add(bubble);
    log(`added to batch (${pendingMessages.size} pending)`);
    
    // Update activity time when we add messages (not in viewer mode)
    updateActivityTime();
    
    // If batch is full, process immediately
    if (pendingMessages.size >= MAX_BATCH_SIZE) {
      processBatch();
      return;
    }
    
    // Otherwise, wait for more messages
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
    
    log(`processing batch of ${messages.length} messages`);
    
    if (ACTION === "highlight") {
      // Highlight all at once (fast)
      messages.forEach(bubble => {
        if (isMatch(bubble.innerText || "")) {
          markHighlighted(bubble);
        }
      });
      log(`highlighted ${messages.length} messages`);
      return;
    }
    
    // Viewer mode should never reach here (processed immediately in addToBatch)
    
    // For delete/ban operations, process one by one with lock
    await processMessagesSequentially(messages);
  }

  async function processMessagesSequentially(messages) {
    for (const bubble of messages) {
      if (!ENABLED) break; // Stop if disabled mid-batch
      
      const tx = bubble.innerText || "";
      if (!isMatch(tx) || bubble.dataset.pfamProcessed) continue;
      
      // Set processing lock
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
          if (ok) updateActivityTime(); // Update activity on successful operation
        } else if (ACTION === "ban_ui") {
          const ok = await banViaUI(bubble);
          log(`ban operation ${ok ? 'succeeded' : 'failed'}`);
          if (ok) updateActivityTime(); // Update activity on successful operation
          
          // If ban fails, fallback to delete to at least remove the message
          if (!ok) {
            log("ban failed - attempting fallback delete");
            const deleteOk = await deleteViaUI(bubble);
            log(`fallback delete operation ${deleteOk ? 'succeeded' : 'failed'}`);
            if (deleteOk) updateActivityTime(); // Update activity on successful fallback
          }
        }
        
        // Small delay between operations
        await sleep(200);
        
      } catch (error) {
        log("batch operation error:", error);
      } finally {
        // Release lock
        if (processingTimeout) {
          clearTimeout(processingTimeout);
          processingTimeout = null;
        }
        isProcessing = false;
      }
    }
    
    log("batch processing completed - checking for remaining messages");
    
    // Update last known message after processing
    updateLastKnownMessage();
    
    // After processing batch, check if there are still unprocessed messages
    setTimeout(() => {
      if (!isProcessing && ENABLED) {
        // Get ALL message bubbles, not just unprocessed ones
        const allMessages = document.querySelectorAll('div[data-message-id]');
        const spamMessages = Array.from(allMessages).filter(bubble => {
          // Skip if already processed
          if (bubble.dataset.pfamProcessed) return false;
          
          const tx = bubble.innerText || "";
          const isSpam = isMatch(tx);
          
          if (isSpam) {
            log(`found unprocessed spam: "${tx.substring(0, 50)}..."`);
          }
          
          return isSpam;
        });
        
        if (spamMessages.length > 0) {
          log(`found ${spamMessages.length} remaining spam messages - adding to new batch`);
          spamMessages.forEach(bubble => addToBatch(bubble));
        } else {
          log("no remaining spam messages found - scanning complete");
          
          // Double check by logging what messages are visible
          const allVisibleMessages = Array.from(allMessages).map(bubble => {
            const tx = bubble.innerText || "";
            const processed = bubble.dataset.pfamProcessed ? "✓" : "✗";
            const spam = isMatch(tx) ? "SPAM" : "OK";
            return `${processed} ${spam}: "${tx.substring(0, 30)}..."`;
          });
          
          log(`visible messages summary (${allVisibleMessages.length} total):`);
          allVisibleMessages.slice(-5).forEach(msg => log(`  ${msg}`)); // Show last 5
        }
      }
    }, 1500); // Increased delay to let UI settle
  }

  function startPeriodicScanning() {
    if (periodicScanInterval) clearInterval(periodicScanInterval);
    
    periodicScanInterval = setInterval(() => {
      if (!ENABLED || isProcessing || pendingMessages.size > 0) return;
      
      // Scan for any unprocessed spam messages
      const allMessages = document.querySelectorAll('div[data-message-id]:not([data-pfam-processed])');
      const spamMessages = Array.from(allMessages).filter(bubble => {
        const tx = bubble.innerText || "";
        return isMatch(tx);
      });
      
      if (spamMessages.length > 0) {
        log(`periodic scan found ${spamMessages.length} missed spam messages`);
        spamMessages.forEach(bubble => addToBatch(bubble));
      }
    }, PERIODIC_SCAN_DELAY);
  }

  function stopPeriodicScanning() {
    if (periodicScanInterval) {
      clearInterval(periodicScanInterval);
      periodicScanInterval = null;
      log("periodic scanning stopped");
    }
  }

  function startChatHealthMonitoring() {
    if (chatHealthInterval) clearInterval(chatHealthInterval);
    
    // Update last known message immediately
    updateLastKnownMessage();
    
    chatHealthInterval = setInterval(() => {
      if (!ENABLED) return;
      
      checkChatHealth();
    }, CHAT_HEALTH_CHECK_DELAY);
    
    log("chat health monitoring started - checking every 30 seconds");
  }

  function stopChatHealthMonitoring() {
    if (chatHealthInterval) {
      clearInterval(chatHealthInterval);
      chatHealthInterval = null;
      lastKnownMessage = null;
      log("chat health monitoring stopped");
    }
  }

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
    // Don't start heartbeat in viewer mode - it's not needed and could cause rate limits
    if (ACTION === "viewer_mode") {
      log("viewer mode: skipping tab heartbeat (not needed)");
      return;
    }
    
    if (!chrome.storage?.local) return;
    if (tabHeartbeatInterval) clearInterval(tabHeartbeatInterval);
    
    tabHeartbeatInterval = setInterval(() => {
      if (isActiveTab && chrome.storage?.local) {
        try {
          chrome.storage.local.set({ lastHeartbeat: Date.now() });
        } catch (error) {
          // Silently handle storage errors
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

  // Self-healing system functions
  function startSelfHealing() {
    if (selfHealingInterval) clearInterval(selfHealingInterval);
    
    selfHealingInterval = setInterval(() => {
      if (!ENABLED || !isActiveTab) return;
      
      checkForStuckMessages();
    }, SELF_HEALING_CHECK_DELAY);
    
    log("self-healing system started - checking every 15 seconds for stuck messages");
  }

  function stopSelfHealing() {
    if (selfHealingInterval) {
      clearInterval(selfHealingInterval);
      selfHealingInterval = null;
      log("self-healing system stopped");
    }
  }

  function updateActivityTime() {
    lastActivityTime = Date.now();
  }

  function checkForStuckMessages() {
    const now = Date.now();
    const timeSinceActivity = now - lastActivityTime;
    
    // Find all highlighted messages (these should have been processed)
    const highlightedMessages = document.querySelectorAll('div[data-message-id][data-pfam-processed]');
    const stuckMessages = [];
    
    highlightedMessages.forEach(bubble => {
      const tx = bubble.innerText || "";
      
      // If it's still a spam message and still visible, it might be stuck
      if (isMatch(tx)) {
        stuckMessages.push({
          bubble: bubble,
          text: tx.substring(0, 30),
          id: bubble.getAttribute('data-message-id')
        });
      }
    });
    
    if (stuckMessages.length > 0) {
      log(`🔍 found ${stuckMessages.length} potentially stuck highlighted messages`);
      
      // If no activity for a while AND we have stuck messages, trigger recovery
      if (timeSinceActivity > ACTIVITY_TIMEOUT) {
        log(`🚨 STUCK STATE DETECTED! No activity for ${Math.round(timeSinceActivity/1000)}s with ${stuckMessages.length} stuck messages`);
        triggerSelfHealing(stuckMessages);
      } else {
        log(`stuck messages found but recent activity (${Math.round(timeSinceActivity/1000)}s ago) - waiting...`);
      }
    } else {
      log("✅ no stuck messages found - system healthy");
    }
  }

  function triggerSelfHealing(stuckMessages) {
    log(`🔄 SELF-HEALING: Recovering ${stuckMessages.length} stuck messages`);
    
    // Clear processed flags and highlights from stuck messages
    stuckMessages.forEach(({bubble, text, id}) => {
      log(`  recovering stuck message: "${text}..." (${id})`);
      
      // Clear processed flag so it can be re-processed
      delete bubble.dataset.pfamProcessed;
      
      // Clear highlight styling
      bubble.style.outline = "";
      bubble.style.outlineOffset = "";
      bubble.style.boxShadow = "";
    });
    
    // Reset activity time and trigger a new scan
    updateActivityTime();
    
    // Small delay then rescan for the recovered messages
    setTimeout(() => {
      if (ENABLED && isActiveTab) {
        log("🔄 rescanning after self-healing recovery");
        scanRoot(document);
      }
    }, 1000);
  }

  function forceRescanAllMessages() {
    log("🔄 FORCE RESCAN: Clearing all processed flags and rescanning everything");
    
    // Clear ALL processed flags and highlights
    const allProcessedMessages = document.querySelectorAll('div[data-message-id][data-pfam-processed]');
    allProcessedMessages.forEach(bubble => {
      delete bubble.dataset.pfamProcessed;
      // Clear highlight styling
      bubble.style.outline = "";
      bubble.style.outlineOffset = "";
      bubble.style.boxShadow = "";
    });
    
    log(`cleared ${allProcessedMessages.length} processed flags - rescanning all messages`);
    
    // Reset activity time and trigger full rescan
    updateActivityTime();
    
    setTimeout(() => {
      if (ENABLED && isActiveTab) {
        scanRoot(document);
      }
    }, 500);
  }

  function updateLastKnownMessage() {
    const allMessages = document.querySelectorAll('div[data-message-id]');
    if (allMessages.length > 0) {
      // Find the last (most recent) NON-SPAM message
      let lastNonSpamMessage = null;
      
      for (let i = allMessages.length - 1; i >= 0; i--) {
        const message = allMessages[i];
        const text = message.innerText || "";
        
        // Skip spam messages - don't use them as reference
        if (isMatch(text)) {
          log(`skipping spam message as reference: "${text.substring(0, 30)}..."`);
          continue;
        }
        
        // Found a non-spam message
        lastNonSpamMessage = message;
        break;
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
        
        if (ACTION !== "viewer_mode") {
          log(`checking exact match (letters only): "${exactPhrase}" → "${triggerLettersOnly}" vs message → "${messageLettersOnly}"`);
        }
        
        if (messageLettersOnly === triggerLettersOnly) {
          if (ACTION !== "viewer_mode") {
            log(`✅ exact phrase match (letters only): "${exactPhrase}"`);
          }
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
        
        if (ACTION !== "viewer_mode") {
          log(`checking wildcard pattern: "${trigger}" → regex: /${wildcardPattern}/`);
        }
        
        if (regex.test(t)) {
          if (ACTION !== "viewer_mode") {
            log(`✅ matched wildcard pattern: "${trigger}"`);
          }
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
      if (ACTION !== "viewer_mode") {
        log(`🔍 extracted message: "${messageText}" (from element)`);
      }
    } else {
      if (ACTION !== "viewer_mode") {
        log(`🔍 no message element found, using full text`);
      }
    }
    
    // Fallback to full text if we can't extract the message
    const textToCheck = messageText || fullText;
    
    if (!isMatch(textToCheck)) return;

    if (ACTION !== "viewer_mode") {
      log(`found matching message: "${textToCheck.substring(0, 50)}..." - action mode: ${ACTION}`);
    }

    // Add to batch instead of processing immediately
    addToBatch(bubble);
  }

  function scanRoot(root) {
    if (!root || !ENABLED) return;
    
    // In viewer mode, don't process existing messages - only new ones from mutation observer
    if (ACTION === "viewer_mode") {
      log("viewer mode: skipping existing messages, will only hide new incoming messages");
      return;
    }
    
    const all = root.querySelectorAll('div[data-message-id]');
    all.forEach(el => handleBubble(el));
  }

  function installObserver(root) {
    const mo = new MutationObserver(muts => {
      if (!ENABLED) return; // Don't process if extension is disabled
      
      for (const m of muts) {
        if (m.type === "childList") {
          m.addedNodes.forEach(n => {
            if (n.nodeType !== 1) return;
            const bubble = closestBubble(n);
            if (bubble) handleBubble(bubble);
            // Also scan inside this node for any existing bubbles
            n.querySelectorAll?.('div[data-message-id]').forEach(el => handleBubble(el));
          });
        } else if (m.type === "characterData") {
          const el = m.target && m.target.parentElement;
          const bubble = closestBubble(el);
          if (bubble) handleBubble(bubble);
        }
      }
    });
    mo.observe(root, { subtree: true, childList: true, characterData: true });
  }

  function loadFromStorage(cb) {
    const keysToLoad = {...DEFAULTS, [K_CUSTOM_TRIGGERS]: ""};
    
    chrome.storage?.sync.get(keysToLoad, (res) => {
      ENABLED  = !!res[K_ENABLED];
      ACTION   = res[K_ACTION] || DEFAULTS[K_ACTION];
      DELAY_MS = +res[K_DELAY] || DEFAULTS[K_DELAY];
      REASON   = res[K_REASON] || DEFAULTS[K_REASON];
      
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
        stopPeriodicScanning();
        stopChatHealthMonitoring();
        stopTabHeartbeat();
        stopSelfHealing();
        isActiveTab = false;
        log("extension disabled - stopping all operations and clearing batch");
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
    
    if (K_DELAY   in changes) DELAY_MS = +changes[K_DELAY].newValue || 2000;
    if (K_REASON  in changes) REASON = changes[K_REASON].newValue || "Spam";
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
    
    log(`settings updated: enabled=${ENABLED}, action=${ACTION}, delay=${DELAY_MS}, reason=${REASON}`);
    
    // re-scan immediately when toggled, enabled, or action changed
    if (ENABLED && (K_ENABLED in changes || actionChanged)) {
      scanRoot(document);
    }
  });

  function start() {
    if (!ENABLED) { 
      log("disabled (toggle in popup to enable)"); 
      stopPeriodicScanning();
      stopChatHealthMonitoring();
      stopTabHeartbeat();
      stopSelfHealing();
      isActiveTab = false;
      return; 
    }
    log(`active (action=${ACTION}, delay=${DELAY_MS}ms, reason=${REASON})`);
    
    // For viewer mode, only start minimal systems (no storage writes, no background tasks)
    if (ACTION === "viewer_mode") {
      log("🎮 VIEWER MODE: Starting minimal passive systems only");
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
    startPeriodicScanning();
    startChatHealthMonitoring();
    startSelfHealing();
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
