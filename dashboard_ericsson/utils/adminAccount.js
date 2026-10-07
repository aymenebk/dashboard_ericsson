const User = require('../models/userModel');

// Creates the administrator, or resets the password of an existing account (and re-enables it).
// Weak passwords and invalid emails are refused by the User model (the error is thrown).
async function upsertAdmin({ email, password }) {
  if (typeof email !== 'string' || typeof password !== 'string') throw new Error('An email and a password are required');

  let user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
  const created = !user;
  if (!user) user = new User({ email });
  user.password = password;
  user.role = 'admin';
  user.active = true;
  await user.save();
  return { created, id: user._id, email: user.email };
}

module.exports = { upsertAdmin };