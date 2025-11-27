import { COMMAND_LABEL, TOPBAR_BUTTON_ID, TOPBAR_ICON_NAME } from "./constants";
import type { ExtensionAPI } from "./main";

/**
 * Creates an icon button element styled like Roam's built-in buttons.
 */
function createIconButton(icon: string): HTMLSpanElement {
  const button = document.createElement("span");
  button.className = "bp3-button bp3-minimal bp3-small";
  button.tabIndex = 0;

  const iconElement = document.createElement("span");
  iconElement.className = `bp3-icon bp3-icon-${icon}`;
  button.appendChild(iconElement);

  return button;
}

export async function registerCommand(
  extensionAPI: ExtensionAPI,
  onSync: () => Promise<void>
): Promise<() => Promise<void>> {
  const command = {
    label: COMMAND_LABEL,
    callback: () => {
      void onSync();
    },
  };

  const extensionCommandPalette = extensionAPI.ui?.commandPalette;
  if (extensionCommandPalette?.addCommand && extensionCommandPalette?.removeCommand) {
    await extensionCommandPalette.addCommand(command);
    console.info("[todoist-backup] command registered via extensionAPI.ui.commandPalette");

    return async () => {
      await extensionCommandPalette.removeCommand({ label: COMMAND_LABEL });
    };
  }

  const roamAPI = (window as unknown as { roamAlphaAPI?: { ui?: { commandPalette?: { addCommand: (config: { label: string; callback: () => void }) => Promise<void>; removeCommand: (config: { label: string }) => Promise<void> } } } }).roamAlphaAPI;
  const legacyCommandPalette = roamAPI?.ui?.commandPalette;
  if (legacyCommandPalette?.addCommand && legacyCommandPalette?.removeCommand) {
    await legacyCommandPalette.addCommand(command);
    console.info("[todoist-backup] command registered via window.roamAlphaAPI.ui.commandPalette");

    return async () => {
      await legacyCommandPalette.removeCommand({ label: COMMAND_LABEL });
    };
  }
  console.warn("[todoist-backup] command palette API not available");

  return async () => undefined;
}

export function registerTopbarButton(onSync: () => Promise<void>): () => void {
  const topbar = document.querySelector(".rm-topbar");
  if (!topbar) {
    return () => undefined;
  }

  const existing = document.getElementById(TOPBAR_BUTTON_ID);
  existing?.remove();

  const button = createIconButton(TOPBAR_ICON_NAME);
  button.id = TOPBAR_BUTTON_ID;
  button.title = COMMAND_LABEL;

  const handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void onSync();
  };

  button.addEventListener("click", handleClick);
  topbar.appendChild(button);

  return () => {
    button.removeEventListener("click", handleClick);
    button.remove();
  };
}

