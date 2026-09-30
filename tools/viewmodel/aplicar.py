# -*- coding: utf-8 -*-
"""
Aplica o viewmodel novo (armas e mãos da arte de referência) no jogo.

  python3 aplicar.py entrada.html saida.html

Usa o atlas gerado por construir.py (gerado/vm_atlas.png + gerado/vm_meta.json) e o
código vm.js. Cada troca confere o trecho exato do jogo e para se ele mudou.
"""
import base64, json, os, sys

AQUI = os.path.dirname(os.path.abspath(__file__))


def patch(src, old, new, count=1, label=''):
    n = src.count(old)
    if n != count:
        raise SystemExit('trecho %r: esperado %d, achei %d\n---\n%s' % (label, count, n, old[:300]))
    return src.replace(old, new)


def main(inp, out):
    src = open(inp, encoding='utf-8').read()
    if 'VM_ATLAS_SRC' in src:
        raise SystemExit('o jogo de entrada já tem o viewmodel novo')

    atlas = open(os.path.join(AQUI, 'gerado', 'vm_atlas.webp'), 'rb').read()
    meta = json.load(open(os.path.join(AQUI, 'gerado', 'vm_meta.json')))
    code = open(os.path.join(AQUI, 'vm.js'), encoding='utf-8').read()
    code = code.replace("'__VM_ATLAS__'", "'data:image/webp;base64," + base64.b64encode(atlas).decode() + "'")
    code = code.replace('__VM_META__', json.dumps(meta, separators=(',', ':')))

    # ---------- CSS ----------
    src = patch(src,
        "  body.kar-ads #crosshair { visibility: hidden; }                  /* mirando pela alça e massa */\n",
        "  body.kar-ads #crosshair { visibility: hidden; }                  /* mirando pela alça e massa */\n"
        "  /* ---------- Viewmodel novo: armas e mãos da arte de referência ---------- */\n"
        "  #vm-view { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; image-rendering: pixelated;\n"
        "    pointer-events: none; z-index: 1; visibility: hidden; }\n"
        "  body.story-cine #vm-view, body.mars-on #vm-view, body.paused #vm-view.vm-hands { visibility: hidden !important; }\n"
        "  body.story-cine.story-cutgun #vm-view:not(.vm-hands) { visibility: inherit !important; }\n"
        "  #rb-hands { display: none !important; }                          /* mãos antigas: agora no #vm-view */\n",
        label='css')

    # ---------- código do viewmodel, antes do drawGun ----------
    src = patch(src,
        "function drawGun() {\n  const gunDisplay = document.getElementById('gun-display');\n",
        code + "\n"
        "function drawGun() {\n  const gunDisplay = document.getElementById('gun-display');\n"
        "  if (vmDrawFrame()) return;   // viewmodel novo (armas, faca, mãos e choque do Bruto)\n",
        label='drawGun')

    # ---------- eventos de tiro ----------
    src = patch(src,
        "  gameState.ammo--;\n  isShooting = true;\n  setTimeout(() => { isShooting = false; }, 100);\n  playPlayerShot(currentWeapon);\n",
        "  gameState.ammo--;\n  isShooting = true;\n  setTimeout(() => { isShooting = false; }, 100);\n  playPlayerShot(currentWeapon);\n"
        "  vmOnShot(currentWeapon);\n",
        label='shoot')
    src = patch(src,
        "  gameState.ammo--;\n  isShooting = true;\n  setTimeout(() => { isShooting = false; }, SHOTGUN_RECOIL_MS);\n",
        "  gameState.ammo--;\n  isShooting = true;\n  setTimeout(() => { isShooting = false; }, SHOTGUN_RECOIL_MS);\n"
        "  vmOnShot('shotgun');\n",
        label='shootShotgun')

    # ---------- faca: o golpe de eliminação não trava a faca para sempre ----------
    src = patch(src,
        "  if (nkAct && nkAct.name === 'takedown' && name !== 'takedown') return;\n",
        "  if (nkAct && nkAct.name === 'takedown' && name !== 'takedown' && performance.now() - nkAct.t0 < 750) return;\n",
        label='nkPlay')

    # ---------- KAR: animações no viewmodel novo (o modelo 3D fica só para o ícone) ----------
    src = patch(src,
        "function karCanFire() { karEnsure(); return !karBusy(); }\n",
        "function karCanFire() { return !karBusy(); }\n",
        label='karCanFire')
    src = patch(src,
        "  if (karView) karView.st.act = null;\n}\n",
        "  if (karView) karView.st.act = null;\n  vmKarEvent(null);\n}\n",
        label='karCancel')
    src = patch(src,
        "  const v = karEnsure(), now = performance.now();\n  v.st.kick = 1;\n",
        "  const now = performance.now();\n",
        label='karAfterShot')
    src = patch(src,
        "      v.play('bolt', KAR_BOLT_MS);\n",
        "      vmKarEvent('bolt', KAR_BOLT_MS);\n",
        label='karBolt')
    src = patch(src,
        "  karEnsure().play('reload', KAR_RELOAD_MS);\n",
        "  vmKarEvent('reload', KAR_RELOAD_MS);\n",
        label='karReload')
    src = patch(src,
        "function karOnDraw(ms) { karCancel(); karEnsure().play('draw', ms); }\n",
        "function karOnDraw(ms) { karCancel(); }\n",
        label='karOnDraw')

    # ---------- rastro da bala sai da boca do cano desenhada ----------
    src = patch(src,
        "function getMuzzleWorldPosition(dir) {\n",
        "function getMuzzleWorldPosition(dir) {\n"
        "  if (vmMuzzleNDC) {\n"
        "    const p = new THREE.Vector3(vmMuzzleNDC.x, vmMuzzleNDC.y, 0.5).unproject(camera).sub(camera.position).normalize();\n"
        "    return camera.position.clone().addScaledVector(p, 0.9);\n"
        "  }\n",
        label='muzzle')

    open(out, 'w', encoding='utf-8').write(src)
    print('ok ->', out, round(len(src) / 1e6, 2), 'MB')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
