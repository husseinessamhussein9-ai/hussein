# 📋 كود خلايا Colab — انسخ والصق

> **قبل ما تبدأ:** من فوق اختار **Runtime → Change runtime type → T4 GPU** ← لازم، من غيرها مفيش استنساخ حقيقي.

محتاج **خلية واحدة بس** (الخلية ١). الباقي اختياري.

---

## 🟢 الخلية ١ — التثبيت والتشغيل (دي اللي محتاجها)

اعمل خلية Code والصق ده كله، وبعدين اضغط ▶ واستنى ٢–٣ دقايق:

```python
# ============ RVC Studio — تثبيت وتشغيل ============
import os, sys, subprocess, threading, time

REPO   = "https://github.com/husseinessamhussein9-ai/hussein"
BRANCH = "arena/01a00a0d-hussein"

if not os.path.exists('/content/hussein'):
    subprocess.run(['git','clone','--depth','1','-b',BRANCH,REPO,'/content/hussein'], check=True)
os.chdir('/content/hussein')

print('⏳ بتثبت المكتبات...')
subprocess.run([sys.executable,'-m','pip','install','-q','-r','requirements.txt'], check=True)

# محرك RVC الحقيقي (محتاج GPU)
print('⏳ بتثبت محرك RVC...')
subprocess.run([sys.executable,'-m','pip','install','-q','rvc-python'], check=False)

import rvc_studio.engine as E
info = E.engine_info()
print('\n🎛️  المحرك:', info['backend'], '| GPU:', info['gpu'], '|', info['device'])
if not info['real_clone']:
    print('⚠️  شغال بمحرك DSP (مش استنساخ متدرب). اتأكد إن الـ Runtime على GPU.')

threading.Thread(target=lambda: subprocess.run(
    [sys.executable,'-m','rvc_studio.cli','serve','--port','7860']), daemon=True).start()
time.sleep(8)

from google.colab import output
output.serve_kernel_port_as_iframe(7860, height=900)
```

**بعد ما تخلص:** التطبيق هيظهر تحت الخلية على طول. اشتغل منه عادي:
`Convert` للتحويل · `Models` للموديلات · `Train` للتدريب · `Library` للنتايج

---

## 🔵 الخلية ٢ — احفظ الموديلات على Google Drive (اختياري بس مفيد)

من غيرها الموديلات بتضيع لما الجلسة تفصل. **شغّلها قبل الخلية ١**:

```python
from google.colab import drive
drive.mount('/content/drive')

import os, shutil
os.makedirs('/content/drive/MyDrive/rvc_studio_data', exist_ok=True)
os.makedirs('/content/hussein', exist_ok=True)
if os.path.exists('/content/hussein/data') and not os.path.islink('/content/hussein/data'):
    shutil.rmtree('/content/hussein/data')
if not os.path.exists('/content/hussein/data'):
    os.symlink('/content/drive/MyDrive/rvc_studio_data', '/content/hussein/data')
print('✅ الموديلات هتتحفظ في Drive/rvc_studio_data')
```

---

## 🟡 الخلية ٣ — تحويل فولدر كامل (اختياري)

```python
INPUT_FOLDER = "/content/drive/MyDrive/audio_in"   # مكان الملفات
MODEL        = "اسم_الموديل"
PITCH        = 0
AUTO_PITCH   = True      # يحسب الـ pitch لوحده
FORMAT       = "wav"     # wav / mp3 / flac / ogg

cmd = f'python -m rvc_studio.cli batch "{INPUT_FOLDER}" -m "{MODEL}" -p {PITCH} --format {FORMAT}'
if AUTO_PITCH: cmd += ' --auto-pitch'
!{cmd}
```

---

## 🟠 الخلية ٤ — تدريب صوت جديد (اختياري)

```python
DATASET_NAME = "myvoice"
RAW_FOLDER   = "/content/drive/MyDrive/raw_voice"   # تسجيلات نضيفة، ١٠ دقايق+
EPOCHS       = 0    # 0 = يختار لوحده حسب كمية الصوت

!python -m rvc_studio.cli dataset build {DATASET_NAME} {RAW_FOLDER}/*
extra = f'--epochs {EPOCHS}' if EPOCHS else ''
!python -m rvc_studio.cli train {DATASET_NAME} --dataset {DATASET_NAME} {extra}
```

---

## 🔴 الخلية ٥ — فحص سريع لو حاجة مش شغالة

```python
!python -m rvc_studio.cli info
!python -m pytest tests -q 2>&1 | tail -5
```

---

## ❓ مشاكل متكررة

| المشكلة | السبب والحل |
|---|---|
| `backend: dsp` وانت عايز استنساخ حقيقي | الـ Runtime مش GPU → Runtime → Change runtime type → **T4 GPU** → وبعدين **Runtime → Restart** وشغّل الخلية تاني |
| الواجهة مش ظاهرة | استنى ١٠ ثواني كمان وشغّل آخر سطرين (`output.serve_kernel_port_as_iframe`) لوحدهم |
| `No .pth weights found` | الـ zip مفيهوش ملف موديل — نزّل نسخة تانية |
| الجلسة فصلت والموديلات راحت | شغّل **الخلية ٢** (Drive) قبل الخلية ١ |
| الصوت طالع مكسور | من Advanced قلّل **index rate**، أو ظبّط الـ pitch |
