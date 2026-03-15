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

// Express routes
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
    const filePath = path.join(__dirname, 'public', route.file);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).send('File not found');
    }
  });
});

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

app.listen(3000, () => {
  console.log(chalk.green(`Server is running at http://localhost:3000`));
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
  return api.sendMessage(message, threadID, replyToMessageID);
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

    login({ appState: state }, loginOptions, async (error, api) => {
      if (error) {
        reject(error);
        return;
      }

      const userid = await api.getCurrentUserID();
      await addThisUser(userid, enableCommands, state, prefix, admin);

      try {
        const userInfo = await getUserInfo(api, userid);
        if (!userInfo || !userInfo[userid]?.name || !userInfo[userid]?.profileUrl || !userInfo[userid]?.thumbSrc) {
          throw new Error('Unable to locate the account; it appears to be in a suspended or locked state.');
        }
        
        const { name, profileUrl, thumbSrc } = userInfo[userid];
        const historyData = JSON.parse(fs.readFileSync('./data/history.json', 'utf-8'));
        const userHistory = historyData.find(user => user.userid === userid) || {};
        let time = userHistory.time || 0;
        
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
          }
        }, 1000);

      } catch (error) {
        reject(error);
        return;
      }

      api.setOptions({
        listenEvents: config[0].fcaOption.listenEvents,
        logLevel: config[0].fcaOption.logLevel,
        updatePresence: config[0].fcaOption.updatePresence,
        selfListen: config[0].fcaOption.selfListen,
        forceLogin: config[0].fcaOption.forceLogin,
        online: config[0].fcaOption.online,
        autoMarkDelivery: config[0].fcaOption.autoMarkDelivery,
        autoMarkRead: config[0].fcaOption.autoMarkRead,
        mqttReconnectPolicy: {
          clientReconnectPeriod: 0,
          initialRetryDelay: 2000,
          maxReconnectAttempts: 10,
          maxRetryDelay: 30000,
          periodicReconnect: false,
        },
      });

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

          let database = fs.existsSync('./data/database.json') ? JSON.parse(fs.readFileSync('./data/database.json', 'utf8')) : await createDatabase();
          let data = Array.isArray(database) ? database.find(item => Object.keys(item)[0] === event?.threadID) : {};
          let adminIDS = data ? database : await createThread(event.threadID, api);
          
          const historyData = JSON.parse(fs.readFileSync('./data/history.json', 'utf-8'));
          const userHistory = historyData.find(blacklist => blacklist.userid === userid) || {};
          let blacklist = userHistory.blacklist || [];
          
          let hasPrefix = (event.body && aliases((event.body || '')?.trim().toLowerCase().split(/ +/).shift())?.hasPrefix == false) ? '' : prefix;
          let [command, ...args] = ((event.body || '').trim().toLowerCase().startsWith(hasPrefix?.toLowerCase()) ? 
            (event.body || '').trim().substring(hasPrefix?.length).trim().split(/\s+/).map(arg => arg.trim()) : []);
          
          const matchedCommand = aliases(command);

          if (hasPrefix && matchedCommand && matchedCommand.hasPrefix === false) {
            await sendReply(api, `Invalid usage: the "${matchedCommand.name}" command doesn't need a prefix.`, event.threadID, event.messageID);
            return;
          }
          
          if (event.body && aliases(command)?.name) {
            const role = aliases(command)?.role ?? 0;
            const isAdmin = config?.[0]?.masterKey?.admin?.includes(event.senderID) || admin.includes(event.senderID);
            const isThreadAdmin = isAdmin || ((Array.isArray(adminIDS) ? adminIDS.find(admin => Object.keys(admin)[0] === event.threadID) : {})?.[event.threadID] || []).some(admin => admin.id === event.senderID);
            
            if ((role == 1 && !isAdmin) || (role == 2 && !isThreadAdmin) || (role == 3 && !config?.[0]?.masterKey?.admin?.includes(event.senderID))) {
              await sendReply(api, `You don't have permission to use this command.`, event.threadID, event.messageID);
              return;
            }
          }
          
          if (event.body && event.body?.toLowerCase().startsWith(prefix.toLowerCase()) && aliases(command)?.name) {
            if (blacklist.includes(event.senderID)) {
              await sendReply(api, "We're sorry, but you've been banned from using bot. If you believe this is a mistake or would like to appeal, please contact one of the bot admins for further assistance.", event.threadID, event.messageID);
              return;
            }
          }
          
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
              await sendReply(api, `Please wait ${active} seconds before using the "${name}" command again.`, event.threadID, event.messageID);
              return;
            }
          }
          
          if (event.body && !command && event.body?.toLowerCase().startsWith(prefix.toLowerCase())) {
            await sendReply(api, `Invalid command please use ${prefix}help to see the list of available commands.`, event.threadID, event.messageID);
            return;
          }
          
          if (event.body && command && prefix && event.body?.toLowerCase().startsWith(prefix.toLowerCase()) && !aliases(command)?.name) {
            await sendReply(api, `Invalid command '${command}' please use ${prefix}help to see the list of available commands.`, event.threadID, event.messageID);
            return;
          }
          
          // Handle events
          for (const { handleEvent, name } of Utils.handleEvent.values()) {
            if (handleEvent && name && (
                (enableCommands[1]?.handleEvent || []).includes(name) || (enableCommands[0]?.commands || []).includes(name))) {
              try {
                handleEvent({
                  api,
                  event,
                  enableCommands,
                  admin,
                  prefix,
                  blacklist,
                  getUserInfo: (userID) => getUserInfo(api, userID),
                  sendReply: (message, threadID, replyToMessageID) => sendReply(api, message, threadID, replyToMessageID)
                });
              } catch (error) {
                console.error(`[EVENT] Error in handleEvent ${name}:`, error);
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
                  const cmd = aliases(command?.toLowerCase());
                  if (cmd?.run) {
                    await cmd.run({
                      api,
                      event,
                      args,
                      enableCommands,
                      admin,
                      prefix,
                      blacklist,
                      Utils,
                      getUserInfo: (userID) => getUserInfo(api, userID),
                      sendReply: (message, threadID, replyToMessageID) => sendReply(api, message, threadID, replyToMessageID),
                      rootDir: __dirname
                    });
                  }
                } catch (error) {
                  console.error(`[COMMAND] Error executing command:`, error);
                  await sendReply(api, `Command failed: ${error.message || 'Unknown error'}`, event.threadID, event.messageID);
                }
              }
              break;
          }
        });

        if (listenEmitter && typeof listenEmitter.on === "function") {
          listenEmitter.on("error", (listenerError) => {
            console.error(`[MQTT] Listener emitter error for user ${userid}:`, listenerError);
          });
        }

        console.log(chalk.green(`[MQTT] Listener started for user ${userid}`));
      } catch (error) {
        console.error(`[MQTT] Failed to start listener for user ${userid}:`, error);
        Utils.account.delete(userid);
        await deleteThisUser(userid);
        return;
      }
      
      resolve();
    });
  });
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
  
  const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
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
    commands.some(cmd => cmd?.toLowerCase() === command?.toLowerCase())
  );
  
  if (aliases) {
    return aliases[1];
  }
  return null;
}

async function main() {
  const cacheFile = './script/cache';
  if (!fs.existsSync(cacheFile)) fs.mkdirSync(cacheFile, { recursive: true });
  
  const configFile = './data/history.json';
  if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, '[]', 'utf-8');
  
  const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  const sessionFolder = path.join('./data/session');
  
  if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });
  
  const adminOfConfig = fs.existsSync('./data') && fs.existsSync('./data/config.json') ? 
    JSON.parse(fs.readFileSync('./data/config.json', 'utf8')) : createConfig();
  
  // Schedule auto-restart
  cron.schedule(`*/${adminOfConfig[0].masterKey.restartTime} * * * *`, async () => {
    console.log(chalk.yellow('[CRON] Performing scheduled restart...'));
    
    const history = JSON.parse(fs.readFileSync('./data/history.json', 'utf-8'));
    history.forEach(user => {
      if (!user || typeof user !== 'object') return;
      if (user.time === undefined || user.time === null || isNaN(user.time)) return;
      
      const update = Utils.account.get(user.userid);
      if (update) user.time = update.time;
    });
    
    await empty.emptyDir(cacheFile);
    await fs.writeFileSync('./data/history.json', JSON.stringify(history, null, 2));
    
    console.log(chalk.yellow('[CRON] Restarting process...'));
    process.exit(1);
  });
  
  // Auto-login all saved sessions
  try {
    const sessionFiles = fs.readdirSync(sessionFolder);
    console.log(chalk.cyan(`[BOOT] Found ${sessionFiles.length} saved sessions`));
    
    for (const file of sessionFiles) {
      const filePath = path.join(sessionFolder, file);
      try {
        const userId = path.parse(file).name;
        const userConfig = config.find(item => item.userid === userId);
        
        if (!userConfig) {
          console.log(chalk.yellow(`[BOOT] No config found for user ${userId}, skipping...`));
          continue;
        }
        
        const { enableCommands, prefix, admin, blacklist } = userConfig;
        const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        if (enableCommands) {
          console.log(chalk.cyan(`[BOOT] Auto-logging user ${userId}...`));
          await accountLogin(state, enableCommands, prefix, admin, blacklist);
        }
      } catch (error) {
        console.error(chalk.red(`[BOOT] Failed to auto-login user from ${file}:`), error);
        await deleteThisUser(path.parse(file).name);
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
  
  const dataFolder = './data';
  if (!fs.existsSync(dataFolder)) fs.mkdirSync(dataFolder, { recursive: true });
  
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
main();