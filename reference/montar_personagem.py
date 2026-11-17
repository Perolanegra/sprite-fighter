#!/usr/bin/env python3
"""
montar_personagem.py — monta um personagem a partir de um SVG de peças agrupadas.

Entrada : um SVG em que cada peça é um <g id="nome"> (cabeça, tronco, braço...)
          + um arquivo de pose (JSON) dizendo quem se prende em quem e em qual ângulo.
Saída   : um SVG com o boneco montado, em hierarquia (cada peça dentro da "mãe")
          e com o ponto de giro de cada grupo exatamente na articulação.
          Pronto pra importar no Rive.

Requisito: pip install svgelements
Prévia PNG (opcional): rsvg-convert instalado OU pip install cairosvg

USO
  python montar_personagem.py pecas.svg pose.json -o montado.svg
  python montar_personagem.py pecas.svg pose.json -o montado.svg --preview previa.png
  python montar_personagem.py pecas.svg --info            # lista as peças e eixos detectados

AJUSTES NA HORA (sem editar o JSON), com --set:
  --set tilt=-10                  inclina o corpo inteiro
  --set head.rotate=-20           gira a cabeça
  --set arm_front_upper.angle=5   aponta o braço
  --set head.group=head_side_angry   troca a peça usada

FORMATO DO pose.json
{
  "tilt": -6,                 // inclinação global, somada a todos os ângulos
  "parts": [
    {
      "name":   "torso",                 // nome do nó no arquivo final
      "group":  "torso",                 // id do grupo no SVG de peças
      "parent": null,                    // nó "mãe" (null = raiz)
      "pivot":  {"bbox": [0.37, 0.85]},  // ponto de giro na peça (ver abaixo)
      "rotate": 77,                      // OU "angle" (ver abaixo)
      "attach": "end",                   // onde prende na mãe (ver abaixo)
      "layer":  "front",                 // "back" = atrás da mãe, "front" = na frente
      "order":  0,                       // ordem entre irmãs da mesma camada
      "variants": ["head_side_angry"]    // peças alternativas no mesmo lugar (ficam invisíveis)
    }
  ]
}

  pivot  : "top" | "bottom" | "left" | "right"  -> ponta do eixo mais comprido da peça
                                                   (detectado sozinho; ideal pra braço e perna)
           {"bbox": [fx, fy]}                   -> fração da caixa da peça (0..1)
           {"xy": [x, y]}                       -> coordenada exata no SVG de peças
  angle  : direção no mundo (graus; 0 = direita, 90 = baixo, 180 = esquerda) do eixo da peça,
           indo do pivô até a outra ponta. Use em braços, pernas, gravata.
  rotate : rotação aplicada ao desenho como ele está. Use em cabeça, tronco, sapato.
  attach : "end"                -> na outra ponta da mãe (cotovelo, joelho, tornozelo)
           {"bbox": [fx, fy]}   -> fração da caixa da mãe (pescoço, ombro, quadril)
           {"xy": [x, y]}       -> coordenada exata no SVG de peças
  inset  : (opcional) quanto o pivô automático entra na peça, em fração do comprimento.
"""
import argparse, copy, io, json, math, os, shutil, subprocess, sys
import xml.etree.ElementTree as ET

try:
    from svgelements import SVG, Path, Matrix
except ImportError:
    sys.exit("Falta a biblioteca svgelements:  pip install svgelements")

SVGNS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVGNS)
q = lambda t: f"{{{SVGNS}}}{t}"


# ---------------------------------------------------------------- leitura das peças
def load_parts(svg_path):
    root = ET.parse(svg_path).getroot()
    defs = "".join(ET.tostring(d, encoding="unicode") for d in root.iter(q("defs")))
    parts = {}
    for g in root.iter(q("g")):
        gid = g.get("id")
        if not gid or any(c.tag == q("g") for c in g):   # ignora grupos que só embrulham outros
            continue
        parts[gid] = g
    if not parts:
        sys.exit("Nenhum <g id=...> com peças encontrado no SVG.")
    return defs, parts


def group_points(g, per_path=40):
    """Amostra pontos do contorno de todas as formas do grupo (com seus transforms)."""
    pts = []
    for el in g.iter(q("path")):
        d = el.get("d")
        if not d:
            continue
        p = Path(d)
        if el.get("transform"):
            p = p * Matrix(el.get("transform"))
        for i in range(per_path):
            pt = p.point(i / (per_path - 1))
            pts.append((pt.x, pt.y))
    if not pts:
        sys.exit(f"O grupo '{g.get('id')}' não tem paths.")
    return pts


class Geo:
    """Caixa, eixo principal e as duas pontas de uma peça."""
    def __init__(self, pts):
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        self.bbox = (min(xs), min(ys), max(xs), max(ys))
        n = len(pts); mx, my = sum(xs) / n, sum(ys) / n
        sxx = sum((x - mx) ** 2 for x in xs) / n
        syy = sum((y - my) ** 2 for y in ys) / n
        sxy = sum((x - mx) * (y - my) for x, y in pts) / n
        th = 0.5 * math.atan2(2 * sxy, sxx - syy)
        ax, ay = math.cos(th), math.sin(th)           # eixo comprido
        px, py = -ay, ax                              # eixo transversal
        t = [(x - mx) * ax + (y - my) * ay for x, y in pts]
        u = [(x - mx) * px + (y - my) * py for x, y in pts]
        tmin, tmax = min(t), max(t)
        self.length, self.width = tmax - tmin, max(u) - min(u)
        def end(tt, side):
            near = [ui for ti, ui in zip(t, u) if abs(ti - tt) < 0.12 * self.length]
            uc = sorted(near)[len(near) // 2] if near else 0
            return (tt, uc)
        self._frame = (mx, my, ax, ay, px, py)
        self.ends = [end(tmin, -1), end(tmax, 1)]     # pontas em coordenadas (t,u)

    def to_xy(self, t, u):
        mx, my, ax, ay, px, py = self._frame
        return (mx + ax * t + px * u, my + ay * t + py * u)

    def joints(self, inset=None):
        """As duas articulações (pontas recuadas pra dentro da peça)."""
        if inset is None:
            ins = min(0.45 * self.width, 0.25 * self.length)
        else:
            ins = inset * self.length
        (t0, u0), (t1, u1) = self.ends
        return self.to_xy(t0 + ins, u0), self.to_xy(t1 - ins, u1)

    def bbox_point(self, fx, fy):
        x0, y0, x1, y1 = self.bbox
        return (x0 + fx * (x1 - x0), y0 + fy * (y1 - y0))


def ang(a, b):
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))


# ---------------------------------------------------------------- resolução da pose
def resolve_point(spec, geo, pivot_joint=None, other_joint=None, what="pivot"):
    if isinstance(spec, str):
        if spec == "end":
            if other_joint is None:
                sys.exit(f"'end' precisa de uma mãe com eixo ({what}).")
            return other_joint
        return None   # top/bottom/left/right tratados em pick_pivot
    if "bbox" in spec:
        return geo.bbox_point(*spec["bbox"])
    if "xy" in spec:
        return tuple(spec["xy"])
    sys.exit(f"{what} inválido: {spec}")


def pick_pivot(hint, geo, inset):
    a, b = geo.joints(inset)
    key = {"top": lambda p: p[1], "bottom": lambda p: -p[1],
           "left": lambda p: p[0], "right": lambda p: -p[0]}.get(hint)
    if key is None:
        sys.exit(f"pivot '{hint}' inválido (use top/bottom/left/right ou bbox/xy).")
    return (a, b) if key(a) <= key(b) else (b, a)


def solve(pose, parts):
    tilt = pose.get("tilt", 0)
    nodes = {}
    for p in pose["parts"]:
        if p["group"] not in parts:
            sys.exit(f"Peça '{p['group']}' (nó {p['name']}) não existe no SVG. Use --info pra ver os nomes.")
        geo = Geo(group_points(parts[p["group"]]))
        piv = p.get("pivot", "top")
        if isinstance(piv, str):
            P, D = pick_pivot(piv, geo, p.get("inset"))
        else:
            P = resolve_point(piv, geo)
            a, b = geo.joints(p.get("inset"))
            D = a if math.dist(P, a) > math.dist(P, b) else b   # outra ponta = a mais longe
        if "angle" in p:
            R = p["angle"] + tilt - ang(P, D)
        else:
            R = p.get("rotate", 0) + tilt
        nodes[p["name"]] = dict(spec=p, geo=geo, P=P, D=D, R=R, kids=[])
    roots = []
    for name, n in nodes.items():
        par = n["spec"].get("parent")
        if par:
            if par not in nodes:
                sys.exit(f"Mãe '{par}' de '{name}' não existe.")
            nodes[par]["kids"].append(name)
        else:
            roots.append(name)
    for name, n in nodes.items():
        par = n["spec"].get("parent")
        if par:
            pn = nodes[par]
            A = resolve_point(n["spec"].get("attach", "end"), pn["geo"], pn["P"], pn["D"], "attach")
            n["T"] = (A[0] - pn["P"][0], A[1] - pn["P"][1])
            n["rel"] = n["R"] - pn["R"]
        else:
            n["T"] = tuple(n["spec"].get("position", (0, 0)))
            n["rel"] = n["R"]
    return nodes, roots


# ---------------------------------------------------------------- escrita
def inner_xml(g):
    return "".join(ET.tostring(c, encoding="unicode") for c in g)


def emit(name, nodes, parts):
    n = nodes[name]; s = n["spec"]
    kids = n["kids"]
    back = sorted([k for k in kids if nodes[k]["spec"].get("layer") == "back"], key=lambda k: nodes[k]["spec"].get("order", 0))
    front = sorted([k for k in kids if nodes[k]["spec"].get("layer") != "back"], key=lambda k: nodes[k]["spec"].get("order", 0))
    out = f'<g id="{name}" transform="translate({n["T"][0]:.2f} {n["T"][1]:.2f}) rotate({n["rel"]:.2f})">'
    out += "".join(emit(k, nodes, parts) for k in back)
    P = n["P"]
    out += f'<g id="{name}_art" transform="translate({-P[0]:.2f} {-P[1]:.2f})">{inner_xml(parts[s["group"]])}</g>'
    for v in s.get("variants", []):
        if v not in parts:
            sys.exit(f"Variante '{v}' não existe no SVG.")
        vg = Geo(group_points(parts[v]))
        piv = s.get("pivot", "top")
        if isinstance(piv, str):
            VP, _ = pick_pivot(piv, vg, s.get("inset"))
        else:
            VP = resolve_point(piv, vg)
        out += f'<g id="{name}_{v}" opacity="0" transform="translate({-VP[0]:.2f} {-VP[1]:.2f})">{inner_xml(parts[v])}</g>'
    out += "".join(emit(k, nodes, parts) for k in front)
    return out + "</g>"


def build_svg(defs, body, char_id, pad=40):
    raw = f'<svg xmlns="{SVGNS}" viewBox="0 0 10 10">{defs}<g id="{char_id}">{body}</g></svg>'
    bb = SVG.parse(io.StringIO(raw)).bbox()
    x0, y0, x1, y1 = bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad
    w, h = x1 - x0, y1 - y0
    # move o personagem pra origem do canvas
    return (f'<svg xmlns="{SVGNS}" viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}">{defs}'
            f'<g id="{char_id}" transform="translate({-x0:.2f} {-y0:.2f})">{body}</g></svg>')


def preview(svg_path, png_path, bg):
    if shutil.which("rsvg-convert"):
        subprocess.run(["rsvg-convert", "-w", "1400", "-b", bg, svg_path, "-o", png_path], check=True)
        return True
    try:
        import cairosvg
        cairosvg.svg2png(url=svg_path, write_to=png_path, output_width=1400, background_color=bg)
        return True
    except ImportError:
        print("Sem rsvg-convert nem cairosvg: prévia pulada.")
        return False


# ---------------------------------------------------------------- CLI
def apply_sets(pose, sets):
    byname = {p["name"]: p for p in pose["parts"]}
    for s in sets or []:
        key, _, val = s.partition("=")
        try:
            val = json.loads(val)
        except json.JSONDecodeError:
            pass
        if "." in key:
            name, field = key.split(".", 1)
            if name not in byname:
                sys.exit(f"--set: nó '{name}' não existe.")
            byname[name][field] = val
            if field == "angle": byname[name].pop("rotate", None)
            if field == "rotate": byname[name].pop("angle", None)
        else:
            pose[key] = val


def main():
    ap = argparse.ArgumentParser(description="Monta um personagem a partir de peças SVG agrupadas.")
    ap.add_argument("pecas", help="SVG com as peças agrupadas (<g id=...>)")
    ap.add_argument("pose", nargs="?", help="arquivo JSON da pose")
    ap.add_argument("-o", "--out", default="personagem_montado.svg")
    ap.add_argument("--id", default=None, help="id do grupo raiz (padrão: nome do arquivo de saída)")
    ap.add_argument("--set", action="append", metavar="CHAVE=VALOR", help="sobrescreve um valor da pose")
    ap.add_argument("--preview", metavar="PNG", help="gera uma prévia em PNG")
    ap.add_argument("--bg", default="#e9846a", help="cor de fundo da prévia")
    ap.add_argument("--info", action="store_true", help="lista as peças e eixos detectados")
    a = ap.parse_args()

    defs, parts = load_parts(a.pecas)
    if a.info or not a.pose:
        print(f"{'peça':24s} {'caixa (x0,y0,x1,y1)':34s} {'compr.':>7s} {'largura':>8s}  pontas")
        for gid, g in parts.items():
            geo = Geo(group_points(g)); j = geo.joints()
            print(f"{gid:24s} {str(tuple(round(v) for v in geo.bbox)):34s} {geo.length:7.0f} {geo.width:8.0f}  "
                  f"{tuple(round(v) for v in j[0])} / {tuple(round(v) for v in j[1])}")
        return

    pose = json.load(open(a.pose))
    apply_sets(pose, a.set)
    nodes, roots = solve(pose, parts)
    body = "".join(emit(r, nodes, parts) for r in roots)
    char_id = a.id or os.path.splitext(os.path.basename(a.out))[0]
    open(a.out, "w").write(build_svg(defs, body, char_id))
    print(f"OK: {a.out}  ({len(nodes)} peças, raiz: {', '.join(roots)})")
    if a.preview and preview(a.out, a.preview, a.bg):
        print(f"Prévia: {a.preview}")


if __name__ == "__main__":
    main()
