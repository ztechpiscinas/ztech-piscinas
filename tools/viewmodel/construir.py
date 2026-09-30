# -*- coding: utf-8 -*-
"""
Monta os sprites do viewmodel (armas e mãos em primeira pessoa) a partir das
artes de referência enviadas pelo dono do jogo:

  referencias/armas.webp  folha com M4A1-S, P2000, SPAS-12, UMP-45, faca e KAR 98K
  referencias/maos.webp   braços erguidos, sem arma

O desenho de cada arma sai exatamente como na referência. O script só:
  1. tira o fundo preto (abertura morfológica: o preto largo é fundo, o preto fino
     é contorno/sombra do desenho e fica);
  2. separa as peças que se mexem nas animações (braço esquerdo, pente, telha da
     SPAS, ferrolho da KAR) e preenche o que fica atrás delas seguindo o eixo do cano;
  3. prolonga as mangas para baixo (e a coronha para a direita) para o corte do
     desenho nunca aparecer na tela;
  4. junta tudo num atlas PNG + JSON com as posições, pivôs e pontos (cano, janela
     de ejeção, massa de mira...).

Uso: python3 construir.py [pasta_saida]
"""
import json, os, sys, io, base64
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

AQUI = os.path.dirname(os.path.abspath(__file__))
REF_ARMAS = os.path.join(AQUI, 'referencias', 'armas.webp')
REF_MAOS = os.path.join(AQUI, 'referencias', 'maos.webp')

# ---------------------------------------------------------------------------
# Configuração de cada arma (coordenadas da folha de referência, em pixels)
#   box    recorte (x0, y0, x1, y1); y1 = linha logo abaixo do corte das mangas
#   r      raio da abertura que separa o fundo preto do preto do desenho
#   axis   ângulo do cano (graus, sentido horário a partir do eixo x, cano -> coronha)
#   holes  pontos dentro de vãos que são fundo de verdade (alça da M4, coronha da UMP)
#   parts  peças soltas: 'armL'/'armR' (braço pela cor da luva) ou 'poly' (polígono)
# ---------------------------------------------------------------------------
WEAPONS = {
    'm4': dict(
        box=(10, 75, 430, 472), r=4, axis=39.5,
        holes=[(279, 223), (247, 399), (245, 424)],
        parts=[
            ('armL', dict(arm='left')),
            ('mag', dict(poly=[(206, 339), (214, 342), (268, 404), (266, 418), (255, 473), (203, 473)])),
        ],
        fill_under=['armL'],
        ext_right=True,
    ),
    'pistol': dict(
        box=(445, 150, 700, 472), r=4, axis=90.0,
        holes=[],
        parts=[],
        fill_under=[],
    ),
    'shotgun': dict(
        box=(716, 145, 1106, 472), r=4, axis=29.5,
        holes=[(1034, 426), (992, 424), (1060, 446)],
        parts=[
            ('pump', dict(arm='left', poly=[(791, 206), (884, 259), (884, 348), (840, 340), (790, 268)])),
        ],
        fill_under=['pump'],
        ext_right=True,
    ),
    'ump': dict(
        box=(1120, 130, 1522, 472), r=4, axis=29.5,
        holes=[(1420, 377), (1461, 421), (1414, 385), (1471, 463)],
        parts=[
            ('armL', dict(arm='left')),
            ('mag', dict(poly=[(1219, 320), (1236, 321), (1250, 332), (1259, 340), (1259, 452), (1237, 462), (1217, 455)])),
        ],
        fill_under=['armL'],
        ext_right=False,
    ),
    'knife': dict(
        box=(70, 570, 320, 978), r=4, axis=-60.0,
        holes=[],
        parts=[],
        fill_under=[],
    ),
    'kar': dict(
        box=(440, 558, 988, 986), r=5, axis=50.6,
        holes=[],
        parts=[],
        fill_under=[],
    ),
}

EXT_BOTTOM = 330      # quanto as mangas continuam abaixo do corte (px da folha)
EXT_SIDE = 260        # margem lateral para a manga que desce na diagonal
EXT_RIGHT = 180       # coronha continuada para a direita (M4, SPAS)


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= r * r + 0.5


def load_rgb(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.uint8)


# ---------------------------------------------------------------------------
# 1. fundo preto -> transparente
# ---------------------------------------------------------------------------
def segment(rgb, r=4, T=10, T2=26, ring=2, holes=()):
    """Máscara (bool) do desenho. O preto ligado à borda por regiões largas (>= 2r+1 px)
    é fundo; vãos fechados só viram fundo se tiverem um ponto em `holes`."""
    mx = rgb.max(axis=2).astype(int)
    B = mx <= T
    core = ndi.binary_erosion(B, structure=disk(r), border_value=1)
    lab, n = ndi.label(core)
    keep = set(np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))) - {0}
    H, W = B.shape
    for (hx, hy) in holes:
        # componente mais perto do ponto
        best, bd = 0, 1e9
        ys, xs = np.nonzero(lab)
        if len(xs) == 0:
            continue
        d = (xs - hx) ** 2 + (ys - hy) ** 2
        i = int(np.argmin(d))
        if d[i] < 40 * 40:
            keep.add(int(lab[ys[i], xs[i]]))
    ext = np.isin(lab, list(keep))
    bg = ndi.binary_dilation(ext, structure=disk(r)) & B
    for _ in range(ring):                      # halo da compressão em volta do desenho
        bg |= ndi.binary_dilation(bg, structure=np.ones((3, 3))) & (mx <= T2)
    alpha = ~bg
    # sujeira solta
    lab2, n2 = ndi.label(alpha)
    if n2:
        sz = ndi.sum(np.ones_like(alpha), lab2, range(1, n2 + 1))
        for i, s in enumerate(sz):
            if s < 60:
                alpha[lab2 == i + 1] = False
    return alpha


def glove_mask(rgb):
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    return (b - np.maximum(r, g) > 18) & (b > 35)


def gray_metal(rgb):
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    return (mx - mn < 26) & (mx > 44)


def arm_masks(rgb, alpha):
    """Braços pela cor da luva: fecha as dobras escuras, preenche vãos (menos metal),
    junta pedacinhos de luva soltos perto do braço e pega o contorno escuro.
    Devolve lista ordenada da esquerda p/ a direita."""
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    mx = rgb.max(axis=2).astype(int)
    metal = gray_metal(rgb)
    gl = glove_mask(rgb) & alpha
    cl = ndi.binary_closing(gl, structure=np.ones((5, 5)))
    cl = ndi.binary_fill_holes(cl)
    cl &= alpha & ~metal
    lab, n = ndi.label(cl)
    if n == 0:
        return []
    sz = ndi.sum(np.ones_like(cl), lab, range(1, n + 1))
    big = [i + 1 for i in range(n) if sz[i] >= 2500]
    arms = [lab == i for i in big]
    # pedaços pequenos de luva perto de um braço entram nele
    for i in range(1, n + 1):
        if i in big or sz[i - 1] < 12:
            continue
        m = lab == i
        best, bd = None, 1e9
        dm = ndi.distance_transform_edt(~m)
        for k, am in enumerate(arms):
            d = dm[am].min()
            if d < bd:
                best, bd = k, d
        if best is not None and bd <= 22:
            arms[best] |= m
    bluish = (b > r + 8) & (b > g + 4)
    out = []
    for m in arms:
        near = ndi.binary_dilation(m, structure=disk(3)) & alpha & ~metal
        rim = near & ((mx < 70) | bluish)
        m = m | rim
        # restos de luva (pontas de dedos azuladas) grudados no braço
        for _ in range(3):
            grow = ndi.binary_dilation(m, structure=disk(4)) & alpha & bluish & ~m
            if not grow.any():
                break
            m |= grow
            m |= ndi.binary_dilation(grow, structure=disk(2)) & alpha & (mx < 60) & ~metal
        m = ndi.binary_fill_holes(m) & alpha & ~(metal & ~m)
        ys, xs = np.nonzero(m)
        out.append((xs.mean(), m))
    out.sort(key=lambda t: t[0])
    return [m for _, m in out]


def poly_mask(shape, poly, ox, oy):
    from PIL import ImageDraw
    im = Image.new('L', (shape[1], shape[0]), 0)
    ImageDraw.Draw(im).polygon([(x - ox, y - oy) for x, y in poly], fill=255)
    return np.asarray(im) > 0


# ---------------------------------------------------------------------------
# 2. preenchimento atrás das peças: segue o eixo do cano (o tubo/guarda-mão continua)
# ---------------------------------------------------------------------------
def axial_fill(rgba, fill, axis_deg, avoid=None, maxd=500):
    """Preenche `fill` andando pelo eixo do cano nos dois sentidos. Só vira metal o
    pixel que tem desenho visível dos DOIS lados (o tubo continua por baixo da mão);
    o resto fica transparente."""
    H, W = fill.shape
    out = rgba.copy()
    ys, xs = np.nonzero(fill)
    if len(xs) == 0:
        return out
    stop = fill if avoid is None else (fill | avoid)
    ax = np.cos(np.radians(axis_deg)); ay = np.sin(np.radians(axis_deg))
    res = {}
    for sgn in (1, -1):
        dist = np.full(len(xs), -1)
        col = np.zeros((len(xs), 4), np.uint8)
        pend = np.ones(len(xs), bool)
        for d in range(1, maxd):
            idx = np.nonzero(pend)[0]
            if len(idx) == 0:
                break
            sx = np.rint(xs[idx] + sgn * d * ax).astype(int)
            sy = np.rint(ys[idx] + sgn * d * ay).astype(int)
            inside = (sx >= 0) & (sx < W) & (sy >= 0) & (sy < H)
            pend[idx[~inside]] = False                 # saiu da imagem: nada desse lado
            ii = idx[inside]; sx = sx[inside]; sy = sy[inside]
            hit = ~fill[sy, sx]
            if avoid is not None:
                hit_av = avoid[sy, sx] & hit
            else:
                hit_av = np.zeros(len(ii), bool)
            ok = hit & ~hit_av
            dist[ii[ok]] = d
            col[ii[ok]] = rgba[sy[ok], sx[ok]]
            pend[ii[hit]] = False
        res[sgn] = (dist, col)
    (d1, c1), (d2, c2) = res[1], res[-1]
    both = (d1 > 0) & (d2 > 0) & (c1[:, 3] > 0) & (c2[:, 3] > 0)
    pick = np.where((d1 <= d2)[:, None], c1, c2)
    val = np.zeros((len(xs), 4), np.uint8)
    val[both] = pick[both]
    out[ys, xs] = val
    return out


def nearest_fill(rgba, fill, src):
    """Preenche `fill` com o pixel mais próximo de `src` (luva escondida atrás da arma)."""
    out = rgba.copy()
    if not fill.any():
        return out
    d, (iy, ix) = ndi.distance_transform_edt(~src, return_indices=True)
    out[fill] = rgba[iy[fill], ix[fill]]
    return out


# ---------------------------------------------------------------------------
# 3. mangas continuadas para baixo (e coronha para a direita)
# ---------------------------------------------------------------------------
def extend_down(rgba, mask, cut_row, ext, band=36, min_run=24):
    """Continua a manga abaixo de `cut_row` repetindo (em vai-e-volta) a faixa de
    `band` linhas acima do corte, deslocada na inclinação do braço. Só entram as
    colunas das mangas largas no corte (dedos que encostam no corte não descem)."""
    H, W = mask.shape
    rows = [y for y in range(max(0, cut_row - 60), cut_row + 1) if mask[y].any()]
    if len(rows) < 8:
        return
    row = mask[cut_row]
    runs, s = [], None
    for x in range(W + 1):
        v = row[x] if x < W else False
        if v and s is None:
            s = x
        if not v and s is not None:
            if x - s >= min_run:
                runs.append((s, x - 1))
            s = None
    if not runs:
        return
    # dedos/pontas estreitas no corte: só esticam a última linha um pouco
    s = None
    for x in range(W + 1):
        v = row[x] if x < W else False
        if v and s is None:
            s = x
        if not v and s is not None:
            if x - s < min_run:
                # ponta de dedo no corte: fecha com 1 px de contorno escuro (arredondado)
                for k in range(1, 6):
                    y = cut_row + k
                    if y >= H:
                        break
                    a0, a1 = s + (k - 1) // 2, x - (k - 1) // 2
                    if a1 <= a0:
                        break
                    seg = rgba[y, a0:a1, 3] == 0
                    col = np.array([14, 16, 40, 255], np.uint8) if k > 2 else rgba[cut_row - 1, a0:a1][seg]
                    rgba[y, a0:a1][seg] = col
                    mask[y, a0:a1] |= seg
            s = None
    cy = np.array(rows, float)
    lx = np.array([np.nonzero(mask[y])[0].min() for y in rows], float)
    rx = np.array([np.nonzero(mask[y])[0].max() for y in rows], float)
    sl = np.polyfit(cy, lx, 1)[0]; sr = np.polyfit(cy, rx, 1)[0]
    slope = float(np.clip((sl + sr) / 2, -0.9, 0.9))
    ok_col = np.zeros(W + 400, bool)
    for a, bb in runs:
        ok_col[max(0, a - 2):bb + 3] = True
    # a faixa só sobe enquanto a manga está inteira (sem buraco de coronha na frente)
    nb = 0
    for yy in range(cut_row, max(-1, cut_row - band), -1):
        seg_ok = True
        for a, bb in runs:
            span = mask[yy, a:bb + 1]
            if span.mean() < 0.9:
                seg_ok = False
        if not seg_ok:
            break
        nb += 1
    band = max(6, nb)
    src = rgba.copy()
    period = 2 * band
    xs = np.arange(W)
    for k in range(1, ext + 1):
        y = cut_row + k
        if y >= H:
            break
        t = (k - 1) % period
        ys = cut_row - (t if t < band else period - 1 - t)      # vai e volta na faixa
        dx = slope * (y - ys)
        sx = np.rint(xs - dx).astype(int)
        ok = (sx >= 0) & (sx < W)
        # coluna do pixel de origem projetada no corte
        px = np.rint(sx + slope * (cut_row - ys)).astype(int)
        ok &= (px >= 0) & (px < W)
        ok[ok] &= ok_col[px[ok]]
        m = np.zeros(W, bool)
        m[ok] = mask[ys, sx[ok]]
        put = m & (rgba[y, :, 3] == 0)
        rgba[y, put] = src[ys, sx[put]]
        mask[y, put] = True


def clean_fragments(rgba, min_px=500):
    """Tira pedaços soltos (restos de contorno) que não estão ligados ao corpo."""
    a = rgba[..., 3] > 0
    lab, n = ndi.label(a, structure=np.ones((3, 3)))
    if n <= 1:
        return rgba
    sz = ndi.sum(np.ones_like(a), lab, range(1, n + 1))
    for i, s in enumerate(sz):
        if s < min_px:
            rgba[lab == i + 1] = 0
    return rgba


def extend_axis(rgba, region, axis_deg, dist):
    """Continua o desenho que encosta na borda direita ao longo do eixo (coronha)."""
    H, W = region.shape
    ax = np.cos(np.radians(axis_deg)); ay = np.sin(np.radians(axis_deg))
    ys, xs = np.nonzero(region)
    for d in range(1, dist):
        nx = np.rint(xs + d * ax).astype(int); ny = np.rint(ys + d * ay).astype(int)
        ok = (nx >= 0) & (nx < W) & (ny >= 0) & (ny < H)
        nx, ny, sx, sy = nx[ok], ny[ok], xs[ok], ys[ok]
        free = rgba[ny, nx, 3] == 0
        rgba[ny[free], nx[free]] = rgba[sy[free], sx[free]]


# ---------------------------------------------------------------------------
# montagem de uma arma
# ---------------------------------------------------------------------------
def build_weapon(sheet, key, cfg):
    x0, y0, x1, y1 = cfg['box']
    rgb = sheet[y0:y1, x0:x1]
    holes = [(hx - x0, hy - y0) for hx, hy in cfg.get('holes', [])]
    alpha = segment(rgb, r=cfg['r'], holes=holes)
    h, w = alpha.shape
    L, T = EXT_SIDE, 0
    R = EXT_SIDE + (EXT_RIGHT if cfg.get('ext_right') else 0)
    B = EXT_BOTTOM
    H, W = h + T + B, w + L + R
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[T:T + h, L:L + w, :3] = rgb
    rgba[T:T + h, L:L + w, 3] = np.where(alpha, 255, 0)
    A = rgba[..., 3] > 0
    ox, oy = x0 - L, y0 - T          # coordenada da folha = índice + (ox, oy)

    arms = arm_masks(rgba[..., :3], A)
    parts = {}
    used = np.zeros(A.shape, bool)
    for name, pc in cfg.get('parts', []):
        m = np.zeros(A.shape, bool)
        if 'arm' in pc:
            if not arms:
                raise SystemExit('%s: nenhum braço encontrado' % key)
            m |= arms[0] if pc['arm'] == 'left' else arms[-1]
        if 'poly' in pc:
            pm = poly_mask(A.shape, pc['poly'], ox, oy) & A
            if 'arm' not in pc:
                for am in arms:
                    pm &= ~am
            m |= pm
        m &= ~used
        used |= m
        parts[name] = m

    # corte das mangas = última linha do recorte
    cut = T + h - 1
    gun_mask = A & ~used
    # mangas que ficam na camada da arma (braço direito etc.) também continuam
    layers = {}
    for name, m in parts.items():
        lay = np.zeros_like(rgba)
        lay[m] = rgba[m]
        layers[name] = [lay, m.copy()]
    gun = np.zeros_like(rgba)
    gun[gun_mask] = rgba[gun_mask]
    gun = clean_fragments(gun)
    # preenche atrás das peças que saem do lugar
    for name in cfg.get('fill_under', []):
        m = parts[name]
        fill = m.copy()
        avoid = used & ~m
        gun = axial_fill(gun, fill, cfg['axis'], avoid=avoid)
        # o preenchimento não pode inventar metal fora da silhueta original + 3 px
        lim = ndi.binary_dilation(A, structure=disk(3))
        gun[~lim] = 0
    gun = clean_fragments(gun)
    gmask = gun[..., 3] > 0

    # mangas continuadas (só os pixels de braço de cada camada)
    for am in arms:
        for name in list(layers.keys()):
            lay, m = layers[name]
            sub = m & am
            if sub[cut].any():
                extend_down(lay, sub, cut, B)
                layers[name][1] = m | sub
        sub = gmask & am
        if sub[cut].any():
            extend_down(gun, sub, cut, B)
            gmask = gmask | sub
    if cfg.get('ext_right'):
        # coronha que encosta na borda direita: continua ao longo do eixo
        edge = np.zeros(A.shape, bool)
        colm = gmask[:, L + w - 3] & ~(np.any(np.stack(arms), axis=0)[:, L + w - 3] if arms else False)
        lab1, n1 = ndi.label(colm)
        for i in range(1, n1 + 1):
            rr = np.nonzero(lab1 == i)[0]
            if len(rr) >= 12:
                edge[rr, L + w - 3:L + w] = True
        edge &= gmask
        extend_axis(gun, edge, cfg['axis'], EXT_RIGHT + 40)

    out = {'gun': gun}
    for name, (lay, m) in layers.items():
        out[name] = lay
    return out, (ox, oy), (w, h), (L, T)


def extrude(rgba, region, axis_deg, dist, band=40):
    """Continua `region` (pixels junto à borda) na direção `axis_deg`, espelhando em
    vai-e-volta uma faixa de `band` px para dentro: as dobras da manga continuam."""
    H, W = region.shape
    ux = np.cos(np.radians(axis_deg)); uy = np.sin(np.radians(axis_deg))
    ys, xs = np.nonzero(region)
    src = rgba.copy()
    period = 2 * band
    for d in range(1, dist):
        t = (d - 1) % period
        s = t if t < band else period - 1 - t
        nx = np.rint(xs + d * ux).astype(int); ny = np.rint(ys + d * uy).astype(int)
        sx = np.rint(xs - s * ux).astype(int); sy = np.rint(ys - s * uy).astype(int)
        ok = (nx >= 0) & (nx < W) & (ny >= 0) & (ny < H) & (sx >= 0) & (sx < W) & (sy >= 0) & (sy < H)
        nx, ny, sx, sy = nx[ok], ny[ok], sx[ok], sy[ok]
        good = (rgba[ny, nx, 3] == 0) & (src[sy, sx, 3] > 0)
        rgba[ny[good], nx[good]] = src[sy[good], sx[good]]


def build_hands(img):
    """Braços erguidos: dois braços separados, prolongados na direção do braço para
    fora da imagem (embaixo e nas laterais), para telas mais largas que a arte."""
    alpha = segment(img, r=3, T=12, T2=30)
    h, w = alpha.shape
    L = R = 620
    B = 520
    H, W = h + B, w + L + R
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[:h, L:L + w, :3] = img
    rgba[:h, L:L + w, 3] = np.where(alpha, 255, 0)
    A = rgba[..., 3] > 0
    lab, n = ndi.label(A)
    sz = ndi.sum(np.ones_like(A), lab, range(1, n + 1))
    comps = [i + 1 for i in np.argsort(sz)[::-1][:2]]
    arms = []
    for c in comps:
        m = lab == c
        ys, xs = np.nonzero(m)
        arms.append((xs.mean(), m))
    arms.sort(key=lambda t: t[0])
    out = {}
    for side, (_, m) in zip(('armL', 'armR'), arms):
        lay = np.zeros_like(rgba)
        lay[m] = rgba[m]
        # direção do braço (punho -> canto da imagem)
        axis = HANDS_AXIS[side]
        edge = np.zeros_like(m)
        edge[h - 3:h, :] = m[h - 3:h, :]
        if side == 'armL':
            edge[:, L:L + 3] |= m[:, L:L + 3]
        else:
            edge[:, L + w - 3:L + w] |= m[:, L + w - 3:L + w]
        extrude(lay, edge, axis, 900, band=46)
        out[side] = lay
    return out, (-L, 0), (w, h), (L, 0)


HANDS_AXIS = {'armL': 120.8, 'armR': 51.4}


def crop_layer(lay):
    a = lay[..., 3] > 0
    if not a.any():
        return None, (0, 0)
    ys, xs = np.nonzero(a)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return lay[y0:y1, x0:x1], (int(x0), int(y0))


def pack(images, pad=2, width=2048):
    """Empacotador simples por prateleiras. images: {nome: array}."""
    order = sorted(images.items(), key=lambda kv: -kv[1].shape[0])
    x = y = shelf = 0
    pos = {}
    for name, im in order:
        h, w = im.shape[:2]
        if x + w + pad > width:
            y += shelf + pad; x = 0; shelf = 0
        pos[name] = (x, y)
        x += w + pad
        shelf = max(shelf, h)
    H = y + shelf
    atlas = np.zeros((H, width, 4), np.uint8)
    for name, im in images.items():
        px, py = pos[name]
        h, w = im.shape[:2]
        atlas[py:py + h, px:px + w] = im
    return atlas, pos


def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    sheet = load_rgb(REF_ARMAS)
    meta = {'weapons': {}, 'src': 'referencias/armas.webp + referencias/maos.webp'}
    images = {}
    for key, cfg in WEAPONS.items():
        layers, (ox, oy), (w, h), (L, T) = build_weapon(sheet, key, cfg)
        info = {'box': list(cfg['box']), 'axis': cfg['axis'], 'layers': {}}
        for name, lay in layers.items():
            im, (lx, ly) = crop_layer(lay)
            if im is None:
                continue
            nm = key + '.' + name
            images[nm] = im
            # posição da camada em coordenadas da folha de referência
            info['layers'][name] = {'x': lx + ox, 'y': ly + oy, 'w': im.shape[1], 'h': im.shape[0]}
        meta['weapons'][key] = info
        print(key, {k: (v['w'], v['h']) for k, v in info['layers'].items()})
    hands = load_rgb(REF_MAOS)
    layers, (ox, oy), (w, h), _ = build_hands(hands)
    info = {'box': [0, 0, w, h], 'layers': {}}
    for name, lay in layers.items():
        im, (lx, ly) = crop_layer(lay)
        nm = 'hands.' + name
        images[nm] = im
        info['layers'][name] = {'x': lx + ox, 'y': ly + oy, 'w': im.shape[1], 'h': im.shape[0]}
    meta['weapons']['hands'] = info
    print('hands', {k: (v['w'], v['h']) for k, v in info['layers'].items()})

    atlas, pos = pack(images)
    for nm, (px, py) in pos.items():
        key, name = nm.split('.')
        meta['weapons'][key]['layers'][name]['ax'] = int(px)
        meta['weapons'][key]['layers'][name]['ay'] = int(py)
    Image.fromarray(atlas).save(os.path.join(outdir, 'vm_atlas.png'), optimize=True)
    # no jogo vai em WebP sem perdas (metade do tamanho do PNG)
    Image.fromarray(atlas).save(os.path.join(outdir, 'vm_atlas.webp'), 'WEBP', lossless=True, quality=100, method=6)
    with open(os.path.join(outdir, 'vm_meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print('atlas', atlas.shape, os.path.getsize(os.path.join(outdir, 'vm_atlas.png')) // 1024, 'KB')
    return meta, atlas


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(AQUI, 'gerado'))
