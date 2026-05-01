from pathlib import Path
p = Path('renderer.js')
lines = p.read_text(encoding='utf-8').splitlines()
for i in range(331, 339):
    print(f'{i}: {lines[i]!r}')
