/**
 * Load increment (kg) applied per equipment type.
 *
 * Barbell, dumbbell, kettlebell, and machine use their standard plate/stack
 * steps; every other equipment falls back to the default 2.5 kg step. Total
 * over `EquipmentType` on purpose: adding an equipment type becomes a compile
 * error until a step is chosen for it.
 */
import { EquipmentType } from '@/domain/types/exercise';

export const EQUIPMENT_LOAD_INCREMENT_KG: Record<EquipmentType, number> = {
  [EquipmentType.Barbell]: 2.5,
  [EquipmentType.Dumbbell]: 2,
  [EquipmentType.Kettlebell]: 4,
  [EquipmentType.Machine]: 2.5,
  [EquipmentType.Bodyweight]: 2.5,
  [EquipmentType.ResistanceBand]: 2.5,
  [EquipmentType.Bench]: 2.5,
  [EquipmentType.PullUpBar]: 2.5,
};
