import type { Dataset } from "@/schemas/character";
import type { CharacterImageAsset } from "@/schemas/characterImage";

export function applyCharacterImageOverrides(
  dataset: Dataset,
  overrides: ReadonlyMap<string, CharacterImageAsset>,
): Dataset {
  if (overrides.size === 0) return dataset;
  let changed = false;
  const characters = dataset.characters.map((character) => {
    const asset = overrides.get(character.id);
    if (!asset || (asset.portrait === character.portrait && asset.thumb === character.thumb)) {
      return character;
    }
    changed = true;
    return { ...character, portrait: asset.portrait, thumb: asset.thumb };
  });
  return changed ? { ...dataset, characters } : dataset;
}
