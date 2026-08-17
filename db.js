require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// ─── Connection Pool ───────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASS     || '',
  database: process.env.DB_NAME     || 'allonbed',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  charset:            'utf8mb4'
});

// Thin helper so server.js can do: const [rows] = await db.query(sql, params)
const db = {
  query:   (sql, params) => pool.query(sql, params),
  execute: (sql, params) => pool.execute(sql, params),
};

// ─── hashPassword ──────────────────────────────────────────────────────────────
function hashPassword(plainText) {
  const salt = bcrypt.genSaltSync(12);
  return bcrypt.hashSync(plainText.trim().toUpperCase(), salt);
}

// ─── initDb ───────────────────────────────────────────────────────────────────
async function initDb() {
  const conn = await pool.getConnection();
  try {
    // Users
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        nom              VARCHAR(100) NOT NULL,
        prenom           VARCHAR(100) NOT NULL,
        normalized_name  VARCHAR(200) UNIQUE NOT NULL,
        password_hash    VARCHAR(255) NOT NULL,
        role             VARCHAR(20)  DEFAULT 'student',
        failed_attempts  INT          DEFAULT 0,
        locked_until     DATETIME     DEFAULT NULL,
        created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Enigmas
    await conn.query(`
      CREATE TABLE IF NOT EXISTS enigmas (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        node_number         INT UNIQUE NOT NULL,
        code_name           VARCHAR(100) NOT NULL,
        target_member_name  VARCHAR(200) NOT NULL,
        target_member_role  VARCHAR(200) NOT NULL,
        is_active           TINYINT(1)   DEFAULT 0,
        password_hash       VARCHAR(255) NOT NULL,
        clue_title          VARCHAR(255) NOT NULL,
        clue_type           VARCHAR(50)  DEFAULT 'text',
        clue_content        TEXT         NOT NULL,
        clue_hint           TEXT         DEFAULT '',
        media_url           VARCHAR(500) DEFAULT '',
        pin_x               FLOAT        DEFAULT 0,
        pin_y               FLOAT        DEFAULT 0,
        updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // User Progress
    await conn.query(`
      CREATE TABLE IF NOT EXISTS user_progress (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_id     INT NOT NULL,
        enigma_id   INT NOT NULL,
        unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_enigma (user_id, enigma_id),
        FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
        FOREIGN KEY (enigma_id) REFERENCES enigmas(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Master Puzzle (single row, id=1)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS master_puzzle (
        id             INT PRIMARY KEY CHECK (id = 1),
        master_hash    VARCHAR(255) NOT NULL,
        title          TEXT NOT NULL,
        reward_message TEXT NOT NULL,
        is_active      TINYINT(1) DEFAULT 1,
        updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Master Solvers
    await conn.query(`
      CREATE TABLE IF NOT EXISTS master_solvers (
        id        INT AUTO_INCREMENT PRIMARY KEY,
        user_id   INT UNIQUE NOT NULL,
        solved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Security Logs
    await conn.query(`
      CREATE TABLE IF NOT EXISTS security_logs (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    INT DEFAULT NULL,
        action     VARCHAR(100) NOT NULL,
        ip         VARCHAR(100),
        details    TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // ─── Seed enigmas if empty ────────────────────────────────────────────────
    const [[{ count }]] = await conn.query('SELECT COUNT(*) as count FROM enigmas');
    if (count === 0) {
      const defaultNodes = [
        { node: 1,  code: 'DOSSIER #01', name: 'Hugo V. (Trésorier)',             role: 'Gardien des Comptes',         active: 1, pass: 'CACALEX',   title: 'La Transaction Suspecte',           type: 'text',   content: "L'otage a laissé une note griffonnée dans la doublure de sa veste : 'La première lettre de notre retour commence par le courage de celui qui mise tout en une seule fois.'", hint: "Terme de poker pour miser l'intégralité de ses jetons (5 lettres).", media: '', x: 18, y: 22 },
        { node: 2,  code: 'DOSSIER #02', name: 'Léa M. (VP Communication)',       role: 'Stratège Réseaux',            active: 0, pass: 'ROYAL',     title: 'Interception Radio Fréquence 108.4', type: 'cipher', content: "Enregistrement haché : 'Quinte d'As... La plus haute marche du podium de Vegas.'",         hint: 'La quinte suprême au poker (5 lettres).',          media: '', x: 50, y: 14 },
        { node: 3,  code: 'DOSSIER #03', name: 'Théo B. (Pôle Soirées)',          role: 'Maître de la Nuit',           active: 0, pass: 'ROULETTE', title: 'Le Jeton Brûlé au 36 Rouge',         type: 'text',   content: 'Un sous-verre taché de cocktail retrouvé au fond du club clandestin.',                    hint: 'La grande roue des casinos (8 lettres).',          media: '', x: 82, y: 22 },
        { node: 4,  code: 'DOSSIER #04', name: 'Camille D. (Secrétaire Générale)', role: 'Archiviste Centrale',        active: 0, pass: 'BLACKJACK',title: 'Le Chiffre Fatidique 21',             type: 'text',   content: "Une carte de visite froissée : 'Ne dépassez jamais le compte de 21 face au croupier.'",  hint: 'Le célèbre jeu de cartes de table (9 lettres).',   media: '', x: 88, y: 52 },
        { node: 5,  code: 'DOSSIER #05', name: 'Maxime R. (Pôle Partenariats)',   role: "Négociateur de l'Ombre",     active: 0, pass: 'CASINO',   title: 'Le Contrat de la Suite Royale',      type: 'text',   content: 'Mallette biométrique retrouvée près de la terrasse du campus.',                          hint: "Le temple des jeux d'argent (6 lettres).",          media: '', x: 80, y: 82 },
        { node: 6,  code: 'DOSSIER #06', name: 'Inès K. (Pôle Logistique)',       role: 'Coordinatrice Terrain',       active: 0, pass: 'JETON',    title: "La Puce d'Argile Gravée",            type: 'text',   content: 'Un jeton lourd marqué du logo ALL ON BED découvert sous un siège de l\'amphi.',        hint: 'Disque utilisé pour miser (5 lettres).',           media: '', x: 50, y: 88 },
        { node: 7,  code: 'DOSSIER #07', name: 'Alexandre P. (Pôle Sport)',       role: 'Capitaine de Garde',          active: 0, pass: 'BLUFF',    title: "L'Art du Trompe-l'Œil",              type: 'text',   content: "Message vocal intercepté : 'Faire croire qu'on a le jeu parfait même les mains vides.'", hint: 'Technique pour tromper ses adversaires (5 lettres).', media: '', x: 18, y: 82 },
        { node: 8,  code: 'DOSSIER #08', name: 'Sarah L. (Pôle Créa & Design)',   role: 'Directrice Artistique',       active: 0, pass: 'VEGAS',    title: 'La Cité du Désert',                  type: 'text',   content: "Billet d'avion factice à destination du Nevada avec le logo ALL ON BED.",              hint: 'La Mecque du casino (5 lettres).',                 media: '', x: 10, y: 52 },
        { node: 9,  code: 'DOSSIER #09', name: 'LE PRÉSIDENT (Otage Clé)',        role: 'Chef du BDE ALL ON BED',      active: 0, pass: 'ALLONBED', title: "L'Appel de Détresse Final",           type: 'text',   content: "Dernière vidéo enregistrée dans la pièce sécurisée : 'Les 9 fragments s'assemblent pour proclamer notre grand retour à la rentrée !'", hint: 'Le nom de notre BDE (8 lettres).', media: '', x: 35, y: 35 },
      ];

      for (const n of defaultNodes) {
        await conn.query(
          `INSERT INTO enigmas (node_number, code_name, target_member_name, target_member_role, is_active, password_hash, clue_title, clue_type, clue_content, clue_hint, media_url, pin_x, pin_y)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.node, n.code, n.name, n.role, n.active, hashPassword(n.pass), n.title, n.type, n.content, n.hint, n.media, n.x, n.y]
        );
      }
    }

    // ─── Always ensure dossier #1 has CACALEX hash ───────────────────────────
    await conn.query(
      'UPDATE enigmas SET password_hash = ? WHERE node_number = 1',
      [hashPassword('CACALEX')]
    );

    // ─── Master puzzle ────────────────────────────────────────────────────────
    const [[masterRow]] = await conn.query('SELECT id FROM master_puzzle WHERE id = 1');
    const masterHash = hashPassword('WEAREBACK');
    if (!masterRow) {
      await conn.query(
        `INSERT INTO master_puzzle (id, master_hash, title, reward_message, is_active)
         VALUES (1, ?, 'EXTRACTION CONFIRMÉE // LE RETOUR DU BDE ALL ON BED',
         'FÉLICITATIONS AGENT ! Vous avez reconstitué le mot d''ordre : WE ARE BACK. Le BDE ALL ON BED est désormais libéré. Présentez-vous le jour de la rentrée à l''accueil avec votre identifiant pour recevoir votre pack VIP et lancer l''année !',
         1)`,
        [masterHash]
      );
    } else {
      await conn.query(
        'UPDATE master_puzzle SET master_hash = ? WHERE id = 1',
        [masterHash]
      );
    }

    // ─── Default admin account ────────────────────────────────────────────────
    const [[adminRow]] = await conn.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (!adminRow) {
      const adminHash = bcrypt.hashSync('ALLONBED2026!', bcrypt.genSaltSync(12));
      await conn.query(
        `INSERT INTO users (nom, prenom, normalized_name, password_hash, role)
         VALUES ('BDE', 'Admin', 'bde admin', ?, 'admin')`,
        [adminHash]
      );
    }

    console.log('✅ Database initialized successfully (MySQL)');
  } finally {
    conn.release();
  }
}

module.exports = { db, hashPassword, initDb };
