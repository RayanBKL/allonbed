const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, hashPassword, initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'ALL_ON_BED_EURECOM_HIGH_SECURITY_SECRET_2026_!#';

// Security Headers with Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
          "https://unpkg.com"
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdnjs.cloudflare.com"
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        mediaSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiters for brute-force protection
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Système de sécurité : Trop de requêtes d\'authentification. Patientez 15 minutes.' }
});

const enigmaLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10, // max 10 guesses per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Protection Anti-Bruteforce : Maximum 10 tentatives par minute. Patientez 60 secondes.' }
});

const masterLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 8, // max 8 guesses per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terminal Maître verrouillé par sécurité anti-intrusion. Patientez 60 secondes.' }
});

function logSecurity(userId, action, ip, details) {
  try {
    db.prepare(`
      INSERT INTO security_logs (user_id, action, ip, details)
      VALUES (?, ?, ?, ?)
    `).run(userId || null, action, ip, JSON.stringify(details || {}));
  } catch (err) {
    console.error('Logging error:', err.message);
  }
}

// Authentication Middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Session non authentifiée. Veuillez vous inscrire ou vous connecter.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, nom, prenom, role, created_at, failed_attempts, locked_until FROM users WHERE id = ?').get(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Utilisateur introuvable.' });
    }

    // Check account lockout
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const waitSeconds = Math.ceil((new Date(user.locked_until) - new Date()) / 1000);
      return res.status(429).json({ error: `Compte temporairement ralenti pour sécurité. Réessayez dans ${waitSeconds} secondes.` });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expirée ou invalide. Reconnectez-vous.' });
  }
}

function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT id, nom, prenom, role FROM users WHERE id = ?').get(decoded.userId);
      if (user) req.user = user;
    } catch (e) {
      // ignore
    }
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès strictement réservé aux membres du BDE.' });
  }
  next();
}

// ==========================================
// AUTH ROUTES (Strictly Nom, Prenom, Mdp)
// ==========================================

app.post('/api/auth/register', authLimiter, (req, res) => {
  try {
    const { nom, prenom, password } = req.body;

    if (!nom || !prenom || !password) {
      return res.status(400).json({ error: 'Nom, Prénom et Mot de passe sont requis.' });
    }

    const cleanNom = nom.trim();
    const cleanPrenom = prenom.trim();

    if (cleanNom.length < 2 || cleanPrenom.length < 2) {
      return res.status(400).json({ error: 'Le nom et prénom doivent comporter au moins 2 caractères.' });
    }

    if (password.length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit comporter au moins 4 caractères.' });
    }

    const normalized = `${cleanNom.toLowerCase()} ${cleanPrenom.toLowerCase()}`;

    const existing = db.prepare('SELECT id FROM users WHERE normalized_name = ?').get(normalized);
    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà pour ce Nom et Prénom. Veuillez vous connecter.' });
    }

    // Bcrypt 12 rounds
    const salt = bcrypt.genSaltSync(12);
    const hash = bcrypt.hashSync(password, salt);

    const info = db.prepare(`
      INSERT INTO users (nom, prenom, normalized_name, password_hash, role)
      VALUES (?, ?, ?, ?, 'student')
    `).run(cleanNom, cleanPrenom, normalized, hash);

    const token = jwt.sign({ userId: info.lastInsertRowid }, JWT_SECRET, { expiresIn: '14d' });

    logSecurity(info.lastInsertRowid, 'REGISTER_SUCCESS', req.ip, { nom: cleanNom, prenom: cleanPrenom });

    return res.status(201).json({
      message: 'Dossier d\'agent créé avec succès ! Bienvenue au bureau d\'enquête.',
      token,
      user: {
        id: info.lastInsertRowid,
        nom: cleanNom,
        prenom: cleanPrenom,
        role: 'student'
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  try {
    const { nom, prenom, password } = req.body;

    if (!nom || !password) {
      return res.status(400).json({ error: 'Nom et Mot de passe sont requis.' });
    }

    let user;
    if (prenom) {
      const normalized = `${nom.trim().toLowerCase()} ${prenom.trim().toLowerCase()}`;
      user = db.prepare('SELECT * FROM users WHERE normalized_name = ?').get(normalized);
    } else {
      user = db.prepare('SELECT * FROM users WHERE normalized_name = ? OR LOWER(nom) = ?').get(
        nom.trim().toLowerCase(),
        nom.trim().toLowerCase()
      );
    }

    if (!user) {
      logSecurity(null, 'LOGIN_FAILED_NOT_FOUND', req.ip, { nom, prenom });
      return res.status(401).json({ error: 'Nom / Prénom ou mot de passe incorrect.' });
    }

    const match = bcrypt.compareSync(password, user.password_hash);
    if (!match) {
      logSecurity(user.id, 'LOGIN_FAILED_BAD_PASSWORD', req.ip, {});
      return res.status(401).json({ error: 'Nom / Prénom ou mot de passe incorrect.' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '14d' });

    logSecurity(user.id, 'LOGIN_SUCCESS', req.ip, {});

    return res.json({
      message: 'Identification confirmée.',
      token,
      user: {
        id: user.id,
        nom: user.nom,
        prenom: user.prenom,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
  }
});

app.get('/api/auth/me', authenticate, (req, res) => {
  try {
    const unlocked = db.prepare(`
      SELECT enigma_id, unlocked_at FROM user_progress WHERE user_id = ?
    `).all(req.user.id);

    const masterSolved = db.prepare('SELECT solved_at FROM master_solvers WHERE user_id = ?').get(req.user.id);

    return res.json({
      user: req.user,
      unlockedEnigmas: unlocked.map(u => ({ enigmaId: u.enigma_id, unlockedAt: u.unlocked_at })),
      masterSolved: masterSolved ? { solvedAt: masterSolved.solved_at } : null
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur profil.' });
  }
});

// ==========================================
// ENIGMAS & INVESTIGATION BOARD
// ==========================================

app.get('/api/enigmas', optionalAuthenticate, (req, res) => {
  try {
    const enigmas = db.prepare(`
      SELECT id, node_number, code_name, target_member_name, target_member_role, is_active, clue_title, clue_type, clue_hint, media_url, pin_x, pin_y
      FROM enigmas
      ORDER BY node_number ASC
    `).all();

    let userUnlockedIds = new Set();
    let isMasterSolved = false;

    if (req.user) {
      const unlocked = db.prepare('SELECT enigma_id FROM user_progress WHERE user_id = ?').all(req.user.id);
      unlocked.forEach(u => userUnlockedIds.add(u.enigma_id));

      const master = db.prepare('SELECT id FROM master_solvers WHERE user_id = ?').get(req.user.id);
      isMasterSolved = !!master;
    }

    const payload = enigmas.map(e => {
      const isUnlocked = userUnlockedIds.has(e.id);
      let content = null;

      // Provide full text ONLY if unlocked or admin!
      if (isUnlocked || (req.user && req.user.role === 'admin')) {
        const full = db.prepare('SELECT clue_content FROM enigmas WHERE id = ?').get(e.id);
        content = full.clue_content;
      }

      return {
        id: e.id,
        nodeNumber: e.node_number,
        codeName: e.code_name,
        targetMemberName: e.target_member_name,
        targetMemberRole: e.target_member_role,
        isActive: !!e.is_active,
        clueTitle: e.is_active ? e.clue_title : 'DOSSIER CONFIDENTIEL',
        clueType: e.clue_type,
        clueHint: e.is_active ? e.clue_hint : '',
        mediaUrl: e.is_active ? e.media_url : '',
        pinX: e.pin_x,
        pinY: e.pin_y,
        isUnlocked,
        clueContent: content
      };
    });

    const masterConfig = db.prepare('SELECT title, is_active FROM master_puzzle WHERE id = 1').get();

    return res.json({
      nodes: payload,
      isMasterSolved,
      masterActive: !!masterConfig?.is_active
    });
  } catch (err) {
    console.error('Enigmas error:', err);
    return res.status(500).json({ error: 'Erreur chargement des dossiers.' });
  }
});

// Unlock single enigma dossier (Validates strictly against Bcrypt hash on backend)
app.post('/api/enigmas/:id/unlock', authenticate, enigmaLimiter, (req, res) => {
  try {
    const enigmaId = parseInt(req.params.id, 10);
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Veuillez saisir le mot de passe secret.' });
    }

    const enigma = db.prepare('SELECT * FROM enigmas WHERE id = ?').get(enigmaId);
    if (!enigma) {
      return res.status(404).json({ error: 'Dossier introuvable.' });
    }

    if (!enigma.is_active) {
      return res.status(403).json({ error: 'Ce dossier est encore sous scellé. Attendez sa publication officielle.' });
    }

    const cleanGuess = password.trim().toUpperCase().replace(/[\s-_]/g, '');

    // Bcrypt comparison
    const isMatch = bcrypt.compareSync(cleanGuess, enigma.password_hash);

    if (!isMatch) {
      // Increment failed attempts for rate limiting
      db.prepare(`
        UPDATE users 
        SET failed_attempts = failed_attempts + 1,
            locked_until = CASE WHEN failed_attempts >= 5 THEN datetime('now', '+60 seconds') ELSE locked_until END
        WHERE id = ?
      `).run(req.user.id);

      logSecurity(req.user.id, 'ENIGMA_UNLOCK_FAILED', req.ip, { enigmaId });
      return res.status(400).json({ error: 'CODE INCORRECT. Le sceau du dossier reste verrouillé.' });
    }

    // Reset failed counter on success
    db.prepare('UPDATE users SET failed_attempts = 0 WHERE id = ?').run(req.user.id);

    db.prepare(`
      INSERT OR IGNORE INTO user_progress (user_id, enigma_id)
      VALUES (?, ?)
    `).run(req.user.id, enigmaId);

    logSecurity(req.user.id, 'ENIGMA_UNLOCKED_SUCCESS', req.ip, { enigmaId });

    return res.json({
      success: true,
      message: `Dossier #${enigma.node_number} déverrouillé ! Indice ajouté à votre tableau.`,
      clue: {
        id: enigma.id,
        nodeNumber: enigma.node_number,
        title: enigma.clue_title,
        content: enigma.clue_content,
        mediaUrl: enigma.media_url
      }
    });
  } catch (err) {
    console.error('Unlock error:', err);
    return res.status(500).json({ error: 'Erreur déverrouillage.' });
  }
});

// Master 9-Letter Code Unlock ('WEAREBACK' strictly compared via Bcrypt)
app.post('/api/enigmas/master-unlock', authenticate, masterLimiter, (req, res) => {
  try {
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Veuillez saisir les 9 lettres.' });
    }

    const cleanCode = code.trim().toUpperCase().replace(/[\s-_]/g, '');

    if (cleanCode.length !== 9) {
      return res.status(400).json({ error: `Le mot de passe maître doit faire exactement 9 lettres (${cleanCode.length}/9 saisies).` });
    }

    const master = db.prepare('SELECT * FROM master_puzzle WHERE id = 1').get();
    if (!master || !master.is_active) {
      return res.status(403).json({ error: 'Le terminal maître est inactif.' });
    }

    // Bcrypt comparison on backend!
    const isMasterMatch = bcrypt.compareSync(cleanCode, master.master_hash);

    if (!isMasterMatch) {
      db.prepare(`
        UPDATE users 
        SET failed_attempts = failed_attempts + 1,
            locked_until = CASE WHEN failed_attempts >= 4 THEN datetime('now', '+60 seconds') ELSE locked_until END
        WHERE id = ?
      `).run(req.user.id);

      logSecurity(req.user.id, 'MASTER_UNLOCK_FAILED', req.ip, {});
      return res.status(400).json({ error: 'COMBINAISON ERRONÉE. Le mot de passe final à 9 lettres ne correspond pas.' });
    }

    db.prepare('UPDATE users SET failed_attempts = 0 WHERE id = ?').run(req.user.id);

    db.prepare(`
      INSERT OR IGNORE INTO master_solvers (user_id)
      VALUES (?)
    `).run(req.user.id);

    logSecurity(req.user.id, 'MASTER_SOLVED_CONGRATS', req.ip, {});

    return res.json({
      success: true,
      message: 'EXTRACTION CONFIRMÉE ! RETOUR DU BDE ALL ON BED AUTORISÉ.',
      title: master.title,
      rewardMessage: master.reward_message
    });
  } catch (err) {
    console.error('Master unlock error:', err);
    return res.status(500).json({ error: 'Erreur validation code maître.' });
  }
});

// ==========================================
// LEADERBOARD
// ==========================================

app.get('/api/leaderboard', (req, res) => {
  try {
    const leaderboard = db.prepare(`
      SELECT 
        u.id,
        u.nom,
        u.prenom,
        COUNT(up.enigma_id) as solved_count,
        ms.solved_at as master_solved_at,
        MAX(up.unlocked_at) as last_solve_at
      FROM users u
      LEFT JOIN user_progress up ON u.id = up.user_id
      LEFT JOIN master_solvers ms ON u.id = ms.user_id
      WHERE u.role = 'student'
      GROUP BY u.id
      ORDER BY 
        (ms.solved_at IS NOT NULL) DESC,
        ms.solved_at ASC,
        solved_count DESC,
        last_solve_at ASC
      LIMIT 50
    `).all();

    return res.json({
      leaderboard: leaderboard.map((row, idx) => ({
        rank: idx + 1,
        nom: row.nom,
        prenom: row.prenom,
        solvedCount: row.solved_count,
        masterSolved: !!row.master_solved_at,
        masterSolvedAt: row.master_solved_at
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur classement.' });
  }
});

// ==========================================
// ADMIN DASHBOARD
// ==========================================

app.get('/api/admin/dashboard', authenticate, requireAdmin, (req, res) => {
  try {
    const totalStudents = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count;
    const totalMasterSolvers = db.prepare('SELECT COUNT(*) as count FROM master_solvers').get().count;
    const totalSolves = db.prepare('SELECT COUNT(*) as count FROM user_progress').get().count;

    const students = db.prepare(`
      SELECT 
        u.id,
        u.nom,
        u.prenom,
        u.created_at,
        ms.solved_at as master_solved_at,
        GROUP_CONCAT(up.enigma_id) as unlocked_enigma_ids
      FROM users u
      LEFT JOIN user_progress up ON u.id = up.user_id
      LEFT JOIN master_solvers ms ON u.id = ms.user_id
      WHERE u.role = 'student'
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `).all();

    const formattedStudents = students.map(s => ({
      id: s.id,
      nom: s.nom,
      prenom: s.prenom,
      registeredAt: s.created_at,
      masterSolved: !!s.master_solved_at,
      masterSolvedAt: s.master_solved_at,
      unlockedNodes: s.unlocked_enigma_ids ? s.unlocked_enigma_ids.split(',').map(Number) : []
    }));

    const enigmas = db.prepare('SELECT id, node_number, code_name, target_member_name, target_member_role, is_active, clue_title, clue_content, clue_hint, media_url, updated_at FROM enigmas ORDER BY node_number ASC').all();
    const master = db.prepare('SELECT id, title, reward_message, is_active FROM master_puzzle WHERE id = 1').get();

    return res.json({
      stats: {
        totalStudents,
        totalMasterSolvers,
        totalSolves
      },
      students: formattedStudents,
      enigmas,
      master
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    return res.status(500).json({ error: 'Erreur panneau d\'administration.' });
  }
});

app.put('/api/admin/enigma/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { is_active, secret_password, clue_title, clue_content, clue_hint, target_member_name, target_member_role } = req.body;

    const existing = db.prepare('SELECT * FROM enigmas WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Dossier introuvable.' });
    }

    const newHash = secret_password ? hashPassword(secret_password) : existing.password_hash;

    db.prepare(`
      UPDATE enigmas
      SET 
        is_active = COALESCE(?, is_active),
        password_hash = ?,
        clue_title = COALESCE(?, clue_title),
        clue_content = COALESCE(?, clue_content),
        clue_hint = COALESCE(?, clue_hint),
        target_member_name = COALESCE(?, target_member_name),
        target_member_role = COALESCE(?, target_member_role),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      newHash,
      clue_title ? clue_title.trim() : null,
      clue_content ? clue_content.trim() : null,
      clue_hint !== undefined ? clue_hint.trim() : null,
      target_member_name ? target_member_name.trim() : null,
      target_member_role ? target_member_role.trim() : null,
      id
    );

    return res.json({ message: `Dossier #${existing.node_number} mis à jour avec succès.` });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur mise à jour.' });
  }
});

app.put('/api/admin/master', authenticate, requireAdmin, (req, res) => {
  try {
    const { master_code, title, reward_message, is_active } = req.body;

    let newHash = null;
    if (master_code) {
      const clean = master_code.trim().toUpperCase().replace(/[\s-_]/g, '');
      if (clean.length !== 9) {
        return res.status(400).json({ error: 'Le code maître doit faire exactement 9 lettres.' });
      }
      newHash = hashPassword(clean);
    }

    db.prepare(`
      UPDATE master_puzzle
      SET
        master_hash = COALESCE(?, master_hash),
        title = COALESCE(?, title),
        reward_message = COALESCE(?, reward_message),
        is_active = COALESCE(?, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(
      newHash,
      title ? title.trim() : null,
      reward_message ? reward_message.trim() : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null
    );

    return res.json({ message: 'Configuration Maître mise à jour avec succès.' });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur modification maître.' });
  }
});

// Fallback for SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`♠ ALL ON BED - BUREAU D'ENQUÊTE & TABLEAU AUX FILS ROUGES ♠`);
    console.log(`Port d'écoute : http://localhost:${PORT}`);
    console.log(`Compte Admin BDE : 'BDE' / 'Admin' - Mot de passe : 'ALLONBED2026!'`);
  });
}).catch(err => {
  console.error("Failed to initialize database:", err);
});
