import { Router } from 'express';
import { loginUser, logoutToken, registerUser } from '../services/auth.service.mjs';
import { authRequired } from '../middleware/auth.mjs';

const router = Router();

router.post('/register', (req, res) => {
  try {
    const data = registerUser(req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

router.post('/login', (req, res) => {
  try {
    const data = loginUser(req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

router.post('/logout', authRequired, (req, res) => {
  try {
    logoutToken(req.auth);
    res.json({ success: true, data: { loggedOut: true } });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

router.get('/me', authRequired, (req, res) => {
  res.json({
    success: true,
    data: {
      tokenId: req.auth.tokenId,
      tokenPrefix: req.auth.tokenPrefix,
      user: req.auth.user,
    },
  });
});

export default router;
