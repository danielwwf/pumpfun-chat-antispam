// lolnuked StreamGuard — content script (4 modes: highlight, viewer_mode, delete_ui, ban_ui)
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
  const K_ACTION = "pfam_action";          // "highlight" | "viewer_mode" | "delete_ui" | "ban_ui"
  const K_CUSTOM_TRIGGERS = "pfam_custom_triggers"; // Custom trigger words

  const DEFAULTS = {
    [K_ENABLED]: true,
    [K_ACTION]: "viewer_mode"
  };

  let ENABLED  = DEFAULTS[K_ENABLED];
  let ACTION   = DEFAULTS[K_ACTION];
  let CUSTOM_TRIGGERS = []; // Array of custom trigger words

  // Global processing lock to prevent concurrent UI operations
  let isProcessing = false;
  let processingTimeout = null;
  
  // Batch processing to handle high volume spam
  let pendingMessages = new Set();
  let batchTimeout = null;
  const BATCH_DELAY = 1000; // Wait 1 second to collect messages before processing
  const MAX_BATCH_SIZE = 50; // Increased based on bundle analysis - handle massive spam floods
  
  let blockedCount = 0;
  
  // Periodic scanning to catch missed messages
  let periodicScanInterval = null;
  const PERIODIC_SCAN_DELAY = 7000; // Scan every 7 seconds for missed messages
  
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
    
    // OPTIMIZED: Process in chunks for massive spam floods
    const allMessages = Array.from(pendingMessages);
    const chunkSize = MAX_BATCH_SIZE; // 50 messages per chunk
    
    // Take first chunk, leave rest for next batch
    const messages = allMessages.slice(0, chunkSize);
    pendingMessages = new Set(allMessages.slice(chunkSize));
    
    log(`⚡ processing ${messages.length} of ${allMessages.length} messages`);
    
    if (ACTION === "highlight") {
      // Highlight all at once (instant)
      messages.forEach(bubble => {
        if (isMatch(bubble.innerText || "")) {
          markHighlighted(bubble);
        }
      });
      return;
    }
    
    // Viewer mode should never reach here (processed immediately in addToBatch)
    
    // For delete/ban operations, process with optimized methods
    await processMessagesSequentially(messages);
    
    // If more messages pending, schedule next batch IMMEDIATELY
    if (pendingMessages.size > 0) {
      setTimeout(processBatch, 50); // Process next chunk FAST
    }
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
        // ONLY mark highlighted if we're in highlight mode!
        // For delete/ban, the API will remove the message from DOM
        if (ACTION === "highlight") {
          markHighlighted(bubble);
        }
        
        if (ACTION === "delete_ui") {
          // MOD MODE: DELETE VIA API ONLY - NO UI FALLBACK
          const success = await deleteViaAPI(bubble);
          if (success) {
            log(`✅ API DELETE SUCCESS - message removed from DOM`);
            updateActivityTime();
          } else {
            log(`⚠️ API delete failed - marking as processed to avoid retry`);
            bubble.dataset.pfamProcessed = "1";
          }
        } else if (ACTION === "ban_ui") {
          // CREATOR MODE: BAN VIA API ONLY
          const success = await banViaAPI(bubble);
          if (success) {
            log(`✅ API BAN SUCCESS - message removed from DOM`);
            updateActivityTime();
            blockedCount++;
            chrome.storage?.local?.set({ pfamBlockedCount: blockedCount });
          } else {
            // If ban fails, try delete API (creator might have mod permissions too)
            log("ban API failed - trying delete API");
            const deleteSuccess = await deleteViaAPI(bubble);
            if (deleteSuccess) {
              log(`✅ API DELETE SUCCESS (fallback) - message removed from DOM`);
              updateActivityTime();
            } else {
              log(`⚠️ Both APIs failed - marking as processed to avoid retry`);
              bubble.dataset.pfamProcessed = "1";
            }
          }
        }
        
        // Operations are fast enough without delay
        
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
    
    log("batch processing completed");
    
    // Update last known message after processing
    updateLastKnownMessage();
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
    // Skip self-healing entirely in viewer mode
    if (ACTION === "viewer_mode") {
      log("⏭️ Skipping self-healing in viewer mode");
      return;
    }
    
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
    // FIRST: Validate current reference is not spam
    if (lastKnownMessage && isMatch(lastKnownMessage.text)) {
      log(`🚨 CRITICAL: Current reference IS SPAM - FORCE INVALIDATING: "${lastKnownMessage.text}..."`);
      lastKnownMessage = null;
    }
    
    const allMessages = document.querySelectorAll('div[data-message-id]');
    if (allMessages.length > 0) {
      // Find the last (most recent) NON-SPAM message
      let lastNonSpamMessage = null;
      
      for (let i = allMessages.length - 1; i >= 0; i--) {
        const message = allMessages[i];
        const text = message.innerText || "";
        
        // ABSOLUTE RULE: TRIGGERS CAN NEVER BE REFERENCES
        if (isMatch(text)) {
          log(`⛔ REJECTING spam as reference: "${text.substring(0, 30)}..."`);
          continue;
        }
        
        // Found a non-spam message
        lastNonSpamMessage = message;
        break;
      }
      
      if (lastNonSpamMessage) {
        const text = lastNonSpamMessage.innerText || "";
        
        // DOUBLE CHECK: Even if we think it's clean, verify it's not spam
        if (isMatch(text)) {
          log(`⛔⛔ DOUBLE CHECK FAILED - message is spam after all: "${text.substring(0, 30)}..."`);
          return; // Don't update reference
        }
        
        lastKnownMessage = {
          id: lastNonSpamMessage.getAttribute('data-message-id'),
          text: text.substring(0, 50),
          timestamp: Date.now()
        };
        
        log(`✅ updated CLEAN reference: "${lastKnownMessage.text}..." (${lastKnownMessage.id})`);
      } else {
        log("⚠️ NO clean messages found - reference remains null");
      }
    }
  }

  function checkChatHealth() {
    // CRITICAL VALIDATION: Reference can NEVER be spam
    if (lastKnownMessage && isMatch(lastKnownMessage.text)) {
      log("🚨🚨 CRITICAL ERROR: Reference IS SPAM - FORCE CLEARING");
      lastKnownMessage = null;
    }
    
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

  // Matcher: checks custom triggers only
  function isMatch(text) {
    const t = normalizeKeepAt(text);
    if (!t) return false;
    
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
        
        if (messageLettersOnly === triggerLettersOnly) {
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
        
        if (regex.test(t)) {
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
  }

  // Use SAME API as ban - server determines action based on role!
  async function deleteViaAPI(bubble) {
    try {
      // Extract user address (same as ban API)
      const userLink = bubble.querySelector('a[href*="/profile/"]');
      if (!userLink) return false;
      
      const userAddress = userLink.href.split("/profile/")[1];
      if (!userAddress) return false;

      // Extract room ID from URL
      const roomId = window.location.pathname.split('/').pop();
      if (!roomId) return false;

      // Use SAME endpoint as ban - server will delete for mods, ban for creators!
      const MODERATION_ENDPOINT = `https://livechat.pump.fun/chat/moderation/rooms/${roomId}/bans`;
      
      const response = await fetch(MODERATION_ENDPOINT, {
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

      if (response.status === 204 || response.ok) {
        log(`⚡ INSTANT DELETE via API (same endpoint as ban!): ${userAddress}`);
        // DO NOT REMOVE FROM DOM - Let server update handle it
        // Mark as processed to avoid re-processing
        bubble.dataset.pfamProcessed = "1";
        return true;
      } else {
        log(`❌ DELETE API FAILED - Status: ${response.status}`);
      }

      return false;
    } catch (error) {
      log(`❌ DELETE API ERROR:`, error);
      return false;
    }
  }




  // GENIUS API from free version - INSTANT BANS!
  async function banViaAPI(bubble) {
    try {
      // Extract user address THEIR WAY (simple & fast!)
      const userLink = bubble.querySelector('a[href*="/profile/"]');
      if (!userLink) return false;
      
      const userAddress = userLink.href.split("/profile/")[1];
      if (!userAddress) return false;

      // Extract room ID from URL
      const roomId = window.location.pathname.split('/').pop();
      if (!roomId) return false;

      // Use THEIR endpoint discovery - livechat.pump.fun!
      const BAN_ENDPOINT = `https://livechat.pump.fun/chat/moderation/rooms/${roomId}/bans`;
      
      // THEIR GENIUS: Use credentials:include for automatic auth!
      const response = await fetch(BAN_ENDPOINT, {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          userAddress: userAddress,
          reason: "SPAM" // Always SPAM - no need to search!
        }),
        credentials: "include" // GENIUS - uses cookies automatically!
      });

      if (response.status === 204 || response.ok) {
        log(`⚡ INSTANT BAN via API: ${userAddress}`);
        blockedCount++;
        // DO NOT REMOVE FROM DOM - Let server update handle it
        // Mark as processed to avoid re-processing
        bubble.dataset.pfamProcessed = "1";
        return true;
      } else {
        log(`❌ BAN API FAILED - Status: ${response.status}`);
      }
      
      return false;
    } catch (error) {
      log(`❌ BAN API ERROR:`, error);
      return false;
    }
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
    
    log(`settings updated: enabled=${ENABLED}, action=${ACTION}`);
    
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
    log(`active (action=${ACTION})`);
    
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
