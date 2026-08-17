const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

let sqlDb = null;
const dbPath = path.join(__dirname, 'allonbed.sqlite');

function saveDb() {
  if (sqlDb) {
    const data = sqlDb.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

function wrapPrepare(sql) {
  return {
    get: (...args) => {
      const stmt = sqlDb.prepare(sql);
      try {
        if (stmt.step(args)) {
          return stmt.getAsObject();
        }
        return undefined;
      } finally {
        stmt.free();
      }
    },
    all: (...args) => {
      const stmt = sqlDb.prepare(sql);
      const results = [];
      try {
        stmt.bind(args);
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        return results;
      } finally {
        stmt.free();
      }
    },
    run: (...args) => {
      sqlDb.run(sql, args);
      saveDb();
      return { changes: 1 };
    }
  };
}

const dbWrapper = {
  prepare: wrapPrepare,
  exec: (sql) => {
    sqlDb.exec(sql);
    saveDb();
  },
  pragma: () => {}
};

function hashPassword(plainText) {
  const salt = bcrypt.genSaltSync(12);
  return bcrypt.hashSync(plainText.trim().toUpperCase(), salt);
}

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    sqlDb = new SQL.Database(filebuffer);
  } else {
    sqlDb = new SQL.Database();
  }

  // Initialize tables with maximum security (bcrypt hashes everywhere)
  dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      normalized_name TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'student',
      failed_attempts INTEGER DEFAULT 0,
      locked_until DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS enigmas (
      id INTEGER PRIMARY KEY,
      node_number INTEGER UNIQUE NOT NULL,
      code_name TEXT NOT NULL,
      target_member_name TEXT NOT NULL,
      target_member_role TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      password_hash TEXT NOT NULL,
      clue_title TEXT NOT NULL,
      clue_type TEXT DEFAULT 'text',
      clue_content TEXT NOT NULL,
      clue_hint TEXT DEFAULT '',
      media_url TEXT DEFAULT '',
      pin_x REAL DEFAULT 0,
      pin_y REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      enigma_id INTEGER NOT NULL,
      unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, enigma_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(enigma_id) REFERENCES enigmas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS master_puzzle (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      master_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      reward_message TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS master_solvers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      solved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS security_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      ip TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Initialize/Update default 9 enigmas with bcrypt hashes
  const countRow = dbWrapper.prepare('SELECT COUNT(*) as count FROM enigmas').get();
  if (!countRow || countRow.count === 0) {
    const insertEnigma = dbWrapper.prepare(`
      INSERT INTO enigmas (node_number, code_name, target_member_name, target_member_role, is_active, password_hash, clue_title, clue_type, clue_content, clue_hint, media_url, pin_x, pin_y)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const defaultNodes = [
      {
        node: 1, code: "DOSSIER #01", name: "Hugo V. (Trésorier)", role: "Gardien des Comptes", active: 1, pass: "CACALEX",
        title: "La Transaction Suspecte", type: "text",
        content: "L'otage a laissé une note griffonnée dans la doublure de sa veste : 'La première lettre de notre retour commence par le courage de celui qui mise tout en une seule fois.'",
        hint: "Terme de poker pour miser l'intégralité de ses jetons (5 lettres).", media: "", x: 18, y: 22
      },
      {
        node: 2, code: "DOSSIER #02", name: "Léa M. (VP Communication)", role: "Stratège Réseaux", active: 0, pass: "ROYAL",
        title: "Interception Radio Fréquence 108.4", type: "cipher",
        content: "Enregistrement haché : 'Quinte d'As... La plus haute marche du podium de Vegas.'",
        hint: "La quinte suprême au poker (5 lettres).", media: "", x: 50, y: 14
      },
      {
        node: 3, code: "DOSSIER #03", name: "Théo B. (Pôle Soirées)", role: "Maître de la Nuit", active: 0, pass: "ROULETTE",
        title: "Le Jeton Brûlé au 36 Rouge", type: "text",
        content: "Un sous-verre taché de cocktail retrouvé au fond du club clandestin.",
        hint: "La grande roue des casinos (8 lettres).", media: "", x: 82, y: 22
      },
      {
        node: 4, code: "DOSSIER #04", name: "Camille D. (Secrétaire Générale)", role: "Archiviste Centrale", active: 0, pass: "BLACKJACK",
        title: "Le Chiffre Fatidique 21", type: "text",
        content: "Une carte de visite froissée : 'Ne dépassez jamais le compte de 21 face au croupier.'",
        hint: "Le célèbre jeu de cartes de table (9 lettres).", media: "", x: 88, y: 52
      },
      {
        node: 5, code: "DOSSIER #05", name: "Maxime R. (Pôle Partenariats)", role: "Négociateur de l'Ombre", active: 0, pass: "CASINO",
        title: "Le Contrat de la Suite Royale", type: "text",
        content: "Mallette biométrique retrouvée près de la terrasse du campus.",
        hint: "Le temple des jeux d'argent (6 lettres).", media: "", x: 80, y: 82
      },
      {
        node: 6, code: "DOSSIER #06", name: "Inès K. (Pôle Logistique)", role: "Coordinatrice Terrain", active: 0, pass: "JETON",
        title: "La Puce d'Argile Gravée", type: "text",
        content: "Un jeton lourd marqué du logo ALL ON BED découvert sous un siège de l'amphi.",
        hint: "Disque utilisé pour miser (5 lettres).", media: "", x: 50, y: 88
      },
      {
        node: 7, code: "DOSSIER #07", name: "Alexandre P. (Pôle Sport)", role: "Capitaine de Garde", active: 0, pass: "BLUFF",
        title: "L'Art du Trompe-l'Œil", type: "text",
        content: "Message vocal intercepté : 'Faire croire qu'on a le jeu parfait même les mains vides.'",
        hint: "Technique pour tromper ses adversaires (5 lettres).", media: "", x: 18, y: 82
      },
      {
        node: 8, code: "DOSSIER #08", name: "Sarah L. (Pôle Créa & Design)", role: "Directrice Artistique", active: 0, pass: "VEGAS",
        title: "La Cité du Désert", type: "text",
        content: "Billet d'avion factice à destination du Nevada avec le logo ALL ON BED.",
        hint: "La Mecque du casino (5 lettres).", media: "", x: 10, y: 52
      },
      {
        node: 9, code: "DOSSIER #09", name: "LE PRÉSIDENT (Otage Clé)", role: "Chef du BDE ALL ON BED", active: 0, pass: "ALLONBED",
        title: "L'Appel de Détresse Final", type: "text",
        content: "Dernière vidéo enregistrée dans la pièce sécurisée : 'Les 9 fragments s'assemblent pour proclamer notre grand retour à la rentrée !'",
        hint: "Le nom de notre BDE (8 lettres).", media: "", x: 35, y: 35
      }
    ];

    for (const n of defaultNodes) {
      insertEnigma.run(
        n.node, n.code, n.name, n.role, n.active, hashPassword(n.pass),
        n.title, n.type, n.content, n.hint, n.media, n.x, n.y
      );
    }
  }

  // Master Puzzle 9-Letter Code: 'WEAREBACK'
  const masterExists = dbWrapper.prepare('SELECT id FROM master_puzzle WHERE id = 1').get();
  const masterHash = hashPassword('WEAREBACK');
  
  if (!masterExists) {
    dbWrapper.prepare(`
      INSERT INTO master_puzzle (id, master_hash, title, reward_message, is_active)
      VALUES (1, ?, 'EXTRACTION CONFIRMÉE // LE RETOUR DU BDE ALL ON BED', 'FÉLICITATIONS AGENT ! Vous avez reconstitué le mot d''ordre : WE ARE BACK. Le BDE ALL ON BED est désormais libéré. Présentez-vous le jour de la rentrée à l''accueil avec votre identifiant pour recevoir votre pack VIP et lancer l''année !', 1)
    `).run(masterHash);
  } else {
    dbWrapper.prepare(`
      UPDATE master_puzzle 
      SET master_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(masterHash);
  }

  // Default Admin BDE account
  const adminExists = dbWrapper.prepare("SELECT * FROM users WHERE role = 'admin'").get();
  if (!adminExists) {
    const adminHash = bcrypt.hashSync('ALLONBED2026!', bcrypt.genSaltSync(12));
    dbWrapper.prepare(`
      INSERT INTO users (nom, prenom, normalized_name, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `).run('BDE', 'Admin', 'bde admin', adminHash, 'admin');
  }

  console.log('Database initialized successfully using sql.js');
}

module.exports = {
  db: dbWrapper,
  hashPassword,
  initDb
};
