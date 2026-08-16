# 🎙️ RVC Studio — إزاي تشغّلها

> عايز كود الخلايا جاهز للصق في Colab؟ → **[COLAB_CELLS.md](COLAB_CELLS.md)**

فيه ٣ طرق. اختار **الطريقة ١** لو عايز استنساخ صوت حقيقي.

---

## الطريقة ١ · Colab بـ GPU ← دي اللي محتاجها

دي بديل النوتبوك القديم بالظبط، بس بتفتحلك التطبيق كامل جوه Colab.

1. افتح [colab.research.google.com](https://colab.research.google.com)
2. **File → Open notebook → GitHub** والصق:
   ```
   https://github.com/husseinessamhussein9-ai/hussein
   ```
   واختار الفرع `arena/01a00a0d-hussein` وبعدين `RVC_Studio_Colab.ipynb`
3. **Runtime → Change runtime type → T4 GPU** ← مهم جدًا، من غيرها مفيش استنساخ حقيقي
4. شغّل أول خلية (زرار ▶) واستنى دقيقتين
5. التطبيق هيظهر **جوه النوتبوك نفسه** — مش هتحتاج تشغّل خلايا تانية

بعد كده كل شغلك من الواجهة:
- **Convert** → ارمي الصوت، اختار الموديل، اضغط Convert
- **Models** → استورد موديل من zip أو لينك
- **Train** → ارفع تسجيلات ودرّب صوت جديد

> بديل أسرع: افتح خلية جديدة في أي نوتبوك Colab (GPU شغال) والصق ده:
> ```python
> !git clone -b arena/01a00a0d-hussein https://github.com/husseinessamhussein9-ai/hussein
> %cd hussein
> !pip install -q -r requirements.txt
> import subprocess, threading, time
> threading.Thread(target=lambda: subprocess.run(
>     ['python','-m','rvc_studio.cli','serve','--port','7860']), daemon=True).start()
> time.sleep(8)
> from google.colab import output; output.serve_kernel_port_as_iframe(7860, height=900)
> ```

---

## الطريقة ٢ · على جهازك

```bash
git clone -b arena/01a00a0d-hussein https://github.com/husseinessamhussein9-ai/hussein
cd hussein
pip install -r requirements.txt
python -m rvc_studio.cli serve
```

افتح المتصفح على: **http://localhost:7860**

لو جهازك فيه كارت NVIDIA وعايز الاستنساخ الحقيقي:
```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install rvc-python
```

---

## الطريقة ٣ · من غير واجهة (سطر أوامر)

```bash
# افحص الصوت الأول
python -m rvc_studio.cli analyze input.wav

# حوّل ملف واحد والـ pitch يتظبط لوحده
python -m rvc_studio.cli convert in.wav -m myvoice --auto-pitch -o out.wav

# حوّل فولدر كامل
python -m rvc_studio.cli batch ./inputs -m myvoice --format mp3

# درّب صوت جديد
python -m rvc_studio.cli dataset build myvoice ./raw/*.wav
python -m rvc_studio.cli train myvoice --dataset myvoice
```

---

## خطوات أول تحويل (بالترتيب)

1. **هات موديل**: تبويب **Models** ← اكتب اسم ← ارفع ملف `.zip` أو `.pth`
   (أو حط لينك مباشر من Hugging Face)
2. **تبويب Convert**: ارمي ملف الصوت (أو سجّل بالمايك من الزرار)
3. اختار الموديل من القائمة
4. اضغط **`auto ✦`** — هيحسب الـ pitch المضبوط بدل ما تخمّن
5. اضغط **Convert**
6. الناتج بيظهر في **Library** — اسمعه ونزّله

---

## حاجات مهمة

- **بدون GPU** التطبيق شغال بمحرك DSP: بيغيّر النبرة والطابع الصوتي فعلًا، لكنه **مش استنساخ متدرب**. الواجهة دايمًا بتوضّحلك أي محرك اشتغل.
- الموديلات بتتخزن في `data/models/`. في Colab اربط Google Drive عشان متضيعش بين الجلسات.
- الصوت الأصلي المفروض يكون **نضيف وواضح** — من غير موسيقى أو ضوضاء.
- للتدريب: **١٠ دقايق أو أكتر** كلام نضيف عشان تطلع نتيجة كويسة.
- استخدم أصوات عندك حق استخدامها بس.

---

## مشاكل شائعة

| المشكلة | الحل |
|---|---|
| الصفحة مش بتفتح | اتأكد إن الأمر `serve` لسه شغال، وجرّب بورت تاني: `--port 8000` |
| "No .pth weights found" | الـ zip مش فيه ملف موديل — نزّل نسخة تانية |
| الصوت طالع مكسور | افتح Advanced وقلّل **index rate**، أو ظبّط الـ pitch |
| في Colab الجلسة بتفصل | Colab المجاني بيفصل بعد ساعات — احفظ الموديلات على Drive |
