# Viewmodel: armas e mãos da arte de referência

As armas (M4A1-S, P2000, SPAS-12, UMP-45, faca e KAR 98K) e as mãos sem arma são
desenhadas com a arte de `referencias/`. O desenho não muda; as animações movem
peças recortadas dele (arma, braço esquerdo, pente, telha da SPAS).

```bash
python3 construir.py gerado                 # recorta a arte -> gerado/vm_atlas.webp + vm_meta.json
python3 aplicar.py base.html saida.html     # coloca o viewmodel no jogo
```

`base.html` é o jogo antes desta mudança (o arquivo `retrobase_modelos_3d_6_1.html`).
Números de cada arma (tamanho, mira, coice, pontos do cano) ficam em `VM_W`, no começo de `vm.js`.
