// Popup settings glue
const K_ENABLED = "pfam_enabled";
const K_ACTION  = "pfam_action";       // "highlight" | "delete_ui" | "ban_ui"

const defaults = {
  [K_ENABLED]: true,
  [K_ACTION]: "viewer_mode"
};

const $ = sel => document.querySelector(sel);

function load() {
  chrome.storage.sync.get(defaults, res => {
    $("#enabled").checked = !!res[K_ENABLED];
    $("#action").value    = res[K_ACTION];
    // Delay is now hardcoded to 200ms - no UI needed
    // Ban reason is now hardcoded to 'Spam' - no UI needed
  });
  
  // Load tab status with retry
  loadTabStatus();
  
  // Retry tab status after a short delay if needed
  setTimeout(() => {
    const tabText = $("#tab-text").textContent;
    if (tabText === "Extension loading..." || tabText === "Checking tab status...") {
      loadTabStatus();
    }
  }, 1000);
  
  // Show API stats if hybrid mode is selected (with small delay for content script)
  setTimeout(() => {
    updateAPIStatsVisibility();
  }, 500);
  
  // Delay is now hardcoded - no visibility management needed
}

function bind() {
  $("#enabled").addEventListener("change", e => {
    chrome.storage.sync.set({ [K_ENABLED]: e.target.checked });
  });
  $("#action").addEventListener("change", e => {
    chrome.storage.sync.set({ [K_ACTION]: e.target.value });
    
    // Show/hide API stats based on mode
    updateAPIStatsVisibility();
    
    // Delay is hardcoded - no visibility management needed
  });
  // Delay removed - always use 200ms (0.2s)
  // Ban reason removed - always use 'Spam'
  
  // Force activate button
  $("#force-activate").addEventListener("click", () => {
    chrome.tabs?.query({active: true, currentWindow: true}, (tabs) => {
      if (!tabs || !tabs[0]) return;
      
      chrome.tabs?.sendMessage(tabs[0].id, {action: "forceActivate"}, (response) => {
        // Clear any runtime errors
        if (chrome.runtime.lastError) {
          console.log('Force activate failed:', chrome.runtime.lastError.message);
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
    
    const tab = tabs[0];
    
    // Check if we're on pump.fun
    if (!tab.url || !tab.url.includes('pump.fun')) {
      $("#tab-text").textContent = "Not on pump.fun";
      $("#tab-indicator").textContent = "⚪";
      $("#force-activate").style.display = "none";
      return;
    }
    
    chrome.tabs?.sendMessage(tab.id, {action: "getTabStatus"}, (response) => {
      // Clear any runtime errors
      if (chrome.runtime.lastError) {
        console.log('Content script not ready:', chrome.runtime.lastError.message);
        $("#tab-text").textContent = "Extension loading...";
        $("#tab-indicator").textContent = "🔄";
        $("#force-activate").style.display = "none";
        return;
      }
      
      if (response) {
        updateTabStatusUI(response.isActive, response.tabId);
      } else {
        $("#tab-text").textContent = "Extension loading...";
        $("#tab-indicator").textContent = "🔄";
        $("#force-activate").style.display = "none";
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

// API stats management
function updateAPIStatsVisibility() {
  const actionValue = $("#action").value;
  const statsRow = $("#api-stats-row");
  
  if (actionValue === "ban_hybrid") {
    statsRow.style.display = "flex";
    updateAPIStats();
    // Refresh stats every 5 seconds when visible
    if (!window.apiStatsInterval) {
      window.apiStatsInterval = setInterval(updateAPIStats, 5000);
    }
  } else {
    statsRow.style.display = "none";
    if (window.apiStatsInterval) {
      clearInterval(window.apiStatsInterval);
      window.apiStatsInterval = null;
    }
  }
}

function updateAPIStats() {
  console.log("🔍 DEBUG_API_STATS: Starting updateAPIStats()");
  
  chrome.tabs?.query({active: true, currentWindow: true}, (tabs) => {
    console.log("🔍 DEBUG_API_STATS: Got tabs:", tabs?.length || 0);
    
    if (!tabs || !tabs[0] || !tabs[0].url || !tabs[0].url.includes('pump.fun')) {
      console.log("🔍 DEBUG_API_STATS: Not on pump.fun");
      $("#api-stats-text").textContent = "Not on pump.fun";
      return;
    }
    
    console.log("🔍 DEBUG_API_STATS: Sending getAPIStats message to tab:", tabs[0].id);
    
    chrome.tabs?.sendMessage(tabs[0].id, {action: "getAPIStats"}, (response) => {
      console.log("🔍 DEBUG_API_STATS: Got response:", response);
      console.log("🔍 DEBUG_API_STATS: Runtime error:", chrome.runtime.lastError?.message || "none");
      
      if (chrome.runtime.lastError) {
        console.log("🔍 DEBUG_API_STATS: Communication failed, retrying in 2s");
        $("#api-stats-text").textContent = "Extension loading...";
        // Retry after a delay
        setTimeout(updateAPIStats, 2000);
        return;
      }
      
      if (response && response.stats) {
        const stats = response.stats;
        const successRate = stats.attempts > 0 ? 
          Math.round((stats.successes / stats.attempts) * 100) : 0;
        
        let statusText = `${stats.successes}/${stats.attempts} (${successRate}%)`;
        
        if (stats.rateLimits > 0) {
          statusText += ` - ${stats.rateLimits} rate limits`;
        }
        
        if (stats.cloudflareDetected) {
          statusText += " - CF BLOCKED";
        } else if (!response.shouldUseAPI) {
          statusText += " - UI MODE";
        } else {
          statusText += " - API READY";
        }
        
        $("#api-stats-text").textContent = statusText;
      } else {
        $("#api-stats-text").textContent = "No data";
      }
    });
  });
}

// updateDelayVisibility function removed - delay is now hardcoded to 200ms

document.addEventListener("DOMContentLoaded", () => {
  load(); bind();
});
