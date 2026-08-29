; ماكرو مخصص لمثبّت مكتبة — يعرض خيار حذف بيانات النسخة السابقة قبل التثبيت
; يُحقن تلقائيًا عبر خيار nsis.include في electron-builder.yml

!macro customInstall
  ; مجلد بيانات التطبيق (userData): %APPDATA%\maktaba
  ; إن وُجدت بيانات قديمة (مكتبة كتب/أغلفة/قاعدة بيانات) نسأل المستخدم
  IfFileExists "$APPDATA\maktaba\library\*.*" old_data_found 0
  IfFileExists "$APPDATA\maktaba\covers\*.*" old_data_found 0
  IfFileExists "$APPDATA\maktaba\maktaba.db" old_data_found 0
  Goto no_old_data

  old_data_found:
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "تم العثور على بيانات من نسخة سابقة من تطبيق مكتبة (الكتب المستوردة والأغلفة والإعدادات).$\n$\nهل تريد حذفها والبدء من جديد؟$\n(اختر «لا» للاحتفاظ ببياناتك الحالية)$\n$\n$\nOld version data found (imported books, covers, settings).$\nDelete it and start fresh? Choose No to keep your data." \
      IDYES delete_old_data IDNO keep_old_data
    delete_old_data:
      DetailPrint "جارٍ حذف بيانات النسخة السابقة…"
      RMDir /r "$APPDATA\maktaba"
      Goto no_old_data
    keep_old_data:
      DetailPrint "تم الاحتفاظ ببيانات النسخة السابقة."
      Goto no_old_data

  no_old_data:
    ; إعادة إنشاء الاختصارات بأيقونة التطبيق الصحيحة (exe غير معدّل الموارد على لينكس)
    IfFileExists "$INSTDIR\resources\icon.ico" 0 skip_shortcuts
      CreateShortCut "$DESKTOP\مكتبة.lnk" "$INSTDIR\مكتبة.exe" "" "$INSTDIR\resources\icon.ico" 0
      CreateShortCut "$SMPROGRAMS\مكتبة.lnk" "$INSTDIR\مكتبة.exe" "" "$INSTDIR\resources\icon.ico" 0
    skip_shortcuts:
!macroend

; عند إزالة التطبيق: تنظيف بقايا البيانات إن اختار المستخدم ذلك
; (يُضاف خيار جاهز من electron-builder: deleteAppDataOnUninstall)
!macro customUnInstall
  ; لا حاجة لخطوات إضافية — deleteAppDataOnUninstall يتكفل بعرض مربع الحذف
!macroend
