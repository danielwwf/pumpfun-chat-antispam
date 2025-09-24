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
  
  // Delay is now hardcoded - no visibility management needed
}

function bind() {
  $("#enabled").addEventListener("change", e => {
    chrome.storage.sync.set({ [K_ENABLED]: e.target.checked });
  });
  $("#action").addEventListener("change", e => {
    chrome.storage.sync.set({ [K_ACTION]: e.target.value });
    
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

// updateDelayVisibility function removed - delay is now hardcoded to 200ms

document.addEventListener("DOMContentLoaded", () => {
  load(); bind();
});
