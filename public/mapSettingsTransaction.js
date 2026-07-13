import { saveHeatmapSettings } from './heatmapSettings.js';
import { saveMapOverlaySettings } from './mapOverlaySettings.js';

export function saveMapSettingsTransaction(storage, {
  currentHeatmapSettings,
  currentMapOverlaySettings,
  nextHeatmapSettings,
  nextMapOverlaySettings
}) {
  try {
    const heatmapSettings = saveHeatmapSettings(storage, nextHeatmapSettings);
    const mapOverlaySettings = saveMapOverlaySettings(
      storage,
      nextMapOverlaySettings
    );
    return { heatmapSettings, mapOverlaySettings };
  } catch (error) {
    try {
      saveHeatmapSettings(storage, currentHeatmapSettings);
      saveMapOverlaySettings(storage, currentMapOverlaySettings);
    } catch {
      // Preserve the original write error; localStorage has no transactions.
    }
    throw error;
  }
}
