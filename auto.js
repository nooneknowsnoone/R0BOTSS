const fs = require('fs');
const path = require('path');
const login = require('./biar-fca'); // Connected to biar-fca
const express = require('express');
const app = express();
const chalk = require('chalk');
const bodyParser = require('body-parser');
const script = path.join(__dirname, 'script'); // This points to your script folder
const cron = require('node-cron');

// ============= CONFIGURATION =============
// Create default config if not exists
function createDefaultConfig() {
  const defaultConfig = [{
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
  
  // Create data folder if not exists
  if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data', { recursive: true });
  }
  
  fs.writeFileSync('./data/config.json', JSON.stringify(defaultConfig, null, 2));
  return defaultConfig;
}

// Load or create config
const config = fs.existsSync('./data/config.json') 
  ? JSON.parse(fs.readFileSync('./data/config.json', 'utf8')) 
  : createDefaultConfig();

// ============= UTILS OBJECT =============
const Utils = {
  commands: new Map(),
  handleEvent: new Map(),
  account: new Map(),
  cooldowns: new Map(),
};

// ============= LOAD COMMANDS FROM SCRIPT FOLDER =============
console.log(chalk.cyan('📂 Loading commands from script folder...'));

// Check if script folder exists
if (fs.existsSync(script)) {
  const commandFiles = fs.readdirSync(script).filter(file => file.endsWith('.js'));
  
  if (commandFiles.length === 0) {
    console.log(chalk.yellow('⚠️ No commands found in script folder'));
  }

  // Load commands
  commandFiles.forEach((file) => {
    try {
      const commandPath = path.join(script, file);
      const command = require(commandPath);
      
      if (command.config && command.run) {
        const config = command.config;
        const name = config.name || path.parse(file).name;
        const aliases = config.aliases ? [name, ...config.aliases] : [name];
        
        Utils.commands.set(aliases, {
          name: name,
          role: config.role || 0,
          run: command.run,
          aliases: aliases,
          description: config.description || '',
          usage: config.usage || '',
          version: config.version || '1.0.0',
          hasPrefix: config.hasPrefix !== false,
          credits: config.credits || 'Unknown',
          cooldown: config.cooldown || 5
        });
        
        if (command.handleEvent) {
          Utils.handleEvent.set(aliases, {
            name: name,
            handleEvent: command.handleEvent,
            role: config.role || 0,
            description: config.description || '',
            usage: config.usage || '',
            version: config.version || '1.0.0',
            hasPrefix: config.hasPrefix !== false,
            credits: config.credits || 'Unknown',
            cooldown: config.cooldown || 5
          });
        }
        
        console.log(chalk.green(`✅ Loaded command: ${name} from ${file}`));
      } else {
        console.log(chalk.yellow(`⚠️ Invalid command format in ${file}`));
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error loading command ${file}:`), error.message);
    }
  });
} else {
  console.log(chalk.red('❌ Script folder not found! Creating it...'));
  fs.mkdirSync(script, { recursive: true });
  console.log(chalk.green('✅ Created script folder. Please add your commands.'));
}

console.log(chalk.green(`✅ Loaded ${Utils.commands.size} commands total`));

// ============= EXPRESS SERVER SETUP =============
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(express.json());

// Create public folder if not exists
if (!fs.existsSync('./public')) {
  fs.mkdirSync('./public', { recursive: true });
}

// Create basic HTML files if not exists
const htmlFiles = {
  'index.html': '<!DOCTYPE html><html><head><title>Bot Dashboard</title></head><body><h1>Bot is Running!</h1></body></html>',
  'guide.html': '<h1>Guide</h1>',
  'online.html': '<h1>Online Users</h1>',
  'autobot.html': '<h1>Auto Bot</h1>',
  'autoshare.html': '<h1>Auto Share</h1>'
};

Object.entries(htmlFiles).forEach(([file, content]) => {
  const filePath = path.join(__dirname, 'public', file);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
  }
});

const routes = [
  { path: '/', file: 'index.html' },
  { path: '/step_by_step_guide', file: 'guide.html' },
  { path: '/online_user', file: 'online.html' },
  { path: '/site', file: 'autobot.html' },
  { path: '/autoshare', file: 'autoshare.html' },
];

routes.forEach(route => {
  app.get(route.path, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', route.file));
  });
});

// API Endpoints
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
  const commandList = [];
  Utils.commands.forEach(cmd => {
    commandList.push({
      name: cmd.name,
      description: cmd.description,
      usage: cmd.usage,
      role: cmd.role,
      hasPrefix: cmd.hasPrefix
    });
  });
  res.json(commandList);
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
      return res.status(400).json({ error: true, message: 'Invalid appstate data' });
    }
    
    const existingUser = Utils.account.get(cUser.value);
    if (existingUser) {
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
  console.error('Unhandled Rejection:', reason);
});

// ============= MAIN ACCOUNT LOGIN FUNCTION (biar-fca connection) =============
async function accountLogin(state, enableCommands = [[], []], prefix = '!', admin = []) {
  return new Promise((resolve, reject) => {
    console.log(chalk.cyan('📱 Attempting Facebook login...'));
    
    login({ appState: state }, async (error, api) => {
      if (error) {
        console.error(chalk.red('❌ Login failed:'), error);
        reject(error);
        return;
      }

      console.log(chalk.green('✅ Facebook login successful! Connected via biar-fca'));

      try {
        const userid = await api.getCurrentUserID();
        console.log(chalk.cyan(`👤 Logged in as user ID: ${userid}`));
        
        // Create data folder if not exists
        if (!fs.existsSync('./data')) {
          fs.mkdirSync('./data', { recursive: true });
        }
        if (!fs.existsSync('./data/session')) {
          fs.mkdirSync('./data/session', { recursive: true });
        }
        
        await addThisUser(userid, enableCommands, state, prefix, admin);
        
        const userInfo = await api.getUserInfo(userid);
        if (!userInfo || !userInfo[userid]) {
          throw new Error('Cannot get user info');
        }

        const { name, profileUrl, thumbSrc } = userInfo[userid];
        
        // Get or initialize time
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
          const account = Utils.account.get(userid);
          if (account) {
            account.time += 1;
            Utils.account.set(userid, account);
          } else {
            clearInterval(intervalId);
          }
        }, 1000);

        // Configure biar-fca options
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

        // Start listening for events (biar-fca MQTT connection)
        api.listenMqtt(async (err, event) => {
          if (err) {
            console.error(chalk.red(`❌ MQTT Error for ${userid}:`), err);
            return;
          }

          if (!event) return;

          // Handle events with your auto.js logic
          try {
            await handleEvent(api, event, userid, enableCommands, prefix, admin);
          } catch (e) {
            console.error(chalk.red('Error handling event:'), e);
          }
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

// ============= EVENT HANDLER =============
async function handleEvent(api, event, userid, enableCommands, prefix, admin) {
  // Skip if no message body
  if (!event.body) return;

  const threadID = event.threadID;
  const messageID = event.messageID;
  const senderID = event.senderID;
  const message = event.body;

  // Log message for debugging
  console.log(chalk.cyan(`💬 [${threadID}] ${senderID}: ${message}`));

  // Load thread admins
  let threadAdmins = [];
  try {
    if (fs.existsSync('./data/database.json')) {
      const db = JSON.parse(fs.readFileSync('./data/database.json', 'utf8'));
      const thread = db.find(t => t[threadID]);
      if (thread) {
        threadAdmins = thread[threadID] || [];
      } else {
        // Create thread entry
        const threadInfo = await api.getThreadInfo(threadID);
        const newThread = {};
        newThread[threadID] = threadInfo.adminIDs || [];
        db.push(newThread);
        fs.writeFileSync('./data/database.json', JSON.stringify(db, null, 2));
        threadAdmins = threadInfo.adminIDs || [];
      }
    } else {
      // Create database file
      fs.writeFileSync('./data/database.json', '[]');
      
      const threadInfo = await api.getThreadInfo(threadID);
      const newThread = {};
      newThread[threadID] = threadInfo.adminIDs || [];
      fs.writeFileSync('./data/database.json', JSON.stringify([newThread], null, 2));
      threadAdmins = threadInfo.adminIDs || [];
    }
  } catch (e) {
    // Ignore database errors
  }

  // Check blacklist
  let isBlacklisted = false;
  try {
    if (fs.existsSync('./data/history.json')) {
      const history = JSON.parse(fs.readFileSync('./data/history.json', 'utf8'));
      const userHistory = history.find(u => u.userid === userid);
      isBlacklisted = userHistory?.blacklist?.includes(senderID) || false;
    }
  } catch (e) {
    // Ignore blacklist errors
  }

  if (isBlacklisted) {
    api.sendMessage("⛔ You are blacklisted from using this bot.", threadID, messageID);
    return;
  }

  // Check if message starts with prefix
  const hasPrefix = message.toLowerCase().startsWith(prefix.toLowerCase());
  
  if (hasPrefix) {
    // Extract command and args
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
      // Check role permissions
      const isAdmin = config[0]?.masterKey?.admin?.includes(senderID) || admin.includes(senderID);
      const isThreadAdmin = threadAdmins.some(a => a.id === senderID);
      
      if (matchedCommand.role === 1 && !isAdmin) {
        api.sendMessage("⛔ Admin only command.", threadID, messageID);
        return;
      }
      
      if (matchedCommand.role === 2 && !isThreadAdmin && !isAdmin) {
        api.sendMessage("⛔ Group admin only command.", threadID, messageID);
        return;
      }

      // Check cooldown
      const cooldownKey = `${senderID}_${matchedCommand.name}`;
      const lastUsed = Utils.cooldowns.get(cooldownKey);
      const now = Date.now();
      
      if (lastUsed && (now - lastUsed) < (matchedCommand.cooldown * 1000)) {
        const timeLeft = Math.ceil((matchedCommand.cooldown * 1000 - (now - lastUsed)) / 1000);
        api.sendMessage(`⏱️ Please wait ${timeLeft} second(s).`, threadID, messageID);
        return;
      }

      // Set cooldown
      Utils.cooldowns.set(cooldownKey, now);

      // Execute command
      try {
        await matchedCommand.run({ 
          api, 
          event, 
          args, 
          Utils,
          prefix,
          admin: config[0]?.masterKey?.admin || []
        });
      } catch (error) {
        console.error(chalk.red(`❌ Command error (${matchedCommand.name}):`), error);
        api.sendMessage(`❌ Error: ${error.message}`, threadID, messageID);
      }
    } else {
      api.sendMessage(`❌ Unknown command. Use ${prefix}help`, threadID, messageID);
    }
  }

  // Handle events
  Utils.handleEvent.forEach((handler) => {
    try {
      handler.handleEvent({ api, event, Utils });
    } catch (e) {
      console.error(chalk.red(`❌ HandleEvent error (${handler.name}):`), e);
    }
  });
}

// ============= HELPER FUNCTIONS =============
async function addThisUser(userid, enableCommands, state, prefix, admin, blacklist = []) {
  const historyFile = './data/history.json';
  const sessionFile = `./data/session/${userid}.json`;
  
  // Create history if not exists
  let history = [];
  if (fs.existsSync(historyFile)) {
    try {
      history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    } catch (e) {
      history = [];
    }
  }
  
  // Add user to history
  const existingIndex = history.findIndex(u => u.userid === userid);
  const userData = {
    userid,
    prefix: prefix || '!',
    admin: admin || [],
    blacklist: blacklist || [],
    enableCommands: enableCommands || [[], []],
    time: 0
  };
  
  if (existingIndex >= 0) {
    history[existingIndex] = userData;
  } else {
    history.push(userData);
  }
  
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
  fs.writeFileSync(sessionFile, JSON.stringify(state));
}

// ============= MAIN FUNCTION =============
async function main() {
  console.log(chalk.cyan('🚀 Starting biar-fca + auto.js bot...'));
  
  // Create all necessary folders
  if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data', { recursive: true });
  }
  if (!fs.existsSync('./data/session')) {
    fs.mkdirSync('./data/session', { recursive: true });
  }
  
  // Create necessary files
  if (!fs.existsSync('./data/history.json')) {
    fs.writeFileSync('./data/history.json', '[]');
  }
  
  if (!fs.existsSync('./data/database.json')) {
    fs.writeFileSync('./data/database.json', '[]');
  }

  // Load saved sessions
  const sessionFolder = './data/session';
  if (fs.existsSync(sessionFolder)) {
    const sessions = fs.readdirSync(sessionFolder).filter(f => f.endsWith('.json'));
    console.log(chalk.cyan(`📁 Found ${sessions.length} saved session(s)`));
    
    for (const session of sessions) {
      try {
        const userid = path.parse(session).name;
        const state = JSON.parse(fs.readFileSync(path.join(sessionFolder, session), 'utf8'));
        
        // Get user config
        let history = [];
        if (fs.existsSync('./data/history.json')) {
          history = JSON.parse(fs.readFileSync('./data/history.json', 'utf8'));
        }
        
        const userConfig = history.find(u => u.userid === userid) || {};
        const { enableCommands = [[], []], prefix = '!', admin = [] } = userConfig;
        
        console.log(chalk.cyan(`📱 Auto-logging: ${userid}`));
        accountLogin(state, enableCommands, prefix, admin).catch(err => {
          console.error(chalk.red(`❌ Failed to auto-login ${userid}:`), err.message);
        });
      } catch (e) {
        console.error(chalk.red(`❌ Error loading session ${session}:`), e.message);
      }
    }
  }

  // Schedule restart
  const restartTime = config[0]?.masterKey?.restartTime || 15;
  cron.schedule(`*/${restartTime} * * * *`, () => {
    console.log(chalk.yellow('🔄 Scheduled restart...'));
    process.exit(0);
  });

  console.log(chalk.green('✅ Bot is ready!'));
  console.log(chalk.green(`📝 Using prefix: "${config[0]?.masterKey?.prefix || '!'}"`));
  console.log(chalk.green(`📁 Commands loaded from: ./script/ folder`));
}

// Start everything
main().catch(err => {
  console.error(chalk.red('❌ Fatal error:'), err);
  process.exit(1);
});