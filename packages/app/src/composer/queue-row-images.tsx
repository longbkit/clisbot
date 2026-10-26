import { useCallback, useMemo, useState } from "react";
import { Image, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { AttachmentLightbox, type ImageLightboxSource } from "@/components/attachment-lightbox";
import { PressHighlight } from "@/components/ui/press-highlight";

/** An image a queued message carries, keyed for its thumbnail row. */
export interface QueueImage {
  key: string;
  source: ImageLightboxSource;
}

const THUMB = 64;

export function QueueImages({ images }: { images: readonly QueueImage[] }) {
  const [open, setOpen] = useState<ImageLightboxSource | null>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <>
      <ScrollView horizontal contentContainerStyle={styles.images} testID="host-queue-images">
        {images.map((image) => (
          <QueueImageThumb key={image.key} source={image.source} onOpen={setOpen} />
        ))}
      </ScrollView>
      <AttachmentLightbox source={open} onClose={close} />
    </>
  );
}

function QueueImageThumb({
  source,
  onOpen,
}: {
  source: ImageLightboxSource;
  onOpen(source: ImageLightboxSource): void;
}) {
  const { t } = useTranslation();
  const preview = useAttachmentPreviewUrl(source.type === "attachment" ? source.metadata : null);
  const uri = source.type === "uri" ? source.uri : preview;
  const open = useCallback(() => onOpen(source), [onOpen, source]);
  const image = useMemo(() => (uri ? { uri } : null), [uri]);
  return (
    <PressHighlight
      onPress={open}
      accessibilityRole="imagebutton"
      accessibilityLabel={t("composer.hostQueue.openImage")}
      style={styles.thumb}
      testID="host-queue-image"
    >
      {image ? <Image source={image} style={styles.thumbImage} resizeMode="cover" /> : null}
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  images: {
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
    backgroundColor: theme.colors.surface2,
  },
  thumbImage: { width: THUMB, height: THUMB },
}));
