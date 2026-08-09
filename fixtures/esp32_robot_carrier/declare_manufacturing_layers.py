from pathlib import Path
import hashlib, sys

if len(sys.argv) != 3:
    raise SystemExit('usage: declare_manufacturing_layers.py INPUT.kicad_pcb OUTPUT.kicad_pcb')
src=Path(sys.argv[1]); out=Path(sys.argv[2])
s=src.read_text()
EXPECTED_IN='115f2eef607307a9be8ac29ba2bc9eb4d7db52efe347948da75c225dc191dcd3'
if hashlib.sha256(src.read_bytes()).hexdigest()!=EXPECTED_IN:
    raise SystemExit('input final-board SHA mismatch')
if '(34 "B.Paste" user)' not in s:
    s=s.replace('    (31 "B.Cu" signal)\n    (36 "B.SilkS" user "b.silkscreen")',
                '    (31 "B.Cu" signal)\n    (34 "B.Paste" user)\n    (35 "F.Paste" user)\n    (36 "B.SilkS" user "b.silkscreen")',1)
if '(38 "B.Mask" user)' not in s:
    s=s.replace('    (37 "F.SilkS" user "f.silkscreen")\n    (44 "Edge.Cuts" user)',
                '    (37 "F.SilkS" user "f.silkscreen")\n    (38 "B.Mask" user)\n    (39 "F.Mask" user)\n    (44 "Edge.Cuts" user)',1)
out.write_text(s)
sha=hashlib.sha256(out.read_bytes()).hexdigest()
EXPECTED_OUT='75ba0dbfd2935e7c4af2e295b3e52c2d983bba4a2fcbd3d37a5d51b08c40c3e2'
print('manufacturing board sha256',sha)
if sha!=EXPECTED_OUT:
    raise SystemExit('manufacturing board SHA mismatch')
