"use strict";

const utils = require('../../../utils');
// @NethWs3Dev

const allowedProperties = {
  attachment: true,
  url: true,
  sticker: true,
  emoji: true,
  emojiSize: true,
  body: true,
  mentions: true,
  location: true,
};

module.exports = (defaultFuncs, api, ctx) => {
  function invokeCallback(callback, error, data) {
    if (typeof callback === "function") {
      callback(error, data);
    }
  }

  async function uploadAttachment(attachments) {
    const uploads = [];
    for (let i = 0; i < attachments.length; i++) {
     if (!utils.isReadableStream(attachments[i])) {
        throw new Error("Attachment should be a readable stream and not " + utils.getType(attachments[i]) + ".");
     }
     const oksir = await defaultFuncs.postFormData("https://upload.facebook.com/ajax/mercury/upload.php", ctx.jar,{
       upload_1024: attachments[i]
     }, {}).then(utils.parseAndCheckLogin(ctx, defaultFuncs));
     if (oksir.error) {
       throw new Error(oksir.error);
     }
     if (oksir.payload && oksir.payload.metadata && oksir.payload.metadata[0]) {
       uploads.push(oksir.payload.metadata[0]);
     }
    }
    return uploads;
  }

  async function getUrl(url) {
    const resData = await defaultFuncs.post("https://www.facebook.com/message_share_attachment/fromURI/", ctx.jar, {
      image_height: 960,
      image_width: 960,
      uri: url
    }).then(utils.parseAndCheckLogin(ctx, defaultFuncs));
    if (!resData || resData.error || !resData.payload){
        throw new Error(resData);
    }
  }

  async function sendContent(form, threadID, isSingleUser, messageAndOTID, _callback) {
    // There are three cases here:
    // 1. threadID is of type array, where we're starting a new group chat with users
    //    specified in the array.
    // 2. User is sending a message to a specific user.
    // 3. No additional form params and the message goes to an existing group chat.
    if (utils.getType(threadID) === "Array") {
      for (let i = 0; i < threadID.length; i++) {
        form["specific_to_list[" + i + "]"] = "fbid:" + threadID[i];
      }
      form["specific_to_list[" + threadID.length + "]"] = "fbid:" + ctx.userID;
      form["client_thread_id"] = "root:" + messageAndOTID;
      utils.log("sendMessage", "Sending message to multiple users: " + threadID);
    } else {
      // This means that threadID is the id of a user, and the chat
      // is a single person chat
      if (isSingleUser) {
        form["specific_to_list[0]"] = "fbid:" + threadID;
        form["specific_to_list[1]"] = "fbid:" + ctx.userID;
        form["other_user_fbid"] = threadID;
      } else {
        form["thread_fbid"] = threadID;
      }
    }

    if (ctx.globalOptions.pageID) {
      form["author"] = "fbid:" + ctx.globalOptions.pageID;
      form["specific_to_list[1]"] = "fbid:" + ctx.globalOptions.pageID;
      form["creator_info[creatorID]"] = ctx.userID;
      form["creator_info[creatorType]"] = "direct_admin";
      form["creator_info[labelType]"] = "sent_message";
      form["creator_info[pageID]"] = ctx.globalOptions.pageID;
      form["request_user_id"] = ctx.globalOptions.pageID;
      form["creator_info[profileURI]"] =
        "https://www.facebook.com/profile.php?id=" + ctx.userID;
    }

    const resData = await defaultFuncs.post("https://www.facebook.com/messaging/send/", ctx.jar, form).then(utils.parseAndCheckLogin(ctx, defaultFuncs));
    if (!resData) {
      throw new Error("Send message failed.");
    }
    if (resData.error) {
      if (resData.error === 1545012) {
        utils.warn("sendMessage [HTTP]", `Got error 1545012. Bot is not part of the conversation ${threadID}`);
        return null;
      }
      if (resData.transientError) {
        utils.warn("sendMessage [HTTP]", `Transient error ${resData.error}: ${resData.errorDescription || 'Temporary failure'} (thread: ${threadID})`);
        return null;
      }
      throw new Error(`Send message failed with error code ${resData.error}: ${JSON.stringify(resData)}`);
    }
    const messageInfo = resData.payload.actions.reduce((p, v) => {
        return { threadID: v.thread_fbid, messageID: v.message_id, timestamp: v.timestamp } || p;
    }, null);
    return messageInfo;
  }

  async function sendWithThreadGuess(form, threadID, isSingleUser, messageAndOTID, callback) {
    try {
      const result = await sendContent(form, threadID, isSingleUser, messageAndOTID);

      if (result === null) {
        throw new Error("Handled error (1545012/transient)");
      }

      invokeCallback(callback, null, result);
      return result;
    } catch (err) {
      utils.warn(`[DEBUG-SEND] Send FAILED (${err.message}). RETRYING with swapped thread type...`);
      utils.warn(`[DEBUG-SEND] Old isSingleUser: ${isSingleUser} -> New isSingleUser: ${!isSingleUser}`);

      isSingleUser = !isSingleUser;

      delete form["specific_to_list[0]"];
      delete form["specific_to_list[1]"];
      delete form["other_user_fbid"];
      delete form["thread_fbid"];

      if (ctx.threadTypeCache) {
        ctx.threadTypeCache[threadID] = !isSingleUser;
      }

      try {
        const retryResult = await sendContent(form, threadID, isSingleUser, messageAndOTID);
        if (retryResult === null) throw new Error("Retry failed with handled error");
        invokeCallback(callback, null, retryResult);
        return retryResult;
      } catch (retryErr) {
        utils.error("sendMessage [HTTP]", "Retry failed:", retryErr.message);
        invokeCallback(callback, retryErr);
        if (err.message === "Handled error (1545012/transient)") {
             throw new Error("SendMessage failed (likely 1545012) even after retry.");
        }
        throw err;
      }
    }
  }

  async function sendMessageInternal(msg, threadID, replyToMessage, isSingleUser, callback, fallbackAttempted = false) {
    let prepared = null;

    try {
      if (ctx.globalOptions.logging) {
          utils.log(`[DEBUG-SEND] Request: threadID=${threadID}, isSingleUser=${isSingleUser}, msgType=${utils.getType(msg)}`);
      }
      const msgType = utils.getType(msg);
      const threadIDType = utils.getType(threadID);
      
      if (msgType !== "String" && msgType !== "Object") throw new Error("Message should be of type string or object and not " + msgType + ".");
      if (threadIDType !== "Array" && threadIDType !== "Number" && threadIDType !== "String") throw new Error("ThreadID should be of type number, string, or array and not " + threadIDType + ".");
      
      if (replyToMessage && typeof replyToMessage !== 'string') {
         if (typeof replyToMessage === 'boolean') {
             isSingleUser = replyToMessage;
             replyToMessage = null;
         } else {
             replyToMessage = null;
         }
      }

      const debugInfo = {
        msgPreview: typeof msg === 'string' ? msg.substring(0, 50) : (msg.body || '').substring(0, 50),
        threadID,
        method: 'HTTP'
      };
      utils.log("sendMessage [HTTP]", `Sending to thread ${threadID}: "${debugInfo.msgPreview}..."`);
      if (msgType === "String") {
        msg = { body: msg };
      }
      
      prepared = await utils.prepareMessageForSend(ctx, msg, {
        api,
        threadID,
        replyToMessage,
        transport: "http",
      });
      msg = prepared.message;

      if (isSingleUser === undefined || isSingleUser === null) {
        if (!ctx.threadTypeCache) {
          ctx.threadTypeCache = {};
        }
        
        if (ctx.threadTypeCache[threadID] !== undefined) {
          isSingleUser = !ctx.threadTypeCache[threadID];
        } else {
          try {
            const threadInfo = await api.getThreadInfo(threadID);
            const isGroup = threadInfo.isGroup || threadInfo.threadType === 2;
            ctx.threadTypeCache[threadID] = isGroup;
            isSingleUser = !isGroup;
          } catch (err) {
            const threadIDStr = threadID.toString();
            isSingleUser = threadIDStr.length < 19;
            utils.warn("sendMessage", "Could not determine thread type, guessing based on ID length");
          }
        }
      }
      const disallowedProperties = Object.keys(msg).filter(prop => !allowedProperties[prop]);
      if (disallowedProperties.length > 0) {
        throw new Error("Dissallowed props: `" + disallowedProperties.join(", ") + "`");
      }
      const messageAndOTID = utils.generateOfflineThreadingID();
      const form = {
        client: "mercury",
        action_type: "ma-type:user-generated-message",
        author: "fbid:" + ctx.userID,
        timestamp: Date.now(),
        timestamp_absolute: "Today",
        timestamp_relative: utils.generateTimestampRelative(),
        timestamp_time_passed: "0",
        is_unread: false,
        is_cleared: false,
        is_forward: false,
        is_filtered_content: false,
        is_filtered_content_bh: false,
        is_filtered_content_account: false,
        is_filtered_content_quasar: false,
        is_filtered_content_invalid_app: false,
        is_spoof_warning: false,
        source: "source:chat:web",
        "source_tags[0]": "source:chat",
        ...(msg.body && {
            body: msg.body
        }),
        html_body: false,
        ui_push_phase: "V3",
        status: "0",
        offline_threading_id: messageAndOTID,
        message_id: messageAndOTID,
        threading_id: utils.generateThreadingID(ctx.clientID),
        "ephemeral_ttl_mode:": "0",
        manual_retry_cnt: "0",
        has_attachment: !!(msg.attachment || msg.url || msg.sticker),
        signatureID: utils.getSignatureID(),
        ...(replyToMessage && {
            replied_to_message_id: replyToMessage
        })
      };

      if (msg.location) {
        if (!msg.location.latitude || !msg.location.longitude) throw new Error("location property needs both latitude and longitude");
        form["location_attachment[coordinates][latitude]"] = msg.location.latitude;
        form["location_attachment[coordinates][longitude]"] = msg.location.longitude;
        form["location_attachment[is_current_location]"] = !!msg.location.current;
      }
      if (msg.sticker) {
        form["sticker_id"] = msg.sticker;
      }
      if (msg.attachment) {
        const files = await uploadAttachment(utils.normalizeAttachmentArray(msg.attachment));
        files.forEach((file, index) => {
            if (file) {
              const type = Object.keys(file)[0];
              form[type + "s[" + index + "]"] = file[type];
            }
        }); 
      }
      if (msg.url) {
        form["shareable_attachment[share_type]"] = "100";
        const params = await getUrl(msg.url);
        form["shareable_attachment[share_params]"] = params;
      }
      if (msg.emoji) {
        if (!msg.emojiSize) {
          msg.emojiSize = "medium";
        }
        if (msg.emojiSize !== "small" && msg.emojiSize !== "medium" && msg.emojiSize !== "large") {
          throw new Error("emojiSize property is invalid");
        }
        if (form.body) {
          throw new Error("body must be empty when using emoji");
        }
        form.body = msg.emoji;
        form["tags[0]"] = "hot_emoji_size:" + msg.emojiSize;
      } 
      if (msg.mentions) {
        for (let i = 0; i < msg.mentions.length; i++) {
          const mention = msg.mentions[i];
          const tag = mention.tag;
          if (typeof tag !== "string") {
            throw new Error("Mention tags must be strings.");
          }
          const offset = msg.body.indexOf(tag, mention.fromIndex || 0);
          if (offset < 0) utils.warn("handleMention", 'Mention for "' + tag + '" not found in message string.');
          if (!mention.id) utils.warn("handleMention", "Mention id should be non-null.");
          const id = mention.id || 0;
          const emptyChar = '\u200E';
          form["body"] = emptyChar + msg.body;
          form["profile_xmd[" + i + "][offset]"] = offset + 1;
          form["profile_xmd[" + i + "][length]"] = tag.length;
          form["profile_xmd[" + i + "][id]"] = id;
          form["profile_xmd[" + i + "][type]"] = "p";
        }
      }

      return await sendWithThreadGuess(form, threadID, isSingleUser, messageAndOTID, callback);
    } catch (err) {
      if (!fallbackAttempted && utils.isAttachmentTooLargeError(err)) {
        const fallbackMessage = await utils.resolveUploadFallback(ctx, {
          api,
          error: err,
          message: msg,
          replyToMessage,
          threadID,
          transport: "http",
        });

        if (fallbackMessage) {
          return sendMessageInternal(fallbackMessage, threadID, replyToMessage, isSingleUser, callback, true);
        }
      }

      invokeCallback(callback, err);
      throw err;
    } finally {
      if (prepared) {
        await prepared.cleanup();
      }
    }
  }

  return async (msg, threadID, p3, p4, p5) => {
    let callback = null;
    let replyToMessage = null;
    let isSingleUser = null;

    if (typeof p3 === 'function') {
      callback = p3;
      replyToMessage = p4;
      isSingleUser = p5;
    } else {
      replyToMessage = p3;
      isSingleUser = p4;
    }

    const pending = sendMessageInternal(msg, threadID, replyToMessage, isSingleUser, callback);
    if (callback) {
      pending.catch(() => {});
      return;
    }
    return pending;
  };
};
