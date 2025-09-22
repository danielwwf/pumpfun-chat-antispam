/**
 * lolnuked StreamGuard - Popup Interface
 * 
 * Created by: Daniel "CEO of the XRPL" Keller
 * Twitter/X: @daniel_wwf (https://x.com/daniel_wwf)
 * 
 * ATTRIBUTION REQUIRED: This attribution MUST NOT be removed.
 */

// Popup settings glue
const K_ENABLED = "pfam_enabled";
const K_ACTION  = "pfam_action";       // "highlight" | "delete_ui" | "ban_ui"
const K_DELAY   = "pfam_delay_ms";
const K_REASON  = "pfam_ban_reason";

const defaults = {
  [K_ENABLED]: true,
  [K_ACTION]: "viewer_mode",
  [K_DELAY]: 200,  // 0.2 seconds default for ban/delete modes
  [K_REASON]: "Spam"
};

const $ = sel => document.querySelector(sel);

function load() {
  chrome.storage.sync.get(defaults, res => {
    $("#enabled").checked = !!res[K_ENABLED];
    $("#action").value    = res[K_ACTION];
    $("#delay").value     = String(res[K_DELAY]);
    $("#reason").value    = res[K_REASON];
    
    // Set delay visibility based on the LOADED action value (not HTML default)
    updateDelayVisibility(res[K_ACTION]);
  });
  
  // Load tab status
  loadTabStatus();
}

function bind() {
  $("#enabled").addEventListener("change", e => {
    chrome.storage.sync.set({ [K_ENABLED]: e.target.checked });
  });
  $("#action").addEventListener("change", e => {
    chrome.storage.sync.set({ [K_ACTION]: e.target.value });
    
    // Hide delay setting for viewer mode (it's instant)
    updateDelayVisibility(e.target.value);
  });
  $("#delay").addEventListener("change", e => {
    chrome.storage.sync.set({ [K_DELAY]: Number(e.target.value) });
  });
  $("#reason").addEventListener("change", e => {
    chrome.storage.sync.set({ [K_REASON]: e.target.value });
  });
  
  // Force activate button
  $("#force-activate").addEventListener("click", () => {
    chrome.tabs?.query({active: true, currentWindow: true}, (tabs) => {
      if (!tabs || !tabs[0]) return;
      
      chrome.tabs?.sendMessage(tabs[0].id, {action: "forceActivate"}, () => {
        // Clear any Chrome runtime errors
        if (chrome.runtime.lastError) {
          console.log("Could not send forceActivate message:", chrome.runtime.lastError.message);
          return;
        }
        
        // Reload status after activation
        setTimeout(loadTabStatus, 500);
      });
    });
  });
  
  // Manage triggers button
  $("#manage-triggers").addEventListener("click", () => {
    chrome.windows?.create({
      url: "triggers.html",
      type: "popup",
      width: 450,
      height: 500
    });
  });
}

function loadTabStatus() {
  chrome.tabs?.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs || !tabs[0]) {
      $("#tab-text").textContent = "No active tab";
      return;
    }
    
    chrome.tabs?.sendMessage(tabs[0].id, {action: "getTabStatus"}, (response) => {
      // Clear any Chrome runtime errors
      if (chrome.runtime.lastError) {
        // Content script not loaded or not on pump.fun
        $("#tab-text").textContent = "Not on pump.fun or extension not loaded";
        return;
      }
      
      if (response) {
        updateTabStatusUI(response.isActive, response.tabId);
      } else {
        // Fallback if content script not ready
        $("#tab-text").textContent = "Extension loading...";
      }
    });
  });
}

function updateTabStatusUI(isActive, tabId) {
  const indicator = $("#tab-indicator");
  const text = $("#tab-text");
  const button = $("#force-activate");
  
  if (isActive) {
    indicator.textContent = "🟢";
    text.textContent = "Active on this tab";
    button.style.display = "none";
  } else {
    indicator.textContent = "⚪";
    text.textContent = "Inactive (dormant)";
    button.style.display = "block";
  }
}

function updateDelayVisibility(actionMode) {
  const delayRow = $("#delay-row");
  const delayMessage = $("#delay-message");
  
  if (actionMode === "viewer_mode") {
    // Show message for viewer mode (no delay options)
    delayRow.style.display = "none";
    delayMessage.style.display = "flex";
  } else {
    // Show delay selector for other modes
    delayRow.style.display = "flex";
    delayMessage.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  load(); bind();
});
