import { COMPOSER_PICKER_ENABLED } from "@/clisbot/composer-picker/feature";

/**
 * Rollback boundary for the chat composer layout (docs/features/composer-picker/README.md,
 * "Layout"): the one-line pill, the buttons beside it and the settings row under it. It rides
 * the picker's flag, `EXPO_PUBLIC_CLISBOT_COMPOSER_PICKER=0` restores the upstream composer.
 */
export const COMPOSER_LAYOUT_ENABLED = COMPOSER_PICKER_ENABLED;
