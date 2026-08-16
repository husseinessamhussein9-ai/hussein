# 🎤 BahaaAI - RVC v1.5 : Model Training & Inference

Google Colab Notebook كامل لـ **RVC Voice Cloning** - استنساخ الأصوات بالذكاء الاصطناعي.

هذه الأداة مطابقة تماماً للفيديو: [How To Load Trained RVC Models & Resume Training On Google Colab](https://youtu.be/DBtvXcPYcXU) من قناة [BahaaAI](https://www.youtube.com/@BahaaAI).

---

## 📋 محتويات الأداة

### 🔧 الإعداد والتثبيت
- **Step 1**: Prepare Files - تحميل ملفات RVC من Hugging Face
- **Step 2**: Install RVC - تثبيت المكتبات المطلوبة (5 دقائق)
- **Step 3**: 5 August 2026 Update - تحديث التوافق

### 📚 التدريب (Training)
- **Step 4**: Mount Google Drive - ربط Google Drive
- **Step 5**: Upload Dataset - رفع ملفات الصوت للتدريب
- **Step 6**: Preprocess Dataset - استخراج المميزات
- **Step 7**: Extract f0 Features - استخراج ميزات الطبقة الصوتية
- **Step 8**: Train RVC Model - تدريب النموذج
- **Step 9**: Generate Index File - إنشاء ملف الفهرس
- **Step 10**: Save Model to Drive - حفظ النموذج على Drive

### 🔄 تحميل واستئناف التدريب
- **Step 11**: Load Trained Model from Google Drive - تحميل نموذج محفوظ
- **Step 12**: Resume Training - استئناف التدريب (مثلاً: من 300 إلى 400 epoch)

### 🎵 الاستدلال (Inference / Voice Conversion)
- **Step 13**: Upload Target Audio - رفع ملف الصوت المراد تحويله
- **Step 14**: Run Voice Conversion - تنفيذ التحويل الصوتي
- **Step 15**: Download Converted Audio - تحميل النتيجة

---

## 🚀 طريقة الاستخدام

### 1️⃣ افتح الـ Notebook في Google Colab

- افتح [Google Colab](https://colab.research.google.com/)
- اضغط **File → Upload Notebook**
- ارفع ملف `BahaaAI_RVC_Voice_Cloning.ipynb`

### 2️⃣ فعّل الـ GPU

- اضغط **Runtime → Change runtime type**
- اختر **Hardware accelerator: T4 GPU**

### 3️⃣ نفّذ الخلايا بالترتيب

- شغّل كل خلية (Cell) واحدة تلو الأخرى بـ **Ctrl+Enter**
- انتظر ظهور علامة ✔ Done قبل الانتقال للخلية التالية

---

## 📊 متطلبات البيانات للتدريب

- **المدة**: 10+ دقائق من التسجيلات الصوتية
- **الجودة**: صوت نظيف بدون ضوضاء
- **المتحدث**: شخص واحد فقط
- **الصيغة**: WAV (مفضلة) أو MP3
- **المحتوى**: يمكن أن يكون صوتك أو أي صوت لديك إذن باستخدامه

---

## ⚙️ إعدادات مهمة

### Pitch Settings (تحويل الطبقة الصوتية)

| التحويل | القيمة (semitones) |
|---------|-------------------|
| Male → Female | +12 |
| Female → Male | -12 |
| Same gender | 0 |

### Quality Settings

| المعامل | الافتراضي | الوصف |
|---------|----------|------|
| `f0_method` | rmvpe | خوارزمية استخراج الطبقة الصوتية |
| `index_rate` | 0.75 | قوة تأثير ملف الفهرس (0-1) |
| `filter_radius` | 3 | قوة التنعيم على منحنى الطبقة الصوتية |
| `resample_sr` | 0 | معدل العينة للإخراج (0 = الأصلي) |
| `rms_mix_rate` | 0.0 | نسبة مزج مستوى الصوت |
| `protect` | 0.5 | حماية الحروف الساكنة من التحويل |

---

## 📁 هيكل Google Drive

```
MyDrive/
└── RVC/
    ├── models/
    │   └── YourModelName/
    │       ├── YourModelName.pth      ← ملف أوزان النموذج
    │       └── YourModelName.index    ← ملف الفهرس
    └── datasets/
        └── YourDataset/                ← مجلد البيانات
```

---

## 🎯 سيناريو الاستخدام الكامل

### تدريب نموذج جديد:
1. **Step 1-3**: تثبيت RVC
2. **Step 4**: ربط Google Drive
3. **Step 5**: رفع بيانات التدريب
4. **Step 6-7**: معالجة البيانات
5. **Step 8**: تدريب النموذج (300-500 epoch)
6. **Step 9**: إنشاء ملف الفهرس
7. **Step 10**: حفظ النموذج على Drive

### استئناف التدريب:
1. **Step 1-3**: تثبيت RVC
2. **Step 4**: ربط Google Drive
3. **Step 11**: تحميل النموذج المحفوظ
4. **Step 12**: استئناف التدريب
5. **Step 10**: حفظ النموذج المحدّث

### استخدام النموذج للتحويل الصوتي:
1. **Step 1-3**: تثبيت RVC
2. **Step 4**: ربط Google Drive
3. **Step 11**: تحميل النموذج
4. **Step 13**: رفع ملف الصوت
5. **Step 14**: تنفيذ التحويل
6. **Step 15**: تحميل النتيجة

---

## 🔗 روابط مفيدة

- 🌐 **الموقع الرسمي**: [bahaa-ai.com](https://bahaa-ai.com)
- 📺 **قناة اليوتيوب**: [BahaaAI](https://www.youtube.com/@BahaaAI)
- 🟢 **واتساب**: [قناة الواتساب](https://whatsapp.com/channel/0029VbBtL8M9xVJmwuhVIv2j)
- 🔵 **تيليجرام**: [Bahaa_AI](https://t.me/Bahaa_AI)
- 📖 **الدرس الكامل**: [How To Load Trained RVC Models & Resume Training](https://bahaa-ai.com/?p=311)

---

## 🟨 دروس ذات صلة

- [How to Clone Any Voice with RVC on Google Colab for FREE](https://youtu.be/VJgOxeGir4M)
- [How to Install RVC on Google Colab - Clone Any Voice](https://youtu.be/DBtvXcPYcXU)

---

## ⚠️ ملاحظات مهمة

- استخدم حساب Gmail نفسه لحفظ وتحميل النماذج
- احفظ النموذج على Google Drive فور انتهاء التدريب
- النموذج يصبح أفضل كلما زاد عدد الـ epochs
- الجلسة المجانية على Colab تستمر 12 ساعة تقريباً
- للإنتاج والاستخدام المكثف، يُنصح بـ Colab Pro

---

## 📜 الترخيص

هذا المشروع مبني على:
- [RVC Project](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI)
- محتوى تعليمي من [BahaaAI](https://bahaa-ai.com)

**Made with ❤️ by BahaaAI**
