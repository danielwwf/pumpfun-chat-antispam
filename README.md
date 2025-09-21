# 🛡️ lolnuked StreamGuard - Ultimate Pump.fun Spam Protection

**For streamers, traders, and degens. Keep your chat clean while you focus on the charts! 🚀**

> **🔒 SECURITY:** Not a wallet drainer! No data theft! 100% safe! Don't trust us? Drop the code in ChatGPT/Claude/Grok and ask them! It's open source - verify it yourself!

## What This Bad Boy Does 💪

This Chrome extension is your personal bouncer for PumpFun chat. It automatically detects and nukes those annoying `@fightrugs`, `@stoprugs`, and other rug-related spam messages that flood the chat when you're trying to ape into the next 100x.

**TL;DR:** It finds spam → highlights it → deletes it → bans the spammers. All automatically. You focus on the charts, we handle the spam.

## Features That'll Make You Cum 🍆

- **🎯 Smart Detection**: Catches `@*rug*` mentions (like `@fightrugs`, `@stoprugs`) plus legacy "stoprugs" spam
- **⚡ Four Action Modes**:
  - **Highlight Only** (safe mode - just shows what would be caught)
  - **Viewer Mode** (hide spam from YOUR view only - 100% safe, no rate limiting risk!)
  - **Delete via UI** (moderator mode - removes spam for everyone)
  - **Ban via UI** (nuclear mode - bans spammers with reason selection)
- **🔧 Customizable Delays**: 0.2s to 2s between actions (0.2s for lightning fast cleaning!)
- **🛡️ Race Condition Protection**: Processes one message at a time (no more broken UI)
- **🌊 Real-time Processing**: Catches spam as it arrives
- **🎛️ Easy Toggle**: Enable/disable without refreshing
- **🚨 Chat Health Monitoring**: Auto-refreshes page if chat dies (perfect for 24/7 operation)
- **🎯 Single-Tab Operation**: Only one tab processes spam (others stay dormant)
- **📝 Custom Trigger Words**: Add your own spam triggers via built-in UI (no code editing!)

## Installation (EZ Mode) 📦

1. **Download the extension files** (you're probably already here if you're reading this)
2. **Open Chrome** → Go to `chrome://extensions/`
3. **Enable Developer Mode** (toggle in top right)
4. **Click "Load unpacked"** → Select the folder with these files
5. **Pin the extension** to your toolbar for easy access
6. **Refresh PumpFun** (important for first use!)

## 🔒 **Is This Safe? (YES! Here's Why)** 🔒

### **"Is this a wallet drainer?"** NO! 
### **"Does it steal passwords?"** NO!
### **"Is it malicious?"** NO!

**Don't trust us? GOOD! You shouldn't trust random extensions!** 

### **🔍 How to Verify It's Safe:**

1. **Ask AI to Review It:**
   - Download the code
   - Drop it into ChatGPT, Claude, or Grok
   - Ask: "Does this extension do anything malicious?"
   - They'll tell you: **IT'S SAFE!**

2. **Ask Your Dev Friend:**
   - Send them the code (it's only ~1000 lines)
   - They'll confirm: **No wallet access, no data theft, no BS**

3. **Review It Yourself:**
   - Open `manifest.json` - See what permissions we request
   - Open `content.js` - See exactly what it does
   - **ZERO external connections** (no data leaves your browser)
   - **ZERO wallet interactions** (doesn't even know you have one)

### **🛡️ What This Extension CAN Access:**
- ✅ **pump.fun website only** (see manifest.json - host_permissions)
- ✅ **Your trigger word settings** (stored locally in Chrome)
- ✅ **Chat messages on pump.fun** (to detect spam)

### **❌ What This Extension CANNOT Access:**
- ❌ **Your wallet** (no wallet permissions)
- ❌ **Your passwords** (no form access)
- ❌ **Other websites** (only works on pump.fun)
- ❌ **Your browsing history** (no history permissions)
- ❌ **Your personal data** (no data collection)

### **📝 The Code is Simple:**
```javascript
// Literally all it does:
if (message contains spam) {
  if (viewer_mode) {
    hide_message();  // Just CSS: display = "none"
  } else if (delete_mode) {
    click_delete_button();  // Click the existing delete button
  }
}
```

### **🎯 Our Promise:**
- **100% Open Source** - Every line of code is visible
- **No external servers** - Everything runs locally
- **No data collection** - We don't even have a server
- **No hidden code** - What you see is what you get
- **No monetization** - No ads, no tracking, no BS

### **💡 Pro Tip:**
If you're paranoid (and you should be in crypto):
1. **Review the code first**
2. **Run it in a separate browser profile**
3. **Use it without your wallet connected**
4. **Watch the network tab** - You'll see ZERO external requests

**TL;DR: We just put the fun back in pump.fun by hiding spam. That's it. That's the extension.** 🎉

## 🚨 **IMPORTANT: Setup for Streamers/Moderators Only!** 🚨

**If you're using Delete/Ban modes (moderators), you need to be strategic:**

### **🎯 Recommended Setup for Streamers/Moderators:**
- **Open TWO pump.fun tabs:**
  - **Tab 1**: For normal chatting, streaming, interacting (keep extension DORMANT here)
  - **Tab 2**: Dedicated for spam cleaning (let extension be ACTIVE here)
- **Why?** When the extension is actively deleting/banning, the UI gets busy and chatting becomes difficult

### **🎮 For Regular Users (Viewer Mode):**
- **Just use ONE tab** - Viewer Mode doesn't interfere with chatting!
- **No setup needed** - Enable Viewer Mode and chat normally
- **Clean experience** - Spam gets hidden from your view without UI interference

### **🟢 How to Set This Up (Moderators Only):**
1. **Open pump.fun** in your main tab (for chatting/streaming)
2. **Open SECOND pump.fun tab** (for spam cleaning)
3. **In the second tab**: Click extension icon → Should show "🟢 Active on this tab"
4. **In the first tab**: Click extension icon → Should show "⚪ Inactive (dormant)"
5. **Chat normally in first tab** while extension cleans spam in second tab

### **🚨 Alternative: Separate Browser/Profile**
**For complete isolation:**
- Use a dedicated Chrome profile or different browser (Firefox, Edge, etc.) just for the extension
- Install extension only in the spam-cleaning browser
- Keep your main browser clean for normal usage

**How to create a separate Chrome profile:**
1. Click your profile icon in Chrome → "Add Profile"
2. Set up a new profile just for spam cleaning
3. Install the extension only in that profile
4. Keep your main profile clean for normal usage

## How to Use (Ape Mode Activated) 🦍

### First Time Setup
1. **Install the extension** (see above)
2. **Go to pump.fun** 
3. **Refresh the page** (this is important after install!)
4. **Click the extension icon** in your toolbar
5. **Enable it** with the toggle switch
6. **Choose your action mode** (defaults to "Viewer Mode" - perfect for most users!)

### Settings Explained

**🎯 Action Modes:**
- **Highlight Only**: Just highlights spam messages (safe testing mode)
- **Viewer Mode**: Hides spam from YOUR view only (perfect for regular users!)
- **Delete via UI**: Automatically deletes spam messages (for moderators)
- **Ban via UI**: Deletes AND bans the spammer (nuclear option for mods)

**⏱️ Step Delay:**
- How long to wait between UI actions (0.2s - 2s)
- **Not used in Viewer Mode** (hiding is instant)
- **0.2s (fast)** = Lightning speed for mass spam cleaning
- **0.5s-1s** = Balanced speed and reliability
- **1.5s-2s** = Conservative, very safe

**🔨 Ban Reason:**
- **Spam**: For the obvious spam (most common)
- **Toxic**: For the really annoying ones

### Usage Tips for Maximum Effectiveness 🔥

1. **Viewer Mode is default** - perfect for most users (hides spam from your view)
2. **Test with "Highlight"** first if you want to see what gets caught
3. **Switch to "Delete"** if you're a moderator (removes spam for everyone)
4. **Use "Ban"** for persistent spammers (nuclear option for mods)
5. **Lower delays** for faster mod actions (but watch for rate limits)
6. **Disable temporarily** if you need to moderate manually

### 🎯 **Viewer Mode - Perfect for Regular Users!**

**Don't have mod permissions? No problem!** Viewer Mode is designed for regular users who just want a clean chat experience:

**🔒 100% SAFE FROM RATE LIMITING:**
- **ZERO network activity** - Makes no requests to pump.fun servers
- **Pure CSS hiding** - Only sets `display: none` on spam messages
- **No background tasks** - No timers, intervals, or storage operations
- **Completely passive** - Can't trigger Cloudflare blocks
- **Use 24/7 safely** - Impossible to get rate limited!

**🔍 How Viewer Mode Works:**
- **Skips existing messages** - doesn't touch chat history when you join
- **Only hides NEW spam** - incoming messages that match your triggers
- **Your view only** - other users still see the spam (you don't)
- **No permissions needed** - just CSS hiding, no UI interactions
- **Instant hiding** - processes immediately without delays or batching

**👥 Perfect For:**
- **Regular chat participants** without mod permissions
- **Viewers** who want clean chat during streams
- **Traders** who want to focus on legitimate discussion
- **Anyone** who's tired of spam but can't delete it

**🚀 Usage:**
1. **Join any pump.fun chat**
2. **Set action to "Viewer Mode"**
3. **Existing chat stays visible** (you see the conversation context)
4. **New spam gets hidden** automatically as it arrives
5. **Enjoy clean chat** without affecting others!

### Managing Custom Trigger Words 📝

**No more code editing!** Add your own trigger words through the built-in UI:

### **🎮 How to Add Custom Triggers:**
1. **Click extension icon** → Main popup opens
2. **Click "Manage Trigger Words"** → New window opens  
3. **Add triggers** (one per line):
   ```
   stoprugs
   solspoint
   scam alert
   rugpull
   @fudders
   @*rug*
   ```
4. **Click "Save Triggers"** → Success message appears
5. **Changes apply immediately** - no page refresh needed!

### **🎯 Trigger Types:**
- **Simple words**: `scam`, `rugpull`, `fud`
- **Phrases**: `scam alert`, `obvious rug`
- **Username patterns**: `@fudders`, `@scammers`
- **Wildcard patterns**: `full*bundled*dont*buy` (catches any spacing/chars between words)
- **Exact phrases**: `exact:full bundled dont buy` (matches only exact phrase)
- **Regex patterns**: `@*rug*` (catches @fightrugs, @stoprugs, etc.)

### **💡 Pro Tips:**
- **Use lowercase** for better matching
- **Test with "Highlight" mode** first to see what gets caught
- **Start with defaults** then add your own
- **One trigger per line** in the text area
- **Changes are instant** - no refresh needed!

## Troubleshooting (When Shit Breaks) 🔧

### Extension Not Working?
1. **Refresh the page** (fixes 90% of issues)
2. **Check if it's enabled** (click the icon)
3. **Try a different action mode**
4. **Check browser console** for errors (F12 → Console)

### Messages Not Getting Deleted?
1. **Make sure you have mod permissions** on the chat
2. **Try increasing the step delay** (might be getting rate limited)
3. **Switch from "Ban" to "Delete"** (ban requires more permissions)
4. **Refresh the page** and try again

### Extension Seems Stuck?
1. **Disable and re-enable** it via the popup
2. **Refresh the page**
3. **Check console logs** for error messages

### After Changing Settings?
- **Sometimes you need to refresh** the page after changing action modes
- The extension tries to handle this automatically, but if it acts weird, just refresh

## Technical Shit (For the Nerds) 🤓

- **Built for Manifest V3** (future-proof)
- **Uses MutationObserver** for real-time detection
- **Homoglyph normalization** (catches sneaky Unicode tricks)
- **Global processing lock** (prevents race conditions)
- **Automatic retry logic** (handles UI timing issues)
- **Zero external dependencies** (pure vanilla JS)

## Console Logs (Debug Mode) 🐛

Open browser console (F12) to see what's happening:
```
PF Auto-Mod found matching message: "least obvious rug lol..."
PF Auto-Mod starting delete_ui operation with 2000ms delay
PF Auto-Mod delete operation succeeded
PF Auto-Mod processing lock released
```

## Known Issues (Shit We're Working On) ⚠️

- **First install requires page refresh** (Chrome extension limitation)
- **Sometimes need refresh after changing modes** (working on it)
- **Ban mode needs proper mod permissions** (can't fix stupid)

## Support the Degen Dev 💰

If this extension saved your sanity and helped you avoid rug spam while you're trying to make it big, consider supporting:

**Buy some $NUKED:**
```
CA: CVS4NMq2AVSJEzi9ui8TCm3QrCTfDtRmKZh6cSdnpump
```

**Or send SOL directly:**
```
HUNAHhNnDviL4bwFHryzgXvspH5NVRGYrnqLHjbgwWnu
```

## Contributing (For the Real Ones) 🤝

Found a bug? Got an idea? Want to make it even more based?

1. Fork this repo
2. Make your changes
3. Test it on pump.fun
4. Submit a PR
5. Profit??? 📈

## Legal Shit (CYA) ⚖️

This extension automates UI interactions on pump.fun. Use at your own risk. Not responsible if you get banned, lose money, or miss the next 1000x because you were too busy configuring the extension.

**This is not financial advice. DYOR. WAGMI. 🚀**

---

*Made with rage and caffeine by [@daniel_wwf](https://x.com/daniel_wwf)*

*For the culture. For the degens. Against the spammers. 🫡*
