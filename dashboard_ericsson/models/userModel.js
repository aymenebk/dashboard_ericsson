const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_BYTES = 72; // bcrypt ignores anything after 72 bytes: refuse longer passwords instead of truncating

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'An account needs an email'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: [EMAIL_FORMAT, 'Please provide a valid email'],
    },
    password: {
      type: String,
      required: [true, 'An account needs a password'],
      select: false, // never returned by a query unless asked for with select('+password')
      validate: {
        validator: (p) => p.length >= MIN_PASSWORD_LENGTH && Buffer.byteLength(p) <= MAX_PASSWORD_BYTES,
        message: `The password must have at least ${MIN_PASSWORD_LENGTH} characters (72 bytes at most)`,
      },
    },
    // Least privilege by default. "admin" can import files; "viewer" can only read.
    role: { type: String, enum: ['admin', 'viewer'], default: 'viewer' },
    active: { type: Boolean, default: true },
    passwordChangedAt: Date,
  },
  { timestamps: true },
);

// Hash on every password change. Runs after validation, so the rules above apply to the PLAIN password.
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  const cost = Math.max(4, Number(process.env.BCRYPT_COST) || 12);
  this.password = await bcrypt.hash(this.password, cost);
  // A token issued before this moment must stop working (1 s margin for clock rounding)
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
});

userSchema.methods.correctPassword = function correctPassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

// iat = "issued at" of the token, in seconds
userSchema.methods.changedPasswordAfter = function changedPasswordAfter(iat) {
  return Boolean(this.passwordChangedAt) && Math.floor(this.passwordChangedAt.getTime() / 1000) > iat;
};

module.exports = mongoose.model('User', userSchema);