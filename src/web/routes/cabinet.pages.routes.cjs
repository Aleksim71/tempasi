/* eslint-env node */
'use strict';

const express = require('express');
const entitlementsCabinetService = require('../../modules/payments/entitlements.cabinet.service.cjs');

function requireAuthPage(req, res, next) {
  if (req.user && req.user.id) return next();
  return res.redirect('/login');
}

const SPACES = [
  { key: 'cases', label: 'Cases', href: '/cabinet?space=cases' },
  { key: 'my-templates', label: 'My Templates', href: '/cabinet?space=my-templates' },
  { key: 'finance', label: 'Finance', href: '/cabinet?space=finance' },
  { key: 'profile-security', label: 'Profile & Security', href: '/cabinet?space=profile-security' },
  { key: 'support', label: 'Support', href: '/cabinet?space=support' },
];

function resolveWorkspacePartial(spaceKey) {
  const map = {
    cases: 'space-cases',
    'my-templates': 'space-my-templates',
    finance: 'space-finance',
    'profile-security': 'space-profile-security',
    support: 'space-support',
  };
  return map[spaceKey] || map.cases;
}

function createCabinetPagesRouter() {
  const router = express.Router();

  router.get('/', requireAuthPage, async (req, res, next) => {
    try {
      const space = String(req.query.space || 'cases');
      const activeSpace = SPACES.some((s) => s.key === space) ? space : 'cases';
      const workspacePartial = resolveWorkspacePartial(activeSpace);

      const userId = req.user.id;

      let workspaceData = {};
      let workspaceStats = {};
      let workspaceError = null;

      if (activeSpace === 'my-templates') {
        try {
          const { items, stats } = await entitlementsCabinetService.getMyTemplatesWorkspace(userId);
          workspaceData = { items };
          workspaceStats = { activeEntitlements: stats.active_entitlements };
        } catch (e) {
          // ✅ fail-open: do not crash the whole app
          workspaceError = {
            message: e && e.message ? e.message : 'Unknown error',
          };
          workspaceData = { items: [] };
          workspaceStats = { activeEntitlements: 0 };
        }
      }

      return res.status(200).render('pages/cabinet/index', {
        pageTitle: 'Cabinet',
        spaces: SPACES,
        activeSpace,
        workspacePartial,
        workspaceData,
        workspaceStats,
        workspaceError,
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createCabinetPagesRouter };
