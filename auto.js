const fs = require('fs');
const path = require('path');
const login = require('./biar-fca'); // Fixed: Added proper path to biar-fca
const express = require('express');
const app = express();
const chalk = require('chalk');
const bodyParser = require('body-parser');
const script = path.join(__dirname, 'script');
const cron = require('node-cron');
const config = fs.existsSync('./data') && fs.existsSync('./data/config.json') ? JSON.parse(fs.readFileSync('./data/config.json', 'utf8')) : createConfig();

const Utils = {
  commands: new Map(),
  handleEvent: new Map(),
  account: new Map(),
  cooldowns: new Map(),
};

// Load commands from script folder
function loadCommands() {
  if (!fs.existsSync(script)) {
    fs.mkdirSync(script, { recursive: true });
    return;
  }

  fs.readdirSync(script).forEach((file) => {
    const scripts = path.join(script, file);
    const stats = fs.statSync(scripts);
    
    if (stats.isDirectory()) {
      // Handle nested command folders
      fs.readdirSync(scripts).forEach((subFile) => {
        loadCommandFile(path.join(scripts, subFile));
      });
    } else {
      loadCommandFile(scripts);
    }
  });
  
  console.log(chalk.green(`✅ Loaded ${Utils.commands.size} commands and ${Utils.handleEvent.size} event handlers`));
}

function loadCommandFile(filePath) {
  if (!filePath.endsWith('.js')) return;
  
  try {
    const { config: cmdConfig, run, handleEvent } = require(filePath);
    
    if (!cmdConfig) return;

    const {
      name = '',
      role = '0',
      version = '1.0.0',
      hasPrefix = true,
      aliases = [],
      description = '',
      usage = '',
      credits = '',
      cooldown = '5'
    } = cmdConfig;

    // Ensure name exists
    if (!name) return;

    // Create aliases array including the main name
    const allAliases = [name, ...(aliases || [])].filter(Boolean);

    const commandData = {
      name,
      role: parseInt(role) || 0,
      aliases: allAliases,
      description,
      usage,
      version,
      hasPrefix,
      credits,
      cooldown: parseInt(cooldown) || 5,
      run,
      handleEvent
    };

    // Store command
    if (run) {
      Utils.commands.set(name, commandData);
      // Also store by aliases for quick lookup
      allAliases.forEach(alias => {
        if (alias !== name) {
          Utils.commands.set(alias, commandData);
        }
      });
    }

    // Store event handler
    if (handleEvent) {
      Utils.handleEvent.set(name, commandData);
    }

    console.log(chalk.cyan(`  📦 Loaded: ${name}`));
  } catch (error) {
    console.error(chalk.red(`❌ Error loading command from ${path.basename(filePath)}: ${error.message}`));
  }
}

// Express routes
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(express.json());

const routes = [
  { path: '/', file: 'index.html' },
  { path: '/step_by_step_guide', file: 'guide.html' },
  { path: '/online_user', file: 'online.html' },
];

routes.forEach(route => {
  app.get(route.path, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', route.file));
  });
});

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
  const commands = Array.from(Utils.commands.values())
    .filter((cmd, index, self) => self.findIndex(c => c.name === cmd.name) === index)
    .map(cmd => ({
      name: cmd.name,
      role: cmd.role,
      description: cmd.description,
      usage: cmd.usage,
      hasPrefix: cmd.hasPrefix,
      aliases: cmd.aliases,
      cooldown: cmd.cooldown
    }));

  const handleEvents = Array.from(Utils.handleEvent.values())
    .map(ev => ({
      name: ev.name,
      description: ev.description
    }));

  res.json({ commands, handleEvents });
});

app.post('/login', async (req, res) => {
  const { state, commands, prefix, admin } = req.body;
  
  try {
    if (!state) {
      throw new Error('Missing app state data');
    }

    const cUser = state.find(item => item.key === 'c_user');
    if (!cUser) {
      return res.status(400).json({
        error: true,
        message: "Invalid appstate data - missing c_user"
      });
    }

    const existingUser = Utils.account.get(cUser.value);
    if (existingUser) {
      return res.status(400).json({
        error: false,
        message: "Active user session detected; already logged in",
        user: existingUser
      });
    }

    try {
      await accountLogin(state, commands || [[], []], prefix || '/', admin ? [admin] : []);
      res.status(200).json({
        success: true,
        message: 'Login successful'
      });
    } catch (error) {
      console.error(error);
      res.status(400).json({
        error: true,
        message: error.message
      });
    }
  } catch (error) {
    return res.status(400).json({
      error: true,
      message: "Error processing login request"
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(chalk.yellow(`🌐 Server running at http://localhost:${PORT}`));
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('❌ Unhandled Promise Rejection:'), reason);
});

// Main account login function
async function accountLogin(state, enableCommands = [[], []], prefix = '/', admin = []) {
  return new Promise((resolve, reject) => {
    login({ appState: state }, async (error, api) => {
      if (error) {
        reject(error);
        return;
      }

      try {
        const userid = await api.getCurrentUserID();
        
        // Get user info
        const userInfo = await api.getUserInfo(userid);
        if (!userInfo || !userInfo[userid]) {
          throw new Error('Unable to get user info');
        }

        const { name, profileUrl, thumbSrc } = userInfo[userid];
        
        // Get or create user data
        let time = 0;
        try {
          const history = JSON.parse(fs.readFileSync('./data/history.json', 'utf-8'));
          const userData = history.find(user => user.userid === userid);
          time = userData?.time || 0;
        } catch (e) {
          // History file might not exist yet
        }

        // Store account info
        Utils.account.set(userid, {
          name,
          profileUrl,
          thumbSrc,
          time: time
        });

        // Update time counter
        const intervalId = setInterval(() => {
          try {
            const account = Utils.account.get(userid);
            if (!account) {
              clearInterval(intervalId);
              return;
            }
            Utils.account.set(userid, {
              ...account,
              time: account.time + 1
            });
          } catch (error) {
            clearInterval(intervalId);
          }
        }, 1000);

        // Configure API options
        api.setOptions({
          listenEvents: config[0]?.fcaOption?.listenEvents || true,
          logLevel: config[0]?.fcaOption?.logLevel || "silent",
          updatePresence: config[0]?.fcaOption?.updatePresence || false,
          selfListen: config[0]?.fcaOption?.selfListen || false,
          forceLogin: config[0]?.fcaOption?.forceLogin || true,
          online: config[0]?.fcaOption?.online || true,
          autoMarkDelivery: config[0]?.fcaOption?.autoMarkDelivery || false,
          autoMarkRead: config[0]?.fcaOption?.autoMarkRead || false,
        });

        // Save user session
        await addThisUser(userid, enableCommands, state, prefix, admin);

        // Start listening for messages
        api.listenMqtt(async (error, event) => {
          if (error) {
            console.error(chalk.red(`❌ Listen error for user ${userid}:`), error);
            return;
          }

          await handleEvent(api, event, userid, enableCommands, prefix, admin);
        });

        console.log(chalk.green(`✅ Account ${name} (${userid}) logged in successfully`));
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Handle incoming events
async function handleEvent(api, event, userid, enableCommands, prefix, admin) {
  try {
    // Load database
    let database = [];
    try {
      database = JSON.parse(fs.readFileSync('./data/database.json', 'utf8'));
    } catch (e) {
      // Database might not exist yet
    }

    // Load blacklist
    let blacklist = [];
    try {
      const history = JSON.parse(fs.readFileSync('./data/history.json', 'utf-8'));
      const userData = history.find(u => u.userid === userid);
      blacklist = userData?.blacklist || [];
    } catch (e) {
      // History might not exist
    }

    // Handle different event types
    switch (event.type) {
      case 'message':
      case 'message_reply':
        await handleMessage(api, event, userid, enableCommands, prefix, admin, blacklist, database);
        break;
      
      case 'event':
        // Handle group events (join/leave)
        break;
      
      default:
        // Handle other events
        break;
    }

    // Run handleEvent commands
    for (const [name, handler] of Utils.handleEvent) {
      if (handler.handleEvent) {
        try {
          await handler.handleEvent({
            api,
            event,
            enableCommands,
            admin,
            prefix,
            blacklist,
            Utils
          });
        } catch (error) {
          console.error(chalk.red(`❌ Error in handleEvent ${name}:`), error);
        }
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Error in handleEvent:'), error);
  }
}

// Handle message events
async function handleMessage(api, event, userid, enableCommands, prefix, admin, blacklist, database) {
  if (!event.body) return;

  const message = event.body.trim();
  const threadID = event.threadID;

  // Check if user is blacklisted
  if (blacklist.includes(event.senderID)) {
    api.sendMessage("You've been banned from using this bot.", threadID, event.messageID);
    return;
  }

  // Check for prefix
  if (!message.startsWith(prefix)) return;

  // Parse command
  const args = message.slice(prefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  // Find command
  const command = Utils.commands.get(commandName);
  if (!command) {
    // Command not found
    return;
  }

  // Check if command is enabled
  const enabledCmds = enableCommands[0]?.commands || [];
  if (!enabledCmds.includes(command.name)) {
    return;
  }

  // Check permissions
  const isAdmin = admin.includes(event.senderID);
  const isThreadAdmin = database.some(t => {
    const threadData = t[threadID];
    return threadData?.some(admin => admin.id === event.senderID);
  });

  if (command.role === 1 && !isAdmin) {
    api.sendMessage("You don't have permission to use this command.", threadID, event.messageID);
    return;
  }

  if (command.role === 2 && !isThreadAdmin && !isAdmin) {
    api.sendMessage("Only group admins can use this command.", threadID, event.messageID);
    return;
  }

  if (command.role === 3 && !isAdmin) {
    api.sendMessage("Only bot admins can use this command.", threadID, event.messageID);
    return;
  }

  // Check cooldown
  const cooldownKey = `${event.senderID}_${command.name}_${userid}`;
  const lastUsed = Utils.cooldowns.get(cooldownKey);
  const now = Date.now();

  if (lastUsed && (now - lastUsed) < command.cooldown * 1000) {
    const remaining = Math.ceil((lastUsed + command.cooldown * 1000 - now) / 1000);
    api.sendMessage(`⏰ Please wait ${remaining} seconds before using this command again.`, threadID, event.messageID);
    return;
  }

  // Update cooldown
  Utils.cooldowns.set(cooldownKey, now);

  // Execute command
  try {
    console.log(chalk.blue(`▶️ Executing command: ${prefix}${commandName} by ${event.senderID}`));
    
    await command.run({
      api,
      event,
      args,
      enableCommands,
      admin,
      prefix,
      blacklist,
      Utils,
      reply: (msg) => api.sendMessage(msg, threadID, event.messageID)
    });
  } catch (error) {
    console.error(chalk.red(`❌ Error executing command ${commandName}:`), error);
    api.sendMessage(`❌ An error occurred: ${error.message}`, threadID, event.messageID);
  }
}

// User management functions
async function deleteThisUser(userid) {
  const configFile = './data/history.json';
  try {
    let config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    const sessionFile = path.join('./data/session', `${userid}.json`);
    
    config = config.filter(item => item.userid !== userid);
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
    
    Utils.account.delete(userid);
    console.log(chalk.yellow(`🗑️ Removed user: ${userid}`));
  } catch (error) {
    console.error(chalk.red(`❌ Error deleting user ${userid}:`), error);
  }
}

async function addThisUser(userid, enableCommands, state, prefix, admin, blacklist = []) {
  const configFile = './data/history.json';
  const sessionFolder = './data/session';
  const sessionFile = path.join(sessionFolder, `${userid}.json`);

  // Create session folder if it doesn't exist
  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
  }

  // Read or create config
  let config = [];
  if (fs.existsSync(configFile)) {
    config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  }

  // Check if user already exists
  const existingIndex = config.findIndex(item => item.userid === userid);
  const userData = {
    userid,
    prefix: prefix || '/',
    admin: admin || [],
    blacklist: blacklist || [],
    enableCommands,
    time: 0,
  };

  if (existingIndex !== -1) {
    config[existingIndex] = userData;
  } else {
    config.push(userData);
  }

  // Save files
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  fs.writeFileSync(sessionFile, JSON.stringify(state));
}

// Main function
async function main() {
  console.log(chalk.magenta('🚀 Starting bot system...'));

  // Create necessary directories
  const dirs = ['./data', './data/session', './script/cache', './public'];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Load commands
  loadCommands();

  // Create config if it doesn't exist
  if (!fs.existsSync('./data/config.json')) {
    createConfig();
  }

  // Create history file if it doesn't exist
  if (!fs.existsSync('./data/history.json')) {
    fs.writeFileSync('./data/history.json', '[]', 'utf-8');
  }

  // Create database file if it doesn't exist
  if (!fs.existsSync('./data/database.json')) {
    fs.writeFileSync('./data/database.json', '[]', 'utf-8');
  }

  // Schedule restart if configured
  if (config[0]?.masterKey?.restartTime) {
    cron.schedule(`*/${config[0].masterKey.restartTime} * * * *`, async () => {
      console.log(chalk.yellow('🔄 Scheduled restart...'));
      
      // Update history times
      try {
        const history = JSON.parse(fs.readFileSync('./data/history.json', 'utf-8'));
        history.forEach(user => {
          const account = Utils.account.get(user.userid);
          if (account) {
            user.time = account.time;
          }
        });
        fs.writeFileSync('./data/history.json', JSON.stringify(history, null, 2));
      } catch (error) {
        console.error(chalk.red('❌ Error updating history:'), error);
      }

      // Clear cache
      const cacheFile = './script/cache';
      if (fs.existsSync(cacheFile)) {
        fs.readdirSync(cacheFile).forEach(file => {
          fs.unlinkSync(path.join(cacheFile, file));
        });
      }

      console.log(chalk.yellow('🔄 Restarting...'));
      process.exit(0);
    });
  }

  // Load saved sessions
  try {
    const sessionFolder = path.join('./data/session');
    if (fs.existsSync(sessionFolder)) {
      const config = JSON.parse(fs.readFileSync('./data/history.json', 'utf-8'));
      
      for (const file of fs.readdirSync(sessionFolder)) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(sessionFolder, file);
        const userid = path.parse(file).name;
        
        try {
          const userConfig = config.find(item => item.userid === userid);
          if (!userConfig) {
            fs.unlinkSync(filePath);
            continue;
          }

          const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          await accountLogin(
            state, 
            userConfig.enableCommands || [[], []], 
            userConfig.prefix || '/', 
            userConfig.admin || []
          );
          
          console.log(chalk.green(`✅ Restored session for ${userid}`));
        } catch (error) {
          console.error(chalk.red(`❌ Failed to restore session for ${userid}:`), error.message);
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            // Ignore
          }
        }
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Error loading sessions:'), error);
  }

  console.log(chalk.green('✅ Bot system initialized successfully!'));
}

// Helper function to create config
function createConfig() {
  const configData = [{
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
      updatePresence: false,
      selfListen: false,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      online: true,
      autoMarkDelivery: false,
      autoMarkRead: false
    }
  }];

  fs.writeFileSync('./data/config.json', JSON.stringify(configData, null, 2));
  return configData;
}

// Start the application
main().catch(error => {
  console.error(chalk.red('❌ Fatal error:'), error);
  process.exit(1);
});