const fs = require('fs');
const path = require('path');
const login = require('./biar-fca'); // ✅ CHANGED: from 'ws3-fca' to './biar-fca'
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
fs.readdirSync(script).forEach((file) => {
  const scripts = path.join(script, file);
  const stats = fs.statSync(scripts);
  if (stats.isDirectory()) {
    fs.readdirSync(scripts).forEach((file) => {
      try {
        const {
          config,
          run,
          handleEvent
        } = require(path.join(scripts, file));
        if (config) {
          const {
            name = [], role = '0', version = '1.0.0', hasPrefix = true, aliases = [], description = '', usage = '', credits = '', cooldown = '5'
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
        }
      } catch (error) {
        console.error(chalk.red(`Error installing command from file ${file}: ${error.message}`));
      }
    });
  } else {
    try {
      const {
        config,
        run,
        handleEvent
      } = require(scripts);
      if (config) {
        const {
          name = [], role = '0', version = '1.0.0', hasPrefix = true, aliases = [], description = '', usage = '', credits = '', cooldown = '5'
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
      }
    } catch (error) {
      console.error(chalk.red(`Error installing command from file ${file}: ${error.message}`));
    }
  }
});

// Express setup
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(express.json());

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
  res.json(JSON.parse(JSON.stringify(data, null, 2)));
});

app.get('/commands', (req, res) => {
  const command = new Set();
  const commands = [...Utils.commands.values()].map(({
    name
  }) => (command.add(name), name));
  const handleEvent = [...Utils.handleEvent.values()].map(({
    name
  }) => command.has(name) ? null : (command.add(name), name)).filter(Boolean);
  const role = [...Utils.commands.values()].map(({
    role
  }) => (command.add(role), role));
  const aliases = [...Utils.commands.values()].map(({
    aliases
  }) => (command.add(aliases), aliases));
  res.json(JSON.parse(JSON.stringify({
    commands,
    handleEvent,
    role,
    aliases
  }, null, 2)));
});

// Login endpoint
app.post('/login', async (req, res) => {
  const {
    state,
    commands,
    prefix,
    admin
  } = req.body;
  try {
    if (!state) {
      throw new Error('Missing app state data');
    }
    const cUser = state.find(item => item.key === 'c_user');
    if (cUser) {
      const existingUser = Utils.account.get(cUser.value);
      if (existingUser) {
        console.log(`User ${cUser.value} is already logged in`);
        return res.status(400).json({
          error: false,
          message: "Active user session detected; already logged in",
          user: existingUser
        });
      } else {
        try {
          await accountLogin(state, commands, prefix, [admin]);
          res.status(200).json({
            success: true,
            message: 'Authentication process completed successfully; login achieved.'
          });
        } catch (error) {
          console.error(error);
          res.status(400).json({
            error: true,
            message: error.message
          });
        }
      }
    } else {
      return res.status(400).json({
        error: true,
        message: "There's an issue with the appstate data; it's invalid."
      });
    }
  } catch (error) {
    return res.status(400).json({
      error: true,
      message: "There's an issue with the appstate data; it's invalid."
    });
  }
});

// Start server - FIXED port log
app.listen(3000, () => {
  console.log(`✅ Server is running at http://localhost:3000`); // Fixed: was showing 5000
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// Main account login function using biar-fca
async function accountLogin(state, enableCommands = [], prefix, admin = []) {
  return new Promise((resolve, reject) => {
    login({
      appState: state
    }, async (error, api) => {
      if (error) {
        console.error(chalk.red('❌ Login failed:'), error);
        reject(error);
        return;
      }

      console.log(chalk.green('✅ Facebook login successful via biar-fca!'));
      
      const userid = await api.getCurrentUserID();
      addThisUser(userid, enableCommands, state, prefix, admin);
      
      try {
        const userInfo = await api.getUserInfo(userid);
        if (!userInfo || !userInfo[userid]?.name || !userInfo[userid]?.profileUrl || !userInfo[userid]?.thumbSrc) 
          throw new Error('Unable to locate the account; it appears to be in a suspended or locked state.');
        
        const {
          name,
          profileUrl,
          thumbSrc
        } = userInfo[userid];
        
        let time = 0;
        try {
          time = (JSON.parse(fs.readFileSync('./data/history.json', 'utf-8')).find(user => user.userid === userid) || {}).time || 0;
        } catch (e) {
          // History might not exist yet
        }
        
        Utils.account.set(userid, {
          name,
          profileUrl,
          thumbSrc,
          time: time
        });
        
        const intervalId = setInterval(() => {
          try {
            const account = Utils.account.get(userid);
            if (!account) throw new Error('Account not found');
            Utils.account.set(userid, {
              ...account,
              time: account.time + 1
            });
          } catch (error) {
            clearInterval(intervalId);
            return;
          }
        }, 1000);
      } catch (error) {
        reject(error);
        return;
      }

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

      try {
        var listenEmitter = api.listenMqtt(async (error, event) => {
          if (error) {
            if (error === 'Connection closed.') {
              console.error(`Error during API listen: ${error}`, userid);
            }
            console.log(error);
            return;
          }

          // Skip if no event
          if (!event) return;

          // Load database
          let database = [];
          try {
            database = fs.existsSync('./data/database.json') ? 
              JSON.parse(fs.readFileSync('./data/database.json', 'utf8')) : 
              await createDatabase();
          } catch (e) {
            // Database might not exist
          }
          
          let data = Array.isArray(database) ? database.find(item => Object.keys(item)[0] === event?.threadID) : {};
          let adminIDS = data ? database : await createThread(event.threadID, api);
          
          // Load blacklist
          let blacklist = [];
          try {
            blacklist = (JSON.parse(fs.readFileSync('./data/history.json', 'utf-8')).find(blacklist => blacklist.userid === userid) || {}).blacklist || [];
          } catch (e) {
            // History might not exist
          }
          
          // Check if command needs prefix
          let hasPrefix = prefix;
          if (event.body) {
            const firstWord = (event.body || '')?.trim().toLowerCase().split(/ +/).shift();
            const cmdInfo = aliases(firstWord);
            if (cmdInfo && cmdInfo.hasPrefix === false) {
              hasPrefix = '';
            }
          }
          
          // Parse command
          let [command, ...args] = [];
          if (event.body && hasPrefix) {
            const bodyLower = event.body.trim().toLowerCase();
            if (bodyLower.startsWith(hasPrefix?.toLowerCase() || '')) {
              const parts = bodyLower.substring(hasPrefix?.length || 0).trim().split(/\s+/);
              command = parts[0];
              args = parts.slice(1);
            }
          }
          
          const matchedCommand = aliases(command);

          // Check if command doesn't need prefix but was used with one
          if (hasPrefix && matchedCommand && matchedCommand.hasPrefix === false) {
            api.sendMessage(`Invalid usage: the "${matchedCommand.name}" command doesn't need a prefix.`, event.threadID, event.messageID);
            return;
          }
          
          // Check permissions
          if (event.body && aliases(command)?.name) {
            const role = aliases(command)?.role ?? 0;
            const isAdmin = config?.[0]?.masterKey?.admin?.includes(event.senderID) || admin.includes(event.senderID);
            const isThreadAdmin = isAdmin || ((Array.isArray(adminIDS) ? adminIDS.find(admin => Object.keys(admin)[0] === event.threadID) : {})?.[event.threadID] || []).some(admin => admin.id === event.senderID);
            
            if ((role == 1 && !isAdmin) || (role == 2 && !isThreadAdmin) || (role == 3 && !config?.[0]?.masterKey?.admin?.includes(event.senderID))) {
              api.sendMessage(`You don't have permission to use this command.`, event.threadID, event.messageID);
              return;
            }
          }
          
          // Check blacklist
          if (event.body && event.body?.toLowerCase().startsWith(prefix?.toLowerCase() || '') && aliases(command)?.name) {
            if (blacklist.includes(event.senderID)) {
              api.sendMessage("We're sorry, but you've been banned from using bot. If you believe this is a mistake or would like to appeal, please contact one of the bot admins for further assistance.", event.threadID, event.messageID);
              return;
            }
          }
          
          // Check cooldown
          if (event.body && aliases(command)?.name) {
            const now = Date.now();
            const name = aliases(command)?.name;
            const sender = Utils.cooldowns.get(`${event.senderID}_${name}_${userid}`);
            const delay = aliases(command)?.cooldown ?? 0;
            if (!sender || (now - sender.timestamp) >= delay * 1000) {
              Utils.cooldowns.set(`${event.senderID}_${name}_${userid}`, {
                timestamp: now,
                command: name
              });
            } else {
              const active = Math.ceil((sender.timestamp + delay * 1000 - now) / 1000);
              api.sendMessage(`Please wait ${active} seconds before using the "${name}" command again.`, event.threadID, event.messageID);
              return;
            }
          }
          
          // Handle invalid prefix usage
          if (event.body && !command && event.body?.toLowerCase().startsWith(prefix?.toLowerCase() || '')) {
            api.sendMessage(`Invalid command please use ${prefix}help to see the list of available commands.`, event.threadID, event.messageID);
            return;
          }
          
          // Handle unknown command
          if (event.body && command && prefix && event.body?.toLowerCase().startsWith(prefix?.toLowerCase() || '') && !aliases(command)?.name) {
            api.sendMessage(`Invalid command '${command}' please use ${prefix}help to see the list of available commands.`, event.threadID, event.messageID);
            return;
          }
          
          // Handle events
          for (const {
              handleEvent,
              name
            } of Utils.handleEvent.values()) {
            if (handleEvent && name && (
                (enableCommands[1]?.handleEvent || []).includes(name) || (enableCommands[0]?.commands || []).includes(name))) {
              try {
                handleEvent({
                  api,
                  event,
                  enableCommands,
                  admin,
                  prefix,
                  blacklist
                });
              } catch (e) {
                console.error(`Error in handleEvent ${name}:`, e);
              }
            }
          }
          
          // Handle commands
          switch (event.type) {
            case 'message':
            case 'message_reply':
            case 'message_unsend':
            case 'message_reaction':
              if (enableCommands[0]?.commands?.includes(aliases(command?.toLowerCase())?.name)) {
                try {
                  await (aliases(command?.toLowerCase())?.run || (() => {}))({
                    api,
                    event,
                    args,
                    enableCommands,
                    admin,
                    prefix,
                    blacklist,
                    Utils,
                  });
                } catch (e) {
                  console.error(`Error running command ${command}:`, e);
                  api.sendMessage(`Error executing command: ${e.message}`, event.threadID);
                }
              }
              break;
          }
        });
      } catch (error) {
        console.error('Error during API listen, outside of listen', userid);
        Utils.account.delete(userid);
        deleteThisUser(userid);
        return;
      }
      resolve();
    });
  });
}

// Helper functions
async function deleteThisUser(userid) {
  const configFile = './data/history.json';
  let config = [];
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
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
  // Create folders if they don't exist
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  if (!fs.existsSync('./data/session')) fs.mkdirSync('./data/session', { recursive: true });
  
  const configFile = './data/history.json';
  const sessionFolder = './data/session';
  const sessionFile = path.join(sessionFolder, `${userid}.json`);
  
  // Don't add if session already exists
  if (fs.existsSync(sessionFile)) return;
  
  // Read or create config
  let config = [];
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  } catch (e) {
    config = [];
  }
  
  config.push({
    userid,
    prefix: prefix || "",
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
  
  const aliases = Array.from(Utils.commands.entries()).find(([commands]) => 
    commands.includes(command?.toLowerCase())
  );
  
  if (aliases) {
    return aliases[1];
  }
  return null;
}

async function main() {
  console.log(chalk.cyan('🚀 Starting biar-fca bot...'));
  
  const empty = require('fs-extra');
  const cacheFile = './script/cache';
  
  // Create necessary folders
  if (!fs.existsSync('./script')) fs.mkdirSync('./script', { recursive: true });
  if (!fs.existsSync(cacheFile)) fs.mkdirSync(cacheFile, { recursive: true });
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  
  const configFile = './data/history.json';
  if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, '[]', 'utf-8');
  
  let config = [];
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  } catch (e) {
    config = [];
  }
  
  const sessionFolder = path.join('./data/session');
  if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });
  
  const adminOfConfig = fs.existsSync('./data') && fs.existsSync('./data/config.json') ? 
    JSON.parse(fs.readFileSync('./data/config.json', 'utf8')) : 
    createConfig();

  // Schedule restart
  cron.schedule(`*/${adminOfConfig[0].masterKey.restartTime} * * * *`, async () => {
    console.log(chalk.yellow('🔄 Scheduled restart...'));
    try {
      const history = JSON.parse(fs.readFileSync('./data/history.json', 'utf-8'));
      history.forEach(user => {
        if (!user || typeof user !== 'object') return;
        const update = Utils.account.get(user.userid);
        if (update) user.time = update.time;
      });
      await empty.emptyDir(cacheFile);
      await fs.writeFileSync('./data/history.json', JSON.stringify(history, null, 2));
    } catch (e) {
      console.error('Error during restart prep:', e);
    }
    process.exit(1);
  });

  // Load saved sessions
  try {
    const sessions = fs.readdirSync(sessionFolder).filter(f => f.endsWith('.json'));
    console.log(chalk.cyan(`📁 Found ${sessions.length} saved session(s)`));
    
    for (const file of sessions) {
      const filePath = path.join(sessionFolder, file);
      try {
        const {
          enableCommands,
          prefix,
          admin,
          blacklist
        } = config.find(item => item.userid === path.parse(file).name) || {};
        const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (enableCommands) {
          console.log(chalk.cyan(`📱 Auto-logging: ${path.parse(file).name}`));
          await accountLogin(state, enableCommands, prefix, admin, blacklist);
        }
      } catch (error) {
        console.error(chalk.red(`❌ Failed to load session ${file}:`), error.message);
        deleteThisUser(path.parse(file).name);
      }
    }
  } catch (error) {
    console.error('Error loading sessions:', error);
  }
  
  console.log(chalk.green('✅ Bot is ready!'));
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
  
  const dataFolder = './data';
  if (!fs.existsSync(dataFolder)) fs.mkdirSync(dataFolder, { recursive: true });
  fs.writeFileSync('./data/config.json', JSON.stringify(config, null, 2));
  console.log(chalk.green('✅ Created default config.json'));
  return config;
}

async function createThread(threadID, api) {
  try {
    let database = [];
    try {
      database = JSON.parse(fs.readFileSync('./data/database.json', 'utf8'));
    } catch (e) {
      database = [];
    }
    
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
  const data = './data';
  const database = './data/database.json';
  
  if (!fs.existsSync(data)) {
    fs.mkdirSync(data, { recursive: true });
  }
  
  if (!fs.existsSync(database)) {
    fs.writeFileSync(database, JSON.stringify([]));
  }
  
  return database;
}

// Start the bot
main().catch(err => {
  console.error(chalk.red('❌ Fatal error:'), err);
  process.exit(1);
});