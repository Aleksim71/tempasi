// src/modules/profile/profile.api.routes.cjs
'use strict';

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const { requireAuth } = require('../../middlewares/auth.middleware.cjs');
const {
  changeMyPasswordJson,
  getMyDownloadsJson,
  getMyProfileJson,
  updateMyProfileJson,
  uploadMyAvatarJson,
} = require('./profile.controller.cjs');

// TEMPASI_AVATAR_UPLOAD_DIR (2026-08-04)
// Same resolution pattern as TEMPLATE_UPLOAD_DIR in
// cabinet.pages.routes.cjs: throw at boot if explicitly configured
// but missing (likely an unmounted volume), else default to a local
// folder.
let AVATAR_UPLOAD_DIR;
const configuredAvatarDir = process.env.AVATAR_UPLOAD_DIR;

if (configuredAvatarDir) {
  AVATAR_UPLOAD_DIR = path.resolve(configuredAvatarDir);

  if (!fs.existsSync(AVATAR_UPLOAD_DIR)) {
    throw new Error(
      [
        'AVATAR_UPLOAD_DIR_NOT_FOUND:',
        `Path does not exist: ${AVATAR_UPLOAD_DIR}`,
        'If you use sshfs, mount it first (e.g., /mnt/tempasi/avatars).',
      ].join('\n'),
    );
  }
} else {
  AVATAR_UPLOAD_DIR = path.join(__dirname, '../../../uploads/avatars');
  if (!fs.existsSync(AVATAR_UPLOAD_DIR)) {
    fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
  }
}

console.log('[UPLOAD] AVATAR_UPLOAD_DIR =', process.env.AVATAR_UPLOAD_DIR || '(not set)');
console.log('[UPLOAD] Using AVATAR_UPLOAD_DIR =', AVATAR_UPLOAD_DIR);

const AVATAR_MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function getAvatarUploadUserId(req) {
  return (
    req?.user?.id ??
    req?.user?.user_id ??
    req?.user?.userId ??
    req?.userId ??
    req?.session?.userId ??
    req?.session?.user_id ??
    'unknown'
  );
}

const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const userId = getAvatarUploadUserId(req);
    const dir = path.join(AVATAR_UPLOAD_DIR, String(userId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = AVATAR_MIME_TO_EXT[file.mimetype] || 'jpg';
    cb(null, `avatar.${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: function (req, file, cb) {
    if (AVATAR_MIME_TO_EXT[file.mimetype]) return cb(null, true);
    return cb(new Error('ONLY_IMAGE_ALLOWED'));
  },
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
});

function profileApiRoutes() {
  const router = express.Router();

  router.get('/', requireAuth, async (req, res, next) => {
    try {
      return await getMyProfileJson(req, res);
    } catch (e) {
      return next(e);
    }
  });

  router.post('/', requireAuth, express.json(), async (req, res, next) => {
    try {
      return await updateMyProfileJson(req, res);
    } catch (e) {
      return next(e);
    }
  });

  router.post('/password', requireAuth, express.json(), async (req, res, next) => {
    try {
      return await changeMyPasswordJson(req, res);
    } catch (e) {
      return next(e);
    }
  });

  router.post('/avatar', requireAuth, function (req, res, next) {
    avatarUpload.single('avatar')(req, res, function (err) {
      if (err) {
        if (err.message === 'ONLY_IMAGE_ALLOWED') {
          return res.status(400).json({ ok: false, error: 'ONLY_IMAGE_ALLOWED' });
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ ok: false, error: 'AVATAR_TOO_LARGE' });
        }
        return next(err);
      }
      return next();
    });
  }, async (req, res, next) => {
    try {
      return await uploadMyAvatarJson(req, res);
    } catch (e) {
      return next(e);
    }
  });

  router.get('/downloads', requireAuth, async (req, res, next) => {
    try {
      return await getMyDownloadsJson(req, res);
    } catch (e) {
      return next(e);
    }
  });

  return router;
}

module.exports = { profileApiRoutes };
