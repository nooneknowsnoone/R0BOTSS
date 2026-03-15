const fs = require('fs');
const path = require('path');

// ===== FIXED: Proper biar-fca loading with fallbacks =====
let login;
try {
  // Try different import methods for biar-fca
  const biarFca = require('./biar-fca');
  
  if (typeof biarFca === 'function') {
    login = biarFca;
    console.log('✅ biar-fca loaded as direct function');
  } else if (biarFca.default && typeof biarFca.default === 'function') {
    login = biarFca.default;
    console.log('✅ biar-fca loaded as default export');
  } else if (biarFca.login && typeof biarFca.login === 'function') {
    login = biarFca.login;
    console.log('✅ biar-fca loaded as login property');
  } else {
    // Last resort: try to find any function in the exports
    const functionKeys = Object.keys(biarFca).find(key => typeof biarFca[key] === 'function');
    if (functionKeys) {
      login = biarFca[functionKeys];
      console.log(`✅ biar-fca loaded using method: ${functionKeys}`);
    } else {
      throw new Error('No function found in biar-fca exports');
    }
  }
} catch (error) {
  console.error('❌ Failed to load biar-fca:', error.message);
  console.log('📝 Make sure biar-fca folder exists and npm install was run inside it');
  process.exit(1);
}

const express = require('express');
const app = express();
const chalk = require('chalk');
const bodyParser = require('body-parser');
const script = path.join(__dirname, 'script');
const cron = require('node-cron');
const config = fs.existsSync('./data') && fs.existsSync('./data/config.json') ? JSON.parse(fs.readFileSync('./data/config.json', 'utf8')) : createConfig();
const Utils = new Object({
  commands: new Map(),
  handleEvent: new Map(),
  account: new Map(),
  cooldowns: new Map(),
});

// Load commands from script folder
console.log(chalk.cyan('📂 Loading commands from script folder...'));

// Create script folder if it doesn't exist
if (!fs.existsSync(script)) {
  fs.mkdirSync(script, { recursive: true });
  console.log(chalk.yellow('📁 Created script folder'));
}

// Read and load commands
fs.readdirSync(script).forEach((file) => {
  if (!file.endsWith('.js')) return;
  
  const scripts = path.join(script, file);
  const stats = fs.statSync(scripts);
  
  if (stats.isDirectory()) {
    fs.readdirSync(scripts).forEach((subFile) => {
      if (!subFile.endsWith('.js')) return;
      
      try {
        const commandModule = require(path.join(scripts, subFile));
        const { config: cmdConfig, run, handleEvent } = commandModule;
        
        if (cmdConfig) {
          const {
            name = [], role = '0', version = '1.0.0', hasPrefix = true, aliases = [], 
            description = '', usage = '', credits = '', cooldown = '5'
          } = Object.fromEntries(Object.entries(cmdConfig).map(([key, value]) => [key.toLowerCase(), value]));
          
          aliases.push(name);
          
          if (run) {
            Utils.commands.set(aliases, {
              name,
              role,
              run,
              aliases,
              description,
              usage,
              version,
              hasPrefix: cmdConfig.hasPrefix,
              credits,
              cooldown
            });
            console.log(chalk.green(`✅ Loaded command: ${name} from ${file}/${subFile}`));
          }
          
          if (handleEvent) {
            Utils.handleEvent.set(aliases, {
              name,
              handleEvent,
              role,
              description,
              usage,
              version,
              hasPrefix: cmdConfig.hasPrefix,
              credits,
              cooldown
            });
          }
        }
      } catch (error) {
        console.error(chalk.red(`Error installing command from ${file}/${subFile}: ${error.message}`));
      }
    });
  } else {
    try {
      const commandModule = require(scripts);
      const { config: cmdConfig, run, handleEvent } = commandModule;
      
      if (cmdConfig) {
        const {
          name = [], role = '0', version = '1.0.0', hasPrefix = true, aliases = [], 
          description = '', usage = '', credits = '', cooldown = '5'
        } = Object.fromEntries(Object.entries(cmdConfig).map(([key, value]) => [key.toLowerCase(), value]));
        
        aliases.push(name);
        
        if (run) {
          Utils.commands.set(aliases, {
            name,
            role,
            run,
            aliases,
            description,
            usage,
            version,
            hasPrefix: cmdConfig.hasPrefix,
            credits,
            cooldown
          });
          console.log(chalk.green(`✅ Loaded command: ${name} from ${file}`));
        }
        
        if (handleEvent) {
          Utils.handleEvent.set(aliases, {
            name,
            handleEvent,
            role,
            description,
            usage,
            version,
            hasPrefix: cmdConfig.hasPrefix,
            credits,
            cooldown
          });
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error installing command from file ${file}: ${error.message}`));
    }
  }
});

console.log(chalk.green(`✅ Loaded ${Utils.commands.size} commands total`));

// Express setup
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(express.json());

// Create public folder and HTML files if they don't exist
if (!fs.existsSync('./public')) {
  fs.mkdirSync('./public', { recursive: true });
}

const htmlFiles = {
  'index.html': '<!DOCTYPE html><html><head><title>Bot Dashboard</title></head><body><h1>Bot is Running!</h1><p>Connected via biar-fca</p></body></html>',
  'guide.html': '<h1>Guide</h1><p>Bot Guide</p>',
  'online.html': '<h1>Online Users</h1><p>Online users will appear here</p>',
  'autobot.html': '<h1>Auto Bot</h1><p>Auto bot settings</p>',
  'autoshare.html': '<h1>Auto Share</h1><p>Auto share settings</p>'
};

Object.entries(htmlFiles).forEach(([file, content]) => {
  const filePath = path.join(__dirname, 'public', file);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
    console.log(chalk.green(`✅ Created ${file}`));
  }
});

const routes = [{
  path: '/',
  file: 'index.html'
}, {
  path: '/step_by_step_guide',
  file: 'guide.html'
}, {
  path: '/online_user',
  file: 'online.html'
}, {
  path: '/site',
  file: 'autobot.html'
}, {
  path: '/autoshare',
  file: 'autoshare.html'
}];

routes.forEach(route => {
  app.get(route.path, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', route.file));
  });
});

// API endpoints
app.get('/info', (req, res) => {
  const data = Array.from(Utils.account.values()).map(account => ({
    name: account.name,
    profileUrl: account.profileUrl,
    thumbSrc: account.thumbSrc,
    time: account.time
  }));
  res.json(data);
});

app.get('/commands', (req, res) => {
  const commandSet = new Set();
  const commands = [...Utils.commands.values()].map(({ name }) => {
    commandSet.add(name);
    return name;
  });
  
  const handleEvent = [...Utils.handleEvent.values()]
    .map(({ name }) => commandSet.has(name) ? null : name)
    .filter(Boolean);
  
  res.json({
    commands,
    handleEvent,
    total: Utils.commands.size
  });
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { state, commands, prefix, admin } = req.body;
  
  try {
    if (!state) {
      return res.status(400).json({ error: true, message: 'Missing app state data' });
    }
    
    const cUser = state.find(item => item.key === 'c_user');
    if (!cUser) {
      return res.status(400).json({ error: true, message: "Invalid appstate data" });
    }
    
    const existingUser = Utils.account.get(cUser.value);
    if (existingUser) {
      console.log(`User ${cUser.value} is already logged in`);
      return res.status(400).json({
        error: false,
        message: "Already logged in",
        user: existingUser
      });
    }
    
    try {
      await accountLogin(state, commands || [[], []], prefix || '!', [admin]);
      res.status(200).json({
        success: true,
        message: 'Login successful'
      });
    } catch (error) {
      console.error(error);
      res.status(400).json({ error: true, message: error.message });
    }
  } catch (error) {
    res.status(400).json({ error: true, message: "Invalid appstate data" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(chalk.green(`✅ Server running at http://localhost:${PORT}`));
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// Main account login function using biar-fca
async function accountLogin(state, enableCommands = [[], []], prefix = '!', admin = []) {
  return new Promise((resolve, reject) => {
    // Verify login is a function before using it
    if (typeof login !== 'function') {
      reject(new Error('login is not a function - biar-fca not properly loaded'));
      return;
    }
    
    console.log(chalk.cyan('📱 Attempting Facebook login via biar-fca...'));
    
    login({ appState: state }, async (error, api) => {
      if (error) {
        console.error(chalk.red('❌ Login failed:'), error);
        reject(error);
        return;
      }

      console.log(chalk.green('✅ Facebook login successful via biar-fca!'));
      
      try {
        const userid = await api.getCurrentUserID();
        console.log(chalk.cyan(`👤 Logged in as user ID: ${userid}`));
        
        // Create data folders if they don't exist
        if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
        if (!fs.existsSync('./data/session')) fs.mkdirSync('./data/session', { recursive: true });
        
        await addThisUser(userid, enableCommands, state, prefix, admin);
        
        const userInfo = await api.getUserInfo(userid);
        if (!userInfo || !userInfo[userid]?.name) {
          throw new Error('Unable to get user info');
        }
        
        const { name, profileUrl, thumbSrc } = userInfo[userid];
        
        let time = 0;
        try {
          if (fs.existsSync('./data/history.json')) {
            const history = JSON.parse(fs.readFileSync('./data/history.json', 'utf8'));
            const userHistory = history.find(u => u.userid === userid);
            time = userHistory?.time || 0;
          }
        } catch (e) {
          // Ignore history errors
        }
        
        Utils.account.set(userid, { name, profileUrl, thumbSrc, time });
        
        // Update online time
        const intervalId = setInterval(() => {
          try {
            const account = Utils.account.get(userid);
            if (account) {
              Utils.account.set(userid, { ...account, time: account.time + 1 });
            } else {
              clearInterval(intervalId);
            }
          } catch (error) {
            clearInterval(intervalId);
          }
        }, 1000);
        
        // Set biar-fca options
        api.setOptions({
          listenEvents: config[0]?.fcaOption?.listenEvents ?? true,
          logLevel: config[0]?.fcaOption?.logLevel ?? "silent",
          updatePresence: config[0]?.fcaOption?.updatePresence ?? true,
          selfListen: config[0]?.fcaOption?.selfListen ?? false,
          forceLogin: config[0]?.fcaOption?.forceLogin ?? true,
          online: config[0]?.fcaOption?.online ?? true,
          autoMarkDelivery: config[0]?.fcaOption?.autoMarkDelivery ?? false,
          autoMarkRead: config[0]?.fcaOption?.autoMarkRead ?? false,
        });

        // Start listening for events
        api.listenMqtt(async (error, event) => {
          if (error) {
            console.error(chalk.red(`❌ MQTT Error for ${userid}:`), error);
            return;
          }

          if (!event) return;

          // Process event
          await processEvent(api, event, userid, enableCommands, prefix, admin);
        });

        console.log(chalk.green(`✅ Listening for events via biar-fca`));
        resolve();
        
      } catch (error) {
        console.error(chalk.red('❌ Error in post-login setup:'), error);
        reject(error);
      }
    });
  });
}

// Event processing function
async function processEvent(api, event, userid, enableCommands, prefix, admin) {
  if (!event.body) return;

  const threadID = event.threadID;
  const messageID = event.messageID;
  const senderID = event.senderID;
  const message = event.body;

  // Load thread admins
  let threadAdmins = [];
  try {
    if (fs.existsSync('./data/database.json')) {
      const db = JSON.parse(fs.readFileSync('./data/database.json', 'utf8'));
      const thread = db.find(t => t[threadID]);
      if (thread) {
        threadAdmins = thread[threadID] || [];
      } else {
        const threadInfo = await api.getThreadInfo(threadID);
        const newThread = {};
        newThread[threadID] = threadInfo.adminIDs || [];
        db.push(newThread);
        fs.writeFileSync('./data/database.json', JSON.stringify(db, null, 2));
        threadAdmins = threadInfo.adminIDs || [];
      }
    } else {
      fs.writeFileSync('./data/database.json', '[]');
    }
  } catch (e) {
    // Ignore database errors
  }

  // Load blacklist
  let blacklist = [];
  try {
    if (fs.existsSync('./data/history.json')) {
      const history = JSON.parse(fs.readFileSync('./data/history.json', 'utf8'));
      blacklist = history.find(u => u.userid === userid)?.blacklist || [];
    }
  } catch (e) {
    // Ignore blacklist errors
  }

  // Check if message has prefix
  const hasPrefix = message.toLowerCase().startsWith(prefix.toLowerCase());
  
  if (hasPrefix) {
    const args = message.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    
    // Find command
    let matchedCommand = null;
    Utils.commands.forEach((cmd, aliases) => {
      if (aliases.includes(commandName)) {
        matchedCommand = cmd;
      }
    });

    if (matchedCommand) {
      // Check blacklist
      if (blacklist.includes(senderID)) {
        api.sendMessage("You are banned from using this bot.", threadID, messageID);
        return;
      }

      // Check permissions
      const isAdmin = config[0]?.masterKey?.admin?.includes(senderID) || admin.includes(senderID);
      const isThreadAdmin = threadAdmins.some(a => a.id === senderID);
      
      if (matchedCommand.role == 1 && !isAdmin) {
        api.sendMessage("Admin only command.", threadID, messageID);
        return;
      }
      
      if (matchedCommand.role == 2 && !isThreadAdmin && !isAdmin) {
        api.sendMessage("Group admin only command.", threadID, messageID);
        return;
      }

      // Check cooldown
      const now = Date.now();
      const cooldownKey = `${senderID}_${matchedCommand.name}_${userid}`;
      const lastUsed = Utils.cooldowns.get(cooldownKey);
      const delay = matchedCommand.cooldown || 0;

      if (!lastUsed || (now - lastUsed.timestamp) >= delay * 1000) {
        Utils.cooldowns.set(cooldownKey, { timestamp: now, command: matchedCommand.name });
        
        // Execute command
        try {
          await matchedCommand.run({ 
            api, 
            event, 
            args, 
            enableCommands, 
            admin, 
            prefix, 
            blacklist, 
            Utils 
          });
        } catch (error) {
          console.error(chalk.red(`Command error (${matchedCommand.name}):`), error);
          api.sendMessage(`Error: ${error.message}`, threadID, messageID);
        }
      } else {
        const waitTime = Math.ceil((lastUsed.timestamp + delay * 1000 - now) / 1000);
        api.sendMessage(`Please wait ${waitTime} second(s).`, threadID, messageID);
      }
    } else {
      api.sendMessage(`Unknown command. Use ${prefix}help`, threadID, messageID);
    }
  }

  // Handle events
  Utils.handleEvent.forEach((handler) => {
    try {
      handler.handleEvent({ api, event, enableCommands, admin, prefix, blacklist, Utils });
    } catch (e) {
      console.error(`HandleEvent error (${handler.name}):`, e);
    }
  });
}

// Helper functions
async function deleteThisUser(userid) {
  const configFile = './data/history.json';
  let config = [];
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (e) {
    // File might not exist
  }
  
  const sessionFile = path.join('./data/session', `${userid}.json`);
  const index = config.findIndex(item => item.userid === userid);
  if (index !== -1) config.splice(index, 1);
  
  try {
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  } catch (e) {
    console.log(e);
  }
  
  try {
    if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
  } catch (error) {
    console.log(error);
  }
}

async function addThisUser(userid, enableCommands, state, prefix, admin, blacklist = []) {
  const configFile = './data/history.json';
  const sessionFolder = './data/session';
  const sessionFile = path.join(sessionFolder, `${userid}.json`);
  
  // Don't add if session already exists
  if (fs.existsSync(sessionFile)) return;
  
  // Read or create config
  let config = [];
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (e) {
    config = [];
  }
  
  config.push({
    userid,
    prefix: prefix || "!",
    admin: admin || [],
    blacklist: blacklist || [],
    enableCommands,
    time: 0,
  });
  
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  fs.writeFileSync(sessionFile, JSON.stringify(state));
}

function aliases(command) {
  if (!command) return null;
  
  const aliases = Array.from(Utils.commands.entries()).find(([cmds]) => 
    cmds.includes(command?.toLowerCase())
  );
  
  return aliases ? aliases[1] : null;
}

async function main() {
  console.log(chalk.cyan('🚀 Starting biar-fca bot...'));
  
  const empty = require('fs-extra');
  const cacheFile = './script/cache';
  
  // Create necessary folders
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  if (!fs.existsSync('./data/session')) fs.mkdirSync('./data/session', { recursive: true });
  if (!fs.existsSync(cacheFile)) fs.mkdirSync(cacheFile, { recursive: true });
  
  // Create history file if not exists
  const historyFile = './data/history.json';
  if (!fs.existsSync(historyFile)) {
    fs.writeFileSync(historyFile, '[]', 'utf8');
  }
  
  // Read history
  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  } catch (e) {
    history = [];
  }
  
  // Get restart config
  const adminOfConfig = fs.existsSync('./data/config.json') 
    ? JSON.parse(fs.readFileSync('./data/config.json', 'utf8')) 
    : createConfig();

  // Schedule restart
  const restartTime = adminOfConfig[0]?.masterKey?.restartTime || 15;
  cron.schedule(`*/${restartTime} * * * *`, async () => {
    console.log(chalk.yellow('🔄 Scheduled restart...'));
    try {
      history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      history.forEach(user => {
        if (!user || typeof user !== 'object') return;
        const account = Utils.account.get(user.userid);
        if (account) user.time = account.time;
      });
      
      if (fs.existsSync(cacheFile)) {
        await empty.emptyDir(cacheFile);
      }
      
      fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
    } catch (e) {
      console.error('Error during restart:', e);
    }
    process.exit(1);
  });

  // Load saved sessions
  try {
    const sessionFolder = './data/session';
    if (fs.existsSync(sessionFolder)) {
      const sessions = fs.readdirSync(sessionFolder).filter(f => f.endsWith('.json'));
      console.log(chalk.cyan(`📁 Found ${sessions.length} saved session(s)`));
      
      for (const file of sessions) {
        try {
          const filePath = path.join(sessionFolder, file);
          const userid = path.parse(file).name;
          const userConfig = history.find(u => u.userid === userid) || {};
          const { enableCommands = [[], []], prefix = '!', admin = [] } = userConfig;
          const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          
          console.log(chalk.cyan(`📱 Auto-logging: ${userid}`));
          accountLogin(state, enableCommands, prefix, admin).catch(err => {
            console.error(chalk.red(`❌ Auto-login failed for ${userid}:`), err.message);
          });
        } catch (e) {
          console.error(chalk.red(`❌ Error loading session ${file}:`), e.message);
        }
      }
    }
  } catch (error) {
    console.error('Error loading sessions:', error);
  }
  
  console.log(chalk.green('✅ Bot is ready!'));
  console.log(chalk.green(`📝 Using prefix: "!" (default)`));
}

function createConfig() {
  const config = [{
    masterKey: {
      admin: [],
      devMode: false,
      database: false,
      restartTime: 15,
    },
    fcaOption: {
      forceLogin: true,
      listenEvents: true,
      logLevel: "silent",
      updatePresence: true,
      selfListen: false,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      online: true,
      autoMarkDelivery: false,
      autoMarkRead: false
    }
  }];
  
  if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data', { recursive: true });
  }
  
  fs.writeFileSync('./data/config.json', JSON.stringify(config, null, 2));
  console.log(chalk.green('✅ Created default config.json'));
  return config;
}

// Start the bot
main().catch(err => {
  console.error(chalk.red('❌ Fatal error:'), err);
  process.exit(1);
});