// =====================================================================
// VIEWMODEL NOVO: armas e mãos em primeira pessoa (arte de referência do dono)
// Folha: M4A1-S, P2000, SPAS-12, UMP-45, faca e KAR 98K com luvas azuis, e os braços
// erguidos quando o RB-04 está sem arma. O desenho é o da referência; as animações
// movem as peças recortadas dele (arma, braço esquerdo, pente, telha da SPAS).
// Coordenadas das armas = pixels da folha de referência (tools/viewmodel).
// =====================================================================
const VM_ATLAS_SRC = '__VM_ATLAS__';
const VM_META = __VM_META__;
// Tamanho na tela: quantos pixels da folha cabem na altura da tela (menor = arma maior)
const VM_REF_H = 850;
// Cada arma: canto da arte preso na tela (home), pivô do coice (grip), massa de mira
// (sight), boca do cano (muzzle, dir = para onde o cano aponta, em graus), janela de
// ejeção (eject), mira (ads: escala, rotação, quanto abaixo da cruz fica a massa)
const VM_W = {
  m4: {
    home: [424, 472], at: 'right', scale: 1.0, grip: [335, 420], sight: [161, 139],
    muzzle: [41, 92], dir: 219.5, flash: 0.7, eject: [298, 262], shell: 'rifle',
    ads: { s: 1.1, rot: 5, gap: 70 }, kick: { back: 16, rot: 2.6, up: 4 },
    mag: { ang: 93 }, hand: [185, 252], handToMag: [45, 238], reload: { rot: 10, dx: -70, dy: -150 },
  },
  ump: {
    home: [1517, 472], at: 'right', scale: 1.0, grip: [1345, 440], sight: [1192, 142],
    muzzle: [1168, 193], dir: 209.5, flash: 0.8, eject: [1330, 262], shell: 'rifle',
    ads: { s: 1.1, rot: 5, gap: 70 }, kick: { back: 14, rot: 2.2, up: 4 },
    mag: { ang: 90 }, hand: [1178, 290], handToMag: [60, 184], reload: { rot: 9, dx: -70, dy: -150 },
  },
  shotgun: {
    home: [1100, 472], at: 'right', scale: 1.0, grip: [965, 450], sight: [768, 156],
    muzzle: [757, 160], dir: 209.5, flash: 1.35, eject: [905, 262], shell: 'shotgun',
    ads: { s: 1.08, rot: 5, gap: 70 }, kick: { back: 30, rot: 7, up: 8 },
    pump: 26, port: [905, 352],
  },
  pistol: {
    home: [557, 472], at: 'center', scale: 1.0, grip: [557, 430], sight: [557, 168],
    muzzle: [557, 158], dir: 270, flash: 1.5, front: true, eject: [598, 226], shell: 'pistol',
    ads: { s: 1.28, rot: 0, drop: 10 }, kick: { back: 0, rot: 0, up: 22 },
  },
  kar: {
    home: [714, 986], at: 'center', dx: 0.36, scale: 0.94, grip: [880, 925], sight: [547, 566],
    muzzle: [545, 564], dir: 235, flash: 1.3, eject: [745, 778], shell: 'rifle',
    ads: { s: 1.06, rot: 0, drop: 0 }, kick: { back: 34, rot: 6, up: 10 },
  },
  knife: {
    home: [245, 978], at: 'center', dx: 0.34, scale: 1.0, grip: [195, 860], sight: [245, 700],
  },
};
const VM_HANDS = { home: [783, 1004], ref: 1004 };

let vmImg = null, vmOk = false;
const vmLayers = {};            // 'arma.camada' -> canvas (sem skin)
const vmSkinned = {};           // 'arma.camada.skin' -> canvas
(function vmLoad() {
  vmImg = new Image();
  vmImg.onload = () => {
    for (const key in VM_META.weapons) {
      const W = VM_META.weapons[key];
      for (const name in W.layers) {
        const L = W.layers[name];
        const c = document.createElement('canvas');
        c.width = L.w; c.height = L.h;
        c.getContext('2d').drawImage(vmImg, L.ax, L.ay, L.w, L.h, 0, 0, L.w, L.h);
        vmLayers[key + '.' + name] = c;
      }
    }
    vmOk = true;
  };
  vmImg.src = VM_ATLAS_SRC;
})();

const vmCanvas = document.createElement('canvas');
vmCanvas.id = 'vm-view';
document.getElementById('gun-display').insertAdjacentElement('afterend', vmCanvas);
const vmCtx = vmCanvas.getContext('2d');

// ---------- estado das animações ----------
const vm = {
  last: 0, aimT: 0, mv: 0, bobPh: 0, bobPrev: 0, swayX: 0, swayY: 0, yaw: 0, pitch: 0,
  kick: 0, kickV: 0, land: 0, landV: 0, wasGround: true, weapon: '', shots: [],
  parts: [], shells: [], muzzle: null, flashT: -1e9, flashW: '', karAct: null,
  handsT: 0, handsOn: false, magDropped: -1, drawSeen: 0,
};
let vmMuzzleNDC = null;          // boca do cano na tela (para o rastro da bala sair dela)

// eventos vindos do jogo
function vmOnShot(w) {
  const now = performance.now();
  vm.flashT = now; vm.flashW = w; vm.flashRot = Math.random() * Math.PI;
  vm.kickV += w === 'shotgun' || w === 'kar' ? 62 : w === 'pistol' ? 40 : 27;
  if (w !== 'shotgun' && w !== 'kar' && w !== 'knife') vmSpawnShell(w, 0.35);
}
function vmKarEvent(kind, ms) {
  vm.karAct = kind ? { kind, t0: performance.now(), ms, ejected: false, clip: false } : null;
}

// ---------- utilitários ----------
const vmClamp = (x, a, b) => Math.max(a, Math.min(b, x));
const vmEase = t => { t = vmClamp(t, 0, 1); return t * t * (3 - 2 * t); };
const vmOut = t => { t = vmClamp(t, 0, 1); return 1 - (1 - t) * (1 - t); };
const vmIn = t => { t = vmClamp(t, 0, 1); return t * t; };
const vmLerp = (a, b, t) => a + (b - a) * t;
const vmRad = d => d * Math.PI / 180;
// sobe de 0 a 1 entre a e b, fica em 1, desce entre c e d
function vmEnv(p, a, b, c, d) {
  if (p <= a || p >= d) return 0;
  if (p < b) return vmEase((p - a) / (b - a));
  if (p <= c) return 1;
  return 1 - vmEase((p - c) / (d - c));
}
// pulso curto (tranco) centrado em c
function vmPulse(p, c, w) {
  const x = (p - c) / w;
  return x < 0 || x > 1 ? 0 : Math.sin(x * Math.PI) * (1 - x);
}
function vmLayer(key, name) {
  const base = vmLayers[key + '.' + name];
  if (!base) return null;
  if (name.startsWith('arm')) return base;
  const skinW = selectedSkins && selectedSkins[key];
  if (!skinW || skinW === 'default' || typeof getSkinDef !== 'function') return base;
  const skin = getSkinDef(key, skinW);
  const id = key + '.' + name + '.' + skin.id;
  if (vmSkinned[id]) return vmSkinned[id];
  let c = null;
  try {
    if (skin.id === 'pink') c = makePinkCanvas(base);
    else if (skin.tex) c = makeTexturedCanvas(base, skin);
    else if (skin.tint) c = makeTintedCanvas(base, skin.tint);
  } catch (e) { c = null; }
  if (!c) return base;
  return (vmSkinned[id] = c);
}

// ---------- cápsulas, pentes caindo ----------
function vmSpawnShell(w, delay) {
  vm.shells.push({ w, born: performance.now() + (delay || 0) * 0, pending: true, kind: VM_W[w] && VM_W[w].shell });
}
function vmDropPart(img, sx, sy, rot, scale, vx, vy, vr) {
  vm.parts.push({ img, x: sx, y: sy, r: rot, s: scale, vx, vy, vr, t: 0 });
}

// ---------- quadro ----------
function vmResize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (vmCanvas.width !== w || vmCanvas.height !== h) {
    vmCanvas.width = w; vmCanvas.height = h;
  }
  vmCtx.imageSmoothingEnabled = false;
}
function vmHide() {
  if (vmCanvas.style.visibility !== 'hidden') {
    vmCanvas.style.visibility = 'hidden';
    vmCtx.setTransform(1, 0, 0, 1, 0, 0);
    vmCtx.clearRect(0, 0, vmCanvas.width, vmCanvas.height);
  }
  vmMuzzleNDC = null;
}

// Chamado no começo do drawGun(). Devolve true quando o viewmodel novo desenhou o quadro
// (o canvas antigo da arma fica vazio).
function vmDrawFrame() {
  const now = performance.now();
  const dt = Math.min(0.1, vm.last ? (now - vm.last) / 1000 : 1 / 60);
  vm.last = now;
  if (!gameStarted || mainMenuOpen) { vmHide(); gunCtx.clearRect(-GUN_PAD_X, 0, GUN_VIEW_W, GUN_VIEW_H); karSetAds(false); return true; }
  if (isHealing) { vmHide(); karSetAds(false); return false; }
  const clash = storyMode && stChapter === 2 && c2Clash;
  const improv = !clash && !storyUnarmed && currentWeapon === 'knife' && typeof c2UseImprov === 'function' && c2UseImprov();
  if (improv || !vmOk) { vmHide(); karSetAds(false); return false; }
  gunCtx.clearRect(-GUN_PAD_X, 0, GUN_VIEW_W, GUN_VIEW_H);
  vmResize();
  const ctx = vmCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, vmCanvas.width, vmCanvas.height);
  const frozen = isPaused || skinMenuOpen || gameState.gameOver;
  vmUpdateCommon(frozen ? 0 : dt, now);
  const hands = storyUnarmed && !clash;
  vmCanvas.classList.toggle('vm-hands', hands);
  if (hands) {
    vmDrawHands(ctx, now, dt);
    karSetAds(false);
  } else if (clash) {
    vmDrawClash(ctx, now);
    karSetAds(false);
  } else {
    vm.handsOn = false;
    vmDrawWeapon(ctx, currentWeapon, now, frozen ? 0 : dt);
    karSetAds(currentWeapon === 'kar' && isAiming && vm.aimT > 0.6);
  }
  vmUpdateParts(ctx, frozen ? 0 : dt);
  vmCanvas.style.visibility = 'visible';
  return true;
}

// balanço ao andar, respiração, inércia do mouse, pulo e aterrissagem
function vmUpdateCommon(dt, now) {
  const mvTarget = vmClamp(playerMoveSpeed / playerSpeed, 0, 1.6);
  vm.mv += (mvTarget - vm.mv) * Math.min(1, dt * 8);
  // fase do passo: acompanha o bobTimer do jogo (que volta a zero ao parar)
  if (bobTimer > vm.bobPrev) vm.bobPh += bobTimer - vm.bobPrev;
  vm.bobPrev = bobTimer;
  vm.aimT += ((isAiming ? 1 : 0) - vm.aimT) * Math.min(1, dt * 11);
  if (Math.abs(vm.aimT - (isAiming ? 1 : 0)) < 0.002) vm.aimT = isAiming ? 1 : 0;
  // inércia: a arma fica um pouco para trás quando o olhar gira
  let dyaw = currentYaw - vm.yaw, dpitch = currentPitch - vm.pitch;
  vm.yaw = currentYaw; vm.pitch = currentPitch;
  if (Math.abs(dyaw) > 1) dyaw = 0;
  const k = (1 - vm.aimT * 0.7);
  vm.swayX += (vmClamp(dyaw * 900, -34, 34) * k - vm.swayX) * Math.min(1, dt * 10);
  vm.swayY += (vmClamp(-dpitch * 900, -26, 26) * k - vm.swayY) * Math.min(1, dt * 10);
  // coice e aterrissagem: molas amortecidas (passos curtos para não explodir)
  if (onGround && !vm.wasGround) vm.landV += 7;
  vm.wasGround = onGround;
  const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
  for (let i = 0; i < n; i++) {
    vm.kickV += (-600 * vm.kick - 40 * vm.kickV) * h;
    vm.kick += vm.kickV * h;
    vm.landV += (-300 * vm.land - 26 * vm.landV) * h;
    vm.land += vm.landV * h;
  }
  vm.kick = vmClamp(vm.kick, -0.5, 1.8);
}

// pose básica da arma (balanço, respiração, mira, pulo, agachar, inclinar)
function vmBasePose(now) {
  const a = vm.aimT, walk = (1 - a * 0.8) * Math.min(1, vm.mv);
  const ph = vm.bobPh;
  const pose = {
    x: Math.cos(ph) * 20 * walk + vm.swayX,
    y: Math.abs(Math.sin(ph)) * 13 * walk + vm.swayY,
    r: 0, s: 1,
  };
  const br = 1 - a * 0.75;
  pose.x += Math.sin(now / 1300) * 2.2 * br;
  pose.y += Math.sin(now / 880) * 3 * br;
  pose.r += vmRad(Math.sin(now / 1700) * 0.35 * br);
  pose.y += vmClamp(-jumpVelocity * 55, -16, 16) + vm.land * 16;
  pose.y += crouchAmount * 12 * (1 - a);
  return pose;
}

// posição da arma na tela: pivô (grip) e escala, misturando quadril e mira
function vmPlace(key, cw, ch) {
  const C = VM_W[key];
  const k = ch / VM_REF_H * (C.scale || 1);
  let hx, hy;
  if (C.at === 'right') { hx = cw; hy = ch; }
  else { hx = cw * 0.5 + (C.dx || 0) * ch; hy = ch; }
  // pivô na posição de repouso
  const px = hx + (C.grip[0] - C.home[0]) * k, py = hy + (C.grip[1] - C.home[1]) * k;
  let ax = px, ay = py, as = 1, ar = 0;
  if (C.ads) {
    as = C.ads.s; ar = vmRad(C.ads.rot || 0);
    // ponto que vai para o centro da tela: a massa de mira (P2000, KAR) ou um ponto à
    // frente da boca do cano (armas desenhadas de lado: o cano aponta para a cruz)
    let sx0 = C.sight[0], sy0 = C.sight[1];
    if (C.ads.gap) { const d = vmRad(C.dir); sx0 = C.muzzle[0] + Math.cos(d) * C.ads.gap; sy0 = C.muzzle[1] + Math.sin(d) * C.ads.gap; }
    const qx = (sx0 - C.grip[0]) * k * as, qy = (sy0 - C.grip[1]) * k * as;
    const cs = Math.cos(ar), sn = Math.sin(ar);
    ax = cw / 2 - (qx * cs - qy * sn);
    ay = ch / 2 + (C.ads.drop || 0) * k - (qx * sn + qy * cs);
  }
  return { k, px, py, ax, ay, as, ar };
}

// desenha uma arma inteira com a pose calculada
function vmDrawWeapon(ctx, key, now, dt) {
  const C = VM_W[key];
  if (!C) return;
  const cw = vmCanvas.width, ch = vmCanvas.height;
  if (vm.weapon !== key) { vm.weapon = key; vm.kick = 0; vm.kickV = 0; vm.magDropped = -1; }
  const P = vmPlace(key, cw, ch);
  const base = vmBasePose(now);
  const pose = { x: 0, y: 0, r: 0, s: 1, L: {}, held: null, hideMag: false, flash: 0 };
  vmActionPose(key, C, now, pose, P);
  const a = key === 'knife' ? 0 : vmEase(vm.aimT);
  // recuo (mola): para trás ao longo do cano e cano subindo
  const kb = vm.kick * (1 - a * 0.45);
  const kk = C.kick || { back: 0, rot: 0, up: 0 };
  const back = kk.back * kb, ang = vmRad(C.dir || 0);
  pose.x += -Math.cos(ang) * back;
  pose.y += -Math.sin(ang) * back - kk.up * kb * (C.front ? 1 : 0.4);
  pose.r += vmRad(kk.rot * kb);
  if (C.front) pose.s += 0.05 * kb;
  // inclinação Q/E (o jogo calcula gunTiltCurrent em graus)
  pose.r += vmRad(gunTiltCurrent || 0) * (key === 'knife' ? 0.6 : 1);

  const px = vmLerp(P.px, P.ax, a) + (base.x + pose.x) * P.k;
  const py = vmLerp(P.py, P.ay, a) + (base.y + pose.y) * P.k;
  const rot = vmLerp(0, P.ar, a) + base.r + pose.r;
  const sc = P.k * vmLerp(1, P.as, a) * base.s * pose.s;
  const M = { px: Math.round(px), py: Math.round(py), rot, sc, sx: pose.sx === undefined ? 1 : pose.sx, gx: C.grip[0], gy: C.grip[1] };
  vm.lastM = M;
  const m = C.muzzle ? vmToScreen(M, C.muzzle[0], C.muzzle[1]) : null;
  if (m && C.front) vmDrawFlash(ctx, key, C, M, m, now);     // P2000 de frente: o clarão sai por trás da arma
  if (key === 'knife') vmKnifeTrail(ctx, C, M, pose);
  vmDrawRig(ctx, key, M, pose, now);
  // boca do cano na tela (clarão e rastro da bala)
  if (m) {
    vm.muzzle = m;
    vmMuzzleNDC = { x: m[0] / cw * 2 - 1, y: -(m[1] / ch * 2 - 1) };
    if (!C.front) vmDrawFlash(ctx, key, C, M, m, now);
    vmEmitShells(key, C, M);
  } else vmMuzzleNDC = null;
}

function vmToScreen(M, x, y) {
  const dx = (x - M.gx) * M.sc * (M.sx === undefined ? 1 : M.sx), dy = (y - M.gy) * M.sc;
  const cs = Math.cos(M.rot), sn = Math.sin(M.rot);
  return [M.px + dx * cs - dy * sn, M.py + dx * sn + dy * cs];
}

function vmDrawRig(ctx, key, M, pose, now) {
  const W = VM_META.weapons[key];
  ctx.save();
  ctx.translate(M.px, M.py);
  ctx.rotate(M.rot);
  ctx.scale(M.sc * (M.sx === undefined ? 1 : M.sx), M.sc);
  ctx.translate(-M.gx, -M.gy);
  const put = (name, T) => {
    const L = W.layers[name];
    const img = vmLayer(key, name);
    if (!L || !img) return;
    if (!T) { ctx.drawImage(img, L.x, L.y); return; }
    if (T.hide) return;
    ctx.save();
    const cx = T.cx !== undefined ? T.cx : L.x + L.w / 2, cy = T.cy !== undefined ? T.cy : L.y + L.h / 2;
    ctx.translate(cx + (T.x || 0), cy + (T.y || 0));
    if (T.r) ctx.rotate(T.r);
    ctx.translate(-cx, -cy);
    ctx.drawImage(img, L.x, L.y);
    ctx.restore();
  };
  put('gun', pose.L.gun);
  if (W.layers.mag && !pose.hideMag) put('mag', pose.L.mag);
  if (pose.held) put('mag', pose.held);             // pente novo na mão
  if (pose.extra) pose.extra(ctx);                  // cartuchos, pente da KAR...
  if (W.layers.pump) put('pump', pose.L.pump);
  if (W.layers.armL) put('armL', pose.L.armL);
  ctx.restore();
}

// ---------- animações de cada arma ----------
function vmActionPose(key, C, now, pose, P) {
  // sacando a arma: sobe de baixo da tela girando
  if (isDrawing) {
    const p = drawProgress();
    const up = 1 - vmOut(p / 0.42);
    pose.y += up * 470;
    pose.x += up * 60;
    pose.r += vmRad(up * 22);
    if (key !== 'knife') {
      // engatilha no fim da subida
      const j = vmPulse(p, 0.58, 0.2);
      pose.y += -j * 10; pose.r += vmRad(-j * 2);
      if (key === 'shotgun') vmPumpPose(C, pose, vmClamp((p - 0.35) / 0.4, 0, 1), true);
      if ((key === 'm4' || key === 'ump') && p > 0.35) {
        const h = vmEnv(p, 0.38, 0.55, 0.62, 0.86);
        pose.L.armL = { x: 22 * h, y: -26 * h, r: vmRad(-8 * h), cx: C.hand[0], cy: C.hand[1] + 260 };
      }
    }
    if (key === 'knife') pose.r += vmRad(up * -40);
  }
  if (key === 'knife') { vmKnifePose(C, now, pose); return; }
  if (key === 'shotgun') {
    if (sgReload) vmShotgunReloadPose(C, now, pose, P);
    else if (isPumping) {
      const q = (now - pumpStartTime - SHOTGUN_RECOIL_MS) / SHOTGUN_PUMP_MS;
      if (q >= 0 && q < 1) vmPumpPose(C, pose, q);
    }
    return;
  }
  if (key === 'kar') { vmKarPose(C, now, pose); return; }
  if (isReloading && (key === 'm4' || key === 'ump')) {
    vmMagReloadPose(key, C, (now - reloadStartTime) / RELOAD_DURATION, pose);
    return;
  }
  if (isReloading && key === 'pistol') vmPistolReloadPose(C, (now - reloadStartTime) / RELOAD_DURATION, pose);
}

// M4 / UMP: tira o pente, a mão esquerda busca outro, encaixa, bate no ferrolho
function vmMagReloadPose(key, C, p, pose) {
  p = vmClamp(p, 0, 1);
  const R = C.reload;
  const tilt = vmEnv(p, 0, 0.13, 0.84, 1);
  pose.r += vmRad(R.rot * tilt);
  pose.x += R.dx * tilt; pose.y += R.dy * tilt;
  // trancos: pente encaixando (som em 76%) e ferrolho (92%)
  pose.y += -9 * vmPulse(p, 0.765, 0.08) + 5 * vmPulse(p, 0.03, 0.08);
  pose.r += vmRad(-2.5 * vmPulse(p, 0.92, 0.07));
  const ma = vmRad(C.mag.ang), mx = Math.cos(ma), my = Math.sin(ma);
  // pente velho: escorrega para fora e cai
  if (p < 0.035) {
    const s = vmIn(p / 0.035) * 26;
    pose.L.mag = { x: mx * s, y: my * s };
  } else {
    if (vm.magDropped < 0 || vm.magDropped > p) vmDropMag(key, C, pose);
    vm.magDropped = p;
    pose.hideMag = p < 0.765;
  }
  // mão esquerda
  const H = C.handToMag;
  const off = { x: -70, y: 440, r: vmRad(14) };        // fora da tela
  let hx = 0, hy = 0, hr = 0, held = null;
  if (p < 0.05) { /* ainda no guarda-mão */ }
  else if (p < 0.24) { const u = vmEase((p - 0.05) / 0.19); hx = off.x * u; hy = off.y * u; hr = off.r * u; }
  else if (p < 0.34) { hx = off.x; hy = off.y; hr = off.r; }
  else if (p < 0.62) {
    const u = vmOut((p - 0.34) / 0.28);
    hx = vmLerp(off.x, H[0] + mx * 64, u); hy = vmLerp(off.y, H[1] + my * 64, u); hr = vmLerp(off.r, 0, u);
    held = true;
  } else if (p < 0.765) {
    const u = vmEase((p - 0.62) / 0.145);
    const s = 64 * (1 - u);
    hx = H[0] + mx * s; hy = H[1] + my * s; held = true;
  } else if (p < 0.9) {
    const u = vmEase((p - 0.765) / 0.135);
    hx = H[0] * (1 - u); hy = H[1] * (1 - u) - Math.sin(u * Math.PI) * 30; hr = vmRad(-6 * Math.sin(u * Math.PI));
  }
  pose.L.armL = { x: hx, y: hy, r: hr, cx: C.hand[0], cy: C.hand[1] + 260 };
  if (held) pose.held = { x: hx - H[0], y: hy - H[1], r: hr, cx: C.hand[0] + H[0], cy: C.hand[1] + H[1] + 260 };
}
function vmDropMag(key, C, pose) {
  // o pente velho cai como peça solta, a partir da posição atual na tela
  const img = vmLayer(key, 'mag');
  const L = VM_META.weapons[key].layers.mag;
  if (!img || !vm.lastM) return;
  const M = vm.lastM;
  const c = vmToScreen(M, L.x + L.w / 2, L.y + L.h / 2 + 26);
  const ma = vmRad(C.mag.ang) + M.rot;
  vmDropPart(img, c[0], c[1], M.rot, M.sc, Math.cos(ma) * 90 * M.sc, Math.sin(ma) * 260 * M.sc, (Math.random() - 0.3) * 3);
}

// P2000: gira, desce para trocar o carregador, sobe e puxa o ferrolho
function vmPistolReloadPose(C, p, pose) {
  p = vmClamp(p, 0, 1);
  const low = vmEnv(p, 0.0, 0.18, 0.7, 0.9);
  pose.r += vmRad(-24 * low);
  pose.y += 150 * low;
  pose.x += -30 * low;
  // mão trabalhando lá embaixo (pente sai e entra)
  pose.y += 10 * vmPulse(p, 0.22, 0.12) - 16 * vmPulse(p, 0.765, 0.08);
  pose.r += vmRad(3 * vmPulse(p, 0.22, 0.12));
  // puxa o ferrolho (92%): arma vem para perto e volta
  const rk = vmPulse(p, 0.9, 0.1);
  pose.s *= 1 + 0.06 * rk; pose.y += -12 * rk;
}

// SPAS-12: telha + mão esquerda vão para trás e voltam (cartucho sai no meio)
function vmPumpPose(C, pose, q, noEject) {
  const back = q < 0.42 ? vmEase(q / 0.42) : 1 - vmEase((q - 0.5) / 0.42);
  const a = vmRad(29.5);
  pose.L.pump = { x: Math.cos(a) * C.pump * back, y: Math.sin(a) * C.pump * back };
  pose.r += vmRad(1.5 * back);
  pose.y += 4 * back;
  if (q > 0.36 && !vm.pumpEjected && !noEject) { vm.pumpEjected = true; vmSpawnShell('shotgun'); }
  if (q < 0.2) vm.pumpEjected = false;
}
// SPAS-12: recarga cartucho por cartucho pela janela de baixo
function vmShotgunReloadPose(C, now, pose, P) {
  const el = now - sgReload.start;
  let tilt = 1;
  if (sgReload.phase === 'enter') tilt = vmEase(el / SG_RELOAD_ENTER_MS);
  else if (sgReload.phase === 'exit') tilt = 1 - vmEase(el / SG_RELOAD_EXIT_MS);
  pose.r += vmRad(-10 * tilt);
  pose.x += -20 * tilt; pose.y += -70 * tilt;
  if (sgReload.phase === 'insert') {
    const q = el / SG_SHELL_MS;
    pose.y += -7 * vmPulse(q, 0.55, 0.22);
    pose.r += vmRad(-1.2 * vmPulse(q, 0.55, 0.22));
    if (q < 0.6) {
      // cartucho subindo da borda da tela até a janela de carga
      const u = vmEase(q / 0.55);
      pose.extra = (ctx) => vmDrawShellAt(ctx, C.port[0] - 6, C.port[1] + 70 * (1 - u), vmRad(-60), 'shotgun', 1);
    }
  }
}

// KAR 98K: ferrolho depois do tiro e recarga com pente de 5
function vmKarPose(C, now, pose) {
  const A = vm.karAct;
  if (!A) return;
  const p = (now - A.t0) / A.ms;
  if (p >= 1) { vm.karAct = null; return; }
  const ax = vmRad(C.dir);
  const pull = (d) => { pose.x += -Math.cos(ax) * d; pose.y += -Math.sin(ax) * d; };
  if (A.kind === 'bolt') {
    // levanta (20%), puxa (40%), empurra (60%), abaixa (75%)
    const lift = vmEnv(p, 0.06, 0.22, 0.72, 0.92);
    pose.r += vmRad(12 * lift); pose.y += -18 * lift; pose.x += -10 * lift;
    const back = vmEnv(p, 0.24, 0.4, 0.5, 0.64);
    pull(34 * back);
    pose.r += vmRad(2.5 * back);
    if (p > 0.4 && !A.ejected) { A.ejected = true; vmSpawnShell('kar'); }
    pose.y += -4 * vmPulse(p, 0.2, 0.08) - 4 * vmPulse(p, 0.6, 0.08) - 3 * vmPulse(p, 0.75, 0.08);
    return;
  }
  if (A.kind === 'reload') {
    const tilt = vmEnv(p, 0, 0.12, 0.86, 1);
    pose.r += vmRad(11 * tilt); pose.x += -26 * tilt; pose.y += -34 * tilt;
    pull(20 * vmEnv(p, 0.2, 0.27, 0.76, 0.82));
    // cinco cartuchos empurrados (47%..63%)
    let pressed = 0;
    [0.47, 0.51, 0.55, 0.59, 0.63].forEach(m => { pose.y += 4 * vmPulse(p, m, 0.035); if (p > m) pressed++; });
    pose.y += -3 * vmPulse(p, 0.15, 0.06) - 4 * vmPulse(p, 0.8, 0.06) - 3 * vmPulse(p, 0.87, 0.06);
    if (p > 0.3 && p < 0.66) {
      const inT = vmOut((p - 0.3) / 0.14);
      pose.extra = (ctx) => vmDrawClip(ctx, C, inT, pressed, p);
    }
    if (p > 0.66 && !A.clip) {
      A.clip = true;
      const M = vm.lastM;
      if (M) {
        const s = vmToScreen(M, C.eject[0] - 4, C.eject[1] - 40);
        vmDropPart('clip', s[0], s[1], M.rot, M.sc, 160 * M.sc, -380 * M.sc, 7);
      }
    }
  }
}
// pente de 5 cartuchos em cima da culatra, descendo a cada cartucho
function vmDrawClip(ctx, C, inT, pressed, p) {
  // em cima da culatra; cada cartucho empurrado desce o pente para dentro (perpendicular ao cano)
  const perp = vmRad(C.dir + 90), down = vmRad(C.dir - 90);
  const far = (1 - inT) * 150, push = pressed * 6;
  const bx = C.eject[0] + Math.cos(perp) * (34 + far) + Math.cos(down) * push * -1;
  const by = C.eject[1] + Math.sin(perp) * (34 + far) + Math.sin(down) * push * -1;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(vmRad(C.dir - 270));
  vmPaintClip(ctx, 5 - pressed);
  ctx.restore();
}
function vmPaintClip(ctx, n) {
  // pixels grandes como os do desenho (1 px da arte ~ 5,7 px da folha)
  const u = 5.7;
  ctx.fillStyle = '#3a3a3e'; ctx.fillRect(-u * 3.2, -u * 0.6, u * 6.4, u * 1.4);      // lâmina do pente
  for (let i = 0; i < n; i++) {
    const x = -u * 2.6 + i * u * 1.3;
    ctx.fillStyle = '#6b4a14'; ctx.fillRect(x, -u * 5.4, u * 1.1, u * 4.8);            // estojo (sombra)
    ctx.fillStyle = '#c9982f'; ctx.fillRect(x, -u * 5.4, u * 0.7, u * 4.8);            // latão
    ctx.fillStyle = '#e8c35a'; ctx.fillRect(x + u * 0.1, -u * 5.2, u * 0.3, u * 3.6);  // brilho
    ctx.fillStyle = '#8a5a2a'; ctx.fillRect(x + u * 0.15, -u * 7.2, u * 0.8, u * 1.9); // projétil
  }
}

// ---------- faca ----------
const VM_KNIFE = {
  slash: 340, takedown: 750, inspect: 1760,
};
function vmKnifePose(C, now, pose) {
  const A = nkAct;
  if (!A) return;
  const dur = VM_KNIFE[A.name] || 400;
  const p = (now - A.t0) / dur;
  if (p >= 1) { nkAct = null; return; }
  if (A.name === 'slash') {
    // prepara para a direita/cima, corta na diagonal até o meio da tela, volta
    const wind = vmEnv(p, 0, 0.14, 0.14, 0.34);
    const cut = p < 0.14 ? 0 : p < 0.42 ? vmIn((p - 0.14) / 0.28) : 1 - vmEase((p - 0.42) / 0.58);
    pose.x += 60 * wind - 300 * cut;
    pose.y += -50 * wind + 150 * cut;
    pose.r += vmRad(22 * wind - 70 * cut);
    pose.trail = cut > 0.05 && p < 0.55 ? cut : 0;
  } else if (A.name === 'takedown') {
    const wind = vmEnv(p, 0, 0.25, 0.3, 0.45);
    const stab = vmEnv(p, 0.3, 0.42, 0.62, 1);
    pose.x += 40 * wind - 170 * stab;
    pose.y += -120 * wind - 60 * stab;
    pose.r += vmRad(30 * wind - 30 * stab);
    pose.s *= 1 + 0.35 * stab;
  } else if (A.name === 'inspect') {
    const out = vmEnv(p, 0, 0.16, 0.84, 1);
    pose.x += -150 * out; pose.y += -60 * out;
    pose.r += vmRad(-28 * out);
    // vira a lâmina (gira em torno do eixo vertical: achata e volta)
    const turn = vmEnv(p, 0.3, 0.45, 0.6, 0.75);
    pose.sx = 1 - 0.7 * turn;                      // gira a lâmina (achata e volta)
    pose.r += vmRad(10 * Math.sin(p * Math.PI * 2) * out);
  }
}

// rastro do golpe: arco claro seguindo a ponta da lâmina
const VM_KNIFE_TIP = [298, 585];
function vmKnifeTrail(ctx, C, M, pose) {
  const tip = vmToScreen(M, VM_KNIFE_TIP[0], VM_KNIFE_TIP[1]);
  const T = vm.trail || (vm.trail = []);
  if (pose.trail) T.push({ x: tip[0], y: tip[1], a: pose.trail });
  else T.length = 0;
  while (T.length > 7) T.shift();
  if (T.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 1; i < T.length; i++) {
    const f = i / T.length;
    ctx.strokeStyle = 'rgba(225,235,255,' + (0.5 * f).toFixed(3) + ')';
    ctx.lineWidth = Math.max(2, 26 * f * M.sc);
    ctx.beginPath(); ctx.moveTo(T[i - 1].x, T[i - 1].y); ctx.lineTo(T[i].x, T[i].y); ctx.stroke();
  }
  ctx.restore();
}

// ---------- clarão, cápsulas e peças soltas ----------
function vmDrawFlash(ctx, key, C, M, m, now) {
  const age = now - vm.flashT;
  if (vm.flashW !== key || age > 70 || !C.flash) return;
  const img = C.front || key === 'm4' ? m4MuzzleFlashImg : muzzleFlashImg;
  const ok = img === m4MuzzleFlashImg ? m4MuzzleFlashLoaded : muzzleFlashLoaded;
  if (!ok) return;
  const k = M.sc / 1.0;
  const size = C.flash * (1 - age / 90) * (0.9 + Math.random() * 0.25);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(m[0], m[1]);
  if (img === m4MuzzleFlashImg) {
    ctx.rotate(vm.flashRot + Math.random() * 0.3);
    const w = img.width * k * 0.55 * size, h = img.height * k * 0.55 * size;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  } else {
    // chama saindo na direção do cano (o núcleo do desenho fica a 66% da largura)
    ctx.rotate(vmRad(C.dir) + M.rot + Math.PI + (Math.random() - 0.5) * 0.2);
    const w = img.width * k * 0.7 * size, h = img.height * k * 0.7 * size;
    ctx.drawImage(img, -w * 0.66, -h / 2, w, h);
  }
  ctx.restore();
  // brilho em volta da boca
  const g = ctx.createRadialGradient(m[0], m[1], 0, m[0], m[1], 140 * k * C.flash);
  g.addColorStop(0, 'rgba(255,190,90,0.35)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(m[0] - 160 * k * C.flash, m[1] - 160 * k * C.flash, 320 * k * C.flash, 320 * k * C.flash);
  ctx.restore();
}
function vmEmitShells(key, C, M) {
  for (const s of vm.shells) {
    if (!s.pending) continue;
    s.pending = false;
    const e = vmToScreen(M, C.eject[0], C.eject[1]);
    const side = C.front ? 1 : 1;
    s.x = e[0]; s.y = e[1];
    s.vx = (220 + Math.random() * 120) * M.sc * side;
    s.vy = (-420 - Math.random() * 160) * M.sc;
    s.r = Math.random() * 6; s.vr = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 8);
    s.sc = M.sc; s.t = 0;
  }
}
function vmDrawShellAt(ctx, x, y, r, kind, sc) {
  const u = 5.7;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(r); ctx.scale(sc, sc);
  if (kind === 'shotgun') {
    ctx.fillStyle = '#8e1c14'; ctx.fillRect(-u * 2.4, -u * 0.9, u * 3.4, u * 1.8);
    ctx.fillStyle = '#c8321f'; ctx.fillRect(-u * 2.4, -u * 0.9, u * 3.4, u * 0.8);
    ctx.fillStyle = '#b8912e'; ctx.fillRect(u * 1.0, -u * 0.95, u * 1.3, u * 1.9);
    ctx.fillStyle = '#e8c35a'; ctx.fillRect(u * 1.0, -u * 0.95, u * 1.3, u * 0.6);
  } else {
    const L = kind === 'pistol' ? 1.6 : 2.4;
    ctx.fillStyle = '#7a5518'; ctx.fillRect(-u * L / 2, -u * 0.55, u * L, u * 1.1);
    ctx.fillStyle = '#d4a53c'; ctx.fillRect(-u * L / 2, -u * 0.55, u * L, u * 0.55);
  }
  ctx.restore();
}
function vmUpdateParts(ctx, dt) {
  const ch = vmCanvas.height, g = 2600 * ch / 1080;
  vm.shells = vm.shells.filter(s => {
    if (s.pending) return true;
    s.t += dt; s.vy += g * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.r += s.vr * dt;
    if (s.y > ch + 60 || s.t > 2) return false;
    vmDrawShellAt(ctx, s.x, s.y, s.r, s.kind, s.sc);
    return true;
  });
  vm.parts = vm.parts.filter(p => {
    p.t += dt; p.vy += g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
    if (p.y > ch + 400 || p.t > 3) return false;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(p.s, p.s);
    if (p.img === 'clip') vmPaintClip(ctx, 0);
    else ctx.drawImage(p.img, -p.img.width / 2, -p.img.height / 2);
    ctx.restore();
    return true;
  });
}

// ---------- mãos sem arma (modo história) ----------
function vmDrawHands(ctx, now, dt) {
  const cw = vmCanvas.width, ch = vmCanvas.height;
  if (!vm.handsOn) { vm.handsOn = true; vm.handsT = now; }
  const k = ch / VM_HANDS.ref;
  const rise = 1 - vmOut((now - vm.handsT) / 520);
  const walk = Math.min(1, vm.mv), ph = vm.bobPh;
  const breath = Math.sin(now / 900);
  const common = { x: vm.swayX * 0.8, y: rise * 700 + vmClamp(-jumpVelocity * 90, -26, 26) + vm.land * 30 + crouchAmount * 22 };
  const W = VM_META.weapons.hands;
  const arms = [
    ['armL', -1, W.layers.armL],
    ['armR', 1, W.layers.armR],
  ];
  const hx = cw / 2 - VM_HANDS.home[0] * k, hy = ch - VM_HANDS.home[1] * k;
  for (const [name, side, L] of arms) {
    const img = vmLayers['hands.' + name];
    if (!img) continue;
    // cada braço balança no contrapasso do outro
    const step = Math.sin(ph + (side < 0 ? 0 : Math.PI));
    const x = common.x + side * Math.cos(ph) * 7 * walk + Math.sin(now / 1400 + side) * 3;
    const y = common.y + step * 16 * walk + Math.abs(Math.cos(ph)) * 6 * walk + breath * 5 + (side < 0 ? 0 : Math.sin(now / 900 + 0.8) * 2);
    const r = vmRad(side * (step * 1.4 * walk + Math.sin(now / 1700) * 0.4) + gunTiltCurrent * 0.5);
    // gira em volta do cotovelo (fora da tela, embaixo)
    const cx = L.x + L.w * (side < 0 ? 0.25 : 0.75), cy = VM_HANDS.home[1] + 200;
    ctx.save();
    ctx.translate(Math.round(hx + (cx + x) * k), Math.round(hy + (cy + y) * k));
    ctx.rotate(r);
    ctx.scale(k, k);
    ctx.translate(-cx, -cy);
    ctx.drawImage(img, L.x, L.y);
    ctx.restore();
  }
  vmMuzzleNDC = null;
}

// ---------- choque do laser do Bruto: arma erguida esquentando ----------
const vmHeatCache = {};
function vmHeatLayer(key, name, lvl) {
  const id = key + '.' + name + '.' + lvl;
  if (vmHeatCache[id]) return vmHeatCache[id];
  const base = vmLayers[key + '.' + name];
  if (!base) return null;
  const c = document.createElement('canvas');
  c.width = base.width; c.height = base.height;
  const g = c.getContext('2d');
  g.drawImage(base, 0, 0);
  const t = lvl / 7;
  const hot = t < 0.55 ? [255, 120, 30] : t < 0.85 ? [255, 40, 40] : [180, 90, 255];
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    const r = p[i], gg = p[i + 1], b = p[i + 2];
    if (Math.max(r, gg, b) - Math.min(r, gg, b) >= 28) continue;     // só o metal
    const l = (r + gg + b) / 765;
    const m = Math.min(1, t * 1.1) * (0.35 + 0.65 * l);
    p[i] = Math.min(255, r * (1 - m) + hot[0] * m * (0.6 + l));
    p[i + 1] = Math.min(255, gg * (1 - m) + hot[1] * m * (0.6 + l));
    p[i + 2] = Math.min(255, b * (1 - m) + hot[2] * m * (0.6 + l));
  }
  g.putImageData(d, 0, 0);
  return (vmHeatCache[id] = c);
}
function vmDrawClash(ctx, now) {
  const c = c2Clash;
  const key = c.kind === 'pistol' ? 'pistol' : c.kind === 'knife' ? 'knife' : 'm4';
  const C = VM_W[key];
  const cw = vmCanvas.width, ch = vmCanvas.height;
  const heat = c.result === 'lose' ? 1 : c.heat;
  const lvl = Math.min(7, Math.floor(heat * 8));
  const P = vmPlace(key, cw, ch);
  const shake = heat * 6 + c.kick * 8;
  // arma erguida na frente do corpo, segurando a rajada
  const M = {
    px: Math.round(P.px - (key === 'pistol' ? 0 : 0.16 * ch) + (Math.random() - 0.5) * shake * P.k * 3),
    py: Math.round(P.py - 0.2 * ch + (Math.random() - 0.5) * shake * P.k * 3 + c.kick * 10 * P.k),
    rot: vmRad(key === 'pistol' ? 0 : -8) + (Math.random() - 0.5) * 0.02 * heat,
    sc: P.k * 1.08, gx: C.grip[0], gy: C.grip[1],
  };
  const W = VM_META.weapons[key];
  ctx.save();
  const col = heat < 0.5 ? 'rgba(255,120,30,' : heat < 0.8 ? 'rgba(255,40,40,' : 'rgba(150,80,255,';
  ctx.shadowColor = col + (0.35 + heat * 0.6) + ')';
  ctx.shadowBlur = 10 + heat * 40;
  ctx.translate(M.px, M.py); ctx.rotate(M.rot); ctx.scale(M.sc, M.sc); ctx.translate(-M.gx, -M.gy);
  for (const name of ['gun', 'mag', 'armL']) {
    const L = W.layers[name];
    if (!L) continue;
    const img = name.startsWith('arm') ? vmLayers[key + '.' + name] : vmHeatLayer(key, name, lvl);
    if (img) ctx.drawImage(img, L.x, L.y);
  }
  ctx.restore();
  vmMuzzleNDC = null;
}
