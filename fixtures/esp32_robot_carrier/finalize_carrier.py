from pathlib import Path
import re, uuid, hashlib, sys

if len(sys.argv) != 3:
    raise SystemExit('usage: finalize_carrier.py INPUT.kicad_pcb OUTPUT.kicad_pcb')
src=Path(sys.argv[1]); out=Path(sys.argv[2])
s=src.read_text()
EXPECTED_IN='d76be0c4625d4a34c3e5a09d863da20c15aa4491002270aa1ff017080ce78dda'
if hashlib.sha256(src.read_bytes()).hexdigest()!=EXPECTED_IN:
    raise SystemExit('input board SHA mismatch')

def blocks(text, token):
    found=[]; pos=0; needle='\n\t('+token
    while True:
        st=text.find(needle,pos)
        if st<0: break
        st+=1; depth=0; i=st; ins=False; esc=False
        while i<len(text):
            c=text[i]
            if ins:
                if esc: esc=False
                elif c=='\\': esc=True
                elif c=='"': ins=False
            else:
                if c=='"': ins=True
                elif c=='(': depth+=1
                elif c==')':
                    depth-=1
                    if depth==0:
                        found.append((st,i+1)); pos=i+1; break
            i+=1
        else: break
    return found

# Keep only useful human silkscreen, hide generated refs/values and move generated outlines to Fab.
for st,en in reversed(blocks(s,'footprint')):
    b=s[st:en]
    for prop in ('Reference','Value'):
        ptn=re.compile(r'(\(property "'+prop+r'" .*?\n\s*\(layer "F\.SilkS"\)\n)(\s*)(?!\(hide yes\))',re.S)
        b=ptn.sub(lambda m:m.group(1)+m.group(2)+'(hide yes)\n'+m.group(2),b)
    b=re.sub(r'(\(fp_rect\b.*?\(layer )"F\.SilkS"(\))',r'\1"F.Fab"\2',b,flags=re.S)
    s=s[:st]+b+s[en:]

# Make all human labels meet KiCad's 0.8 mm minimum silk text height.
for st,en in reversed(blocks(s,'gr_text')):
    b=s[st:en]
    if '(layer "F.SilkS")' in b:
        def grow(m):
            a=float(m.group(1)); c=float(m.group(2))
            return f'(size {max(a,0.85):g} {max(c,0.85):g})' if a<0.8 or c<0.8 else m.group(0)
        b=re.sub(r'\(size ([0-9.]+) ([0-9.]+)\)',grow,b)
        s=s[:st]+b+s[en:]

# Move RGB decoupling capacitor off the 5V route and orient it cleanly.
s=s.replace('(at 75 102.5 90)\n\t\t(property "Reference" "C3"','(at 72.5 100.5 0)\n\t\t(property "Reference" "C3"',1)
idx=s.find('(property "Reference" "C3"'); fst=s.rfind('\n\t(footprint',0,idx)+1
d=0; ins=False; esc=False; fend=None
for i in range(fst,len(s)):
    c=s[i]
    if ins:
        if esc: esc=False
        elif c=='\\': esc=True
        elif c=='"': ins=False
    else:
        if c=='"': ins=True
        elif c=='(': d+=1
        elif c==')':
            d-=1
            if d==0: fend=i+1; break
cb=s[fst:fend]
for a,b in [('(at 0 -1.8 90)','(at 0 -1.8 0)'),('(at 0 1.8 90)','(at 0 1.8 0)'),('(at 0 0 90)','(at 0 0 0)'),('(at -1.4 0 90)','(at -1.4 0 0)'),('(at 1.4 0 90)','(at 1.4 0 0)')]: cb=cb.replace(a,b)
s=s[:fst]+cb+s[fend:]

# Remove routes superseded by the final RGB and GPIO12 routing.
remove={'0f514270-67c6-42ac-ac50-7ec653c46771','75b3b131-ddf9-42b3-8f67-5426ed1ad40f','ad82d4f6-e960-454f-ac71-3add31c8fe7a','6d555d3f-9841-4147-863f-f6ea55b1c823','9016b379-01e7-452a-9c3d-9a55d274dd12','d72eec5c-4928-441e-b5e9-f6a4b1f88f1f','eb0f3ff3-d1f0-423a-95bf-0e8139214a13'}
for token in ('segment','via'):
    for st,en in reversed(blocks(s,token)):
        if any(u in s[st:en] for u in remove): s=s[:st]+s[en:]

uc=0
def U():
    global uc
    uc+=1
    return str(uuid.uuid5(uuid.NAMESPACE_DNS,f'esp32-carrier-final-{uc}'))
def seg(a,b,w,l,n):
    return f'\t(segment\n\t\t(start {a})\n\t\t(end {b})\n\t\t(width {w})\n\t\t(layer "{l}")\n\t\t(net "{n}")\n\t\t(uuid "{U()}")\n\t)\n'
def via(a,n):
    return f'\t(via\n\t\t(at {a})\n\t\t(size 1)\n\t\t(drill 0.5)\n\t\t(layers "F.Cu" "B.Cu")\n\t\t(net "{n}")\n\t\t(uuid "{U()}")\n\t)\n'
new=''
new+=seg('69.1 101.5','71.1 100.5','0.5','F.Cu','+5V')
new+=seg('71.1 100.5','71.1 99.5','0.5','F.Cu','+5V')+via('71.1 99.5','+5V')+seg('71.1 99.5','71.1 92','0.8','B.Cu','+5V')
new+=seg('88 92','88 103','0.8','B.Cu','+5V')
new+=seg('73.9 100.5','73.9 99.5','0.5','F.Cu','GND')+via('73.9 99.5','GND')
new+=seg('66.9 101.5','65.5 101.5','0.4','F.Cu','GND')+seg('65.5 101.5','65.5 103.5','0.4','F.Cu','GND')+seg('65.5 103.5','66.9 103.5','0.4','F.Cu','GND')+via('65.5 102.5','GND')
new+=seg('95 96','100 103','0.6','B.Cu','GND')
new+=seg('50 52.94','55 52.94','0.28','F.Cu','AUX_GPIO12')+seg('55 52.94','55 74','0.28','F.Cu','AUX_GPIO12')+seg('55 74','43 74','0.28','F.Cu','AUX_GPIO12')

# Insert new routing as children of the root kicad_pcb expression, never before it.
insert_at=s.rfind('\n)')
if insert_at < 0 or not s.lstrip().startswith('(kicad_pcb'):
    raise SystemExit('could not locate kicad_pcb root closing parenthesis')
s=s[:insert_at+1]+new+s[insert_at+1:]
out.write_text(s)
sha=hashlib.sha256(out.read_bytes()).hexdigest()
EXPECTED_OUT='05d585b12f9cec7640b59fd1fc53a8c779604dfc909ee3539ee5339dd1ae94e1'
print('final board sha256',sha)
if sha!=EXPECTED_OUT: raise SystemExit('final board SHA mismatch')
