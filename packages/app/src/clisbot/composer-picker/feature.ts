/**
 * Rollback boundary for the composer picker (docs/features/composer-picker/README.md): the Model
 * chip, its options panel and the Mode dropdown, with Full auto-accept offered in the Mode list.
 * `EXPO_PUBLIC_CLISBOT_COMPOSER_PICKER=0` restores the upstream toolbar and model sheet.
 */
export const COMPOSER_PICKER_ENABLED = process.env.EXPO_PUBLIC_CLISBOT_COMPOSER_PICKER !== "0";
