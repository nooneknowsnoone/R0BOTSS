const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();
const chalk = require('chalk');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const empty = require('fs-extra');

// Load biar-fca
function loadBiarFca() {
  const candidates = [path.join(__dirname, "biar-fca"), "biar-fca"];
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const resolvedPath = require.resolve(candidate);
      console.log(`[BOOT] Loading biar-fca from ${resolvedPath}`);
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  console.error("[BOOT] Failed to load biar-fca from the local folder or node_modules.");
  throw lastError;
}

const { login } = loadBiarFca();

const script = path.join(__dirname, 'script');
const config = fs.existsSync('./data') && fs.existsSync('./data/config.json') ? JSON.parse(fs.readFileSync('./data/config.json', 'utf8')) : createConfig();

const Utils = new Object({
  commands: new Map(),
  handleEvent: new Map(),
  account: new Map(),
  cooldowns: new Map(),
});

// Load commands from script folder
function loadCommandsFromScript() {
  if (!fs.existsSync(script)) {
    console.log(chalk.yellow('[BOOT] Script folder not found, creating...'));
    fs.mkdirSync(script, { recursive: true });
    return;
  }

  fs.readdirSync(script).forEach((file) => {
    const scripts = path.join(script, file);
    const stats = fs.statSync(scripts);
    
    if (stats.isDirectory()) {
      // Load commands from subfolders
      fs.readdirSync(scripts).forEach((subFile) => {
        try {
          const commandPath = path.join(scripts, subFile);
          if (subFile.endsWith('.js')) {
            const {
              config,
              run,
              handleEvent
            } = require(commandPath);
            
            if (config) {
              const {
                name = [], 
                role = '0', 
                version = '1.0.0', 
                hasPrefix = true, 
                aliases = [], 
                description = '', 
                usage = '', 
                credits = '', 
                cooldown = '5'
              } = Object.fromEntries(Object.entries(config).map(([key, value]) => [key.toLowerCase(), value]));
              
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
                  hasPrefix: config.hasPrefix,
                  credits,
                  cooldown
                });
              }
              
              if (handleEvent) {
                Utils.handleEvent.set(aliases, {
                  name,
                  handleEvent,
                  role,
                  description,
                  usage,
                  version,
                  hasPrefix: config.hasPrefix,
                  credits,
                  cooldown
                });
              }
              
              console.log(chalk.green(`[LOAD] Loaded command: ${name} from ${file}/${subFile}`));
            }
          }
        } catch (error) {
          console.error(chalk.red(`Error installing command from file ${file}/${subFile}: ${error.message}`));
        }
      });
    } else if (file.endsWith('.js')) {
      // Load commands from root script folder
      try {
        const {
          config,
          run,
          handleEvent
        } = require(scripts);
        
        if (config) {
          const {
            name = [], 
            role = '0', 
            version = '1.0.0', 
            hasPrefix = true, 
            aliases = [], 
            description = '', 
            usage = '', 
            credits = '', 
            cooldown = '5'
          } = Object.fromEntries(Object.entries(config).map(([key, value]) => [key.toLowerCase(), value]));
          
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
              hasPrefix: config.hasPrefix,
              credits,
              cooldown
            });
          }
          
          if (handleEvent) {
            Utils.handleEvent.set(aliases, {
              name,
              handleEvent,
              role,
              description,
              usage,
              version,
              hasPrefix: config.hasPrefix,
              credits,
              cooldown
            });
          }
          
          console.log(chalk.green(`[LOAD] Loaded command: ${name} from ${file}`));
        }
      } catch (error) {
        console.error(chalk.red(`Error installing command from file ${file}: ${error.message}`));
      }
    }
  });
  
  console.log(chalk.cyan(`[BOOT] Total commands loaded: ${Utils.commands.size}`));
  console.log(chalk.cyan(`[BOOT] Total handleEvent loaded: ${Utils.handleEvent.size}`));
}

// Load commands
loadCommandsFromScript();

// Express setup
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Routes
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
    const filePath = path.join(__dirname, 'public', route.file);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).send('File not found');
    }
  });
});

// Ping endpoint
app.head('/ping', (req, res) => {
  res.sendStatus(200);
});

// Get online users/info
app.get('/info', (req, res) => {
  const data = Array.from(Utils.account.values()).map(account => ({
    name: account.name,
    profileUrl: account.profileUrl,
    thumbSrc: account.thumbSrc,
    time: account.time
  }));
  res.json(JSON.parse(JSON.stringify(data, null, 2)));
});

// Get commands list
app.get('/commands', (req, res) => {
  const commandSet = new Set();
  const commands = [...Utils.commands.values()].map(({ name }) => {
    commandSet.add(name);
    return name;
  });
  
  const handleEvent = [...Utils.handleEvent.values()]
    .map(({ name }) => commandSet.has(name) ? null : (commandSet.add(name), name))
    .filter(Boolean);
  
  const aliases = [...Utils.commands.values()].map(({ aliases }) => aliases);
  
  res.json({
    commands,
    handleEvent,
    aliases
  });
});

// Login endpoint
app.post('/login', async (req, res) => {
  let { state, commands, prefix, admin } = req.body;
  
  console.log(chalk.cyan('[LOGIN] Login request received'));
  
  try {
    if (!state) {
      return res.status(400).json({
        success: false,
        message: "Missing appstate data"
      });
    }

    // Validate appstate format
    if (!Array.isArray(state)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appstate format. Must be an array."
      });
    }

    // Find c_user to check if may laman
    const cUser = state.find(item => item.key === 'c_user');
    if (!cUser || !cUser.value) {
      return res.status(400).json({
        success: false,
        message: "Invalid appstate: Missing c_user. Please get fresh cookies."
      });
    }

    // Check if user already logged in
    const existingUser = Utils.account.get(cUser.value);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Account is already logged in",
        user: existingUser
      });
    }

    // Convert admin to array if string
    if (admin && !Array.isArray(admin)) {
      admin = [admin];
    }

    // Default prefix if empty
    if (!prefix || prefix.trim() === '') {
      prefix = '!';
    }

    // Ensure commands format
    if (!Array.isArray(commands) || commands.length < 2) {
      commands = [{ commands: [] }, { handleEvent: [] }];
    }

    // Attempt login
    try {
      await accountLogin(state, commands, prefix, admin);
      res.json({
        success: true,
        message: '✅ Bot started successfully!'
      });
    } catch (loginError) {
      console.error(chalk.red('[LOGIN] Login failed:'), loginError);
      
      // Return the actual error message from accountLogin
      res.status(400).json({
        success: false,
        message: loginError.message || "Login failed. Please check your appstate."
      });
    }

  } catch (error) {
    console.error(chalk.red('[LOGIN] Unexpected error:'), error);
    res.status(500).json({
      success: false,
      message: "Server error: " + (error.message || "Unknown error")
    });
  }
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(chalk.green(`✅ Server is running at http://localhost:${PORT}`));
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// Helper functions for messaging
function sendMessageMqtt(api, message, threadID, replyToMessageID) {
  return new Promise((resolve, reject) => {
    api.sendMessageMqtt(message, threadID, replyToMessageID, (error, info) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(info);
    });
  });
}

async function sendReply(api, message, threadID, replyToMessageID) {
  if (typeof api.sendMessageMqtt === "function") {
    try {
      return await sendMessageMqtt(api, message, threadID, replyToMessageID);
    } catch (error) {
      console.error("[SEND] MQTT send failed, falling back to sendMessage:", error.message);
    }
  }
  
  return new Promise((resolve, reject) => {
    api.sendMessage(message, threadID, (error, info) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(info);
    });
  });
}

function getUserInfo(api, userID) {
  return new Promise((resolve, reject) => {
    api.getUserInfo(userID, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });
}

function isMessageEvent(event) {
  return event && (event.type === "message" || event.type === "message_reply");
}

async function accountLogin(state, enableCommands = [], prefix, admin = []) {
  return new Promise((resolve, reject) => {
    const loginOptions = {
      online: false,
      updatePresence: false,
      selfListen: false,
      listenEvents: true,
      listenTyping: false,
      advancedProtection: false,
      autoMarkRead: false,
      autoMarkDelivery: false,
      autoReconnect: true,
      forceLogin: false,
      emitReady: false,
      mqttReconnectPolicy: {
        clientReconnectPeriod: 0,
        initialRetryDelay: 2000,
        maxReconnectAttempts: 10,
        maxRetryDelay: 30000,
        periodicReconnect: false,
      },
    };

    console.log(chalk.cyan('[LOGIN] Attempting login with biar-fca...'));

    login({ appState: state }, loginOptions, async (error, api) => {
      if (error) {
        console.error(chalk.red('[LOGIN] biar-fca login error:'), error);
        
        // Determine error type
        let errorMessage = "Login failed";
        
        if (typeof error === 'string') {
          if (error.includes('Not logged in') || error.includes('Invalid credentials')) {
            errorMessage = "❌ Invalid or expired appstate. Please get fresh cookies from Facebook.";
          } else if (error.includes('checkpoint')) {
            errorMessage = "⚠️ Account is in checkpoint. Please login to Facebook first and solve any verifications.";
          } else if (error.includes('suspended') || error.includes('locked')) {
            errorMessage = "🔒 Account appears to be locked. Please check your Facebook account.";
          } else {
            errorMessage = `❌ Login error: ${error}`;
          }
        } else if (error.message) {
          if (error.message.includes('Not logged in') || error.message.includes('Invalid credentials')) {
            errorMessage = "❌ Invalid or expired appstate. Please get fresh cookies from Facebook.";
          } else if (error.message.includes('checkpoint')) {
            errorMessage = "⚠️ Account is in checkpoint. Please login to Facebook first.";
          } else if (error.message.includes('suspended') || error.message.includes('locked')) {
            errorMessage = "🔒 Account appears to be locked. Please check your Facebook account.";
          } else {
            errorMessage = `❌ Login error: ${error.message}`;
          }
        }
        
        reject(new Error(errorMessage));
        return;
      }

      if (!api) {
        reject(new Error("❌ Login returned no API object"));
        return;
      }

      try {
        const userid = await api.getCurrentUserID();
        console.log(chalk.green(`[LOGIN] Logged in successfully. User ID: ${userid}`));

        // Add user to history
        await addThisUser(userid, enableCommands, state, prefix, admin);

        // Get user info
        try {
          const userInfo = await getUserInfo(api, userid);
          
          if (userInfo && userInfo[userid]) {
            const { name, profileUrl, thumbSrc } = userInfo[userid];
            
            // Get existing time from history
            const historyData = JSON.parse(fs.readFileSync('./data/history.json', 'utf-8'));
            const userHistory = historyData.find(user => user.userid === userid) || {};
            let time = userHistory.time || 0;
            
            Utils.account.set(userid, {
              name: name || "Unknown",
              profileUrl: profileUrl || "",
              thumbSrc: thumbSrc || "",
              time: time
            });

            // Start time counter
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
              } catch (err) {
                clearInterval(intervalId);
              }
            }, 1000);

          } else {
            console.log(chalk.yellow(`[LOGIN] Could not fetch user info for ${userid}, but login successful`));
            Utils.account.set(userid, {
              name: "Unknown",
              profileUrl: "",
              thumbSrc: "",
              time: 0
            });
          }
        } catch (infoError) {
          console.log(chalk.yellow(`[LOGIN] Error fetching user info: ${infoError.message}`));
          // Still consider login successful
          Utils.account.set(userid, {
            name: "Unknown",
            profileUrl: "",
            thumbSrc: "",
            time: 0
          });
        }

        // Set API options
        api.setOptions({
          listenEvents: config[0]?.fcaOption?.listenEvents || true,
          logLevel: config[0]?.fcaOption?.logLevel || "silent",
          updatePresence: config[0]?.fcaOption?.updatePresence || false,
          selfListen: config[0]?.fcaOption?.selfListen || false,
          forceLogin: config[0]?.fcaOption?.forceLogin || false,
          online: config[0]?.fcaOption?.online || false,
          autoMarkDelivery: config[0]?.fcaOption?.autoMarkDelivery || false,
          autoMarkRead: config[0]?.fcaOption?.autoMarkRead || false,
        });

        // Start MQTT listener
        try {
          const listenEmitter = await api.listenMqtt(async (listenError, event) => {
            if (listenError) {
              console.error(`[MQTT] Listener error for user ${userid}:`, listenError);
              return;
            }

            if (!isMessageEvent(event) || !event.body) {
              return;
            }

            console.log(`[MQTT] ${event.senderID} -> ${event.threadID}: ${event.body}`);

            // Process command
            await processCommand(api, event, userid, enableCommands, prefix, admin);
          });

          if (listenEmitter && typeof listenEmitter.on === "function") {
            listenEmitter.on("error", (listenerError) => {
              console.error(`[MQTT] Listener emitter error for user ${userid}:`, listenerError);
            });
          }

          console.log(chalk.green(`[MQTT] Listener started for user ${userid}`));
          resolve();

        } catch (listenError) {
          console.error(`[MQTT] Failed to start listener for user ${userid}:`, listenError);
          // Still resolve because login was successful
          resolve();
        }

      } catch (error) {
        console.error(chalk.red('[LOGIN] Error after login:'), error);
        reject(new Error(`❌ Login succeeded but encountered error: ${error.message}`));
      }
    });
  });
}

async function processCommand(api, event, userid, enableCommands, prefix, admin) {
  try {
    // Get database and other data
    let database = fs.existsSync('./data/database.json') 
      ? JSON.parse(fs.readFileSync('./data/database.json', 'utf8')) 
      : await createDatabase();
    
    let data = Array.isArray(database) 
      ? database.find(item => Object.keys(item)[0] === event?.threadID) 
      : {};
    
    let adminIDS = data ? database : await createThread(event.threadID, api);
    
    const historyData = JSON.parse(fs.readFileSync('./data/history.json', 'utf-8'));
    const userHistory = historyData.find(blacklist => blacklist.userid === userid) || {};
    let blacklist = userHistory.blacklist || [];

    // Parse command
    const matchedCommand = aliases(event.body?.toLowerCase().split(/ +/)[0]?.replace(prefix, ''));
    const hasPrefix = event.body.startsWith(prefix);
    
    if (!hasPrefix && matchedCommand?.hasPrefix === true) {
      return; // Command requires prefix but none provided
    }

    if (hasPrefix) {
      const [command, ...args] = event.body.slice(prefix.length).trim().split(/\s+/);
      const cmd = aliases(command.toLowerCase());

      if (!cmd) {
        // Unknown command
        return;
      }

      // Check permissions
      const role = cmd.role || 0;
      const isAdmin = config?.[0]?.masterKey?.admin?.includes(event.senderID) || admin.includes(event.senderID);
      const isThreadAdmin = isAdmin || ((Array.isArray(adminIDS) ? adminIDS.find(admin => Object.keys(admin)[0] === event.threadID) : {})?.[event.threadID] || []).some(a => a.id === event.senderID);

      if ((role == 1 && !isAdmin) || (role == 2 && !isThreadAdmin) || (role == 3 && !config?.[0]?.masterKey?.admin?.includes(event.senderID))) {
        await sendReply(api, `❌ You don't have permission to use this command.`, event.threadID, event.messageID);
        return;
      }

      // Check blacklist
      if (blacklist.includes(event.senderID)) {
        await sendReply(api, "⛔ You are banned from using this bot.", event.threadID, event.messageID);
        return;
      }

      // Check cooldown
      const now = Date.now();
      const cooldownKey = `${event.senderID}_${cmd.name}_${userid}`;
      const lastUse = Utils.cooldowns.get(cooldownKey);
      const cooldownTime = (cmd.cooldown || 5) * 1000;

      if (lastUse && (now - lastUse.timestamp) < cooldownTime) {
        const remaining = Math.ceil((cooldownTime - (now - lastUse.timestamp)) / 1000);
        await sendReply(api, `⏱️ Please wait ${remaining} seconds before using "${cmd.name}" again.`, event.threadID, event.messageID);
        return;
      }

      Utils.cooldowns.set(cooldownKey, { timestamp: now, command: cmd.name });

      // Execute command
      try {
        await cmd.run({
          api,
          event,
          args,
          enableCommands,
          admin,
          prefix,
          blacklist,
          Utils,
          getUserInfo: (uid) => getUserInfo(api, uid),
          sendReply: (msg, tid, mid) => sendReply(api, msg, tid, mid),
          rootDir: __dirname
        });
      } catch (cmdError) {
        console.error(`[COMMAND] Error in ${cmd.name}:`, cmdError);
        await sendReply(api, `❌ Command error: ${cmdError.message || 'Unknown error'}`, event.threadID, event.messageID);
      }
    }

    // Handle events
    for (const { handleEvent, name } of Utils.handleEvent.values()) {
      if (handleEvent && name) {
        try {
          handleEvent({
            api,
            event,
            enableCommands,
            admin,
            prefix,
            blacklist,
            getUserInfo: (uid) => getUserInfo(api, uid),
            sendReply: (msg, tid, mid) => sendReply(api, msg, tid, mid)
          });
        } catch (eventError) {
          console.error(`[EVENT] Error in handleEvent ${name}:`, eventError);
        }
      }
    }

  } catch (error) {
    console.error('[PROCESS] Error processing command:', error);
  }
}

async function deleteThisUser(userid) {
  const configFile = './data/history.json';
  let config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  const sessionFile = path.join('./data/session', `${userid}.json`);
  const index = config.findIndex(item => item.userid === userid);
  
  if (index !== -1) config.splice(index, 1);
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  
  try {
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
  } catch (error) {
    console.log(error);
  }
}

async function addThisUser(userid, enableCommands, state, prefix, admin, blacklist = []) {
  const configFile = './data/history.json';
  const sessionFolder = './data/session';
  const sessionFile = path.join(sessionFolder, `${userid}.json`);
  
  if (fs.existsSync(sessionFile)) return;
  
  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
  }
  
  let config = [];
  if (fs.existsSync(configFile)) {
    config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
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
  
  const aliases = Array.from(Utils.commands.entries()).find(([aliases]) => 
    aliases.some(a => a?.toLowerCase() === command?.toLowerCase())
  );
  
  if (aliases) {
    return aliases[1];
  }
  return null;
}

async function main() {
  // Create necessary directories
  const dirs = [
    './data',
    './data/session',
    './script',
    './script/cache',
    './public'
  ];
  
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  
  // Create history.json if not exists
  const historyFile = './data/history.json';
  if (!fs.existsSync(historyFile)) {
    fs.writeFileSync(historyFile, '[]', 'utf-8');
  }
  
  // Create database.json if not exists
  const dbFile = './data/database.json';
  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, '[]', 'utf-8');
  }
  
  // Get config
  const adminOfConfig = fs.existsSync('./data/config.json') 
    ? JSON.parse(fs.readFileSync('./data/config.json', 'utf8')) 
    : createConfig();
  
  // Schedule auto-restart
  const restartTime = adminOfConfig[0]?.masterKey?.restartTime || 15;
  cron.schedule(`*/${restartTime} * * * *`, async () => {
    console.log(chalk.yellow('[CRON] Performing scheduled restart...'));
    
    const history = JSON.parse(fs.readFileSync('./data/history.json', 'utf-8'));
    history.forEach(user => {
      if (!user || typeof user !== 'object') return;
      if (user.time === undefined || user.time === null || isNaN(user.time)) return;
      
      const update = Utils.account.get(user.userid);
      if (update) user.time = update.time;
    });
    
    await empty.emptyDir('./script/cache');
    await fs.writeFileSync('./data/history.json', JSON.stringify(history, null, 2));
    
    console.log(chalk.yellow('[CRON] Restarting process...'));
    process.exit(1);
  });
  
  // Auto-login saved sessions
  try {
    const sessionFolder = './data/session';
    if (fs.existsSync(sessionFolder)) {
      const sessionFiles = fs.readdirSync(sessionFolder);
      console.log(chalk.cyan(`[BOOT] Found ${sessionFiles.length} saved sessions`));
      
      const history = JSON.parse(fs.readFileSync('./data/history.json', 'utf-8'));
      
      for (const file of sessionFiles) {
        const filePath = path.join(sessionFolder, file);
        try {
          const userId = path.parse(file).name;
          const userConfig = history.find(item => item.userid === userId);
          
          if (!userConfig) {
            console.log(chalk.yellow(`[BOOT] No config found for user ${userId}, skipping...`));
            continue;
          }
          
          const { enableCommands, prefix, admin, blacklist } = userConfig;
          const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          
          if (enableCommands) {
            console.log(chalk.cyan(`[BOOT] Auto-logging user ${userId}...`));
            accountLogin(state, enableCommands, prefix, admin, blacklist).catch(err => {
              console.error(chalk.red(`[BOOT] Auto-login failed for ${userId}:`), err.message);
            });
          }
        } catch (error) {
          console.error(chalk.red(`[BOOT] Failed to auto-login user from ${file}:`), error.message);
        }
      }
    }
  } catch (error) {
    console.error(chalk.red('[BOOT] Error in auto-login process:'), error);
  }
  
  console.log(chalk.green('[BOOT] Bot initialization complete'));
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
      selfListen: true,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      online: true,
      autoMarkDelivery: false,
      autoMarkRead: false
    }
  }];
  
  fs.writeFileSync('./data/config.json', JSON.stringify(config, null, 2));
  return config;
}

async function createThread(threadID, api) {
  try {
    const database = JSON.parse(fs.readFileSync('./data/database.json', 'utf8'));
    let threadInfo = await api.getThreadInfo(threadID);
    let adminIDs = threadInfo ? threadInfo.adminIDs : [];
    
    const data = {};
    data[threadID] = adminIDs;
    database.push(data);
    
    await fs.writeFileSync('./data/database.json', JSON.stringify(database, null, 2), 'utf-8');
    return database;
  } catch (error) {
    console.log(error);
  }
}

async function createDatabase() {
  const database = './data/database.json';
  if (!fs.existsSync(database)) {
    fs.writeFileSync(database, JSON.stringify([]));
  }
  return database;
}

// Start the bot
main();