export const cfg = {
  port: Number(process.env.PORT ?? 4000),
  dbUrl: process.env.DB_URL ?? 'postgres://pos_app:pos@postgres:5432/pos',
  adminToken: process.env.POS_ADMIN_TOKEN ?? '',
  uiSecret: process.env.UI_SECRET ?? process.env.POS_ADMIN_TOKEN ?? 'dev-secret',
  apiVersion: '2024-01',
  tolerance: 300,
};
