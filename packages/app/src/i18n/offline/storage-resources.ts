import type { SupportedLocale } from "@/i18n/locales";

/**
 * Offline O2 copy (docs/features/offline/offline-cache.md): the chat image placeholder and
 * Settings → Storage. Every app locale, merged into the `offline` namespace.
 */
const en = {
  chat: {
    image: "[Image]",
  },
  storage: {
    title: "Storage",
    offlineCache: "Offline cache",
    offlineCacheHint: "Recent sessions, chats and downloaded files kept on this device",
    used: "{{size}} used",
    clear: "Clear",
    clearing: "Clearing...",
    confirmTitle: "Clear offline cache?",
    confirmMessage:
      "Saved sessions, chats and downloaded files are removed from this device. Nothing is deleted on your Hosts; a session downloads again when you open it.",
    cleared: "Offline cache cleared",
    clearFailed: "Unable to clear the offline cache",
  },
};

type OfflineStorageResources = typeof en;

const vi: OfflineStorageResources = {
  chat: { image: "[Hình ảnh]" },
  storage: {
    title: "Bộ nhớ",
    offlineCache: "Bộ nhớ đệm ngoại tuyến",
    offlineCacheHint: "Phiên, cuộc trò chuyện và tệp đã tải gần đây được lưu trên thiết bị này",
    used: "Đã dùng {{size}}",
    clear: "Xóa",
    clearing: "Đang xóa...",
    confirmTitle: "Xóa bộ nhớ đệm ngoại tuyến?",
    confirmMessage:
      "Các phiên, cuộc trò chuyện và tệp đã tải được lưu sẽ bị xóa khỏi thiết bị này. Không có gì bị xóa trên các Host; phiên sẽ được tải lại khi bạn mở.",
    cleared: "Đã xóa bộ nhớ đệm ngoại tuyến",
    clearFailed: "Không thể xóa bộ nhớ đệm ngoại tuyến",
  },
};

const ar: OfflineStorageResources = {
  chat: { image: "[صورة]" },
  storage: {
    title: "التخزين",
    offlineCache: "ذاكرة التخزين دون اتصال",
    offlineCacheHint: "الجلسات والمحادثات والملفات المنزّلة مؤخرًا المحفوظة على هذا الجهاز",
    used: "المستخدم {{size}}",
    clear: "مسح",
    clearing: "جارٍ المسح...",
    confirmTitle: "مسح ذاكرة التخزين دون اتصال؟",
    confirmMessage:
      "ستُزال الجلسات والمحادثات والملفات المنزّلة المحفوظة من هذا الجهاز. لا يُحذف شيء من المضيفات؛ تُنزَّل الجلسة مجددًا عند فتحها.",
    cleared: "تم مسح ذاكرة التخزين دون اتصال",
    clearFailed: "تعذّر مسح ذاكرة التخزين دون اتصال",
  },
};

const es: OfflineStorageResources = {
  chat: { image: "[Imagen]" },
  storage: {
    title: "Almacenamiento",
    offlineCache: "Caché sin conexión",
    offlineCacheHint:
      "Sesiones, chats y archivos descargados recientes guardados en este dispositivo",
    used: "{{size}} en uso",
    clear: "Borrar",
    clearing: "Borrando...",
    confirmTitle: "¿Borrar la caché sin conexión?",
    confirmMessage:
      "Las sesiones, los chats y los archivos descargados guardados se eliminan de este dispositivo. No se borra nada en tus Hosts; una sesión se vuelve a descargar al abrirla.",
    cleared: "Caché sin conexión borrada",
    clearFailed: "No se pudo borrar la caché sin conexión",
  },
};

const fr: OfflineStorageResources = {
  chat: { image: "[Image]" },
  storage: {
    title: "Stockage",
    offlineCache: "Cache hors ligne",
    offlineCacheHint:
      "Sessions, discussions et fichiers téléchargés récents conservés sur cet appareil",
    used: "{{size}} utilisés",
    clear: "Vider",
    clearing: "Vidage...",
    confirmTitle: "Vider le cache hors ligne ?",
    confirmMessage:
      "Les sessions, discussions et fichiers téléchargés enregistrés sont supprimés de cet appareil. Rien n'est supprimé sur vos Hosts ; une session se télécharge à nouveau à son ouverture.",
    cleared: "Cache hors ligne vidé",
    clearFailed: "Impossible de vider le cache hors ligne",
  },
};

const ja: OfflineStorageResources = {
  chat: { image: "[画像]" },
  storage: {
    title: "ストレージ",
    offlineCache: "オフラインキャッシュ",
    offlineCacheHint:
      "このデバイスに保存された最近のセッション、チャット、ダウンロードしたファイル",
    used: "{{size}} 使用中",
    clear: "消去",
    clearing: "消去中...",
    confirmTitle: "オフラインキャッシュを消去しますか？",
    confirmMessage:
      "保存されたセッション、チャット、ダウンロードしたファイルがこのデバイスから削除されます。Host 上のデータは削除されません。セッションは開いたときに再度ダウンロードされます。",
    cleared: "オフラインキャッシュを消去しました",
    clearFailed: "オフラインキャッシュを消去できません",
  },
};

const ko: OfflineStorageResources = {
  chat: { image: "[이미지]" },
  storage: {
    title: "저장 공간",
    offlineCache: "오프라인 캐시",
    offlineCacheHint: "이 기기에 보관된 최근 세션, 채팅, 다운로드한 파일",
    used: "{{size}} 사용 중",
    clear: "지우기",
    clearing: "지우는 중...",
    confirmTitle: "오프라인 캐시를 지울까요?",
    confirmMessage:
      "저장된 세션, 채팅, 다운로드한 파일이 이 기기에서 삭제됩니다. Host에서는 아무것도 삭제되지 않으며, 세션은 열 때 다시 다운로드됩니다.",
    cleared: "오프라인 캐시를 지웠습니다",
    clearFailed: "오프라인 캐시를 지울 수 없습니다",
  },
};

const ptBR: OfflineStorageResources = {
  chat: { image: "[Imagem]" },
  storage: {
    title: "Armazenamento",
    offlineCache: "Cache offline",
    offlineCacheHint: "Sessões, chats e arquivos baixados recentes guardados neste dispositivo",
    used: "{{size}} em uso",
    clear: "Limpar",
    clearing: "Limpando...",
    confirmTitle: "Limpar o cache offline?",
    confirmMessage:
      "Sessões, chats e arquivos baixados salvos são removidos deste dispositivo. Nada é excluído nos seus Hosts; uma sessão é baixada novamente quando você a abre.",
    cleared: "Cache offline limpo",
    clearFailed: "Não foi possível limpar o cache offline",
  },
};

const ru: OfflineStorageResources = {
  chat: { image: "[Изображение]" },
  storage: {
    title: "Хранилище",
    offlineCache: "Офлайн-кэш",
    offlineCacheHint: "Недавние сеансы, чаты и загруженные файлы на этом устройстве",
    used: "Занято {{size}}",
    clear: "Очистить",
    clearing: "Очистка...",
    confirmTitle: "Очистить офлайн-кэш?",
    confirmMessage:
      "Сохранённые сеансы, чаты и загруженные файлы будут удалены с этого устройства. На ваших Host ничего не удаляется; сеанс загрузится снова, когда вы его откроете.",
    cleared: "Офлайн-кэш очищен",
    clearFailed: "Не удалось очистить офлайн-кэш",
  },
};

const zhCN: OfflineStorageResources = {
  chat: { image: "[图片]" },
  storage: {
    title: "存储",
    offlineCache: "离线缓存",
    offlineCacheHint: "保存在此设备上的近期会话、聊天和已下载文件",
    used: "已使用 {{size}}",
    clear: "清除",
    clearing: "正在清除...",
    confirmTitle: "清除离线缓存？",
    confirmMessage:
      "已保存的会话、聊天和已下载文件将从此设备中移除。你的 Host 上不会删除任何内容；打开会话时会重新下载。",
    cleared: "离线缓存已清除",
    clearFailed: "无法清除离线缓存",
  },
};

export const offlineStorageResources: Readonly<Record<SupportedLocale, OfflineStorageResources>> = {
  ar,
  en,
  es,
  fr,
  ja,
  ko,
  "pt-BR": ptBR,
  ru,
  vi,
  "zh-CN": zhCN,
};
