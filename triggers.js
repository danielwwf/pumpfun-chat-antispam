// Triggers management page
const K_CUSTOM_TRIGGERS = "pfam_custom_triggers";

const $ = sel => document.querySelector(sel);

// Default triggers (same as hardcoded in content.js)
const DEFAULT_TRIGGERS = [
  "stoprugs",
  "solspoint", 
  "@*rug*", // This represents the regex pattern
  "full*bundled*dont*buy" // Wildcard pattern for common spam
].join('\n');

function showStatus(message, isError = false) {
  const statusEl = $("#status-msg");
  statusEl.textContent = message;
  statusEl.className = `status-msg ${isError ? 'status-error' : 'status-success'}`;
  statusEl.style.display = 'block';
  
  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3000);
}

function loadTriggers() {
  chrome.storage?.sync?.get([K_CUSTOM_TRIGGERS], (result) => {
    const triggers = result[K_CUSTOM_TRIGGERS] || DEFAULT_TRIGGERS;
    $("#triggers-textarea").value = triggers;
  });
}

function saveTriggers() {
  const triggers = $("#triggers-textarea").value.trim();
  
  if (!triggers) {
    showStatus("Please add at least one trigger word", true);
    return;
  }
  
  // Basic validation
  const lines = triggers.split('\n').filter(line => line.trim());
  if (lines.length === 0) {
    showStatus("Please add at least one trigger word", true);
    return;
  }
  
  chrome.storage?.sync?.set({ [K_CUSTOM_TRIGGERS]: triggers }, () => {
    if (chrome.runtime?.lastError) {
      showStatus("Error saving triggers: " + chrome.runtime.lastError.message, true);
    } else {
      showStatus(`Saved ${lines.length} trigger words successfully!`);
      
      // Notify content script that triggers changed
      chrome.tabs?.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs && tabs[0] && tabs[0].url && tabs[0].url.includes('pump.fun')) {
          chrome.tabs?.sendMessage(tabs[0].id, {action: "triggersUpdated"}, (response) => {
            // Clear any runtime errors silently
            if (chrome.runtime.lastError) {
              console.log('Triggers update notification failed:', chrome.runtime.lastError.message);
            }
          });
        }
      });
    }
  });
}

function resetToDefaults() {
  if (confirm("Reset to default trigger words? This will remove all your custom triggers.")) {
    $("#triggers-textarea").value = DEFAULT_TRIGGERS;
    showStatus("Reset to defaults - don't forget to save!");
  }
}

function goBack() {
  window.close();
}

// Event listeners
document.addEventListener("DOMContentLoaded", () => {
  loadTriggers();
  
  $("#save-btn").addEventListener("click", saveTriggers);
  $("#reset-btn").addEventListener("click", resetToDefaults);
  $("#back-btn").addEventListener("click", goBack);
  
  // Save on Ctrl+S
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveTriggers();
    }
  });
  
  // Auto-resize textarea
  const textarea = $("#triggers-textarea");
  textarea.addEventListener("input", () => {
    const lines = textarea.value.split('\n').length;
    const minHeight = Math.max(200, lines * 20);
    textarea.style.height = minHeight + 'px';
  });
});
