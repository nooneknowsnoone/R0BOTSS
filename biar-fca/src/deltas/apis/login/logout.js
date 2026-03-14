"use strict";
const utils = require('../../../utils');

module.exports = function (defaultFuncs, api, ctx) {
  async function cleanupResources() {
    try {
      // Disable auto-reconnect BEFORE disconnecting
      if (ctx.globalOptions) {
        ctx.globalOptions.autoReconnect = false;
      }

      // Clear presence interval
      if (ctx.presenceInterval) {
        clearInterval(ctx.presenceInterval);
        ctx.presenceInterval = null;
      }

      // Wait a moment for any pending MQTT operations to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Now disconnect MQTT client
      if (ctx.mqttClient) {
        try {
          utils.log("logout", "Disconnecting MQTT client...");
          
          // Remove all event listeners to prevent reconnection attempts
          if (typeof ctx.mqttClient.removeAllListeners === 'function') {
            ctx.mqttClient.removeAllListeners();
          }
          
          // Force close the connection
          ctx.mqttClient.end(true);
          ctx.mqttClient = null;
          
          utils.log("logout", "MQTT client disconnected.");
        } catch (mqttErr) {
          utils.log("logout", "Error disconnecting MQTT (non-critical): " + mqttErr.message);
        }
      }

      // Clear reconnect function
      if (ctx.reconnectMqtt) {
        ctx.reconnectMqtt = null;
      }

      ctx.loggedIn = false;
      ctx.mqttConnected = false;
      
      // Wait for MQTT to fully disconnect
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (cleanupErr) {
      utils.error("logout", "Error during cleanup:", cleanupErr.message);
    }
  }

  async function logoutViaAPI() {
    try {
      const logoutUrl = "https://www.facebook.com/logout.php";
      const logoutForm = {
        h: ctx.fb_dtsg || "",
        fb_dtsg: ctx.fb_dtsg || ""
      };

      await defaultFuncs.post(logoutUrl, ctx.jar, logoutForm);
      utils.log("logout", "Logged out via API method.");
      return true;
    } catch (err) {
      utils.log("logout", "API logout method failed:", err.message);
      return false;
    }
  }

  async function logoutViaClassic() {
    try {
      const form = { pmid: "0" };

      const resData = await defaultFuncs
        .post(
          "https://www.facebook.com/bluebar/modern_settings_menu/?help_type=364455653583099&show_contextual_help=1",
          ctx.jar,
          form,
        )
        .then(utils.parseAndCheckLogin(ctx, defaultFuncs));

      if (!resData || !resData.jsmods || !resData.jsmods.instances || !resData.jsmods.instances[0]) {
        utils.log("logout", "Classic logout: Session already logged out.");
        return false;
      }

      const elem = resData.jsmods.instances[0][2][0].find(v => v.value === "logout");
      if (!elem || !elem.markup || !elem.markup.__m) {
        utils.log("logout", "Classic logout: Could not find logout element.");
        return false;
      }
      
      const markupElement = resData.jsmods.markup ? resData.jsmods.markup.find(v => v && v[0] === elem.markup.__m) : null;
      if (!markupElement || !markupElement[1] || !markupElement[1].__html) {
        utils.log("logout", "Classic logout: Could not find markup.");
        return false;
      }
      
      const html = markupElement[1].__html;
      
      const logoutForm = {
        fb_dtsg: utils.getFrom(html, '"fb_dtsg" value="', '"'),
        ref: utils.getFrom(html, '"ref" value="', '"'),
        h: utils.getFrom(html, '"h" value="', '"'),
      };

      const logoutRes = await defaultFuncs
        .post("https://www.facebook.com/logout.php", ctx.jar, logoutForm)
        .then(utils.saveCookies(ctx.jar));

      if (logoutRes.headers && logoutRes.headers.location) {
        await defaultFuncs
          .get(logoutRes.headers.location, ctx.jar)
          .then(utils.saveCookies(ctx.jar));
      }
      
      utils.log("logout", "Logged out via classic method.");
      return true;
    } catch (err) {
      utils.log("logout", "Classic logout method failed:", err.message);
      return false;
    }
  }

  return async function logout() {
    try {
      if (!ctx || !ctx.jar) {
        utils.log("logout", "No active session to logout from.");
        if (ctx) ctx.loggedIn = false;
        return;
      }

      utils.log("logout", "Initiating logout sequence...");

      // Step 1: Cleanup all resources and disconnect MQTT
      utils.log("logout", "Step 1: Cleaning up resources...");
      await cleanupResources();

      // Step 2: Attempt logout
      utils.log("logout", "Step 2: Logging out from Facebook...");
      const apiSuccess = await logoutViaAPI();
      
      if (!apiSuccess) {
        const classicSuccess = await logoutViaClassic();
        
        if (!classicSuccess) {
          utils.log("logout", "All logout methods exhausted. Session cleaned up locally.");
        }
      }

      ctx.loggedIn = false;
      utils.log("logout", "Logout completed successfully.");

    } catch (err) {
      utils.error("logout", "Logout error:", err);
      
      await cleanupResources();
      
      if (ctx) ctx.loggedIn = false;
      utils.log("logout", "Session marked as logged out despite error.");
    }
  };
};
