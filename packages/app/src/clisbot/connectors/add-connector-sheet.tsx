import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { ConnectorLogo, serverLogoKey } from "./connector-logo";

export type ConnectorChoice =
  | { kind: "app"; slug: string; name: string; logo?: string }
  | { kind: "mcp"; name: string };

/** Offers the connected apps and MCP servers a Project does not use yet. */
export function AddConnectorSheet({
  visible,
  choices,
  onClose,
  onChoose,
  onManage,
}: {
  visible: boolean;
  choices: ConnectorChoice[];
  onClose(): void;
  onChoose(choice: ConnectorChoice): void;
  onManage(): void;
}) {
  const { t } = useTranslation();
  const header = useMemo(() => ({ title: t("connectors.screen.common.addConnector") }), [t]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="ghost" onPress={onManage}>
          {t("connectors.screen.addSheet.connectMore")}
        </Button>
      </View>
    ),
    [onManage, t],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={480}
    >
      {choices.length === 0 ? (
        <Text style={settingsStyles.rowHint}>{t("connectors.screen.addSheet.allAdded")}</Text>
      ) : (
        <View style={settingsStyles.card}>
          {choices.map((choice, index) => (
            <ChoiceRow
              key={choiceKey(choice)}
              choice={choice}
              bordered={index > 0}
              onChoose={onChoose}
            />
          ))}
        </View>
      )}
    </AdaptiveModalSheet>
  );
}

function choiceKey(choice: ConnectorChoice): string {
  return choice.kind === "app" ? `app:${choice.slug}` : `mcp:${choice.name}`;
}

function ChoiceRow({
  choice,
  bordered,
  onChoose,
}: {
  choice: ConnectorChoice;
  bordered: boolean;
  onChoose(choice: ConnectorChoice): void;
}) {
  const { t } = useTranslation();
  const press = useCallback(() => onChoose(choice), [choice, onChoose]);
  const slug = choice.kind === "app" ? choice.slug : serverLogoKey(choice.name);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={press}
      style={bordered ? borderedRowStyle : rowStyle}
      testID={`bot-connectors-choice-${choiceKey(choice)}`}
    >
      <ConnectorLogo
        slug={slug}
        name={choice.name}
        logo={choice.kind === "app" ? choice.logo : undefined}
      />
      <Text style={[settingsStyles.rowTitle, settingsStyles.rowContent]}>{choice.name}</Text>
      <Text style={settingsStyles.rowHint}>
        {choice.kind === "app"
          ? t("connectors.screen.common.app")
          : t("connectors.screen.common.mcpServer")}
      </Text>
    </Pressable>
  );
}

function rowStyle({ pressed }: { pressed: boolean }) {
  return [styles.row, pressed ? styles.pressed : null];
}

function borderedRowStyle({ pressed }: { pressed: boolean }) {
  return [styles.row, settingsStyles.rowBorder, pressed ? styles.pressed : null];
}

const styles = StyleSheet.create((theme) => ({
  footer: { flexDirection: "row", justifyContent: "flex-start" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  pressed: { backgroundColor: theme.colors.surface2 },
}));
