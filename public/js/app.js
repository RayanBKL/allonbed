// ═══════════════════════════════════════════════════
// ALL ON BED — APP CONTROLLER
// ═══════════════════════════════════════════════════

class App {
  constructor() {
    this.token = localStorage.getItem('aob_token');
    this.user = null;
    this.enigmas = [];
    this.currentEnigma = null;
    this.corridor = null;
    this.currentView = 'board';

    this.init();
  }

  async init() {
    this.initAudio();
    this.bindModals();
    this.bindMasterSlots();
    this.bindEvents();

    if (this.token) await this.fetchMe();
    else this.renderAuth();

    await this.loadEnigmas();
    await this.renderLeaderboardPostit();
  }

  // ─── AUDIO ───────────────────────────────────────
  initAudio() {
    const btn = document.getElementById('audioToggleBtn');
    const icon = document.getElementById('audioIcon');
    btn.addEventListener('click', () => {
      const on = window.soundFX.toggle();
      icon.className = on ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
      if (on) window.soundFX.playClick();
    });
  }

  async renderLeaderboardPostit() {
    try {
      const data = await this.api('/api/leaderboard');
      const lb = data.leaderboard;
      const listEl = document.getElementById('lbPostitList');
      const meEl = document.getElementById('lbPostitMe');
      if (!listEl || !meEl) return;

      listEl.innerHTML = '';
      // Top 10
      lb.slice(0, 10).forEach((u, i) => {
        const li = document.createElement('li');
        const scoreDisplay = u.masterSolved ? 'MAÎTRE' : `${u.solvedCount}/9`;
        li.innerHTML = `<span>#${i+1} ${this.esc(u.prenom)} ${this.esc(u.nom).charAt(0)}.</span> <span>${scoreDisplay}</span>`;
        listEl.appendChild(li);
      });

      if (this.user) {
        // We don't have the user's exact rank if they are not in the top 50, but lb has top 50
        const myRank = lb.findIndex(u => u.nom === this.user.nom && u.prenom === this.user.prenom) + 1;
        meEl.innerHTML = myRank > 0 ? `Ma position : #${myRank}` : 'Ma position : > 50';
      }
    } catch(e) {
      console.error('LB error:', e);
    }
  }

  openEasterEgg() {
    window.soundFX.playSuccess();
    // Show a mini popup with easter egg links
    const existing = document.getElementById('easterEggPopup');
    if (existing) { existing.remove(); return; }

    const pop = document.createElement('div');
    pop.id = 'easterEggPopup';
    pop.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: #111; border: 1px solid rgba(212,175,55,0.4);
      border-radius: 12px; padding: 28px 32px; z-index: 9999;
      text-align: center; max-width: 320px; width: 90%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.9);
      font-family: 'Inter', sans-serif;
    `;
    pop.innerHTML = `
      <div style="font-size:2rem;margin-bottom:8px">👀</div>
      <h3 style="color:#d4af37;margin-bottom:6px;font-size:16px">T'as trouvé la fenêtre...</h3>
      <p style="color:#888;font-size:13px;margin-bottom:20px;line-height:1.5">
        Bravo. Quelques liens utiles&nbsp;:
      </p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <a href="https://allonbed.fr" target="_blank" rel="noopener"
           style="background:rgba(212,175,55,0.15);border:1px solid rgba(212,175,55,0.4);color:#d4af37;
                  padding:10px 16px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">
          🌐&nbsp; allonbed.fr
        </a>
        <a href="https://instagram.com/eurecom_bde" target="_blank" rel="noopener"
           style="background:rgba(212,175,55,0.08);border:1px solid rgba(255,255,255,0.08);color:#aaa;
                  padding:10px 16px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">
          📸&nbsp; @eurecom_bde
        </a>
      </div>
      <button onclick="document.getElementById('easterEggPopup').remove()"
        style="margin-top:18px;background:none;border:none;color:#666;cursor:pointer;font-size:12px;font-family:'Inter',sans-serif">
        Fermer
      </button>
    `;
    document.body.appendChild(pop);

    // Close on outside click
    setTimeout(() => {
      const close = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 200);
  }

  // ─── API ─────────────────────────────────────────
  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { ...this.headers(), ...(opts.headers || {}) } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    return data;
  }

  // ─── AUTH ─────────────────────────────────────────
  async fetchMe() {
    try {
      const data = await this.api('/api/auth/me');
      this.user = data.user;
      this.user.unlocked = (data.unlockedEnigmas || []).map(u => u.enigmaId);
      this.user.masterSolved = !!data.masterSolved;
      this.renderAuth();
    } catch {
      this.token = null;
      localStorage.removeItem('aob_token');
      this.renderAuth();
    }
  }

  renderAuth() {
    const c = document.getElementById('userAuthContainer');
    const adminBtn = document.getElementById('adminBtn');
    if (this.user) {
      c.innerHTML = `
        <div class="user-chip">
          <span>${this.esc(this.user.nom)} ${this.esc(this.user.prenom)}</span>
          <button class="user-chip-logout" id="logoutBtn" title="Déconnexion"><i class="fa-solid fa-right-from-bracket"></i></button>
        </div>`;
      document.getElementById('logoutBtn').onclick = () => this.logout();
      adminBtn.style.display = this.user.role === 'admin' ? 'inline-flex' : 'none';
    } else {
      c.innerHTML = `<button class="primary-btn" id="openAuthBtn">Connexion</button>`;
      document.getElementById('openAuthBtn').onclick = () => this.open('authModal');
      adminBtn.style.display = 'none';
    }
  }

  logout() {
    this.token = null; this.user = null;
    localStorage.removeItem('aob_token');
    this.renderAuth();
    this.loadEnigmas();
    window.soundFX.playClick();
  }

  // ─── ENIGMAS ─────────────────────────────────────
  async loadEnigmas() {
    try {
      const data = await this.api('/api/enigmas');
      this.enigmas = data.nodes;
      this.renderBoard();
    } catch (e) {
      console.error('loadEnigmas:', e);
    }
  }

  // ─── CORKBOARD ───────────────────────────────────
  renderBoard() {
    const container = document.getElementById('boardNodes');
    container.innerHTML = '';

    // Positions around center (percentages)
    const positions = [
      { top: 12, left: 14, rot: -4 },
      { top:  8, left: 44, rot:  2 },
      { top: 12, left: 74, rot: -3 },
      { top: 46, left: 80, rot:  4 },
      { top: 72, left: 72, rot: -2 },
      { top: 76, left: 44, rot:  3 },
      { top: 72, left: 16, rot:  4 },
      { top: 46, left:  8, rot: -4 },
      { top: 28, left: 30, rot:  2 },
    ];

    this.enigmas.forEach((e, i) => {
      const pos = positions[i] || { top: 50, left: 50, rot: 0 };
      const el = document.createElement('div');
      el.className = `node-card${e.isUnlocked ? ' node-solved' : (e.isActive ? ' node-active' : '')}`;
      el.id = `node_${e.id}`;
      el.style.cssText = `top:${pos.top}%;left:${pos.left}%;transform:rotate(${pos.rot}deg)`;

      const pinColor = e.isUnlocked ? '#27ae60' : (e.isActive ? '#d4af37' : '#c0392b');
      const statusClass = e.isUnlocked ? 'status-solved' : (e.isActive ? 'status-active' : 'status-locked');
      const statusLabel = e.isUnlocked ? 'RÉSOLU' : (e.isActive ? 'ACTIF' : 'VERROUILLÉ');

      el.innerHTML = `
        <div class="node-pin-dot" style="background:${pinColor};box-shadow:0 0 6px ${pinColor}"></div>
        <div class="node-photo">
          <i class="fa-solid fa-question"></i>
        </div>
      `;

      el.addEventListener('click', () => this.openDossier(e));
      container.appendChild(el);
    });

    setTimeout(() => this.drawThreads(), 100);
  }

  drawThreads() {
    const svg = document.getElementById('boardThreads');
    const board = document.getElementById('corkboard');
    const logo = document.getElementById('centerLogo');
    if (!svg || !board || !logo) return;

    const bRect = board.getBoundingClientRect();
    const lRect = logo.getBoundingClientRect();
    const cx = lRect.left + lRect.width / 2 - bRect.left;
    const cy = lRect.top + lRect.height / 2 - bRect.top;

    let paths = '';
    this.enigmas.forEach(e => {
      const node = document.getElementById(`node_${e.id}`);
      if (!node) return;
      const nRect = node.getBoundingClientRect();
      const nx = nRect.left + nRect.width / 2 - bRect.left;
      const ny = nRect.top + 16 - bRect.top;

      // Natural sag curve
      const mx = (cx + nx) / 2;
      const my = Math.min(cy, ny) + Math.abs(cx - nx) * 0.08 + 20;

      const color = e.isUnlocked ? 'rgba(39,174,96,0.7)' : 'rgba(192,57,43,0.85)';
      const width = e.isUnlocked ? 2 : 2.5;

      paths += `<path d="M${cx},${cy} Q${mx},${my} ${nx},${ny}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round" filter="drop-shadow(1px 2px 2px rgba(0,0,0,0.4))"/>`;
    });
    svg.innerHTML = paths;
  }

  // ─── DOSSIER MODAL ───────────────────────────────
  openDossier(enigma) {
    this.currentEnigma = enigma;
    window.soundFX.playClick();

    const stamp = document.getElementById('dosStamp');
    document.getElementById('dosNum').textContent = `DOSSIER #${String(enigma.nodeNumber).padStart(2, '0')}`;
    document.getElementById('dosTitle').textContent = enigma.isActive ? enigma.clueTitle : 'AVIS DE DISPARITION';

    document.getElementById('stateSealed').style.display = 'none';
    document.getElementById('statePass').style.display   = 'none';
    document.getElementById('stateOpen').style.display   = 'none';
    document.getElementById('dosFeedback').textContent   = '';

    if (enigma.isUnlocked) {
      stamp.textContent = 'DÉCLASSIFIÉ';
      stamp.style.cssText = 'color:#27ae60;border-color:#27ae60';
      
      const stateOpen = document.getElementById('stateOpen');
      const prezContainer = document.getElementById('prezContainer');
      const dosContent = document.getElementById('dosContent');
      
      if (enigma.nodeNumber === 1) {
        stateOpen.style.display = 'none';
        prezContainer.style.display = 'block';
        prezContainer.innerHTML = `
          <div style="margin-top: 10px;">
            <button id="btnOpenPrez" class="glow-btn" style="width:100%; padding: 12px; font-size: 16px;">
              <i class="fa-solid fa-folder-open"></i> Accéder au dossier LE PREZ
            </button>
          </div>
        `;
        setTimeout(() => {
          const btn = document.getElementById('btnOpenPrez');
          if (btn) btn.onclick = () => {
            this.close('dossierModal');
            this.openPrez();
          };
        }, 100);
      } else {
        prezContainer.style.display = 'none';
        stateOpen.style.display = 'block';
        dosContent.innerHTML = enigma.clueContent || '';
      }
    } else if (enigma.isActive) {
      stamp.textContent = 'VERROUILLÉ';
      stamp.style.cssText = 'color:#d4af37;border-color:#d4af37';
      document.getElementById('dosPassInput').value = '';
      document.getElementById('statePass').style.display = 'block';
    } else {
      stamp.textContent = 'CLASSIFIÉ';
      stamp.style.cssText = 'color:#666;border-color:#666';
      document.getElementById('stateSealed').style.display = 'block';
    }

    this.open('dossierModal');
  }

  async handleUnlock(e) {
    e.preventDefault();
    const fb = document.getElementById('dosFeedback');

    if (!this.user) {
      this.close('dossierModal');
      this.open('authModal');
      return;
    }

    const pass = document.getElementById('dosPassInput').value.trim();
    if (!pass) return;

    fb.textContent = '…';
    fb.className = 'feedback';

    try {
      const res = await this.api(`/api/enigmas/${this.currentEnigma.id}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ password: pass })
      });
      window.soundFX.playSuccess();
      fb.className = 'feedback ok';
      fb.textContent = res.message;

      this.currentEnigma.isUnlocked = true;
      this.currentEnigma.clueContent = res.clue.content;

      // Refresh user state (unlocked count, etc.)
      await this.fetchMe();
      await this.loadEnigmas();
      await this.renderLeaderboardPostit();

      setTimeout(() => this.openDossier(this.currentEnigma), 800);
    } catch (err) {
      window.soundFX.playError();
      fb.className = 'feedback err';
      fb.textContent = err.message;
    }
  }

  // ─── MASTER CODE ──────────────────────────────────
  bindMasterSlots() {
    const slots = document.querySelectorAll('.mslot');
    slots.forEach((slot, i) => {
      slot.addEventListener('input', () => {
        slot.value = slot.value.toUpperCase();
        window.soundFX.playKeyStroke();
        if (slot.value && i < slots.length - 1) slots[i + 1].focus();
      });
      slot.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !slot.value && i > 0) slots[i - 1].focus();
      });
      slot.addEventListener('paste', e => {
        e.preventDefault();
        const txt = (e.clipboardData || window.clipboardData).getData('text')
          .toUpperCase().replace(/[^A-Z]/g, '');
        for (let j = 0; j < 9; j++) if (slots[j]) slots[j].value = txt[j] || '';
        slots[Math.min(txt.length, 8)].focus();
      });
    });

    document.getElementById('masterSubmitBtn').addEventListener('click', () => this.handleMaster());
  }

  async handleMaster() {
    if (!this.user) {
      this.close('masterModal');
      this.open('authModal');
      return;
    }

    const code = [...document.querySelectorAll('.mslot')].map(s => s.value).join('');
    const fb = document.getElementById('masterFeedback');

    if (code.length !== 9) {
      fb.className = 'feedback err';
      fb.textContent = `Saisissez les 9 lettres (${code.length}/9)`;
      window.soundFX.playError();
      return;
    }

    fb.textContent = '…';
    fb.className = 'feedback';

    try {
      const res = await this.api('/api/enigmas/master-unlock', {
        method: 'POST',
        body: JSON.stringify({ code })
      });

      window.soundFX.playMasterVictory();

      if (window.confetti) window.confetti({
        particleCount: 160, spread: 80, origin: { y: 0.5 },
        colors: ['#d4af37', '#ffffff', '#27ae60']
      });

      fb.textContent = '';
      document.getElementById('victoryTitle').textContent = res.title;
      document.getElementById('victoryMsg').textContent = res.rewardMessage;
      document.getElementById('victoryBox').style.display = 'block';

      // Refresh user state so leaderboard shows MAÎTRE / 9/9
      await this.fetchMe();
      await this.loadEnigmas();
      await this.renderLeaderboardPostit();
    } catch (err) {
      window.soundFX.playError();
      fb.className = 'feedback err';
      fb.textContent = err.message;
    }
  }

  // ─── AUTH FORMS ──────────────────────────────────
  async handleRegister(e) {
    e.preventDefault();
    const fb = document.getElementById('authFeedback');
    fb.textContent = '…'; fb.className = 'feedback';

    const nom = document.getElementById('regNom').value.trim();
    const prenom = document.getElementById('regPrenom').value.trim();
    const password = document.getElementById('regPass').value;
    const confirm = document.getElementById('regConfirm').value;

    if (password !== confirm) {
      fb.className = 'feedback err';
      fb.textContent = 'Mots de passe différents.';
      window.soundFX.playError();
      return;
    }

    try {
      const data = await this.api('/api/auth/register', {
        method: 'POST', body: JSON.stringify({ nom, prenom, password })
      });
      this.token = data.token;
      localStorage.setItem('aob_token', data.token);
      this.user = data.user;
      this.user.unlocked = [];

      window.soundFX.playSuccess();
      fb.className = 'feedback ok';
      fb.textContent = 'Dossier créé !';
      setTimeout(() => { this.close('authModal'); this.renderAuth(); this.loadEnigmas(); }, 900);
    } catch (err) {
      window.soundFX.playError();
      fb.className = 'feedback err';
      fb.textContent = err.message;
    }
  }

  async handleLogin(e) {
    e.preventDefault();
    const fb = document.getElementById('authFeedback');
    fb.textContent = '…'; fb.className = 'feedback';

    const nom = document.getElementById('logNom').value.trim();
    const prenom = document.getElementById('logPrenom').value.trim();
    const password = document.getElementById('logPass').value;

    try {
      const data = await this.api('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ nom, prenom, password })
      });
      this.token = data.token;
      localStorage.setItem('aob_token', data.token);
      this.user = data.user;

      window.soundFX.playSuccess();
      fb.className = 'feedback ok';
      fb.textContent = 'Connexion réussie.';
      setTimeout(async () => {
        this.close('authModal');
        await this.fetchMe();
        await this.loadEnigmas();
      }, 800);
    } catch (err) {
      window.soundFX.playError();
      fb.className = 'feedback err';
      fb.textContent = err.message;
    }
  }

  // ─── LEADERBOARD ─────────────────────────────────
  async openLeaderboard() {
    this.open('lbModal');
    const tbody = document.getElementById('lbBody');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">Chargement…</td></tr>';

    try {
      const data = await this.api('/api/leaderboard');
      if (!data.leaderboard.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">Aucun agent inscrit.</td></tr>';
        return;
      }
      tbody.innerHTML = data.leaderboard.map(r => `
        <tr>
          <td><strong>#${r.rank}</strong></td>
          <td>${this.esc(r.nom)} ${this.esc(r.prenom)}</td>
          <td>${r.solvedCount} / 9</td>
          <td>${r.masterSolved ? '<span class="badge badge-ok">TROUVÉ</span>' : '<span class="badge badge-no">Non</span>'}</td>
        </tr>
      `).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="color:#e74c3c">${err.message}</td></tr>`;
    }
  }

  // ─── ADMIN ───────────────────────────────────────
  async openAdmin() {
    if (!this.user || this.user.role !== 'admin') return;
    this.open('adminModal');
    this.bindAdminTabs();
    await this.loadAdmin();
  }

  bindAdminTabs() {
    const tabs = [
      { btn: 'aTabD', sec: 'aSecD' },
      { btn: 'aTabS', sec: 'aSecS' },
      { btn: 'aTabM', sec: 'aSecM' },
    ];
    tabs.forEach(({ btn, sec }) => {
      document.getElementById(btn).onclick = () => {
        tabs.forEach(t => {
          document.getElementById(t.btn).classList.remove('active');
          document.getElementById(t.sec).style.display = 'none';
        });
        document.getElementById(btn).classList.add('active');
        document.getElementById(sec).style.display = 'block';
      };
    });
    document.getElementById('adminMasterForm').onsubmit = (e) => this.saveMaster(e);
    document.getElementById('sSearch').oninput = (e) => this.filterStudents(e.target.value);
  }

  async loadAdmin() {
    try {
      const data = await this.api('/api/admin/dashboard');
      document.getElementById('kpiS').textContent = data.stats.totalStudents;
      document.getElementById('kpiR').textContent = data.stats.totalSolves;
      document.getElementById('kpiM').textContent = data.stats.totalMasterSolvers;

      if (data.master) {
        document.getElementById('aMasterTitle').value = data.master.title || '';
        document.getElementById('aMasterMsg').value   = data.master.reward_message || '';
      }

      this.renderAdminDossiers(data.enigmas);
      this.allStudents = data.students;
      this.renderAdminStudents(data.students);
    } catch (err) { alert(err.message); }
  }

  renderAdminDossiers(enigmas) {
    document.getElementById('adminDossiersList').innerHTML = enigmas.map(e => `
      <div class="admin-dos-item">
        <div>
          <div class="admin-dos-label">DOSSIER #${String(e.node_number).padStart(2,'0')}</div>
          <div class="admin-dos-sub">${this.esc(e.clue_title)}</div>
        </div>
        <div class="admin-dos-actions">
          <button class="btn-sm ${e.is_active ? 'btn-active' : ''}" onclick="window.app.toggleDossier(${e.id}, ${!e.is_active})">
            ${e.is_active ? 'Désactiver' : 'Activer'}
          </button>
          <button class="btn-sm" onclick="window.app.editDossier(${e.id})">Éditer</button>
        </div>
      </div>
    `).join('');
  }

  renderAdminStudents(students) {
    const tbody = document.getElementById('adminStudentsList');
    if (!students.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">Aucun étudiant.</td></tr>';
      return;
    }
    tbody.innerHTML = students.map(s => `
      <tr>
        <td>#${s.id}</td>
        <td>${this.esc(s.nom)} ${this.esc(s.prenom)}</td>
        <td style="font-size:11px;color:var(--muted)">${new Date(s.registeredAt).toLocaleString('fr-FR')}</td>
        <td>${s.unlockedNodes.length} / 9</td>
        <td>${s.masterSolved ? '<span class="badge badge-ok">Oui</span>' : '<span class="badge badge-no">Non</span>'}</td>
      </tr>
    `).join('');
  }

  filterStudents(q) {
    if (!this.allStudents) return;
    const clean = q.toLowerCase();
    this.renderAdminStudents(
      this.allStudents.filter(s => s.nom.toLowerCase().includes(clean) || s.prenom.toLowerCase().includes(clean))
    );
  }

  async toggleDossier(id, active) {
    try {
      await this.api(`/api/admin/enigma/${id}`, {
        method: 'PUT', body: JSON.stringify({ is_active: active })
      });
      await this.loadAdmin();
      await this.loadEnigmas();
      window.soundFX.playSuccess();
    } catch (err) { alert(err.message); }
  }

  async editDossier(id) {
    const pass = prompt('Nouveau mot de passe (sera chiffré) :');
    if (!pass) return;
    const content = prompt('Nouveau texte de l\'indice :');
    if (!content) return;

    try {
      await this.api(`/api/admin/enigma/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ secret_password: pass, clue_content: content })
      });
      await this.loadAdmin();
      await this.loadEnigmas();
      window.soundFX.playSuccess();
    } catch (err) { alert(err.message); }
  }

  async saveMaster(e) {
    e.preventDefault();
    const code  = document.getElementById('aMasterCode').value.trim();
    const title = document.getElementById('aMasterTitle').value.trim();
    const msg   = document.getElementById('aMasterMsg').value.trim();

    try {
      await this.api('/api/admin/master', {
        method: 'PUT',
        body: JSON.stringify({ master_code: code || undefined, title, reward_message: msg })
      });
      window.soundFX.playSuccess();
      alert('Mis à jour.');
    } catch (err) {
      window.soundFX.playError();
      alert(err.message);
    }
  }

  // ─── MODAL HELPERS ───────────────────────────────
  open(id) {
    const m = document.getElementById(id);
    if (m) { m.classList.add('open'); window.soundFX.playClick(); }
  }

  close(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('open');
  }

  bindModals() {
    // Close on backdrop
    document.querySelectorAll('.modal-bg').forEach(bg => {
      bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); });
    });

    // Close buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => this.close(btn.dataset.close));
    });

    // Auth tabs
    document.getElementById('tabReg').addEventListener('click', () => {
      document.getElementById('tabReg').classList.add('active');
      document.getElementById('tabLog').classList.remove('active');
      document.getElementById('regForm').style.display = 'block';
      document.getElementById('logForm').style.display = 'none';
      document.getElementById('authFeedback').textContent = '';
    });
    document.getElementById('tabLog').addEventListener('click', () => {
      document.getElementById('tabLog').classList.add('active');
      document.getElementById('tabReg').classList.remove('active');
      document.getElementById('logForm').style.display = 'block';
      document.getElementById('regForm').style.display = 'none';
      document.getElementById('authFeedback').textContent = '';
    });

    document.getElementById('regForm').addEventListener('submit', e => this.handleRegister(e));
    document.getElementById('logForm').addEventListener('submit', e => this.handleLogin(e));
    document.getElementById('unlockForm').addEventListener('submit', e => this.handleUnlock(e));
    document.getElementById('adminBtn').addEventListener('click', () => this.openAdmin());
    document.getElementById('openMasterBtn').addEventListener('click', () => {
      document.querySelectorAll('.mslot').forEach(s => s.value = '');
      document.getElementById('masterFeedback').textContent = '';
      document.getElementById('victoryBox').style.display = 'none';
      this.open('masterModal');
      setTimeout(() => document.querySelector('.mslot').focus(), 150);
    });
    document.getElementById('masterInputsMain').addEventListener('click', () => {
      document.getElementById('openMasterBtn').click();
    });
    const closePrezBtn = document.getElementById('closePrezBtn');
    if (closePrezBtn) {
      closePrezBtn.addEventListener('click', () => {
        document.getElementById('viewPrez').style.display = 'none';
        document.getElementById('viewBoard').style.display = 'flex';
      });
    }
  }

  openPrez() {
    window.soundFX.playSuccess();
    document.getElementById('viewBoard').style.display = 'none';
    document.getElementById('viewPrez').style.display = 'block';
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      if (this.currentView === 'board') this.drawThreads();
    });
  }

  esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}

window.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
