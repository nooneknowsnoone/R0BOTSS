"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { getType } = require("./constants");

const DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function getMaxAttachmentBytes(globalOptions = {}) {
  const value = Number(globalOptions.maxAttachmentBytes);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_ATTACHMENT_BYTES;
}

function getTempDir(globalOptions = {}) {
  return typeof globalOptions.tempDir === "string" && globalOptions.tempDir.trim()
    ? globalOptions.tempDir
    : os.tmpdir();
}

function normalizeAttachmentArray(attachment) {
  if (!attachment) {
    return [];
  }

  return Array.isArray(attachment) ? attachment.filter(Boolean) : [attachment];
}

function describeAttachment(attachment, index) {
  const description = {
    attachment,
    index,
    name: null,
    path: null,
    size: null,
    knownSize: false,
  };

  if (attachment && typeof attachment.path === "string") {
    description.path = attachment.path;
    description.name = path.basename(attachment.path);

    try {
      const stats = fs.statSync(attachment.path);
      if (stats.isFile()) {
        description.size = stats.size;
        description.knownSize = true;
      }
    } catch (_error) {
      // Ignore stat failures for streams backed by ephemeral paths.
    }
  }

  return description;
}

function createAttachmentTooLargeError(details = {}) {
  const maxAttachmentBytes = details.maxAttachmentBytes || DEFAULT_MAX_ATTACHMENT_BYTES;
  const attachment = details.attachments && details.attachments[0] ? details.attachments[0] : null;
  const attachmentSize = attachment && attachment.size ? attachment.size : null;
  const attachmentName = attachment && attachment.name ? attachment.name : "attachment";
  const actualSize = attachmentSize ? ` (${attachmentSize} bytes)` : "";
  const error = new Error(
    `${attachmentName}${actualSize} exceeds the attachment limit of ${maxAttachmentBytes} bytes.`,
  );

  error.code = "ATTACHMENT_TOO_LARGE";
  error.statusCode = 413;
  error.error = "Attachment upload too large.";
  error.details = details;

  return error;
}

function isAttachmentTooLargeError(error) {
  return Boolean(error && (error.code === "ATTACHMENT_TOO_LARGE" || error.statusCode === 413));
}

async function runCleanup(cleanups) {
  for (let index = cleanups.length - 1; index >= 0; index -= 1) {
    try {
      await cleanups[index]();
    } catch (_error) {
      // Cleanup should not mask the original send result.
    }
  }
}

function registerCleanup(cleanups, cleanup) {
  if (!cleanup) {
    return;
  }

  if (typeof cleanup === "function") {
    cleanups.push(cleanup);
    return;
  }

  if (typeof cleanup === "string") {
    cleanups.push(async () => {
      try {
        await fs.promises.unlink(cleanup);
      } catch (_error) {
        // Ignore unlink failures for already-removed temp files.
      }
    });
  }
}

async function runMediaPreprocessor(ctx, attachmentInfo, meta, cleanups) {
  const preprocessor = ctx.globalOptions.mediaPreprocessor;

  if (typeof preprocessor !== "function") {
    return attachmentInfo;
  }

  const result = await preprocessor({
    ...attachmentInfo,
    ...meta,
    tempDir: getTempDir(ctx.globalOptions),
  });

  if (result == null) {
    return null;
  }

  const nextAttachment = result.attachment !== undefined ? result.attachment : result;
  registerCleanup(cleanups, result.cleanup);
  registerCleanup(cleanups, result.tempPath);

  return describeAttachment(nextAttachment, attachmentInfo.index);
}

async function prepareMessageForSend(ctx, msg, meta = {}) {
  const cleanups = [];

  if (getType(msg) !== "Object" || !msg.attachment) {
    return {
      message: msg,
      attachmentInfo: [],
      cleanup: async () => runCleanup(cleanups),
    };
  }

  const attachments = normalizeAttachmentArray(msg.attachment);
  const preparedAttachments = [];

  for (let index = 0; index < attachments.length; index += 1) {
    const describedAttachment = describeAttachment(attachments[index], index);
    const processedAttachment = await runMediaPreprocessor(ctx, describedAttachment, meta, cleanups);

    if (processedAttachment) {
      preparedAttachments.push(processedAttachment);
    }
  }

  const preparedMessage = { ...msg };
  if (preparedAttachments.length > 0) {
    preparedMessage.attachment = preparedAttachments.map((entry) => entry.attachment);
  } else {
    delete preparedMessage.attachment;
  }

  const maxAttachmentBytes = getMaxAttachmentBytes(ctx.globalOptions);
  const oversized = preparedAttachments.filter((attachment) => attachment.knownSize && attachment.size > maxAttachmentBytes);

  if (oversized.length > 0) {
    throw createAttachmentTooLargeError({
      attachments: oversized,
      maxAttachmentBytes,
      message: preparedMessage,
      ...meta,
    });
  }

  return {
    message: preparedMessage,
    attachmentInfo: preparedAttachments,
    cleanup: async () => runCleanup(cleanups),
  };
}

async function resolveUploadFallback(ctx, details) {
  const strategy = ctx.globalOptions.uploadFallback;

  if (!strategy || strategy === "error") {
    return null;
  }

  if (typeof strategy === "function") {
    return strategy({
      ...details,
      tempDir: getTempDir(ctx.globalOptions),
    });
  }

  if (strategy === "remove_attachments") {
    const message = getType(details.message) === "Object" ? { ...details.message } : { body: "" };
    delete message.attachment;

    if (!message.body) {
      message.body = details.error && details.error.message
        ? details.error.message
        : "Attachment was removed before sending.";
    }

    return message;
  }

  return null;
}

module.exports = {
  createAttachmentTooLargeError,
  getMaxAttachmentBytes,
  getTempDir,
  isAttachmentTooLargeError,
  normalizeAttachmentArray,
  prepareMessageForSend,
  registerCleanup,
  resolveUploadFallback,
  runCleanup,
};
