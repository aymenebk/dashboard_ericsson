// Usage: set ADMIN_EMAIL and ADMIN_PASSWORD in config.env, then run `npm run create-admin`.
// Creates the administrator, or resets the password if the account already exists.
// Remove ADMIN_PASSWORD from config.env afterwards.
require('dotenv').config({ path: './config.env', quiet: true });
const mongoose = require('mongoose');
const { upsertAdmin } = require('../utils/adminAccount');

(async () => {
  const { DATABASE_LOCAL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!DATABASE_LOCAL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('Set DATABASE_LOCAL, ADMIN_EMAIL and ADMIN_PASSWORD in config.env first.');
    process.exit(1);
  }
  try {
    await mongoose.connect(DATABASE_LOCAL);
    const result = await upsertAdmin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    console.log(`${result.created ? 'Created' : 'Updated'} the admin account ${result.email}`);
    await mongoose.connection.close();
  } catch (err) {
    console.error('Could not create the admin account:', err.message);
    process.exit(1);
  }
})();