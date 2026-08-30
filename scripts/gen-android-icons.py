#!/usr/bin/env python3
"""توليد أيقونات أندرويد لمكتبة من build/icon.ico + خلفيات بسيطة للشاشة الافتتاحية"""
from PIL import Image, ImageDraw
import os

ROOT = '/home/z/my-project/maktaba_repo/android/app/src/main/res'

ico = Image.open('/home/z/my-project/maktaba_repo/build/icon.ico')
# أكبر طبقة داخل ico
try:
    ico.size  # PIL يفتح أكبر صورة تلقائيًا
except Exception:
    pass
print('source icon size:', ico.size, ico.mode)

def save(img, rel, size=None):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if size:
        img = img.resize((size, size), Image.LANCZOS)
    img.save(path)
    return path

# أيقونة قياسية لكل كثافة
densities = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
for d, s in densities.items():
    save(ico.convert('RGBA'), f'mipmap-{d}/ic_launcher.png', s)
    # دائرية
    mask = Image.new('L', (s * 4, s * 4), 0)
    dr = ImageDraw.Draw(mask)
    dr.ellipse((0, 0, s * 4 - 1, s * 4 - 1), fill=255)
    mask = mask.resize((s, s), Image.LANCZOS)
    round_img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    round_img.paste(ico.convert('RGBA').resize((s, s), Image.LANCZOS), (0, 0), mask)
    save(round_img, f'mipmap-{d}/ic_launcher_round.png')
    # أيقونة تكيّفية — المحتوى في الوسط 66% (منطقة آمنة)
    fg_size = int(s * 1.5)
    canvas = Image.new('RGBA', (fg_size, fg_size), (0, 0, 0, 0))
    inner = int(fg_size * 0.62)
    icon_r = ico.convert('RGBA').resize((inner, inner), Image.LANCZOS)
    off = (fg_size - inner) // 2
    canvas.paste(icon_r, (off, off), icon_r)
    save(canvas, f'mipmap-{d}/ic_launcher_foreground.png', fg_size)

# خلفية بيضاء للشاشة الافتتاحية
splash = Image.new('RGB', (1280, 1920), (247, 248, 250))
save(splash.convert('RGB'), 'drawable/splash.png')
print('icons generated OK')
