/** Settings → Privacy: the product analytics consent row (clisbot/analytics/settings.tsx). */
const en = {
  title: "Privacy",
  label: "Anonymous stats, never your content",
  description:
    "Only app opens, screens and version with a random ID; never your chats, code, files or Host names.",
  saving: "Saving…",
  unavailable: "Analytics is unavailable in this build.",
  storageError:
    "Collection is paused. Your choice could not be saved; retry before restarting the app.",
  serviceError: "Analytics could not be turned on. Collection stays off; you can retry.",
  detailsLabel: "How analytics works",
  privacyPolicy: "Privacy policy",
  retryLabel: "Save your privacy choice",
  retry: "Retry",
};

const vi: typeof en = {
  title: "Quyền riêng tư",
  label: "Thống kê ẩn danh, không đọc nội dung",
  description:
    "Chỉ gửi lần mở app, tên màn hình và phiên bản kèm một mã ngẫu nhiên; không bao giờ gửi chat, code, file hay tên Host.",
  saving: "Đang lưu…",
  unavailable: "Bản build này không có thống kê.",
  storageError:
    "Đã tạm dừng thu thập. Không lưu được lựa chọn của bạn; hãy thử lại trước khi khởi động lại app.",
  serviceError: "Không bật được thống kê. Thu thập vẫn tắt; bạn có thể thử lại.",
  detailsLabel: "Cách thống kê hoạt động",
  privacyPolicy: "Chính sách quyền riêng tư",
  retryLabel: "Lưu lựa chọn quyền riêng tư",
  retry: "Thử lại",
};

const zhCN: typeof en = {
  title: "隐私",
  label: "匿名统计，从不读取你的内容",
  description:
    "仅发送应用打开、页面名称和版本，并附带一个随机 ID；从不发送你的聊天、代码、文件或 Host 名称。",
  saving: "正在保存…",
  unavailable: "此版本不提供统计。",
  storageError: "已暂停收集。无法保存你的选择；请在重启应用前重试。",
  serviceError: "无法开启统计。收集保持关闭；你可以重试。",
  detailsLabel: "统计如何工作",
  privacyPolicy: "隐私政策",
  retryLabel: "保存你的隐私选择",
  retry: "重试",
};

const ja: typeof en = {
  title: "プライバシー",
  label: "匿名の統計（内容は読みません）",
  description:
    "アプリの起動、画面名、バージョンのみをランダムな ID とともに送信します。チャット、コード、ファイル、Host 名は送信しません。",
  saving: "保存中…",
  unavailable: "このビルドでは統計を利用できません。",
  storageError:
    "収集を一時停止しました。選択を保存できませんでした。アプリを再起動する前に再試行してください。",
  serviceError: "統計をオンにできませんでした。収集はオフのままです。再試行できます。",
  detailsLabel: "統計の仕組み",
  privacyPolicy: "プライバシーポリシー",
  retryLabel: "プライバシーの選択を保存",
  retry: "再試行",
};

const ko: typeof en = {
  title: "개인정보",
  label: "익명 통계, 내용은 읽지 않음",
  description:
    "앱 실행, 화면 이름, 버전만 무작위 ID와 함께 보냅니다. 채팅, 코드, 파일, Host 이름은 절대 보내지 않습니다.",
  saving: "저장 중…",
  unavailable: "이 빌드에서는 통계를 사용할 수 없습니다.",
  storageError:
    "수집이 일시 중지되었습니다. 선택을 저장하지 못했습니다. 앱을 다시 시작하기 전에 다시 시도하세요.",
  serviceError: "통계를 켤 수 없습니다. 수집은 꺼진 상태로 유지됩니다. 다시 시도할 수 있습니다.",
  detailsLabel: "통계 작동 방식",
  privacyPolicy: "개인정보 처리방침",
  retryLabel: "개인정보 선택 저장",
  retry: "다시 시도",
};

const es: typeof en = {
  title: "Privacidad",
  label: "Estadísticas anónimas, nunca tu contenido",
  description:
    "Solo aperturas de la app, pantallas y versión con un ID aleatorio; nunca tus chats, código, archivos ni nombres de Host.",
  saving: "Guardando…",
  unavailable: "Las estadísticas no están disponibles en esta versión.",
  storageError:
    "La recopilación está en pausa. No se pudo guardar tu elección; reinténtalo antes de reiniciar la app.",
  serviceError:
    "No se pudieron activar las estadísticas. La recopilación sigue desactivada; puedes reintentarlo.",
  detailsLabel: "Cómo funcionan las estadísticas",
  privacyPolicy: "Política de privacidad",
  retryLabel: "Guardar tu elección de privacidad",
  retry: "Reintentar",
};

const ptBR: typeof en = {
  title: "Privacidade",
  label: "Estatísticas anônimas, nunca seu conteúdo",
  description:
    "Apenas aberturas do app, telas e versão com um ID aleatório; nunca seus chats, código, arquivos ou nomes de Host.",
  saving: "Salvando…",
  unavailable: "As estatísticas não estão disponíveis nesta versão.",
  storageError:
    "A coleta está pausada. Não foi possível salvar sua escolha; tente novamente antes de reiniciar o app.",
  serviceError:
    "Não foi possível ativar as estatísticas. A coleta continua desativada; você pode tentar novamente.",
  detailsLabel: "Como as estatísticas funcionam",
  privacyPolicy: "Política de privacidade",
  retryLabel: "Salvar sua escolha de privacidade",
  retry: "Tentar novamente",
};

const fr: typeof en = {
  title: "Confidentialité",
  label: "Statistiques anonymes, jamais votre contenu",
  description:
    "Uniquement les ouvertures de l'app, les écrans et la version avec un identifiant aléatoire ; jamais vos chats, votre code, vos fichiers ni les noms d'Host.",
  saving: "Enregistrement…",
  unavailable: "Les statistiques ne sont pas disponibles dans cette version.",
  storageError:
    "La collecte est en pause. Votre choix n'a pas pu être enregistré ; réessayez avant de redémarrer l'app.",
  serviceError:
    "Impossible d'activer les statistiques. La collecte reste désactivée ; vous pouvez réessayer.",
  detailsLabel: "Fonctionnement des statistiques",
  privacyPolicy: "Politique de confidentialité",
  retryLabel: "Enregistrer votre choix de confidentialité",
  retry: "Réessayer",
};

const ru: typeof en = {
  title: "Конфиденциальность",
  label: "Анонимная статистика, без доступа к вашему контенту",
  description:
    "Только запуски приложения, названия экранов и версия со случайным ID; никогда не отправляем ваши чаты, код, файлы и имена Host.",
  saving: "Сохранение…",
  unavailable: "В этой сборке статистика недоступна.",
  storageError:
    "Сбор приостановлен. Не удалось сохранить ваш выбор; повторите попытку до перезапуска приложения.",
  serviceError:
    "Не удалось включить статистику. Сбор остаётся выключенным; можно повторить попытку.",
  detailsLabel: "Как работает статистика",
  privacyPolicy: "Политика конфиденциальности",
  retryLabel: "Сохранить выбор конфиденциальности",
  retry: "Повторить",
};

const ar: typeof en = {
  title: "الخصوصية",
  label: "إحصاءات مجهولة الهوية، لا نقرأ محتواك أبدًا",
  description:
    "نرسل فقط مرات فتح التطبيق وأسماء الشاشات والإصدار مع معرّف عشوائي؛ ولا نرسل أبدًا محادثاتك أو الكود أو الملفات أو أسماء Host.",
  saving: "جارٍ الحفظ…",
  unavailable: "الإحصاءات غير متاحة في هذا الإصدار.",
  storageError: "تم إيقاف الجمع مؤقتًا. تعذّر حفظ اختيارك؛ أعد المحاولة قبل إعادة تشغيل التطبيق.",
  serviceError: "تعذّر تفعيل الإحصاءات. يظل الجمع متوقفًا؛ يمكنك إعادة المحاولة.",
  detailsLabel: "كيف تعمل الإحصاءات",
  privacyPolicy: "سياسة الخصوصية",
  retryLabel: "احفظ اختيار الخصوصية",
  retry: "إعادة المحاولة",
};

export const productAnalytics = {
  en,
  ar,
  es,
  fr,
  ja,
  ko,
  "pt-BR": ptBR,
  ru,
  vi,
  "zh-CN": zhCN,
};
