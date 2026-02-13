const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// helper
function normalizeEmail(v) {
  return (v || '').trim().toLowerCase();
}

// ================= REGISTER =================
exports.register = async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = req.body.password || ''; // ✅ DO NOT trim password

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, password are required' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(409).json({ message: 'User already exists' }); // ✅ better status
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: 'user', // 🔒 force user role
    });

    return res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('REGISTER ERROR:', err);

    // ✅ handle duplicate key just in case
    if (err && err.code === 11000) {
      return res.status(409).json({ message: 'User already exists' });
    }

    return res.status(500).json({ message: 'Registration failed' });
  }
};

// ================= LOGIN =================
exports.login = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = req.body.password || ''; // ✅ DO NOT trim password

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET missing in env');
      return res.status(500).json({ message: 'Server misconfigured (JWT_SECRET missing)' });
    }

    // ✅ because password is select:false in schema
    const user = await User.findOne({ email }).select('+password');

    // ✅ return same message for security + consistent frontend
    if (!user) {
      // optional debug:
      console.warn('LOGIN: user not found for email:', email);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.warn('LOGIN: password mismatch for email:', email);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user._id.toString(), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    return res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    return res.status(500).json({ message: 'Login failed' });
  }
};
