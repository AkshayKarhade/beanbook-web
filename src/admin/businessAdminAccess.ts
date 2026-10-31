/**
 * Central presentation copy for the business-scoped owner role.
 * Security decisions still come from admin_users.role + server authorization.
 * Do not use display labels as authorization claims.
 */
export const BUSINESS_ADMIN_ROLE_LABEL = 'Business Admin (Owner)';

export const BUSINESS_ADMIN_PRIVILEGES = [
  'Access and administer the assigned business workspace',
  'Manage the menu, products, pricing and inventory when enabled',
  'Manage POS, orders and payment operations when enabled',
  'Invite staff and assign business-only permissions when enabled',
  'View business events, analytics and reports when enabled',
] as const;

export const BUSINESS_ADMIN_SCOPE_NOTE =
  'Your access applies only to the business named in this invitation. It does not grant BeanBook Platform Admin access or access to other businesses. Some modules are still being built and will become available as they launch.';
