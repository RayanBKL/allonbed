// ═══════════════════════════════════════════════════
// ALL ON BED — 360° PANORAMIC OFFICE VIEWER
// Method: equirectangular texture on inverted sphere
// → Zero seams, full 360°, natural floor/ceiling
// ═══════════════════════════════════════════════════

class Office3D {
  constructor(canvasId, callbacks) {
    this.canvas    = document.getElementById(canvasId);
    this.callbacks = callbacks || {};
    this.isInited  = false;
    this.animFrame = null;
    this.hotspots  = [];
    this.hovered   = null;

    // Camera rotation state
    this.yaw      = 0;      // horizontal angle (radians)
    this.pitch    = 0;      // vertical angle
    this.yawVel   = 0;
    this.pitchVel = 0;
    this.dragging = false;
    this.didDrag  = false;
    this.lastX    = 0;
    this.lastY    = 0;

    this.texturesReady = false;
    this.loadProgress  = 0;
  }

  init(enigmas) {
    this.enigmas = enigmas || [];
    if (this.isInited) return;
    this.isInited = true;
    this._setup();
    this._loadPanorama();
  }

  // ─── RENDERER SETUP ────────────────────────────
  _setup() {
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      75,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1, 2000
    );
    this.camera.position.set(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true
    });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this._bindInput();
    window.addEventListener('resize', () => this._onResize());
    this._loop();
  }

  // ─── PANORAMA SPHERE ───────────────────────────
  _loadPanorama() {
    const loader = new THREE.TextureLoader();
    loader.load(
      '/assets/panorama.jpg',
      (tex) => {
        tex.encoding   = THREE.sRGBEncoding;
        tex.minFilter  = THREE.LinearFilter;
        tex.magFilter  = THREE.LinearFilter;
        tex.generateMipmaps = false;

        // Sphere large enough to surround camera, normals flipped inward
        const geo = new THREE.SphereGeometry(500, 80, 40);
        // Flip normals so we see inside
        geo.scale(-1, 1, 1);

        const mat  = new THREE.MeshBasicMaterial({ map: tex });
        this.sphere = new THREE.Mesh(geo, mat);
        this.scene.add(this.sphere);

        // Build clickable hotspots over the sphere
        this._buildHotspots();

        this.loadProgress  = 1;
        this.texturesReady = true;
      },
      (xhr) => {
        this.loadProgress = xhr.loaded / (xhr.total || 1);
      },
      (err) => {
        console.error('Panorama load error:', err);
        // Fallback — dark sphere
        const geo = new THREE.SphereGeometry(500, 60, 30);
        geo.scale(-1, 1, 1);
        this.sphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0a0806 }));
        this.scene.add(this.sphere);
        this._buildHotspots();
        this.texturesReady = true;
      }
    );
  }

  // ─── HOTSPOTS ON SPHERE ────────────────────────
  // Each hotspot = an invisible plane near the sphere surface,
  // positioned at the correct yaw angle for that element in the panorama.
  // The panorama image: 0° left = bookshelf, 90° = window, 180° = corkboard, 270° = desk
  // (Based on the panorama image generated: degrees shown are 0,45,90,180,225,270)
  _buildHotspots() {
    const R = 490; // just inside sphere

    // Helper: convert yaw/pitch angles to a point on sphere
    const spherePoint = (yawDeg, pitchDeg, r) => {
      const y = THREE.MathUtils.degToRad(yawDeg);
      const p = THREE.MathUtils.degToRad(pitchDeg);
      return [
        r * Math.sin(y) * Math.cos(p),
        r * Math.sin(p),
        -r * Math.cos(y) * Math.cos(p)
      ];
    };

    // The panorama image yaw=0 corresponds to the BACK of the default view
    // Our camera starts at yaw=0 facing -Z.
    // SphereGeometry with scale(-1,1,1): when yaw=0, we look at the center of the panorama.
    // Based on the generated panorama: corkboard is at center (~180° in image = facing camera default)
    // Let me map the zones:
    // Corkboard   → panorama center → camera default front → yaw offset = 0 (facing -Z)
    // Desk        → right of corkboard → yaw ~ +40°
    // Window      → further right → yaw ~ +90°
    // Bookshelf   → left of corkboard / far left → yaw ~ -140° (or +220°)

    // After scale(-1,1,1), horizontal texture is mirrored:
    // U=0.5 (center of panorama = corkboard) maps to the front (-Z)
    // U=0 and U=1 (edges = bookshelf) map to behind (+Z)
    // U=0.25 (window, 90°) maps to yaw = 90° right (+X side)
    // U=0.75 (desk, 270°) maps to yaw = -90° left (-X side)

    const zones = [
      {
        label: 'CODE FINAL — BUREAU',
        color: '#00d4aa',
        action: 'desk',
        yaw: 0,      // Center of panorama (desk)
        pitch: -10,
        w: 160, h: 100
      },
      {
        label: 'TABLEAU D\'ENQUÊTE',
        color: '#d4af37',
        action: 'board',
        yaw: 45,     // Right of desk
        pitch: 5,
        w: 180, h: 130
      },
      {
        label: 'CLASSEMENT',
        color: '#d4af37',
        action: 'door',
        yaw: 120,    // Far right (bookshelves)
        pitch: 0,
        w: 150, h: 130
      },
      {
        label: 'FENÊTRE',
        color: '#5599ff',
        action: 'window',
        yaw: -90,    // Far left (big window)
        pitch: 5,
        w: 160, h: 120
      }
    ];

    zones.forEach(z => {
      const pos = spherePoint(z.yaw, z.pitch, R);

      // Invisible hit mesh — tangent to sphere at that point
      const hitGeo = new THREE.PlaneGeometry(z.w, z.h);
      const hitMat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false
      });
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.set(...pos);
      // Orient to face the center (camera)
      hit.lookAt(0, 0, 0);
      hit.userData = { action: z.action, label: z.label, color: z.color };
      this.scene.add(hit);
      this.hotspots.push(hit);

      // Glow ring (visible on hover)
      const glowMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(z.color),
        transparent: true, opacity: 0.0,
        side: THREE.DoubleSide, depthWrite: false
      });
      const glowGeo = new THREE.PlaneGeometry(z.w + 10, z.h + 10);
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(...pos);
      glow.lookAt(0, 0, 0);
      this.scene.add(glow);
      hit.userData.glowMat = glowMat;

      // Label sprite
      this._addLabel(pos, z.label, z.color, R);
    });
  }

  _addLabel(pos, text, color, R) {
    const canvas = document.createElement('canvas');
    canvas.width  = 512;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');

    // Pill background
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 56, 10);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Icon dot
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(32, 36, 6, 0, Math.PI * 2);
    ctx.fill();

    // Text
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 24px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 262, 36);

    const tex = new THREE.CanvasTexture(canvas);
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
    );

    // Place slightly inward + above hotspot
    const dir = new THREE.Vector3(...pos).normalize();
    const labelPos = dir.multiplyScalar(R - 2);
    spr.position.set(labelPos.x, labelPos.y + 50, labelPos.z);
    spr.scale.set(120, 18, 1);
    this.scene.add(spr);
  }

  // ─── INPUT ─────────────────────────────────────
  _bindInput() {
    const c = this.canvas;

    c.addEventListener('mousedown', e => {
      this.dragging = true; this.didDrag = false;
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    c.addEventListener('mousemove', e => {
      if (this.dragging) {
        this.yawVel   -= (e.clientX - this.lastX) * 0.003;
        this.pitchVel -= (e.clientY - this.lastY) * 0.0018;
        this.lastX = e.clientX; this.lastY = e.clientY;
        this.didDrag = true;
      }
      // Hover
      const rect = c.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      this._checkHover();
    });
    c.addEventListener('mouseup', () => {
      if (!this.didDrag) this._handleClick();
      this.dragging = false;
    });
    c.addEventListener('mouseleave', () => { this.dragging = false; });

    // Touch
    c.addEventListener('touchstart', e => {
      const t = e.touches[0];
      this.dragging = true; this.didDrag = false;
      this.lastX = t.clientX; this.lastY = t.clientY;
    }, { passive: true });
    c.addEventListener('touchmove', e => {
      const t = e.touches[0];
      this.yawVel   -= (t.clientX - this.lastX) * 0.004;
      this.pitchVel -= (t.clientY - this.lastY) * 0.003;
      this.lastX = t.clientX; this.lastY = t.clientY;
      this.didDrag = true;
    }, { passive: true });
    c.addEventListener('touchend', () => {
      if (!this.didDrag) this._handleClick();
      this.dragging = false;
    });
  }

  _checkHover() {
    if (!this.texturesReady) return;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.hotspots);
    const prev = this.hovered;

    if (hits.length) {
      this.hovered = hits[0].object;
      this.canvas.style.cursor = 'pointer';
      if (this.hovered.userData.glowMat)
        this.hovered.userData.glowMat.opacity = 0.22;
    } else {
      this.hovered = null;
      this.canvas.style.cursor = 'grab';
    }

    if (prev && prev !== this.hovered && prev.userData.glowMat)
      prev.userData.glowMat.opacity = 0.0;
  }

  _handleClick() {
    if (!this.texturesReady) return;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.hotspots);
    if (!hits.length) return;
    const action = hits[0].object.userData.action;
    if (this.callbacks[action]) this.callbacks[action]();
  }

  _onResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // ─── RENDER LOOP ───────────────────────────────
  _loop() {
    this.animFrame = requestAnimationFrame(() => this._loop());

    // Momentum physics
    this.yaw   += this.yawVel;
    this.pitch += this.pitchVel;
    this.yawVel   *= 0.88;
    this.pitchVel *= 0.88;

    // Clamp vertical (don't flip)
    this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch));

    // Camera look direction from yaw/pitch
    const lx = Math.sin(this.yaw)   * Math.cos(this.pitch);
    const ly = Math.sin(this.pitch);
    const lz = -Math.cos(this.yaw)  * Math.cos(this.pitch);
    this.camera.lookAt(lx, ly, lz);

    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    if (this.renderer)  this.renderer.dispose();
  }
}

window.Office3D = Office3D;
