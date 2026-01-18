-- scripts/seed-dev-templates.sql
-- Dev seed for public.templates (Tempasi)
-- Matches current schema: slug, title, short_desc, status, created_at/updated_at defaults

BEGIN;

-- Remove previous dev seeds (safe re-run)
DELETE FROM templates
WHERE slug IN (
  'seed-minimal-landing',
  'seed-saas-dashboard',
  'seed-portfolio-dark'
);

-- Insert 3 templates
INSERT INTO templates (slug, title, short_desc, full_desc, status, demo_url, preview_image)
VALUES
(
  'seed-minimal-landing',
  'Minimal Landing Page',
  'Clean minimal landing page for startups and small products.',
  'A lightweight landing template with hero, features, FAQ and footer. Great as a starting point for marketing pages.',
  'published',
  'https://example.com/demo/minimal-landing',
  '/t/seed-minimal-landing/preview/preview.png'
),
(
  'seed-saas-dashboard',
  'SaaS Dashboard',
  'Modern SaaS dashboard layout with analytics blocks.',
  'Dashboard template: sidebar navigation, KPI cards, charts placeholders, tables, settings page layout.',
  'published',
  'https://example.com/demo/saas-dashboard',
  '/t/seed-saas-dashboard/preview/preview.png'
),
(
  'seed-portfolio-dark',
  'Dark Portfolio',
  'Dark themed portfolio template for designers and studios.',
  'Portfolio: intro, projects grid, case page layout, contact section, social links. Strong contrast, elegant typography.',
  'published',
  'https://example.com/demo/dark-portfolio',
  '/t/seed-portfolio-dark/preview/preview.png'
);

COMMIT;
