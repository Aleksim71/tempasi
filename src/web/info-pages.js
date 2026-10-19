// src/web/info-pages.js
// Single source of truth for the public info section (footer info pages).
// Drives both route registration (web.routes.js) and the left sidebar
// (partials/info-sidebar.hbs). Adding a page = one entry here + its view.

export const INFO_GROUPS = [
  {
    title: 'About',
    pages: [
      {
        key: 'about',
        path: '/about',
        view: 'pages/static/about',
        title: 'About',
        label: 'About',
        meta: 'Tempasi',
      },
      {
        key: 'functionality',
        path: '/functionality',
        view: 'pages/static/functionality',
        title: 'How Tempasi works',
        label: 'How it works',
        meta: 'Guide',
      },
      // Same content as the standalone ad page /landing (shared partial
      // landing-content.hbs), but rendered inside the site chrome + info
      // sidebar. /landing itself stays header-less for ad traffic.
      {
        key: 'offers',
        path: '/offers',
        view: 'pages/static/offers',
        title: 'Offers — for studios and designers',
        label: 'Offers',
        meta: 'Studios & designers',
        styles: ['/css/pages/landing.css'],
      },
    ],
  },
  {
    title: 'Legal',
    pages: [
      // Provider identification (§ 5 DDG). Structural placeholder until
      // real details (name, address, contact) are supplied.
      {
        key: 'impressum',
        path: '/impressum',
        view: 'pages/static/impressum',
        title: 'Impressum',
        label: 'Impressum',
        meta: '§ 5 DDG',
      },
      // Template usage rights (Buy/Rent). Real first draft, marked
      // "pending legal review", one open business decision flagged.
      {
        key: 'license',
        path: '/license',
        view: 'pages/static/license',
        title: 'Template License',
        label: 'License',
        meta: 'Buy / Rent',
      },
      // Documents the single first-party session cookie (sid); no
      // analytics/marketing cookies exist in the codebase.
      {
        key: 'cookies',
        path: '/cookies',
        view: 'pages/static/cookies',
        title: 'Cookie Policy',
        label: 'Cookies',
        meta: 'Session',
      },
    ],
  },
  {
    title: 'Support',
    pages: [
      // Public FAQ: single source of truth (cabinet Support links here).
      {
        key: 'faq',
        path: '/faq',
        view: 'pages/static/faq',
        title: 'FAQ',
        label: 'FAQ',
        meta: 'Help',
      },
      {
        key: 'contact',
        path: '/contact',
        view: 'pages/static/contact',
        title: 'Contact',
        label: 'Contact',
        meta: 'Email',
      },
    ],
  },
];

export const INFO_PAGES = INFO_GROUPS.flatMap((g) => g.pages);

export function buildInfoNav(activeKey) {
  return INFO_GROUPS.map((g) => ({
    title: g.title,
    pages: g.pages.map((p) => ({
      path: p.path,
      label: p.label,
      meta: p.meta,
      isActive: p.key === activeKey,
    })),
  }));
}
